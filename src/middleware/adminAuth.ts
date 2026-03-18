import type { RequestHandler } from "express";
import { env } from "../config/env";

export const adminAuthMiddleware: RequestHandler = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Basic ")) {
    res.setHeader("WWW-Authenticate", 'Basic realm="admin"');
    res.status(401).send("Authentication required");
    return;
  }

  const encoded = authHeader.slice("Basic ".length);
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  const username = separatorIndex >= 0 ? decoded.slice(0, separatorIndex) : "";
  const password = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";

  if (username !== env.ADMIN_BASIC_USER || password !== env.ADMIN_BASIC_PASSWORD) {
    res.setHeader("WWW-Authenticate", 'Basic realm="admin"');
    res.status(401).send("Invalid credentials");
    return;
  }

  next();
};
