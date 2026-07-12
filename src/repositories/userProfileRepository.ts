import { supabase } from "../config/supabase";
import type { Gender, MaritalStatus, UserProfile } from "../types/domain";
import { throwIfError } from "./baseRepository";

export interface UserProfileUpsertInput {
  nickname?: string | null;
  birth_date?: string | null;
  gender?: Gender | null;
  prefecture?: string | null;
  address_detail?: string | null;
  address_registered_at?: string | null;
  address_declined?: boolean;
  occupation?: string | null;
  occupation_updated_at?: string | null;
  industry?: string | null;
  marital_status?: MaritalStatus | null;
  has_children?: boolean | null;
  children_ages?: number[];
  household_composition?: string[];
  household_income?: string | null;
  profile_completed?: boolean;
  profile_completed_at?: string | null;
  notification_ok?: boolean;
  last_login_at?: string | null;
}

export const userProfileRepository = {
  async getByLineUserId(lineUserId: string): Promise<UserProfile | null> {
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .eq("line_user_id", lineUserId)
      .maybeSingle();
    throwIfError(error);
    return (data as UserProfile | null) ?? null;
  },

  async upsert(lineUserId: string, input: UserProfileUpsertInput): Promise<UserProfile> {
    const { data, error } = await supabase
      .from("user_profiles")
      .upsert(
        { line_user_id: lineUserId, ...input },
        { onConflict: "line_user_id" }
      )
      .select("*")
      .single();
    throwIfError(error);
    return data as UserProfile;
  },

  async markProfileCompleted(lineUserId: string): Promise<void> {
    const { error } = await supabase
      .from("user_profiles")
      .update({
        profile_completed: true,
        profile_completed_at: new Date().toISOString(),
      })
      .eq("line_user_id", lineUserId);
    throwIfError(error);
  },

  async updateLastLogin(lineUserId: string): Promise<void> {
    const { error } = await supabase
      .from("user_profiles")
      .upsert(
        { line_user_id: lineUserId, last_login_at: new Date().toISOString() },
        { onConflict: "line_user_id" }
      );
    throwIfError(error);
  },

  async listByLineUserIds(lineUserIds: string[]): Promise<UserProfile[]> {
    if (lineUserIds.length === 0) {
      return [];
    }
    const { data, error } = await supabase
      .from("user_profiles")
      .select("*")
      .in("line_user_id", lineUserIds);
    throwIfError(error);
    return (data ?? []) as UserProfile[];
  },

  async updateAiTags(
    lineUserId: string,
    aiTags: string[],
    aiPersonaSummary: string
  ): Promise<void> {
    const { error } = await supabase
      .from("user_profiles")
      .upsert(
        { line_user_id: lineUserId, ai_tags: aiTags, ai_persona_summary: aiPersonaSummary },
        { onConflict: "line_user_id" }
      );
    throwIfError(error);
  }
};
