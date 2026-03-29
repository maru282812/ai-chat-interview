import { supabase } from "../config/supabase";
import type { ProjectAnalysisReport } from "../types/domain";
import { throwIfError } from "./baseRepository";

export const projectAnalysisRepository = {
  async create(input: {
    project_id: string;
    respondent_count: number;
    completed_session_count: number;
    report_json: Record<string, unknown>;
  }): Promise<ProjectAnalysisReport> {
    const { data, error } = await supabase
      .from("project_analysis_reports")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return data as ProjectAnalysisReport;
  },

  async getLatestByProject(projectId: string): Promise<ProjectAnalysisReport | null> {
    const { data, error } = await supabase
      .from("project_analysis_reports")
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return (data as ProjectAnalysisReport | null) ?? null;
  }
};
