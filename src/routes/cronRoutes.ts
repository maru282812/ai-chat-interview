import { Router } from "express";
import { asyncHandler } from "../lib/http";
import { env } from "../config/env";
import { logger } from "../lib/logger";
import { cronDispatchService } from "../services/cronDispatchService";

export const cronRoutes = Router();

// Vercel Cron Jobs から定期的に叩かれるディスパッチャ。
// Vercel は CRON_SECRET 環境変数が設定されていると Authorization: Bearer <secret> を付与する。
// それを検証し、第三者による配信暴発を防ぐ。GET/POST どちらでも受ける。
//
// 【現在の状態】Pro プラン化にともない自動実行は有効（2026-08-14）。
//   - vercel.json の "crons" で毎分このパスを叩く（* * * * *）。
//   - Vercel 環境変数に CRON_SECRET を設定済み（Production / Preview）。
//   - 066 マイグレーション（cron_dispatch_runs）適用済み。
//
//   毎分叩くのは cronDispatchService の CATCH_UP_WINDOW_MIN（5分）が前提にしているため。
//   実行間隔を広げるとこの窓を跨いだジョブが「その日まるごと未実行」になりうる。
//
//   実際に何が発火するかは DB 側の設定が決める（このエンドポイント自体は素通し）:
//     - デイリー: notification_scheduler_settings の *_enabled / *_time
//     - 配信テンプレ: delivery_templates.is_enabled
//   止めたいときは上記を false にする（cron を消すより安全で、履歴も残る）。
//   手動 curl での動作確認も従来どおり可能。
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
