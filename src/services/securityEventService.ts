import type { Request } from "express";
import { Resend } from "resend";
import { env } from "../config/env";
import { supabase } from "../config/supabase";
import { logger } from "../lib/logger";
import {
  ALERT_COOLDOWN_MS,
  type AlertRule,
  buildAlertMessage,
  decideAlert,
  ERROR_WINDOW_MS,
  FAILURE_WINDOW_MS,
  RETENTION_DAYS,
  type SecurityEventKind,
  shouldSuppress
} from "../lib/securityAlertRules";
import { clientIp } from "../repositories/adminLoginAttemptRepository";

/**
 * セキュリティイベントの記録と通知（migration 122）。
 *
 * - 記録の失敗で本来の処理を止めない（fail-open。エラーはログにだけ出す）
 * - Workers では応答を返した後の処理が打ち切られうるため、呼び出し側は await する
 *   （全体を RECORD_TIMEOUT_MS で打ち切るので、遅くても応答は返る）
 * - 通知先は SECURITY_ALERT_EMAIL、無ければ ADMIN_NOTIFICATION_EMAIL。どちらも無ければ記録だけ
 */

const RECORD_TIMEOUT_MS = 2500;
const SERVICE_NAME = "ACI";
const DEFAULT_FROM = "YOTTO 見張り <alert@mail.yottollc.com>";

export interface SecurityEventInput {
  kind: SecurityEventKind;
  actor?: string | null;
  /** false なら IP を残さない（回答者が通る経路のエラーなど）。 */
  keepIp?: boolean;
  detail?: Record<string, unknown>;
}

function header(req: Request, name: string): string | null {
  const value = req.headers[name];
  const raw = Array.isArray(value) ? value[0] : value;
  return raw ? String(raw).slice(0, 300) : null;
}

async function countSince(kinds: SecurityEventKind[], sinceMs: number): Promise<number> {
  const { count, error } = await supabase
    .from("security_events")
    .select("id", { count: "exact", head: true })
    .in("kind", kinds)
    .gte("occurred_at", new Date(sinceMs).toISOString());
  if (error) {
    logger.error("securityEvent.countFailed", { message: error.message });
    return 0;
  }
  return count ?? 0;
}

async function lastAlertAt(rule: AlertRule, nowMs: number): Promise<Date | null> {
  const { data, error } = await supabase
    .from("security_events")
    .select("occurred_at")
    .eq("kind", "alert_sent")
    .eq("detail->>rule", rule)
    .gte("occurred_at", new Date(nowMs - ALERT_COOLDOWN_MS).toISOString())
    .order("occurred_at", { ascending: false })
    .limit(1);
  if (error) {
    logger.error("securityEvent.lastAlertFailed", { message: error.message });
    return null;
  }
  const row = data?.[0] as { occurred_at?: string } | undefined;
  return row?.occurred_at ? new Date(row.occurred_at) : null;
}

async function sendAlert(subject: string, text: string): Promise<boolean> {
  const to = env.SECURITY_ALERT_EMAIL ?? env.ADMIN_NOTIFICATION_EMAIL;
  if (!env.RESEND_API_KEY || !to) {
    logger.warn("securityEvent.alertNotConfigured", { subject });
    return false;
  }
  try {
    const resend = new Resend(env.RESEND_API_KEY);
    const { error } = await resend.emails.send({
      from: env.SECURITY_ALERT_FROM ?? DEFAULT_FROM,
      to,
      subject,
      text
    });
    if (error) {
      logger.error("securityEvent.alertSendFailed", { message: error.message });
      return false;
    }
    return true;
  } catch (error) {
    logger.error("securityEvent.alertSendFailed", {
      message: error instanceof Error ? error.message : String(error)
    });
    return false;
  }
}

async function purgeOld(nowMs: number): Promise<void> {
  const cutoff = new Date(nowMs - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from("security_events").delete().lt("occurred_at", cutoff);
  if (error) {
    logger.error("securityEvent.purgeFailed", { message: error.message });
  }
}

async function recordInner(req: Request, input: SecurityEventInput): Promise<void> {
  const now = new Date();
  const nowMs = now.getTime();
  const ip = input.keepIp === false ? null : clientIp(req);
  const country = header(req, "cf-ipcountry");

  const { error } = await supabase.from("security_events").insert({
    kind: input.kind,
    actor: input.actor ?? null,
    ip,
    country,
    method: req.method,
    path: req.originalUrl.split("?")[0]?.slice(0, 300) ?? null,
    user_agent: header(req, "user-agent"),
    detail: input.detail ?? {}
  });
  if (error) {
    logger.error("securityEvent.insertFailed", { kind: input.kind, message: error.message });
    return;
  }

  const needsFailures = input.kind === "login_failed" || input.kind === "api_key_rejected";
  const recentFailures = needsFailures
    ? await countSince(["login_failed", "api_key_rejected"], nowMs - FAILURE_WINDOW_MS)
    : 0;
  const recentErrors =
    input.kind === "server_error" ? await countSince(["server_error"], nowMs - ERROR_WINDOW_MS) : 0;

  const rule = decideAlert({ kind: input.kind, occurredAt: now, country, recentFailures, recentErrors });
  if (rule && !shouldSuppress(rule, await lastAlertAt(rule, nowMs), now)) {
    const message = buildAlertMessage({
      rule,
      service: SERVICE_NAME,
      occurredAt: now,
      ip,
      country,
      recentFailures,
      recentErrors
    });
    const sent = await sendAlert(message.subject, message.text);
    await supabase.from("security_events").insert({
      kind: "alert_sent",
      actor: null,
      ip: null,
      country: null,
      method: null,
      path: null,
      user_agent: null,
      detail: { rule, sent }
    });
  }

  // 90 日より古い行の掃除。毎回は重いので 1/50 の確率で。
  if (Math.random() < 0.02) {
    await purgeOld(nowMs);
  }
}

export const securityEventService = {
  /** 1 件記録し、必要なら通知する。失敗しても例外を投げない。 */
  async record(req: Request, input: SecurityEventInput): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        recordInner(req, input),
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, RECORD_TIMEOUT_MS);
        })
      ]);
    } catch (error) {
      logger.error("securityEvent.recordFailed", {
        kind: input.kind,
        message: error instanceof Error ? error.message : String(error)
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
};
