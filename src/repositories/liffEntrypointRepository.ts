import { supabase } from "../config/supabase";
import type { LiffEntrypoint } from "../types/domain";
import { throwIfError } from "./baseRepository";

export const liffEntrypointRepository = {
  async listActive(): Promise<LiffEntrypoint[]> {
    const { data, error } = await supabase
      .from("liff_entrypoints")
      .select("*")
      .eq("is_active", true)
      .order("entry_key", { ascending: true });
    throwIfError(error);
    return (data ?? []) as LiffEntrypoint[];
  },

  async getByEntryKey(entryKey: string): Promise<LiffEntrypoint | null> {
    const { data, error } = await supabase
      .from("liff_entrypoints")
      .select("*")
      .eq("entry_key", entryKey)
      .eq("is_active", true)
      .maybeSingle();
    throwIfError(error);
    return (data as LiffEntrypoint | null) ?? null;
  },

  async getByEntryType(
    entryType: LiffEntrypoint["entry_type"]
  ): Promise<LiffEntrypoint | null> {
    const { data, error } = await supabase
      .from("liff_entrypoints")
      .select("*")
      .eq("entry_type", entryType)
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return (data as LiffEntrypoint | null) ?? null;
  }
};
