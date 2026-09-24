import { supabase } from "../config/supabase";
import { buildOptionIndex, optionsForQuestion, selectedOptionValues } from "../lib/answerOptionMatch";
import { type BreakAxis, breakCategoryOf } from "../lib/gtTable";
import { logger } from "../lib/logger";
import { isCoveredByConsent } from "../lib/questionShare";
import { answerRepository } from "../repositories/answerRepository";
import { documentRepository } from "../repositories/documentRepository";
import { questionRepository } from "../repositories/questionRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { userConsentRecordRepository } from "../repositories/userConsentRecordRepository";
import { projectRepository } from "../repositories/projectRepository";
import { userProfileRepository } from "../repositories/userProfileRepository";
import { throwIfError } from "../repositories/baseRepository";
import type { Project } from "../types/domain";
import { assignmentService } from "./assignmentService";

/**
 * cellInterviewService.ts
 *
 * GT集計表の「気になるセル」＝ 特定の設問で特定の選択肢を選んだ回答者を母集団として、
 * 追加のAI深掘りインタビューを配信する。
 *
 * ## 守っている約束
 *
 * 1. **識別子を外に出さない。**
 *    このサービスが返すのは「人数」だけ。line_user_id / respondent_id / session_id は
 *    サーバー内で完結させる。既存 partnerSurveyService.getResults と同じ作法。
 *    セル選択は「抽出条件」であって「名簿」ではない。
 *
 * 2. **突合は lib/answerOptionMatch.ts に一本化。**
 *    GT表のセルに出ている人数と、ここで抽出される人数は必ず一致させる。
 *
 * 3. **同意は遡及しない（個人情報保護法）。**
 *    追加インタビューの利用目的は migration 112（規約 v2.2）で追加した。
 *    v2.2 に同意する前の回答は母集団に入れられない。
 *    既存の `isCoveredByConsent` で「同意日時 <= 回答日時」を機械的に判定する。
 *    ⚠ ここを人の判断に委ねない。コードで弾く。
 *
 * 4. **人数は変動する。** 表示時と実行時で再計算する
 *    （ブロック・通知拒否・頻度制限・既配信が時間とともに変わるため）。
 *
 * 5. **二重配信しない。** 送信前に cell_interview_targets へ claimed 行を立てる
 *    先行クレーム方式（cycleFollowupService と同じ）。
 */

/** 追加インタビューの利用目的を追加した規約の document_id（migration 112 / v2.2）。 */
const RESPONDENT_TERMS_DOCUMENT_ID = "d0000000-0000-0000-0000-000000000001";

/**
 * 追加インタビューの利用目的が入った最初の版番号。
 *
 * これ以降の版に同意していれば再接触の根拠がある。
 * ⚠ 版番号の文字列比較ではなく、後述の `isFollowupConsentVersion` で判定する。
 */
const FOLLOWUP_CONSENT_MIN_VERSION = "2.2";

/** 同一の回答者へ追加インタビューを依頼する最短間隔（日）。配信頻度制御（G16）。 */
export const FOLLOWUP_COOLDOWN_DAYS = 14;

/** 謝礼ポイントの倍率。インタビューは回答負荷が高いため通常案件より高く設定する。 */
export const INTERVIEW_REWARD_MULTIPLIER = 2;

/** セル条件。これが「抽出条件」の全体。 */
export interface CellCondition {
  /** 抽出元の案件。 */
  sourceProjectId: string;
  /** 抽出元の設問。 */
  sourceQuestionId: string;
  /** 選択肢の value（ラベルではない）。 */
  optionValue: string;
  /** 属性ブレークで絞る場合の軸。総数セルなら省略。 */
  breakAxis?: BreakAxis;
  /** 属性ブレークのカテゴリコード。breakAxis と対で指定する。 */
  breakCode?: string;
}

/** 到達可能人数の内訳。顧客に見せるのは matched / reachable のみ。 */
export interface ReachabilityResult {
  /** セル条件に該当した人数（GT表のセルの数字と一致する）。 */
  matched: number;
  /** うち、今インタビューを依頼できる人数。 */
  reachable: number;
  /** 内訳（運営の診断用。顧客には出さない）。 */
  breakdown: {
    /** 規約 v2.2 未同意、または同意前の回答だった。 */
    excluded_no_consent: number;
    /** 通知拒否・ブロック・通知停止。 */
    excluded_not_notifiable: number;
    /** 直近 FOLLOWUP_COOLDOWN_DAYS 日に追加インタビューを受けている。 */
    excluded_cooldown: number;
    /** プロフィール未登録で属性ブレークの判定ができなかった。 */
    excluded_no_profile: number;
  };
}

