import type { RequestHandler } from "express";
import { env } from "../config/env";
import { ADMIN_SESSION_COOKIE, readCookie, verifyAdminSession } from "../lib/adminSession";
import { secureEquals } from "../lib/secureCompare";

/**
 * 管理画面（/admin/*）の認証。
 *
 * 経路は2つ。
 * 1. **人間**: /admin/login でパスワードを入れて得た署名付きセッション Cookie。
 * 2. **非対話クライアント**: X-Admin-Api-Key ヘッダ（scripts/adminChatSmoke.mjs 等）。
 *    スクリプトはログイン画面を通れないため。ADMIN_API_KEY 未設定ならこの経路は塞がる。
 *
 * 旧実装は Basic 認証で、環境変数の平文と `!==` で比較していた。
 * ハッシュ化・定数時間比較・レート制限（migration 090）のために
 * ログインという明確な瞬間が必要になり、セッション方式へ移行した。
 *
 * 未認証はログイン画面へ**リダイレクト**する（401 ではない）。ブラウザの Basic 認証
 * ダイアログはもう出ないので、401 を返すと利用者は何もできない画面を見ることになる。
 */

/** 認証不要なパス（ログイン画面自身。ここを通さないと無限リダイレクトになる）。 */
const PUBLIC_ADMIN_PATHS = new Set(["/login"]);

export const adminAuthMiddleware: RequestHandler = (req, res, next) => {
  if (PUBLIC_ADMIN_PATHS.has(req.path)) {
    next();
    return;
  }

  // 経路2: 非対話クライアント。
  const apiKeyHeader = req.headers["x-admin-api-key"];
  const presentedKey = Array.isArray(apiKeyHeader) ? apiKeyHeader[0] : apiKeyHeader;
  if (presentedKey) {
    // 未設定なら通さない（fail-closed）。空文字どうしが一致して素通りするのを避ける。
    if (env.ADMIN_API_KEY && secureEquals(presentedKey, env.ADMIN_API_KEY)) {
      res.locals.adminUser = "api-key";
      next();
      return;
    }
    // 鍵を提示して外したクライアントはブラウザではない。リダイレクトせず 401 を返す。
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  // 経路1: ブラウザセッション。
  const sessionValue = readCookie(req, ADMIN_SESSION_COOKIE);
  if (sessionValue && verifyAdminSession(sessionValue, env.ADMIN_SESSION_SECRET)) {
    // 監査ログ（export_jobs 等）の実施者記録用。
    // 共有アカウント1つの運用なので、ここは常に同じ値になる（誰がやったかは残らない）。
    res.locals.adminUser = "admin";
    next();
    return;
  }

  // ログイン後に元の画面へ戻すため、行き先を next に載せる。
  // オープンリダイレクトを防ぐため、値はこのサイト内のパスに限る（controller 側で再検証）。
  const target = req.originalUrl.startsWith("/admin") ? req.originalUrl : "/admin";
  res.redirect(`/admin/login?next=${encodeURIComponent(target)}`);
};
