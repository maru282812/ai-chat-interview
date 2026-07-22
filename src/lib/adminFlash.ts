/**
 * 管理画面の操作結果フィードバック。
 *
 * 従来は `res.redirect` 119箇所のうち成功を伝えていたのが `?saved=1` の6箇所だけで、
 * ポイント調整・ランク閾値変更・NGワード追加などは成功も失敗も無反応だった。
 *
 * Vercel のサーバーレス前提（memory: feedback_vercel_serverless）なのでセッション
 * ストアを持たず、クエリ文字列に載せるステートレス方式にする。メッセージは EJS の
 * `<%= %>` で必ずエスケープして描画する。
 */

import type { Response } from "express";

export type AdminFlashType = "success" | "error" | "info";

export interface AdminFlash {
  type: AdminFlashType;
  message: string;
}

const FLASH_TYPE_PARAM = "flash_type";
const FLASH_MESSAGE_PARAM = "flash";
/** URL が肥大化しないよう上限を設ける（超過分は切り詰めて表示する） */
const MAX_MESSAGE_LENGTH = 200;

function normalizeType(value: unknown): AdminFlashType {
  return value === "success" || value === "error" || value === "info" ? value : "info";
}

/**
 * リダイレクト先にフラッシュメッセージを添える。
 * `path` は自アプリ内の相対パス前提（外部URLは渡さない）。
 */
export function redirectWithFlash(
  res: Response,
  path: string,
  message: string,
  type: AdminFlashType = "success"
): void {
  const separatorIndex = path.indexOf("?");
  const base = separatorIndex >= 0 ? path.slice(0, separatorIndex) : path;
  const params = new URLSearchParams(separatorIndex >= 0 ? path.slice(separatorIndex + 1) : "");
  params.set(FLASH_TYPE_PARAM, type);
  params.set(FLASH_MESSAGE_PARAM, message.slice(0, MAX_MESSAGE_LENGTH));
  const query = params.toString();
  res.redirect(query ? `${base}?${query}` : base);
}

/** 失敗時の短縮形 */
export function redirectWithError(res: Response, path: string, message: string): void {
  redirectWithFlash(res, path, message, "error");
}

/** クエリからフラッシュを取り出して `res.locals.flash` に載せる */
export function readFlashFromQuery(query: Record<string, unknown>): AdminFlash | null {
  const raw = query[FLASH_MESSAGE_PARAM];
  const message = typeof raw === "string" ? raw.trim() : "";
  if (!message) return null;
  return {
    type: normalizeType(query[FLASH_TYPE_PARAM]),
    message: message.slice(0, MAX_MESSAGE_LENGTH)
  };
}
