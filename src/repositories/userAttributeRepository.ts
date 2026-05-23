import { supabase } from "../config/supabase";
import { throwIfError } from "./baseRepository";

export interface AttributeDefinition {
  id: string;
  attr_key: string;
  label: string;
  category: "basic" | "lifestyle" | "interest" | "ai_inferred";
  data_type: "text" | "boolean" | "number" | "json" | "tags";
  is_user_editable: boolean;
  is_admin_only: boolean;
  is_company_visible: boolean;
  sort_order: number;
  created_at: string;
}

export interface UserAttribute {
  id: string;
  line_user_id: string;
  attr_key: string;
  value_text: string | null;
  value_json: unknown | null;
  value_number: number | null;
  source: "user" | "admin" | "ai_inferred";
  confidence: number | null;
  is_private: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserAttributeWithDef extends UserAttribute {
  definition?: AttributeDefinition | null;
}

export const userAttributeRepository = {
  async listDefinitions(): Promise<AttributeDefinition[]> {
    const { data, error } = await supabase
      .from("attribute_definitions")
      .select("*")
      .order("sort_order", { ascending: true });
    throwIfError(error);
    return (data ?? []) as AttributeDefinition[];
  },

  async createDefinition(input: Omit<AttributeDefinition, "id" | "created_at">): Promise<AttributeDefinition> {
    const { data, error } = await supabase
      .from("attribute_definitions")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return data as AttributeDefinition;
  },

  async updateDefinition(id: string, input: Partial<Omit<AttributeDefinition, "id" | "created_at">>): Promise<AttributeDefinition> {
    const { data, error } = await supabase
      .from("attribute_definitions")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as AttributeDefinition;
  },

  async deleteDefinition(id: string): Promise<void> {
    const { error } = await supabase.from("attribute_definitions").delete().eq("id", id);
    throwIfError(error);
  },

  async listByUser(lineUserId: string): Promise<UserAttributeWithDef[]> {
    const { data, error } = await supabase
      .from("user_attributes")
      .select("*, definition:attribute_definitions(*)")
      .eq("line_user_id", lineUserId)
      .order("attr_key", { ascending: true });
    throwIfError(error);
    return (data ?? []) as UserAttributeWithDef[];
  },

  async listAll(opts?: { source?: string; attr_key?: string; limit?: number }): Promise<UserAttribute[]> {
    let query = supabase
      .from("user_attributes")
      .select("*")
      .order("updated_at", { ascending: false });
    if (opts?.source) query = query.eq("source", opts.source);
    if (opts?.attr_key) query = query.eq("attr_key", opts.attr_key);
    if (opts?.limit) query = query.limit(opts.limit);
    const { data, error } = await query;
    throwIfError(error);
    return (data ?? []) as UserAttribute[];
  },

  async upsert(input: {
    line_user_id: string;
    attr_key: string;
    value_text?: string | null;
    value_json?: unknown | null;
    value_number?: number | null;
    source: "user" | "admin" | "ai_inferred";
    confidence?: number | null;
    is_private?: boolean;
  }): Promise<UserAttribute> {
    const { data, error } = await supabase
      .from("user_attributes")
      .upsert(input, { onConflict: "line_user_id,attr_key" })
      .select("*")
      .single();
    throwIfError(error);
    return data as UserAttribute;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from("user_attributes").delete().eq("id", id);
    throwIfError(error);
  },

  async countByAttrKey(): Promise<{ attr_key: string; count: number }[]> {
    const { data, error } = await supabase
      .from("user_attributes")
      .select("attr_key");
    throwIfError(error);
    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as { attr_key: string }[]) {
      counts[row.attr_key] = (counts[row.attr_key] ?? 0) + 1;
    }
    return Object.entries(counts).map(([attr_key, count]) => ({ attr_key, count }));
  }
};
