import assert from "node:assert/strict";
import { test } from "node:test";
import { validateSurvey } from "../lib/surveyValidation";
import type { DisplayMode, Project, Question } from "../types/domain";

/**
 * P6: 表示モード（display_mode）と設問構成の整合チェック。
 *
 * validateSurvey(questions, project?) の第2引数は optional。
 * 未指定なら既存8チェックのみ＝完全な後方互換であることも固定する。
 */

function makeQuestion(
  partial: Partial<Question> & Pick<Question, "question_code" | "question_type" | "sort_order">
): Question {
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
    created_at: "2026-08-06T00:00:00.000Z",
    updated_at: "2026-08-06T00:00:00.000Z"
  };
}

function makeProject(partial: Partial<Project> & Pick<Project, "display_mode">): Project {
  return {
    id: "p1",
    name: "テスト案件",
    research_mode: "survey",
    ...partial
  } as unknown as Project;
}

/** 既存チェックに一切引っかからない、健全な選択式設問。 */
function cleanChoice(code: string, sortOrder: number, partial: Partial<Question> = {}): Question {
  return makeQuestion({
    question_code: code,
    question_type: "single_choice",
    sort_order: sortOrder,
    question_config: { options: [{ value: "1", label: "はい" }, { value: "2", label: "いいえ" }] },
    ...partial
  });
}

const CODES = (report: ReturnType<typeof validateSurvey>): string[] => report.findings.map((f) => f.code);

// ---------------------------------------------------------------- 後方互換

test("後方互換: project を渡さなければ表示モードのfindingは1件も出ない", () => {
  const questions = [
    cleanChoice("Q1", 1, { ai_probe_enabled: true, branch_rule: [{ when: { operator: "equals", value: "1" }, targetQuestionCode: "Q2" }] }),
    cleanChoice("Q2", 2)
  ];
  const report = validateSurvey(questions);
  const codes = CODES(report);
  assert.ok(!codes.some((c) => c.startsWith("page_mode_")), "page_mode系は出ない");
  assert.ok(!codes.includes("answer_ui_preset_not_applied"));
  assert.ok(!codes.includes("chat_mode_without_ai_probe"));
  assert.ok(!codes.includes("new_answer_type_no_renderer"));
});

test("後方互換: null を渡しても同じ（project 取得失敗時に落ちない）", () => {
  const report = validateSurvey([cleanChoice("Q1", 1)], null);
  assert.equal(report.ok, true);
  assert.equal(report.findings.length, 0);
});

// ---------------------------------------------------------- survey_page error

test("survey_page × page group 全問未設定 = error", () => {
  const report = validateSurvey([cleanChoice("Q1", 1), cleanChoice("Q2", 2)], makeProject({ display_mode: "survey_page" }));
  assert.ok(CODES(report).includes("page_mode_without_page_group"));
  assert.equal(report.ok, false);
});

test("survey_page でも page group が1問でも設定されていれば error にならない", () => {
  const questions = [cleanChoice("Q1", 1, { page_group_id: "pg-1" }), cleanChoice("Q2", 2)];
  const report = validateSurvey(questions, makeProject({ display_mode: "survey_page" }));
  assert.ok(!CODES(report).includes("page_mode_without_page_group"));
  assert.equal(report.ok, true);
});

test("設問0件の survey_page は page group 未設定 error を出さない（空案件で誤検知しない）", () => {
  const report = validateSurvey([], makeProject({ display_mode: "survey_page" }));
  assert.ok(!CODES(report).includes("page_mode_without_page_group"));
});

test("survey_page × branch_rule = error（設問コード付き）", () => {
  const questions = [
    cleanChoice("Q1", 1, {
      page_group_id: "pg-1",
      branch_rule: [{ when: { operator: "equals", value: "1" }, targetQuestionCode: "Q2" }]
    }),
    cleanChoice("Q2", 2, { page_group_id: "pg-1" })
  ];
  const report = validateSurvey(questions, makeProject({ display_mode: "survey_page" }));
  const finding = report.findings.find((f) => f.code === "page_mode_with_branch_rule");
  assert.ok(finding, "branch_rule error");
  assert.equal(finding?.level, "error");
  assert.equal(finding?.question_code, "Q1");
  assert.equal(report.ok, false);
});

test("survey_page × ai_probe_enabled = error", () => {
  const questions = [cleanChoice("Q1", 1, { page_group_id: "pg-1", ai_probe_enabled: true })];
  const report = validateSurvey(questions, makeProject({ display_mode: "survey_page" }));
  const finding = report.findings.find((f) => f.code === "page_mode_with_ai_probe");
  assert.equal(finding?.level, "error");
  assert.equal(finding?.question_code, "Q1");
  assert.equal(report.ok, false);
});

test("survey_question では branch_rule / ai_probe_enabled があっても error にならない（正常構成）", () => {
  const questions = [
    cleanChoice("Q1", 1, {
      ai_probe_enabled: true,
      branch_rule: [{ when: { operator: "equals", value: "1" }, targetQuestionCode: "Q2" }]
    }),
    cleanChoice("Q2", 2)
  ];
  const report = validateSurvey(questions, makeProject({ display_mode: "survey_question" }));
  assert.equal(report.errorCount, 0);
  assert.equal(report.ok, true);
});

// -------------------------------------------------------------- preset warning

