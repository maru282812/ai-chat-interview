import { Router } from "express";
import { liffController } from "../controllers/liffController";
import { asyncHandler } from "../lib/http";

export const liffRoutes = Router();

// サイトの玄関。LIFF endpoint を {APP_BASE_URL}/liff に設定すると、
// リッチメニュー等の https://liff.line.me/{id}/projects 形式のディープリンクが
// そのまま各ページに解決される。無印(パス無し)で開かれたら「探す」へ送る。
liffRoutes.get("/", (req, res) => {
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
