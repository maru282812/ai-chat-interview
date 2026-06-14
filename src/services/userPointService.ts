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
  referenceType?: "daily_survey_answer" | "project_assignment" | "campaign" | "session" | "manual" | "exchange_request";
  referenceId?: string;
  idempotencyKey?: string;
}

export interface AwardPointsResult {
  history: PointHistory;
  balance: UserPoints;
}

export const userPointService = {
  async awardPoints(input: AwardPointsInput): Promise<AwardPointsResult> {
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
