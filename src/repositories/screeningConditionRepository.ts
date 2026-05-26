import { supabase } from "../config/supabase";
import type { ScreeningCondition, ScreeningConditionType, ScreeningOperator } from "../types/domain";
import { throwIfError } from "./baseRepository";

interface CreateScreeningConditionInput {
  project_id: string;
  condition_type: ScreeningConditionType;
  target_key: string;
  operator: ScreeningOperator;
  value_json: unknown;
  priority?: number;
}

export const screeningConditionRepository = {
  async listByProject(projectId: string): Promise<ScreeningCondition[]> {
    const { data, error } = await supabase
      .from("screening_conditions")
      .select("*")
      .eq("project_id", projectId)
      .order("priority", { ascending: true })
      .order("created_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as ScreeningCondition[];
  },

  async create(input: CreateScreeningConditionInput): Promise<ScreeningCondition> {
    const payload = {
      ...input,
      priority: input.priority ?? 0,
      value_json: input.value_json
    };
    const { data, error } = await supabase
      .from("screening_conditions")
      .insert(payload)
      .select("*")
      .single();
    throwIfError(error);
    return data as ScreeningCondition;
  },

  async delete(id: string): Promise<void> {
    const { error } = await supabase.from("screening_conditions").delete().eq("id", id);
    throwIfError(error);
  },

  async replaceProfileConditions(
    projectId: string,
    conditions: Array<{
      condition_type: "profile";
      target_key: string;
      operator: ScreeningOperator;
      value_json: unknown;
      priority: number;
    }>
  ): Promise<void> {
    const { error: deleteError } = await supabase
      .from("screening_conditions")
      .delete()
      .eq("project_id", projectId)
      .eq("condition_type", "profile");
    throwIfError(deleteError);

    if (conditions.length === 0) return;

    const { error: insertError } = await supabase
      .from("screening_conditions")
      .insert(conditions.map(c => ({ ...c, project_id: projectId })));
    throwIfError(insertError);
  }
};
