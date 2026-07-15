/**
 * pointStatus.ts
 *
 * 「いま何ポイントで、次のランク／段位まであとどれくらいか」の計算（純関数）。
 *
 * ランク判定に使うのは lifetime_points（累計）。available_points（交換に使える残高）は
 * 交換で減るので、これでランクを判定すると交換した瞬間に降格して見える。
 * 表示は「残高 = available」「進捗 = lifetime」で分ける。
 *
 * 段位 I〜III（Phase 2）:
 *   各ランクの点数バンドを「前半ほど小刻み」に3分割して段位を導出する（テーブルは増やさない）。
 *   区切りは帯幅の 30% / 65%（I=0〜30% / II=30〜65% / III=65〜100%）。
 *   最上位ランク（次ランクなし＝マスター）は上限がないため、min_points からの絶対ステップで区切り、
 *   III を青天井にする（＝強い人が溜まる最上位帯）。
 */

import type { Rank } from "../types/domain";

/** バンド内の段位区切り（帯幅に対する割合）。前半ほど狭い。 */
export const TIER_SPLIT = [0.3, 0.65] as const;
/** 最上位ランク（上限なし）の段位区切り。min_points からの絶対ポイント。 */
export const TOP_TIER_STEPS = [1000, 2500] as const;

export type Tier = 1 | 2 | 3;
const TIER_ROMAN: Record<Tier, string> = { 1: "I", 2: "II", 3: "III" };

export function tierRoman(tier: Tier | null): string {
  return tier ? TIER_ROMAN[tier] : "";
}

export interface RankProgress {
  /** 現在ランク（ranks が空なら null）。 */
  currentRank: Rank | null;
  /** 次のランク。最上位に到達済みなら null。 */
  nextRank: Rank | null;
  /** 次のランクまでの必要ポイント。最上位なら null。 */
  pointsToNext: number | null;
  /** 現在ランク帯の中での到達率（0〜100）。最上位は 100。 */
  progressPct: number;

  // ── 段位 I〜III（Phase 2）──
  /** 現在の段位（現在ランクがあれば 1〜3、無ければ null）。 */
  tier: Tier | null;
  /** 次の段位まで（同一ランク内の次段 or 段位IIIなら次ランクI）。最上位ランクの段位IIIは上限なしで null。 */
  pointsToNextTier: number | null;
  /** 現在の段位の中での到達率（0〜100）。段位バー用。 */
  tierProgressPct: number;
  /** 次の一歩で別ランクへ昇格するか（段位IIIから次ランクIへ）。 */
  nextTierPromotes: boolean;
}

/**
 * 累計ポイントからランク・段位・進捗を出す。
 * ranks は sort_order 昇順（= min_points 昇順）で渡す想定。
 */
export function computeRankProgress(lifetimePoints: number, ranks: Rank[]): RankProgress {
  const empty: RankProgress = {
    currentRank: null,
    nextRank: null,
    pointsToNext: null,
    progressPct: 0,
    tier: null,
    pointsToNextTier: null,
    tierProgressPct: 0,
    nextTierPromotes: false,
  };

  const sorted = [...ranks].sort((a, b) => a.min_points - b.min_points);
  if (sorted.length === 0) {
    return empty;
  }

  const points = Math.max(0, lifetimePoints);
  const eligible = sorted.filter((r) => points >= r.min_points);
  const currentRank = eligible.at(-1) ?? sorted[0] ?? null;
  if (!currentRank) {
    return empty;
  }
  const nextRank = sorted.find((r) => r.min_points > currentRank.min_points) ?? null;

  const bandStart = currentRank.min_points;

  // 現在ランク帯の到達率・次ランクまで（従来通り）
  let progressPct = 100;
  let pointsToNext: number | null = null;
  if (nextRank) {
    const bandSize = nextRank.min_points - bandStart;
    const gained = Math.max(0, points - bandStart);
    progressPct = bandSize > 0 ? Math.min(100, Math.round((gained / bandSize) * 100)) : 0;
    pointsToNext = Math.max(0, nextRank.min_points - points);
  }

  // ── 段位（バンドを前半小刻みで3分割）──
  // 各段位の開始ポイント（tierStarts[0..2]）と、段位IIIの終端（next=次ランクの min、最上位は null）
  let tierStarts: [number, number, number];
  let tier3End: number | null;
  if (nextRank) {
    const bandSize = nextRank.min_points - bandStart;
    tierStarts = [
      bandStart,
      Math.round(bandStart + bandSize * TIER_SPLIT[0]),
      Math.round(bandStart + bandSize * TIER_SPLIT[1]),
    ];
    tier3End = nextRank.min_points;
  } else {
    // 最上位ランク：絶対ステップ。段位IIIは上限なし。
    tierStarts = [bandStart, bandStart + TOP_TIER_STEPS[0], bandStart + TOP_TIER_STEPS[1]];
    tier3End = null;
  }

  const tier: Tier = points < tierStarts[1] ? 1 : points < tierStarts[2] ? 2 : 3;
  // タプル固定インデックスで参照（動的 index を避け、undefined を出さない）
  const tierStart = tier === 1 ? tierStarts[0] : tier === 2 ? tierStarts[1] : tierStarts[2];
  const tierEnd = tier === 1 ? tierStarts[1] : tier === 2 ? tierStarts[2] : tier3End;

  let tierProgressPct = 100;
  let pointsToNextTier: number | null = null;
  if (tierEnd !== null) {
    const width = tierEnd - tierStart;
    tierProgressPct = width > 0 ? Math.min(100, Math.round(((points - tierStart) / width) * 100)) : 100;
    pointsToNextTier = Math.max(0, tierEnd - points);
  }
  // 段位IIIの次は次ランクのI（＝昇格）。段位I/IIの次は同ランク内。
  const nextTierPromotes = tier === 3 && nextRank !== null;

  return {
    currentRank,
    nextRank,
    pointsToNext,
    progressPct,
    tier,
    pointsToNextTier,
    tierProgressPct,
    nextTierPromotes,
  };
}
