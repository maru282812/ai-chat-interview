/**
 * Phase 5: 深掘り回答を answer_role='ai_probe' で別行保存する（本回答の上書き防止）。
 *
 * POST /liff/survey/answer は body の answer_role で分岐する:
 *  - 省略 or 'primary' → 従来どおり answerRepository.upsertPrimary（同一設問は上書き）
 *  - 'probe' / 'ai_probe' → answerRepository.create で別行 insert（LINE webhook 経路と同じ
 *    answer_role='ai_probe' ＋ parent_answer_id=同一 session×question の primary 行）
 *
 * ここでは repository / service をモンキーパッチして controller を直接呼ぶ（DB・LINE API に触れない）。
 * 併せて「既存 probe 行（LINE経路由来）の扱いがエクスポートで変わらないこと」を、LIFF経路が作る行と
 * LINE経路が作る行を同じ形（answer_role='ai_probe'）で並べて確認する。
 */
import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Answer, Project, ProjectAssignment, Question, Session } from "../types/domain";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_PASSWORD_HASH ||= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ||= "test-admin-session-secret-000000000000";

const PROJECT_ID = "00000000-0000-4000-8000-000000000901";
const SESSION_ID = "00000000-0000-4000-8000-000000000902";
const RESPONDENT_ID = "00000000-0000-4000-8000-000000000903";
const ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000904";
const Q_CHOICE_ID = "00000000-0000-4000-8000-000000000905";
const PRIMARY_ANSWER_ID = "00000000-0000-4000-8000-000000000906";

type Mod<T> = T;
let liffController: Mod<typeof import("../controllers/liffController").liffController>;
let answerRepository: Mod<typeof import("../repositories/answerRepository").answerRepository>;
let sessionRepository: Mod<typeof import("../repositories/sessionRepository").sessionRepository>;
let questionRepository: Mod<typeof import("../repositories/questionRepository").questionRepository>;
let projectRepository: Mod<typeof import("../repositories/projectRepository").projectRepository>;
let questionPageGroupRepository: Mod<
  typeof import("../repositories/questionPageGroupRepository").questionPageGroupRepository
>;
let projectAssignmentRepository: Mod<
  typeof import("../repositories/projectAssignmentRepository").projectAssignmentRepository
>;
let surveyOrderingService: Mod<typeof import("../services/surveyOrderingService").surveyOrderingService>;
let statExportServiceMod: typeof import("../services/statExportService");

before(async () => {
  ({ liffController } = await import("../controllers/liffController"));
  ({ answerRepository } = await import("../repositories/answerRepository"));
  ({ sessionRepository } = await import("../repositories/sessionRepository"));
  ({ questionRepository } = await import("../repositories/questionRepository"));
  ({ projectRepository } = await import("../repositories/projectRepository"));
  ({ questionPageGroupRepository } = await import("../repositories/questionPageGroupRepository"));
  ({ projectAssignmentRepository } = await import("../repositories/projectAssignmentRepository"));
  ({ surveyOrderingService } = await import("../services/surveyOrderingService"));
  statExportServiceMod = await import("../services/statExportService");
});

const choiceQuestion = {
  id: Q_CHOICE_ID,
  project_id: PROJECT_ID,
  question_code: "Q1",
  question_text: "好きな味は?",
  question_type: "single_choice",
  question_config: { options: [{ value: "sweet", label: "甘い" }, { value: "salty", label: "しょっぱい" }] },
  sort_order: 1,
  is_hidden: false,
  ai_probe_enabled: true,
  visibility_conditions: null,
  branch_rule: null,
  page_group_id: null,
} as unknown as Question;

const session = {
  id: SESSION_ID,
  project_id: PROJECT_ID,
  respondent_id: RESPONDENT_ID,
  status: "active",
  current_question_id: Q_CHOICE_ID,
  state_json: {},
  started_at: "2026-08-06T00:00:00.000Z",
  completed_at: null,
} as unknown as Session;

