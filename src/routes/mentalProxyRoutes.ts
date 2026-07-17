import { createHash } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { asyncHandler } from "../lib/http";
import { logger } from "../lib/logger";

export const mentalProxyRoutes = Router();

// staff-voice（企業メンタルチェック・別リポ/別DB）向けの Push プロキシ（H-1）。
// staff-voice は LINE チャネルトークンを持たない設計のため、通知送信だけをここで中継する。
//
// 視界分離の運用面の約束:
// - ステートレス。Hibi 側の DB には一切書かない。
// - メッセージ本文・宛先 userId を Hibi のログに残さない（メンタルチェック参加の痕跡を
//   Hibi 側に作らないため）。ログは件数とハッシュ化した宛先のみ。
// - lineMessagingService.push は本文プレビューをログに出すため使わず、ここで直接 LINE API を呼ぶ。

const pushRequestSchema = z.object({
  to: z.string().regex(/^U[0-9a-f]{32}$/),
  messages: z
    .array(
      z.union([
        z.object({ type: z.literal("text"), text: z.string().min(1).max(5000) }),
        z.object({
          type: z.literal("flex"),
          altText: z.string().min(1).max(400),
          contents: z.record(z.string(), z.unknown())
        })
      ])
    )
    .min(1)
    .max(5)
});

function anonymizedTo(userId: string): string {
  return createHash("sha256").update(userId).digest("hex").slice(0, 12);
}

mentalProxyRoutes.post(
  "/push",
  asyncHandler(async (req, res) => {
    const secret = env.MENTAL_PUSH_PROXY_SECRET;
    if (!secret) {
      res.status(503).json({ ok: false, error: "MENTAL_PUSH_PROXY_SECRET is not configured" });
      return;
    }
    if (req.headers.authorization !== `Bearer ${secret}`) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    const parsed = pushRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, error: "invalid request body" });
      return;
    }

    const { to, messages } = parsed.data;
    const response = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`
      },
      body: JSON.stringify({ to, messages })
    });

    if (!response.ok) {
      // 本文は読んでも返さない・ログに残さない（LINE のエラー本文に宛先情報が含まれ得るため）。
      logger.error("mentalProxy.push.failed", {
        toHash: anonymizedTo(to),
        messageCount: messages.length,
        status: response.status
      });
      res.status(502).json({ ok: false, error: "line api error", lineStatus: response.status });
      return;
    }

    logger.info("mentalProxy.push.success", {
      toHash: anonymizedTo(to),
      messageCount: messages.length
    });
    res.json({ ok: true });
  })
);
