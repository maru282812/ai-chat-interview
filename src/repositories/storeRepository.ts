/**
 * storeRepository.ts
 *
 * 業種テンプレ（industry_templates）と店舗（stores）の永続化担当 (Migration 096)。
 *
 * ⚠ projects.partner_store_id は hibi-portal（別DB）の stores.id を指す外部参照で、
 *   このテーブルとは別軸。混同しないこと。
 */

import { supabase } from "../config/supabase";
import type { IndustryTemplate, Store } from "../types/domain";
import { requireData, throwIfError } from "./baseRepository";

export const industryTemplateRepository = {
  async list(): Promise<IndustryTemplate[]> {
    const { data, error } = await supabase
      .from("industry_templates")
      .select("*")
      .order("created_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as IndustryTemplate[];
  },

  async getById(id: string): Promise<IndustryTemplate | null> {
    const { data, error } = await supabase
      .from("industry_templates")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return (data as IndustryTemplate | null) ?? null;
  },

  async getByIndustryCode(code: string): Promise<IndustryTemplate | null> {
    const { data, error } = await supabase
      .from("industry_templates")
      .select("*")
      .eq("industry_code", code)
      .maybeSingle();
    throwIfError(error);
    return (data as IndustryTemplate | null) ?? null;
  },

  async create(input: {
    name: string;
    industry_code: string;
    description?: string | null;
    entry_template_project_id?: string | null;
    followup_template_project_id?: string | null;
    verify_template_project_id?: string | null;
    grace_days?: number;
    undecided_days?: number;
    restart_cooldown_days?: number;
    followup_b_delay_minutes?: number;
    frequency_question_code?: string;
    frequency_days_json?: Record<string, number> | null;
  }): Promise<IndustryTemplate> {
    const { data, error } = await supabase
      .from("industry_templates")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as IndustryTemplate | null, "IndustryTemplate insert returned no row");
  },

  async update(
    id: string,
    input: Partial<Omit<IndustryTemplate, "id" | "created_at" | "updated_at">>
  ): Promise<IndustryTemplate> {
    const { data, error } = await supabase
      .from("industry_templates")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as IndustryTemplate | null, "IndustryTemplate update returned no row");
  },
};

export const storeRepository = {
  async list(): Promise<Store[]> {
    const { data, error } = await supabase
      .from("stores")
      .select("*")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as Store[];
  },

  async getById(id: string): Promise<Store | null> {
    const { data, error } = await supabase.from("stores").select("*").eq("id", id).maybeSingle();
    throwIfError(error);
    return (data as Store | null) ?? null;
  },

  async getByCodeSlug(slug: string): Promise<Store | null> {
    const { data, error } = await supabase
      .from("stores")
      .select("*")
      .eq("code_slug", slug)
      .maybeSingle();
    throwIfError(error);
    return (data as Store | null) ?? null;
  },

  async listByClient(clientId: string): Promise<Store[]> {
    const { data, error } = await supabase
      .from("stores")
      .select("*")
      .eq("client_id", clientId)
      .order("created_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as Store[];
  },

  async listByTemplate(templateId: string): Promise<Store[]> {
    const { data, error } = await supabase
      .from("stores")
      .select("*")
      .eq("industry_template_id", templateId)
      .order("created_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as Store[];
  },

  async create(input: {
    client_id: string;
    industry_template_id?: string | null;
    name: string;
    code_slug: string;
    reward_points_override?: number | null;
  }): Promise<Store> {
    const { data, error } = await supabase.from("stores").insert(input).select("*").single();
    throwIfError(error);
    return requireData(data as Store | null, "Store insert returned no row");
  },

  async update(
    id: string,
    input: Partial<Pick<Store, "name" | "reward_points_override" | "is_active" | "industry_template_id">>
  ): Promise<Store> {
    const { data, error } = await supabase
      .from("stores")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as Store | null, "Store update returned no row");
  },
};
