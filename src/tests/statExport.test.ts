import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveCodebook, deriveVariableDefinition, sanitizeVariableName } from "../lib/codebook";
import {
  type ExportAnswerGroup,
  type ExportRespondent,
  buildLongRows,
  buildSnapshotDefinition,
  buildWideRows,
  codebookFromSnapshot,
  snapshotHash,
  toCsvRfc4180
} from "../lib/statExport";
import { validateSurvey } from "../lib/surveyValidation";
import { type RandomizationQuestion, computeDisplayOrder } from "../lib/randomization";
import type { Answer, Project, Question } from "../types/domain";

function makeQuestion(partial: Partial<Question> & Pick<Question, "question_code" | "question_type" | "sort_order">): Question {
  return {
    id: partial.id ?? `qid-${partial.question_code}`,
    project_id: "p1",
    question_code: partial.question_code,
    question_text: partial.question_text ?? "質問文",
    comment_top: partial.comment_top ?? null,
    comment_bottom: partial.comment_bottom ?? null,
    question_role: partial.question_role ?? "main",
    question_type: partial.question_type,
    is_required: partial.is_required ?? true,
    sort_order: partial.sort_order,
    answer_output_type: partial.answer_output_type ?? null,
    display_tags_raw: partial.display_tags_raw ?? null,
    display_tags_parsed: partial.display_tags_parsed ?? null,
    visibility_conditions: partial.visibility_conditions ?? null,
    page_group_id: partial.page_group_id ?? null,
    branch_rule: partial.branch_rule ?? null,
    question_config: partial.question_config ?? null,
    ai_probe_enabled: partial.ai_probe_enabled ?? false,
    probe_guideline: partial.probe_guideline ?? null,
    max_probe_count: partial.max_probe_count ?? null,
    render_strategy: partial.render_strategy ?? "static",
    answer_options_locked: partial.answer_options_locked ?? false,
    is_screening_question: partial.is_screening_question ?? false,
    is_system: partial.is_system ?? false,
    is_hidden: partial.is_hidden ?? false,
    created_at: "2026-06-29T00:00:00.000Z",
    updated_at: "2026-06-29T00:00:00.000Z"
  };
}

function makeAnswer(partial: Partial<Answer> & Pick<Answer, "question_id">): Answer {
  return {
    id: partial.id ?? `aid-${Math.random().toString(36).slice(2)}`,
    session_id: partial.session_id ?? "s1",
    question_id: partial.question_id,
    answer_text: partial.answer_text ?? "",
    free_text_answer: partial.free_text_answer ?? null,
    answer_role: partial.answer_role ?? "primary",
    parent_answer_id: partial.parent_answer_id ?? null,
    normalized_answer: partial.normalized_answer ?? null,
    created_at: partial.created_at ?? "2026-06-29T00:01:00.000Z"
  };
}

const Q_SINGLE = makeQuestion({
  question_code: "Q1",
  question_type: "single_choice",
  sort_order: 1,
  question_config: { options: [{ value: "tea", label: "お茶" }, { value: "coffee", label: "コーヒー" }] }
});
const Q_MULTI = makeQuestion({
  question_code: "Q2",
  question_type: "multi_choice",
  sort_order: 2,
  question_config: { options: [{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }] }
});
const Q_NUM = makeQuestion({ question_code: "Q3", question_type: "numeric", sort_order: 3, question_config: { scaleMin: 1, scaleMax: 5 } });
const Q_TEXT = makeQuestion({ question_code: "Q4", question_type: "free_text_long", sort_order: 4, ai_probe_enabled: true });

const QUESTIONS = [Q_SINGLE, Q_MULTI, Q_NUM, Q_TEXT];

test("codebook: 型・尺度・集計方針・多重選択エンコードを導出する", () => {
  const codebook = deriveCodebook(QUESTIONS);
  assert.equal(codebook.length, 4);
  const single = codebook[0]!;
  const multi = codebook[1]!;
  const num = codebook[2]!;
  const text = codebook[3]!;

  assert.equal(single.data_type, "categorical");
  assert.equal(single.measure_type, "nominal");
  assert.equal(single.aggregation_policy, "frequency");
  assert.equal(single.allowed_values.length, 2);
  assert.equal(single.allowed_values[0]!.option_code, "tea");

  assert.equal(multi.data_type, "categorical_multi");
  assert.equal(multi.multi_select_encoding, "one_hot");
  assert.equal(multi.aggregation_policy, "multiple_response");

  assert.equal(num.data_type, "integer");
  assert.equal(num.measure_type, "scale");
  assert.equal(num.scale_min, 1);
  assert.equal(num.scale_max, 5);

  assert.equal(text.data_type, "text");
  assert.equal(text.aggregation_policy, "qualitative");
});

