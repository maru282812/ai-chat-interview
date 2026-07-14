/**
 * pointStatus.ts
 *
 * 「いま何ポイントで、次のランクまであとどれくらいか」の計算（純関数）。
 *
 * ランク判定に使うのは lifetime_points（累計）。available_points（交換に使える残高）は
 * 交換で減るので、これでランクを判定すると交換した瞬間に降格して見える。
 * 表示は「残高 = available」「進捗 = lifetime」で分ける。
 */

import type { Rank } from "../types/domain";

export interface RankProgress {
  /** 現在ランク（ranks が空なら null）。 */
  currentRank: Rank | null;
  /** 次のランク。最上位に到達済みなら null。 */
  nextRank: Rank | null;
  /** 次のランクまでの必要ポイント。最上位なら null。 */
  pointsToNext: number | null;
  /** 現在ランク帯の中での到達率（0〜100）。最上位は 100。 */
  progressPct: number;
}

/**
 * 累計ポイントからランクと次ランクまでの進捗を出す。
 * ranks は sort_order 昇順（= min_points 昇順）で渡す想定。
 */
export function computeRankProgress(lifetimePoints: number, ranks: Rank[]): RankProgress {
  const sorted = [...ranks].sort((a, b) => a.min_points - b.min_points);
  if (sorted.length === 0) {
    return { currentRank: null, nextRank: null, pointsToNext: null, progressPct: 0 };
  }

  const points = Math.max(0, lifetimePoints);
  const eligible = sorted.filter((r) => points >= r.min_points);
  const currentRank = eligible.at(-1) ?? sorted[0] ?? null;
  if (!currentRank) {
    return { currentRank: null, nextRank: null, pointsToNext: null, progressPct: 0 };
  }
  const nextRank = sorted.find((r) => r.min_points > currentRank.min_points) ?? null;

  if (!nextRank) {
    return { currentRank, nextRank: null, pointsToNext: null, progressPct: 100 };
  }

  const bandStart = currentRank.min_points;
  const bandSize = nextRank.min_points - bandStart;
  const gained = Math.max(0, points - bandStart);
  const progressPct = bandSize > 0 ? Math.min(100, Math.round((gained / bandSize) * 100)) : 0;

  return {
    currentRank,
    nextRank,
    pointsToNext: Math.max(0, nextRank.min_points - points),
    progressPct,
  };
}
