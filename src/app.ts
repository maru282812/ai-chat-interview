import path from "path";
import express from "express";
import { env } from "./config/env";
import { adminAuthMiddleware } from "./middleware/adminAuth";
import { errorHandler } from "./lib/http";
import { adminRoutes } from "./routes/adminRoutes";
import { webhookRoutes } from "./routes/webhookRoutes";

export function createApp() {
  const app = express();

  app.set("views", path.join(process.cwd(), "src", "views"));
  app.set("view engine", "ejs");

  app.use("/public", express.static(path.join(process.cwd(), "src", "public")));
  app.use("/webhooks/line", express.raw({ type: "application/json" }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get("/health", (_req, res) => {
    res.json({
      ok: true,
      environment: env.NODE_ENV
    });
  });

  app.use("/webhooks", webhookRoutes);
  app.use("/admin", adminAuthMiddleware, adminRoutes);

  app.get("/", (_req, res) => {
    res.redirect("/admin");
  });

  app.use(errorHandler);
  return app;
}
