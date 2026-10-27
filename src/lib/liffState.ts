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
