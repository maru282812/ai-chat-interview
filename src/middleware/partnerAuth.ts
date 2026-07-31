import { createHash, timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { logger } from "../lib/logger";

/**
 * パートナーAPI（/api/partner/*・docs/partner-api.md）の認証ミドルウェア。
 *
 * - `X-Partner-Key` ヘッダを環境変数 PARTNER_API_KEY と比較する。
 * - 比較は timingSafeEqual（タイミング攻撃で1文字ずつ当てられないようにする）。
 *   長さの違いが timingSafeEqual の例外になるのを避けるため、両者を SHA-256 の
 *   固定長ダイジェストにしてから比較する（長さそのものも漏らさない）。
 * - PARTNER_API_KEY 未設定なら 503（起動時 throw はしない。他機能を巻き添えにしない）。
 * - `X-Partner-Store-Id` は所有者スコープ。パートナー経由の案件は必ずこの店舗に紐づき、
 *   :id 系エンドポイントは projects.partner_store_id との一致を検証する（migration 089）。
 *
 * エラー形式は他の API 系ルート（mentalProxyRoutes / errorHandler）に合わせて
 * `{ error: string }` を返す。
 */

/** リクエストに載せる認証済みパートナー情報。 */
export interface PartnerContext {
  /** ポータル側 stores.id。所有者スコープのキー。 */
  storeId: string;
}

declare global {
  namespace Express {
    interface Request {
      partner?: PartnerContext;
    }
  }
}

/** ヘッダ値を1本の文字列に正規化する（Express は重複ヘッダを配列で渡すことがある）。 */
function headerValue(raw: string | string[] | undefined): string {
  if (Array.isArray(raw)) {
    return raw[0] ?? "";
  }
  return raw ?? "";
}

/** 長さを漏らさず定数時間で比較する。 */
function secureEquals(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left, "utf8").digest();
  const rightDigest = createHash("sha256").update(right, "utf8").digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function partnerAuthMiddleware(req: Request, res: Response, next: NextFunction): void {
  const configuredKey = env.PARTNER_API_KEY;
  if (!configuredKey) {
    res.status(503).json({ error: "partner API is not configured" });
    return;
  }

  const presentedKey = headerValue(req.headers["x-partner-key"]);
  if (!presentedKey || !secureEquals(presentedKey, configuredKey)) {
    logger.warn("partnerAuth.unauthorized", { path: req.path, method: req.method });
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const storeId = headerValue(req.headers["x-partner-store-id"]).trim();
  if (!storeId) {
    res.status(400).json({ error: "X-Partner-Store-Id header is required" });
    return;
  }
  // 所有者スコープのキーがそのままクエリ条件になるため、形式を制限する。
  // ポータル側 stores.id は UUID だが、将来の採番変更に耐えるよう文字種と長さで縛る。
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(storeId)) {
    res.status(400).json({ error: "X-Partner-Store-Id has an invalid format" });
    return;
  }

  req.partner = { storeId };
  next();
}

/**
 * ルートハンドラから認証済みコンテキストを取り出す。
 * partnerAuthMiddleware を通っていれば必ず存在するが、型上は optional なのでここで確定させる。
 */
export function requirePartner(req: Request): PartnerContext {
  const partner = req.partner;
  if (!partner) {
    // ミドルウェアの付け忘れ。設定ミスなので 500 相当だが、ここでは防御的に throw する。
    throw new Error("partnerAuthMiddleware is not applied to this route");
  }
  return partner;
}
