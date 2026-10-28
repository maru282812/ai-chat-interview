import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "../config/env";

/**
 * ブラウザ回答者（LINE ログインなしで店舗専用アンケート / デモ案件に答える人）。
 *
 * メール等で URL を受け取った人が PC・LINE 未利用でも A に答えられるようにするための入口。
 * - 回答者は `respondents.line_user_id = "web:<uuid>"` で表す（LINE の userId は "U..." なので衝突しない）。
 *   この接頭辞が「ブラウザ回答」の記録を兼ねる（`line_user_id like 'web:%'` で抽出できる）。
 * - 本人性はブラウザの localStorage に置く署名付きトークンで持つ。同じブラウザなら同じ回答者＝
 *   同じ assignment になり、完了後に開き直しても「回答済み」になる（同一ブラウザ1回まで）。
 * - ブラウザ回答者には LINE がない: ポイント・ランク・LINE 通知・ABC サイクル（B/C 送付）は動かさない。
 *   サイクルは入口で作らない（cycle_id=null）ので離脱率の分母にも入らない。
 *
 * トークン: `hibiweb1.<uuid>.<hmacHex>`。署名鍵は ADMIN_SESSION_SECRET から用途別に派生させる
 * （新しい秘密の環境変数を増やさない。鍵を差し替えると全ブラウザ回答者が「新しい人」に戻るだけ）。
 */

export const WEB_RESPONDENT_PREFIX = "web:";
const TOKEN_VERSION = "hibiweb1";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function isWebRespondentId(userId: string | null | undefined): boolean {
  return typeof userId === "string" && userId.startsWith(WEB_RESPONDENT_PREFIX);
}

export function isWebAnswerToken(token: string | null | undefined): boolean {
  return typeof token === "string" && token.trim().startsWith(`${TOKEN_VERSION}.`);
}

function sign(id: string, secret: string): string {
  return createHmac("sha256", `web-respondent:${secret}`).update(`${TOKEN_VERSION}.${id}`, "utf8").digest("hex");
}

/** 新しいブラウザ回答者を発行する。 */
export function issueWebAnswerToken(secret: string = env.ADMIN_SESSION_SECRET): { token: string; userId: string } {
  const id = randomUUID();
  return { token: `${TOKEN_VERSION}.${id}.${sign(id, secret)}`, userId: `${WEB_RESPONDENT_PREFIX}${id}` };
}

/** トークンを検証し、ブラウザ回答者の userId（"web:<uuid>"）を返す。不正なら null。 */
export function verifyWebAnswerToken(
  token: string | null | undefined,
  secret: string = env.ADMIN_SESSION_SECRET
): string | null {
  if (typeof token !== "string") return null;
  const [version, id, sig, ...rest] = token.trim().split(".");
  if (version !== TOKEN_VERSION || rest.length > 0 || !id || !sig) return null;
  if (!UUID_RE.test(id) || !/^[0-9a-f]{64}$/.test(sig)) return null;
  const expected = Buffer.from(sign(id, secret), "hex");
  const actual = Buffer.from(sig, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return `${WEB_RESPONDENT_PREFIX}${id}`;
}
