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

    const payload = new URLSearchParams({
      id_token: normalizedToken,
      client_id: env.LINE_LIFF_CHANNEL_ID
    });

    let response: globalThis.Response;
    try {
      response = await fetch("https://api.line.me/oauth2/v2.1/verify", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: payload.toString()
      });
    } catch (err) {
      logger.error("liffAuth.verifyIdToken.fetchFailed", { error: String(err) });
      throw new HttpError(503, "LINE token verification is unavailable");
    }

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

    return {
      userId: data.sub,
      displayName: data.name ?? null,
      pictureUrl: data.picture ?? null
    };
  }
};
