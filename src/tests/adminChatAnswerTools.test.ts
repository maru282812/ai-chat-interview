/**
 * adminChatAnswerTools.test.ts
 *
 * 管理画面AIチャット Phase 2（docs/impl-admin-ai-chat.md）の回答分析ツールを検証する。
 * 重点は「数字が静かに嘘にならないか」——総数は DB 側 count、集計母数は読んだ件数、
 * 打ち切ったときは note で明示する、の3点。repository はスタブして実DBに触らない。
 */

import assert from "node:assert/strict";
import { afterEach, before, beforeEach, test } from "node:test";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_BASIC_USER ||= "admin";
process.env.ADMIN_BASIC_PASSWORD ||= "password";

let registry: typeof import("../services/adminChat/toolRegistry");
let registerAnswerTools: typeof import("../services/adminChat/tools/answerTools").registerAnswerTools;
let answerRepository: typeof import("../repositories/answerRepository").answerRepository;
let questionRepository: typeof import("../repositories/questionRepository").questionRepository;
let researchOpsService: typeof import("../services/researchOpsService").researchOpsService;

const originals: Array<() => void> = [];

function stub<T extends object, K extends keyof T>(obj: T, key: K, fn: T[K]): void {
  const original = obj[key];
  obj[key] = fn;
  originals.push(() => {
    obj[key] = original;
  });
}

function questionFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: "q1",
    question_code: "Q1",
    question_text: "満足度を教えてください",
    question_type: "single_choice",
    question_config: { options: [{ value: "a", label: "満足" }, { value: "b", label: "不満" }] },
    ...overrides,
  } as never;
}

async function runTool(name: string, args: Record<string, unknown>, entityId: string | null = null) {
  const tool = registry.getTool(name);
  assert.ok(tool, `${name} が登録されていること`);
  return tool.execute(args, { entityId, screenKey: "sessions-index" });
}

before(async () => {
  registry = await import("../services/adminChat/toolRegistry");
  ({ registerAnswerTools } = await import("../services/adminChat/tools/answerTools"));
  ({ answerRepository } = await import("../repositories/answerRepository"));
  ({ questionRepository } = await import("../repositories/questionRepository"));
  ({ researchOpsService } = await import("../services/researchOpsService"));
});

beforeEach(() => {
  registry.__resetRegistryForTest();
  registerAnswerTools();
});

afterEach(() => {
  while (originals.length > 0) {
    originals.pop()?.();
  }
});

test("5本のツールがすべて Tier A で登録される", () => {
  const tools = registry.toolsForScreen("sessions-index");
  assert.deepEqual(
    tools.map((t) => t.name).sort(),
    [
      "aggregate_answers",
      "get_project_overview",
      "get_respondent_detail",
      "get_session_detail",
      "list_sessions",
    ]
  );
  for (const tool of tools) {
    assert.equal(tool.tier, "A", `${tool.name} は読み取り専用であるべき`);
  }
});

test("list_sessions の limit は50に丸められる", async () => {
  let passedLimit: number | null = null;
  stub(researchOpsService, "listRespondentOverviewsPaged", async (params) => {
    passedLimit = params.limit;
    return { items: [], total: 0, offset: 0 };
  });

  await runTool("list_sessions", { limit: 500 });
  assert.equal(passedLimit, 50);
});

test("list_sessions は続きがある場合に note を返す", async () => {
  stub(researchOpsService, "listRespondentOverviewsPaged", async () => ({
    items: [],
    total: 120,
    offset: 0,
  }));

  const result = (await runTool("list_sessions", {})) as {
    total_respondents: number;
    note: string | null;
  };
  assert.equal(result.total_respondents, 120);
  assert.match(String(result.note), /続きがあります/);
  // 「回答者502人」を「セッション502件」と言い換えられた実測があるため、単位を明示する
  assert.match(String(result.note), /回答者の人数/);
});

test("aggregate_answers: 選択式は件数と割合を返す", async () => {
  stub(questionRepository, "getById", async () => questionFixture());
  stub(answerRepository, "sampleForAggregate", async () => ({
    total: 4,
    rows: [
      { answer_text: "満足", free_text_answer: null },
      { answer_text: "満足", free_text_answer: null },
      { answer_text: "不満", free_text_answer: null },
      { answer_text: "満足", free_text_answer: null },
    ],
  }));

  const result = (await runTool("aggregate_answers", { question_id: "q1" })) as {
    total_answers: number;
    sampled: number;
    note: string | null;
    breakdown: Array<{ label: string; count: number; percent: number }>;
  };

  assert.equal(result.total_answers, 4);
  assert.equal(result.sampled, 4);
  assert.equal(result.note, null, "打ち切っていないので note は出ない");
  assert.deepEqual(result.breakdown[0], { label: "満足", count: 3, percent: 75 });
});

