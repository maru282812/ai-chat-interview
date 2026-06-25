import { supabase } from "../config/supabase";
import { requireData, throwIfError } from "./baseRepository";

/**
 * 企業・店舗マスタ（migration 064 で追加した clients テーブル）。
 * 店舗専用アンケート（projects.visibility_type='private_store'）を発注元の店舗に
 * 紐づけて管理するために使う。単発運用では未使用でもよい。
 */
export interface Client {
  id: string;
  name: string;
  contact: string | null;
  created_at: string;
}

export interface ClientMutationInput {
  name: string;
  contact?: string | null;
}

export const clientRepository = {
  async list(): Promise<Client[]> {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as Client[];
  },

  async getById(id: string): Promise<Client> {
    const { data, error } = await supabase
      .from("clients")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return requireData(data as Client | null, `Client not found: ${id}`);
  },

  async create(input: ClientMutationInput): Promise<Client> {
    const { data, error } = await supabase
      .from("clients")
      .insert({ name: input.name, contact: input.contact ?? null })
      .select("*")
      .single();
    throwIfError(error);
    return data as Client;
  },

  async update(id: string, input: ClientMutationInput): Promise<Client> {
    const { data, error } = await supabase
      .from("clients")
      .update({ name: input.name, contact: input.contact ?? null })
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as Client | null, `Client not found: ${id}`);
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from("clients").delete().eq("id", id);
    throwIfError(error);
  }
};