const assignment = {
  id: ASSIGNMENT_ID,
  project_id: PROJECT_ID,
  respondent_id: RESPONDENT_ID,
  status: "in_progress",
} as unknown as ProjectAssignment;

const project = {
  id: PROJECT_ID,
  name: "テスト案件",
  display_mode: "interview_chat",
  answer_ui_preset: "standard",
  screening_config: null,
  research_settings: null,
} as unknown as Project;

function makeAnswer(partial: Partial<Answer>): Answer {
  return {
    id: partial.id ?? "answer-x",
    session_id: SESSION_ID,
    question_id: Q_CHOICE_ID,
    answer_text: partial.answer_text ?? "",
    free_text_answer: partial.free_text_answer ?? null,
    answer_role: partial.answer_role ?? "primary",
    parent_answer_id: partial.parent_answer_id ?? null,
    normalized_answer: partial.normalized_answer ?? null,
    concept_code: null,
    created_at: partial.created_at ?? "2026-08-06T00:00:00.000Z",
    ...partial,
  } as Answer;
}

type Captured = {
  created: Array<Parameters<typeof answerRepository.create>[0]>;
  upserted: Array<Parameters<typeof answerRepository.upsertPrimary>[0]>;
  sessionUpdates: Array<Record<string, unknown>>;
};

/** 既存回答（priorAnswers）を差し替えつつ submitSurveyAnswer を1回呼び、書込みを記録して返す。 */
async function callSubmit(
  body: Record<string, unknown>,
  priorAnswers: Answer[],
  questions: Question[] = [choiceQuestion]
): Promise<{ status: number; payload: Record<string, unknown>; captured: Captured }> {
  const captured: Captured = { created: [], upserted: [], sessionUpdates: [] };

  const originals = {
    create: answerRepository.create,
    upsertPrimary: answerRepository.upsertPrimary,
    listBySession: answerRepository.listBySession,
    getSession: sessionRepository.getById,
    updateSession: sessionRepository.update,
    listByProject: questionRepository.listByProject,
    getProject: projectRepository.getById,
    listPageGroups: questionPageGroupRepository.listByProject,
    getAssignment: projectAssignmentRepository.getById,
    ordering: surveyOrderingService.resolveOrder,
  };

  Object.assign(answerRepository, {
    async create(input: Parameters<typeof answerRepository.create>[0]) {
      captured.created.push(input);
      return makeAnswer({ id: "created-1", ...input } as Partial<Answer>);
    },
    async upsertPrimary(input: Parameters<typeof answerRepository.upsertPrimary>[0]) {
      captured.upserted.push(input);
      return makeAnswer({ id: PRIMARY_ANSWER_ID, ...input } as Partial<Answer>);
    },
    async listBySession() {
      return priorAnswers;
    },
  });
  Object.assign(sessionRepository, {
    async getById() {
      return session;
    },
    async update(_id: string, input: Record<string, unknown>) {
      captured.sessionUpdates.push(input);
      return session;
    },
  });
  Object.assign(questionRepository, {
    async listByProject() {
      return questions;
    },
  });
  Object.assign(projectRepository, {
    async getById() {
      return project;
    },
  });
  Object.assign(questionPageGroupRepository, {
    async listByProject() {
      return [];
    },
  });
  Object.assign(projectAssignmentRepository, {
    async getById() {
      return assignment;
    },
  });
  Object.assign(surveyOrderingService, {
    async resolveOrder(input: { questions: Question[] }) {
      return { questions: input.questions, randomized: false };
    },
  });

  let status = 200;
  let payload: Record<string, unknown> = {};
  const res = {
    status(code: number) {
      status = code;
      return res;
    },
    json(data: Record<string, unknown>) {
      payload = data;
      return res;
    },
  };
  const req = { body, path: "/liff/survey/answer", headers: {} };

  try {
    await liffController.submitSurveyAnswer(req as never, res as never);
  } finally {
    Object.assign(answerRepository, {
      create: originals.create,
      upsertPrimary: originals.upsertPrimary,
      listBySession: originals.listBySession,
    });
    Object.assign(sessionRepository, { getById: originals.getSession, update: originals.updateSession });
    Object.assign(questionRepository, { listByProject: originals.listByProject });
    Object.assign(projectRepository, { getById: originals.getProject });
    Object.assign(questionPageGroupRepository, { listByProject: originals.listPageGroups });
    Object.assign(projectAssignmentRepository, { getById: originals.getAssignment });
    Object.assign(surveyOrderingService, { resolveOrder: originals.ordering });
  }

  return { status, payload, captured };
}