test("aggregate_answers: 打ち切った場合は total と母数の違いを note で明示する", async () => {
  stub(questionRepository, "getById", async () => questionFixture());
  stub(answerRepository, "sampleForAggregate", async () => ({
    total: 5000,
    rows: [{ answer_text: "満足", free_text_answer: null }],
  }));

  const result = (await runTool("aggregate_answers", { question_id: "q1" })) as {
    total_answers: number;
    sampled: number;
    note: string | null;
  };

  assert.equal(result.total_answers, 5000);
  assert.equal(result.sampled, 1);
  assert.match(String(result.note), /母数が異なります/);
});

test("aggregate_answers: 複数選択は区切って数え、合計が100%を超えうると明示する", async () => {
  stub(questionRepository, "getById", async () =>
    questionFixture({ question_type: "multi_choice" })
  );
  stub(answerRepository, "sampleForAggregate", async () => ({
    total: 2,
    rows: [
      { answer_text: "A, B", free_text_answer: null },
      { answer_text: "B、C", free_text_answer: null },
    ],
  }));

  const result = (await runTool("aggregate_answers", { question_id: "q1" })) as {
    percent_base: string;
    breakdown: Array<{ label: string; count: number }>;
  };

  const counts = Object.fromEntries(result.breakdown.map((b) => [b.label, b.count]));
  assert.deepEqual(counts, { A: 1, B: 2, C: 1 });
  assert.match(result.percent_base, /100%を超える/);
});

test("aggregate_answers: 数値設問は平均・最小・最大を返す", async () => {
  stub(questionRepository, "getById", async () => questionFixture({ question_type: "numeric" }));
  stub(answerRepository, "sampleForAggregate", async () => ({
    total: 3,
    rows: [
      { answer_text: "10", free_text_answer: null },
      { answer_text: "20", free_text_answer: null },
      { answer_text: "あいうえお", free_text_answer: null },
    ],
  }));

  const result = (await runTool("aggregate_answers", { question_id: "q1" })) as {
    numeric: { count: number; average: number; min: number; max: number };
  };

  assert.deepEqual(result.numeric, { count: 2, average: 15, min: 10, max: 20 });
});

test("aggregate_answers: 自由記述はサンプルを上限付きで返す", async () => {
  stub(questionRepository, "getById", async () =>
    questionFixture({ question_type: "free_text_long" })
  );
  stub(answerRepository, "sampleForAggregate", async () => ({
    total: 100,
    rows: Array.from({ length: 100 }, (_, i) => ({
      answer_text: `回答${i}`.padEnd(300, "あ"),
      free_text_answer: null,
    })),
  }));

  const result = (await runTool("aggregate_answers", { question_id: "q1" })) as {
    samples: string[];
  };

  assert.equal(result.samples.length, 30, "サンプルは30件まで");
  assert.ok((result.samples[0] ?? "").length <= 201, "各サンプルは200字＋省略記号まで");
});

test("aggregate_answers: question_id 未指定はエラーになる", async () => {
  await assert.rejects(() => runTool("aggregate_answers", {}), /question_id が必要/);
});

test("get_session_detail: 引数省略時は画面の対象IDを使う", async () => {
  let passedId: string | null = null;
  stub(researchOpsService, "getSessionDetail", (async (sessionId: string) => {
    passedId = sessionId;
    return {
      session: { id: sessionId, status: "completed", started_at: "", completed_at: null },
      respondent: { id: "r1", display_name: "テスト" },
      project: { id: "p1", name: "案件" },
      answerGroups: [],
      messages: [],
      analysis: null,
    };
  }) as unknown as typeof researchOpsService.getSessionDetail);

  await runTool("get_session_detail", {}, "session-from-screen");
  assert.equal(passedId, "session-from-screen");
});

test("get_session_detail: 引数も画面IDも無ければ、次の手を示すエラーになる", async () => {
  await assert.rejects(
    () => runTool("get_session_detail", {}, null),
    /session_id が指定されておらず.*list_sessions/s,
    "モデルが諦めないよう復旧手段を含める"
  );
});
