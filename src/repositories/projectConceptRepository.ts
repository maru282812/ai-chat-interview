import { supabase } from "../config/supabase";
import type { ProjectConcept } from "../types/domain";
import { throwIfError } from "./baseRepository";

export const projectConceptRepository = {
  async listByProject(projectId: string): Promise<ProjectConcept[]> {
    const { data, error } = await supabase
      .from("project_concepts")
      .select("*")
      .eq("project_id", projectId)
      .order("master_order", { ascending: true });
    if (error) {
      // migration 070 未適用時はテーブル未存在 → 空配列（後方互換・単一コンセプト扱い）
      return [];
    }
    return (data ?? []) as ProjectConcept[];
  },

  async create(input: {
    project_id: string;
    concept_code: string;
    title?: string | null;
    description?: string | null;
    master_order?: number;
    is_active?: boolean;
  }): Promise<ProjectConcept> {
    const { data, error } = await supabase.from("project_concepts").insert(input).select("*").single();
    throwIfError(error);
    return data as ProjectConcept;
  },

  async update(
    id: string,
    input: Partial<Pick<ProjectConcept, "concept_code" | "title" | "description" | "master_order" | "is_active">>
  ): Promise<ProjectConcept> {
    const { data, error } = await supabase
      .from("project_concepts")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as ProjectConcept;
  },

  async deleteById(id: string): Promise<void> {
    const { error } = await supabase.from("project_concepts").delete().eq("id", id);
    throwIfError(error);
  }
};
