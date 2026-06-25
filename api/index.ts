import { createApp } from "../src/app";

// Vercel のサーバーレス関数エントリポイント。
// Express アプリ（createApp）をそのままハンドラとしてエクスポートする。
// 注意: node-cron による通知スケジューラ（notificationSchedulerService.startScheduler）は
// サーバーレス環境では常駐できないため、ここでは起動しない。
// 定期実行が必要な場合は Vercel Cron Jobs から専用エンドポイントを叩く構成にすること。
const app = createApp();

export default app;
