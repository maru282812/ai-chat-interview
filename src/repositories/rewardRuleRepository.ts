import { supabase } from "../config/supabase";
import type { RewardRule } from "../types/domain";
import { throwIfError } from "./baseRepository";

export const rewardRuleRepository = {
  async listActive(projectId?: string): Promise<RewardRule[]> {
    let query = supabase.from("reward_rules").select("*").eq("is_active", true);
    if (projectId) {
      query = query.or(`project_id.eq.${projectId},rule_type.eq.global`);
    }
    const { data, error } = await query.order("rule_type", { ascending: true });
    throwIfError(error);
    return (data ?? []) as RewardRule[];
  }
};
