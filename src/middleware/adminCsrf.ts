import type { RequestHandler } from "express";
import { logger } from "../lib/logger";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function firstHeaderValue(value: string | string[] | undefined): string | null {
  if (!value) return null;
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  // プロキシ多段で "a, b" になることがあるため先頭のみ採用
  return raw.split(",")[0]?.trim() || null;
}

/**
 * 管理画面の状態変更リクエストに対する CSRF ガード。
 *
 * 管理画面は Basic 認証＋素のフォーム POST で、ブラウザは Basic 資格情報を
 * クロスサイトのフォーム送信にも自動付与する。全フォームへのトークン埋め込みは
 * 改修範囲が広すぎるため、ブラウザが付与するフェッチメタデータで遮断する:
 *
 * 1. Sec-Fetch-Site があれば same-origin / none（アドレスバー直叩き等）のみ許可。
 * 2. 無ければ Origin（無ければ Referer）のホストが自ホストと一致することを要求。
 * 3. どちらも無いリクエスト（curl 等の非ブラウザクライアント）は許可する。
 *    非ブラウザは資格情報を自分で付けており CSRF の脅威モデル外。
 */
export const adminCsrfMiddleware: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const secFetchSite = firstHeaderValue(req.headers["sec-fetch-site"]);
  if (secFetchSite) {
    if (secFetchSite === "same-origin" || secFetchSite === "none") {
      next();
      return;
    }
    logger.warn("adminCsrf: blocked cross-site request (Sec-Fetch-Site)", {
      method: req.method,
      path: req.originalUrl,
      secFetchSite,
    });
    res.status(403).send("Cross-site request blocked");
    return;
  }

  const originLike = firstHeaderValue(req.headers.origin) ?? firstHeaderValue(req.headers.referer);
  if (!originLike) {
    next();
    return;
  }

  // Vercel 等のプロキシ背後では公開ホストは x-forwarded-host に入る
  const selfHost =
    firstHeaderValue(req.headers["x-forwarded-host"]) ?? firstHeaderValue(req.headers.host);
  try {
    const originHost = new URL(originLike).host;
    if (selfHost && originHost === selfHost) {
      next();
      return;
    }
  } catch {
    // Origin がパースできない場合は遮断側に倒す
  }

  logger.warn("adminCsrf: blocked cross-site request (Origin mismatch)", {
    method: req.method,
    path: req.originalUrl,
    origin: originLike,
    host: selfHost,
  });
  res.status(403).send("Cross-site request blocked");
};
