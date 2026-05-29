import { supabase } from "../config/supabase";
import { requireData, throwIfError } from "./baseRepository";

export type NotificationCategory =
  | "daily_survey"
  | "answer_complete"
  | "unanswered_reminder"
  | "bonus_achieved"
  | "rank_up"
  | "point_grant"
  | "project_intro"
  | "attribute_update_request"
  | "birthday"
  | "dormancy_recovery"
  | "system";

export interface NotificationTemplate {
  id: string;
  category: NotificationCategory;
  name: string;
  description: string | null;
  message_type: "text" | "flex";
  title_text: string | null;
  body_text: string;
  action_label: string | null;
  action_url: string | null;
  flex_template: Record<string, unknown> | null;
  variables: string[];
  is_active: boolean;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export const notificationTemplateRepository = {
  async list(): Promise<NotificationTemplate[]> {
    const { data, error } = await supabase
      .from("notification_templates")
      .select("*")
      .order("category")
      .order("is_default", { ascending: false });
    throwIfError(error);
    return (data ?? []) as NotificationTemplate[];
  },

  async listByCategory(category: NotificationCategory, activeOnly = true): Promise<NotificationTemplate[]> {
    let query = supabase
      .from("notification_templates")
      .select("*")
      .eq("category", category)
      .order("is_default", { ascending: false });
    if (activeOnly) query = query.eq("is_active", true);
    const { data, error } = await query;
    throwIfError(error);
    return (data ?? []) as NotificationTemplate[];
  },

  async getById(id: string): Promise<NotificationTemplate> {
    const { data, error } = await supabase
      .from("notification_templates")
      .select("*")
      .eq("id", id)
      .single();
    throwIfError(error);
    return requireData(data as NotificationTemplate | null, `NotificationTemplate not found: ${id}`);
  },

  async getDefault(category: NotificationCategory): Promise<NotificationTemplate | null> {
    const { data, error } = await supabase
      .from("notification_templates")
      .select("*")
      .eq("category", category)
      .eq("is_default", true)
      .eq("is_active", true)
      .single();
    if (error?.code === "PGRST116") return null;
    throwIfError(error);
    return data as NotificationTemplate | null;
  },

  async create(input: Omit<NotificationTemplate, "id" | "created_at" | "updated_at">): Promise<NotificationTemplate> {
    const { data, error } = await supabase
      .from("notification_templates")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return data as NotificationTemplate;
  },

  async update(id: string, input: Partial<Omit<NotificationTemplate, "id" | "created_at" | "updated_at">>): Promise<NotificationTemplate> {
    const { data, error } = await supabase
      .from("notification_templates")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as NotificationTemplate | null, `NotificationTemplate not found: ${id}`);
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from("notification_templates").delete().eq("id", id);
    throwIfError(error);
  },

  renderBody(template: NotificationTemplate, vars: Record<string, string>): string {
    return template.body_text.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`);
  }
};
