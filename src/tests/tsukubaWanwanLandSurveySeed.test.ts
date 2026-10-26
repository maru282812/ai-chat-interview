/**
 * tsukubaWanwanLandSurveySeed.test.ts
 *
 * つくばわんわんランド お客様アンケートの seed（scripts/seedTsukubaWanwanLandSurveyProject.mjs）の不変条件。
 * 調査票の条件（階層ランダマイズ / fix / ex と例外 / 表示条件 / 持ち越し / 同時表示 / 画像）との対応を固定する。
 * あわせて、F列の小数（1.1, 1.2）を「同じ群・この順」で出す groups[].keep_order の挙動も確認する。
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { computeOptionOrder } from "../lib/optionRandomization";

type Option = { value: string; label: string; exclusive?: boolean; exclusive_with?: string[]; allow_free_text?: boolean; imageUrl?: string };
type Question = {
  question_code: string;
  sort_order: number;
  is_required: boolean;
  question_config: Record<string, any>;
  visibility_conditions?: { type: string; expression: string }[] | null;
  display_tags_parsed?: Record<string, any>;
};

const IMAGE_KEYS = ["img_area01", "img_area10", ...Array.from({ length: 10 }, (_, i) => `img_enjoy${String(i + 2).padStart(2, "0")}`)];
const stubUrls = Object.fromEntries(IMAGE_KEYS.map((k) => [k, `https://img.test/${k}.jpg`]));

let seed: any;
let questions: Question[];

before(async () => {
  const SEED_MODULE: string = "../../scripts/seedTsukubaWanwanLandSurveyProject.mjs";
  seed = await import(SEED_MODULE);
  questions = seed.buildQuestions(stubUrls);
});

const byCode = (code: string): Question => {
  const q = questions.find((x) => x.question_code === code);
  assert.ok(q, `設問 ${code} が見つかりません`);
  return q!;
};
const opt = (q: Question, value: string): Option => q.question_config.options.find((o: Option) => o.value === value);

test("管理用名・表示タイトル・管理番号が調査票どおりで、作成のみ（draft）・謝礼なし", () => {
  assert.equal(seed.project.name, "2026-C0002-0001_つくばわんわんランド");
  assert.equal(seed.project.user_display_title, "つくばわんわんランドお客様アンケート");
  assert.equal(seed.project.management_year, 2026);
  assert.equal(seed.project.confirmed_number, 1);
  assert.equal(seed.CLIENT.company_code, "C0002");
  assert.equal(seed.project.status, "draft");
  assert.equal(seed.project.reward_points, 0);
});

test("Q1〜Q16 が順番どおり", () => {
  assert.deepEqual(questions.map((q) => q.question_code), Array.from({ length: 16 }, (_, i) => `Q${i + 1}`));
});

test("Q6 ひとりで はペット以外と排他（ペットとは同時選択可）", () => {
  const alone = opt(byCode("Q6"), "1");
  assert.equal(alone.exclusive, undefined);
  assert.ok(!alone.exclusive_with!.includes("13"));
  assert.deepEqual([...alone.exclusive_with!].sort((a, b) => +a - +b), ["2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "14"]);
  assert.equal(opt(byCode("Q6"), "13").label, "ペット");
  assert.equal(opt(byCode("Q6"), "14").allow_free_text, true);
});

test("Q8: 群の順はランダム・1.1→1.2 と 4.1→4.2 は連続かつ順序固定・その他は末尾", () => {
  const q8 = byCode("Q8");
  const seen = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const order = computeOptionOrder(q8.question_config.options, q8.question_config.option_randomization, `s${i}:Q8`).map((o) => o.value);
    assert.equal(order.length, 13);
    assert.equal(order.at(-1), "13");
    const a = order.indexOf("1");
    assert.equal(order[a + 1], "2", "1.1 の直後が 1.2 でない");
    const b = order.indexOf("5");
    assert.equal(order[b + 1], "6", "4.1 の直後が 4.2 でない");
    seen.add(order.join(","));
  }
  assert.ok(seen.size > 10, "群の順がランダムになっていない");
});

test("Q7: グループ1はフルランダム・fix は末尾で先頭に来ない", () => {
  const q7 = byCode("Q7");
  const firsts = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const order = computeOptionOrder(q7.question_config.options, q7.question_config.option_randomization, `s${i}:Q7`).map((o) => o.value);
    assert.deepEqual(order.slice(-2), ["11", "12"]);
    firsts.add(order[0]!);
  }
  assert.ok(firsts.size > 3);
});

test("Q10 は Q9 で特になし以外を選んだ人・Q9 で選んだもの＋特になし・最大3つ", () => {
  const q10 = byCode("Q10");
  assert.equal(q10.visibility_conditions![0]!.expression, "not q9 includes 15");
  assert.deepEqual(q10.display_tags_parsed?.optionSource, { fromQuestion: "q9", mode: "selected", alwaysInclude: ["15"] });
  assert.equal(q10.question_config.max_select, 3);
  assert.equal(opt(byCode("Q9"), "15").exclusive, true);
});

test("Q11 は Q6 の 6〜8 のいずれかで表示・Q9 で絞らない・17択", () => {
  const q11 = byCode("Q11");
  assert.equal(q11.visibility_conditions![0]!.expression, "q6 includes 6 or q6 includes 7 or q6 includes 8");
  assert.equal(q11.display_tags_parsed, undefined);
  assert.equal(q11.question_config.options.length, 17);
  assert.equal(opt(q11, "14").label, "アンパンマンの遊具");
  assert.equal(opt(q11, "17").exclusive, true);
});

test("画像は I列どおり（施設1〜13）", () => {
  for (const code of ["Q9", "Q10", "Q11"]) {
    const q = byCode(code);
    assert.equal(opt(q, "1").imageUrl, stubUrls.img_area01);
    assert.equal(opt(q, "13").imageUrl, stubUrls.img_area10);
    assert.equal(opt(q, "3").imageUrl, stubUrls.img_enjoy02);
  }
  assert.equal(opt(byCode("Q11"), "14").imageUrl, undefined);
});

test("Q12 と Q13 は同じ画面・Q14 は 12行×6列", () => {
  assert.equal(byCode("Q12").display_tags_parsed?.screenGroup.groupId, byCode("Q13").display_tags_parsed?.screenGroup.groupId);
  assert.equal(byCode("Q14").question_config.matrix_rows.length, 12);
  assert.equal(byCode("Q14").question_config.matrix_cols.length, 6);
});
