import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";
import { isDemographicQuestion } from "../lib/partnerDemographics";
import { toPartnerQuestionType } from "../lib/partnerQuestions";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import type { Project, Question } from "../types/domain";
import {
  type PartnerSurveyView,
  ensureDemographicQuestions,
  generatePartnerEntryCode,
  loadPartnerQuestionViews,
  toSurveyView
} from "./partnerSurveyService";

/**
 * partnerAssignmentService.ts
 *
 * 運営専用API（/api/partner-admin/*・docs/partner-api.md §8）のユースケース層。
 *
 * ACI の管理画面で運営（YOTTO）が作った案件を、ポータルの運営画面（/ops）から
 * 店舗（ポータル側 stores.id）に割り当てる。割り当ての実体は
 * `projects.partner_store_id` に店舗IDを入れること。
 *
 * partnerSurveyService（店舗スコープ）とは所有者の扱いが逆で、
 * こちらは「まだ誰のものでもない案件」を探して所有者を付ける。
 * 設問の表現・性年代設問の不変条件は partnerSurveyService のヘルパーを再利用する
 * （割り当て直後の案件が、ポータルから作った案件と1バイトも違わない状態になるように）。
 */

// ------------------------------------------------------------------
// 出力型
// ------------------------------------------------------------------

/**
 * 候補一覧の1件。
 *
 * **設問本文は含めない**。一覧は「どの案件があるか」を選ぶためだけのもので、
 * 専門家が練った設問文が、割り当て前に運営画面の一覧レスポンスへ丸ごと載る必要はない。
 * 中身を見たいときは `previewSurvey`（GET /surveys/:id）を明示的に叩く。
 */
export interface AssignableSurveySummary {
  survey_id: string;
  title: string;
  status: Project["status"];
  /** パートナー4種に写像できる設問数（性年代の固定2問は除く）。 */
  question_count: number;
  created_at: string;
  /** そのまま割り当てられるか。false のとき blocked_reason が入る。 */
  assignable: boolean;
  /** 割り当てられない理由。assignable=true なら null。 */
  blocked_reason: string | null;
}

/** 割り当て済み案件の1件（整合性チェック用）。設問本文は含めない。 */
export interface AssignedSurveySummary {
  survey_id: string;
  title: string;
  status: Project["status"];
  store_id: string;
  entry_code: string | null;
  created_at: string;
  updated_at: string;
}

/** 4種に写像できない設問（409 のときに返す）。 */
export interface UnmappableQuestion {
  question_code: string;
  question_text: string;
  question_type: string;
}

// ------------------------------------------------------------------
// 純関数（テストから直接検証する）
// ------------------------------------------------------------------

/**
 * 割り当ての対象になる設問だけを残す。
 * 性年代の固定2問はサーバーが必ず作り直すので対象外。システム設問（free_comment）も
 * パートナーには見えないので対象外。
 */
export function selectAssignableQuestions(questions: Question[]): Question[] {
  return questions.filter(
    (question) => !question.is_system && !question.is_hidden && !isDemographicQuestion(question)
  );
}

/**
 * パートナー4種に写像できない設問を列挙する。
 *
 * `toPartnerQuestionType()` は写像できない設問に null を返し、
 * `loadPartnerQuestionViews()` はそれをレスポンスから**黙って落とす**。
 * 割り当て時にそれをやると「店舗のエディタで開いたら設問が減っていた」となり、
 * 次の保存（全置換）で内部からも消える。だからここで検出して 409 にする。
 */
export function findUnmappableQuestions(questions: Question[]): UnmappableQuestion[] {
  return selectAssignableQuestions(questions)
    .filter((question) => toPartnerQuestionType(question) === null)
    .map((question) => ({
      question_code: question.question_code,
      question_text: question.question_text,
      question_type: question.question_type
    }));
}

/**
 * 候補として妥当かを判定する。妥当なら null、駄目ならその理由。
 * 一覧（表示）と割り当て（実行）で同じ判定を使い、画面と挙動をずらさない。
 */
export function assignmentBlockedReason(project: Project): string | null {
  if (project.partner_store_id) {
    return "already assigned to a store";
  }
  if (project.client_id) {
    return "project belongs to a client";
  }
  if (project.status !== "draft" && project.status !== "ready") {
    return `status must be draft or ready (current: ${project.status})`;
  }
  if (project.is_discoverable) {
    return "project is discoverable in the public list";
  }
  return null;
}

// ------------------------------------------------------------------
// 内部ヘルパー
// ------------------------------------------------------------------

/** 割り当て対象の案件を引く。存在しなければ 404。 */
async function loadProject(surveyId: string): Promise<Project> {
  const project = await projectRepository.getById(surveyId).catch(() => null);
  if (!project) {
    throw new HttpError(404, "survey not found");
  }
  return project;
}

// ------------------------------------------------------------------
// ユースケース
// ------------------------------------------------------------------

