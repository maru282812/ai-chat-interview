import { supabase } from "../config/supabase";
import type {
  PostActionability,
  PostAnalysis,
  PostInsightType,
  PostSentiment
} from "../types/domain";
import { throwIfError } from "./baseRepository";

interface UpsertPostAnalysisInput {
  post_id: string;
  analysis_version?: string;
  summary?: string | null;
  tags?: unknown[];
  sentiment: PostSentiment;
  sentiment_score?: number | null;
  keywords?: unknown[];
  mentioned_brands?: unknown[];
  pii_flags?: unknown[];
  actionability: PostActionability;
  personality_signals?: unknown[];
  behavior_signals?: unknown[];
  insight_type?: PostInsightType;
  specificity?: number;
  novelty?: number;
  raw_json?: Record<string, unknown> | null;
  analyzed_at?: string | null;
}

export const postAnalysisRepository = {
  async upsertByPostId(input: UpsertPostAnalysisInput): Promise<PostAnalysis> {
    const { data, error } = await supabase
      .from("post_analysis")
      .upsert(input, { onConflict: "post_id" })
      .select("*")
      .single();
    throwIfError(error);
    return data as PostAnalysis;
  },

  async getByPostId(postId: string): Promise<PostAnalysis | null> {
    const { data, error } = await supabase
      .from("post_analysis")
      .select("*")
      .eq("post_id", postId)
      .maybeSingle();
    throwIfError(error);
    return (data as PostAnalysis | null) ?? null;
  },

  async listByPostIds(postIds: string[]): Promise<PostAnalysis[]> {
    if (postIds.length === 0) {
      return [];
    }

    const { data, error } = await supabase
      .from("post_analysis")
      .select("*")
      .in("post_id", postIds);
    throwIfError(error);
    return (data ?? []) as PostAnalysis[];
  }
};
