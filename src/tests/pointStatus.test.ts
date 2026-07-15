/**
 * pointStatus.test.ts
 *
 * 「現在のポイント / 次ランクまであと何pt」と、デイリー回答時の LINE 通知文。
 * DB は触らない純関数だけを見る（残高・ランクの取得は pointStatusService の担当）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDailyAnswerNoticeLines } from "../lib/dailyAnswerNotice";
import { computeRankProgress } from "../lib/pointStatus";
import type { Rank } from "../types/domain";

const rank = (code: string, name: string, min: number, order: number): Rank => ({
  id: `00000000-0000-4000-8000-00000000000${order}`,
  rank_code: code,
  rank_name: name,
  min_points: min,
  sort_order: order,
  badge_label: name,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
});

const BRONZE = rank("bronze", "Bronze", 0, 1);
const SILVER = rank("silver", "Silver", 100, 2);
const GOLD = rank("gold", "Gold", 500, 3);
const RANKS: Rank[] = [BRONZE, SILVER, GOLD];

test("帯の途中: 現在ランク・次ランク・残りpt・到達率が出る", () => {
  const p = computeRankProgress(250, RANKS);
  assert.equal(p.currentRank?.rank_code, "silver");
  assert.equal(p.nextRank?.rank_code, "gold");
  assert.equal(p.pointsToNext, 250);
  // Silver(100) 〜 Gold(500) の帯で 150/400
  assert.equal(p.progressPct, 38);
});

test("しきい値ちょうどは上のランクに入り、到達率は0%から始まる", () => {
  const p = computeRankProgress(100, RANKS);
  assert.equal(p.currentRank?.rank_code, "silver");
  assert.equal(p.progressPct, 0);
  assert.equal(p.pointsToNext, 400);
});

test("最上位に到達したら次ランクなし・100%", () => {
  const p = computeRankProgress(900, RANKS);
  assert.equal(p.currentRank?.rank_code, "gold");
  assert.equal(p.nextRank, null);
  assert.equal(p.pointsToNext, null);
  assert.equal(p.progressPct, 100);
});

test("ポイント0・ranks 未設定でも壊れない", () => {
  const zero = computeRankProgress(0, RANKS);
  assert.equal(zero.currentRank?.rank_code, "bronze");
  assert.equal(zero.pointsToNext, 100);

  const empty = computeRankProgress(300, []);
  assert.equal(empty.currentRank, null);
  assert.equal(empty.nextRank, null);
  assert.equal(empty.progressPct, 0);
});

test("ranks の並びが min_points 昇順でなくても正しく判定する", () => {
  const p = computeRankProgress(250, [GOLD, BRONZE, SILVER]);
  assert.equal(p.currentRank?.rank_code, "silver");
  assert.equal(p.nextRank?.rank_code, "gold");
});

// ── 段位 I〜III（Phase 2）──
// Silver 帯 = 100〜500（幅400）。区切り 30%/65% → I:100-220 / II:220-360 / III:360-500。
test("段位: 帯の前半は I、次段まで／段位内到達率が出る", () => {
  const p = computeRankProgress(100, RANKS); // Silver に入った直後
  assert.equal(p.tier, 1);
  assert.equal(p.pointsToNextTier, 120); // 220 まで
  assert.equal(p.tierProgressPct, 0);
  assert.equal(p.nextTierPromotes, false);
});

test("段位: 帯の中盤は II", () => {
  const p = computeRankProgress(250, RANKS);
  assert.equal(p.tier, 2);
  assert.equal(p.pointsToNextTier, 110); // 360 まで
  assert.equal(p.tierProgressPct, 21); // (250-220)/140
  assert.equal(p.nextTierPromotes, false);
});

test("段位: 帯の後半 III の次は次ランクへ昇格する", () => {
  const p = computeRankProgress(400, RANKS);
  assert.equal(p.tier, 3);
  assert.equal(p.pointsToNextTier, 100); // Gold(500) まで
  assert.equal(p.nextTierPromotes, true);
});

test("段位: 前半ほど小刻み（I の帯幅 < II の帯幅）", () => {
  const tierI = computeRankProgress(100, RANKS).pointsToNextTier; // 120
  const tierII = computeRankProgress(220, RANKS).pointsToNextTier; // 140
  assert.ok((tierI ?? 0) < (tierII ?? 0));
});

test("段位: 最上位ランクは絶対ステップで区切られ、段位IIIは上限なし", () => {
  const t1 = computeRankProgress(900, RANKS); // Gold 500〜: I(500-1500)
  assert.equal(t1.tier, 1);
  assert.equal(t1.pointsToNextTier, 600); // 1500 まで
  const t3 = computeRankProgress(4000, RANKS); // Gold 3000〜: III 青天井
  assert.equal(t3.tier, 3);
  assert.equal(t3.pointsToNextTier, null);
  assert.equal(t3.tierProgressPct, 100);
  assert.equal(t3.nextTierPromotes, false);
});

test("通知文: 付与ポイントと残高と次ランクまでの距離が必ず入る", () => {
  const lines = buildDailyAnswerNoticeLines({
    pointsAwarded: 15,
    streakBonusAwarded: 0,
    currentStreak: 1,
    rankChanged: false,
    newRankName: null,
    availablePoints: 250,
    nextRankName: "Gold",
    pointsToNext: 250,
  });
  const text = lines.join("\n");
  assert.match(text, /\+15pt/);
  assert.match(text, /現在のポイント: 250pt/);
  assert.match(text, /Gold.*あと 250pt/);
  // 連続1日目は煽らない
  assert.ok(!text.includes("連続で回答中"));
});

test("通知文: ボーナスがあるときは合計と内訳を出す", () => {
  const text = buildDailyAnswerNoticeLines({
    pointsAwarded: 15,
    streakBonusAwarded: 50,
    currentStreak: 7,
    rankChanged: false,
    newRankName: null,
    availablePoints: 315,
    nextRankName: "Gold",
    pointsToNext: 185,
  }).join("\n");
  assert.match(text, /獲得ポイント: \+65pt/);
  assert.match(text, /回答 \+15pt \/ 連続ボーナス \+50pt/);
  assert.match(text, /7日連続/);
});

test("通知文: ランクが上がったら昇格を出し、次ランク行は出さない", () => {
  const text = buildDailyAnswerNoticeLines({
    pointsAwarded: 20,
    streakBonusAwarded: 0,
    currentStreak: 3,
    rankChanged: true,
    newRankName: "Silver",
    availablePoints: 110,
    nextRankName: "Gold",
    pointsToNext: 390,
  }).join("\n");
  assert.match(text, /ランクが Silver になりました/);
  assert.ok(!text.includes("あと 390pt"));
});
