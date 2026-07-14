/**
 * dailyChatAnswer.test.ts
 *
 * LINE トーク内 1 タップ回答（Flex の postback ボタン）の純関数。
 * 「どの設問ならトーク内で完結できるか」と「postback data を安全に往復できるか」だけを見る。
 * 実在性・所有権・受付中かの判定は dailySurveyChatService の担当なのでここでは見ない。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDailyPostbackData,
  parseDailyPostbackData,
  resolveChatAnswerable,
  truncateButtonLabel,
} from "../lib/dailyChatAnswer";
import type { DailySurveyQuestion } from "../repositories/dailySurveyRepository";

const SURVEY_ID = "22222222-2222-4222-8222-222222222222";
const QUESTION_ID = "11111111-1111-4111-8111-111111111111";

function q(over: Partial<DailySurveyQuestion> = {}): DailySurveyQuestion {
  return {
    id: QUESTION_ID,
    survey_id: SURVEY_ID,
    question_text: "今日食べたものを選んでください。",
    question_type: "single_choice",
    answer_options: [
      { label: "自炊", value: "home" },
      { label: "外食", value: "out" },
      { label: "コンビニ", value: "cvs" },
    ],
    attribute_key: null,
    sort_order: 1,
    is_active: true,
    created_at: "2026-07-14T00:00:00.000Z",
    ...over,
  };
}

// ---- トーク内で完結できる設問かの判定 ----

test("選択肢2〜6個の単一選択1問はトーク内回答の対象", () => {
  const resolved = resolveChatAnswerable([q()]);
  assert.ok(resolved);
  assert.equal(resolved.question.id, QUESTION_ID);
  assert.equal(resolved.options.length, 3);
});

test("scale もボタンで押せるので対象", () => {
  const resolved = resolveChatAnswerable([
    q({
      question_type: "scale",
      answer_options: [
        { label: "1", value: "1" },
        { label: "5", value: "5" },
      ],
    }),
  ]);
  assert.ok(resolved);
});

test("自由記述はボタンで確定できないので対象外（リンク通知にフォールバック）", () => {
  assert.equal(resolveChatAnswerable([q({ question_type: "text", answer_options: [] })]), null);
});

test("複数選択はボタン1タップで確定できないので対象外", () => {
  assert.equal(resolveChatAnswerable([q({ question_type: "multiple_choice" })]), null);
});

test("設問が2問以上あるものは対象外", () => {
  assert.equal(resolveChatAnswerable([q(), q({ id: "other" })]), null);
});

test("設問が0問なら対象外", () => {
  assert.equal(resolveChatAnswerable([]), null);
});

test("選択肢が1個以下なら選ばせる意味がないので対象外", () => {
  assert.equal(resolveChatAnswerable([q({ answer_options: [{ label: "はい", value: "y" }] })]), null);
});

test("選択肢が7個以上はバブルが伸びすぎるので対象外", () => {
  const answer_options = Array.from({ length: 7 }, (_, i) => ({
    label: `選択肢${i}`,
    value: String(i),
  }));
  assert.equal(resolveChatAnswerable([q({ answer_options })]), null);
});

test("空ラベルの選択肢は数に入れない", () => {
  const resolved = resolveChatAnswerable([
    q({
      answer_options: [
        { label: "はい", value: "y" },
        { label: "  ", value: "blank" },
      ],
    }),
  ]);
  assert.equal(resolved, null);
});

// ---- postback data の往復 ----

test("postback data は組み立てた通りに読み戻せる", () => {
  const data = buildDailyPostbackData({ surveyId: SURVEY_ID, questionId: QUESTION_ID, optionIndex: 2 });
  assert.deepEqual(parseDailyPostbackData(data), {
    surveyId: SURVEY_ID,
    questionId: QUESTION_ID,
    optionIndex: 2,
  });
});

test("postback data に delivery_id は載せない（他人の配信を指定させない）", () => {
  const data = buildDailyPostbackData({ surveyId: SURVEY_ID, questionId: QUESTION_ID, optionIndex: 0 });
  assert.ok(!data.includes("delivery"));
});

test("デイリー回答以外の postback は無視する", () => {
  assert.equal(parseDailyPostbackData("action=something_else&s=1"), null);
  assert.equal(parseDailyPostbackData(""), null);
});

test("選択肢の位置が数値でない postback は無視する", () => {
  assert.equal(parseDailyPostbackData(`action=daily_answer&s=${SURVEY_ID}&q=${QUESTION_ID}&o=abc`), null);
  assert.equal(parseDailyPostbackData(`action=daily_answer&s=${SURVEY_ID}&q=${QUESTION_ID}`), null);
});

test("survey / question が欠けた postback は無視する", () => {
  assert.equal(parseDailyPostbackData("action=daily_answer&o=0"), null);
});

test("postback data は LINE の上限 300 文字に収まる", () => {
  const data = buildDailyPostbackData({ surveyId: SURVEY_ID, questionId: QUESTION_ID, optionIndex: 5 });
  assert.ok(data.length <= 300, `data length = ${data.length}`);
});

// ---- ボタン label ----

test("ボタン label は 20 文字で詰める（LINE の上限）", () => {
  assert.equal(truncateButtonLabel("外食"), "外食");
  const long = truncateButtonLabel("あ".repeat(30));
  assert.equal(long.length, 20);
  assert.ok(long.endsWith("…"));
});
