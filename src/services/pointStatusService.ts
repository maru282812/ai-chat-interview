/**
 * pointStatusService.ts
 *
 * 「現在のポイントと次ランクまでの距離」を1か所で解決する。
 *
 * 正準は user_points（残高・累計）と ranks（しきい値）。
 * respondents.total_points / respondents.current_rank はレガシー集計なので参照しない
 * （マイページの旧実装がそちらを見ているため、値がズレる余地がある）。
 */

import { computeRankProgress } from "../lib/pointStatus";
import { rankRepository } from "../repositories/rankRepository";
import { userPointService } from "./userPointService";

export interface PointStatus {
  /** 交換に使える残高。画面の「現在のポイント」はこれ。 */
  available_points: number;
  /** 累計。ランク判定はこちら（交換で減らない）。 */
  lifetime_points: number;
  rank_code: string | null;
  rank_name: string | null;
  badge_label: string | null;
  next_rank_name: string | null;
  next_rank_code: string | null;
  next_rank_min_points: number | null;
  /** 次ランクまでの必要ポイント。最上位なら null。 */
  points_to_next: number | null;
  /** 現在ランク帯の到達率（0〜100）。プログレスバー用。 */
  progress_pct: number;

  // ── 段位 I〜III（Phase 2）──
  /** 現在の段位（1〜3）。ランク未確定なら null。 */
  tier: 1 | 2 | 3 | null;
  /** 次の段位まで（同ランク内の次段 or 段位IIIなら次ランクI）。最上位段位で上限なしなら null。 */
  points_to_next_tier: number | null;
  /** 現在の段位内の到達率（0〜100）。段位バー用。 */
  tier_progress_pct: number;
  /** 次の一歩で別ランクへ昇格するか（段位III→次ランクI）。 */
  next_tier_promotes: boolean;
}

export const pointStatusService = {
  async getStatus(lineUserId: string): Promise<PointStatus> {
    const [balance, ranks] = await Promise.all([
      userPointService.getBalance(lineUserId),
      rankRepository.list(),
    ]);

    const progress = computeRankProgress(balance.lifetime_points ?? 0, ranks);

    return {
      available_points: balance.available_points ?? 0,
      lifetime_points: balance.lifetime_points ?? 0,
      rank_code: progress.currentRank?.rank_code ?? null,
      rank_name: progress.currentRank?.rank_name ?? null,
      badge_label: progress.currentRank?.badge_label ?? null,
      next_rank_name: progress.nextRank?.rank_name ?? null,
      next_rank_code: progress.nextRank?.rank_code ?? null,
      next_rank_min_points: progress.nextRank?.min_points ?? null,
      points_to_next: progress.pointsToNext,
      progress_pct: progress.progressPct,
      tier: progress.tier,
      points_to_next_tier: progress.pointsToNextTier,
      tier_progress_pct: progress.tierProgressPct,
      next_tier_promotes: progress.nextTierPromotes,
    };
  },
};
