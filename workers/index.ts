/**
 * Cloudflare Workers のエントリポイント。
 *
 * Vercel 側の api/index.ts と対になる。アプリ本体（createApp）は共通で、
 * ここは「Workers 固有の作法」だけを引き受ける:
 *
 *   1. env の注入（Workers に process.env は無い。fetch handler の引数で来る）
 *   2. Express アプリを fetch handler に載せる（workers/expressAdapter.ts）
 *   3. Cron Trigger（scheduled handler）から定期ディスパッチを叩く
 *
 * node-cron による常駐スケジューラは起動しない。
 * サーバーレスでは常駐できないため、Vercel 側と同じ扱いにしている。
 */
import type { Express } from "express";
import { createFetchHandler } from "./expressAdapter";

/** wrangler の vars / secrets がそのまま入ってくる */
export interface WorkerEnv {
  [key: string]: string | undefined;
}

// createApp / initEnv は env 注入より先に評価してはいけないので遅延ロードする。
// （モジュールのトップレベルで import すると config/env.ts が読み込まれ、
//   env 未注入のまま参照されうる）
let cachedHandler: ((request: Request) => Promise<Response>) | null = null;
let cachedApp: Express | null = null;

async function getHandler(env: WorkerEnv) {
  if (cachedHandler) return cachedHandler;

  const { initEnv } = await import("../src/config/env");
  initEnv(env as Record<string, unknown>);

  const { createApp } = await import("../src/app");
  cachedApp = createApp();
  cachedHandler = createFetchHandler(cachedApp);
  return cachedHandler;
}

export default {
  async fetch(request: Request, env: WorkerEnv, _ctx: ExecutionContext): Promise<Response> {
    try {
      const handler = await getHandler(env);
      return await handler(request);
    } catch (e) {
      // 起動時（env 欠落など）の失敗をここで握って可視化する。
      // 無言の 500 だと原因が分からず、過去に本番全停止で苦労しているため。
      const message = e instanceof Error ? e.message : String(e);
      return new Response(
        JSON.stringify({ ok: false, error: "worker_bootstrap_failed", message }, null, 2),
        { status: 500, headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }
  },

  /**
   * Cron Trigger。wrangler.toml の [triggers] crons で発火間隔を決める。
   *
   * HTTP で自分自身を叩くのではなく、サービスを直接呼ぶ。
   * （自己 fetch は Workers では余計なコストと失敗点になるため）
   *
   * ⚠ Vercel 側の cron と**同時に有効にしてはいけない**。配信が二重に走る。
   */
  async scheduled(event: ScheduledController, env: WorkerEnv, ctx: ExecutionContext): Promise<void> {
    const run = async () => {
      const { initEnv } = await import("../src/config/env");
      initEnv(env as Record<string, unknown>);

      const { cronDispatchService } = await import("../src/services/cronDispatchService");
      const { logger } = await import("../src/lib/logger");

      try {
        const summary = await cronDispatchService.dispatch();
        logger.info("Workers cron dispatched", {
          cron: event.cron,
          outcomes: summary.length,
        });
      } catch (e) {
        logger.error("Workers cron failed", {
          cron: event.cron,
          message: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }
    };

    // ポイント付与・通知・監査ログは投げっぱなしにしない（レスポンス前に await）
    ctx.waitUntil(run());
  },
};
