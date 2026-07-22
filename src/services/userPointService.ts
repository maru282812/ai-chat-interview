import { supabase } from "../config/supabase";
import { throwIfError } from "../repositories/baseRepository";
import type {
  UserPoints,
  PointHistory,
  UserPointSummary,
  UserPointTransactionType
} from "../types/domain";

export interface AwardPointsInput {
  lineUserId: string;
  transactionType: UserPointTransactionType;
  points: number;
  reason: string;
  referenceType?: "daily_survey_answer" | "project_assignment" | "campaign" | "session" | "manual" | "exchange_request" | "pool_question_answer";
  referenceId?: string;
  idempotencyKey?: string;
}

export interface AwardPointsResult {
  history: PointHistory;
  balance: UserPoints;
}

/**
 * point_histories.line_user_id は user_profiles(line_user_id) への FK なので、
 * user_profiles に行が無いユーザーへポイントを付与しようとすると 23503 で失敗する。
 *
 * user_profiles 行を作るのはマイページ保存（updateMypageData）だけなので、
 * 店舗専用アンケートをセルフ回答して同意だけで会員化した回答者（プロフィール未入力）は
 * 行を持たない。その状態だと正準台帳（user_points / point_histories）への書込みだけが落ち、
 * レガシー台帳（respondents.total_points）だけが増えて「マイページの残高が 0 のまま」になる。
 *
 * ポイントを受け取る時点でその LINE ユーザーは会員なので、空のプロフィール行を先に確保する。
 * 既存行があるときは何もしない（ignoreDuplicates）ため、入力済みプロフィールを壊さない。
 */
async function ensureUserProfileRow(lineUserId: string): Promise<void> {
  const { error } = await supabase
    .from("user_profiles")
    .upsert({ line_user_id: lineUserId }, { onConflict: "line_user_id", ignoreDuplicates: true });
  throwIfError(error);
}

