/**
 * wanwanLandSurveySeed.test.ts
 *
 * つくばわんわんランド 来園者アンケートの seed（scripts/seedWanwanLandSurveyProject.mjs）の不変条件。
 * seed は「データ」なので typecheck が効かず、壊れ方は本番投入まで分からない。
 * 調査票（F列の条件 = グループランダマイズ / 固定 / 排他 / 持ち越し / 画像表示）の
 * 対応関係が崩れていないことをここで固定する。
 */

import assert from "node:assert/strict";
import { before, test } from "node:test";
import { computeOptionOrder } from "../lib/optionRandomization";
import { resolveAnswerPresentation } from "../lib/answerPresentation";

type Option = {
  value: string;
  label: string;
  exclusive?: boolean;
  allow_free_text?: boolean;
  imageUrl?: string;
};
type Question = {
  question_code: string;
  question_type: string;
  sort_order: number;
  is_required: boolean;
  question_config: Record<string, any>;
  visibility_conditions?: { type: string; expression: string }[] | null;
  display_tags_parsed?: Record<string, any>;
};

const IMAGE_KEYS = [
  "rental", "fureai", "mokkun", "dream_show", "race_show", "neko_house",
  "puppy_hall", "large_dog_hall", "dakkun", "dog_run", "kitchen", "gift_shop",
];
const stubUrls = Object.fromEntries(IMAGE_KEYS.map((k) => [k, `https://img.test/${k}.jpg`]));

let seed: any;
let questions: Question[];

before(async () => {
  // seed は直接実行されたときだけ main() を走らせる（import は副作用なし）。
  // .mjs には型定義が無いので、パスを string 型にして TS の解決を避ける。
  const SEED_MODULE: string = "../../scripts/seedWanwanLandSurveyProject.mjs";
  seed = await import(SEED_MODULE);
  questions = seed.buildQuestions(stubUrls);
});

const byCode = (code: string): Question => {
  const q = questions.find((x) => x.question_code === code);
  assert.ok(q, `設問 ${code} が見つかりません`);
  return q!;
};
const valuesOf = (q: Question): string[] => (q.question_config.options ?? []).map((o: Option) => o.value);
const refsOf = (expr: string): string[] => [...expr.matchAll(/\b(q\d+)\b/gi)].map((m) => m[1]!.toUpperCase());

// ------------------------------------------------------------------