test("codebook: 変数名を統計ソフト向けに安全化する", () => {
  assert.equal(sanitizeVariableName("__free_comment__"), "free_comment");
  assert.equal(sanitizeVariableName("Q1"), "Q1");
  assert.equal(sanitizeVariableName("3rd"), "q_3rd");
  assert.equal(sanitizeVariableName("a b-c"), "a_b_c");
});

function groupsFor(answers: Record<string, { primary?: Answer; probes?: Answer[] }>): ExportAnswerGroup[] {
  return QUESTIONS.map((question) => ({
    question,
    primaryAnswer: answers[question.id]?.primary ?? null,
    extraction: null,
    probeAnswers: answers[question.id]?.probes ?? []
  }));
}

test("wide: マスター順・多重選択one-hot・数値・AI深掘り統合値・欠損センチネル", () => {
  const variables = deriveCodebook(QUESTIONS);

  const probe = makeAnswer({ question_id: Q_TEXT.id, answer_role: "ai_probe", parent_answer_id: "primary-q4", answer_text: "もっと具体的には味です" });
  const respondentA: ExportRespondent = {
    respondent_key: "r-A",
    session_id: "s-A",
    response_status: "completed",
    is_test: false,
    channel: "liff",
    started_at: "2026-06-29T00:00:00.000Z",
    completed_at: "2026-06-29T00:05:00.000Z",
    total_duration_sec: 300,
    groups: groupsFor({
      [Q_SINGLE.id]: { primary: makeAnswer({ question_id: Q_SINGLE.id, normalized_answer: { value: "tea" }, answer_text: "お茶" }) },
      [Q_MULTI.id]: { primary: makeAnswer({ question_id: Q_MULTI.id, normalized_answer: { values: ["a", "c"] }, answer_text: "A,C" }) },
      [Q_NUM.id]: { primary: makeAnswer({ question_id: Q_NUM.id, normalized_answer: { value: 4 }, answer_text: "4" }) },
      [Q_TEXT.id]: { primary: makeAnswer({ id: "primary-q4", question_id: Q_TEXT.id, answer_text: "好きだから" }), probes: [probe] }
    })
  };
  // 完了だが Q3 無回答の回答者
  const respondentB: ExportRespondent = {
    ...respondentA,
    respondent_key: "r-B",
    groups: groupsFor({
      [Q_SINGLE.id]: { primary: makeAnswer({ question_id: Q_SINGLE.id, normalized_answer: { value: "coffee" }, answer_text: "コーヒー" }) }
    })
  };
  // テスト回答（既定で除外）
  const respondentTest: ExportRespondent = { ...respondentA, respondent_key: "r-T", is_test: true, groups: groupsFor({}) };

  const rows = buildWideRows(variables, [respondentA, respondentB, respondentTest]);
  assert.equal(rows.length, 2, "is_test は既定で除外される");

  const a = rows[0]!;
  // マスター順で列が並ぶ（respondent_key の後に Q1 が来る）
  const keys = Object.keys(a);
  assert.ok(keys.indexOf("Q1") < keys.indexOf("Q2_a"), "Q1 は Q2 より前");
  assert.equal(a.Q1, "tea");
  assert.equal(a.Q2_a, 1);
  assert.equal(a.Q2_b, 0);
  assert.equal(a.Q2_c, 1);
  assert.equal(a.Q3, 4);
  // §9 AI深掘り統合値（ai_probe_enabled の Q4 のみ）
  assert.equal(a.Q4_probe_triggered, true);
  assert.equal(a.Q4_probe_count, 1);
  assert.ok(String(a.Q4_final_answer_text).includes("好きだから"));
  assert.ok(String(a.Q4_final_answer_text).includes("味です"));
  assert.equal(typeof a.Q1_probe_triggered, "undefined", "非probe設問には統合列を作らない");

  const b = rows[1]!;
  assert.equal(b.Q3, ".", "完了セッションの未回答は no_answer センチネル");
});