/** 到達可能な対象（サーバー内でのみ使う。外に出さない）。 */
interface ResolvedTarget {
  lineUserId: string;
  /** 抽出元案件での respondent.id。assignManual の sourceRespondentIds に渡す。 */
  sourceRespondentId: string;
}

interface ResolveOutcome {
  reachability: ReachabilityResult;
  targets: ResolvedTarget[];
}

/**
 * 同意記録が、追加インタビューの根拠になる版か。
 *
 * version_no は "2.0" / "2.1" / "2.2" の形。数値として比較する
 * （文字列比較だと "2.10" < "2.2" になるため）。
 */
function isFollowupConsentVersion(versionNo: string | null | undefined): boolean {
  if (!versionNo) {
    return false;
  }
  const parse = (value: string): number[] =>
    value
      .split(".")
      .map((part) => Number.parseInt(part, 10))
      .map((part) => (Number.isFinite(part) ? part : 0));

  const actual = parse(versionNo);
  const required = parse(FOLLOWUP_CONSENT_MIN_VERSION);
  const length = Math.max(actual.length, required.length);
  for (let i = 0; i < length; i += 1) {
    const a = actual[i] ?? 0;
    const r = required[i] ?? 0;
    if (a > r) return true;
    if (a < r) return false;
  }
  return true;
}

