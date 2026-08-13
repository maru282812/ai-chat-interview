import type { Request, Response } from "express";
import { env } from "../config/env";
import { verifyAdminPassword } from "../lib/adminPassword";
import {
  ADMIN_SESSION_COOKIE,
  buildClearedSessionCookie,
  buildSessionCookie,
  issueAdminSession,
  readCookie,
  verifyAdminSession
} from "../lib/adminSession";
import { logger } from "../lib/logger";
import {
  adminLoginAttemptRepository,
  clientIp,
  LOCK_WINDOW_MS,
  MAX_FAILURES
} from "../repositories/adminLoginAttemptRepository";

/**
 * 管理画面のログイン／ログアウト（middleware/adminAuth.ts と対になる）。
 *
 * 2要素認証を使わない運用なので、総当たり対策のレート制限がここでの主な守り。
 */

/**
 * Secure 属性を付けるか。localhost は http なので、付けるとブラウザが Cookie を捨てて
 * 開発中ログインできなくなる。逆に本番で付け忘れると平文で送られうる。
 *
 * 判定に NODE_ENV を使わないのは、**本番でも NODE_ENV が "development" のままだから**
 * （env.ts の VERCEL_ENV のコメント参照。testmaster の検証シームを殺さないための措置）。
 * VERCEL_ENV は Vercel が自動で入れ、本番デプロイでは必ず "production" になる。
 *
 * preview も HTTPS で配信されるため Secure を付ける。ローカル（VERCEL_ENV 無し）だけ外す。
 * 将来 NODE_ENV=production へ切り替えても正しく動くよう、そちらも見る。
 */
function useSecureCookie(): boolean {
  return env.VERCEL_ENV === "production" || env.VERCEL_ENV === "preview" || env.NODE_ENV === "production";
}

/**
 * ログイン後の戻り先を検証する。
 * `//evil.example` や `https://...` を弾き、**このサイト内の /admin 配下**のみ許す
 * （オープンリダイレクト対策）。
 */
function safeNextPath(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  if (!value.startsWith("/admin")) {
    return "/admin";
  }
  // "//host" と "/\host" はブラウザに外部URLとして解釈される。
  if (value.startsWith("//") || value.startsWith("/\\")) {
    return "/admin";
  }
  return value;
}

export const adminAuthController = {
  async loginPage(req: Request, res: Response): Promise<void> {
    const nextPath = safeNextPath(req.query.next);

    // ログイン済みなら素通しする（Cookie を持ったままログイン画面を開いた場合）。
    const existing = readCookie(req, ADMIN_SESSION_COOKIE);
    if (existing && verifyAdminSession(existing, env.ADMIN_SESSION_SECRET)) {
      res.redirect(nextPath);
      return;
    }

    const error = req.query.error;
    let errorMessage: string | null = null;
    if (error === "invalid") {
      errorMessage = "パスワードが違います";
    } else if (error === "locked") {
      const minutes = Math.round(LOCK_WINDOW_MS / 60000);
      errorMessage = `試行回数の上限に達しました。約${minutes}分後にもう一度お試しください。`;
    }

    res.status(errorMessage ? 401 : 200).render("admin/login", {
      title: "管理画面ログイン",
      errorMessage,
      nextPath
    });
  },

  async login(req: Request, res: Response): Promise<void> {
    const nextPath = safeNextPath(req.body?.next);
    const ip = clientIp(req);

    // 1. まずロック判定。パスワード検証（scrypt）に入る前に落とすことで、
    //    総当たりで CPU を消費させられるのも同時に防ぐ。
    const failures = await adminLoginAttemptRepository.recentFailureCount(ip);
    if (failures >= MAX_FAILURES) {
      logger.warn("adminAuth.loginLocked", { failures });
      res.redirect(`/admin/login?error=locked&next=${encodeURIComponent(nextPath)}`);
      return;
    }

    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const ok = password.length > 0 && (await verifyAdminPassword(password, env.ADMIN_PASSWORD_HASH));

    if (!ok) {
      await adminLoginAttemptRepository.recordFailure(ip);
      logger.warn("adminAuth.loginFailed", { failures: failures + 1 });
      res.redirect(`/admin/login?error=invalid&next=${encodeURIComponent(nextPath)}`);
      return;
    }

    // 2. 成功。カウンタを戻し、ついでに窓を過ぎた行を掃除する。
    await adminLoginAttemptRepository.clearFailures(ip);
    await adminLoginAttemptRepository.purgeExpired();

    const sessionValue = issueAdminSession(env.ADMIN_SESSION_SECRET);
    res.setHeader("Set-Cookie", buildSessionCookie(sessionValue, useSecureCookie()));
    logger.info("adminAuth.loginSucceeded", {});
    res.redirect(nextPath);
  },

  async logout(_req: Request, res: Response): Promise<void> {
    res.setHeader("Set-Cookie", buildClearedSessionCookie(useSecureCookie()));
    res.redirect("/admin/login");
  }
};
