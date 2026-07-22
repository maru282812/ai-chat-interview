import { supabase } from "../config/supabase";
import { throwIfError, requireData } from "./baseRepository";
import type { ProjectApplication, ProjectApplicationStatus } from "../types/domain";

export interface ProjectApplicationCreateInput {
  project_id: string;
  line_user_id: string;
  respondent_id?: string | null;
  status?: ProjectApplicationStatus;
  assignment_id?: string | null;
}

export interface ProjectApplicationUpdateInput {
  status?: ProjectApplicationStatus;
  respondent_id?: string | null;
  assignment_id?: string | null;
  note?: string | null;
  decided_at?: string | null;
}

/** 応募（project_applications・Migration 072）のCRUD */
export const projectApplicationRepository = {
  async create(input: ProjectApplicationCreateInput): Promise<ProjectApplication> {
    const { data, error } = await supabase
      .from("project_applications")
      .insert({
        project_id: input.project_id,
        line_user_id: input.line_user_id,
        respondent_id: input.respondent_id ?? null,
        status: input.status ?? "applied",
        assignment_id: input.assignment_id ?? null,
      })
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as ProjectApplication | null, "応募の作成に失敗しました");
  },

  async findByProjectAndUser(projectId: string, lineUserId: string): Promise<ProjectApplication | null> {
    const { data, error } = await supabase
      .from("project_applications")
      .select("*")
      .eq("project_id", projectId)
      .eq("line_user_id", lineUserId)
      .maybeSingle();
    throwIfError(error);
    return (data as ProjectApplication | null) ?? null;
  },

  async getById(id: string): Promise<ProjectApplication | null> {
    const { data, error } = await supabase
      .from("project_applications")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return (data as ProjectApplication | null) ?? null;
  },

  async listByUser(lineUserId: string): Promise<ProjectApplication[]> {
    const { data, error } = await supabase
      .from("project_applications")
      .select("*")
      .eq("line_user_id", lineUserId)
      .order("applied_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as ProjectApplication[];
  },

  async listByProject(projectId: string): Promise<ProjectApplication[]> {
    const { data, error } = await supabase
      .from("project_applications")
      .select("*")
      .eq("project_id", projectId)
      .order("applied_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as ProjectApplication[];
  },

  async update(id: string, input: ProjectApplicationUpdateInput): Promise<ProjectApplication> {
    const { data, error } = await supabase
      .from("project_applications")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return requireData(data as ProjectApplication | null, "応募の更新に失敗しました");
  },

  /** 当月応募数（マイページ/一覧の n/10件 表示用）。JST基準の月初から数える。 */
  async countMonthlyByUser(lineUserId: string, now: Date = new Date()): Promise<number> {
    // JSTの月初 00:00 を UTC に変換（+09:00固定運用）
    const jst = new Date(now.getTime() + 9 * 3600_000);
    const monthStartUtc = new Date(Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), 1) - 9 * 3600_000);
    const { count, error } = await supabase
      .from("project_applications")
      .select("id", { count: "exact", head: true })
      .eq("line_user_id", lineUserId)
      .in("status", ["applied", "accepted"])
      .gte("applied_at", monthStartUtc.toISOString());
    throwIfError(error);
    return count ?? 0;
  },

  /** 選考待ちの応募総数（ダッシュボードの要対応キュー用） */
  async countPending(): Promise<number> {
    const { count, error } = await supabase
      .from("project_applications")
      .select("id", { count: "exact", head: true })
      .eq("status", "applied");
    throwIfError(error);
    return count ?? 0;
  },

  /** 案件の有効応募数（満枠判定用）。withdrawn/rejected/expired は数えない。 */
  async countActiveByProject(projectId: string): Promise<number> {
    const { count, error } = await supabase
      .from("project_applications")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .in("status", ["applied", "accepted"]);
    throwIfError(error);
    return count ?? 0;
  },

  /** ユーザーの応募済み project_id 集合（一覧の応募済み表示用） */
  async getAppliedProjectIds(lineUserId: string): Promise<Map<string, ProjectApplicationStatus>> {
    const { data, error } = await supabase
      .from("project_applications")
      .select("project_id, status")
      .eq("line_user_id", lineUserId);
    throwIfError(error);
    const map = new Map<string, ProjectApplicationStatus>();
    for (const row of (data ?? []) as { project_id: string; status: ProjectApplicationStatus }[]) {
      map.set(row.project_id, row.status);
    }
    return map;
  },
};
