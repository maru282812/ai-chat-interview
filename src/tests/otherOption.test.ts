import assert from "node:assert/strict";
import { test } from "node:test";
import { applyAutoFreeText, isOtherLabel } from "../lib/otherOption";
import { resolveQuestionView } from "../lib/questionEngine";
import type { QuestionOption } from "../types/domain";

const opt = (value: string, label = value): QuestionOption => ({ value, label });

// ------------------------------------------------------------------
// isOtherLabel
// ------------------------------------------------------------------

test("isOtherLabel: 「その他」で始まるラベルを拾う", () => {
  assert.equal(isOtherLabel("その他"), true);
  assert.equal(isOtherLabel("その他（）"), true);
  assert.equal(isOtherLabel("その他(具体的に)"), true);
  assert.equal(isOtherLabel("その他・自由記述"), true);
  // 先頭の空白（半角/全角）は許容する
  assert.equal(isOtherLabel(" その他"), true);
  assert.equal(isOtherLabel("　その他"), true);
});

test("isOtherLabel: 「その他」で始まらないラベルは対象外", () => {
  // 語中に「その他」を含むだけの通常選択肢を巻き込まない
  assert.equal(isOtherLabel("価格その他の条件"), false);
  assert.equal(isOtherLabel("特になし"), false);
  assert.equal(isOtherLabel("カット"), false);
  assert.equal(isOtherLabel(""), false);
  assert.equal(isOtherLabel(null), false);
  assert.equal(isOtherLabel(undefined), false);
});

// ------------------------------------------------------------------
// applyAutoFreeText
// ------------------------------------------------------------------

test("applyAutoFreeText: 「その他」選択肢にだけ allow_free_text を付ける", () => {
  const options = [opt("cut", "カット"), opt("other", "その他（）")];
  const result = applyAutoFreeText(options);
  assert.equal(result[0]?.allow_free_text, undefined);
  assert.equal(result[1]?.allow_free_text, true);
});

test("applyAutoFreeText: 明示指定は上書きしない（false も尊重する）", () => {
  const options: QuestionOption[] = [
    { value: "other", label: "その他（）", allow_free_text: false },
  ];
  const result = applyAutoFreeText(options);
  assert.equal(result[0]?.allow_free_text, false);
});

test("applyAutoFreeText: 対象外の選択肢は参照同一性を保つ（無用な再生成をしない）", () => {
  const keep = opt("cut", "カット");
  const result = applyAutoFreeText([keep, opt("other", "その他")]);
  assert.equal(result[0], keep);
});

test("applyAutoFreeText: options 未設定なら空配列を生やさずそのまま返す", () => {
  assert.equal(applyAutoFreeText(undefined), undefined);
  assert.deepEqual(applyAutoFreeText([]), []);
});

// ------------------------------------------------------------------
// resolveQuestionView への組み込み
// ------------------------------------------------------------------

test("resolveQuestionView: 「その他」に自由記述が自動付与される", () => {
  const view = resolveQuestionView(
    {
      question_code: "q9",
      question_text: "重視していることは？",
      question_type: "multi_choice",
      comment_top: null,
      comment_bottom: null,
      visibility_conditions: null,
      display_tags_parsed: null,
      question_config: { options: [opt("price", "価格"), opt("other", "その他（）")] },
    } as Parameters<typeof resolveQuestionView>[0],
    { answers: {} },
  );
  const other = view.options.find((o) => o.value === "other");
  assert.equal(other?.allow_free_text, true);
});

test("resolveQuestionView: carry-forward で残った「その他」にも自由記述が付く", () => {
  const view = resolveQuestionView(
    {
      question_code: "q10",
      question_text: "特に重視していることは？",
      question_type: "single_choice",
      comment_top: null,
      comment_bottom: null,
      visibility_conditions: null,
      display_tags_parsed: { optionSource: { fromQuestion: "q9", mode: "selected" } },
      question_config: {
        options: [opt("price", "価格"), opt("skill", "技術"), opt("other", "その他（）")],
      },
    } as Parameters<typeof resolveQuestionView>[0],
    { answers: { q9: ["price", "other"] } },
  );
  assert.deepEqual(view.options.map((o) => o.value), ["price", "other"]);
  assert.equal(view.options.find((o) => o.value === "other")?.allow_free_text, true);
});
