import { env } from "../config/env";
import { logger } from "../lib/logger";
import type { LineMessage } from "../types/domain";

const lineApiBaseUrl = "https://api.line.me/v2/bot";

async function callLineApi(path: string, body: unknown): Promise<void> {
  const response = await fetch(`${lineApiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error("LINE API request failed", { path, status: response.status, text });
    throw new Error(`LINE API request failed: ${response.status}`);
  }
}

export const lineMessagingService = {
  async reply(replyToken: string, messages: LineMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    await callLineApi("/message/reply", {
      replyToken,
      messages
    });
  },

  async push(userId: string, messages: LineMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    await callLineApi("/message/push", {
      to: userId,
      messages
    });
  },

  async getProfile(userId: string): Promise<{ displayName: string | null }> {
    const response = await fetch(`${lineApiBaseUrl}/profile/${userId}`, {
      headers: {
        Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`
      }
    });

    if (!response.ok) {
      logger.warn("Failed to fetch LINE profile", { userId, status: response.status });
      return { displayName: null };
    }

    const data = (await response.json()) as { displayName?: string };
    return { displayName: data.displayName ?? null };
  }
};
