import { env } from "../config/env";
import { logger } from "../lib/logger";
import type { LineMessage } from "../types/domain";

const lineApiBaseUrl = "https://api.line.me/v2/bot";

function previewMessages(messages: LineMessage[]): string[] {
  return messages.slice(0, 3).map((message) => {
    if (message.type === "text") {
      return message.text.slice(0, 120);
    }
    return message.altText.slice(0, 120);
  });
}

async function callLineApi(
  path: string,
  body: unknown,
  meta: Record<string, unknown>
): Promise<void> {
  logger.info("line.api.request.start", {
    path,
    ...meta
  });

  try {
    const response = await fetch(`${lineApiBaseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`
      },
      body: JSON.stringify(body)
    });
    const responseText = await response.text();

    if (!response.ok) {
      logger.error("line.api.request.failed", {
        path,
        ...meta,
        status: response.status,
        statusText: response.statusText,
        responseText
      });
      throw new Error(`LINE API request failed: ${response.status}`);
    }

    logger.info("line.api.request.success", {
      path,
      ...meta,
      status: response.status,
      statusText: response.statusText,
      responseText: responseText || null
    });
  } catch (error) {
    logger.error("line.api.request.exception", {
      path,
      ...meta,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

export const lineMessagingService = {
  async reply(replyToken: string, messages: LineMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    logger.info("line.reply.start", {
      replyTokenPreview: replyToken.slice(0, 8),
      messageCount: messages.length,
      messagePreview: previewMessages(messages)
    });

    await callLineApi("/message/reply", {
      replyToken,
      messages
    }, {
      targetType: "reply",
      replyTokenPreview: replyToken.slice(0, 8),
      messageCount: messages.length,
      messagePreview: previewMessages(messages)
    });

    logger.info("line.reply.success", {
      replyTokenPreview: replyToken.slice(0, 8),
      messageCount: messages.length
    });
  },

  async push(userId: string, messages: LineMessage[]): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    logger.info("line.push.start", {
      userId,
      messageCount: messages.length,
      messagePreview: previewMessages(messages)
    });

    await callLineApi("/message/push", {
      to: userId,
      messages
    }, {
      targetType: "push",
      userId,
      messageCount: messages.length,
      messagePreview: previewMessages(messages)
    });

    logger.info("line.push.success", {
      userId,
      messageCount: messages.length
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
