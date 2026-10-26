/**
 * tsuribuneJokerSurveySeed.test.ts
 *
 * 釣り船ジョーカー お客様アンケートの seed（scripts/seedTsuribuneJokerSurveyProject.mjs）の不変条件。
 * 調査票（Box シート「釣り船ジョーカー」）の条件（フルランダマイズ / fix / ex / FA / SAMTX / 任意）との対応を固定する。
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { computeOptionOrder } from "../lib/optionRandomization";

type Option = { value: string; label: string; exclusive?: boolean; exclusive_with?: string[]; allow_free_text?: boolean };
type Question = {
  question_code: string;
  question_type: string;
  sort_order: number;
  is_required: boolean;
  comment_bottom: string | null;
  question_config: Record<string, any>;
  visibility_conditions?: { type: string; expression: string }[] | null;
  display_tags_parsed?: Record<string, any>;
};

let seed: any;
let questions: Question[];

before(async () => {
  const SEED_MODULE: string = "../../scripts/seedTsuribuneJokerSurveyProject.mjs";
  seed = await import(SEED_MODULE);
  questions = seed.buildQuestions();
});

const byCode = (code: string): Question => {
  const q = questions.find((x) => x.question_code === code);
  assert.ok(q, `設問 ${code} が見つかりません`);
  return q!;
};
const opt = (q: Question, value: string): Option => q.question_config.options.find((o: Option) => o.value === value);

test("管理用名・表示タイトル・管理番号が調査票どおりで、作成のみ（draft）・謝礼なし", () => {
  assert.equal(seed.project.name, "2026-C0003-0001_釣り船ジョーカー");
  assert.equal(seed.project.user_display_title, "釣り船ジョーカーお客様アンケート");
  assert.equal(seed.project.client_name, "釣り船ジョーカー");
  assert.equal(seed.project.management_year, 2026);
  assert.equal(seed.project.confirmed_number, 1);
  assert.equal(seed.CLIENT.company_code, "C0003");
  assert.equal(seed.project.status, "draft");
  assert.equal(seed.project.reward_points, 0);
  assert.equal(seed.project.entry_code, "tsuribune-joker");
});

test("Q1〜Q15 が順番どおり・B列が全員なので表示条件なし・同時表示なし", () => {
  assert.deepEqual(questions.map((q) => q.question_code), Array.from({ length: 15 }, (_, i) => `Q${i + 1}`));
  assert.deepEqual(questions.map((q) => q.sort_order), Array.from({ length: 15 }, (_, i) => i + 1));
  for (const q of questions) {
    assert.equal(q.visibility_conditions, null, `${q.question_code} に表示条件がある`);
    assert.equal(q.display_tags_parsed, undefined, `${q.question_code} に display tag がある`);
  }
});

test("Q2 年齢は numeric 1〜100・Q4 はカレンダー（本日まで）", () => {
  const q2 = byCode("Q2");
  assert.equal(q2.question_type, "numeric");
  assert.equal(q2.question_config.min, 1);
  assert.equal(q2.question_config.max, 100);
  const q4 = byCode("Q4");
  assert.equal(q4.question_type, "date");
  assert.equal(q4.question_config.date_max_offset, 0);
  assert.match(q4.comment_bottom ?? "", /本日乗船した場合/);
});

test("Q6 船釣り経験は5択・補足は comment_bottom", () => {
  const q6 = byCode("Q6");
  assert.equal(q6.question_type, "single_choice");
  assert.deepEqual(
    q6.question_config.options.map((o: Option) => o.label),
    ["１回目（今回が初めて）", "２回目", "３回目～５回目", "６回目～９回目", "１０回～"]
  );
  assert.equal(q6.comment_bottom, "海・川・湖は問いません。");
});

test("Q7 ひとりで は例外なしの排他・その他(13) は記述つき・その他の家族・親族 は記述なし", () => {
  const q7 = byCode("Q7");
  assert.equal(q7.question_config.options.length, 13);
  const alone = opt(q7, "1");
  assert.equal(alone.label, "ひとりで");
  assert.equal(alone.exclusive, true);
  assert.equal(alone.exclusive_with, undefined);
  assert.equal(opt(q7, "10").label, "その他の家族・親族");
  assert.equal(opt(q7, "10").allow_free_text, false);
  assert.equal(opt(q7, "13").allow_free_text, true);
  assert.equal(q7.question_config.option_randomization, undefined);
});

test("Q8: 1〜11 はフルランダム・fix(12 その他, 13 覚えていない) は末尾で先頭に来ない", () => {
  const q8 = byCode("Q8");
  assert.equal(q8.question_config.options.length, 13);
  assert.equal(opt(q8, "4").label, "釣具店からの紹介");
  assert.equal(opt(q8, "11").label, "漁港で見かけた");
  assert.equal(opt(q8, "12").allow_free_text, true);
  assert.equal(opt(q8, "13").exclusive, true);
  assert.deepEqual(q8.question_config.option_randomization.anchored_values, ["12", "13"]);
  assert.equal(q8.question_config.option_randomization.groups.length, 1);
  assert.equal(q8.question_config.option_randomization.groups[0].keep_order, undefined);
  const firsts = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const order = computeOptionOrder(q8.question_config.options, q8.question_config.option_randomization, `s${i}:Q8`).map((o) => o.value);
    assert.equal(order.length, 13);
    assert.deepEqual(order.slice(-2), ["12", "13"]);
    firsts.add(order[0]!);
  }
  assert.ok(firsts.size > 3, "グループ1がランダムになっていない");
});

test("Q9: 1〜14 はフルランダム・fix(15 その他, 16 なんとなく・特になし) は末尾", () => {
  const q9 = byCode("Q9");
  assert.equal(q9.question_config.options.length, 16);
  assert.equal(opt(q9, "15").allow_free_text, true);
  assert.equal(opt(q9, "16").exclusive, true);
  assert.equal(opt(q9, "16").label, "なんとなく・特になし");
  const firsts = new Set<string>();
  for (let i = 0; i < 50; i++) {
    const order = computeOptionOrder(q9.question_config.options, q9.question_config.option_randomization, `s${i}:Q9`).map((o) => o.value);
    assert.equal(order.length, 16);
    assert.deepEqual(order.slice(-2), ["15", "16"]);
    firsts.add(order[0]!);
  }
  assert.ok(firsts.size > 3);
});

test("Q10 満足度5択・Q11 は自由記述（必須）・Q14 再利用意向5択", () => {
  assert.equal(byCode("Q10").question_config.options.length, 5);
  assert.equal(byCode("Q11").question_type, "free_text_long");
  assert.equal(byCode("Q11").is_required, true);
  assert.deepEqual(
    byCode("Q14").question_config.options.map((o: Option) => o.label),
    ["とても利用したい", "やや利用したい", "どちらともいえない", "あまり利用したくない", "まったく利用したくない"]
  );
});

test("Q12 SAMTX は 11行×6列・ランダムなし・Q13 は同じ11項目＋その他＋特になし", () => {
  const q12 = byCode("Q12");
  assert.equal(q12.question_type, "matrix_single");
  assert.equal(q12.question_config.matrix_rows.length, 11);
  assert.equal(q12.question_config.matrix_cols.length, 6);
  assert.equal(q12.question_config.matrix_cols[5].label, "利用していない・分からない");
  assert.equal(q12.question_config.option_randomization, undefined);
  assert.match(q12.comment_bottom ?? "", /利用していない・分からない/);
  const q13 = byCode("Q13");
  assert.equal(q13.question_config.options.length, 13);
  assert.deepEqual(
    q13.question_config.options.slice(0, 11).map((o: Option) => o.label),
    q12.question_config.matrix_rows.map((r: Option) => r.label)
  );
  assert.equal(opt(q13, "12").allow_free_text, true);
  assert.equal(opt(q13, "13").exclusive, true);
});

test("Q15 は任意の自由記述", () => {
  const q15 = byCode("Q15");
  assert.equal(q15.question_type, "free_text_long");
  assert.equal(q15.is_required, false);
});
