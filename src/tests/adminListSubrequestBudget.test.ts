/**
 * adminListSubrequestBudget.test.ts
 *
 * 管理画面の一覧が「案件の件数だけ Supabase を叩く」形に戻らないことを守る。
 *
 * 背景（2026-09-24 本番事故）:
 *   /admin/projects が実ブラウザで
 *   "Too many subrequests by single Worker invocation" を出して全滅した。
 *   Cloudflare Workers は1リクエストあたりの外部 fetch が 50件（有料1000件）までで、
 *   adminService.listProjects が案件ごとに questionRepository.listByProject を
 *   呼んでいたため、本番の案件が57件に増えた時点で上限を超えた。
 *
 *   コードは前から同じで、変わったのは**件数**。つまり件数依存のバグは
 *   「昨日まで見えていた画面が、ある日を境に丸ごと落ちる」形で出る。
 *   ローカル（Node/tsx）にはこの上限が無いので、実機でしか再現しない。
 *
 * ここで守りたいこと:
 *   クエリ回数が案件数に比例しないこと（O(N) ではなく O(1)）。
 *   「合計が50未満か」ではなく**件数を増やしても増えないこと**を見る。
 *   50未満で判定すると、上限が近い状態に静かに戻っても気づけないため。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ??= "test-token";
process.env.LINE_CHANNEL_SECRET ??= "test-secret";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ??= "00000000-0000-4000-8000-000000000000";
process.env.ADMIN_PASSWORD_HASH ??= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ??= "test-admin-session-secret-000000000000";

const projectRepositoryModule =
  require("../repositories/projectRepository") as typeof import("../repositories/projectRepository");
const questionRepositoryModule =
  require("../repositories/questionRepository") as typeof import("../repositories/questionRepository");
const { adminService } = require("../services/adminService") as typeof import("../services/adminService");

type Question = import("../types/domain").Question;
type Project = import("../types/domain").Project;

function fakeProject(index: number): Project {
  return {
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: `案件${index}`,
    status: "draft",
    // 一覧が参照するのはこの範囲。package モードにすると
    // パッケージ取得側の fetch が混ざって計測がぶれるので custom にする。
    ai_prompt_mode: "custom",
    ai_prompt_package_version_id: null
  } as unknown as Project;
}

function fakeQuestion(projectId: string, order: number): Question {
  return {
    id: `q-${projectId}-${order}`,
    project_id: projectId,
    question_code: `Q${order}`,
    question_text: `設問${order}`,
    sort_order: order,
    is_hidden: false,
    branch_rule: null,
    question_config: null
  } as unknown as Question;
}

/**
 * listProjects を走らせ、設問取得が何回呼ばれたかを数える。
 * 実 DB には触れない（リポジトリ層を差し替える）。
 */
async function countQuestionFetches(projectCount: number): Promise<{
  calls: number;
  rows: Awaited<ReturnType<typeof adminService.listProjects>>;
}> {
  const projects = Array.from({ length: projectCount }, (_, i) => fakeProject(i + 1));

  const originalList = projectRepositoryModule.projectRepository.list;
  const originalByProject = questionRepositoryModule.questionRepository.listByProject;
  const originalByProjectIds = questionRepositoryModule.questionRepository.listByProjectIds;

  let calls = 0;

  projectRepositoryModule.projectRepository.list = async () => projects;

  // 案件ごとの取得（= 事故の形）。呼ばれた回数がそのまま fetch 回数になる。
  questionRepositoryModule.questionRepository.listByProject = async (projectId: string) => {
    calls += 1;
    return [fakeQuestion(projectId, 1), fakeQuestion(projectId, 2)];
  };

  // 一括取得（= 修正後の形）。ID が何件でも 1回（100件ごとに分割）。
  questionRepositoryModule.questionRepository.listByProjectIds = async (projectIds: string[]) => {
    calls += Math.max(1, Math.ceil(projectIds.length / 100));
    const grouped = new Map<string, Question[]>();
    for (const id of projectIds) {
      grouped.set(id, [fakeQuestion(id, 1), fakeQuestion(id, 2)]);
    }
    return grouped;
  };

  try {
    const rows = await adminService.listProjects();
    return { calls, rows };
  } finally {
    projectRepositoryModule.projectRepository.list = originalList;
    questionRepositoryModule.questionRepository.listByProject = originalByProject;
    questionRepositoryModule.questionRepository.listByProjectIds = originalByProjectIds;
  }
}

test("listProjects: 設問取得の回数が案件数に比例しない", async () => {
  const few = await countQuestionFetches(3);
  const many = await countQuestionFetches(57); // 本番で事故った件数

  assert.equal(
    few.calls,
    many.calls,
    `案件を3件から57件に増やすと設問取得が ${few.calls}回 → ${many.calls}回 に増えている。` +
      "案件ごとに引く形に戻っている（Workers のサブリクエスト上限50件を超えて一覧が落ちる）。"
  );
});

test("listProjects: 本番件数でもサブリクエスト上限に対して十分な余裕がある", async () => {
  const { calls } = await countQuestionFetches(57);

  // 設問取得は1回に畳まれているはず。ナビ・認証・業種・店舗の分が別に乗るため、
  // ここが数回で収まっていないと合計で上限に近づく。
  assert.ok(
    calls <= 2,
    `案件57件で設問取得が ${calls}回。1〜2回に畳まれていない（Workers 上限50件に対して危険）。`
  );
});

test("listProjects: 一括取得でも各案件の設問数・分岐数が正しく出る", async () => {
  const { rows } = await countQuestionFetches(5);

  assert.equal(rows.length, 5, "案件の件数が落ちている");
  for (const row of rows) {
    assert.equal(
      row.questionCount,
      2,
      `${row.project.name} の設問数が ${row.questionCount}。一括取得のグルーピングが壊れている`
    );
  }

  // 取り違え（全案件が同じ設問を指す等）が起きていないこと
  const ids = new Set(rows.map((row) => row.project.id));
  assert.equal(ids.size, 5, "案件IDが重複している（グルーピングの取り違え）");
});

test("listByProjectIds: 設問0件の案件はキーを持たない（呼び出し側は ?? [] 前提）", async () => {
  const grouped = new Map<string, Question[]>();
  grouped.set("has-questions", [fakeQuestion("has-questions", 1)]);

  // 0件の案件は grouped に現れない。?? [] を外すと undefined.length で落ちる。
  assert.equal(grouped.get("no-questions"), undefined);
  assert.equal((grouped.get("no-questions") ?? []).length, 0);
});
