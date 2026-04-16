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
