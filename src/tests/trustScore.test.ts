/**
 * trustScore.test.ts
 *
 * ついでスワイプを素材にした整合性スコア（信頼スコア簡易版）。
 * 「素材が少なければ判定しない（新規ユーザーを不利にしない）」契約を特に固定する。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TRUST_CONFIG,
  computeTrustScore,
  type TrustSample,
} from "../lib/trustScore";

const NOW = Date.parse("2026-07-25T00:00:00.000Z");

/** n 日前の ISO 文字列。 */
function daysAgo(n: number): string {
  return new Date(NOW - n * 86_400_000).toISOString();
}

function sample(over: Partial<TrustSample> & { questionId: string }): TrustSample {
  return {
    answerValue: "a",
    answerMs: 3000,
    answeredAt: daysAgo(1),
    ...over,
  };
}

test("素材が minSamples 未満ならスコアを出さない（新規ユーザーを不利にしない）", () => {
  const r = computeTrustScore([sample({ questionId: "q1" })], NOW);
  assert.equal(r.score, null);
  assert.equal(r.sampleCount, 1);
});

test("再出題で答えが一致していれば高スコア", () => {
  const samples: TrustSample[] = [
    sample({ questionId: "q1", answerValue: "a", answeredAt: daysAgo(30) }),
    sample({ questionId: "q1", answerValue: "a", answeredAt: daysAgo(1) }),
    sample({ questionId: "q2", answerValue: "b", answeredAt: daysAgo(20) }),
    sample({ questionId: "q2", answerValue: "b", answeredAt: daysAgo(2) }),
    sample({ questionId: "q3", answerValue: "c", answeredAt: daysAgo(3) }),
  ];
  const r = computeTrustScore(samples, NOW);
  assert.ok(r.score !== null);
  assert.ok((r.score as number) > 0.9);
  assert.equal(r.retestPairs, 2);
});

test("再出題で答えがブレていればスコアが下がる", () => {
  const samples: TrustSample[] = [
    sample({ questionId: "q1", answerValue: "a", answeredAt: daysAgo(30) }),
    sample({ questionId: "q1", answerValue: "b", answeredAt: daysAgo(1) }),
    sample({ questionId: "q2", answerValue: "a", answeredAt: daysAgo(20) }),
    sample({ questionId: "q2", answerValue: "b", answeredAt: daysAgo(2) }),
    sample({ questionId: "q3", answerValue: "c", answeredAt: daysAgo(3) }),
  ];
  const r = computeTrustScore(samples, NOW);
  assert.ok(r.score !== null);
  // 減点閾値(0.4)付近まで落ちること。証拠量で中立側へ引き戻すので 0 にはならない。
  assert.ok((r.score as number) < 0.6);

  // 同じ形で答えが一致している場合と比べて明確に低い
  const consistent = computeTrustScore(
    samples.map((s) => ({ ...s, answerValue: "a" })),
    NOW,
  );
  assert.ok((r.score as number) < (consistent.score as number) - 0.3);
});

test("即答すぎが多いとスコアが下がる", () => {
  const samples: TrustSample[] = Array.from({ length: 6 }, (_, i) =>
    sample({ questionId: `q${i}`, answerMs: 100, answeredAt: daysAgo(1) }),
  );
  const r = computeTrustScore(samples, NOW);
  assert.ok(r.score !== null);
  assert.equal(r.instantRate, 1);
  // 再出題ペアが無いので speedScore のみ。減点閾値(0.4)を明確に下回る。
  assert.ok((r.score as number) < 0.3);
});

test("じっくり答えていれば即答ペナルティは出ない", () => {
  const samples: TrustSample[] = Array.from({ length: 6 }, (_, i) =>
    sample({ questionId: `q${i}`, answerMs: 5000, answeredAt: daysAgo(1) }),
  );
  const r = computeTrustScore(samples, NOW);
  assert.equal(r.instantRate, 0);
  assert.ok((r.score as number) > 0.9);
});

test("answer_ms が全て未計測なら速度は判定材料に入らない", () => {
  const samples: TrustSample[] = Array.from({ length: 6 }, (_, i) =>
    sample({ questionId: `q${i}`, answerMs: null }),
  );
  const r = computeTrustScore(samples, NOW);
  assert.equal(r.instantRate, null);
  // 再出題ペアも無いので判定不能＝null（減点しない側）
  assert.equal(r.score, null);
});

test("古い素材は減衰して効き目が下がる（嗜好の変化を矛盾と誤認しない）", () => {
  const base = (ageDays: number): TrustSample[] => [
    sample({ questionId: "q1", answerValue: "a", answeredAt: daysAgo(ageDays + 10) }),
    sample({ questionId: "q1", answerValue: "b", answeredAt: daysAgo(ageDays) }),
    sample({ questionId: "q2", answerValue: "a", answeredAt: daysAgo(1), answerMs: 5000 }),
    sample({ questionId: "q3", answerValue: "a", answeredAt: daysAgo(1), answerMs: 5000 }),
    sample({ questionId: "q4", answerValue: "a", answeredAt: daysAgo(1), answerMs: 5000 }),
  ];
  const recent = computeTrustScore(base(1), NOW);
  const old = computeTrustScore(base(400), NOW);
  assert.ok(recent.score !== null && old.score !== null);
  // 同じ「1回ブレた」でも、古い方が全体スコアへの打撃が小さい
  assert.ok((old.score as number) > (recent.score as number));
});

test("スコアは必ず [0,1] に収まる", () => {
  const samples: TrustSample[] = Array.from({ length: 10 }, (_, i) =>
    sample({ questionId: `q${i % 3}`, answerMs: i % 2 === 0 ? 50 : 9000 }),
  );
  const r = computeTrustScore(samples, NOW);
  assert.ok(r.score !== null);
  assert.ok((r.score as number) >= 0 && (r.score as number) <= 1);
});

test("包んだ形の回答値（{value:...}）も比較できる", () => {
  const samples: TrustSample[] = [
    sample({ questionId: "q1", answerValue: { value: "a" }, answeredAt: daysAgo(10) }),
    sample({ questionId: "q1", answerValue: "a", answeredAt: daysAgo(1) }),
    sample({ questionId: "q2", answeredAt: daysAgo(2) }),
    sample({ questionId: "q3", answeredAt: daysAgo(3) }),
    sample({ questionId: "q4", answeredAt: daysAgo(4) }),
  ];
  const r = computeTrustScore(samples, NOW);
  assert.equal(r.retestPairs, 1);
  assert.ok((r.score as number) > 0.9);
});

test("設定の minSamples を満たす境界ちょうどで判定が始まる", () => {
  const make = (n: number): TrustSample[] =>
    Array.from({ length: n }, (_, i) => sample({ questionId: `q${i}`, answerMs: 5000 }));
  assert.equal(computeTrustScore(make(DEFAULT_TRUST_CONFIG.minSamples - 1), NOW).score, null);
  assert.ok(computeTrustScore(make(DEFAULT_TRUST_CONFIG.minSamples), NOW).score !== null);
});
