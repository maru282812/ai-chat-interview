/**
 * crossProjectCarryForward.test.ts
 *
 * 別案件の回答参照（Migration 092）。
 * 店舗アンケート A/B/C で「C の選択肢を A の回答で絞る」が成立することを確認する。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCarryForward,
  evaluatePipeExpression,
  resolveQuestionView,
} from "../lib/questionEngine";
import { buildAnswerContext } from "../services/surveyFlowService";
import type { Answer, Question, QuestionOption } from "../types/domain";
import type { AnswerContext } from "../types/questionSchema";

const opt = (value: string, label = value): QuestionOption => ({ value, label });
const ctxOf = (answers: AnswerContext["answers"]): AnswerContext => ({ answers });

// ------------------------------------------------------------------
// pipe 式: 名前空間付き参照
// ------------------------------------------------------------------

test("pipe: 名前空間付き includes が別案件の回答を参照する", () => {
  const ctx = ctxOf({ "a:q5": ["cut", "color"] });
  assert.equal(evaluatePipeExpression("a:q5 includes color", ctx).visible, true);
  assert.equal(evaluatePipeExpression("a:q5 includes perm", ctx).visible, false);
});

test("pipe: 名前空間付き not includes が否定として効く", () => {
  const ctx = ctxOf({ "a:q5": ["cut"] });
  assert.equal(evaluatePipeExpression("not a:q5 includes color", ctx).visible, true);
  assert.equal(evaluatePipeExpression("not a:q5 includes cut", ctx).visible, false);
});

test("pipe: 名前空間付き比較演算も解釈する", () => {
  const ctx = ctxOf({ "a:q4": "first" });
  assert.equal(evaluatePipeExpression("a:q4=first", ctx).visible, true);
  assert.equal(evaluatePipeExpression("a:q4!=first", ctx).visible, false);
});

test("pipe: 名前空間なしの従来式は挙動が変わらない", () => {
  const ctx = ctxOf({ q5: ["cut", "color"] });
  assert.equal(evaluatePipeExpression("q5 includes color", ctx).visible, true);
  assert.equal(evaluatePipeExpression("q1=1 and q2=2", ctxOf({ q1: "1", q2: "2" })).visible, true);
});

// ------------------------------------------------------------------
// carry-forward: 名前空間付き参照
// ------------------------------------------------------------------

test("carry-forward: 別案件の回答で選択肢を絞れる", () => {
  const options = [opt("cut"), opt("color"), opt("perm")];
  const ctx = ctxOf({ "a:q5": ["cut", "perm"] });
  const result = applyCarryForward(options, { fromQuestion: "a:q5", mode: "selected" }, ctx);
  assert.deepEqual(result.map((o) => o.value), ["cut", "perm"]);
});

// ------------------------------------------------------------------
// disableRules 経由（C-Q2 の実構成）
// ------------------------------------------------------------------

test("C-Q2 相当: A-Q5 でカラー未選択ならカラー系選択肢が落ちる", () => {
  const question = {
    question_code: "q2",
    question_text: "よかった点は？",
    question_type: "multi_choice",
    comment_top: null,
    comment_bottom: null,
    visibility_conditions: null,
    display_tags_parsed: {
      disableRules: [
        { targetChoice: "color_lasted", condition: "not a:q5 includes color" },
        { targetChoice: "perm_lasted", condition: "not a:q5 includes perm" },
      ],
    },
    question_config: {
      options: [opt("style_lasted"), opt("color_lasted"), opt("perm_lasted")],
    },
  } as Parameters<typeof resolveQuestionView>[0];

  // カット＋カラーのみ利用 → perm 系だけ落ちる
  const view = resolveQuestionView(question, ctxOf({ "a:q5": ["cut", "color"] }));
  assert.deepEqual(view.options.map((o) => o.value), ["style_lasted", "color_lasted"]);

  // カットのみ → color/perm 両方落ちる
  const cutOnly = resolveQuestionView(question, ctxOf({ "a:q5": ["cut"] }));
  assert.deepEqual(cutOnly.options.map((o) => o.value), ["style_lasted"]);
});

test("参照元が未回答なら条件付き選択肢は落ちる（安全側に倒さない＝出さない）", () => {
  const question = {
    question_code: "q2",
    question_text: "",
    question_type: "multi_choice",
    comment_top: null,
    comment_bottom: null,
    visibility_conditions: null,
    display_tags_parsed: {
      disableRules: [{ targetChoice: "color_lasted", condition: "not a:q5 includes color" }],
    },
    question_config: { options: [opt("style_lasted"), opt("color_lasted")] },
  } as Parameters<typeof resolveQuestionView>[0];

  const view = resolveQuestionView(question, ctxOf({}));
  assert.deepEqual(view.options.map((o) => o.value), ["style_lasted"]);
});

// ------------------------------------------------------------------
// buildAnswerContext: 名前空間の合成
// ------------------------------------------------------------------

const question = (id: string, code: string, type = "multi_choice"): Question =>
  ({ id, question_code: code, question_type: type }) as Question;

const answer = (questionId: string, text: string): Answer =>
  ({ question_id: questionId, answer_text: text, answer_role: "primary" }) as Answer;

test("buildAnswerContext: 別案件の回答が名前空間付きキーで載る", () => {
  const ctx = buildAnswerContext(
    [question("q-c1", "Q1", "single_choice")],
    [answer("q-c1", "very_satisfied")],
    [
      {
        namespace: "a",
        questions: [question("q-a5", "Q5")],
        answers: [answer("q-a5", "cut,color")],
      },
    ]
  );

  assert.deepEqual(ctx.answers["a:q5"], ["cut", "color"]);
  assert.equal(ctx.answers.q1, "very_satisfied");
});

test("buildAnswerContext: 本案件の回答が同名キーの別案件分より優先される", () => {
  const ctx = buildAnswerContext(
    [question("q-c5", "Q5")],
    [answer("q-c5", "own")],
    [
      {
        namespace: "q",
        questions: [question("q-a5", "5")],
        answers: [answer("q-a5", "foreign")],
      },
    ]
  );
  assert.deepEqual(ctx.answers.q5, ["own"]);
});

test("buildAnswerContext: 別案件の probe 回答は無視される", () => {
  const probe = { question_id: "q-a5", answer_text: "probe", answer_role: "ai_probe" } as Answer;
  const ctx = buildAnswerContext(
    [],
    [],
    [{ namespace: "a", questions: [question("q-a5", "Q5")], answers: [probe] }]
  );
  assert.equal(ctx.answers["a:q5"], undefined);
});

test("buildAnswerContext: crossProject 省略時は従来どおり", () => {
  const ctx = buildAnswerContext([question("q1", "Q1", "single_choice")], [answer("q1", "yes")]);
  assert.deepEqual(ctx.answers, { q1: "yes" });
});
