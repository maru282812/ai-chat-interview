import { Router } from "express";
import { liffController } from "../controllers/liffController";
import { asyncHandler } from "../lib/http";
import { logger } from "../lib/logger";

export const liffRoutes = Router();

// クライアント側の体感時間ビーコン（計測フェーズ専用・DB書込みなし・認証不要）。
// モバイルの LINE 内ブラウザは DevTools が使えないため、SDKダウンロード＋liff.init など
// サーバーログに映らないクライアント側ウォーターフォールを sendBeacon で回収して
// Vercel ログに出す。挙動には一切影響しない。数値の目星が付いたら撤去してよい。
liffRoutes.post("/perf-beacon", (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined);
  logger.info("perf.liff.client", {
    page: typeof b.page === "string" ? b.page.slice(0, 80) : undefined,
    sdkReadyMs: num(b.sdkReadyMs), // ページ読込開始→LIFF SDK 実行可能まで（CDN DL 相当）
    initMs: num(b.initMs), //         liff.init() の所要（LINE 往復含む）
    authTotalMs: num(b.authTotalMs), // 認証完了まで（sdkReady+init+ログイン判定）
    dataMs: num(b.dataMs), //          データ fetch 往復
    renderMs: num(b.renderMs), //      DOM 描画
    totalMs: num(b.totalMs), //        ページ読込開始→初期表示完了
    inClient: typeof b.inClient === "boolean" ? b.inClient : undefined,
  });
  res.status(204).end();
});

// サイトの玄関。LIFF endpoint を {APP_BASE_URL}/liff に設定すると、
// リッチメニュー等の https://liff.line.me/{id}/projects 形式のディープリンクが
// そのまま各ページに解決される。無印(パス無し)で開かれたら「探す」へ送る。
liffRoutes.get("/", (req, res) => {
  // 店舗QR（liff.line.me/{id}?entry_code=xxx）の着地。endpoint が /liff の LIFF 構成でも
  // 店舗入口へ解決できるよう、query / liff.state から entry_code を拾って引き継ぐ。
  // liff.state をリダイレクト先に残すと SDK の二次リダイレクトで endpoint へ戻され
  // ループするため、entry_code だけを取り出して捨てる。
  const entryCode = (() => {
    const direct = typeof req.query.entry_code === "string" ? req.query.entry_code.trim() : "";
    if (direct) return direct;
    const liffState = typeof req.query["liff.state"] === "string" ? req.query["liff.state"] : "";
    if (!liffState) return "";
    try {
      const params = new URLSearchParams(liffState.startsWith("?") ? liffState.slice(1) : liffState);
      return (params.get("entry_code") ?? "").trim();
    } catch {
      return "";
    }
  })();
  if (entryCode) {
    res.redirect(302, `/liff/store?entry_code=${encodeURIComponent(entryCode)}`);
    return;
  }

  // 案件配信の「回答を開始する」（liff.line.me/{id}?assignment_id=xxx）の着地。
  // endpoint が /liff の LIFF 構成では liff.state 内に assignment_id が入るため、
  // ここで拾わないと下の「探す」リダイレクトで assignment_id が捨てられ回答画面に到達できない。
  // entry_code 同様、liff.state はループ防止のため引き継がず assignment_id だけ取り出す。
  const assignmentId = (() => {
    const direct = typeof req.query.assignment_id === "string" ? req.query.assignment_id.trim() : "";
    if (direct) return direct;
    const liffState = typeof req.query["liff.state"] === "string" ? req.query["liff.state"] : "";
    if (!liffState) return "";
    try {
      const params = new URLSearchParams(liffState.startsWith("?") ? liffState.slice(1) : liffState);
      return (params.get("assignment_id") ?? "").trim();
    } catch {
      return "";
    }
  })();
  if (assignmentId) {
    res.redirect(302, `/liff/survey?assignment_id=${encodeURIComponent(assignmentId)}`);
    return;
  }

  const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(302, `/liff/projects${qs}`);
});

liffRoutes.get("/rant", asyncHandler(liffController.rantPage));
liffRoutes.get("/diary", asyncHandler(liffController.diaryPage));
liffRoutes.get("/personality", asyncHandler(liffController.personalityPage));
liffRoutes.get("/mypage", asyncHandler(liffController.mypagePage));
liffRoutes.get("/profile/check", asyncHandler(liffController.profileCheckPage));
liffRoutes.get("/profile-check-data", asyncHandler(liffController.getProfileCheckData));

liffRoutes.post("/posts", asyncHandler(liffController.createPost));
liffRoutes.get("/personality-data", asyncHandler(liffController.personalityData));
liffRoutes.get("/profile-status", asyncHandler(liffController.getProfileStatus));
liffRoutes.get("/mypage-data", asyncHandler(liffController.getMypageData));
liffRoutes.post("/mypage-data", asyncHandler(liffController.updateMypageData));
liffRoutes.get("/history-data", asyncHandler(liffController.getHistoryData));
liffRoutes.get("/points-data", asyncHandler(liffController.getPointsData));
liffRoutes.get("/diary-calendar", asyncHandler(liffController.getDiaryCalendar));