export const userPointService = {
  async awardPoints(input: AwardPointsInput): Promise<AwardPointsResult> {
    await ensureUserProfileRow(input.lineUserId);

    const row: Record<string, unknown> = {
      line_user_id:     input.lineUserId,
      transaction_type: input.transactionType,
      points:           input.points,
      reason:           input.reason,
      reference_type:   input.referenceType ?? "manual",
      reference_id:     input.referenceId ?? null,
    };
    if (input.idempotencyKey) {
      row.idempotency_key = input.idempotencyKey;
    }

    const { data: historyData, error: histErr } = await supabase
      .from("point_histories")
      .insert(row)
      .select("*")
      .single();

    // 冪等性: 同一 idempotency_key で既に付与済みの場合はスキップ
    if (histErr?.code === "23505" && input.idempotencyKey) {
      const { data: existing } = await supabase
        .from("point_histories")
        .select("*")
        .eq("idempotency_key", input.idempotencyKey)
        .single();
      const balance = await this.getBalance(input.lineUserId);
      return { history: existing as PointHistory, balance };
    }
    throwIfError(histErr);

    // トリガーが user_points を自動更新するが最新値を取得する
    const balance = await this.getBalance(input.lineUserId);
    return { history: historyData as PointHistory, balance };
  },

  async getBalance(lineUserId: string): Promise<UserPoints> {
    const { data, error } = await supabase
      .from("user_points")
      .select("*")
      .eq("line_user_id", lineUserId)
      .single();
    if (error?.code === "PGRST116") {
      return {
        line_user_id:     lineUserId,
        total_points:     0,
        available_points: 0,
        pending_points:   0,
        lifetime_points:  0,
        updated_at:       new Date().toISOString()
      };
    }
    throwIfError(error);
    return data as UserPoints;
  },

  async getHistory(lineUserId: string, limit = 50): Promise<PointHistory[]> {
    const { data, error } = await supabase
      .from("point_histories")
      .select("*")
      .eq("line_user_id", lineUserId)
      .order("created_at", { ascending: false })
      .limit(limit);
    throwIfError(error);
    return (data ?? []) as PointHistory[];
  },

  async getSummary(lineUserId: string): Promise<UserPointSummary | null> {
    const { data, error } = await supabase
      .from("v_user_point_summary")
      .select("*")
      .eq("line_user_id", lineUserId)
      .single();
    if (error?.code === "PGRST116") return null;
    throwIfError(error);
    return data as UserPointSummary;
  },

  async listSummaries(limit = 100, offset = 0): Promise<UserPointSummary[]> {
    const { data, error } = await supabase
      .from("v_user_point_summary")
      .select("*")
      .order("lifetime_points", { ascending: false })
      .range(offset, offset + limit - 1);
    throwIfError(error);
    return (data ?? []) as UserPointSummary[];
  },

  /**
   * 管理画面のポイント一覧用。検索・並び替え・総件数をDB側で行う。
   * 従来は先頭500件だけ取ってクライアント側で display:none フィルタしていたため、
   * 501人目以降は検索対象にすら入っていなかった。
   */
  async searchSummaries(params: {
    q?: string;
    sort?: "lifetime_points" | "total_points" | "current_streak" | "last_answered_date";
    dir?: "asc" | "desc";
    limit: number;
    offset: number;
  }): Promise<{ rows: UserPointSummary[]; total: number; offset: number }> {
    const sort = params.sort ?? "lifetime_points";
    const ascending = params.dir === "asc";

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const applyFilters = (query: any) => {
      if (!params.q) return query;
      const needle = params.q.replace(/[,()*]/g, "").trim();
      if (!needle) return query;
      return query.or(`display_name.ilike.%${needle}%,line_user_id.ilike.%${needle}%`);
    };

    // 件数を先に確定させて offset を丸める。総件数を超える range は
    // PostgREST が「Requested range not satisfiable」で弾くため。
    const { error: countError, count } = await applyFilters(
      supabase.from("v_user_point_summary").select("line_user_id", { count: "exact", head: true })
    );
    throwIfError(countError);
    const total = count ?? 0;

    if (total === 0) {
      return { rows: [], total: 0, offset: 0 };
    }

    const maxOffset = Math.max(0, Math.floor((total - 1) / params.limit) * params.limit);
    const offset = Math.min(Math.max(0, params.offset), maxOffset);

    const { data, error } = await applyFilters(
      supabase.from("v_user_point_summary").select("*")
    )
      .order(sort, { ascending, nullsFirst: false })
      .range(offset, offset + params.limit - 1);
    throwIfError(error);

    return { rows: (data ?? []) as UserPointSummary[], total, offset };
  },

  /**
   * サマリーカード用の全体集計。
   * 従来はビューが返した先頭500件に対して `summaries.length` / `reduce` していたため、
   * 501人目以降が黙って無視され「ユーザー総数」「総発行ポイント」が誤った値になっていた。
   */
  async aggregateSummaries(): Promise<{
    userCount: number;
    lifetimePointsTotal: number;
    answeredUserCount: number;
    activeStreakUserCount: number;
    rankDistribution: { rank_name: string; rank_badge: string | null; count: number }[];
  }> {
    const countOf = async (apply?: (q: ReturnType<typeof buildCountQuery>) => unknown) => {
      let query = buildCountQuery();
      if (apply) query = apply(query) as ReturnType<typeof buildCountQuery>;
      const { error, count } = await query;
      throwIfError(error);
      return count ?? 0;
    };
    function buildCountQuery() {
      return supabase.from("v_user_point_summary").select("*", { count: "exact", head: true });
    }

    const [userCount, answeredUserCount, activeStreakUserCount] = await Promise.all([
      countOf(),
      countOf((q) => q.gt("total_answer_days", 0)),
      countOf((q) => q.gte("current_streak", 7))
    ]);

    // 合計とランク分布は集計用のビュー/RPCが無いため、必要な列だけを分割取得して積む。
    // 1ユーザーあたり数バイトなので全件取得しても軽い。
    const CHUNK = 1000;
    let lifetimePointsTotal = 0;
    const rankMap = new Map<string, { rank_name: string; rank_badge: string | null; count: number }>();
    for (let offset = 0; offset < userCount; offset += CHUNK) {
      const { data, error } = await supabase
        .from("v_user_point_summary")
        .select("lifetime_points, rank_name, rank_badge")
        .range(offset, offset + CHUNK - 1);
      throwIfError(error);
      for (const row of (data ?? []) as {
        lifetime_points: number | null;
        rank_name: string | null;
        rank_badge: string | null;
      }[]) {
        lifetimePointsTotal += row.lifetime_points ?? 0;
        const name = row.rank_name ?? "未設定";
        const entry = rankMap.get(name) ?? { rank_name: name, rank_badge: row.rank_badge, count: 0 };
        entry.count += 1;
        if (!entry.rank_badge) entry.rank_badge = row.rank_badge;
        rankMap.set(name, entry);
      }
    }

    return {
      userCount,
      lifetimePointsTotal,
      answeredUserCount,
      activeStreakUserCount,
      rankDistribution: [...rankMap.values()].sort((a, b) => b.count - a.count)
    };
  },

  async ensureRow(lineUserId: string): Promise<void> {
    const { error } = await supabase
      .from("user_points")
      .upsert(
        { line_user_id: lineUserId, total_points: 0, available_points: 0, lifetime_points: 0 },
        { onConflict: "line_user_id" }
      );
    throwIfError(error);
  }
};
