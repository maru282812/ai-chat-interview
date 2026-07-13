import { answerExtractionRepository } from "../repositories/answerExtractionRepository";
import { answerRepository } from "../repositories/answerRepository";
import { projectAssignmentRepository } from "../repositories/projectAssignmentRepository";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
import { questionnaireSnapshotRepository } from "../repositories/questionnaireSnapshotRepository";
import { rankRepository } from "../repositories/rankRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { userConsentRecordRepository } from "../repositories/userConsentRecordRepository";
import { userProfileRepository } from "../repositories/userProfileRepository";
import {
  type ExportAnswerGroup,
  type ExportRespondent,
  buildCodebookRows,
  buildLongRows,
  buildRandomizationLogRows,
  buildSnapshotDefinition,
  buildWideRows,
  toCsvRfc4180
} from "../lib/statExport";
import {
  type RawdataColumnInfo,
  type RawdataMode,
  type RawdataRespondent,
  type StatusCount,
  assignQNumbers,
  buildRawdataColumnIndex,
  buildRawdataLayoutRows,
  buildRawdataRows,
  buildStatusCounts
} from "../lib/rawdataExport";
import { createZip } from "../lib/zip";
import { snapshotService } from "./snapshotService";
import type { VariableDefinition } from "../lib/codebook";
import type { Answer, AnswerExtraction, Question, Rank, Session } from "../types/domain";

/**
 * statExportService
 *
 * 改修指示 §11 の統計向けエクスポートを生成する。既存CSV出力は変更しない（§12 追加のみ）。
 * §19 に従い、出力主キーは respondent.id（擬似匿名 respondent_key）。line_user_id 等の
 * 直接識別子はエクスポートに含めない。
 */

function isAiProbeAnswer(answer: Answer): boolean {
  return (
    answer.answer_role === "ai_probe" ||
    (answer.normalized_answer?.source as string | undefined) === "ai_probe"
  );
}

function selectDeliverySession(sessions: Session[]): Session | null {
  const completed = sessions
    .filter((session) => session.status === "completed")
    .sort((left, right) => (right.completed_at ?? right.started_at).localeCompare(left.completed_at ?? left.started_at));
  return completed[0] ?? sessions[0] ?? null;
}

function mapResponseStatus(status: Session["status"]): string {
  switch (status) {
    case "completed":
      return "completed";
    case "active":
      return "partial";
    case "abandoned":
      return "abandoned";
    default:
      return "not_started";
  }
}

function durationSeconds(session: Session): number | null {
  if (!session.completed_at) {
    return null;
  }
  const start = Date.parse(session.started_at);
  const end = Date.parse(session.completed_at);
  return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, Math.round((end - start) / 1000)) : null;
}

function buildGroups(
  questions: Question[],
  answers: Answer[],
  extractionByAnswerId: Map<string, AnswerExtraction>
): ExportAnswerGroup[] {
  const answersByQuestion = new Map<string, Answer[]>();
  for (const answer of answers) {
    const list = answersByQuestion.get(answer.question_id) ?? [];
    list.push(answer);
    answersByQuestion.set(answer.question_id, list);
  }
  return questions.map((question) => {
    const related = answersByQuestion.get(question.id) ?? [];
    const primaryAnswer = related.find((answer) => !isAiProbeAnswer(answer)) ?? null;
    return {
      question,
      primaryAnswer,
      extraction: primaryAnswer ? extractionByAnswerId.get(primaryAnswer.id) ?? null : null,
      probeAnswers: related.filter((answer) => isAiProbeAnswer(answer))
    };
  });
}

export interface ExportOptions {
  excludeTest?: boolean;
  /** §19 外部提供/二次利用に同意した回答者のみに絞る */
  consentedOnly?: boolean;
  /** 同意フィルタ対象の書類タイプ（未指定なら任意の有効同意で可） */
  consentDocType?: string;
  /** ロウデータ出力用: 属性・ランク・回答した調査票の版数を respondent に付与する */
  forRawdata?: boolean;
}

/** ロウデータ（Freeasy水準）出力のオプション。docs/plan-rawdata-export.md 参照。 */
export interface RawdataExportOptions extends ExportOptions {
  mode?: RawdataMode;
  /** 含める response_status（既定 completed/partial/abandoned・画面の件数パネルで手動選択） */
  statuses?: string[];
  includeProbe?: boolean;
  /** UserAgent / IPAddress を含める（不正検出用・既定 false） */
  includePii?: boolean;
}

