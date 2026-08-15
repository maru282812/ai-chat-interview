import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_PRESET, resolveAnswerPresentation } from "../lib/answerPresentation";
import type { QuestionConfig, QuestionType } from "../types/domain";

function q(
  question_type: QuestionType,
  opts?: { text?: string; config?: QuestionConfig | null },
) {
  return {
    question_type,
    question_text: opts?.text ?? "設問文",
    question_config: opts?.config ?? null,
  };
}

const optionsN = (n: number): QuestionConfig => ({
  options: Array.from({ length: n }, (_, i) => ({ value: String(i + 1), label: `選択肢${i + 1}` })),
});

// ------------------------------------------------------------------
// プリセット × 型 の基底マッピング
// ------------------------------------------------------------------

test("standard: single_choice(4件) は tap_cards", () => {
  const p = resolveAnswerPresentation(q("single_choice", { config: optionsN(4) }), "standard");
  assert.equal(p.pattern, "tap_cards");
  assert.equal(p.preset, "standard");
  assert.equal(p.fallback_applied, false);
});

test("standard: single_choice(2件) は big_split", () => {
  const p = resolveAnswerPresentation(q("single_choice", { config: optionsN(2) }), "standard");
  assert.equal(p.pattern, "big_split");
});

test("casual: single_choice(2件) は swipe_card", () => {
  const p = resolveAnswerPresentation(q("single_choice", { config: optionsN(2) }), "casual");
  assert.equal(p.pattern, "swipe_card");
});

test("casual: single_choice(3件以上) は carousel", () => {
  const p = resolveAnswerPresentation(q("single_choice", { config: optionsN(4) }), "casual");
  assert.equal(p.pattern, "carousel");
});

test("casual: multi_choice は sort_swipe", () => {
  const p = resolveAnswerPresentation(q("multi_choice", { config: optionsN(5) }), "casual");
  assert.equal(p.pattern, "sort_swipe");
});

test("standard: multi_choice は chip_select", () => {
  const p = resolveAnswerPresentation(q("multi_choice", { config: optionsN(5) }), "standard");
  assert.equal(p.pattern, "chip_select");
});

test("formal: 選択系は従来描画（radio/checkbox）", () => {
  assert.equal(resolveAnswerPresentation(q("single_choice", { config: optionsN(4) }), "formal").pattern, "radio_list");
  assert.equal(resolveAnswerPresentation(q("multi_choice", { config: optionsN(4) }), "formal").pattern, "checkbox_list");
});

test("matrix: casual/standard は行分解、formal は matrix_table", () => {
  assert.equal(resolveAnswerPresentation(q("matrix_single"), "casual").pattern, "matrix_rows");
  assert.equal(resolveAnswerPresentation(q("matrix_multi"), "standard").pattern, "matrix_rows");
  assert.equal(resolveAnswerPresentation(q("matrix_mixed"), "formal").pattern, "matrix_table");
});

test("free_text は全プリセット textarea", () => {
  for (const preset of ["casual", "standard", "formal"] as const) {
    assert.equal(resolveAnswerPresentation(q("free_text_long"), preset).pattern, "textarea");
    assert.equal(resolveAnswerPresentation(q("free_text_short"), preset).pattern, "textarea");
  }
});

test("numeric / image_upload / sd などは legacy（従来描画）", () => {
  for (const t of ["numeric", "image_upload", "hidden_single", "text_with_image", "sd"] as const) {
    assert.equal(resolveAnswerPresentation(q(t), "casual").pattern, "legacy");
  }
});

// ------------------------------------------------------------------
// numeric ドラムピッカー（number_wheel）
// ------------------------------------------------------------------

test("numeric: 年齢のような広いレンジ(min/max)は number_wheel", () => {
  const config: QuestionConfig = { min: 10, max: 100, unit: "歳" };
  for (const preset of ["casual", "standard", "formal"] as const) {
    // プリセットに依らず年齢は同じUI（丸ボタン91個は破綻するため）
    assert.equal(resolveAnswerPresentation(q("numeric", { config }), preset).pattern, "number_wheel");
  }
});

test("numeric: 狭いレンジ(5段階/0-10)は従来の丸ボタン(legacy)のまま", () => {
  assert.equal(
    resolveAnswerPresentation(q("numeric", { config: { min: 1, max: 5 } }), "standard").pattern,
    "legacy",
  );
  // 0〜10 の11段階は境界。丸ボタンで収まるので legacy を維持する。
  assert.equal(
    resolveAnswerPresentation(q("numeric", { config: { min: 0, max: 10 } }), "standard").pattern,
    "legacy",
  );
});

test("numeric: options を明示列挙していても件数が多ければ number_wheel", () => {
  assert.equal(
    resolveAnswerPresentation(q("numeric", { config: optionsN(30) }), "standard").pattern,
    "number_wheel",
  );
  assert.equal(
    resolveAnswerPresentation(q("numeric", { config: optionsN(5) }), "standard").pattern,
    "legacy",
  );
});

test("numeric: scale/slider を明示した設問は尺度として描くので number_wheel にしない", () => {
  const scale: QuestionConfig = { min: 0, max: 100, presentation: { scale: true } };
  assert.equal(resolveAnswerPresentation(q("numeric", { config: scale }), "standard").pattern, "legacy");
  const slider: QuestionConfig = { min: 0, max: 100, presentation: { slider: true } };
  assert.equal(resolveAnswerPresentation(q("numeric", { config: slider }), "standard").pattern, "legacy");
});

