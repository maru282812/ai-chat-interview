import type { NextFunction, Request, RequestHandler, Response } from "express";
import { logger } from "./logger";

export class HttpError extends Error {
  public readonly statusCode: number;

  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    void handler(req, res, next).catch(next);
  };
}

export function errorHandler(
  error: Error | HttpError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  logger.error("Unhandled request error", {
    path: req.path,
    method: req.method,
    message: error.message,
    stack: error.stack
  });

  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  if (req.path.startsWith("/admin/api")) {
    res.status(statusCode).json({ error: error.message });
    return;
  }
  if (req.path.startsWith("/admin")) {
    res.status(statusCode).render("error", {
      title: "Error",
      errorMessage: error.message
    });
    return;
  }

  if (req.path.startsWith("/liff")) {
    const friendlyMessage =
      statusCode === 401
        ? "認証に失敗しました。LINEからもう一度開き直してください。"
        : statusCode === 400
          ? error.message
          : "投稿の保存に失敗しました。時間を置いて再度お試しください。";

    const body: { error: string; detail?: string; fallback: string } = {
      error: friendlyMessage,
      fallback: "解決しない場合はLINEトーク画面から再度開き直してください。"
    };
    // detail は 4xx のみ。5xx は DB 内部メッセージ等が混入し得るため露出させない。
    if (statusCode < 500) {
      body.detail = error.message;
    }
    res.status(statusCode).json(body);
    return;
  }

  res.status(statusCode).json({
    error: error.message
  });
}
