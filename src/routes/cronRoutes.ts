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
// 【自動実行を有効化する手順】（現在は無効。Hobby プランは毎分 cron でデプロイ失敗するため）
//   Pro プランに上げて定期配信が必要になったら、vercel.json に以下を追加する:
//     "crons": [
//       { "path": "/api/cron/dispatch", "schedule": "* * * * *" }
//     ]
//   さらに Vercel の環境変数に CRON_SECRET を設定し、066 マイグレーションを適用しておくこと。
//   ※ Hobby のままなら毎分は不可。日次までなら "0 22 * * *" のような 1 日 1 回の式にする。
//   無効化中も、このエンドポイントは手動 curl で叩いて動作確認できる。
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
