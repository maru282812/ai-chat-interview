import { createApp } from "./app";
import { env } from "./config/env";
import { logger } from "./lib/logger";

const app = createApp();

app.listen(env.PORT, () => {
  logger.info("Server started", {
    port: env.PORT,
    baseUrl: env.APP_BASE_URL
  });
});
