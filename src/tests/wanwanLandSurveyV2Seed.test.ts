/**
 * wanwanLandSurveyV2Seed.test.ts
 *
 * つくばわんわんランド 来園者アンケート【改善版】の seed（scripts/seedWanwanLandSurveyV2Project.mjs）の不変条件と、
 * そのために足した2機能（持ち越しの alwaysInclude / 選択肢順の follow_question）の挙動。
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { applyCarryForward } from "../lib/questionEngine";
import { alignOptionOrder, computeOptionOrder } from "../lib/optionRandomization";
import { conflicts } from "../lib/optionExclusion";

type Option = { value: string; label: string; exclusive?: boolean; exclusive_with?: string[]; allow_free_text?: boolean; imageUrl?: string };
type Question = {
  question_code: string;
  question_type: string;
  sort_order: number;
  is_required: boolean;
  question_config: Record<string, any>;
  visibility_conditions?: { type: string; expression: string }[] | null;
  display_tags_parsed?: Record<string, any>;
  comment_bottom?: string | null;
};

const IMAGE_KEYS = [
  "rental", "fureai", "mokkun", "dream_show", "race_show", "neko_house",
  "puppy_hall", "large_dog_hall", "dakkun", "dog_run", "kitchen", "gift_shop",
];
const stubUrls = Object.fromEntries(IMAGE_KEYS.map((k) => [k, `https://img.test/${k}.jpg`]));

let seed: any;
let questions: Question[];

before(async () => {
  const SEED_MODULE: string = "../../scripts/seedWanwanLandSurveyV2Project.mjs";
  seed = await import(SEED_MODULE);
  questions = seed.buildQuestions(stubUrls);
});

const byCode = (code: string): Question => {
  const q = questions.find((x) => x.question_code === code);
  assert.ok(q, `設問 ${code} が見つかりません`);
  return q!;
};
const valuesOf = (q: Question): string[] => (q.question_config.options ?? []).map((o: Option) => o.value);
const opt = (q: Question, value: string): Option => q.question_config.options.find((o: Option) => o.value === value);

test("案件: 初版と別ID・別entry_code、回答者向けタイトル", () => {
  assert.notEqual(seed.PROJECT_ID, "1a0d0001-0000-4000-8000-000000000001");
  assert.equal(seed.ENTRY_CODE, "wanwan-land-v2");
  assert.equal(seed.project.user_display_title, "わんわんらんどの簡単アンケート");
  assert.equal(seed.project.visibility_type, "private_store");
  assert.equal(seed.project.is_discoverable, false);
});

test("Q1〜Q15 の15問・sort_order 連番", () => {
  assert.deepEqual(questions.map((q) => q.question_code), Array.from({ length: 15 }, (_, i) => `Q${i + 1}`));
  assert.deepEqual(questions.map((q) => q.sort_order), questions.map((_, i) => i + 1));
});

test("Q5: ひとりで はペット以外（その他を含む）と排他、ペットとは同時選択できる", () => {
  const q5 = byCode("Q5");
  const alone = opt(q5, "alone");
  for (const o of q5.question_config.options as Option[]) {
    if (o.value === "alone") continue;
    assert.equal(conflicts(alone as any, o as any), o.value !== "pet", `ひとりで × ${o.label}`);
  }
  // 他の選択肢同士は排他にならない
  assert.equal(conflicts(opt(q5, "spouse") as any, opt(q5, "pet") as any), false);
  assert.equal(valuesOf(q5).length, 14);
  // 「その他」始まりでも記述欄を出すのは末尾の「その他」だけ
  assert.equal(opt(q5, "other_family").allow_free_text, false);
  assert.equal(opt(q5, "other").allow_free_text, true);
});

test("Q6 / Q7 / Q13 は F列どおりのグループランダム、Q8〜Q10 はランダムなし", () => {
  for (const code of ["Q6", "Q7", "Q13"]) assert.equal(byCode(code).question_config.option_randomization?.enabled, true, code);
  for (const code of ["Q8", "Q9", "Q10"]) assert.equal(byCode(code).question_config.option_randomization, undefined, code);
  const q7groups = byCode("Q7").question_config.option_randomization.groups.map((g: any) => g.values);
  assert.ok(q7groups.some((v: string[]) => v.join() === "touch_dogs,touch_cats"));
  assert.ok(q7groups.some((v: string[]) => v.join() === "child_experience,child_request"));
  const q13groups = byCode("Q13").question_config.option_randomization.groups.map((g: any) => g.values);
  assert.ok(q13groups.some((v: string[]) => v.join() === "cleanliness,smell"));
  // その他 / 覚えていない は末尾固定
  assert.deepEqual(byCode("Q6").question_config.option_randomization.anchored_values, ["other", "unknown"]);
});

test("Q8〜Q10 は写真つきカード、Q9/Q10 は最大3つ", () => {
  for (const code of ["Q8", "Q9", "Q10"]) {
    const q = byCode(code);
    assert.equal(q.question_config.display_format, "card");
    assert.equal(opt(q, "rental").imageUrl, "https://img.test/rental.jpg");
  }
  assert.equal(byCode("Q9").question_config.max_select, 3);
  assert.equal(byCode("Q10").question_config.max_select, 3);
  assert.deepEqual(valuesOf(byCode("Q10")).slice(-5), ["anpanman_play", "lawn_play", "other", "none", "unknown"]);
});

test("Q9: Q8で選んだもの＋常に特になし（Q8が特になしなら出ない）", () => {
  const q9 = byCode("Q9");
  assert.equal(q9.visibility_conditions?.[0]?.expression, "not q8 includes none");
  const source = q9.display_tags_parsed?.optionSource;
  const result = applyCarryForward(q9.question_config.options, source, { answers: { q8: ["neko_house", "rental"] } } as any);
  // 並びは Q9 の基底順（＝Q8 と同じ固定順）
  assert.deepEqual(result.map((o) => o.value), ["rental", "neko_house", "none"]);
});

test("Q10: Q5 の小学生以下・中学生・高校生のお子さまで表示（大学生以上は対象外）", () => {
  const expr = byCode("Q10").visibility_conditions?.[0]?.expression ?? "";
  for (const v of ["child_elementary", "child_junior_high", "child_high_school"]) assert.ok(expr.includes(`q5 includes ${v}`));
  assert.ok(!expr.includes("child_university"));
  assert.equal(byCode("Q10").display_tags_parsed?.optionSource, undefined, "Q10はQ8で絞らない");
});

test("Q11 と Q12 は同じ画面", () => {
  assert.equal(byCode("Q11").display_tags_parsed?.screenGroup?.groupId, "overall");
  assert.equal(byCode("Q12").display_tags_parsed?.screenGroup?.groupId, "overall");
});

test("Q14 は Q13 の表示順にそろう（その他 / 特になしは末尾）", () => {
  const q13 = byCode("Q13");
  const q14 = byCode("Q14");
  assert.equal(q14.question_config.option_randomization.follow_question, "Q13");
  const rows = computeOptionOrder(q13.question_config.matrix_rows, q13.question_config.option_randomization, "sess-1:q13");
  const aligned = alignOptionOrder(q14.question_config.options, rows.map((r: Option) => r.value));
  assert.deepEqual(aligned.map((o) => o.value), [...rows.map((r: Option) => r.value), "other", "none"]);
  assert.deepEqual(new Set(valuesOf(q14).slice(0, 12)), new Set(q13.question_config.matrix_rows.map((r: Option) => r.value)));
});

test("alignOptionOrder: 参照に無い選択肢は元の位置に残る", () => {
  const options = [{ value: "a", label: "A" }, { value: "x", label: "X" }, { value: "b", label: "B" }, { value: "c", label: "C" }];
  assert.deepEqual(alignOptionOrder(options, ["c", "a", "b"]).map((o) => o.value), ["c", "x", "a", "b"]);
});
