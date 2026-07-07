import { supabase } from "../config/supabase";
import type { PointExchangeRequest, PointExchangeStatus } from "../types/domain";
import { throwIfError } from "./baseRepository";

const TABLE = "point_exchange_requests";

export const pointExchangeRepository = {
  async create(input: {
    lineUserId: string;
    requestedPoints: number;
    giftAmountJpy: number;
  }): Promise<PointExchangeRequest> {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        line_user_id:     input.lineUserId,
        requested_points: input.requestedPoints,
        gift_amount_jpy:  input.giftAmountJpy,
        status:           "pending",
      })
      .select("*")
      .single();
    throwIfError(error);
    return data as PointExchangeRequest;
  },

  async getById(id: string): Promise<PointExchangeRequest | null> {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .single();
    if (error?.code === "PGRST116") return null;
    throwIfError(error);
    return data as PointExchangeRequest;
  },

  async listByUser(lineUserId: string, limit = 20): Promise<PointExchangeRequest[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("line_user_id", lineUserId)
      .order("requested_at", { ascending: false })
      .limit(limit);
    throwIfError(error);
    return (data ?? []) as PointExchangeRequest[];
  },

  async listByStatus(status: PointExchangeStatus, limit = 100): Promise<PointExchangeRequest[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("status", status)
      .order("requested_at", { ascending: false })
      .limit(limit);
    throwIfError(error);
    return (data ?? []) as PointExchangeRequest[];
  },

  async listAll(limit = 200, offset = 0): Promise<PointExchangeRequest[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .order("requested_at", { ascending: false })
      .range(offset, offset + limit - 1);
    throwIfError(error);
    return (data ?? []) as PointExchangeRequest[];
  },

  async countPending(): Promise<number> {
    const { count, error } = await supabase
      .from(TABLE)
      .select("id", { count: "exact", head: true })
      .eq("status", "pending");
    throwIfError(error);
    return count ?? 0;
  },

  async getPendingByUser(lineUserId: string): Promise<PointExchangeRequest | null> {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("line_user_id", lineUserId)
      .eq("status", "pending")
      .single();
    if (error?.code === "PGRST116") return null;
    throwIfError(error);
    return data as PointExchangeRequest;
  },

  async approve(id: string, adminId: string): Promise<PointExchangeRequest> {
    const { data, error } = await supabase
      .from(TABLE)
      .update({
        status:      "approved",
        handled_by:  adminId,
        approved_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "pending")
      .select("*")
      .single();
    throwIfError(error);
    return data as PointExchangeRequest;
  },

  async reject(id: string, adminId: string, reason: string): Promise<PointExchangeRequest> {
    const { data, error } = await supabase
      .from(TABLE)
      .update({
        status:       "rejected",
        handled_by:   adminId,
        failed_reason: reason,
        rejected_at:  new Date().toISOString(),
      })
      .eq("id", id)
      .in("status", ["pending", "approved"])
      .select("*")
      .single();
    throwIfError(error);
    return data as PointExchangeRequest;
  },

  async fulfill(id: string, adminId: string, input: {
    giftProvider: string;
    giftCode?: string;
    giftUrl: string;
    expiresAt?: string;
    adminMemo?: string;
  }): Promise<PointExchangeRequest> {
    const { data, error } = await supabase
      .from(TABLE)
      .update({
        status:          "fulfilled",
        handled_by:      adminId,
        gift_provider:   input.giftProvider,
        gift_code:       input.giftCode ?? null,
        gift_url:        input.giftUrl,
        expires_at:      input.expiresAt ?? null,
        admin_memo:      input.adminMemo ?? null,
        fulfilled_at:    new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "approved")
      .select("*")
      .single();
    throwIfError(error);
    return data as PointExchangeRequest;
  },

  async cancel(id: string, lineUserId: string): Promise<PointExchangeRequest> {
    const { data, error } = await supabase
      .from(TABLE)
      .update({
        status:      "canceled",
        canceled_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("line_user_id", lineUserId)
      .eq("status", "pending")
      .select("*")
      .single();
    throwIfError(error);
    return data as PointExchangeRequest;
  },

  async markNotificationSent(id: string): Promise<void> {
    const { error } = await supabase
      .from(TABLE)
      .update({
        notification_sent:    true,
        notification_sent_at: new Date().toISOString(),
        notification_error:   null,
        sent_at:              new Date().toISOString(),
      })
      .eq("id", id);
    throwIfError(error);
  },

  async markNotificationFailed(id: string, reason: string): Promise<void> {
    const { error } = await supabase
      .from(TABLE)
      .update({ notification_error: reason })
      .eq("id", id);
    throwIfError(error);
  },

  async updateAdminMemo(id: string, memo: string): Promise<void> {
    const { error } = await supabase
      .from(TABLE)
      .update({ admin_memo: memo })
      .eq("id", id);
    throwIfError(error);
  },

  /** 月次集計（fulfilled のみ / 直近12か月） */
  async getMonthlyStats(): Promise<Array<{
    month: string;          // "YYYY-MM"
    count: number;
    total_points: number;
    total_jpy: number;
  }>> {
    const since = new Date();
    since.setMonth(since.getMonth() - 11);
    since.setDate(1);
    since.setHours(0, 0, 0, 0);

    const { data, error } = await supabase
      .from(TABLE)
      .select("fulfilled_at, requested_points, gift_amount_jpy")
      .eq("status", "fulfilled")
      .gte("fulfilled_at", since.toISOString())
      .order("fulfilled_at", { ascending: true });
    throwIfError(error);

    const map = new Map<string, { count: number; total_points: number; total_jpy: number }>();
    for (const row of (data ?? []) as Array<{ fulfilled_at: string | null; requested_points: number; gift_amount_jpy: number }>) {
      if (!row.fulfilled_at) continue;
      const month = row.fulfilled_at.slice(0, 7);
      const cur = map.get(month) ?? { count: 0, total_points: 0, total_jpy: 0 };
      cur.count        += 1;
      cur.total_points += row.requested_points;
      cur.total_jpy    += row.gift_amount_jpy;
      map.set(month, cur);
    }

    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v }));
  },

  /** 短期間の大量申請フラグ: 過去 days 日以内に threshold 件以上申請したユーザー */
  async getFlaggedUsers(days = 30, threshold = 3): Promise<Array<{
    line_user_id: string;
    request_count: number;
  }>> {
    const since = new Date();
    since.setDate(since.getDate() - days);

    const { data, error } = await supabase
      .from(TABLE)
      .select("line_user_id")
      .gte("requested_at", since.toISOString())
      .neq("status", "canceled");
    throwIfError(error);

    const counts = new Map<string, number>();
    for (const row of (data ?? []) as Array<{ line_user_id: string }>) {
      counts.set(row.line_user_id, (counts.get(row.line_user_id) ?? 0) + 1);
    }

    return Array.from(counts.entries())
      .filter(([, n]) => n >= threshold)
      .map(([line_user_id, request_count]) => ({ line_user_id, request_count }))
      .sort((a, b) => b.request_count - a.request_count);
  },
};