async function loadExportData(
  projectId: string,
  options: ExportOptions = {}
): Promise<{
  project: Awaited<ReturnType<typeof projectRepository.getById>>;
  questions: Question[];
  respondents: RawdataRespondent[];
  variables: VariableDefinition[];
}> {
  const [project, questions, respondents, sessions, assignments] = await Promise.all([
    projectRepository.getById(projectId),
    questionRepository.listByProject(projectId),
    respondentRepository.listByProject(projectId),
    sessionRepository.listByProject(projectId),
    projectAssignmentRepository.listByProject(projectId)
  ]);

  // §18 流入経路（liff / line）。配信レコードがあれば採用。
  const channelByRespondent = new Map<string, string>();
  for (const assignment of assignments) {
    if (assignment.respondent_id && assignment.delivery_channel) {
      channelByRespondent.set(assignment.respondent_id, assignment.delivery_channel);
    }
  }

  const sessionsByRespondent = new Map<string, Session[]>();
  for (const session of sessions) {
    const list = sessionsByRespondent.get(session.respondent_id) ?? [];
    list.push(session);
    sessionsByRespondent.set(session.respondent_id, list);
  }

  // §19 同意スコープ: 同意済みの line_user_id のみ残す
  let consentedLineUsers: Set<string> | null = null;
  if (options.consentedOnly) {
    const records = await userConsentRecordRepository.listActiveByLineUserIds(
      respondents.map((respondent) => respondent.line_user_id)
    );
    consentedLineUsers = new Set(
      records
        .filter((record) => !options.consentDocType || record.document?.document_type === options.consentDocType)
        .map((record) => record.line_user_id)
    );
  }

  const selected = respondents
    .filter((respondent) => (consentedLineUsers ? consentedLineUsers.has(respondent.line_user_id) : true))
    .map((respondent) => ({ respondent, session: selectDeliverySession(sessionsByRespondent.get(respondent.id) ?? []) }))
    .filter((item): item is { respondent: (typeof respondents)[number]; session: Session } => Boolean(item.session));

  const answers = await answerRepository.listBySessions(selected.map((item) => item.session.id));
  const extractionByAnswerId = new Map(
    (await answerExtractionRepository.listByAnswerIds(answers.map((answer) => answer.id))).map((extraction) => [
      extraction.source_answer_id,
      extraction
    ])
  );
  const answersBySession = new Map<string, Answer[]>();
  for (const answer of answers) {
    const list = answersBySession.get(answer.session_id) ?? [];
    list.push(answer);
    answersBySession.set(answer.session_id, list);
  }

  // ロウデータ出力用の付加情報（forRawdata 時のみ・凍結ファイル(wide/long/codebook)はこれらを読まない）
  const profileByLineUser = new Map<string, RawdataRespondent["profile"]>();
  const rankByLineUser = new Map<string, Rank>();
  const versionBySnapshotId = new Map<string, number>();
  if (options.forRawdata) {
    const lineUserIds = respondents.map((respondent) => respondent.line_user_id);
    const [profiles, ranks, snapshots] = await Promise.all([
      userProfileRepository.listByLineUserIds(lineUserIds),
      // RANK は user_ranks（正準）の現在ランク。回答完了時点の復元はしない（docs/実装計画_rawdata拡張_2026-07-13.md）
      rankRepository.listUserRanksByLineUserIds(lineUserIds),
      questionnaireSnapshotRepository.listByProject(projectId)
    ]);
    for (const profile of profiles) {
      profileByLineUser.set(profile.line_user_id, {
        gender: profile.gender,
        birth_date: profile.birth_date,
        prefecture: profile.prefecture,
        occupation: profile.occupation,
        industry: profile.industry,
        marital_status: profile.marital_status,
        has_children: profile.has_children,
        household_income: profile.household_income ?? null
      });
    }
    for (const [lineUserId, rank] of ranks) {
      rankByLineUser.set(lineUserId, rank);
    }
    for (const snapshot of snapshots) {
      versionBySnapshotId.set(snapshot.id, snapshot.version);
    }
  }

  const exportRespondents: RawdataRespondent[] = selected.map(({ respondent, session }) => ({
    profile: options.forRawdata ? profileByLineUser.get(respondent.line_user_id) ?? null : undefined,
    // 会員ランク: user_ranks が正準。未同期なら案件スコープの current_rank にフォールバック。
    rank_code: options.forRawdata
      ? (rankByLineUser.get(respondent.line_user_id)?.rank_code ?? respondent.current_rank?.rank_code ?? null)
      : undefined,
    rank_name: options.forRawdata
      ? (rankByLineUser.get(respondent.line_user_id)?.rank_name ?? respondent.current_rank?.rank_name ?? null)
      : undefined,
    // 回答した調査票の版数（§1/§14・sessions.snapshot_id）。未確定セッションは null。
    snapshot_version: options.forRawdata
      ? (session.snapshot_id ? versionBySnapshotId.get(session.snapshot_id) ?? null : null)
      : undefined,
    // 回答環境（migration 078・LIFF セッションのみ記録・未適用DBでは undefined → null）
    user_agent: session.user_agent ?? null,
    ip_address: session.ip_address ?? null,
    respondent_key: respondent.id,
    session_id: session.id,
    response_status: mapResponseStatus(session.status),
    // §17 テスト回答フラグ（migration 067）。未適用DBでは undefined → false。
    is_test: respondent.is_test ?? false,
    // §18 流入経路（migration なしで project_assignments.delivery_channel から導出）。
    channel: channelByRespondent.get(respondent.id) ?? null,
    started_at: session.started_at,
    completed_at: session.completed_at,
    total_duration_sec: durationSeconds(session),
    // §3/§22: 実表示順とシードが記録されていれば採用（無ければ export 側でマスター順フォールバック）。
    displayOrder: session.display_order_json
      ? new Map(Object.entries(session.display_order_json).map(([questionId, position]) => [questionId, Number(position)]))
      : undefined,
    randomizationSeed: session.randomization_seed ?? null,
    groups: buildGroups(questions, answersBySession.get(session.id) ?? [], extractionByAnswerId)
  }));

  // §2/§13: 有効スナップショットがあれば回答時点の定義・列順を基準にする。無ければ現設問から導出。
  const variables = await snapshotService.resolveCodebook(projectId, questions);

  return { project, questions, respondents: exportRespondents, variables };
}

