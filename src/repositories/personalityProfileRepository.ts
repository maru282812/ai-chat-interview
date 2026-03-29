import { supabase } from "../config/supabase";
import type { UserPersonalityProfile } from "../types/domain";
import { throwIfError } from "./baseRepository";

interface UpsertPersonalityProfileInput {
  user_id: string;
  respondent_id?: string | null;
  latest_post_id?: string | null;
  summary?: string | null;
  traits?: unknown[];
  segments?: unknown[];
  confidence?: number | null;
  evidence_post_ids?: unknown[];
  raw_json?: Record<string, unknown> | null;
}

export const personalityProfileRepository = {
  async getByUserId(userId: string): Promise<UserPersonalityProfile | null> {
    const { data, error } = await supabase
      .from("user_personality_profiles")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();
    throwIfError(error);
    return (data as UserPersonalityProfile | null) ?? null;
  },

  async upsertByUserId(input: UpsertPersonalityProfileInput): Promise<UserPersonalityProfile> {
    const { data, error } = await supabase
      .from("user_personality_profiles")
      .upsert(input, { onConflict: "user_id" })
      .select("*")
      .single();
    throwIfError(error);
    return data as UserPersonalityProfile;
  }
};
