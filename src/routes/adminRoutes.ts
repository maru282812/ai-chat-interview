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
adminRoutes.post("/projects/:projectId/copy", asyncHandler(adminController.copyProject));
adminRoutes.post("/projects/:projectId/delete", asyncHandler(adminController.deleteProject));

adminRoutes.get("/projects/:projectId/questions", asyncHandler(adminController.questions));
adminRoutes.get("/projects/:projectId/questions/flow", asyncHandler(adminController.questionFlow));
adminRoutes.get("/projects/:projectId/questions/new", asyncHandler(adminController.newQuestion));
adminRoutes.post("/projects/:projectId/questions", asyncHandler(adminController.createQuestion));
adminRoutes.get("/projects/:projectId/respondents", asyncHandler(adminController.projectRespondents));
adminRoutes.get("/projects/:projectId/delivery", asyncHandler(adminController.projectDelivery));
adminRoutes.post(
  "/projects/:projectId/delivery/manual",
  asyncHandler(adminController.assignProjectManual)
);
adminRoutes.post(
  "/projects/:projectId/delivery/rules",
  asyncHandler(adminController.assignProjectByRules)
);
adminRoutes.post(
  "/projects/:projectId/delivery/reminders",
  asyncHandler(adminController.sendProjectReminders)
);
adminRoutes.get("/projects/:projectId/analysis", asyncHandler(adminController.projectAnalysis));
adminRoutes.post("/projects/:projectId/analysis", asyncHandler(adminController.runProjectAnalysis));
adminRoutes.get(
  "/projects/:projectId/exports/respondents.csv",
  asyncHandler(adminController.exportProjectRespondents)
);
adminRoutes.get(
  "/projects/:projectId/exports/assignments.csv",
  asyncHandler(adminController.exportProjectAssignments)
);
adminRoutes.get(
  "/projects/:projectId/exports/unanswered.csv",
  asyncHandler(adminController.exportProjectUnansweredAssignments)
);
adminRoutes.get(
  "/projects/:projectId/exports/expired.csv",
  asyncHandler(adminController.exportProjectExpiredAssignments)
);
adminRoutes.get("/questions/:questionId/edit", asyncHandler(adminController.editQuestion));
adminRoutes.post("/questions/:questionId", asyncHandler(adminController.updateQuestion));

adminRoutes.get("/respondents", asyncHandler(adminController.respondents));
adminRoutes.get("/respondents/:respondentId", asyncHandler(adminController.respondentDetail));
adminRoutes.get("/sessions/:sessionId", asyncHandler(adminController.sessionDetail));
adminRoutes.post("/respondents/:respondentId/points", asyncHandler(adminController.adjustPoints));
adminRoutes.get("/posts", asyncHandler(adminController.posts));
adminRoutes.get("/posts/:postId", asyncHandler(adminController.postDetail));
adminRoutes.get("/post-analysis", asyncHandler(adminController.postAnalysis));

adminRoutes.get("/points", asyncHandler(adminController.points));
adminRoutes.get("/ranks", asyncHandler(adminController.ranks));
adminRoutes.post("/ranks/:rankId", asyncHandler(adminController.updateRank));

adminRoutes.get("/exports/answers.csv", asyncHandler(adminController.exportAnswers));
adminRoutes.get("/exports/messages.csv", asyncHandler(adminController.exportMessages));
adminRoutes.get("/exports/analysis.csv", asyncHandler(adminController.exportAnalysis));
adminRoutes.get("/exports/points.csv", asyncHandler(adminController.exportPoints));
adminRoutes.get("/exports/ranks.csv", asyncHandler(adminController.exportRanks));
adminRoutes.get("/exports/user-posts.csv", asyncHandler(adminController.exportUserPosts));
adminRoutes.get("/exports/post-analysis.csv", asyncHandler(adminController.exportPostAnalysis));

// ページグループ管理 (survey_page モード)
adminRoutes.get("/projects/:projectId/page-groups",           asyncHandler(adminController.listPageGroups));
adminRoutes.post("/projects/:projectId/page-groups",          asyncHandler(adminController.createPageGroup));
adminRoutes.post("/projects/:projectId/page-groups/:pageGroupId", asyncHandler(adminController.updatePageGroup));
adminRoutes.post("/projects/:projectId/page-groups/:pageGroupId/delete", asyncHandler(adminController.deletePageGroup));

// Tag API (formV3.ejs から呼び出される)
adminRoutes.post("/api/parse-tags",    asyncHandler(adminController.parseTagsApi));
adminRoutes.post("/api/generate-tags", asyncHandler(adminController.generateTagsApi));

// フローデザイナー用 JSON API
adminRoutes.post("/api/questions/:questionId",                 asyncHandler(adminController.apiUpdateQuestionFlow));
adminRoutes.post("/api/questions/:questionId/delete",          asyncHandler(adminController.apiDeleteQuestion));
adminRoutes.post("/api/questions/:questionId/suggest-options", asyncHandler(adminController.apiSuggestAnswerOptions));
adminRoutes.post("/api/projects/:projectId/questions",         asyncHandler(adminController.apiCreateQuestionFlow));

// フロー流用・自動生成 API
adminRoutes.get("/api/projects-for-import",                               asyncHandler(adminController.apiListProjectsForImport));
adminRoutes.get("/api/projects/:sourceProjectId/flow-preview",            asyncHandler(adminController.apiGetProjectFlowPreview));
adminRoutes.post("/api/projects/:projectId/flow/import-from-project",     asyncHandler(adminController.apiImportFlowFromProject));
adminRoutes.post("/api/projects/:projectId/flow/generate",                asyncHandler(adminController.apiGenerateFlow));
adminRoutes.get("/api/projects/:projectId/option-sets",                   asyncHandler(adminController.apiGetOptionSets));

// 画像アップロード
adminRoutes.post("/api/upload/image", asyncHandler(adminController.uploadImage));
