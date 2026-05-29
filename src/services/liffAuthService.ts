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

export const liffAuthService = {
  async verifyIdToken(idToken: string, ctx?: VerifyIdTokenCtx): Promise<VerifiedLiffUser> {
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
