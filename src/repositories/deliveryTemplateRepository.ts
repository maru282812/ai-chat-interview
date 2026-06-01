import { supabase } from "../config/supabase";
import { requireData, throwIfError } from "./baseRepository";
import type { DeliveryType } from "../types/domain";

export type DeliveryScheduleType = "daily" | "weekly" | "interval";

export interface DailyScheduleConfig {
  hour: number;
  minute: number;
}

export interface WeeklyScheduleConfig {
  weekday: number; // 0=日, 1=月, ..., 6=土
  hour: number;
  minute: number;
}

export interface IntervalScheduleConfig {
  interval_minutes: number;
}

export type DeliveryScheduleConfig = DailyScheduleConfig | WeeklyScheduleConfig | IntervalScheduleConfig;

export interface DeliveryTemplate {
  id: string;
  name: string;
  is_enabled: boolean;
  schedule_type: DeliveryScheduleType;
  schedule_config: DeliveryScheduleConfig;
  target_types: DeliveryType[];
  require_status: string;
  require_delivery_enabled: boolean;
  created_within_hours: number | null;
  notification_template_id: string | null;
  segment_config: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryLog {
  id: string;
  template_id: string;
  executed_at: string;
  project_ids: string[];
  target_user_count: number;
  success_count: number;
  fail_count: number;
  error_detail: Record<string, unknown> | null;
  created_at: string;
}

export interface DeliveryTemplateMutationInput {
  name: string;
  is_enabled: boolean;
  schedule_type: DeliveryScheduleType;
  schedule_config: DeliveryScheduleConfig;
  target_types: DeliveryType[];
  require_status?: string;
  require_delivery_enabled?: boolean;
  created_within_hours?: number | null;
  notification_template_id?: string | null;
  segment_config?: Record<string, unknown> | null;
}

export interface DeliveryLogCreateInput {
  template_id: string;
  executed_at: string;
  project_ids: string[];
  target_user_count: number;
  success_count: number;
  fail_count: number;
  error_detail?: Record<string, unknown> | null;
}

export const deliveryTemplateRepository = {
  async list(): Promise<DeliveryTemplate[]> {
    const { data, error } = await supabase
      .from("delivery_templates")
      .select("*")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as DeliveryTemplate[];
  },

  async listEnabled(): Promise<DeliveryTemplate[]> {
    const { data, error } = await supabase
      .from("delivery_templates")
      .select("*")
      .eq("is_enabled", true)
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as DeliveryTemplate[];
  },

  async getById(id: string): Promise<DeliveryTemplate> {
    const { data, error } = await supabase
      .from("delivery_templates")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return requireData(data as DeliveryTemplate | null, "DeliveryTemplate not found");
  },

  async create(input: DeliveryTemplateMutationInput): Promise<DeliveryTemplate> {
    const { data, error } = await supabase
      .from("delivery_templates")
      .insert({
        ...input,
        require_status: input.require_status ?? "ready",
        require_delivery_enabled: input.require_delivery_enabled ?? true,
      })
      .select("*")
      .single();
    throwIfError(error);
    return data as DeliveryTemplate;
  },

  async update(id: string, input: Partial<DeliveryTemplateMutationInput>): Promise<DeliveryTemplate> {
    const { data, error } = await supabase
      .from("delivery_templates")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as DeliveryTemplate;
  },

  async deleteById(id: string): Promise<void> {
    const { error } = await supabase
      .from("delivery_templates")
      .delete()
      .eq("id", id);
    throwIfError(error);
  },

  async listLogs(templateId: string, limit = 20): Promise<DeliveryLog[]> {
    const { data, error } = await supabase
      .from("delivery_logs")
      .select("*")
      .eq("template_id", templateId)
      .order("executed_at", { ascending: false })
      .limit(limit);
    throwIfError(error);
    return (data ?? []) as DeliveryLog[];
  },

  async listAllLogs(limit = 50): Promise<DeliveryLog[]> {
    const { data, error } = await supabase
      .from("delivery_logs")
      .select("*")
      .order("executed_at", { ascending: false })
      .limit(limit);
    throwIfError(error);
    return (data ?? []) as DeliveryLog[];
  },

  async createLog(input: DeliveryLogCreateInput): Promise<DeliveryLog> {
    const { data, error } = await supabase
      .from("delivery_logs")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return data as DeliveryLog;
  },
};
