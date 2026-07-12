import { supabase } from "../config/supabase";
import { throwIfError } from "./baseRepository";

/**
 * export_jobs（統計エクスポート監査ログ・migration 076/077）。
 * 誰が・いつ・どのプロジェクトの・何を・どのフィルタで出力したかを記録する。
 * 商用副作用のため呼び出し側はレスポンス前に await すること（Vercel サーバーレス方針）。
 */

export interface ExportJob {
  id: string;
  project_id: string;
  export_type: string;
  filters_json: Record<string, unknown>;
  exported_by: string | null;
  exported_at: string;
}

export interface ExportJobCreateInput {
  project_id: string;
  export_type: string;
  filters_json?: Record<string, unknown>;
  exported_by?: string | null;
}

export const exportJobRepository = {
  async create(input: ExportJobCreateInput): Promise<ExportJob> {
    const { data, error } = await supabase
      .from("export_jobs")
      .insert({
        project_id: input.project_id,
        export_type: input.export_type,
        filters_json: input.filters_json ?? {},
        exported_by: input.exported_by ?? null
      })
      .select("*")
      .single();
    throwIfError(error);
    return data as ExportJob;
  },

  async listByProject(projectId: string, limit = 50): Promise<ExportJob[]> {
    const { data, error } = await supabase
      .from("export_jobs")
      .select("*")
      .eq("project_id", projectId)
      .order("exported_at", { ascending: false })
      .limit(limit);
    throwIfError(error);
    return (data ?? []) as ExportJob[];
  }
};
