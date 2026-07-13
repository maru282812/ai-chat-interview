import { supabase } from "../config/supabase";
import type { Rank, RespondentRankHistory } from "../types/domain";
import { throwIfError } from "./baseRepository";

export const rankRepository = {
  async list(): Promise<Rank[]> {
    const { data, error } = await supabase.from("ranks").select("*").order("sort_order", {
      ascending: true
    });
    throwIfError(error);
    return (data ?? []) as Rank[];
  },

  /** 会員ランク（user_ranks が正準）の一括取得。ロウデータ出力の RANK 列で使う。 */
  async listUserRanksByLineUserIds(lineUserIds: string[]): Promise<Map<string, Rank>> {
    const ids = [...new Set(lineUserIds)].filter(Boolean);
    if (ids.length === 0) {
      return new Map();
    }
    const { data, error } = await supabase
      .from("user_ranks")
      .select("line_user_id, ranks(*)")
      .in("line_user_id", ids);
    throwIfError(error);
    const byLineUser = new Map<string, Rank>();
    // to-one の埋め込みは実行時オブジェクト（生成型は配列扱い）のため両方を許容する
    const rows = (data ?? []) as unknown as { line_user_id: string; ranks: Rank | Rank[] | null }[];
    for (const row of rows) {
      const rank = Array.isArray(row.ranks) ? row.ranks[0] : row.ranks;
      if (rank) {
        byLineUser.set(row.line_user_id, rank);
      }
    }
    return byLineUser;
  },

  async updateThreshold(id: string, input: Partial<Pick<Rank, "min_points" | "badge_label">>): Promise<Rank> {
    const { data, error } = await supabase
      .from("ranks")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as Rank;
  },

  async createHistory(input: {
    respondent_id: string;
    previous_rank_id: string | null;
    new_rank_id: string;
    reason: string;
  }): Promise<RespondentRankHistory> {
    const { data, error } = await supabase
      .from("respondent_rank_histories")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return data as RespondentRankHistory;
  },

  async listHistories(): Promise<RespondentRankHistory[]> {
    const { data, error } = await supabase
      .from("respondent_rank_histories")
      .select("*")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as RespondentRankHistory[];
  }
};
