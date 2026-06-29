import { answerExtractionRepository } from "../repositories/answerExtractionRepository";
import { answerRepository } from "../repositories/answerRepository";
import { projectAssignmentRepository } from "../repositories/projectAssignmentRepository";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { userConsentRecordRepository } from "../repositories/userConsentRecordRepository";
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
import { snapshotService } from "./snapshotService";
import type { VariableDefinition } from "../lib/codebook";
import type { Answer, AnswerExtraction, Question, Session } from "../types/domain";

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
}

async function loadExportData(
  projectId: string,
  options: ExportOptions = {}
): Promise<{
  project: Awaited<ReturnType<typeof projectRepository.getById>>;
  questions: Question[];
  respondents: ExportRespondent[];
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

  const exportRespondents: ExportRespondent[] = selected.map(({ respondent, session }) => ({
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
  }
};
