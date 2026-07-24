import path from "path";
import express from "express";
import { env } from "./config/env";
import { adminAuthMiddleware } from "./middleware/adminAuth";
import { adminCsrfMiddleware } from "./middleware/adminCsrf";
import { adminLocals } from "./middleware/adminLocals";
import { perfTiming } from "./middleware/perfTiming";
import { errorHandler } from "./lib/http";
import { adminRoutes } from "./routes/adminRoutes";
import { liffRoutes } from "./routes/liffRoutes";
import { webhookRoutes } from "./routes/webhookRoutes";
import { cronRoutes } from "./routes/cronRoutes";
import { mentalProxyRoutes } from "./routes/mentalProxyRoutes";
import { registerAdminChatTools } from "./services/adminChat/registerTools";

export function createApp() {
  const app = express();

  // 管理画面AIチャットが使えるツールを登録する（docs/impl-admin-ai-chat.md）
  registerAdminChatTools();

  app.set("views", path.join(process.cwd(), "src", "views"));
  app.set("view engine", "ejs");

  app.use((_req, res, next) => {
    const originalRender = res.render.bind(res);
    res.render = ((view: string, options?: unknown, callback?: unknown) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return originalRender(view, options as never, callback as never);
    }) as typeof res.render;
    next();
  });

  app.use("/public", express.static(path.join(process.cwd(), "src", "public")));
  app.use("/webhooks/line", express.raw({ type: "application/json" }));
  app.use(express.json({ limit: "10mb" }));
  // 計測ビーコンだけは「壊れた JSON でも 204」を守る。express.json() はパース失敗を
  // throw し、それはルートの try/catch より前で起きるためルート側では捕まえられない。
  // ここで本ルートのパースエラーだけを body={} に丸め、計測が 500 を出さないようにする
  // （他のエンドポイントの 400/500 挙動は変えない）。
  app.use((err: unknown, req: express.Request, _res: express.Response, next: express.NextFunction) => {
    if (req.path === "/liff/behavior-beacon" && err instanceof SyntaxError) {
      req.body = {};
      next();
      return;
    }
    next(err);
  });
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      environment: env.NODE_ENV
    });
  });

  app.use("/webhooks", webhookRoutes);
  app.use("/api/cron", cronRoutes);
  app.use("/api/mental", mentalProxyRoutes);
  app.use("/admin", adminAuthMiddleware, adminCsrfMiddleware, adminLocals, adminRoutes);
  app.use("/liff", perfTiming, liffRoutes);

  app.get("/", (_req, res) => {
    res.redirect("/admin");
  });

  app.use(errorHandler);
  return app;
}
