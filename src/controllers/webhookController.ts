import type { Request, Response } from "express";
import { verifyLineSignature } from "../lib/line";
import { logger } from "../lib/logger";
import { conversationOrchestratorService } from "../services/conversationOrchestratorService";
import type { LineWebhookEvent } from "../types/domain";

export const webhookController = {
  async lineWebhook(req: Request, res: Response): Promise<void> {
    const rawBody = req.body as Buffer;
    const signature = req.headers["x-line-signature"];
    const normalizedSignature = Array.isArray(signature) ? signature[0] : signature;

    if (!verifyLineSignature(rawBody, normalizedSignature)) {
      res.status(401).json({ error: "Invalid LINE signature" });
      return;
    }

    const payload = JSON.parse(rawBody.toString("utf8")) as { events?: LineWebhookEvent[] };
    for (const event of payload.events ?? []) {
      if (!event.source.userId || event.mode === "standby") {
        continue;
      }

      try {
        if (event.type === "follow" && event.replyToken) {
          await conversationOrchestratorService.handleFollowEvent(event.source.userId, event.replyToken);
          continue;
        }

        if (event.type === "unfollow") {
          await conversationOrchestratorService.handleUnfollowEvent(event.source.userId);
          continue;
        }

        if (event.type === "message" && event.replyToken && event.message?.type === "text") {
          await conversationOrchestratorService.handleTextMessage({
            userId: event.source.userId,
            replyToken: event.replyToken,
            text: event.message.text ?? "",
            rawPayload: event as unknown as Record<string, unknown>
          });
          continue;
        }

        if (event.type === "message" && event.replyToken && event.message) {
          await conversationOrchestratorService.handleNonTextMessage({
            userId: event.source.userId,
            replyToken: event.replyToken,
            messageType: event.message.type,
            rawPayload: event as unknown as Record<string, unknown>
          });
        }
      } catch (error) {
        logger.error("Failed to handle LINE event", {
          eventType: event.type,
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }

    res.json({ ok: true });
  }
};
