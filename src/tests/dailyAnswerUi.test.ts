/**
 * dailyAnswerUi.test.ts
 *
 * デイリー設問 → 回答UIレンダラ入力のアダプタ（docs/plan-daily-survey-queue.md Phase 3）。
 * 「デイリーの設問モデルを casual レンダラに正しく写せているか」だけを見る。
 * 表示パターンの決定則そのものは answerPresentation 側の担当。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  resolveDailyQuestionView,
  resolveDailyQuestionViews,
  toChoices,
  toPresentationInput,
  toQuestionType,
} from "../lib/dailyAnswerUi";
import type { DailySurveyQuestion } from "../repositories/dailySurveyRepository";

function q(over: Partial<DailySurveyQuestion>): DailySurveyQuestion {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    survey_id: "22222222-2222-4222-8222-222222222222",
    question_text: "今日の気分は？",
    question_type: "single_choice",
    answer_options: [],
    attribute_key: null,
    sort_order: 1,
    is_active: true,
    created_at: "2026-07-14T00:00:00.000Z",
    ...over,
  };
}

const YES_NO = [
  { label: "はい", value: "yes" },
  { label: "いいえ", value: "no" },
];

// ---- 設問タイプの写像 ----

test("toQuestionType: multiple_choice → multi_choice", () => {
  assert.equal(toQuestionType("multiple_choice"), "multi_choice");
});

test("toQuestionType: text → free_text_short", () => {
  assert.equal(toQuestionType("text"), "free_text_short");
});

test("toQuestionType: scale / single_choice は single_choice（尺度は presentation で表す）", () => {
  assert.equal(toQuestionType("scale"), "single_choice");
  assert.equal(toQuestionType("single_choice"), "single_choice");
});

// ---- 選択肢の写像 ----

test("toChoices: answer_options をレンダラの choices 形に写す", () => {
  const choices = toChoices(q({ answer_options: [{ label: "自炊", value: "jisui" }] }));
  assert.deepEqual(choices, [{ value: "jisui", label: "自炊" }]);
});

test("toChoices: scale で選択肢未設定なら 1〜5 を補う", () => {
  const choices = toChoices(q({ question_type: "scale", answer_options: [] }));
  assert.deepEqual(
    choices.map((c) => c.value),
    ["1", "2", "3", "4", "5"],
  );
});

test("toChoices: scale でも選択肢が設定されていればそれを使う", () => {
  const choices = toChoices(q({ question_type: "scale", answer_options: YES_NO }));
  assert.equal(choices.length, 2);
  assert.deepEqual(choices[1], { value: "no", label: "いいえ" });
});

test("toChoices: scale 以外は選択肢未設定なら空（テキスト等）", () => {
  assert.deepEqual(toChoices(q({ question_type: "text" })), []);
});

test("toChoices: label 欠落は value で代替する", () => {
  const choices = toChoices(
    q({ answer_options: [{ value: "a" } as unknown as { label: string; value: string }] }),
  );
  assert.deepEqual(choices, [{ value: "a", label: "a" }]);
});

// ---- presentation 解決の入力 ----

test("toPresentationInput: scale は presentation.scale = true を立てる", () => {
  const input = toPresentationInput(q({ question_type: "scale" }));
  assert.equal(input.question_type, "single_choice");
  assert.equal(input.question_config?.presentation?.scale, true);
  assert.equal(input.question_config?.options?.length, 5);
});

test("toPresentationInput: scale 以外は presentation を立てない", () => {
  const input = toPresentationInput(q({ answer_options: [{ label: "はい", value: "yes" }] }));
  assert.equal(input.question_config?.presentation, undefined);
});

// ---- casual（デイリー既定）での解決 ----

test("casual: 2択の single_choice は swipe_card", () => {
  const view = resolveDailyQuestionView(q({ answer_options: YES_NO }), "casual");
  assert.equal(view.presentation.pattern, "swipe_card");
  assert.equal(view.presentation.preset, "casual");
});

test("casual: 3択以上の single_choice は carousel", () => {
  const view = resolveDailyQuestionView(
    q({
      answer_options: [
        { label: "自炊", value: "a" },
        { label: "外食", value: "b" },
        { label: "コンビニ", value: "c" },
      ],
    }),
    "casual",
  );
  assert.equal(view.presentation.pattern, "carousel");
});

test("casual: scale は face_scale（絵文字フェイス）で選択肢は 1〜5", () => {
  const view = resolveDailyQuestionView(q({ question_type: "scale" }), "casual");
  assert.equal(view.presentation.pattern, "face_scale");
  assert.equal(view.choices.length, 5);
});

test("casual: multiple_choice は sort_swipe（1選択肢=1カードの振り分け）", () => {
  const view = resolveDailyQuestionView(
    q({ question_type: "multiple_choice", answer_options: YES_NO }),
    "casual",
  );
  assert.equal(view.presentation.pattern, "sort_swipe");
});

test("casual: text は textarea（共通レンダラ対象外＝従来の入力欄）", () => {
  const view = resolveDailyQuestionView(q({ question_type: "text" }), "casual");
  assert.equal(view.presentation.pattern, "textarea");
});

test("casual: 設問文が長い2択は big_split へ降格する（サーバー権威のフォールバック）", () => {
  const view = resolveDailyQuestionView(
    q({ question_text: "あ".repeat(61), answer_options: YES_NO }),
    "casual",
  );
  assert.equal(view.presentation.pattern, "big_split");
  assert.equal(view.presentation.fallback_applied, true);
});

test("preset 未指定はデイリー既定の casual で解決する", () => {
  const view = resolveDailyQuestionView(q({ question_type: "scale" }), null);
  assert.equal(view.presentation.preset, "casual");
  assert.equal(view.presentation.pattern, "face_scale");
});

// ---- casual 以外のプリセット ----

test("standard: scale は big_slider", () => {
  const view = resolveDailyQuestionView(q({ question_type: "scale" }), "standard");
  assert.equal(view.presentation.pattern, "big_slider");
});

test("formal: 従来のラジオリスト", () => {
  const view = resolveDailyQuestionView(q({ answer_options: YES_NO }), "formal");
  assert.equal(view.presentation.pattern, "radio_list");
});

// ---- 一括解決（保存形式を壊さないこと） ----

test("resolveDailyQuestionViews: 元のタイプと選択肢を保ったまま presentation を足す", () => {
  const views = resolveDailyQuestionViews(
    [
      q({ id: "a", question_type: "scale" }),
      q({ id: "b", question_type: "multiple_choice", answer_options: [{ label: "A", value: "a" }] }),
    ],
    "casual",
  );
  assert.equal(views.length, 2);
  // 保存形式の判定に使う元のタイプは書き換えない
  assert.equal(views[0]?.question_type, "scale");
  assert.equal(views[1]?.question_type, "multiple_choice");
  assert.deepEqual(views[1]?.answer_options, [{ label: "A", value: "a" }]);
  assert.equal(views[0]?.presentation.pattern, "face_scale");
});
