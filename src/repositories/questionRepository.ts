import { supabase } from "../config/supabase";
import type { Question } from "../types/domain";
import { requireData, throwIfError } from "./baseRepository";

export const questionRepository = {
  async listByProject(projectId: string): Promise<Question[]> {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true });
    throwIfError(error);
    return (data ?? []) as Question[];
  },

  async getById(id: string): Promise<Question> {
    const { data, error } = await supabase.from("questions").select("*").eq("id", id).maybeSingle();
    throwIfError(error);
    return requireData(data as Question | null, "Question not found");
  },

  async getByProjectAndCode(projectId: string, questionCode: string): Promise<Question | null> {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .eq("project_id", projectId)
      .eq("question_code", questionCode)
      .maybeSingle();
    throwIfError(error);
    return (data as Question | null) ?? null;
  },

  async getFirstByProject(projectId: string): Promise<Question | null> {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return (data as Question | null) ?? null;
  },

  async getNextBySortOrder(projectId: string, currentSortOrder: number): Promise<Question | null> {
    const { data, error } = await supabase
      .from("questions")
      .select("*")
      .eq("project_id", projectId)
      .gt("sort_order", currentSortOrder)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return (data as Question | null) ?? null;
  },

  async create(input: Omit<Question, "id" | "created_at" | "updated_at">): Promise<Question> {
    const { data, error } = await supabase.from("questions").insert(input).select("*").single();
    throwIfError(error);
    return data as Question;
  },

  async update(
    id: string,
    input: Partial<
      Pick<
        Question,
        | "question_code"
        | "question_text"
        | "question_type"
        | "is_required"
        | "sort_order"
        | "branch_rule"
        | "question_config"
        | "ai_probe_enabled"
      >
    >
  ): Promise<Question> {
    const { data, error } = await supabase
      .from("questions")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as Question;
  }
};
