import { supabase } from "../config/supabase";
import type { AILog } from "../types/domain";
import { throwIfError } from "./baseRepository";

export interface AILogWithProject extends AILog {
  project_id: string | null;
  project_name: string | null;
}

export const aiLogRepository = {
  async create(input: {
    /** Phase 7-A: セッション外実行（プロジェクト分析・投稿分析・ペルソナタグ等）は null */
    session_id: string | null;
    purpose: string;
    prompt: string;
    response: string;
    token_usage?: Record<string, unknown> | null;
    // Phase 3: プロンプト追跡フィールド
    prompt_key?: string | null;
    template_key?: string | null;
    template_mode?: string | null;
    policy_snapshot?: Record<string, unknown> | null;
    rendered_prompt?: string | null;
    // Phase 3: パッケージ追跡フィールド (Migration 054)
    package_id?: string | null;
    package_version_id?: string | null;
    package_slug?: string | null;
    package_version_no?: number | null;
    // Phase A: 実行時プロンプト解決状態 (Migration 061)
    resolution_json?: Record<string, unknown> | null;
  }): Promise<AILog> {
    const { data, error } = await supabase.from("ai_logs").insert(input).select("*").single();
    throwIfError(error);
    return data as AILog;
  },

  async listWithProject(filters: {
    projectId?: string;
    promptKey?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ logs: AILogWithProject[]; total: number }> {
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    // Phase 7-A: セッション外実行ログ（session_id null）も一覧に出すため、
    // プロジェクト絞り込み時のみ inner join にする
    const sessionJoin = filters.projectId ? "sessions!inner" : "sessions";

    // カウント用クエリ
    let countQuery = supabase
      .from("ai_logs")
      .select(`id, ${sessionJoin}(project_id)`, { count: "exact", head: true });

    if (filters.projectId) {
      countQuery = countQuery.eq("sessions.project_id", filters.projectId);
    }
    if (filters.promptKey) {
      countQuery = countQuery.eq("prompt_key", filters.promptKey);
    }

    const { count } = await countQuery;

    // データ取得クエリ
    let dataQuery = supabase
      .from("ai_logs")
      .select(`
        *,
        ${sessionJoin}(
          project_id,
          projects(name)
        )
      `)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (filters.projectId) {
      dataQuery = dataQuery.eq("sessions.project_id", filters.projectId);
    }
    if (filters.promptKey) {
      dataQuery = dataQuery.eq("prompt_key", filters.promptKey);
    }

    const { data, error } = await dataQuery;
    throwIfError(error);

    const logs = ((data as unknown[]) ?? []).map((row: unknown) => {
      const r = row as Record<string, unknown>;
      const session = r["sessions"] as Record<string, unknown> | null;
      const project = session?.["projects"] as Record<string, unknown> | null;
      return {
        ...r,
        sessions: undefined,
        project_id: (session?.["project_id"] as string) ?? null,
        project_name: (project?.["name"] as string) ?? null,
      } as unknown as AILogWithProject;
    });

    return { logs, total: count ?? 0 };
  },

  async getByIdWithProject(id: string): Promise<AILogWithProject | null> {
    const { data, error } = await supabase
      .from("ai_logs")
      .select(`
        *,
        sessions(
          project_id,
          projects(name)
        )
      `)
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    if (!data) return null;

    const r = data as Record<string, unknown>;
    const session = r["sessions"] as Record<string, unknown> | null;
    const project = session?.["projects"] as Record<string, unknown> | null;
    return {
      ...r,
      sessions: undefined,
      project_id: (session?.["project_id"] as string) ?? null,
      project_name: (project?.["name"] as string) ?? null,
    } as unknown as AILogWithProject;
  }
};
