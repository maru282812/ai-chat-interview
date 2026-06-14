import { supabase } from "../config/supabase";
import { throwIfError } from "./baseRepository";

const TABLE = "project_prompt_package_change_logs";

export interface ProjectPromptPackageChangeLog {
  id: string;
  project_id: string;
  old_prompt_package_version_id: string | null;
  new_prompt_package_version_id: string | null;
  old_package_slug: string | null;
  new_package_slug: string | null;
  old_version_no: number | null;
  new_version_no: number | null;
  old_mode: string | null;
  new_mode: string | null;
  change_reason: string | null;
  changed_by: string | null;
  changed_at: string;
}

export interface ChangeLogCreateInput {
  projectId: string;
  oldVersionId: string | null;
  newVersionId: string | null;
  oldPackageSlug: string | null;
  newPackageSlug: string | null;
  oldVersionNo: number | null;
  newVersionNo: number | null;
  oldMode: string | null;
  newMode: string | null;
  changeReason?: string | null;
  changedBy?: string | null;
}

export const projectPromptPackageChangeLogRepository = {
  async create(input: ChangeLogCreateInput): Promise<ProjectPromptPackageChangeLog> {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        project_id:                    input.projectId,
        old_prompt_package_version_id: input.oldVersionId,
        new_prompt_package_version_id: input.newVersionId,
        old_package_slug:              input.oldPackageSlug,
        new_package_slug:              input.newPackageSlug,
        old_version_no:                input.oldVersionNo,
        new_version_no:                input.newVersionNo,
        old_mode:                      input.oldMode,
        new_mode:                      input.newMode,
        change_reason:                 input.changeReason ?? null,
        changed_by:                    input.changedBy ?? null,
      })
      .select("*")
      .single();
    throwIfError(error);
    return data as ProjectPromptPackageChangeLog;
  },

  async listByProject(projectId: string): Promise<ProjectPromptPackageChangeLog[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("changed_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as ProjectPromptPackageChangeLog[];
  },
};
