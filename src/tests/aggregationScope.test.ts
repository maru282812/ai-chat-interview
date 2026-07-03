import assert from "node:assert/strict";
import { test } from "node:test";
import { type ProjectQuestions, collectClientMetrics } from "../lib/aggregationScope";
import type { Question } from "../types/domain";

function q(code: string, metric?: string): Question {
  return {
    id: `qid-${code}-${metric ?? "none"}`,
    project_id: "p",
    question_code: code,
    question_text: "Q",
    comment_top: null,
    comment_bottom: null,
    question_role: "main",
    question_type: "single_choice",
    is_required: true,
    sort_order: 1,
    answer_output_type: null,
    display_tags_raw: null,
    display_tags_parsed: null,
    visibility_conditions: null,
    page_group_id: null,
    branch_rule: null,
    question_config: metric ? { meta: { metric_code: metric } } : null,
    ai_probe_enabled: false,
    probe_guideline: null,
    max_probe_count: null,
    render_strategy: "static",
    answer_options_locked: false,
    is_screening_question: false,
    is_system: false,
    is_hidden: false,
    created_at: "2026-07-02T00:00:00.000Z",
    updated_at: "2026-07-02T00:00:00.000Z"
  };
}

test("collectClientMetrics: 空入力は空配列", () => {
  assert.deepEqual(collectClientMetrics([]), []);
  assert.deepEqual(collectClientMetrics([{ project_id: "p1", questions: [] }]), []);
});

test("collectClientMetrics: metric未設定設問は無視される", () => {
  const projects: ProjectQuestions[] = [{ project_id: "p1", questions: [q("Q1"), q("Q2")] }];
  assert.deepEqual(collectClientMetrics(projects), []);
});

test("collectClientMetrics: 同一project内の重複コードはproject_count=1", () => {
  const projects: ProjectQuestions[] = [
    { project_id: "p1", questions: [q("Q1", "satisfaction"), q("Q2", "satisfaction")] }
  ];
  const result = collectClientMetrics(projects);
  assert.equal(result.length, 1);
  assert.equal(result[0]!.code, "satisfaction");
  assert.equal(result[0]!.label, "満足度");
  assert.equal(result[0]!.project_count, 1);
});

test("collectClientMetrics: 複数projectで横断集計しproject_count降順→code昇順で並ぶ", () => {
  const projects: ProjectQuestions[] = [
    { project_id: "p1", questions: [q("Q1", "satisfaction"), q("Q2", "nps")] },
    { project_id: "p2", questions: [q("Q1", "satisfaction"), q("Q2", "custom_metric")] }
  ];
  const result = collectClientMetrics(projects);
  // satisfaction=2, nps=1, custom_metric=1 → 2件目以降は code 昇順（custom_metric < nps）
  assert.deepEqual(
    result.map((m) => [m.code, m.project_count]),
    [
      ["satisfaction", 2],
      ["custom_metric", 1],
      ["nps", 1]
    ]
  );
  // 未知コードはラベル＝コード名
  assert.equal(result.find((m) => m.code === "custom_metric")!.label, "custom_metric");
});