export const partnerAssignmentService = {
  /**
   * 割り当て候補の一覧。**設問本文は含めない**（漏洩面を最小にする）。
   * 抽出条件は repository 側（listAssignableForPartner）で絞り、
   * ここでは「4種に写像できない設問がある」など設問側の理由だけを足す。
   */
  async listAssignable(): Promise<{ surveys: AssignableSurveySummary[] }> {
    const projects = await projectRepository.listAssignableForPartner();
    const surveys: AssignableSurveySummary[] = [];
    for (const project of projects) {
      const questions = await questionRepository.listByProject(project.id, {
        includeHidden: false
      });
      const target = selectAssignableQuestions(questions);
      const unmappable = findUnmappableQuestions(questions);
      const reason =
        assignmentBlockedReason(project) ??
        (unmappable.length > 0
          ? `contains ${unmappable.length} question(s) not representable as partner question types`
          : null);
      surveys.push({
        survey_id: project.id,
        title: project.user_display_title || project.name,
        status: project.status,
        question_count: target.length - unmappable.length,
        created_at: project.created_at,
        assignable: reason === null,
        blocked_reason: reason
      });
    }
    return { surveys };
  },

  /** 割り当て済み案件の一覧（整合性チェック用）。 */
  async listAssigned(): Promise<{ surveys: AssignedSurveySummary[] }> {
    const projects = await projectRepository.listAssignedToPartner();
    return {
      surveys: projects.map((project) => ({
        survey_id: project.id,
        title: project.user_display_title || project.name,
        status: project.status,
        store_id: project.partner_store_id ?? "",
        entry_code: project.entry_code,
        created_at: project.created_at,
        updated_at: project.updated_at
      }))
    };
  },

  /**
   * 割り当て前プレビュー（設問込み）。
   * 店舗のエディタで開いたときに何が見えるかを、割り当て前に運営が確認するためのもの。
   * レスポンスは店舗向け GET /api/partner/surveys/:id と同じ形（SurveyView）。
   */
  async previewSurvey(surveyId: string): Promise<PartnerSurveyView> {
    const project = await loadProject(surveyId);
    const questions = await loadPartnerQuestionViews(project.id);
    return toSurveyView(project, questions);
  },

  /**
   * 店舗に割り当てる。ガードを**すべて**通ってからでないと書き込まない。
   *
   * status は published にしない。QR を発行する前に回答が集まると、
   * 店舗が意図しないままチケットが消費される穴になるため
   * （公開は店舗が POST /api/partner/surveys/:id/publish を叩いたときだけ）。
   */
  async assignToStore(surveyId: string, storeId: string): Promise<PartnerSurveyView> {
    const project = await loadProject(surveyId);

    // 1〜3: 案件そのものの状態（partner_store_id は最終的に条件付きUPDATEでも担保する）
    const reason = assignmentBlockedReason(project);
    if (reason) {
      throw new HttpError(409, reason);
    }

    // 4: 回答済みの案件は割り当てない。
    // 既に回答が入っている案件を店舗に渡すと、その店舗の画面に他所で集めた
    // 回答者データが見えてしまう。
    const sessions = await sessionRepository.listByProject(project.id);
    const completedCount = sessions.filter((session) => session.status === "completed").length;
    if (completedCount > 0) {
      throw new HttpError(409, `survey already has ${completedCount} completed session(s)`);
    }

    // 5: 4種に写像できない設問があれば、黙って落とさず 409 で知らせる。
    const questions = await questionRepository.listByProject(project.id, { includeHidden: false });
    const unmappable = findUnmappableQuestions(questions);
    if (unmappable.length > 0) {
      throw new HttpError(
        409,
        `survey contains question types not supported by the partner editor: ${unmappable
          .map((question) => `${question.question_code}(${question.question_type})`)
          .join(", ")}`
      );
    }

    const entryCode = project.entry_code?.trim() || (await generatePartnerEntryCode());

    // 条件付きUPDATE（where partner_store_id is null）。
    // ここまでの検査と実際の書き込みの間に別の運営操作が割り込んでも、
    // 更新行が0件になることで二重割り当てが防がれる。
    const assigned = await projectRepository.assignPartnerStore(project.id, storeId, {
      visibility_type: "private_store",
      is_discoverable: false,
      entry_code: entryCode
    });
    if (!assigned) {
      throw new HttpError(409, "already assigned to a store");
    }

    // 割り当てた瞬間から、ポータルから作った案件と同じ不変条件（性年代の固定2問）を満たす。
    await ensureDemographicQuestions(assigned.id);

    logger.info("partnerAssignment.assigned", {
      surveyId: assigned.id,
      storeId,
      status: assigned.status
    });

    const views = await loadPartnerQuestionViews(assigned.id);
    return toSurveyView(assigned, views);
  },

  /**
   * 割り当てを取り消す。ポータル側の書き込みが失敗したときの巻き戻しにも使う。
   * entry_code を落として visibility_type を public に戻す（安全側）。
   */
  async unassignFromStore(surveyId: string): Promise<PartnerSurveyView> {
    const project = await loadProject(surveyId);
    if (!project.partner_store_id) {
      // 巻き戻しが二重に走っても落とさない（既に未割り当て＝望む状態）。
      const views = await loadPartnerQuestionViews(project.id);
      return toSurveyView(project, views);
    }

    const unassigned = await projectRepository.unassignPartnerStore(project.id);
    if (!unassigned) {
      throw new HttpError(404, "survey not found");
    }

    logger.info("partnerAssignment.unassigned", {
      surveyId: unassigned.id,
      storeId: project.partner_store_id
    });

    const views = await loadPartnerQuestionViews(unassigned.id);
    return toSurveyView(unassigned, views);
  }
};
