import type { RequestHandler } from "express";
import { readFlashFromQuery } from "../lib/adminFlash";
import { adminViewHelpers } from "../lib/adminView";

/**
 * 管理画面の全ビューへ共通のロケールを配る。
 * - flash: 操作結果のトースト（partials/header.ejs が描画）
 * - fmtDateTime / statusLabel など: 日時とコード値の表記を全画面で揃えるためのヘルパ
 * - currentPath: ナビの現在地ハイライト用
 */
export const adminLocals: RequestHandler = (req, res, next) => {
  // キー名を `flash` にしないのは、scheduler-settings / reward-campaigns /
  // daily-question-priorities が独自に文字列の `flash` をビューへ渡しており、
  // 衝突すると型の違う値が同じ名前で流れ込むため。
  res.locals.adminFlash = readFlashFromQuery(req.query as Record<string, unknown>);
  res.locals.currentPath = req.baseUrl + req.path;
  Object.assign(res.locals, adminViewHelpers);
  next();
};
