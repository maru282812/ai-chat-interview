import assert from "node:assert/strict";
import { test } from "node:test";
import {
  answerValueForContext,
  buildAnswerContext,
  computeNextView,
  resumeView,
} from "../services/surveyFlowService";
import type { Answer, Question } from "../types/domain";

function makeQuestion(overrides: Partial<Question> & { question_code: string; sort_order: number }): Question {
  return {
    id: `id-${overrides.question_code}`,
    project_id: "p1",
    question_text: `Q ${overrides.question_code}`,
    comment_top: null,
    comment_bottom: null,
    question_role: "main",
    question_type: "single_choice",
    is_required: false,
    answer_output_type: null,
    display_tags_raw: null,
    display_tags_parsed: null,
    visibility_conditions: null,
    page_group_id: null,
    branch_rule: null,
    question_config: null,
    ai_probe_enabled: false,
    answer_options_locked: false,
    is_screening_question: false,
    is_system: false,
    is_hidden: false,
    created_at: "",
    updated_at: "",
    ...overrides,
  } as Question;
}

function makeAnswer(questionId: string, answerText: string): Answer {
  return {
    id: `a-${questionId}`,
    session_id: "s1",
    question_id: questionId,
    answer_text: answerText,
    answer_role: "primary",
  } as unknown as Answer;
}

// ------------------------------------------------------------------

test("answerValueForContext: multi はカンマ分割 / single はそのまま", () => {
  assert.deepEqual(answerValueForContext("multi_choice", "C,D"), ["C", "D"]);
  assert.deepEqual(answerValueForContext("multi_choice", ""), []);
  assert.equal(answerValueForContext("single_choice", "2"), "2");
});

test("buildAnswerContext: primary のみを question_code キーで集約", () => {
  const q1 = makeQuestion({ question_code: "q1", sort_order: 1 });
  const q2 = makeQuestion({ question_code: "q2", sort_order: 2, question_type: "multi_choice" });
  const answers: Answer[] = [
    makeAnswer(q1.id, "2"),
    makeAnswer(q2.id, "C,D"),
    { ...makeAnswer(q1.id, "probe-junk"), answer_role: "probe" } as unknown as Answer,
  ];
  const ctx = buildAnswerContext([q1, q2], answers);
  assert.equal(ctx.answers.q1, "2");
  assert.deepEqual(ctx.answers.q2, ["C", "D"]);
});

test("computeNextView: 通常は sort_order の次を返す", () => {
  const q1 = makeQuestion({ question_code: "q1", sort_order: 1 });
  const q2 = makeQuestion({ question_code: "q2", sort_order: 2 });
  const view = computeNextView({
    questions: [q1, q2],
    ctx: { answers: { q1: "1" } },
    fromQuestion: q1,
    normalizedAnswer: { value: "1" },
  });
  assert.equal(view?.question_code, "q2");
});

test("computeNextView: 不可視の次設問はスキップして先へ進む", () => {
  const q1 = makeQuestion({ question_code: "q1", sort_order: 1 });
  const q2 = makeQuestion({
    question_code: "q2",
    sort_order: 2,
    visibility_conditions: [{ type: "pipe_expression", expression: "q1=9" }],
  });
  const q3 = makeQuestion({ question_code: "q3", sort_order: 3 });
  const view = computeNextView({
    questions: [q1, q2, q3],
    ctx: { answers: { q1: "1" } }, // q1=9 を満たさない → q2 は不可視
    fromQuestion: q1,
    normalizedAnswer: { value: "1" },
  });
  assert.equal(view?.question_code, "q3");
});

test("computeNextView: branch_rule 一致で指定コードへジャンプ", () => {
  const q1 = makeQuestion({
    question_code: "q1",
    sort_order: 1,
    branch_rule: { branches: [{ when: { equals: "B" }, next: "q3" }] },
  });
  const q2 = makeQuestion({ question_code: "q2", sort_order: 2 });
  const q3 = makeQuestion({ question_code: "q3", sort_order: 3 });
  const view = computeNextView({
    questions: [q1, q2, q3],
    ctx: { answers: { q1: "B" } },
    fromQuestion: q1,
    normalizedAnswer: { value: "B" },
  });
  assert.equal(view?.question_code, "q3");
});

test("computeNextView: 末尾まで来たら null", () => {
  const q1 = makeQuestion({ question_code: "q1", sort_order: 1 });
  const view = computeNextView({
    questions: [q1],
    ctx: { answers: { q1: "1" } },
    fromQuestion: q1,
    normalizedAnswer: { value: "1" },
  });
  assert.equal(view, null);
});

test("resumeView: 未回答かつ可視の最初の設問を返す", () => {
  const q1 = makeQuestion({ question_code: "q1", sort_order: 1 });
  const q2 = makeQuestion({ question_code: "q2", sort_order: 2 });
  const view = resumeView([q1, q2], { answers: { q1: "1" } }, new Set(["q1"]));
  assert.equal(view?.question_code, "q2");
});
