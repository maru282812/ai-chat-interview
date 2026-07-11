import { env } from "../config/env";
import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";

export interface VerifiedLiffUser {
  userId: string;
  displayName: string | null;
  pictureUrl: string | null;
}

export interface VerifyIdTokenCtx {
  path?: string;
  userAgent?: string;
  referer?: string;
}

/**
 * テスト用 sentinel。Authorization/id_token がこの接頭辞のとき、非本番限定で
 * 実 LINE 検証をスキップし `<lineUserId>` を本人として返す（testmaster run skill 用）。
 */
const TEST_TOKEN_PREFIX = "tmtest:";

/**
 * 検証成功の短期キャッシュ。回答フローは設問ごとに同一トークンで verify を呼ぶため、
 * そのたびに api.line.me へ往復すると1回答あたり数百msが認証だけで消える。
 * - キーはトークン文字列そのもの: 別ユーザー・再ログイン後の新トークンは必ず再検証される。
 * - 成功のみキャッシュ: 失敗(401等)は従来どおり毎回 LINE に問い合わせる。
 * - 緩和されるのは「失効直後のトークンを最長 TTL 秒受け入れる」ことだけで、
 *   本人性の証明（IDOR 防止）は変わらない。TTL は短く保つこと。
 * - サーバーレスではインスタンスごとのメモリなので、上限超過は挿入順で間引く。
 */
const VERIFY_CACHE_TTL_MS = 60_000;
const VERIFY_CACHE_MAX_ENTRIES = 500;
const verifyCache = new Map<string, { user: VerifiedLiffUser; expiresAt: number }>();

export const liffAuthService = {
  async verifyIdToken(idToken: string, ctx?: VerifyIdTokenCtx): Promise<VerifiedLiffUser> {
    // テスト到達用 seam（非本番限定）: id_token 検証を要する「認証後の分岐」を testmaster の
    // run skill から到達可能にする。Authorization: Bearer tmtest:<lineUserId>
    // （または body の id_token に "tmtest:<lineUserId>"）を渡したときのみ、実 LINE 検証を
    // スキップして固定ユーザーを返す。本番(NODE_ENV=production)では分岐に入らず完全に無効。
    if (env.NODE_ENV !== "production" && idToken.trim().startsWith(TEST_TOKEN_PREFIX)) {
      const userId = idToken.trim().slice(TEST_TOKEN_PREFIX.length) || "tmtest_user";
      logger.warn("liffAuth.verifyIdToken.testSeam", { userId, path: ctx?.path });
      return { userId, displayName: "TM Test User", pictureUrl: null };
    }

    if (!env.LINE_LIFF_CHANNEL_ID) {
      logger.error("liffAuth.verifyIdToken.noChannelId", {
        hint: "LINE_LIFF_CHANNEL_ID must be the LINE Login channel ID (not the Messaging API channel ID)",
      });
      throw new HttpError(503, "LINE_LIFF_CHANNEL_ID is not configured");
    }

    const normalizedToken = idToken.trim();
    if (!normalizedToken) {
      throw new HttpError(401, "NO_ID_TOKEN");
    }

    const cached = verifyCache.get(normalizedToken);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.user;
    }

    const payload = new URLSearchParams({
      id_token: normalizedToken,
      client_id: env.LINE_LIFF_CHANNEL_ID
    });

    let response: globalThis.Response;
    // LINE の verify エンドポイントへの往復時間を単独で計測する。ほぼ全 LIFF データ
    // エンドポイントが1回ずつ verify を呼ぶため、この1箇所のログで「認証往復コスト」を
    // 全エンドポイント横断で分離できる（perfTiming の総時間から引けば DB＋描画が残差）。
    const verifyStart = process.hrtime.bigint();
    try {
      response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: payload.toString()
      });
    } catch (err) {
      logger.error("liffAuth.verifyIdToken.fetchFailed", {
        error: String(err),
        durMs: Math.round(Number(process.hrtime.bigint() - verifyStart) / 1e5) / 10,
        path: ctx?.path,
      });
      throw new HttpError(503, "LINE token verification is unavailable");
    }
    logger.info("liffAuth.verifyIdToken.timing", {
      durMs: Math.round(Number(process.hrtime.bigint() - verifyStart) / 1e5) / 10,
      status: response.status,
      path: ctx?.path,
    });

    if (!response.ok) {
      let bodyText = "";
      try { bodyText = await response.text(); } catch { /* ignore */ }
      const isTokenExpired = bodyText.includes("IdToken expired");
      const isWrongChannel = !isTokenExpired && (
        bodyText.includes("wrong channel") ||
        bodyText.includes("invalid_client") ||
        bodyText.includes("Invalid LIFF ID")
      );
      logger.warn("liffAuth.verifyIdToken.lineApiRejected", {
        status: response.status,
        errorType: isTokenExpired ? "TOKEN_EXPIRED" : isWrongChannel ? "INVALID_LIFF_CONFIG" : "LIFF_AUTH_FAILED",
        hasIdToken: Boolean(normalizedToken),
        hasChannelId: Boolean(env.LINE_LIFF_CHANNEL_ID),
        channelIdEnv: "LINE_LIFF_CHANNEL_ID",
        path: ctx?.path,
        userAgent: ctx?.userAgent?.slice(0, 200),
        referer: ctx?.referer,
      });
      if (isTokenExpired) {
        throw new HttpError(401, "TOKEN_EXPIRED");
      }
      if (isWrongChannel) {
        throw new HttpError(401, "INVALID_LIFF_CONFIG");
      }
      throw new HttpError(401, "LIFF_AUTH_FAILED");
    }

    const data = (await response.json()) as {
      sub?: string;
      name?: string;
      picture?: string;
    };

    if (!data.sub) {
      logger.warn("liffAuth.verifyIdToken.noSub", {});
      throw new HttpError(401, "LIFF user could not be identified");
    }

    logger.info("liffAuth.verifyIdToken.success", { userId: data.sub });

    const user: VerifiedLiffUser = {
      userId: data.sub,
      displayName: data.name ?? null,
      pictureUrl: data.picture ?? null
    };

    // 成功のみキャッシュ。上限超過は挿入順（Map の先頭＝最古）から間引く。
    if (verifyCache.size >= VERIFY_CACHE_MAX_ENTRIES) {
      const oldestKey = verifyCache.keys().next().value;
      if (oldestKey !== undefined) verifyCache.delete(oldestKey);
    }
    verifyCache.set(normalizedToken, { user, expiresAt: Date.now() + VERIFY_CACHE_TTL_MS });

    return user;
  }
};
