/**
 * eigyoSalonSurveySeed.test.ts
 *
 * （営業）美容室 お客様アンケートの seed（scripts/seedEigyoSalonSurveyProject.mjs）の不変条件。
 * 調査票（Box シート「（営業）美容室」）の条件（ex / 排他 / FA / fix / SAMTX / 1〜7スケール / 任意）との対応を固定する。
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { resolveAnswerPresentation } from "../lib/answerPresentation";

type Option = { value: string; label: string; exclusive?: boolean; allow_free_text?: boolean };
type Question = {
  question_code: string;
  question_type: string;
  sort_order: number;
  is_required: boolean;
  comment_bottom: string | null;
  question_config: Record<string, any>;
  visibility_conditions?: unknown;
};

let seed: any;
let questions: Question[];

before(async () => {
  const SEED_MODULE: string = "../../scripts/seedEigyoSalonSurveyProject.mjs";
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
  assert.equal(seed.project.name, "2026-C0004-0001_（営業）美容室");
  assert.equal(seed.project.user_display_title, "美容室お客様アンケート");
  assert.equal(seed.project.client_name, "（営業）美容室");
  assert.equal(seed.project.management_year, 2026);
  assert.equal(seed.project.confirmed_number, 1);
  assert.equal(seed.CLIENT.company_code, "C0004");
  assert.equal(seed.project.status, "draft");
  assert.equal(seed.project.reward_points, 0);
});

test("Q1〜Q13 が順番どおり・全員表示・ランダマイズなし", () => {
  assert.deepEqual(questions.map((q) => q.question_code), Array.from({ length: 13 }, (_, i) => `Q${i + 1}`));
  assert.deepEqual(questions.map((q) => q.sort_order), Array.from({ length: 13 }, (_, i) => i + 1));
  for (const q of questions) {
    assert.equal(q.visibility_conditions, null);
    assert.equal(q.question_config.option_randomization, undefined, `${q.question_code} にランダマイズがある`);
  }
});

test("性別のその他は記述欄なし・Q3/Q6/Q7/Q11 のその他（）は記述欄あり", () => {
  assert.equal(opts("Q1")[2].allow_free_text, false);
  for (const [code, value] of [["Q3", "3"], ["Q6", "7"], ["Q7", "10"], ["Q11", "13"]] as const) {
    const o = opts(code).find((x) => x.value === value)!;
    assert.equal(o.label, "その他", code);
    assert.equal(o.allow_free_text, true, code);
  }
});

test("排他: Q7-11 覚えていない・Q11-14 特になし（fix は末尾）", () => {
  const q7 = opts("Q7");
  assert.equal(q7.length, 11);
  assert.deepEqual(q7.filter((o) => o.exclusive).map((o) => o.value), ["11"]);
  const q11 = opts("Q11");
  assert.equal(q11.length, 14);
  assert.deepEqual(q11.slice(-2).map((o) => o.value), ["13", "14"]);
  assert.deepEqual(q11.filter((o) => o.exclusive).map((o) => [o.value, o.label]), [["14", "特になし"]]);
  assert.deepEqual(q11.slice(0, 12).map((o) => o.label), seed.ASPECTS);
});

test("Q2 年齢 numeric 1〜100・Q4 カレンダー本日まで", () => {
  assert.equal(byCode("Q2").question_type, "numeric");
  assert.equal(byCode("Q2").question_config.max, 100);
  assert.equal(byCode("Q4").question_type, "date");
  assert.equal(byCode("Q4").question_config.date_max_offset, 0);
});

test("Q10 SAMTX = 行12項目×列6（利用していない含む）・ページ4件", () => {
  const c = byCode("Q10").question_config;
  assert.equal(byCode("Q10").question_type, "matrix_single");
  assert.deepEqual(c.matrix_rows.map((r: Option) => r.label), seed.ASPECTS);
  assert.equal(c.matrix_cols.length, 6);
  assert.equal(c.matrix_cols[5].label, "利用していない・分からない");
  assert.equal(c.presentation.pattern, "matrix_list");
});

test("Q12 は 1〜7 のスケール・ラベルは 1/4/7 のみ・ドラムにならない", () => {
  const q12 = byCode("Q12");
  assert.equal(q12.question_type, "numeric");
  const o = q12.question_config.options as Option[];
  assert.deepEqual(o.map((x) => x.value), ["1", "2", "3", "4", "5", "6", "7"]);
  assert.deepEqual(o.filter((x) => x.label !== x.value).map((x) => x.value), ["1", "4", "7"]);
  const p = resolveAnswerPresentation(q12 as any, "standard");
  assert.notEqual(p.pattern, "number_wheel");
});

test("Q9 は必須・Q13 は任意", () => {
  assert.equal(byCode("Q9").is_required, true);
  assert.equal(byCode("Q13").is_required, false);
});
