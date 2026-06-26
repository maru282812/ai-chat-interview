import { Router } from "express";
import { asyncHandler } from "../lib/http";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { cronDispatchService } from "../services/cronDispatchService";

export const cronRoutes = Router();

// Vercel Cron Jobs から定期的に叩かれるディスパッチャ。
// Vercel は CRON_SECRET 環境変数が設定されていると Authorization: Bearer <secret> を付与する。
// それを検証し、第三者による配信暴発を防ぐ。GET/POST どちらでも受ける。
cronRoutes.all(
  "/dispatch",
  asyncHandler(async (req, res) => {
    const secret = env.CRON_SECRET;
    if (!secret) {
      // 未設定なら誰でも叩ける状態を避けるため、起動せず無効扱いにする。
      res.status(503).json({ ok: false, error: "CRON_SECRET is not configured" });
      return;
    }
    if (req.headers.authorization !== `Bearer ${secret}`) {
      res.status(401).json({ ok: false, error: "unauthorized" });
      return;
    }

    const summary = await cronDispatchService.dispatch();
    const fired = summary.filter((s) => s.ran);
    logger.info("cronDispatch: dispatched", { firedCount: fired.length });
    res.json({ ok: true, ran_at: new Date().toISOString(), fired: fired.length, summary });
  })
);
