import { supabase } from "../config/supabase";
import type { Rank, Respondent, RespondentStatus } from "../types/domain";
import { requireData, throwIfError } from "./baseRepository";

export const respondentRepository = {
  async getByLineUserAndProject(lineUserId: string, projectId: string): Promise<Respondent | null> {
    const { data, error } = await supabase
      .from("respondents")
      .select("*, current_rank:ranks(*)")
      .eq("line_user_id", lineUserId)
      .eq("project_id", projectId)
      .maybeSingle();
    throwIfError(error);
    return (data as (Respondent & { current_rank?: Rank | null }) | null) ?? null;
  },

  async create(input: {
    line_user_id: string;
    display_name?: string | null;
    project_id: string;
    status: RespondentStatus;
    total_points?: number;
    current_rank_id?: string | null;
  }): Promise<Respondent> {
    const { data, error } = await supabase.from("respondents").insert(input).select("*").single();
    throwIfError(error);
    return data as Respondent;
  },

  async update(
    id: string,
    input: Partial<
      Pick<Respondent, "display_name" | "status" | "total_points" | "current_rank_id">
    >
  ): Promise<Respondent> {
    const { data, error } = await supabase
      .from("respondents")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as Respondent;
  },

  async list(): Promise<(Respondent & { current_rank?: Rank | null })[]> {
    const { data, error } = await supabase
      .from("respondents")
      .select("*, current_rank:ranks(*)")
      .order("updated_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as (Respondent & { current_rank?: Rank | null })[];
  },

  /**
   * 管理画面の回答者一覧用。従来は `list()` が LIMIT 無しで全件を返し、呼び出し側が
   * 全セッションと突き合わせていたため件数増加でタイムアウトしていた。
   * 絞り込み・検索・件数取得をDB側で行い、1ページ分だけ返す。
   */
  async searchPaged(params: {
    projectId?: string;
    status?: string;
    q?: string;
    limit: number;
    offset: number;
  }): Promise<{
    rows: (Respondent & { current_rank?: Rank | null })[];
    total: number;
    offset: number;
  }> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyFilters = (query: any) => {
      let q = query;
      if (params.projectId) q = q.eq("project_id", params.projectId);
      if (params.status) q = q.eq("status", params.status);
      if (params.q) {
        // PostgREST の or フィルタは `,` `(` `)` を構文として解釈するため取り除く
        const needle = params.q.replace(/[,()*]/g, "").trim();
        if (needle) {
          q = q.or(`display_name.ilike.%${needle}%,line_user_id.ilike.%${needle}%`);
        }
      }
      return q;
    };

    // 先に件数を確定させる。PostgREST は総件数を超える range を要求すると
    // 「Requested range not satisfiable」で失敗するため、offset をここで丸める
    // （絞り込んだ結果が1ページに収まる状態で ?page=2 を開くと 500 になっていた）。
    const { error: countError, count } = await applyFilters(
      supabase.from("respondents").select("id", { count: "exact", head: true })
    );
    throwIfError(countError);
    const total = count ?? 0;

    if (total === 0) {
      return { rows: [], total: 0, offset: 0 };
    }

    const maxOffset = Math.max(0, Math.floor((total - 1) / params.limit) * params.limit);
    const offset = Math.min(Math.max(0, params.offset), maxOffset);

    const { data, error } = await applyFilters(
      supabase.from("respondents").select("*, current_rank:ranks(*)")
    )
      .order("updated_at", { ascending: false })
      .range(offset, offset + params.limit - 1);
    throwIfError(error);

    return {
      rows: (data ?? []) as (Respondent & { current_rank?: Rank | null })[],
      total,
      offset
    };
  },

  async listByProject(projectId: string): Promise<(Respondent & { current_rank?: Rank | null })[]> {
    const { data, error } = await supabase
      .from("respondents")
      .select("*, current_rank:ranks(*)")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as (Respondent & { current_rank?: Rank | null })[];
  },

  async getById(id: string): Promise<Respondent & { current_rank?: Rank | null }> {
    const { data, error } = await supabase
      .from("respondents")
      .select("*, current_rank:ranks(*)")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return requireData(
      data as (Respondent & { current_rank?: Rank | null }) | null,
      "Respondent not found"
    );
  },

  async listByLineUserId(lineUserId: string): Promise<(Respondent & { current_rank?: Rank | null })[]> {
    const { data, error } = await supabase
      .from("respondents")
      .select("*, current_rank:ranks(*)")
      .eq("line_user_id", lineUserId)
      .order("updated_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as (Respondent & { current_rank?: Rank | null })[];
  },

  async countCompletedByLineUser(lineUserId: string): Promise<number> {
    const { count, error } = await supabase
      .from("respondents")
      .select("*", { count: "exact", head: true })
      .eq("line_user_id", lineUserId)
      .eq("status", "completed");
    throwIfError(error);
    return count ?? 0;
  },

  async countAll(): Promise<number> {
    const { count, error } = await supabase
      .from("respondents")
      .select("*", { count: "exact", head: true });
    throwIfError(error);
    return count ?? 0;
  },

  async countByProject(projectId: string): Promise<number> {
    const { count, error } = await supabase
      .from("respondents")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId);
    throwIfError(error);
    return count ?? 0;
  }
};