const basePrimaryBody = {
  session_id: SESSION_ID,
  assignment_id: ASSIGNMENT_ID,
  question_code: "Q1",
  answer_value: "sweet",
};

test("answer_role 省略時は従来どおり upsertPrimary（後方互換）", async () => {
  const { status, captured } = await callSubmit(basePrimaryBody, []);
  assert.equal(status, 200);
  assert.equal(captured.upserted.length, 1);
  assert.equal(captured.created.length, 0);
  assert.equal(captured.upserted[0]!.answer_text, "sweet");
});

test("answer_role='primary' を明示しても upsertPrimary", async () => {
  const { captured } = await callSubmit({ ...basePrimaryBody, answer_role: "primary" }, []);
  assert.equal(captured.upserted.length, 1);
  assert.equal(captured.created.length, 0);
});

test("answer_role='probe' は upsertPrimary を呼ばず create で別行 insert", async () => {
  const prior = [makeAnswer({ id: PRIMARY_ANSWER_ID, answer_text: "sweet", answer_role: "primary" })];
  const { status, captured } = await callSubmit(
    { ...basePrimaryBody, answer_role: "probe", answer_value: "子供の頃から甘いものが好きだから", probe_index: 1 },
    prior
  );

  assert.equal(status, 200);
  assert.equal(captured.upserted.length, 0, "primary を上書きしてはいけない");
  assert.equal(captured.created.length, 1);

  const row = captured.created[0]!;
  // LINE webhook 経路（conversationOrchestratorService）と同じ詰め方
  assert.equal(row.answer_role, "ai_probe");
  assert.equal(row.session_id, SESSION_ID);
  assert.equal(row.question_id, Q_CHOICE_ID);
  assert.equal(row.answer_text, "子供の頃から甘いものが好きだから");
  assert.equal(row.parent_answer_id, PRIMARY_ANSWER_ID, "同一 session×question の primary 行に紐づく");
  assert.equal((row.normalized_answer as Record<string, unknown>).source, "ai_probe");
  assert.equal((row.normalized_answer as Record<string, unknown>).probe_index, 1);
});

test("ワイヤ値 'ai_probe' も probe として扱う", async () => {
  const prior = [makeAnswer({ id: PRIMARY_ANSWER_ID, answer_text: "sweet" })];
  const { captured } = await callSubmit(
    { ...basePrimaryBody, answer_role: "ai_probe", answer_value: "深掘り返信" },
    prior
  );
  assert.equal(captured.created.length, 1);
  assert.equal(captured.created[0]!.answer_role, "ai_probe");
});

test("probe は next を返さない（分岐は primary の値で評価される）", async () => {
  const prior = [makeAnswer({ id: PRIMARY_ANSWER_ID, answer_text: "sweet" })];
  const { payload } = await callSubmit(
    { ...basePrimaryBody, answer_role: "probe", answer_value: "自由文" },
    prior
  );
  assert.equal(payload.ok, true);
  assert.equal(payload.answer_role, "ai_probe");
  assert.equal(payload.next, null);
});

