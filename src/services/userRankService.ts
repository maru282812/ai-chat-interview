import { supabase } from "../config/supabase";
import { throwIfError } from "../repositories/baseRepository";
import { rankRepository } from "../repositories/rankRepository";
import type { Rank, UserRank } from "../types/domain";

export interface RankSyncResult {
  changed: boolean;
  previousRank: Rank | null;
  newRank: Rank | null;
}

export const userRankService = {
  async getRank(lineUserId: string): Promise<{ userRank: UserRank | null; rank: Rank | null }> {
    const { data, error } = await supabase
      .from("user_ranks")
      .select("*, ranks(*)")
      .eq("line_user_id", lineUserId)
      .single();
    if (error?.code === "PGRST116") return { userRank: null, rank: null };
    throwIfError(error);
    const row = data as (UserRank & { ranks: Rank }) | null;
    return {
      userRank: row ? { line_user_id: row.line_user_id, rank_id: row.rank_id, updated_at: row.updated_at } : null,
      rank: row?.ranks ?? null
    };
  },

  async syncRank(lineUserId: string): Promise<RankSyncResult> {
    const [{ data: pointsData }, ranks] = await Promise.all([
      supabase.from("user_points").select("lifetime_points").eq("line_user_id", lineUserId).single(),
      rankRepository.list()
    ]);

    const lifetimePoints = (pointsData as { lifetime_points: number } | null)?.lifetime_points ?? 0;
    const eligible = ranks.filter((r) => lifetimePoints >= r.min_points);
    const newRank = eligible.at(-1) ?? ranks[0] ?? null;
    if (!newRank) return { changed: false, previousRank: null, newRank: null };

    const { data: existing } = await supabase
      .from("user_ranks")
      .select("rank_id")
      .eq("line_user_id", lineUserId)
      .single();

    const previousRankId = (existing as { rank_id: string } | null)?.rank_id ?? null;
    const previousRank = previousRankId ? (ranks.find((r) => r.id === previousRankId) ?? null) : null;

    if (previousRankId === newRank.id) {
      return { changed: false, previousRank, newRank };
    }

    const { error } = await supabase
      .from("user_ranks")
      .upsert(
        { line_user_id: lineUserId, rank_id: newRank.id, updated_at: new Date().toISOString() },
        { onConflict: "line_user_id" }
      );
    throwIfError(error);

    return { changed: true, previousRank, newRank };
  },

  async resolveRankFromPoints(lifetimePoints: number): Promise<Rank | null> {
    const ranks = await rankRepository.list();
    const eligible = ranks.filter((r) => lifetimePoints >= r.min_points);
    return eligible.at(-1) ?? ranks[0] ?? null;
  }
};
