/**
 * kasumigauraAquariumSurveySeed.test.ts
 *
 * かすみがうら市水族館アンケートの seed（scripts/seedKasumigauraAquariumSurveyProject.mjs）の不変条件。
 * seed は「データ」なので typecheck が効かない。調査票の条件（ランダマイズ / 固定 / 排他 /
 * 表示条件 / 同時表示 / 同順 / 画像）との対応が崩れていないことをここで固定する。
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { computeOptionOrder } from "../lib/optionRandomization";

type Option = { value: string; label: string; exclusive?: boolean; allow_free_text?: boolean; imageUrl?: string };
type Question = {
  question_code: string;
  question_type: string;
  sort_order: number;
  is_required: boolean;
  question_config: Record<string, any>;
  visibility_conditions?: { type: string; expression: string }[] | null;
  display_tags_parsed?: Record<string, any>;
};

const IMAGE_KEYS = ["map", "202607_1", "202607_2", "202607_3", "202607_4", "202607_5", "202607_6", "202607_7", "202607_8", "202607_9", "suiso_1"];
const stubUrls = Object.fromEntries(IMAGE_KEYS.map((k) => [k, `https://img.test/${k}.jpg`]));

let seed: any;
let questions: Question[];

before(async () => {
  const SEED_MODULE: string = "../../scripts/seedKasumigauraAquariumSurveyProject.mjs";
  seed = await import(SEED_MODULE);
  questions = seed.buildQuestions(stubUrls);
});

const byCode = (code: string): Question => {
  const q = questions.find((x) => x.question_code === code);
  assert.ok(q, `設問 ${code} が見つかりません`);
  return q!;
};
const opt = (q: Question, value: string): Option => q.question_config.options.find((o: Option) => o.value === value);

test("管理用名・表示タイトル・管理番号が調査票どおりで、作成のみ（draft）", () => {
  assert.equal(seed.project.name, "2026-C0001-0001_かすみがうら市水族館");
  assert.equal(seed.project.user_display_title, "かすみがうら市水族館アンケート");
  assert.equal(seed.project.management_year, 2026);
  assert.equal(seed.project.confirmed_number, 1);
  assert.equal(seed.CLIENT.company_code, "C0001");
  assert.equal(seed.project.status, "draft");
  assert.equal(seed.project.is_discoverable, false);
});

test("Q1〜Q18 が順番どおりに並ぶ", () => {
  assert.deepEqual(questions.map((q) => q.question_code), Array.from({ length: 18 }, (_, i) => `Q${i + 1}`));
  assert.deepEqual(questions.map((q) => q.sort_order), Array.from({ length: 18 }, (_, i) => i + 1));
});

test("Q3 は47都道府県＋海外", () => {
  const opts = byCode("Q3").question_config.options;
  assert.equal(opts.length, 48);
  assert.equal(opts.at(-1).label, "海外");
});

test("Q6 ひとりで=排他・その他=記述欄・その他の家族=記述欄なし", () => {
  const q6 = byCode("Q6");
  assert.equal(opt(q6, "1").exclusive, true);
  assert.equal(opt(q6, "13").allow_free_text, true);
  assert.equal(opt(q6, "10").label, "その他の家族・親族");
  assert.equal(opt(q6, "10").allow_free_text, false);
});

test("Q7・Q8・Q15 はフルランダム・固定は先頭に来ず末尾に残る", () => {
  for (const [code, fixed] of [["Q7", ["11", "12"]], ["Q8", ["11"]], ["Q15", ["12", "13"]]] as const) {
    const q = byCode(code);
    assert.deepEqual(q.question_config.option_randomization.anchored_values, fixed);
    for (let i = 0; i < 30; i++) {
      const order = computeOptionOrder(q.question_config.options, q.question_config.option_randomization, `s${i}:${code}`);
      assert.equal(order.length, q.question_config.options.length, `${code} 選択肢が欠けた`);
      assert.ok(!fixed.includes(order[0]!.value as never), `${code} 固定が先頭に来た`);
      assert.deepEqual(order.slice(-fixed.length).map((o) => o.value), [...fixed]);
    }
  }
});

test("Q9・Q10 は最大3つ・マップを大きく表示・Q10 は Q9 で絞らない", () => {
  for (const code of ["Q9", "Q10"]) {
    const q = byCode(code);
    assert.equal(q.question_config.max_select, 3);
    assert.equal(q.question_config.question_text_image.mainUrl, stubUrls.map);
  }
  assert.equal(byCode("Q10").display_tags_parsed?.optionSource, undefined);
  assert.equal(opt(byCode("Q10"), "13").exclusive, true);
});

test("Q10 は Q6 の 6〜8 のいずれか（OR）で表示", () => {
  const [cond] = byCode("Q10").visibility_conditions!;
  assert.equal(cond!.expression, "q6 includes 6 or q6 includes 7 or q6 includes 8");
  assert.deepEqual([6, 7, 8].map((v) => opt(byCode("Q6"), String(v)).label), [
    "小学生以下のお子さま",
    "中学生のお子さま",
    "高校生のお子さま",
  ]);
});

test("Q11 と Q12 は同じ画面", () => {
  assert.equal(byCode("Q11").display_tags_parsed?.screenGroup.groupId, byCode("Q12").display_tags_parsed?.screenGroup.groupId);
});

test("謝礼なし", () => {
  assert.equal(seed.project.reward_points, 0);
});

test("イベント名の表記", () => {
  const labels = byCode("Q15").question_config.options.map((o: Option) => o.label);
  assert.ok(labels.includes("オオサンショウウオの計測会"));
  assert.ok(labels.includes("ウーパールーパー飼育教室"));
});

test("Q16 は Q15 で選んだイベントだけ＋特になし・Q15 でイベントを選んだ人だけに表示", () => {
  const q16 = byCode("Q16");
  assert.deepEqual(q16.display_tags_parsed?.optionSource, { fromQuestion: "q15", mode: "selected", alwaysInclude: ["13"] });
  assert.equal(opt(q16, "12"), undefined); // その他は持ち越せないので出さない
  assert.equal(opt(q16, "13").exclusive, true);
  const expr = q16.visibility_conditions![0]!.expression;
  assert.equal(expr.split(" or ").length, 11);
  assert.ok(!/includes 1[23]\b/.test(expr));
});

test("Q16・Q17 は Q15 と同順・同じ value・同じ画像・Q17 は全イベント", () => {
  const q15 = byCode("Q15");
  for (const code of ["Q16", "Q17"]) {
    assert.equal(byCode(code).question_config.option_randomization.follow_question, "Q15");
  }
  assert.deepEqual(byCode("Q17").question_config.options, q15.question_config.options);
  assert.equal(byCode("Q17").display_tags_parsed, undefined);
  // 画像は出前授業以外の10件に付く
  const withImage = q15.question_config.options.filter((o: Option) => o.imageUrl).map((o: Option) => o.value);
  assert.deepEqual(withImage, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]);
  assert.equal(opt(q15, "10").imageUrl, stubUrls.suiso_1);
});
