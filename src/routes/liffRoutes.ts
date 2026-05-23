import { Router } from "express";
import { liffController } from "../controllers/liffController";
import { asyncHandler } from "../lib/http";

export const liffRoutes = Router();

liffRoutes.get("/rant", asyncHandler(liffController.rantPage));
liffRoutes.get("/diary", asyncHandler(liffController.diaryPage));
liffRoutes.get("/personality", asyncHandler(liffController.personalityPage));
liffRoutes.get("/mypage", asyncHandler(liffController.mypagePage));

liffRoutes.post("/posts", asyncHandler(liffController.createPost));
liffRoutes.get("/personality-data", asyncHandler(liffController.personalityData));
liffRoutes.get("/profile-status", asyncHandler(liffController.getProfileStatus));
liffRoutes.get("/mypage-data", asyncHandler(liffController.getMypageData));
liffRoutes.post("/mypage-data", asyncHandler(liffController.updateMypageData));
liffRoutes.get("/history-data", asyncHandler(liffController.getHistoryData));
liffRoutes.get("/points-data", asyncHandler(liffController.getPointsData));
liffRoutes.get("/consent-data", asyncHandler(liffController.getConsentData));
liffRoutes.post("/consent-data", asyncHandler(liffController.updateConsentData));
liffRoutes.get("/diary-calendar", asyncHandler(liffController.getDiaryCalendar));

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
liffRoutes.get("/survey/:assignmentId", asyncHandler(liffController.surveyPage));
liffRoutes.get("/survey", asyncHandler(liffController.surveyPage));

liffRoutes.get("/contact", asyncHandler(liffController.contactPage));
liffRoutes.post("/contact", asyncHandler(liffController.submitContact));
