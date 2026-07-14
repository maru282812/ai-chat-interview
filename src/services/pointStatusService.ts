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
  next_rank_min_points: number | null;
  /** 次ランクまでの必要ポイント。最上位なら null。 */
  points_to_next: number | null;
  /** 現在ランク帯の到達率（0〜100）。プログレスバー用。 */
  progress_pct: number;
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
      next_rank_min_points: progress.nextRank?.min_points ?? null,
      points_to_next: progress.pointsToNext,
      progress_pct: progress.progressPct,
    };
  },
};