test("numeric: 設問単位の presentation.pattern 指定が最優先される", () => {
  const config: QuestionConfig = { min: 10, max: 100, presentation: { pattern: "legacy" } };
  assert.equal(resolveAnswerPresentation(q("numeric", { config }), "standard").pattern, "legacy");
});

test("numeric: carry-forward 後の実選択肢数で判定する（optionCount 優先）", () => {
  // 基底は30件でも、絞り込み後に3件なら丸ボタンで足りる
  assert.equal(
    resolveAnswerPresentation(q("numeric", { config: optionsN(30) }), "standard", 3).pattern,
    "legacy",
  );
});

// ------------------------------------------------------------------
// scale / slider 指定
// ------------------------------------------------------------------

test("scale指定: casual=face_scale / standard=big_slider / formal=radio_list", () => {
  const cfg = { ...optionsN(5), presentation: { scale: true } };
  assert.equal(resolveAnswerPresentation(q("single_choice", { config: cfg }), "casual").pattern, "face_scale");
  assert.equal(resolveAnswerPresentation(q("single_choice", { config: cfg }), "standard").pattern, "big_slider");
  assert.equal(resolveAnswerPresentation(q("single_choice", { config: cfg }), "formal").pattern, "radio_list");
});

test("slider指定: casual/standard=big_slider / formal=radio_list", () => {
  const cfg = { presentation: { slider: true } };
  assert.equal(resolveAnswerPresentation(q("single_choice", { config: cfg }), "casual").pattern, "big_slider");
  assert.equal(resolveAnswerPresentation(q("single_choice", { config: cfg }), "standard").pattern, "big_slider");
  assert.equal(resolveAnswerPresentation(q("single_choice", { config: cfg }), "formal").pattern, "radio_list");
});

// ------------------------------------------------------------------
// 自動フォールバック
// ------------------------------------------------------------------

test("swipe_card: 設問文61文字以上で big_split に降格し fallback_applied=true", () => {
  const longText = "あ".repeat(61);
  const p = resolveAnswerPresentation(q("single_choice", { text: longText, config: optionsN(2) }), "casual");
  assert.equal(p.pattern, "big_split");
  assert.equal(p.fallback_applied, true);
});

test("swipe_card: 設問文60文字ちょうどは降格しない", () => {
  const p = resolveAnswerPresentation(
    q("single_choice", { text: "あ".repeat(60), config: optionsN(2) }),
    "casual",
  );
  assert.equal(p.pattern, "swipe_card");
  assert.equal(p.fallback_applied, false);
});

test("carousel: 選択肢9件で tap_cards に降格", () => {
  const p = resolveAnswerPresentation(q("single_choice", { config: optionsN(9) }), "casual", 9);
  assert.equal(p.pattern, "tap_cards");
  assert.equal(p.fallback_applied, true);
});

test("face_scale: 選択肢6件以上で tap_cards に降格", () => {
  const cfg = { ...optionsN(6), presentation: { scale: true } };
  const p = resolveAnswerPresentation(q("single_choice", { config: cfg }), "casual", 6);
  assert.equal(p.pattern, "tap_cards");
  assert.equal(p.fallback_applied, true);
});

test("optionCount 引数が config.options 件数より優先される（carry-forward反映）", () => {
  // config には2件だが、実選択肢は9件（disable/carryで増えることは無いが逆パターンの検証）
  const p = resolveAnswerPresentation(q("single_choice", { config: optionsN(2) }), "casual", 9);
  // 9件なので carousel 起点 → 8件超で tap_cards
  assert.equal(p.pattern, "tap_cards");
});

// ------------------------------------------------------------------
// 設問単位の上書き
// ------------------------------------------------------------------

test("presentation.pattern の上書きがプリセットより優先される", () => {
  const cfg = { ...optionsN(4), presentation: { pattern: "swipe_card" } };
  const p = resolveAnswerPresentation(q("single_choice", { config: cfg }), "formal");
  assert.equal(p.pattern, "swipe_card");
});

test("上書きパターンにも自動フォールバックが効く", () => {
  const cfg = { ...optionsN(2), presentation: { pattern: "swipe_card" } };
  const p = resolveAnswerPresentation(
    q("single_choice", { text: "あ".repeat(61), config: cfg }),
    "standard",
  );
  assert.equal(p.pattern, "big_split");
  assert.equal(p.fallback_applied, true);
});

// ------------------------------------------------------------------
// 新設問形式
// ------------------------------------------------------------------

test("新型のパターン名（duel/podium/alloc_bars/heat_tap）", () => {
  assert.equal(resolveAnswerPresentation(q("pairwise"), "casual").pattern, "duel");
  assert.equal(resolveAnswerPresentation(q("ranking_top_n"), "casual").pattern, "podium");
  assert.equal(resolveAnswerPresentation(q("ranking_top_n"), "formal").pattern, "ranking_numbered");
  assert.equal(resolveAnswerPresentation(q("point_allocation"), "standard").pattern, "alloc_bars");
  assert.equal(resolveAnswerPresentation(q("image_heatmap"), "formal").pattern, "heat_tap");
});

// ------------------------------------------------------------------
// デフォルト
// ------------------------------------------------------------------

test("preset 未指定は standard 扱い", () => {
  assert.equal(DEFAULT_PRESET, "standard");
  const p = resolveAnswerPresentation(q("single_choice", { config: optionsN(4) }), null);
  assert.equal(p.preset, "standard");
  assert.equal(p.pattern, "tap_cards");
});
