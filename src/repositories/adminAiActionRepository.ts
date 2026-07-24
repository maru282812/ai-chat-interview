import { supabase } from "../config/supabase";
import { throwIfError } from "./baseRepository";

/** admin_ai_actions への1行分の記録（migration 084） */
export interface AdminAiActionInput {
  screen_key: string;
  entity_id: string | null;
  /** 発端になったユーザー指示。長文は呼び出し側でトリム済みを渡す */
  instruction: string;
  tool_name: string;
  tool_args_json: Record<string, unknown>;
  tier: "A" | "B" | "C";
  /** Tier C の承認カード経由なら true。A/B は null */
  approved?: boolean | null;
  result_status: "ok" | "error" | "blocked";
  result_summary?: string | null;
  ai_log_id?: string | null;
}

export const adminAiActionRepository = {
  async create(input: AdminAiActionInput): Promise<void> {
    const { error } = await supabase.from("admin_ai_actions").insert({
      approved: null,
      result_summary: null,
      ai_log_id: null,
      ...input,
    });
    throwIfError(error);
  },

  async listRecent(params: { screenKey?: string; limit?: number } = {}): Promise<unknown[]> {
    const limit = Math.min(params.limit ?? 50, 200);
    let query = supabase
      .from("admin_ai_actions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (params.screenKey) {
      query = query.eq("screen_key", params.screenKey);
    }
    const { data, error } = await query;
    throwIfError(error);
    return (data as unknown[]) ?? [];
  },
};
