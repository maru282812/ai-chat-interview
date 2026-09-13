/**
 * copyProjectDisplayControl.test.ts
 *
 * 案件複製で「表示制御」項目が落ちないことの回帰テスト。
 *
 * 背景（実機で発覚）:
 *   店舗アンケート A-Q10「今日、特に重視していることは？」は、A-Q9 で選んだ選択肢だけを
 *   出す carry-forward 設定（display_tags_parsed.optionSource）を持つ。にもかかわらず
 *   本番の店舗アンケートでは全選択肢が出ていた。
 *
 *   原因は copyProject が question を作り直すときのフィールド列挙漏れ。
 *   question_config と branch_rule は写すのに display_tags_parsed を写していなかったため、
 *   複製された時点で carry-forward / <disable> の設定が消えていた。
 *   店舗展開(storeProvisioningService)は copyProject を通るので、
 *   テンプレート原本は正しいのに全店舗の複製だけが壊れるという形で出ていた。
 *
 * ここでは questionRepository.create に渡るペイロードを直接見る。
 * 「複製先の設問に何が書き込まれるか」が守りたい契約そのもののため。
 */

import assert from "node:assert/strict";
import { before, beforeEach, test } from "node:test";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_PASSWORD_HASH ||= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ||= "test-admin-session-secret-000000000000";

const SRC_PROJECT_ID = "00000000-0000-4000-8000-0000000000f1";
const COPIED_PROJECT_ID = "00000000-0000-4000-8000-0000000000f2";

let projectRepository: typeof import("../repositories/projectRepository").projectRepository;
let questionRepository: typeof import("../repositories/questionRepository").questionRepository;

/** questionRepository.create に渡されたペイロードを記録する */
let created: Record<string, unknown>[];

/** A-Q10 相当: carry-forward つきの設問。 */
const carryQuestion = {
  id: "q-10",
  project_id: SRC_PROJECT_ID,
  question_code: "Q10",
  question_text: "今日、特に重視していることは何ですか？（ひとつだけ）",
  question_role: "main",
  question_type: "single_choice",
  is_required: true,
  sort_order: 10,
  branch_rule: null,
  question_config: { options: [{ value: "finish", label: "仕上がり" }] },
  ai_probe_enabled: false,
  is_system: false,
  is_hidden: false,
  comment_top: "前の設問で選んだものだけ出ます",
  comment_bottom: null,
  display_tags_raw: "<carry q9>",
  display_tags_parsed: { optionSource: { fromQuestion: "q9", mode: "selected" } },
  visibility_conditions: [{ type: "pipe_expression", expression: "q4!=first" }],
  // 複製先の page_groups を指していない ID。持ち越してはいけない。
  page_group_id: "00000000-0000-4000-8000-0000000000g1".replace(/g/g, "e")
};

before(async () => {
  ({ projectRepository } = await import("../repositories/projectRepository"));
  ({ questionRepository } = await import("../repositories/questionRepository"));
});

beforeEach(() => {
  created = [];

  projectRepository.getById = (async (id: string) => ({
    id,
    name: "美容室ABC A",
    status: "published"
  })) as unknown as typeof projectRepository.getById;

  projectRepository.create = (async () => ({
    id: COPIED_PROJECT_ID,
    name: "美容室ABC A (Copy)",
    status: "draft"
  })) as unknown as typeof projectRepository.create;

  projectRepository.update = (async (id: string) => ({
    id,
    name: "美容室ABC A (Copy)",
    status: "draft"
  })) as unknown as typeof projectRepository.update;

  questionRepository.listByProject = (async () => [
    carryQuestion
  ]) as unknown as typeof questionRepository.listByProject;

  questionRepository.getSystemFreeCommentQuestion = (async () =>
    null) as unknown as typeof questionRepository.getSystemFreeCommentQuestion;

  questionRepository.create = (async (input: Record<string, unknown>) => {
    created.push(input);
    return { id: "new-q", ...input };
  }) as unknown as typeof questionRepository.create;
});

test("複製先の設問に display_tags_parsed（carry-forward）がそのまま載る", async () => {
  await projectRepository.copyProject(SRC_PROJECT_ID);

  assert.equal(created.length, 1, "設問が1件複製されること");
  const copied = created[0] as Record<string, unknown>;

  assert.deepEqual(
    copied.display_tags_parsed,
    { optionSource: { fromQuestion: "q9", mode: "selected" } },
    "carry-forward 設定が複製先に引き継がれること（落ちると全選択肢が出てしまう）"
  );
});

test("表示条件・コメント・生タグも引き継ぐ", async () => {
  await projectRepository.copyProject(SRC_PROJECT_ID);
  const copied = created[0] as Record<string, unknown>;

  assert.deepEqual(copied.visibility_conditions, [
    { type: "pipe_expression", expression: "q4!=first" }
  ]);
  assert.equal(copied.comment_top, "前の設問で選んだものだけ出ます");
  assert.equal(copied.comment_bottom, null);
  assert.equal(copied.display_tags_raw, "<carry q9>");
});

test("page_group_id は引き継がない（複製元のブロックを指すため）", async () => {
  await projectRepository.copyProject(SRC_PROJECT_ID);
  const copied = created[0] as Record<string, unknown>;

  assert.equal(
    copied.page_group_id,
    undefined,
    "複製元の page_groups を指す ID を持ち越すと別案件のブロックを参照してしまう"
  );
});
