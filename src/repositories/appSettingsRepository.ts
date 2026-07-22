import { supabase } from "../config/supabase";
import { throwIfError } from "./baseRepository";

/**
 * app_settings（migration 083）の永続化層。
 * サーバー専用の key-value 設定。RLS は policy なし＝anon/authenticated 全拒否で、
 * service_role クライアント（config/supabase）からのみ読み書きする。
 *
 * 現行キー:
 *   - 'experience_defaults' … 若年層体験パックの全体既定（src/lib/experienceConfig.ts の EXPERIENCE_KEYS）
 */

/** 若年層体験パックの全体既定を格納する app_settings のキー。 */
export const EXPERIENCE_DEFAULTS_KEY = "experience_defaults";

export interface AppSetting {
  key: string;
  value: Record<string, unknown>;
  updated_at: string;
}

export const appSettingsRepository = {
  /** 行が無ければ null（呼び出し側でコード既定に落とす）。読み取り失敗は例外にする。 */
  async get(key: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await supabase
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle();
    throwIfError(error);
    const row = data as { value: unknown } | null;
    if (!row) return null;
    return row.value !== null && typeof row.value === "object" && !Array.isArray(row.value)
      ? (row.value as Record<string, unknown>)
      : {};
  },

  /** 丸ごと置き換え（部分更新はしない）。管理画面の保存はこれ 1 本。 */
  async upsert(key: string, value: Record<string, unknown>): Promise<void> {
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    throwIfError(error);
  },
};
