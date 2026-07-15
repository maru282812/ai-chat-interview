/**
 * qualityScore.test.ts
 *
 * 品質係数の「受け皿」。仮実装（係数 1.0＝挙動不変）と、契約（範囲クランプ・非負）を固定する。
 * 品質判定の本設計を入れるときに、この境界テストが崩れないことを確認する。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  QUALITY_MAX,
  QUALITY_MIN,
  clampQuality,
  computeQualityFactor,
  qualityWeightedPoints,
} from "../lib/qualityScore";

test("仮実装: 品質係数は常に 1.0（減点なし）", () => {
  assert.equal(computeQualityFactor({}), 1);
  assert.equal(computeQualityFactor({ text: "" }), 1);
  assert.equal(computeQualityFactor({ answers: [{ questionId: "q1", answerValue: "x" }] }), 1);
});

test("仮実装: 重み付けポイントは basePoints と一致（挙動不変）", () => {
  assert.equal(qualityWeightedPoints(15, {}), 15);
  assert.equal(qualityWeightedPoints(0, {}), 0);
  assert.equal(qualityWeightedPoints(200, { text: "てきとう" }), 200);
});

test("契約: 付与ポイントは負にならず整数になる", () => {
  assert.equal(qualityWeightedPoints(-10, {}), 0);
  assert.equal(qualityWeightedPoints(14.6, {}), 15); // round(basePoints) → round(base*1)
});

test("契約: clampQuality は [0,1] に収め、NaN は上限にフォールバック", () => {
  assert.equal(clampQuality(-0.5), QUALITY_MIN);
  assert.equal(clampQuality(1.5), QUALITY_MAX);
  assert.equal(clampQuality(0.42), 0.42);
  assert.equal(clampQuality(NaN), QUALITY_MAX);
});
