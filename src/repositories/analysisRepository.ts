import { supabase } from "../config/supabase";
import type { AIAnalysisResult } from "../types/domain";
import { throwIfError } from "./baseRepository";

export const analysisRepository = {
  async upsert(input: Omit<AIAnalysisResult, "id" | "created_at"> & { id?: string }): Promise<AIAnalysisResult> {
    const { data, error } = await supabase
      .from("ai_analysis_results")
      .upsert(input, { onConflict: "session_id" })
      .select("*")
      .single();
    throwIfError(error);
    return data as AIAnalysisResult;
  },

  async getBySession(sessionId: string): Promise<AIAnalysisResult | null> {
    const { data, error } = await supabase
      .from("ai_analysis_results")
      .select("*")
      .eq("session_id", sessionId)
      .maybeSingle();
    throwIfError(error);
    return (data as AIAnalysisResult | null) ?? null;
  },

  async listAll(): Promise<AIAnalysisResult[]> {
    const { data, error } = await supabase
      .from("ai_analysis_results")
      .select("*")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as AIAnalysisResult[];
  }
};
