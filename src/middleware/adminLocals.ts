import type { RequestHandler } from "express";
import { readFlashFromQuery } from "../lib/adminFlash";
import { adminViewHelpers } from "../lib/adminView";
import { buildNavGroups, buildPinnedNavItems, resolveScreenByPath } from "../lib/adminScreenCatalog";

/**
 * 管理画面の全ビューへ共通のロケールを配る。
 * - flash: 操作結果のトースト（partials/header.ejs が描画）
 * - fmtDateTime / statusLabel など: 日時とコード値の表記を全画面で揃えるためのヘルパ
 * - currentPath: ナビの現在地ハイライト用
 * - navGroups / pinnedNavItems / currentScreen: 画面カタログ（lib/adminScreenCatalog.ts）から
 *   生成したナビと現在画面。ヘッダーの直書き配列を廃し、ナビ・検索・索引・道しるべAIが
 *   同じ台帳を見るようにする。pinnedNavItems は「よく使う」の外出し列。
 */
export const adminLocals: RequestHandler = (req, res, next) => {
  // キー名を `flash` にしないのは、scheduler-settings / reward-campaigns /
  // daily-question-priorities が独自に文字列の `flash` をビューへ渡しており、
  // 衝突すると型の違う値が同じ名前で流れ込むため。
  res.locals.adminFlash = readFlashFromQuery(req.query as Record<string, unknown>);
  const currentPath = req.baseUrl + req.path;
  res.locals.currentPath = currentPath;
  // ナビはリクエストごとに組み直す（カタログは定数なので実質的なコストは配列の詰め替えだけ）。
  res.locals.navGroups = buildNavGroups();
  // 「よく使う」外出し列。グループ側からは消していないので、ここが空でも到達性は落ちない。
  res.locals.pinnedNavItems = buildPinnedNavItems();
  // 台帳に無いパス（api/エクスポート等）では null。ビュー側は null 前提で書く。
  const currentScreen = resolveScreenByPath(currentPath);
  res.locals.currentScreen = currentScreen;
  // AIチャットパネルを全画面常駐にする（Phase 3）。台帳に載っている画面なら既定で有効化する。
  // entityId は middleware では分からないので null。対象レコードのある画面
  // （research-form / respondent-show / sessions-index / session-show）は
  // コントローラが res.render の引数で entityId 付きの aiChat を明示的に渡しており、
  // **render 引数は res.locals より優先される**ためここの既定値は上書きされる。
  // ⚠ この優先順（middleware 既定 → コントローラ明示）を崩さないこと。
  if (currentScreen) {
    res.locals.aiChat = { screenKey: currentScreen.key, entityId: null };
  }
  Object.assign(res.locals, adminViewHelpers);
  next();
};