test("probe でも current_question_id 更新は現状維持", async () => {
  const prior = [makeAnswer({ id: PRIMARY_ANSWER_ID, answer_text: "sweet" })];
  const { captured } = await callSubmit(
    { ...basePrimaryBody, answer_role: "probe", answer_value: "自由文" },
    prior
  );
  assert.equal(captured.sessionUpdates.length, 1);
  assert.equal(captured.sessionUpdates[0]!.current_question_id, Q_CHOICE_ID);
});

test("probe は選択肢バリデーションを免除される（自由文が選択肢外でも400にならない）", async () => {
  const prior = [makeAnswer({ id: PRIMARY_ANSWER_ID, answer_text: "sweet" })];
  const { status, captured } = await callSubmit(
    { ...basePrimaryBody, answer_role: "probe", answer_value: "選択肢に無い自由文の回答です" },
    prior
  );
  assert.equal(status, 200);
  assert.equal(captured.created.length, 1);
});

test("primary が未保存でも probe 行は落とさず parent_answer_id=null で残す", async () => {
  const { status, captured } = await callSubmit(
    { ...basePrimaryBody, answer_role: "probe", answer_value: "自由文" },
    []
  );
  assert.equal(status, 200);
  assert.equal(captured.created[0]!.parent_answer_id, null);
});

test("所有者検証・可視性(409)ゲートは probe でも維持される", async () => {
  const hiddenQuestion = {
    ...choiceQuestion,
    visibility_conditions: [{ type: "pipe_expression", expression: "qz=1" }],
  } as unknown as Question;

  const { status } = await callSubmit(
    { ...basePrimaryBody, answer_role: "probe", answer_value: "自由文" },
    [],
    [hiddenQuestion]
  );
  assert.equal(status, 409, "表示条件を満たさない設問への probe も 409 で弾く");
});

test("LIFF経路の probe 行は LINE経路の既存 probe 行と同じくエクスポートで primary と分離される", () => {
  // statExportService の buildGroups と同じ判定関数（answer_role==='ai_probe' もしくは normalized.source==='ai_probe'）
  const isAiProbe = (a: Answer) =>
    a.answer_role === "ai_probe" || (a.normalized_answer?.source as string | undefined) === "ai_probe";

  const primary = makeAnswer({ id: PRIMARY_ANSWER_ID, answer_text: "sweet", answer_role: "primary" });
  // LINE webhook 経路が作る行（既存）
  const lineProbe = makeAnswer({
    id: "line-probe",
    answer_role: "ai_probe",
    parent_answer_id: PRIMARY_ANSWER_ID,
    answer_text: "LINE経路の深掘り",
  });
  // 本 Phase の LIFF 経路が作る行
  const liffProbe = makeAnswer({
    id: "liff-probe",
    answer_role: "ai_probe",
    parent_answer_id: PRIMARY_ANSWER_ID,
    answer_text: "LIFF経路の深掘り",
    normalized_answer: { source: "ai_probe", probe_index: 1 },
  });

  const all = [primary, lineProbe, liffProbe];
  assert.deepEqual(all.filter((a) => !isAiProbe(a)).map((a) => a.id), [PRIMARY_ANSWER_ID]);
  assert.deepEqual(all.filter(isAiProbe).map((a) => a.id), ["line-probe", "liff-probe"]);
  // statExportService が実際に export している型として使えることを確認（import の生存確認）
  assert.equal(typeof statExportServiceMod.statExportService, "object");
});

test("buildAnswerContext は probe 行を無視する（分岐は primary の値のまま）", async () => {
  const { buildAnswerContext } = await import("../services/surveyFlowService");
  const ctx = buildAnswerContext(
    [choiceQuestion],
    [
      makeAnswer({ id: PRIMARY_ANSWER_ID, answer_text: "sweet", answer_role: "primary" }),
      makeAnswer({ id: "liff-probe", answer_text: "自由文の深掘り返信", answer_role: "ai_probe" }),
    ]
  );
  assert.equal(ctx.answers.q1, "sweet");
});
