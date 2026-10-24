import { supabase } from "../config/supabase";
import { logger } from "../lib/logger";
import { throwIfError } from "./baseRepository";

/**
 * テスト運営者（migration 119）。
 *
 * ここに載った LINE userId は、完了済みのアンケートを何度でも回答し直せる。
 * 回答は respondents.is_test で集計から外し、ポイント・キャンペーン件数も動かさない。
 */
export interface TestOperator {
  line_user_id: string;
  label: string;
  created_at: string;
}

export const testOperatorRepository = {
  async list(): Promise<TestOperator[]> {
    const { data, error } = await supabase
      .from("test_operators")
      .select("*")
      .order("created_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as TestOperator[];
  },

  /**
   * 回答画面・完了処理など全回答者の経路から呼ばれるので、判定に失敗しても例外にしない。
   * 失敗時は「運営者ではない」に倒す（migration 119 適用前のデプロイでも回答を止めない）。
   */
  async isTestOperator(lineUserId: string | null | undefined): Promise<boolean> {
    if (!lineUserId) return false;
    const { data, error } = await supabase
      .from("test_operators")
      .select("line_user_id")
      .eq("line_user_id", lineUserId)
      .maybeSingle();
    if (error) {
      logger.warn("testOperator.lookupFailed", { error: error.message });
      return false;
    }
    return Boolean(data);
  },

  async upsert(input: { line_user_id: string; label: string }): Promise<void> {
    const { error } = await supabase.from("test_operators").upsert(input, { onConflict: "line_user_id" });
    throwIfError(error);
  },

  async remove(lineUserId: string): Promise<void> {
    const { error } = await supabase.from("test_operators").delete().eq("line_user_id", lineUserId);
    throwIfError(error);
  }
};
