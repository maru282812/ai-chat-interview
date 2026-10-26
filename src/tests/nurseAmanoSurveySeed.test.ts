/**
 * nurseAmanoSurveySeed.test.ts
 *
 * 看護師（天野）授業後アンケートの seed（scripts/seedNurseAmanoSurveyProject.mjs）の不変条件。
 * 調査票（Box シート「看護師（天野）」）の条件（ex / FA / fix / F列ランダム / SAMTX / 任意）との対応を固定する。
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { computeOptionOrder } from "../lib/optionRandomization";

type Option = { value: string; label: string; exclusive?: boolean; allow_free_text?: boolean };
type Question = {
  question_code: string;
  question_type: string;
  sort_order: number;
  is_required: boolean;
  question_config: Record<string, any>;
  visibility_conditions?: unknown;
};

let seed: any;
let questions: Question[];

before(async () => {
  const SEED_MODULE: string = "../../scripts/seedNurseAmanoSurveyProject.mjs";
  seed = await import(SEED_MODULE);
  questions = seed.buildQuestions();
});

const byCode = (code: string): Question => {
  const q = questions.find((x) => x.question_code === code);
  assert.ok(q, `設問 ${code} が見つかりません`);
  return q!;
};
const opts = (code: string): Option[] => byCode(code).question_config.options;

test("管理用名・表示タイトル・管理番号が調査票どおりで、作成のみ（draft）・謝礼なし", () => {
  assert.equal(seed.project.name, "2026-C0005-0001_看護師（天野）");
  assert.equal(seed.project.user_display_title, "授業後アンケート");
  assert.equal(seed.project.client_name, "看護師（天野）");
  assert.equal(seed.project.management_year, 2026);
  assert.equal(seed.project.confirmed_number, 1);
  assert.equal(seed.CLIENT.company_code, "C0005");
  assert.equal(seed.project.status, "draft");
  assert.equal(seed.project.reward_points, 0);
});

test("Q1〜Q16 が順番どおり・全員表示・ランダマイズは Q14 のみ", () => {
  assert.deepEqual(questions.map((q) => q.question_code), Array.from({ length: 16 }, (_, i) => `Q${i + 1}`));
  assert.deepEqual(questions.map((q) => q.sort_order), Array.from({ length: 16 }, (_, i) => i + 1));
  for (const q of questions) {
    assert.equal(q.visibility_conditions, null);
    if (q.question_code !== "Q14") assert.equal(q.question_config.option_randomization, undefined, q.question_code);
  }
});

test("性別のその他は記述欄なし・Q3/Q4/Q6/Q14 のその他（）は記述欄あり", () => {
  assert.equal(opts("Q1")[2]?.allow_free_text, false);
  for (const [code, value] of [["Q3", "3"], ["Q4", "7"], ["Q6", "4"], ["Q14", "6"]] as const) {
    const o = opts(code).find((x) => x.value === value)!;
    assert.equal(o.label, "その他", code);
    assert.equal(o.allow_free_text, true, code);
  }
});

test("Q2 年齢は年代 SA 7択", () => {
  assert.equal(byCode("Q2").question_type, "single_choice");
  assert.deepEqual(opts("Q2").map((o) => o.label), ["10代", "20代", "30代", "40代", "50代", "60代", "70代以上"]);
});

test("Q9 SAMTX = 行4項目×列5段階", () => {
  const c = byCode("Q9").question_config;
  assert.equal(byCode("Q9").question_type, "matrix_single");
  assert.deepEqual(c.matrix_rows.map((r: Option) => r.label), seed.ASPECTS);
  assert.equal(c.matrix_cols.length, 5);
});

test("Q14: 1〜5 は同一グループでフルランダム・6/7 は fix・7 は排他", () => {
  const q14 = byCode("Q14");
  assert.equal(q14.question_type, "multi_choice");
  const r = q14.question_config.option_randomization;
  assert.equal(r.enabled, true);
  assert.deepEqual(r.groups, [{ label: "1", values: ["1", "2", "3", "4", "5"] }]);
  assert.deepEqual(r.anchored_values, ["6", "7"]);
  assert.deepEqual(opts("Q14").filter((o) => o.exclusive).map((o) => [o.value, o.label]), [["7", "特になし"]]);
});

test("Q14 の並びは回答者ごとに変わり、fix は常に末尾（先頭に来ない）", () => {
  const q14 = byCode("Q14");
  const orders = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const shown = computeOptionOrder(opts("Q14") as any, q14.question_config.option_randomization, `seed-${i}`);
    const values = shown.map((o: Option) => o.value);
    assert.deepEqual(values.slice(-2), ["6", "7"]);
    assert.deepEqual([...values.slice(0, 5)].sort(), ["1", "2", "3", "4", "5"]);
    orders.add(values.join(","));
  }
  assert.ok(orders.size > 5, `並びのバリエーションが少なすぎる: ${orders.size}`);
});

test("Q12/Q13/Q15/Q16 の「〜があれば」FA は任意・それ以外は必須", () => {
  for (const q of questions) {
    const optional = ["Q12", "Q13", "Q15", "Q16"].includes(q.question_code);
    assert.equal(q.is_required, !optional, q.question_code);
    if (optional) assert.equal(q.question_type, "free_text_long");
  }
});