test("long: primary と ai_probe を別行で出力し parent_answer_id で紐づく（§8）", () => {
  const variables = deriveCodebook(QUESTIONS);
  const probe = makeAnswer({ question_id: Q_TEXT.id, answer_role: "ai_probe", parent_answer_id: "primary-q4", answer_text: "具体的には味", normalized_answer: { probe_question: "どの点ですか？", probe_confidence: 0.8 } });
  const respondent: ExportRespondent = {
    respondent_key: "r-A",
    session_id: "s-A",
    response_status: "completed",
    is_test: false,
    channel: null,
    started_at: null,
    completed_at: null,
    total_duration_sec: null,
    groups: groupsFor({
      [Q_TEXT.id]: { primary: makeAnswer({ id: "primary-q4", question_id: Q_TEXT.id, answer_text: "好きだから" }), probes: [probe] }
    })
  };

  const rows = buildLongRows(variables, [respondent]);
  const q4Rows = rows.filter((row) => row.question_code === "Q4");
  assert.equal(q4Rows.length, 2);
  const probeRow = q4Rows.find((row) => row.answer_role === "ai_probe");
  assert.ok(probeRow);
  assert.equal(probeRow?.parent_answer_id, "primary-q4");
  assert.equal(probeRow?.probe_index, 1);
  assert.equal(probeRow?.probe_question_text, "どの点ですか？");
  assert.equal(probeRow?.probe_confidence, 0.8);
});

test("CSV: RFC4180 クォート・CRLF・UTF-8 BOM（§21）", () => {
  const csv = toCsvRfc4180([{ a: 'x,y"z', b: "line1\nline2", c: 5 }]);
  assert.ok(csv.startsWith("﻿"), "BOM 始まり");
  assert.ok(csv.includes("\r\n"), "CRLF 改行");
  assert.ok(csv.includes('"x,y""z"'), "カンマ・引用符はクォート＆エスケープ");
  assert.ok(csv.includes('"line1\nline2"'), "改行はクォート内に保持");
});

test("validation: 依存順違反・分岐先欠落・変数名重複・文言警告を検出（§4/§5/§6）", () => {
  const questions: Question[] = [
    // Q2 が後続 Q3 を answer insertion で参照 → 依存順違反
    makeQuestion({
      question_code: "Q2",
      question_type: "free_text_long",
      sort_order: 1,
      question_text: "先ほどの回答を踏まえて教えてください",
      display_tags_parsed: { answerInsertions: [{ source: "q3", target: "question_text" }] }
    }),
    makeQuestion({ question_code: "Q3", question_type: "single_choice", sort_order: 2, question_config: { options: [{ value: "x", label: "X" }] } }),
    // 分岐先 Q9 が存在しない
    makeQuestion({ question_code: "Q4", question_type: "single_choice", sort_order: 3, branch_rule: [{ when: { operator: "equals", value: true }, targetQuestionCode: "Q9" }], question_config: { options: [{ value: "y", label: "Y" }] } })
  ];

  const report = validateSurvey(questions);
  const codes = report.findings.map((finding) => finding.code);
  assert.ok(codes.includes("dependency_order_violation"), "依存順違反");
  assert.ok(codes.includes("branch_target_not_found"), "分岐先欠落");
  assert.equal(report.ok, false);
});

test("validation: 循環依存を検出（§6）", () => {
  const questions: Question[] = [
    makeQuestion({ question_code: "A", question_type: "free_text_long", sort_order: 1, display_tags_parsed: { answerInsertions: [{ source: "B", target: "question_text" }] } }),
    makeQuestion({ question_code: "B", question_type: "free_text_long", sort_order: 2, display_tags_parsed: { answerInsertions: [{ source: "A", target: "question_text" }] } })
  ];
  const report = validateSurvey(questions);
  assert.ok(report.findings.some((finding) => finding.code === "circular_dependency"));
});

test("validation: 重複した出力変数名を検出（§6）", () => {
  const questions: Question[] = [
    makeQuestion({ question_code: "Q1", question_type: "free_text_long", sort_order: 1, question_config: { meta: { cleaning: { variable_name: "dup" } } } }),
    makeQuestion({ question_code: "Q2", question_type: "free_text_long", sort_order: 2, question_config: { meta: { cleaning: { variable_name: "dup" } } } })
  ];
  const report = validateSurvey(questions);
  assert.ok(report.findings.some((finding) => finding.code === "duplicate_variable_name"));
});

