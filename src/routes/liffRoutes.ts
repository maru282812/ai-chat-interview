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
liffRoutes.get("/mypage-data", asyncHandler(liffController.getMypageData));
liffRoutes.post("/mypage-data", asyncHandler(liffController.updateMypageData));

// Survey / Interview (新スキーマ対応)
// NOTE: /survey/answer, /survey/complete, /survey/verify-identity は
//       /survey/:assignmentId よりも先に定義しないとルーティングが衝突する
liffRoutes.post("/survey/answer", asyncHandler(liffController.submitSurveyAnswer));
liffRoutes.post("/survey/complete", asyncHandler(liffController.completeSurvey));
liffRoutes.post("/survey/upload-image", asyncHandler(liffController.uploadRespondentImage));
// LIFF ID token による本人確認エンドポイント
// LINE Developers 側の LINE_LIFF_CHANNEL_ID + LINE_LIFF_ID_SURVEY 設定後に有効になる
liffRoutes.post("/survey/verify-identity", asyncHandler(liffController.verifyIdentity));
liffRoutes.get("/survey/:assignmentId", asyncHandler(liffController.surveyPage));
liffRoutes.get("/survey", asyncHandler(liffController.surveyPage));
