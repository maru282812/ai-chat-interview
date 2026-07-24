import { supabase } from "../config/supabase";
import { throwIfError } from "./baseRepository";

/** admin_ai_pending_actions の1行（migration 085） */
export interface AdminAiPendingAction {
  id: string;
  created_at: string;
  expires_at: string;
  screen_key: string;
  entity_id: string | null;
  instruction: string;
  tool_name: string;
  tool_args_json: Record<string, unknown>;
  summary: string;
  impact_json: string[];
  target_count: number | null;
  consumed_at: string | null;
  consumed_result: string | null;
}

export const adminAiPendingActionRepository = {
  async create(input: {
    screen_key: string;
    entity_id: string | null;
    instruction: string;
    tool_name: string;
    tool_args_json: Record<string, unknown>;
    summary: string;
    impact_json: string[];
    target_count: number | null;
  }): Promise<AdminAiPendingAction> {
    const { data, error } = await supabase
      .from("admin_ai_pending_actions")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return data as AdminAiPendingAction;
  },

  async getById(id: string): Promise<AdminAiPendingAction | null> {
    const { data, error } = await supabase
      .from("admin_ai_pending_actions")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return (data as AdminAiPendingAction | null) ?? null;
  },

  /**
   * 承認カードを使用済みにする。
   * consumed_at が null の行だけを対象にすることで、二度押し・リプレイでは
   * 更新行が 0 件になり実行に進めない（アプリ側のチェックだけに頼らない）。
   */
  async consume(id: string, result: string): Promise<boolean> {
    const { data, error } = await supabase
      .from("admin_ai_pending_actions")
      .update({ consumed_at: new Date().toISOString(), consumed_result: result })
      .eq("id", id)
      .is("consumed_at", null)
      .select("id");
    throwIfError(error);
    return ((data as unknown[]) ?? []).length > 0;
  },
};
