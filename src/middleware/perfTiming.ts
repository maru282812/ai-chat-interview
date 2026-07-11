import type { NextFunction, Request, Response } from "express";
import { logger } from "../lib/logger";

// プロセス起動時刻。サーバーレスの「コールドスタート」を検出するために使う。
// モジュール初回importの瞬間＝プロセス起動なので、最初のリクエストだけ
// coldStart=true になり、以降は温まった（ウォーム）関数として記録される。
const PROCESS_BOOT_AT = Date.now();
let servedFirstRequest = false;

/**
 * LIFF リクエストの総処理時間を計測して構造化ログに出す軽量ミドルウェア。
 * - 挙動は一切変えない（ヘッダ追加とログのみ）。
 * - `Server-Timing` ヘッダを付けるので、PC の DevTools → Network → Timing でも内訳が見える。
 * - 初回リクエストは `coldStart: true`＋`sinceBootMs` を記録し、コールドスタート分を分離できる。
 *
 * この総時間から、別途 liffAuthService が出す「LINE検証の往復時間」を引くと
 * 「DB＋レンダリング」の残差が推定できる（＝推測せず内訳を実測するための土台）。
 */
export function perfTiming(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  const isColdStart = !servedFirstRequest;
  servedFirstRequest = true;

  res.on("finish", () => {
    const durMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const rounded = Math.round(durMs * 10) / 10;

    // Server-Timing は finish 時点では送出済みで付けられないため、ここではログのみ。
    // （ヘッダは下の onHeaders 側で付与する）
    logger.info("perf.liff.request", {
      method: req.method,
      path: req.path,
      status: res.statusCode,
      durMs: rounded,
      coldStart: isColdStart,
      sinceBootMs: isColdStart ? Date.now() - PROCESS_BOOT_AT : undefined,
    });
  });

  // レスポンスヘッダ確定の直前に Server-Timing を差し込む（DevTools 可視化用）。
  const originalWriteHead = res.writeHead.bind(res);
  res.writeHead = ((...args: Parameters<typeof res.writeHead>) => {
    try {
      const durMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const st = `total;dur=${Math.round(durMs * 10) / 10}` + (isColdStart ? ", cold;desc=\"cold-start\"" : "");
      if (!res.headersSent) res.setHeader("Server-Timing", st);
    } catch {
      /* noop: 計測がリクエストを壊さないことを最優先 */
    }
    return originalWriteHead(...args);
  }) as typeof res.writeHead;

  next();
}
