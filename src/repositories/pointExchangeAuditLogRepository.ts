import { supabase } from "../config/supabase";
import { throwIfError } from "./baseRepository";

const TABLE = "point_exchange_audit_logs";

export type ExchangeAuditAction =
  | "approved"
  | "rejected"
  | "fulfilled"
  | "canceled_by_user"
  | "notify_sent"
  | "notify_failed";

export interface PointExchangeAuditLog {
  id: string;
  request_id: string;
  action: ExchangeAuditAction;
  admin_id: string | null;
  detail: Record<string, unknown>;
  created_at: string;
}

export const pointExchangeAuditLogRepository = {
  async create(input: {
    requestId: string;
    action: ExchangeAuditAction;
    adminId?: string;
    detail?: Record<string, unknown>;
  }): Promise<PointExchangeAuditLog> {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({
        request_id: input.requestId,
        action:     input.action,
        admin_id:   input.adminId ?? null,
        detail:     input.detail ?? {},
      })
      .select("*")
      .single();
    throwIfError(error);
    return data as PointExchangeAuditLog;
  },

  async listByRequest(requestId: string): Promise<PointExchangeAuditLog[]> {
    const { data, error } = await supabase
      .from(TABLE)
      .select("*")
      .eq("request_id", requestId)
      .order("created_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as PointExchangeAuditLog[];
  },
};