const PROJECT = { id: "p1", name: "テスト案件", research_mode: "survey", display_mode: "survey_question" } as unknown as Project;

test("snapshot: 定義は codebook を内包し、内容ハッシュは安定／変更で変わる（§1/§14）", () => {
  const def1 = buildSnapshotDefinition(PROJECT, QUESTIONS);
  const def2 = buildSnapshotDefinition(PROJECT, QUESTIONS);
  assert.equal(snapshotHash(def1), snapshotHash(def2), "同一内容は同一ハッシュ（揮発値を含まない）");

  const codebook = codebookFromSnapshot(def1);
  assert.ok(codebook && codebook.length === 4, "codebook を取り出せる");
  assert.equal(codebook?.[0]?.question_code, "Q1");

  const changed = buildSnapshotDefinition(PROJECT, [...QUESTIONS, makeQuestion({ question_code: "Q5", question_type: "numeric", sort_order: 5 })]);
  assert.notEqual(snapshotHash(def1), snapshotHash(changed), "設問変更でハッシュが変わる");
});

const RQ = (code: string, order: number, block: string | null = null): RandomizationQuestion => ({
  id: `id-${code}`,
  question_code: code,
  block_code: block,
  master_order: order
});

test("randomization: ブロック未設定はマスター順（後方互換・§3）", () => {
  const questions = [RQ("Q1", 1), RQ("Q2", 2), RQ("Q3", 3)];
  const { order } = computeDisplayOrder({ questions, seed: "s1" });
  assert.equal(order.get("id-Q1"), 1);
  assert.equal(order.get("id-Q2"), 2);
  assert.equal(order.get("id-Q3"), 3);
});

test("randomization: 同一シードは再現的、依存順は常に保持（§22/§4）", () => {
  const questions = [RQ("Q1", 1, "B1"), RQ("Q2", 2, "B1"), RQ("Q3", 3, "B1"), RQ("Q4", 4, "B1")];
  const blocks = [{ block_code: "B1", master_order: 1, is_randomizable: false, randomize_within: true, fix_within: false }];
  // Q4 は Q2 に依存（Q2 が先）
  const edges = [{ from: "Q4", to: "Q2" }];

  const run1 = computeDisplayOrder({ questions, blocks, edges, seed: "seed-A" });
  const run2 = computeDisplayOrder({ questions, blocks, edges, seed: "seed-A" });
  assert.deepEqual([...run1.order.entries()], [...run2.order.entries()], "同一シードは同一結果");

  // 依存順保持: pos(Q2) < pos(Q4)
  assert.ok(run1.order.get("id-Q2")! < run1.order.get("id-Q4")!, "依存先Q2は依存元Q4より前");

  // ランダム化が効いている（マスター順と少なくとも一致しないシードが存在する）
  const seeds = ["a", "b", "c", "d", "e", "f"];
  const anyShuffled = seeds.some((seed) => {
    const { order } = computeDisplayOrder({ questions, blocks, edges, seed });
    return order.get("id-Q1") !== 1 || order.get("id-Q3") !== 3;
  });
  assert.ok(anyShuffled, "ブロック内ランダム化が表示順を変える");
});

test("randomization: fix_within はブロック内順を固定する（§3）", () => {
  const questions = [RQ("Q1", 1, "B1"), RQ("Q2", 2, "B1"), RQ("Q3", 3, "B1")];
  const blocks = [{ block_code: "B1", master_order: 1, is_randomizable: false, randomize_within: true, fix_within: true }];
  for (const seed of ["x", "y", "z"]) {
    const { order } = computeDisplayOrder({ questions, blocks, seed });
    assert.deepEqual([order.get("id-Q1"), order.get("id-Q2"), order.get("id-Q3")], [1, 2, 3]);
  }
});

test("validation: 健全な調査票は ok=true（warningのみ許容）", () => {
  const questions: Question[] = [
    makeQuestion({ question_code: "Q1", question_type: "single_choice", sort_order: 1, question_config: { options: [{ value: "a", label: "A" }] } }),
    makeQuestion({ question_code: "Q2", question_type: "free_text_long", sort_order: 2 })
  ];
  const report = validateSurvey(questions);
  assert.equal(report.ok, true);
  assert.equal(report.errorCount, 0);
});
