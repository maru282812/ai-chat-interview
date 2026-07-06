import { supabase } from "../config/supabase";
import type { QuestionnaireSnapshot } from "../types/domain";
import { throwIfError } from "./baseRepository";

export const questionnaireSnapshotRepository = {
  async listByProject(projectId: string): Promise<QuestionnaireSnapshot[]> {
    const { data, error } = await supabase
      .from("questionnaire_snapshots")
      .select("*")
      .eq("project_id", projectId)
      .order("version", { ascending: false });
    throwIfError(error);
    return (data ?? []) as QuestionnaireSnapshot[];
  },

  async getLatest(projectId: string): Promise<QuestionnaireSnapshot | null> {
    const { data, error } = await supabase
      .from("questionnaire_snapshots")
      .select("*")
      .eq("project_id", projectId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return (data as QuestionnaireSnapshot | null) ?? null;
  },

  async getActive(projectId: string): Promise<QuestionnaireSnapshot | null> {
    const { data, error } = await supabase
      .from("questionnaire_snapshots")
      .select("*")
      .eq("project_id", projectId)
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return (data as QuestionnaireSnapshot | null) ?? null;
  },

  async getByHash(projectId: string, hash: string): Promise<QuestionnaireSnapshot | null> {
    const { data, error } = await supabase
      .from("questionnaire_snapshots")
      .select("*")
      .eq("project_id", projectId)
      .eq("snapshot_hash", hash)
      .maybeSingle();
    throwIfError(error);
    return (data as QuestionnaireSnapshot | null) ?? null;
  },

  async create(input: {
    project_id: string;
    version: number;
    wave_code?: string | null;
    snapshot_hash: string;
    definition_json: Record<string, unknown>;
    is_active?: boolean;
  }): Promise<QuestionnaireSnapshot> {
    const { data, error } = await supabase
      .from("questionnaire_snapshots")
      .insert({ is_active: true, ...input })
      .select("*")
      .single();
    throwIfError(error);
    return data as QuestionnaireSnapshot;
  }
};
