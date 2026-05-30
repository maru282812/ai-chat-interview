import { supabase } from "../config/supabase";
import { requireData, throwIfError } from "./baseRepository";

export type PriorityType =
  | "admin"
  | "missing_attribute"
  | "high_value_attribute"
  | "recent_gap"
  | "project_useful";

export type DailyQuestionType = "single_choice" | "multiple_choice" | "text" | "scale";

export interface DailyQuestionPriority {
  id: string;
  priority_type: PriorityType;
  attr_key: string | null;
  question_text: string;
  question_type: DailyQuestionType;
  answer_options: Array<{ label: string; value: string }>;
  sort_order: number;
  weight: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type DailyQuestionPriorityInput = Omit<
  DailyQuestionPriority,
  "id" | "created_at" | "updated_at"
>;

export const dailyQuestionPriorityRepository = {
  async list(): Promise<DailyQuestionPriority[]> {
    const { data, error } = await supabase
      .from("daily_question_priorities")
      .select("*")
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as DailyQuestionPriority[];
  },

  async listActive(): Promise<DailyQuestionPriority[]> {
    const { data, error } = await supabase
      .from("daily_question_priorities")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    throwIfError(error);
    return (data ?? []) as DailyQuestionPriority[];
  },

  async getById(id: string): Promise<DailyQuestionPriority> {
    const { data, error } = await supabase
      .from("daily_question_priorities")
      .select("*")
      .eq("id", id)
      .single();
    throwIfError(error);
    return requireData(data, "DailyQuestionPriority not found") as DailyQuestionPriority;
  },

  async create(input: DailyQuestionPriorityInput): Promise<DailyQuestionPriority> {
    const { data, error } = await supabase
      .from("daily_question_priorities")
      .insert(input)
      .select()
      .single();
    throwIfError(error);
    return requireData(data, "DailyQuestionPriority not found") as DailyQuestionPriority;
  },

  async update(
    id: string,
    input: Partial<DailyQuestionPriorityInput>
  ): Promise<DailyQuestionPriority> {
    const { data, error } = await supabase
      .from("daily_question_priorities")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    throwIfError(error);
    return requireData(data, "DailyQuestionPriority not found") as DailyQuestionPriority;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from("daily_question_priorities").delete().eq("id", id);
    throwIfError(error);
  },

  async toggleActive(id: string): Promise<DailyQuestionPriority> {
    const current = await this.getById(id);
    return this.update(id, { is_active: !current.is_active });
  }
};
