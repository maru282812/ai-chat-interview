import type { RequestHandler } from "express";
import { securityEventService } from "../services/securityEventService";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * 管理画面での変更操作（POST/PUT/PATCH/DELETE）を security_events に 1 行ずつ残す。
 * adminAuthMiddleware の後ろに置く（res.locals.adminUser が入っている前提）。
 *
 * 中身（フォームの値）は残さない。どの画面で何をしたか（メソッドとパス）だけ。
 * 記録は待ってから次へ進む（Workers では応答後の処理が打ち切られうるため）。
 */
export const adminActionLog: RequestHandler = (req, res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const actor = typeof res.locals.adminUser === "string" ? res.locals.adminUser : "unknown";
  void securityEventService.record(req, { kind: "admin_action", actor }).finally(() => next());
};
