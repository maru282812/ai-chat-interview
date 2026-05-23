import { env } from "../config/env";
import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";

export interface VerifiedLiffUser {
  userId: string;
  displayName: string | null;
  pictureUrl: string | null;
}

export const liffAuthService = {
  async verifyIdToken(idToken: string): Promise<VerifiedLiffUser> {
    if (!env.LINE_LIFF_CHANNEL_ID) {
      logger.error("liffAuth.verifyIdToken.noChannelId", {});
      throw new HttpError(503, "LINE_LIFF_CHANNEL_ID is not configured");
    }

    const normalizedToken = idToken.trim();
    if (!normalizedToken) {
      throw new HttpError(401, "LIFF ID token is missing");
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
      logger.warn("liffAuth.verifyIdToken.lineApiRejected", { status: response.status });
      throw new HttpError(401, "Failed to verify LIFF ID token");
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
