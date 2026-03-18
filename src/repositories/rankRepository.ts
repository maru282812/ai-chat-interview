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
