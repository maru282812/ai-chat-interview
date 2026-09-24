/**
 * questionNumericRange — numeric 設問の min/max がフォーム往復で失われないことの回帰テスト。
 *
 * 事故の内容（2026-09-14）:
 *   管理画面のライブプレビューは「保存時と同じ変換を通す」ため、編集フォームを丸ごと POST して
 *   buildQuestionConfigFromRequest に通す。ところが
 *     1. normalizeQuestionConfig が min/max を MANAGED_CONFIG_KEYS として一旦落とす
 *     2. 入れ直す switch に numeric の case が無い
 *     3. 常時 hidden な「スケール設定（未使用）」ブロックが scale_min=1 / scale_max=5 を POST する
 *   の3点が重なり、年齢設問(min10/max100=91件)がプレビューでだけ 1〜5 に化けていた。
 *   選択肢が 12件を超えるかどうかで number_wheel(ドラム) と legacy(丸ボタン) が分かれるため、
 *   実機はドラム・プレビューは丸ボタン1〜5、という食い違いになる。
 *
 * ここでは「設定値が保存されるか」ではなく、最終的に**同じ表示パターンに解決されるか**まで見る。
 * 純関数の単体確認だけだと「その関数を呼ぶのをやめた」形の再発を検出できないため。
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request } from "express";
import type { Question } from "../types/domain";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_PASSWORD_HASH ||= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ||= "test-admin-session-secret-000000000000";

import { buildQuestionConfigFromRequest } from "../controllers/adminController";
import { resolveAnswerPresentation } from "../lib/answerPresentation";

/** 本番 A-Q3「あなたの年齢を教えてください」と同じ設定。 */
const AGE_CONFIG = { min: 10, max: 100 } as unknown as Question["question_config"];
const AGE_TEXT = "あなたの年齢を教えてください";

/**
 * 編集フォームの POST body を模す。
 *
 * scale_min / scale_max を既定で含めているのは事故の再現条件そのものだから。
 * あの入力は hidden でも送られてくる（今は disabled にしたが、サーバー側だけでも守れていること
 * をここで担保する＝防御は二重に置く）。
 */
function formBody(overrides: Record<string, unknown> = {}): Request {
  return {
    body: {
      question_goal: "年齢を把握する",
      scale_min: "1",
      scale_max: "5",
      scale_min_label: "",
      scale_max_label: "",
      ...overrides,
    },
  } as unknown as Request;
}

function patternOf(config: Question["question_config"]): string {
  return resolveAnswerPresentation(
    { question_type: "numeric", question_text: AGE_TEXT, question_config: config },
    "casual",
  ).pattern;
}

// ── 1. 事故の本体：往復して min/max が残ること ────────────────────────────

test("N1: numeric の min/max はフォーム往復後も保存済みの値のまま", () => {
  const result = buildQuestionConfigFromRequest(formBody(), "numeric", AGE_CONFIG);

  assert.equal(result?.min, 10, "min が失われている（normalize が落とした値を復元できていない）");
  assert.equal(result?.max, 100, "max が失われている");
});

test("N2: 常時 hidden の scale_min/scale_max は numeric に流用されない", () => {
  // 1/5 以外の値を送っても無視されること＝あの入力を読んでいないことを明示する。
  const result = buildQuestionConfigFromRequest(
    formBody({ scale_min: "3", scale_max: "7" }),
    "numeric",
    AGE_CONFIG,
  );

  assert.equal(result?.min, 10, "scale_min を numeric の min に流用してはいけない");
  assert.equal(result?.max, 100, "scale_max を numeric の max に流用してはいけない");
});

// ── 2. 表示パターンまで一致すること（ユーザーから見た症状そのもの） ──────────

test("N3: 往復後もドラム(number_wheel)のまま＝プレビューと実機が一致する", () => {
  const live = buildQuestionConfigFromRequest(formBody(), "numeric", AGE_CONFIG);

  assert.equal(patternOf(AGE_CONFIG), "number_wheel", "実機(DB設定)はドラムであるべき");
  assert.equal(
    patternOf(live),
    "number_wheel",
    "プレビュー(往復後)もドラムであるべき。legacy なら 1〜5 の丸ボタンに化けている",
  );
  assert.equal(patternOf(live), patternOf(AGE_CONFIG), "プレビューと実機の表示パターンは一致すること");
});

// ── 3. 周辺が巻き込まれていないこと ───────────────────────────────────────

test("N4: min/max を持たない numeric は往復で勝手に 1〜5 を生やさない", () => {
  const result = buildQuestionConfigFromRequest(
    formBody(),
    "numeric",
    { placeholder: "半角数字" } as unknown as Question["question_config"],
  );

  assert.equal(result?.min, undefined, "未設定の min に既定値を注入してはいけない");
  assert.equal(result?.max, undefined, "未設定の max に既定値を注入してはいけない");
});

test("N5: scale 型は従来どおり scale_min/scale_max を読む（numeric の修正で壊さない）", () => {
  const result = buildQuestionConfigFromRequest(
    formBody({ scale_min: "0", scale_max: "10" }),
    "scale",
    AGE_CONFIG,
  );

  assert.equal(result?.min, 0, "scale 型はフォームの入力を反映すること");
  assert.equal(result?.max, 10);
});

test("N6: numeric の min/max ラベルも保存済みの値が残る", () => {
  const withLabels = {
    min: 10,
    max: 100,
    min_label: "若い",
    max_label: "高齢",
  } as unknown as Question["question_config"];

  const result = buildQuestionConfigFromRequest(formBody(), "numeric", withLabels);

  assert.equal(result?.min_label, "若い");
  assert.equal(result?.max_label, "高齢");
});
