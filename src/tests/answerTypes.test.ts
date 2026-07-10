import assert from "node:assert/strict";
import { test } from "node:test";
import {
  defaultPairwiseRounds,
  generatePairwisePairs,
  isNewAnswerType,
  seedFromString,
  validateImageHeatmap,
  validateNewTypeAnswer,
  validatePairwise,
  validatePointAllocation,
  validateRankingTopN,
} from "../lib/answerTypes";
import type { QuestionConfig } from "../types/domain";

const cfg = (values: string[], extra: Partial<QuestionConfig> = {}): QuestionConfig => ({
  options: values.map((v) => ({ value: v, label: v })),
  ...extra,
});

// ------------------------------------------------------------------
// pairwise 生成
// ------------------------------------------------------------------

test("defaultPairwiseRounds: ceil(nC2*0.6) 上限 nC2", () => {
  assert.equal(defaultPairwiseRounds(2), 1); // nC2=1 → ceil(0.6)=1
  assert.equal(defaultPairwiseRounds(4), 4); // nC2=6 → ceil(3.6)=4
  assert.equal(defaultPairwiseRounds(5), 6); // nC2=10 → ceil(6)=6
});

test("generatePairwisePairs: 決定的（同一seedKeyで同一列）", () => {
  const a = generatePairwisePairs(["A", "B", "C", "D"], undefined, "q1");
  const b = generatePairwisePairs(["A", "B", "C", "D"], undefined, "q1");
  assert.deepEqual(a.pairs, b.pairs);
  assert.equal(a.seed, seedFromString("q1"));
});

test("generatePairwisePairs: seedKey が違えば順序が変わりうる・件数は rounds に従う", () => {
  const a = generatePairwisePairs(["A", "B", "C", "D"], 3, "q1");
  assert.equal(a.pairs.length, 3);
  // すべて実在ペア・重複なし・左右異なる
  const seen = new Set<string>();
  for (const [l, r] of a.pairs) {
    assert.notEqual(l, r);
    const key = [l, r].sort().join("|");
    assert.ok(!seen.has(key), "重複ペアがある");
    seen.add(key);
  }
});

test("generatePairwisePairs: rounds が nC2 を超えても nC2 で頭打ち", () => {
  const a = generatePairwisePairs(["A", "B", "C"], 99, "q1"); // nC2=3
  assert.equal(a.pairs.length, 3);
});

// ------------------------------------------------------------------
// pairwise 検証
// ------------------------------------------------------------------

test("validatePairwise: 正常", () => {
  const v = { duels: [{ left: "A", right: "B", winner: "A" }, { left: "C", right: "D", winner: "D" }] };
  assert.deepEqual(validatePairwise(v, cfg(["A", "B", "C", "D"])), { ok: true });
});

test("validatePairwise: winner が left/right 以外は不正", () => {
  const v = { duels: [{ left: "A", right: "B", winner: "C" }] };
  assert.equal(validatePairwise(v, cfg(["A", "B", "C"])).ok, false);
});

test("validatePairwise: 実在しない code は不正", () => {
  const v = { duels: [{ left: "A", right: "Z", winner: "A" }] };
  assert.equal(validatePairwise(v, cfg(["A", "B"])).ok, false);
});

test("validatePairwise: expectedRounds と対戦数不一致は不正", () => {
  const v = { duels: [{ left: "A", right: "B", winner: "A" }] };
  assert.equal(validatePairwise(v, cfg(["A", "B"]), 3).ok, false);
});

// ------------------------------------------------------------------
// ranking_top_n
// ------------------------------------------------------------------

test("validateRankingTopN: 正常（長さ===top_n・重複なし・実在）", () => {
  assert.deepEqual(validateRankingTopN({ ranked: ["A", "C", "B"] }, cfg(["A", "B", "C", "D"]), 3), { ok: true });
});

test("validateRankingTopN: 長さ不一致は不正", () => {
  assert.equal(validateRankingTopN({ ranked: ["A", "B"] }, cfg(["A", "B", "C"]), 3).ok, false);
});

test("validateRankingTopN: 重複は不正", () => {
  assert.equal(validateRankingTopN({ ranked: ["A", "A", "B"] }, cfg(["A", "B", "C"]), 3).ok, false);
});

// ------------------------------------------------------------------
// point_allocation
// ------------------------------------------------------------------

test("validatePointAllocation: 合計===total で正常", () => {
  assert.deepEqual(validatePointAllocation({ allocations: { A: 60, B: 40 } }, cfg(["A", "B"]), 100), { ok: true });
});

test("validatePointAllocation: 0配分・全額1項目も許可", () => {
  assert.deepEqual(validatePointAllocation({ allocations: { A: 100, B: 0 } }, cfg(["A", "B"]), 100), { ok: true });
});

test("validatePointAllocation: 合計不一致は不正", () => {
  assert.equal(validatePointAllocation({ allocations: { A: 60, B: 30 } }, cfg(["A", "B"]), 100).ok, false);
});

test("validatePointAllocation: 非整数/負数は不正", () => {
  assert.equal(validatePointAllocation({ allocations: { A: 50.5, B: 49.5 } }, cfg(["A", "B"]), 100).ok, false);
  assert.equal(validatePointAllocation({ allocations: { A: -10, B: 110 } }, cfg(["A", "B"]), 100).ok, false);
});

test("validatePointAllocation: 実在しない key は不正", () => {
  assert.equal(validatePointAllocation({ allocations: { A: 50, Z: 50 } }, cfg(["A", "B"]), 100).ok, false);
});

// ------------------------------------------------------------------
// image_heatmap
// ------------------------------------------------------------------

test("validateImageHeatmap: 0〜1座標・件数1〜max で正常", () => {
  assert.deepEqual(validateImageHeatmap({ taps: [{ x: 0.5, y: 0.2 }] }, 3), { ok: true });
});

test("validateImageHeatmap: max_taps 超過は不正", () => {
  assert.equal(validateImageHeatmap({ taps: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] }, 1).ok, false);
});

test("validateImageHeatmap: 範囲外座標は不正", () => {
  assert.equal(validateImageHeatmap({ taps: [{ x: 1.2, y: 0.5 }] }, 3).ok, false);
  assert.equal(validateImageHeatmap({ taps: [{ x: -0.1, y: 0.5 }] }, 3).ok, false);
});

test("validateImageHeatmap: 0点は不正", () => {
  assert.equal(validateImageHeatmap({ taps: [] }, 3).ok, false);
});

// ------------------------------------------------------------------
// ディスパッチャ
// ------------------------------------------------------------------

test("isNewAnswerType", () => {
  assert.equal(isNewAnswerType("pairwise"), true);
  assert.equal(isNewAnswerType("single_choice"), false);
});

test("validateNewTypeAnswer: config から top_n/total/max_taps を読む", () => {
  assert.equal(validateNewTypeAnswer("ranking_top_n", cfg(["A", "B", "C"], { ranking: { top_n: 2 } }), { ranked: ["A", "B"] }).ok, true);
  assert.equal(validateNewTypeAnswer("point_allocation", cfg(["A", "B"], { allocation: { total: 50 } }), { allocations: { A: 25, B: 25 } }).ok, true);
  assert.equal(validateNewTypeAnswer("image_heatmap", cfg([], { heatmap: { image_url: "x", max_taps: 2 } }), { taps: [{ x: 0.1, y: 0.1 }, { x: 0.2, y: 0.2 }] }).ok, true);
  assert.equal(validateNewTypeAnswer("single_choice", cfg(["A"]), "anything").ok, true); // 既存型は素通り
});