// マイページ確認完了記録
liffRoutes.post("/session/confirm-mypage", asyncHandler(liffController.confirmMypage));

// Survey / Interview (新スキーマ対応)
// NOTE: /survey/answer, /survey/complete, /survey/verify-identity は
//       /survey/:assignmentId よりも先に定義しないとルーティングが衝突する
liffRoutes.post("/chat", asyncHandler(liffController.chatMessage));
liffRoutes.post("/survey/answer", asyncHandler(liffController.submitSurveyAnswer));
liffRoutes.post("/survey/complete", asyncHandler(liffController.completeSurvey));
liffRoutes.post("/survey/upload-image", asyncHandler(liffController.uploadRespondentImage));
// LIFF ID token による本人確認エンドポイント
// LINE Developers 側の LINE_LIFF_CHANNEL_ID + LINE_LIFF_ID_SURVEY 設定後に有効になる
liffRoutes.post("/survey/verify-identity", asyncHandler(liffController.verifyIdentity));
// 回答完了確定API: サーバー側で完了判定・ポイント付与・LINE通知を行う
liffRoutes.post("/survey/:assignmentId/complete", asyncHandler(liffController.completeSurveyByAssignment));
// スクリーニング判定API
liffRoutes.post("/survey/:assignmentId/judge-screening", asyncHandler(liffController.judgeScreening));
// サーバー権威の次設問解決API（初回・再開用。Phase2 クライアントが消費）
liffRoutes.get("/survey/:assignmentId/next", asyncHandler(liffController.getSurveyNext));
liffRoutes.get("/survey/:assignmentId", asyncHandler(liffController.surveyPage));
liffRoutes.get("/survey", asyncHandler(liffController.surveyPage));

liffRoutes.get("/contact", asyncHandler(liffController.contactPage));
liffRoutes.post("/contact", asyncHandler(liffController.submitContact));

// デイリーアンケート
liffRoutes.get("/daily-survey", asyncHandler(liffController.dailySurveyPage));
liffRoutes.get("/daily-survey-data", asyncHandler(liffController.getDailySurveyData));
// 案件一覧の最上部に出す「今日の1問」。どれを出すかはサーバーが決める。
liffRoutes.get("/daily-surveys-today", asyncHandler(liffController.getTodayDailySurveys));
liffRoutes.post("/daily-survey/:surveyId/answer", asyncHandler(liffController.submitDailySurveyAnswer));

// 店舗専用アンケート流入（専用URL / QR）
liffRoutes.get("/store", asyncHandler(liffController.storeEntryPage));
liffRoutes.post("/store/resolve", asyncHandler(liffController.resolveStoreEntry));

// 案件一覧・詳細・保存・やりとり
// NOTE: /projects/:id の静的セグメントより先に定義
liffRoutes.get("/projects", asyncHandler(liffController.projectsPage));
liffRoutes.get("/projects-data", asyncHandler(liffController.getProjectsData));
liffRoutes.get("/projects/:id/data", asyncHandler(liffController.getProjectDetailData));
liffRoutes.post("/projects/:id/favorite", asyncHandler(liffController.toggleProjectFavorite));
liffRoutes.post("/projects/:id/apply", asyncHandler(liffController.applyToProject));
liffRoutes.post("/projects/:id/withdraw", asyncHandler(liffController.withdrawApplication));
liffRoutes.get("/projects/:id", asyncHandler(liffController.projectDetailPage));
liffRoutes.get("/saved-projects", asyncHandler(liffController.savedProjectsPage));
liffRoutes.get("/saved-projects-data", asyncHandler(liffController.getSavedProjectsData));
liffRoutes.get("/interactions", asyncHandler(liffController.interactionsPage));
liffRoutes.get("/interactions-data", asyncHandler(liffController.getInteractionsData));

// ポイント交換申請
liffRoutes.post("/exchange-requests",             asyncHandler(liffController.requestExchange));
liffRoutes.post("/exchange-requests/:id/cancel",  asyncHandler(liffController.cancelExchange));

// 書類・同意管理
liffRoutes.get("/consent",                asyncHandler(liffController.consentPage));
liffRoutes.get("/consent-check",          asyncHandler(liffController.getConsentCheck));
liffRoutes.post("/consent-submit",        asyncHandler(liffController.submitConsents));
liffRoutes.get("/consent-statuses",       asyncHandler(liffController.getConsentStatuses));
liffRoutes.get("/documents/:documentId",  asyncHandler(liffController.getDocumentContent));