/** 直近 cooldown 日以内に追加インタビューを送った line_user_id の集合。 */
async function loadCooldownLineUserIds(lineUserIds: string[]): Promise<Set<string>> {
  if (lineUserIds.length === 0) {
    return new Set();
  }
  const since = new Date(Date.now() - FOLLOWUP_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("cell_interview_targets")
    .select("line_user_id")
    .in("line_user_id", lineUserIds)
    .eq("status", "sent")
    .gte("sent_at", since);
  throwIfError(error);

  return new Set(((data ?? []) as Array<{ line_user_id: string }>).map((row) => row.line_user_id));
}

/**
 * セル条件に該当する回答者を解決し、到達可能人数を算出する。
 *
 * ⚠ 返り値の targets は**サーバー内専用**。API レスポンスに載せてはならない。
 */
async function resolve(condition: CellCondition): Promise<ResolveOutcome> {
  const question = await questionRepository.getById(condition.sourceQuestionId);
  if (!question || question.project_id !== condition.sourceProjectId) {
    throw new Error(
      `設問が案件に属していません（question=${condition.sourceQuestionId} project=${condition.sourceProjectId}）`
    );
  }

  const options = optionsForQuestion(question);
  if (options.length === 0) {
    throw new Error("選択肢を持たない設問はセル抽出の対象外です（自由記述からは抽出できません）");
  }
  if (!options.some((option) => option.value === condition.optionValue)) {
    throw new Error(`選択肢 value が設問に存在しません（value=${condition.optionValue}）`);
  }
  if ((condition.breakAxis === undefined) !== (condition.breakCode === undefined)) {
    // 片方だけ指定されると条件が再現できない。fail-closed。
    throw new Error("属性ブレークは軸とコードを対で指定してください");
  }

  const optionIndex = buildOptionIndex(options);

  // 1. この設問の primary 回答を全件読む（打ち切らない。§answerRepository の注記参照）
  const answers = await answerRepository.listPrimaryByQuestion(condition.sourceQuestionId);

  // 2. 選択肢で絞る（突合は共有モジュール）
  const matchedAnswers = answers.filter((answer) =>
    selectedOptionValues(answer, optionIndex).has(condition.optionValue)
  );
  if (matchedAnswers.length === 0) {
    return {
      reachability: {
        matched: 0,
        reachable: 0,
        breakdown: {
          excluded_no_consent: 0,
          excluded_not_notifiable: 0,
          excluded_cooldown: 0,
          excluded_no_profile: 0
        }
      },
      targets: []
    };
  }

  // 3. answers → sessions → respondents で名寄せ
  const sessions = await sessionRepository.listByProject(condition.sourceProjectId);
  const sessionById = new Map(sessions.map((session) => [session.id, session]));

  const respondents = await respondentRepository.listByProject(condition.sourceProjectId);
  const respondentById = new Map(respondents.map((respondent) => [respondent.id, respondent]));

  // ⚠ respondents は案件ごとに1行あるため、line_user_id で distinct を取る（G6 の罠）。
  //    同一人物が複数セッションを持つ場合は最初の1件を採る。
  const byLineUser = new Map<string, { sourceRespondentId: string; answeredAt: string }>();

  for (const answer of matchedAnswers) {
    const session = sessionById.get(answer.session_id);
    if (!session) {
      continue;
    }
    const respondent = respondentById.get(session.respondent_id);
    if (!respondent) {
      continue;
    }
    const lineUserId = respondent.line_user_id;
    if (!lineUserId || byLineUser.has(lineUserId)) {
      continue;
    }
    byLineUser.set(lineUserId, {
      sourceRespondentId: respondent.id,
      // 同意判定は回答日時で行う。セッションの完了日時があればそちらを優先する。
      answeredAt: answer.created_at
    });
  }

  const lineUserIds = [...byLineUser.keys()];
  const matched = lineUserIds.length;

  // 4. 属性ブレークで絞る（指定時のみ）
  const profiles = await userProfileRepository.listByLineUserIds(lineUserIds);
  const profileByLineUser = new Map(profiles.map((profile) => [profile.line_user_id, profile]));

  let excludedNoProfile = 0;
  const afterBreak: string[] = [];
  for (const lineUserId of lineUserIds) {
    if (condition.breakAxis === undefined) {
      afterBreak.push(lineUserId);
      continue;
    }
    const entry = byLineUser.get(lineUserId);
    const profile = profileByLineUser.get(lineUserId) ?? null;
    const category = breakCategoryOf(condition.breakAxis, profile, entry?.answeredAt ?? null);
    if (!category) {
      excludedNoProfile += 1;
      continue;
    }
    if (category.code !== condition.breakCode) {
      continue;
    }
    afterBreak.push(lineUserId);
  }

  // 5. 同意で絞る（⚠ 遡及しない。規約 v2.2 以降に同意し、かつ同意後の回答であること）
  //
  // ⚠ user_consent_records は document_version_id しか持たず、listActiveByLineUserIds は
  //   version_no を join しない。版番号で判定するため、対象書類の版一覧を引いて
  //   version_id → version_no の対応表を作る（join に頼ると取りこぼして全員除外になる）。
  const termsVersions = await documentRepository.listVersions(RESPONDENT_TERMS_DOCUMENT_ID);
  const followupVersionIds = new Set(
    termsVersions
      .filter((version) => isFollowupConsentVersion(version.version_no))
      .map((version) => version.id)
  );

  const consentRecords = await userConsentRecordRepository.listActiveByLineUserIds(afterBreak);
  const consentedAtByLineUser = new Map<string, string>();
  for (const record of consentRecords) {
    if (record.document_id !== RESPONDENT_TERMS_DOCUMENT_ID) {
      continue;
    }
    if (!followupVersionIds.has(record.document_version_id)) {
      continue;
    }
    // 同じ人が複数版に同意している場合、根拠が生じた最初の時点を採る。
    const current = consentedAtByLineUser.get(record.line_user_id);
    if (!current || record.consented_at < current) {
      consentedAtByLineUser.set(record.line_user_id, record.consented_at);
    }
  }

  let excludedNoConsent = 0;
  const afterConsent: string[] = [];
  for (const lineUserId of afterBreak) {
    const entry = byLineUser.get(lineUserId);
    if (!entry) {
      continue;
    }
    if (!isCoveredByConsent(consentedAtByLineUser.get(lineUserId) ?? null, entry.answeredAt)) {
      excludedNoConsent += 1;
      continue;
    }
    afterConsent.push(lineUserId);
  }

  // 6. 通知可否で絞る（既存の配信フィルタと同じ条件）
  let excludedNotNotifiable = 0;
  const afterNotifiable: string[] = [];
  for (const lineUserId of afterConsent) {
    const profile = profileByLineUser.get(lineUserId);
    const notifiable =
      profile &&
      profile.is_blocked === false &&
      profile.notification_ok === true &&
      profile.is_notification_stopped === false;
    if (!notifiable) {
      excludedNotNotifiable += 1;
      continue;
    }
    afterNotifiable.push(lineUserId);
  }

  // 7. 配信頻度制御（G16）
  const cooldown = await loadCooldownLineUserIds(afterNotifiable);
  let excludedCooldown = 0;
  const targets: ResolvedTarget[] = [];
  for (const lineUserId of afterNotifiable) {
    if (cooldown.has(lineUserId)) {
      excludedCooldown += 1;
      continue;
    }
    const entry = byLineUser.get(lineUserId);
    if (!entry) {
      continue;
    }
    targets.push({ lineUserId, sourceRespondentId: entry.sourceRespondentId });
  }

  return {
    reachability: {
      matched,
      reachable: targets.length,
      breakdown: {
        excluded_no_consent: excludedNoConsent,
        excluded_not_notifiable: excludedNotNotifiable,
        excluded_cooldown: excludedCooldown,
        excluded_no_profile: excludedNoProfile
      }
    },
    targets
  };
}

export const cellInterviewService = {
  /**
   * セル条件の該当人数と到達可能人数を返す（配信はしない）。
   *
   * ⚠ 返すのは人数だけ。識別子は含まない。
   * ⚠ この数字は変動する。実行時に必ず再計算する。
   */
  async estimate(condition: CellCondition): Promise<ReachabilityResult> {
    const { reachability } = await resolve(condition);
    logger.info("cellInterview.estimate", {
      sourceProjectId: condition.sourceProjectId,
      sourceQuestionId: condition.sourceQuestionId,
      matched: reachability.matched,
      reachable: reachability.reachable
    });
    return reachability;
  },

  /**
   * 内部用: 配信対象を解決する。
   *
   * ⚠ 識別子を含むため、API レスポンスへ渡してはならない。
   *   配信処理（assignManual）へ直接渡す用途のみ。
   */
  async resolveTargetsInternal(condition: CellCondition): Promise<ResolveOutcome> {
    return resolve(condition);
  },

  /** 追加インタビュー案件の謝礼ポイントを算出する。 */
  rewardPointsFor(sourceRewardPoints: number): number {
    return Math.max(1, Math.round(sourceRewardPoints * INTERVIEW_REWARD_MULTIPLIER));
  },

  /**
   * セル条件から追加AIインタビューを生成して配信する。
   *
   * 手順:
   *   1. 人数を**再計算**する（表示時の数字は古い可能性がある）
   *   2. 台帳（cell_interview_requests）を立てる
   *   3. 配信対象を cell_interview_targets へ claimed で**先に**立てる（冪等性）
   *      ⚠ 「送ってから記録」にすると記録前に落ちた場合に二重配信になる
   *   4. interview_chat 案件を生成し、設問を1問置く
   *   5. 既存の assignManual に respondent ID を渡して配信する（新規配信経路は作らない）
   *
   * @returns 人数のみ（識別子は含まない）
   */
  async execute(input: {
    condition: CellCondition;
    /** インタビューで聞きたいこと（AIの深掘りの起点になる設問文）。 */
    questionText: string;
    /** 案件名。省略時は抽出条件から自動生成する。 */
    projectName?: string;
    requestedByAdmin?: string | null;
    requestedByStoreId?: string | null;
    deadline?: string | null;
  }): Promise<{
    request_id: string;
    interview_project_id: string;
    matched: number;
    reachable: number;
    sent: number;
    failed: number;
  }> {
    const questionText = input.questionText.trim();
    if (questionText.length === 0) {
      throw new Error("インタビューの設問文が空です");
    }

    // 1. 実行時に再計算する（表示時の人数は変動している）
    const { reachability, targets } = await resolve(input.condition);

    const sourceQuestion = await questionRepository.getById(input.condition.sourceQuestionId);
    const optionLabel =
      optionsForQuestion(sourceQuestion).find((option) => option.value === input.condition.optionValue)
        ?.label ?? null;

    // 2. 台帳を立てる
    const { data: requestRow, error: requestError } = await supabase
      .from("cell_interview_requests")
      .insert({
        source_project_id: input.condition.sourceProjectId,
        source_question_id: input.condition.sourceQuestionId,
        source_option_value: input.condition.optionValue,
        source_option_label: optionLabel,
        break_axis: input.condition.breakAxis ?? null,
        break_code: input.condition.breakCode ?? null,
        matched_count: reachability.matched,
        reachable_count: reachability.reachable,
        requested_by_admin: input.requestedByAdmin ?? null,
        requested_by_store_id: input.requestedByStoreId ?? null,
        status: "claimed"
      })
      .select("id")
      .single();
    throwIfError(requestError);
    const requestId = (requestRow as { id: string }).id;

    if (targets.length === 0) {
      await supabase
        .from("cell_interview_requests")
        .update({ status: "sent", sent_count: 0, failed_count: 0, updated_at: new Date().toISOString() })
        .eq("id", requestId);
      logger.info("cellInterview.execute.noTargets", { requestId, matched: reachability.matched });
      return {
        request_id: requestId,
        interview_project_id: "",
        matched: reachability.matched,
        reachable: 0,
        sent: 0,
        failed: 0
      };
    }

    // 3. 先行クレーム。⚠ 送信前に立てる。
    //    unique(request_id, line_user_id) が二重配信の防波堤。
    const { error: targetError } = await supabase.from("cell_interview_targets").insert(
      targets.map((target) => ({
        request_id: requestId,
        line_user_id: target.lineUserId,
        status: "claimed"
      }))
    );
    throwIfError(targetError);

    // 4. interview_chat 案件を生成する
    const sourceProject = await projectRepository.getById(input.condition.sourceProjectId);
    const projectName =
      input.projectName?.trim() ||
      `【追加インタビュー】${sourceProject.name} / ${sourceQuestion.question_code} ${optionLabel ?? input.condition.optionValue}`;

    let interviewProject: Project;
    try {
      interviewProject = await projectRepository.create({
        name: projectName,
        client_name: sourceProject.client_name,
        objective: `${sourceQuestion.question_text} で「${optionLabel ?? input.condition.optionValue}」と回答した方への深掘り`,
        status: "active",
        // 謝礼はインタビューの負荷に合わせて倍率を掛ける（固定倍率＝全員定額。抽選にはしない）
        reward_points: this.rewardPointsFor(sourceProject.reward_points),
        research_mode: "interview",
        display_mode: "interview_chat",
        cell_interview_request_id: requestId
      } as never);

      // AI深掘りを有効にした設問を1問置く。以降の掘りは既存の
      // conversationOrchestratorService（probe）が担う。
      await questionRepository.create({
        project_id: interviewProject.id,
        question_code: "IQ1",
        question_text: questionText,
        question_type: "free_text_long",
        is_required: true,
        sort_order: 1,
        ai_probe_enabled: true
      } as never);
    } catch (error) {
      await supabase
        .from("cell_interview_requests")
        .update({
          status: "failed",
          error_message: error instanceof Error ? error.message : String(error),
          updated_at: new Date().toISOString()
        })
        .eq("id", requestId);
      throw error;
    }

    await supabase
      .from("cell_interview_requests")
      .update({ interview_project_id: interviewProject.id, updated_at: new Date().toISOString() })
      .eq("id", requestId);

    // 5. 配信は既存経路（assignManual）に respondent ID を渡すだけ
    const { sentCount, failedCount } = await assignmentService.assignManual({
      projectId: interviewProject.id,
      sourceRespondentIds: targets.map((target) => target.sourceRespondentId),
      deadline: input.deadline ?? null,
      assignmentType: "rule_based",
      // 抽出条件を記録する（後から「なぜこの人に届いたか」を辿れるように）
      filterSnapshot: {
        kind: "gt_cell_interview",
        request_id: requestId,
        source_project_id: input.condition.sourceProjectId,
        source_question_id: input.condition.sourceQuestionId,
        option_value: input.condition.optionValue,
        break_axis: input.condition.breakAxis ?? null,
        break_code: input.condition.breakCode ?? null
      }
    });

    const nowIso = new Date().toISOString();
    // 配信できた分を sent に上げる。
    // ⚠ assignManual は成功/失敗の件数しか返さないため、誰が失敗したかは分からない。
    //   そのため全件を sent にはせず、失敗が出た場合は台帳側の failed_count で示す
    //   （cooldown 判定は sent 行を見るので、失敗した人を sent にすると次回除外されてしまう）。
    if (failedCount === 0) {
      await supabase
        .from("cell_interview_targets")
        .update({ status: "sent", sent_at: nowIso })
        .eq("request_id", requestId);
    } else {
      // 誰が失敗したか特定できないので、この要求の対象は cooldown に入れない（再試行可能にする）。
      await supabase
        .from("cell_interview_targets")
        .update({ status: "failed", error_message: "一部の配信が失敗しました（内訳は assignments を参照）" })
        .eq("request_id", requestId);
    }

    await supabase
      .from("cell_interview_requests")
      .update({
        status: failedCount === 0 ? "sent" : "failed",
        sent_count: sentCount,
        failed_count: failedCount,
        updated_at: nowIso
      })
      .eq("id", requestId);

    logger.info("cellInterview.execute", {
      requestId,
      interviewProjectId: interviewProject.id,
      matched: reachability.matched,
      reachable: reachability.reachable,
      sentCount,
      failedCount
    });

    return {
      request_id: requestId,
      interview_project_id: interviewProject.id,
      matched: reachability.matched,
      reachable: reachability.reachable,
      sent: sentCount,
      failed: failedCount
    };
  }
};