test("案件IDが UUID として妥当で、他の seed と衝突しない", () => {
  assert.match(seed.PROJECT_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.equal(seed.ENTRY_CODE, "wanwan-land");
  assert.equal(seed.project.visibility_type, "private_store");
  assert.equal(seed.project.is_discoverable, false);
});

test("question_code が一意で sort_order が 1..n の連番（調査票 Q1〜Q17 + 来園日）", () => {
  const codes = questions.map((q) => q.question_code);
  assert.equal(new Set(codes).size, codes.length);
  assert.deepEqual(questions.map((q) => q.sort_order), questions.map((_, i) => i + 1));
  assert.equal(questions.length, 18);
  assert.deepEqual(codes, ["Q1", "Q2", "Q3", "Q3B", "Q4", "Q5", "Q6", "Q7", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14", "Q15", "Q16", "Q17"]);
});

test("表示条件・持ち越しが参照する設問コードが実在し、参照先は前にある", () => {
  for (const q of questions) {
    for (const c of q.visibility_conditions ?? []) {
      for (const ref of refsOf(c.expression)) {
        const src = byCode(ref);
        assert.ok(src.sort_order < q.sort_order, `${q.question_code} の表示条件が後ろの ${ref} を参照`);
      }
    }
    const from = q.display_tags_parsed?.optionSource?.fromQuestion;
    if (from) {
      const src = byCode(String(from).toUpperCase());
      assert.ok(src.sort_order < q.sort_order, `${q.question_code} の持ち越し元 ${from} が後ろ`);
      // 持ち越しは value 一致で絞るため、参照元の value を全て持っていること
      const srcValues = new Set(valuesOf(src));
      for (const v of valuesOf(q)) assert.ok(srcValues.has(v), `${q.question_code} の ${v} が ${from} に無い`);
    }
  }
});

test("Q8 ← Q7、Q10 ← Q9 の持ち越し（選んだものだけ）＋最大3つ", () => {
  for (const [code, from] of [["Q8", "q7"], ["Q10", "q9"]] as const) {
    const q = byCode(code);
    assert.deepEqual(q.display_tags_parsed?.optionSource, { fromQuestion: from, mode: "selected" });
    assert.equal(q.question_config.max_select, 3);
  }
});

test("Q8 は Q7 が「特になし」のとき出ない / Q9・Q10 は子供ありのときだけ出る", () => {
  assert.equal(byCode("Q8").visibility_conditions?.[0]?.expression, "not q7 includes none");
  assert.ok(valuesOf(byCode("Q7")).includes("none"));
  const q4 = valuesOf(byCode("Q4"));
  assert.ok(q4.includes("child") && q4.includes("grandchild"));
  assert.equal(byCode("Q9").visibility_conditions?.[0]?.expression, "q4 includes child or q4 includes grandchild");
  assert.equal(
    byCode("Q10").visibility_conditions?.[0]?.expression,
    "(q4 includes child or q4 includes grandchild) and not q9 includes none",
  );
});

test("F列の条件: 1の位でグループ化し、固定は末尾アンカー（Q5/Q6/Q7/Q8/Q9/Q10/Q12）", () => {
  for (const code of ["Q5", "Q6", "Q7", "Q8", "Q9", "Q10", "Q12"]) {
    const q = byCode(code);
    const rnd = q.question_config.option_randomization;
    assert.ok(rnd?.enabled, `${code}: ランダマイズが無効`);
    assert.equal(rnd.randomize_groups, true, `${code}: グループ順がランダムでない`);
    const values = valuesOf(q);
    const grouped = new Set(rnd.groups.flatMap((g: { values: string[] }) => g.values));
    const anchored = new Set<string>(rnd.anchored_values ?? []);
    // 全選択肢がグループかアンカーのどちらかに属する（取りこぼし＝末尾へ流れてしまう）
    for (const v of values) assert.ok(grouped.has(v) || anchored.has(v), `${code}: ${v} がグループにもアンカーにも無い`);
    // 固定（その他/特になし/覚えていない）は options の末尾に並ぶ
    const tail = values.slice(values.length - anchored.size);
    assert.deepEqual(new Set(tail), anchored, `${code}: 固定選択肢が末尾でない`);
  }
});

test("施設（Q7）のグループ: 1.1/1.2/1.3 は同じ群、5.x/6.x/7.x/8.x も同様（調査票 F列）", () => {
  const groups = byCode("Q7").question_config.option_randomization.groups as { label: string; values: string[] }[];
  const find = (label: string) => groups.find((g) => g.label === label)?.values ?? [];
  assert.deepEqual(find("1"), ["rental", "fureai_small", "fureai_large"]);
  assert.deepEqual(find("5"), ["puppy_hall", "large_dog_hall"]);
  assert.deepEqual(find("6"), ["mokkun", "dakkun"]);
  assert.deepEqual(find("7"), ["kitchen", "gift_shop"]);
  assert.deepEqual(find("8"), ["anpanman_play", "lawn_play", "dog_run"]);
  assert.equal(groups.length, 8);
});

test("ランダマイズ実測: 群は隣り合い、群内もシャッフルされ、固定は常に末尾（1,4.1,3 のような並びにならない）", () => {
  const q = byCode("Q7");
  const options = q.question_config.options as Option[];
  const rnd = q.question_config.option_randomization;
  const groupOf = new Map<string, string>();
  for (const g of rnd.groups) for (const v of g.values) groupOf.set(v, g.label);
  let groupOrderVaried = false;
  let withinVaried = false;
  for (let i = 0; i < 20; i += 1) {
    const out = computeOptionOrder(options, rnd, `seed-${i}`).map((o) => o.value);
    // 末尾2つは固定（その他 → 特になし）
    assert.deepEqual(out.slice(-2), ["other", "none"], `seed-${i}: 固定が末尾にない`);
    // 群は連続して現れる（同じ群が離れて2回出てこない）
    const seen = new Set<string>();
    let prev: string | null = null;
    for (const v of out.slice(0, -2)) {
      const g = groupOf.get(v)!;
      if (g !== prev) {
        assert.ok(!seen.has(g), `seed-${i}: 群 ${g} が分断された: ${out.join(",")}`);
        seen.add(g);
        prev = g;
      }
    }
    if (out[0] !== "rental") groupOrderVaried = true;
    const g1 = out.filter((v) => groupOf.get(v) === "1");
    if (g1.join() !== "rental,fureai_small,fureai_large") withinVaried = true;
  }
  assert.ok(groupOrderVaried, "群の順番がシャッフルされていない");
  assert.ok(withinVaried, "群内がシャッフルされていない");
});

test("画像表示: Q7〜Q10 は施設写真つきカード（公式サイトに無い2施設と その他/特になし だけ文字のみ）", () => {
  for (const code of ["Q7", "Q8", "Q9", "Q10"]) {
    const opts = byCode(code).question_config.options as Option[];
    const noImage = opts.filter((o) => !o.imageUrl).map((o) => o.value).sort();
    assert.deepEqual(noImage, ["anpanman_play", "lawn_play", "none", "other"], `${code}: 画像の付き方が想定外`);
    assert.equal(byCode(code).question_config.display_format, "card");
    assert.equal(byCode(code).question_config.grid_cols, 2);
  }
});

test("Q11（SAMTX）: 行＝評価項目のグループランダム、列＝5段階＋利用していない、matrix_list で4項目ずつ", () => {
  const q = byCode("Q11");
  assert.equal(q.question_type, "matrix_single");
  const rows = (q.question_config.matrix_rows as Option[]).map((r) => r.value);
  assert.deepEqual(rows, seed.ASPECTS.map((a: string[]) => a[0]));
  const cols = (q.question_config.matrix_cols as Option[]).map((c) => c.value);
  assert.deepEqual(cols, ["very_satisfied", "satisfied", "neutral", "dissatisfied", "very_dissatisfied", "not_used"]);
  assert.equal(q.question_config.presentation.pattern, "matrix_list");
  assert.equal(q.question_config.matrix_page_size, 4);
  assert.equal(resolveAnswerPresentation(q as any, "standard").pattern, "matrix_list");
  const rnd = q.question_config.option_randomization;
  assert.ok(rnd.enabled && rnd.randomize_groups);
  assert.deepEqual(rnd.groups.find((g: any) => g.label === "5").values, ["cleanliness", "smell"]);
  assert.equal(rnd.anchored_values.length, 0);
});

test("Q12 は Q11 と同じ評価項目（value 一致）＋その他（自由記述）・特になし（排他）", () => {
  const q12 = valuesOf(byCode("Q12"));
  assert.deepEqual(q12.slice(0, -2), seed.ASPECTS.map((a: string[]) => a[0]));
  const opts = byCode("Q12").question_config.options as Option[];
  assert.equal(opts.find((o) => o.value === "other")?.allow_free_text, true);
  assert.equal(opts.find((o) => o.value === "none")?.exclusive, true);
});

test("排他: Q5 の「覚えていない」・Q7/Q12 の「特になし」は exclusive、「その他」は自由記述つき", () => {
  for (const [code, value] of [["Q5", "unknown"], ["Q7", "none"], ["Q12", "none"]] as const) {
    const o = (byCode(code).question_config.options as Option[]).find((x) => x.value === value);
    assert.equal(o?.exclusive, true, `${code}: ${value} が排他でない`);
  }
  for (const code of ["Q4", "Q5", "Q6", "Q7", "Q12"]) {
    const o = (byCode(code).question_config.options as Option[]).find((x) => x.value === "other");
    assert.equal(o?.allow_free_text, true, `${code}: その他に自由記述が無い`);
  }
});

test("Q3 はカレンダー（過去のみ・今日を含む）、Q13 と Q14 は同じ画面、Q17 は任意", () => {
  const q3 = byCode("Q3");
  assert.equal(q3.question_type, "date");
  assert.equal(q3.question_config.date_max_offset, 0);
  assert.equal(q3.question_config.date_min_offset, undefined);
  assert.equal(byCode("Q13").display_tags_parsed?.screenGroup?.groupId, "overall");
  assert.equal(byCode("Q14").display_tags_parsed?.screenGroup?.groupId, "overall");
  assert.equal(byCode("Q17").is_required, false);
  assert.equal(byCode("Q14").is_required, false, "Q14（理由）は任意");
});
