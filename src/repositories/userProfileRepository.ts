import { supabase } from "../config/supabase";
import type { MaritalStatus, UserProfile } from "../types/domain";
import { throwIfError } from "./baseRepository";

export interface UserProfileUpsertInput {
  nickname?: string | null;
  birth_date?: string | null;
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
  }
};
