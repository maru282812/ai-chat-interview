import { supabase } from "../config/supabase";
import { throwIfError, requireData } from "./baseRepository";
import type { QuestionPageGroup } from "../types/domain";

interface CreatePageGroupInput {
  project_id: string;
  page_number: number;
  title?: string | null;
  description?: string | null;
  sort_order?: number;
}

export const questionPageGroupRepository = {
  async listByProject(projectId: string): Promise<QuestionPageGroup[]> {
    const { data, error } = await supabase
      .from("question_page_groups")
      .select("*")
      .eq("project_id", projectId)
      .order("sort_order", { ascending: true });
    if (error) {
      // 016_question_schema_redesign.sql 未適用の場合（テーブル未存在）は空配列を返す
      // 本番では必ず migration を適用すること
      console.warn(
        "[questionPageGroupRepository] listByProject: テーブルが見つかりません。" +
        " 016_question_schema_redesign.sql を Supabase に適用してください。" +
        " error=" + error.message
      );
      return [];
    }
    return (data ?? []) as QuestionPageGroup[];
  },

  async getById(id: string): Promise<QuestionPageGroup> {
    const { data, error } = await supabase
      .from("question_page_groups")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return requireData(data as QuestionPageGroup | null, "QuestionPageGroup not found");
  },

  async create(input: CreatePageGroupInput): Promise<QuestionPageGroup> {
    const { data, error } = await supabase
      .from("question_page_groups")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return data as QuestionPageGroup;
  },

  async update(
    id: string,
    input: Partial<Pick<QuestionPageGroup, "title" | "description" | "sort_order" | "page_number">>
  ): Promise<QuestionPageGroup> {
    const { data, error } = await supabase
      .from("question_page_groups")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as QuestionPageGroup;
  },

  async deleteById(id: string): Promise<void> {
    const { error } = await supabase.from("question_page_groups").delete().eq("id", id);
    throwIfError(error);
  },

  async ensurePage(projectId: string, pageNumber: number, title?: string | null): Promise<QuestionPageGroup> {
    const { data: existing, error: selectError } = await supabase
      .from("question_page_groups")
      .select("*")
      .eq("project_id", projectId)
      .eq("page_number", pageNumber)
      .maybeSingle();
    throwIfError(selectError);
    if (existing) {
      return existing as QuestionPageGroup;
    }
    return this.create({
      project_id: projectId,
      page_number: pageNumber,
      title: title ?? `ページ ${pageNumber}`,
      sort_order: pageNumber,
    });
  },
};
