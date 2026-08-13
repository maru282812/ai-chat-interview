import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

/**
 * 管理画面のログインセッション（署名付き Cookie・ステートレス）。
 *
 * Vercel サーバーレスではプロセスが毎回異なるため、セッションをメモリに持てない。
 * DB に持たせることもできるが、管理者が共有アカウント1つという運用なので
 * **HMAC 署名した Cookie に有効期限を埋め込む**方式で足りる（表も GC も要らない）。
 *
 * Cookie の中身: `<issuedAtMs>.<expiresAtMs>.<nonce>.<hmacHex>`
 * 署名対象は `<issuedAtMs>.<expiresAtMs>.<nonce>` の3つ。
 *
 * 有効期限を**署名の内側**に入れるのが要点。Cookie の Max-Age はブラウザ側の都合でしかなく、
 * 攻撃者は期限切れの Cookie をいくらでも送り返せる。サーバーは必ず署名済みの
 * expiresAt を見て判断する。
 *
 * nonce は同じ秒に発行しても値が衝突しないようにするためと、
 * ADMIN_SESSION_SECRET を差し替えれば全セッションが即座に無効になる性質を明確にするため。
 */

export const ADMIN_SESSION_COOKIE = "admin_session";

/** 7日。管理画面は LINE 実配信や個人情報 CSV に触れるが、毎日使うので短すぎても運用が壊れる。 */
export const ADMIN_SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/** 署名付きセッション値を新規発行する。 */
export function issueAdminSession(secret: string, nowMs: number = Date.now()): string {
  const expiresAt = nowMs + ADMIN_SESSION_MAX_AGE_MS;
  const nonce = randomBytes(12).toString("hex");
  const payload = `${nowMs}.${expiresAt}.${nonce}`;
  return `${payload}.${sign(payload, secret)}`;
}

/**
 * セッション値を検証する。署名不一致・形式不正・期限切れは全て false。
 * 「なぜ落ちたか」を呼び出し側へ返さないのは、応答から判別材料を与えないため。
 */
export function verifyAdminSession(
  value: string,
  secret: string,
  nowMs: number = Date.now()
): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) {
    return false;
  }
  const [issuedAtRaw, expiresAtRaw, nonce, providedSignature] = parts as [
    string,
    string,
    string,
    string
  ];

  const payload = `${issuedAtRaw}.${expiresAtRaw}.${nonce}`;
  const expectedSignature = sign(payload, secret);

  // 先に署名を見る。ここを通らない値の中身は一切信用しない。
  const provided = Buffer.from(providedSignature, "hex");
  const expected = Buffer.from(expectedSignature, "hex");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return false;
  }

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isSafeInteger(expiresAt) || nowMs >= expiresAt) {
    return false;
  }

  // 発行時刻が未来の値は時計のずれか細工。念のため弾く。
  const issuedAt = Number(issuedAtRaw);
  if (!Number.isSafeInteger(issuedAt) || issuedAt > nowMs + 60_000) {
    return false;
  }

  return true;
}

/** リクエストの Cookie ヘッダから任意のキーを取り出す（cookie-parser を足さずに済ませる）。 */
export function readCookie(req: Request, name: string): string | null {
  const header = req.headers.cookie;
  if (!header) {
    return null;
  }
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

/**
 * Set-Cookie 値を組み立てる。
 * - HttpOnly: JS から読めない（XSS でセッションを盗まれない）
 * - SameSite=Strict: クロスサイトからの遷移では送られない。Basic 認証から Cookie へ移ると
 *   ブラウザの自動付与が CSRF 経路になるため、adminCsrf.ts と二重で塞ぐ
 * - Secure: 本番のみ。localhost は http なので付けると開発でログインできなくなる
 * - Path=/: /admin だけでなくログアウト等も同じ Cookie を扱えるようにする
 */
export function buildSessionCookie(value: string, secure: boolean): string {
  const maxAgeSec = Math.floor(ADMIN_SESSION_MAX_AGE_MS / 1000);
  const attrs = [
    `${ADMIN_SESSION_COOKIE}=${value}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${maxAgeSec}`
  ];
  if (secure) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}

/** ログアウト用（値を空にして即時失効させる）。 */
export function buildClearedSessionCookie(secure: boolean): string {
  const attrs = [`${ADMIN_SESSION_COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Strict", "Max-Age=0"];
  if (secure) {
    attrs.push("Secure");
  }
  return attrs.join("; ");
}
