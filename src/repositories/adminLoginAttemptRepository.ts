import { createHash } from "node:crypto";
import type { Request } from "express";
import { supabase } from "../config/supabase";
import { logger } from "../lib/logger";

/**
 * 管理画面ログインの失敗回数カウンタ（migration 090）。
 *
 * 2要素認証を使わない運用なので、総当たりへの守りはこことパスワード強度だけになる。
 * Vercel はプロセスが毎回異なるためメモリに持てず、Supabase に置いている。
 */

/** この窓の中での失敗回数を数える。 */
export const LOCK_WINDOW_MS = 15 * 60 * 1000;

/** 窓内でこの回数失敗したらロックする。 */
export const MAX_FAILURES = 5;

/**
 * クライアント IP を取り出す。
 * Vercel の背後では req.ip がプロキシの IP になるため x-forwarded-for の先頭を優先する
 * （先頭が最も外側のクライアント。以降はプロキシ経路）。
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const first = raw?.split(",")[0]?.trim();
  return first || req.ip || "unknown";
}

/** 生 IP は保存しない（この表が漏れても訪問元一覧にはならないようにする）。 */
function hashIp(ip: string): string {
  return createHash("sha256").update(ip, "utf8").digest("hex");
}

export const adminLoginAttemptRepository = {
  /**
   * 窓内の失敗回数を返す。
   *
   * **DB エラー時は 0 を返す**（fail-open）。ここを fail-closed にすると
   * Supabase の一時障害でログインが完全に不能になり、正規の管理者が締め出される。
   * 認証そのものはパスワード検証で守られており、この関数は総当たりの速度を落とす層。
   */
  async recentFailureCount(ip: string, nowMs: number = Date.now()): Promise<number> {
    const since = new Date(nowMs - LOCK_WINDOW_MS).toISOString();
    const { count, error } = await supabase
      .from("admin_login_attempts")
      .select("id", { count: "exact", head: true })
      .eq("ip_hash", hashIp(ip))
      .gte("attempted_at", since);

    if (error) {
      logger.error("adminLoginAttempt.countFailed", { message: error.message });
      return 0;
    }
    return count ?? 0;
  },

  /** 失敗を1件記録する。記録に失敗してもログインの応答は変えない。 */
  async recordFailure(ip: string): Promise<void> {
    const { error } = await supabase
      .from("admin_login_attempts")
      .insert({ ip_hash: hashIp(ip) });
    if (error) {
      logger.error("adminLoginAttempt.insertFailed", { message: error.message });
    }
  },

  /** ログイン成功時にカウンタを戻す。 */
  async clearFailures(ip: string): Promise<void> {
    const { error } = await supabase
      .from("admin_login_attempts")
      .delete()
      .eq("ip_hash", hashIp(ip));
    if (error) {
      logger.error("adminLoginAttempt.clearFailed", { message: error.message });
    }
  },

  /**
   * 窓を過ぎた行を掃除する。判定には使われないので残っても害はないが、
   * 放置すると単調増加するためログイン成功のついでに落とす。
   */
  async purgeExpired(nowMs: number = Date.now()): Promise<void> {
    const cutoff = new Date(nowMs - LOCK_WINDOW_MS).toISOString();
    const { error } = await supabase
      .from("admin_login_attempts")
      .delete()
      .lt("attempted_at", cutoff);
    if (error) {
      logger.error("adminLoginAttempt.purgeFailed", { message: error.message });
    }
  }
};
