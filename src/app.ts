import path from "path";
import express from "express";
import { env } from "./config/env";
import { adminAuthMiddleware } from "./middleware/adminAuth";
import { errorHandler } from "./lib/http";
import { adminRoutes } from "./routes/adminRoutes";
import { liffRoutes } from "./routes/liffRoutes";
import { webhookRoutes } from "./routes/webhookRoutes";

export function createApp() {
  const app = express();

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
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      environment: env.NODE_ENV
    });
  });

  app.use("/webhooks", webhookRoutes);
  app.use("/admin", adminAuthMiddleware, adminRoutes);
  app.use("/liff", liffRoutes);

  app.get("/", (_req, res) => {
    res.redirect("/admin");
  });

  app.use(errorHandler);
  return app;
}
