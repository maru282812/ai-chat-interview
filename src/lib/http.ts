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
  // 管理画面から fetch で呼ぶエンドポイント（キューの並べ替え・日付固定など）は
  // Accept: application/json を送る。HTML のエラーページを返すとクライアントが
  // メッセージを読めないので JSON で返す。
  if (req.path.startsWith("/admin") && (req.headers.accept ?? "").includes("application/json")) {
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
    // 401 は「LINEから開き直す」導線が最適なので専用文言。それ以外の 4xx（400/403/404/409 等）は
    // HttpError の message が利用者向けに意図された説明（例: 「このお店のアンケートが見つかりませんでした。」）
    // なのでそのまま返す。5xx は DB 内部メッセージ等が混入し得るため文脈非依存の定型文に丸める
    // （旧実装は 4xx も一律「投稿の保存に失敗しました」に潰れ、回答/完了/流入で文脈がずれていた）。
    const friendlyMessage =
      statusCode === 401
        ? "認証に失敗しました。LINEからもう一度開き直してください。"
        : statusCode < 500
          ? error.message
          : "処理に失敗しました。時間を置いて再度お試しください。";

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