export interface StatExportBundle {
  respondentsWideCsv: string;
  answersLongCsv: string;
  codebookCsv: string;
  questionnaireSnapshotJson: string;
  randomizationLogCsv: string;
}

export const statExportService = {
  async buildBundle(projectId: string, options: ExportOptions = {}): Promise<StatExportBundle> {
    const { respondents, variables } = await loadExportData(projectId, options);

    return {
      respondentsWideCsv: toCsvRfc4180(buildWideRows(variables, respondents, { excludeTest: options.excludeTest })),
      answersLongCsv: toCsvRfc4180(buildLongRows(variables, respondents)),
      codebookCsv: toCsvRfc4180(buildCodebookRows(variables)),
      questionnaireSnapshotJson: await this.questionnaireSnapshotJson(projectId),
      randomizationLogCsv: toCsvRfc4180(buildRandomizationLogRows(variables, respondents))
    };
  },

  async respondentsWideCsv(projectId: string, options: ExportOptions = {}): Promise<string> {
    const { respondents, variables } = await loadExportData(projectId, options);
    return toCsvRfc4180(buildWideRows(variables, respondents, { excludeTest: options.excludeTest }));
  },

  async answersLongCsv(projectId: string, options: ExportOptions = {}): Promise<string> {
    const { respondents, variables } = await loadExportData(projectId, options);
    return toCsvRfc4180(buildLongRows(variables, respondents));
  },

  async codebookCsv(projectId: string): Promise<string> {
    const variables: VariableDefinition[] = await snapshotService.resolveCodebook(projectId);
    return toCsvRfc4180(buildCodebookRows(variables));
  },

  async questionnaireSnapshotJson(projectId: string): Promise<string> {
    // 有効スナップショットがあればその凍結定義を返す（回答時点の定義・§1）。無ければ現設問から構築。
    const active = await snapshotService.getActive(projectId);
    if (active) {
      return JSON.stringify({ ...active.definition_json, snapshot_version: active.version, snapshot_created_at: active.created_at }, null, 2);
    }
    const [project, questions] = await Promise.all([
      projectRepository.getById(projectId),
      questionRepository.listByProject(projectId)
    ]);
    return JSON.stringify(buildSnapshotDefinition(project, questions), null, 2);
  },

  async randomizationLogCsv(projectId: string, options: ExportOptions = {}): Promise<string> {
    const { respondents, variables } = await loadExportData(projectId, options);
    return toCsvRfc4180(buildRandomizationLogRows(variables, respondents));
  },

  /**
   * 集計アプリ（ai-report）の入力契約である3点セット（wide/long/codebook）を zip 1本にまとめる。
   * 契約凍結ファイルをそのまま同梱するだけで、中身は個別DLと同一。
   * 3ファイルとも同じ回答スナップショットから作る必要があるため loadExportData は1回だけ呼ぶ。
   */
  async analysisBundleZip(projectId: string, options: ExportOptions = {}): Promise<Buffer> {
    const { respondents, variables } = await loadExportData(projectId, options);
    return createZip([
      {
        name: "respondents_wide.csv",
        data: toCsvRfc4180(buildWideRows(variables, respondents, { excludeTest: options.excludeTest }))
      },
      { name: "answers_long.csv", data: toCsvRfc4180(buildLongRows(variables, respondents)) },
      { name: "codebook.csv", data: toCsvRfc4180(buildCodebookRows(variables)) }
    ]);
  },

  // ------------------------------------------------------------------
  // ロウデータ（Freeasy水準）出力。docs/plan-rawdata-export.md。
  // 既存3ファイル（wide/long/codebook）は凍結契約のため触らず新ファイルで提供。
  // ------------------------------------------------------------------

  async rawdataCsv(projectId: string, options: RawdataExportOptions = {}): Promise<string> {
    const { respondents, variables, questions } = await loadExportData(projectId, { ...options, forRawdata: true });
    const assignments = assignQNumbers(variables, questions, { includeProbe: options.includeProbe });
    return toCsvRfc4180(
      buildRawdataRows(assignments, respondents, {
        mode: options.mode,
        statuses: options.statuses,
        includeProbe: options.includeProbe,
        excludeTest: options.excludeTest,
        includePii: options.includePii
      })
    );
  },

  async rawdataLayoutCsv(projectId: string, options: RawdataExportOptions = {}): Promise<string> {
    const questions = await questionRepository.listByProject(projectId);
    const [variables, active, ranks] = await Promise.all([
      snapshotService.resolveCodebook(projectId, questions),
      snapshotService.getActive(projectId),
      rankRepository.list()
    ]);
    const assignments = assignQNumbers(variables, questions, { includeProbe: options.includeProbe });
    return toCsvRfc4180(
      buildRawdataLayoutRows(assignments, {
        includePii: options.includePii,
        questionVersion: active?.version ?? null,
        ranks: ranks.map((rank) => ({ rank_code: rank.rank_code, rank_name: rank.rank_name }))
      })
    );
  },

  /** 出力画面の件数パネル用。フィルタ前（全ステータス・テスト別掲）の件数を返す。 */
  async statusCounts(projectId: string): Promise<StatusCount[]> {
    const { respondents } = await loadExportData(projectId, {});
    return buildStatusCounts(respondents);
  },

  /**
   * 設問一覧/編集画面用: question_id → ロウデータ列の対応。
   * 採番はエクスポート本体と同じ assignQNumbers を使うため画面とCSVで食い違わない。
   * snapshotConfirmed=false の間は q番号が設問の追加・並べ替えで変わりうる（暫定）。
   */
  async rawdataColumnIndex(projectId: string): Promise<{
    byQuestionId: Record<string, RawdataColumnInfo>;
    snapshotConfirmed: boolean;
  }> {
    const questions = await questionRepository.listByProject(projectId);
    const [variables, active] = await Promise.all([
      snapshotService.resolveCodebook(projectId, questions),
      snapshotService.getActive(projectId)
    ]);
    const assignments = assignQNumbers(variables, questions);
    return {
      byQuestionId: Object.fromEntries(buildRawdataColumnIndex(assignments)),
      snapshotConfirmed: Boolean(active)
    };
  }
};
