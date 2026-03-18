import { supabase } from "../config/supabase";
import type { Rank, Respondent, RespondentStatus } from "../types/domain";
import { requireData, throwIfError } from "./baseRepository";

export const respondentRepository = {
  async getByLineUserAndProject(lineUserId: string, projectId: string): Promise<Respondent | null> {
    const { data, error } = await supabase
      .from("respondents")
      .select("*, current_rank:ranks(*)")
      .eq("line_user_id", lineUserId)
      .eq("project_id", projectId)
      .maybeSingle();
    throwIfError(error);
    return (data as (Respondent & { current_rank?: Rank | null }) | null) ?? null;
  },

  async create(input: {
    line_user_id: string;
    display_name?: string | null;
    project_id: string;
    status: RespondentStatus;
  }): Promise<Respondent> {
    const { data, error } = await supabase.from("respondents").insert(input).select("*").single();
    throwIfError(error);
    return data as Respondent;
  },

  async update(
    id: string,
    input: Partial<
      Pick<Respondent, "display_name" | "status" | "total_points" | "current_rank_id">
    >
  ): Promise<Respondent> {
    const { data, error } = await supabase
      .from("respondents")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as Respondent;
  },

  async list(): Promise<(Respondent & { current_rank?: Rank | null })[]> {
    const { data, error } = await supabase
      .from("respondents")
      .select("*, current_rank:ranks(*)")
      .order("updated_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as (Respondent & { current_rank?: Rank | null })[];
  },

  async getById(id: string): Promise<Respondent & { current_rank?: Rank | null }> {
    const { data, error } = await supabase
      .from("respondents")
      .select("*, current_rank:ranks(*)")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return requireData(
      data as (Respondent & { current_rank?: Rank | null }) | null,
      "Respondent not found"
    );
  },

  async countCompletedByLineUser(lineUserId: string): Promise<number> {
    const { count, error } = await supabase
      .from("respondents")
      .select("*", { count: "exact", head: true })
      .eq("line_user_id", lineUserId)
      .eq("status", "completed");
    throwIfError(error);
    return count ?? 0;
  },

  async countAll(): Promise<number> {
    const { count, error } = await supabase
      .from("respondents")
      .select("*", { count: "exact", head: true });
    throwIfError(error);
    return count ?? 0;
  }
};
