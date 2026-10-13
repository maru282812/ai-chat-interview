/**
 * adminMemo.ts
 *
 * 案件の運営者メモ（Migration 117）の正規化。
 * 運営だけが見る自由テキスト。回答者・店舗には出さない。
 */

export const ADMIN_MEMO_MAX_LENGTH = 2000;

/** 空白だけなら「メモなし」(null) に倒す。改行は CRLF / CR を LF に揃える。 */
export function normalizeAdminMemo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/\r\n?/g, "\n").trim();
  return value.length > 0 ? value : null;
}
