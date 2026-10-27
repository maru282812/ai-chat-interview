/** liff.state（LIFF SDK のエンコード済み path+query）からクエリ部分だけを取り出す */
export function parseLiffStateQuery(raw: unknown): URLSearchParams {
  if (typeof raw !== "string" || !raw) return new URLSearchParams();
  const q = raw.indexOf("?");
  const query = q >= 0 ? raw.slice(q + 1) : raw.startsWith("/") ? "" : raw;
  try {
    return new URLSearchParams(query);
  } catch {
    return new URLSearchParams();
  }
}

/**
 * liff.state がパス付き（"/projects/xxx?a=b"）なら、/liff 配下へ送る相対パス＋クエリを返す。
 * パスが無い・"/" のみ・不正な形（"//"、"\"、".." を含む）なら null。
 */
export function liffStatePath(raw: unknown): string | null {
  if (typeof raw !== "string" || !raw.startsWith("/")) return null;
  const q = raw.indexOf("?");
  const path = q >= 0 ? raw.slice(0, q) : raw;
  if (path === "/" || path.startsWith("//") || path.includes("\\") || path.split("/").includes("..")) return null;
  if (!/^\/[A-Za-z0-9/_-]+$/.test(path)) return null;
  const query = q >= 0 ? parseLiffStateQuery(raw).toString() : "";
  return query ? `${path}?${query}` : path;
}
