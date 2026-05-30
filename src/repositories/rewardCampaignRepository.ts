import { supabase } from "../config/supabase";
import { requireData, throwIfError } from "./baseRepository";

export type CampaignType =
  | "streak_bonus"
  | "birthday"
  | "seasonal"
  | "referral"
  | "dormancy_recovery"
  | "manual";

export type ConditionType = "streak_days" | "birthday_month" | "date_range" | "manual";

export interface RewardCampaign {
  id: string;
  name: string;
  description: string | null;
  campaign_type: CampaignType;
  bonus_points: number;
  condition_type: ConditionType;
  condition_value: Record<string, unknown>;
  target_segment_id: string | null;
  start_at: string | null;
  end_at: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type RewardCampaignInput = Omit<RewardCampaign, "id" | "created_at" | "updated_at">;

export const rewardCampaignRepository = {
  async list(): Promise<RewardCampaign[]> {
    const { data, error } = await supabase
      .from("reward_campaigns")
      .select("*")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as RewardCampaign[];
  },

  async getById(id: string): Promise<RewardCampaign> {
    const { data, error } = await supabase
      .from("reward_campaigns")
      .select("*")
      .eq("id", id)
      .single();
    throwIfError(error);
    return requireData(data, "RewardCampaign not found") as RewardCampaign;
  },

  async create(input: RewardCampaignInput): Promise<RewardCampaign> {
    const { data, error } = await supabase
      .from("reward_campaigns")
      .insert(input)
      .select()
      .single();
    throwIfError(error);
    return requireData(data, "RewardCampaign not found") as RewardCampaign;
  },

  async update(id: string, input: Partial<RewardCampaignInput>): Promise<RewardCampaign> {
    const { data, error } = await supabase
      .from("reward_campaigns")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    throwIfError(error);
    return requireData(data, "RewardCampaign not found") as RewardCampaign;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from("reward_campaigns").delete().eq("id", id);
    throwIfError(error);
  },

  async toggleActive(id: string): Promise<RewardCampaign> {
    const current = await this.getById(id);
    return this.update(id, { is_active: !current.is_active });
  }
};