for (const mode of ["survey_page", "interview_chat"] as DisplayMode[]) {
  for (const preset of ["casual", "formal"] as const) {
    test(`${mode} × answer_ui_preset=${preset} = warning`, () => {
      const questions = [cleanChoice("Q1", 1, { page_group_id: "pg-1", ai_probe_enabled: mode === "interview_chat" })];
      const report = validateSurvey(questions, makeProject({ display_mode: mode, answer_ui_preset: preset }));
      const finding = report.findings.find((f) => f.code === "answer_ui_preset_not_applied");
      assert.ok(finding, "preset warning");
      assert.equal(finding?.level, "warning");
      // Phase 1 の researchForm.ejs helper-text と表現を揃える
      assert.ok(
        finding?.message.includes("スワイプ等の回答UIプリセットは「1問1答」でのみ適用されます"),
        `helper-text と同じ表現を含む: ${finding?.message}`
      );
    });
  }
}

test("preset=standard / 未設定は warning にならない", () => {
  const q = [cleanChoice("Q1", 1, { page_group_id: "pg-1" })];
  for (const project of [
    makeProject({ display_mode: "survey_page", answer_ui_preset: "standard" }),
    makeProject({ display_mode: "survey_page" })
  ]) {
    assert.ok(!CODES(validateSurvey(q, project)).includes("answer_ui_preset_not_applied"));
  }
});

test("survey_question × casual は warning にならない（プリセットが効くモード）", () => {
  const report = validateSurvey(
    [cleanChoice("Q1", 1)],
    makeProject({ display_mode: "survey_question", answer_ui_preset: "casual" })
  );
  assert.ok(!CODES(report).includes("answer_ui_preset_not_applied"));
  assert.equal(report.ok, true);
});

// ------------------------------------------------------- interview_chat warning

test("interview_chat × ai_probe_enabled 0件 = warning", () => {
  const report = validateSurvey([cleanChoice("Q1", 1), cleanChoice("Q2", 2)], makeProject({ display_mode: "interview_chat" }));
  const finding = report.findings.find((f) => f.code === "chat_mode_without_ai_probe");
  assert.equal(finding?.level, "warning");
  assert.equal(report.ok, true, "warning は ok を落とさない");
});

test("interview_chat × ai_probe_enabled が1件でもあれば warning にならない", () => {
  const questions = [cleanChoice("Q1", 1, { ai_probe_enabled: true }), cleanChoice("Q2", 2)];
  const report = validateSurvey(questions, makeProject({ display_mode: "interview_chat" }));
  assert.ok(!CODES(report).includes("chat_mode_without_ai_probe"));
});

test("survey_question で probe 0件でも chat 用 warning は出ない", () => {
  const report = validateSurvey([cleanChoice("Q1", 1)], makeProject({ display_mode: "survey_question" }));
  assert.ok(!CODES(report).includes("chat_mode_without_ai_probe"));
});

// ---------------------------------------------------------- 新4型 warning

test("新4型（pairwise / ranking_top_n / point_allocation / image_heatmap）はレンダラ未実装で warning", () => {
  for (const type of ["pairwise", "ranking_top_n", "point_allocation", "image_heatmap"] as const) {
    const questions = [
      makeQuestion({
        question_code: "Q1",
        question_type: type,
        sort_order: 1,
        question_config: { options: [{ value: "1", label: "A" }, { value: "2", label: "B" }] }
      })
    ];
    const report = validateSurvey(questions, makeProject({ display_mode: "survey_question" }));
    const finding = report.findings.find((f) => f.code === "new_answer_type_no_renderer");
    assert.ok(finding, `${type} で warning`);
    assert.equal(finding?.level, "warning");
    assert.equal(finding?.question_code, "Q1");
    assert.equal(report.errorCount, 0, `${type} は error にはしない`);
  }
});

test("既存型（single_choice / free_text_long）では新型 warning は出ない", () => {
  const questions = [cleanChoice("Q1", 1), makeQuestion({ question_code: "Q2", question_type: "free_text_long", sort_order: 2 })];
  const report = validateSurvey(questions, makeProject({ display_mode: "survey_question" }));
  assert.ok(!CODES(report).includes("new_answer_type_no_renderer"));
});

// ------------------------------------------------------------------ 出力形式

test("出力形式: 追加findingも level/code/message を持ち、errorCount/warningCount/ok に反映される", () => {
  const questions = [
    cleanChoice("Q1", 1, {
      ai_probe_enabled: true,
      branch_rule: [{ when: { operator: "equals", value: "1" }, targetQuestionCode: "Q2" }]
    }),
    cleanChoice("Q2", 2)
  ];
  const report = validateSurvey(questions, makeProject({ display_mode: "survey_page", answer_ui_preset: "casual" }));
  const codes = CODES(report);
  // error 3種: page group 未設定 / branch_rule / ai_probe
  assert.ok(codes.includes("page_mode_without_page_group"));
  assert.ok(codes.includes("page_mode_with_branch_rule"));
  assert.ok(codes.includes("page_mode_with_ai_probe"));
  // warning: preset
  assert.ok(codes.includes("answer_ui_preset_not_applied"));

  for (const finding of report.findings) {
    assert.ok(finding.level === "error" || finding.level === "warning");
    assert.equal(typeof finding.code, "string");
    assert.ok(finding.message.length > 0);
  }
  assert.equal(report.errorCount, report.findings.filter((f) => f.level === "error").length);
  assert.equal(report.warningCount, report.findings.filter((f) => f.level === "warning").length);
  assert.equal(report.ok, false);
  assert.ok(Array.isArray(report.dependencies), "dependencies は従来どおり返る");
});

test("is_system 設問は表示モードチェックの対象外", () => {
  const questions = [
    cleanChoice("Q1", 1, { page_group_id: "pg-1" }),
    cleanChoice("SYS", 2, { is_system: true, ai_probe_enabled: true, page_group_id: null })
  ];
  const report = validateSurvey(questions, makeProject({ display_mode: "survey_page" }));
  assert.ok(!CODES(report).includes("page_mode_with_ai_probe"));
});
