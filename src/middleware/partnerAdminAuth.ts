import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { secureEquals } from "../lib/secureCompare";

/**
 * 運営専用API（/api/partner-admin/*・docs/partner-api.md §8）の認証ミドルウェア。
 *
 * partnerAuth.ts（店舗向け）とは**完全に別の鍵**で守る。
 * - `X-Partner-Admin-Key` ヘッダを環境変数 PARTNER_ADMIN_API_KEY と比較する。
 * - 比較は partnerAuth と同じ SHA-256 ダイジェスト ＋ timingSafeEqual
 *   （長さの違いを例外にせず、長さそのものも漏らさない）。
 * - **PARTNER_ADMIN_API_KEY 未設定なら 503。PARTNER_API_KEY へのフォールバックは絶対にしない**
 *   （fail-closed）。店舗スコープの鍵で全社の案件が引ける穴を作らないため。
 * - このルータは店舗スコープを持たない（未割り当て案件を扱うのが目的）ので
 *   `X-Partner-Store-Id` は要求しない。割り当て先の店舗はボディで受け取る。
 *
 * エラー形式は既存の API 系ルートに合わせて `{ error: string }`。
 */

/** ヘッダ値を1本の文字列に正規化する（Express は重複ヘッダを配列で渡すことがある）。 */
function headerValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) {
    return raw[0] ?? "";
  }
  return raw ?? "";
}

export function partnerAdminAuthMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const configuredKey = env.PARTNER_ADMIN_API_KEY;
  if (!configuredKey) {
    // ここで PARTNER_API_KEY を見にいってはいけない（fail-closed）。
    res.status(503).json({ error: "partner admin API is not configured" });
    return;
  }

  const presentedKey = headerValue(req.headers["x-partner-admin-key"]);
  if (!presentedKey || !secureEquals(presentedKey, configuredKey)) {
    logger.warn("partnerAdminAuth.unauthorized", { path: req.path, method: req.method });
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  next();
}
