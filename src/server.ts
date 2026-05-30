import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";
import { notificationSchedulerService } from "./services/notificationSchedulerService";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info("Server started", {
    port: env.PORT,
    baseUrl: env.APP_BASE_URL
  });

  notificationSchedulerService.startScheduler().catch((e) => {
    logger.warn("Scheduler: failed to start", { error: String(e) });
  });

  logger.info("env.liff.config", {
    hasLineLiffChannelId: Boolean(process.env.LINE_LIFF_CHANNEL_ID),
    lineLiffChannelIdLast4: process.env.LINE_LIFF_CHANNEL_ID?.slice(-4),
    hasLineLiffId: Boolean(process.env.LINE_LIFF_ID),
    hasLineLiffIdSurvey: Boolean(process.env.LINE_LIFF_ID_SURVEY),
    lineLiffIdSurveyLast4: process.env.LINE_LIFF_ID_SURVEY?.slice(-4),
    hasLineLiffIdMypage: Boolean(process.env.LINE_LIFF_ID_MYPAGE),
    appBaseUrl: process.env.APP_BASE_URL,
    nodeEnv: process.env.NODE_ENV,
    liffAuthRequired: process.env.LIFF_AUTH_REQUIRED,
    allowLiffAuthSkip: process.env.ALLOW_LIFF_AUTH_SKIP,
  });
});
