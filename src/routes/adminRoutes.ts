import { Router } from "express";
import { adminController } from "../controllers/adminController";
import { asyncHandler } from "../lib/http";

export const adminRoutes = Router();

adminRoutes.get("/", asyncHandler(adminController.dashboard));

adminRoutes.get("/projects", asyncHandler(adminController.projects));
adminRoutes.get("/projects/new", asyncHandler(adminController.newProject));
adminRoutes.post("/projects", asyncHandler(adminController.createProject));
adminRoutes.get("/projects/:projectId/edit", asyncHandler(adminController.editProject));
adminRoutes.post("/projects/:projectId", asyncHandler(adminController.updateProject));

adminRoutes.get("/projects/:projectId/questions", asyncHandler(adminController.questions));
adminRoutes.get("/projects/:projectId/questions/new", asyncHandler(adminController.newQuestion));
adminRoutes.post("/projects/:projectId/questions", asyncHandler(adminController.createQuestion));
adminRoutes.get("/questions/:questionId/edit", asyncHandler(adminController.editQuestion));
adminRoutes.post("/questions/:questionId", asyncHandler(adminController.updateQuestion));

adminRoutes.get("/respondents", asyncHandler(adminController.respondents));
adminRoutes.get("/respondents/:respondentId", asyncHandler(adminController.respondentDetail));
adminRoutes.post("/respondents/:respondentId/points", asyncHandler(adminController.adjustPoints));

adminRoutes.get("/points", asyncHandler(adminController.points));
adminRoutes.get("/ranks", asyncHandler(adminController.ranks));
adminRoutes.post("/ranks/:rankId", asyncHandler(adminController.updateRank));

adminRoutes.get("/exports/answers.csv", asyncHandler(adminController.exportAnswers));
adminRoutes.get("/exports/messages.csv", asyncHandler(adminController.exportMessages));
adminRoutes.get("/exports/analysis.csv", asyncHandler(adminController.exportAnalysis));
adminRoutes.get("/exports/points.csv", asyncHandler(adminController.exportPoints));
adminRoutes.get("/exports/ranks.csv", asyncHandler(adminController.exportRanks));
