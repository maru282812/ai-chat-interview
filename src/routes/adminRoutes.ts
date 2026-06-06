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
adminRoutes.post("/user-points/:lineUserId/adjust", asyncHandler(adminController.adjustUserPoints));
adminRoutes.get("/badges", asyncHandler(adminController.badgesPage));
adminRoutes.patch("/badges/:badgeId/status", asyncHandler(adminController.updateBadgeStatus));
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

// Phase 2-B: 属性管理
adminRoutes.get("/attributes", asyncHandler(adminController.attributesPage));
adminRoutes.post("/attributes/definitions", asyncHandler(adminController.createAttributeDefinition));
adminRoutes.post("/attributes/definitions/:defId/delete", asyncHandler(adminController.deleteAttributeDefinition));

// Phase 2-B: セグメント管理
adminRoutes.get("/segments", asyncHandler(adminController.segmentsPage));
adminRoutes.get("/segments/new", asyncHandler(adminController.newSegmentPage));
adminRoutes.post("/segments", asyncHandler(adminController.createSegment));
// Phase 2-D: キャンペーン管理（静的パスを :segmentId より先に定義）
adminRoutes.get("/segments/campaigns", asyncHandler(adminController.campaignsPage));
adminRoutes.get("/segments/campaigns/new", asyncHandler(adminController.newCampaignPage));
adminRoutes.post("/segments/campaigns", asyncHandler(adminController.createCampaign));
adminRoutes.get("/segments/campaigns/:campaignId/edit", asyncHandler(adminController.editCampaignPage));
adminRoutes.post("/segments/campaigns/:campaignId", asyncHandler(adminController.updateCampaign));
adminRoutes.post("/segments/campaigns/:campaignId/cancel", asyncHandler(adminController.cancelCampaign));
adminRoutes.post("/api/campaigns/:campaignId/execute", asyncHandler(adminController.executeCampaign));
// 動的パスは静的パスの後
adminRoutes.get("/segments/:segmentId/edit", asyncHandler(adminController.editSegmentPage));
adminRoutes.post("/segments/:segmentId", asyncHandler(adminController.updateSegment));
adminRoutes.post("/segments/:segmentId/delete", asyncHandler(adminController.deleteSegment));
adminRoutes.post("/api/segments/preview", asyncHandler(adminController.previewSegment));
adminRoutes.post("/api/segments/:segmentId/evaluate", asyncHandler(adminController.evaluateSegment));

// Phase 2-B: AI分析ダッシュボード
adminRoutes.get("/ai-analysis", asyncHandler(adminController.aiAnalysisPage));

// Phase 2-C: AI拡張分析
adminRoutes.get("/ai-analysis/report", asyncHandler(adminController.aiReportPage));
adminRoutes.post("/api/ai/analyze-post/:postId", asyncHandler(adminController.runExtendedPostAnalysis));
adminRoutes.post("/api/ai/generate-user-tags/:respondentId", asyncHandler(adminController.runUserTagGeneration));

// Phase 2-D: データ管理（NGワード・カテゴリ）
adminRoutes.get("/data-management", asyncHandler(adminController.dataManagementPage));
adminRoutes.post("/data-management/ng-words", asyncHandler(adminController.createNgWord));
adminRoutes.post("/data-management/ng-words/:id/toggle", asyncHandler(adminController.toggleNgWord));
adminRoutes.post("/data-management/ng-words/:id/delete", asyncHandler(adminController.deleteNgWord));
adminRoutes.post("/data-management/categories", asyncHandler(adminController.createCategory));
adminRoutes.post("/data-management/categories/:id/toggle", asyncHandler(adminController.toggleCategory));
adminRoutes.post("/data-management/categories/:id/delete", asyncHandler(adminController.deleteCategory));

// スクリーニング条件管理
adminRoutes.get("/projects/:projectId/screening", asyncHandler(adminController.screeningPage));
adminRoutes.post("/projects/:projectId/screening/conditions", asyncHandler(adminController.addScreeningCondition));
adminRoutes.post("/projects/:projectId/screening/conditions/:condId/delete", asyncHandler(adminController.deleteScreeningCondition));

// USERプロファイル管理（簡易パスワード認証付き）
adminRoutes.get("/user-profiles/login", asyncHandler(adminController.userProfilesLoginPage));
adminRoutes.post("/user-profiles/login", asyncHandler(adminController.userProfilesLogin));
adminRoutes.post("/user-profiles/logout", asyncHandler(adminController.userProfilesLogout));
adminRoutes.get("/user-profiles", asyncHandler(adminController.userProfilesAdmin));

// 通知テンプレート管理
adminRoutes.get("/notification-templates", asyncHandler(adminController.notificationTemplates));
adminRoutes.get("/notification-templates/new", asyncHandler(adminController.newNotificationTemplate));
adminRoutes.post("/notification-templates", asyncHandler(adminController.createNotificationTemplate));
adminRoutes.get("/notification-templates/:templateId/edit", asyncHandler(adminController.editNotificationTemplate));
adminRoutes.post("/notification-templates/:templateId", asyncHandler(adminController.updateNotificationTemplate));
adminRoutes.post("/notification-templates/:templateId/delete", asyncHandler(adminController.deleteNotificationTemplate));
adminRoutes.post("/notification-templates/:templateId/toggle-active", asyncHandler(adminController.toggleNotificationTemplateActive));
adminRoutes.post("/notification-templates/:templateId/set-default", asyncHandler(adminController.setNotificationTemplateDefault));

// 通知スケジューラ設定
adminRoutes.get("/scheduler-settings", asyncHandler(adminController.schedulerSettings));
adminRoutes.post("/scheduler-settings", asyncHandler(adminController.updateSchedulerSettings));
adminRoutes.post("/scheduler-settings/run/:job", asyncHandler(adminController.runSchedulerJob));

// 報酬キャンペーン管理
adminRoutes.get("/reward-campaigns", asyncHandler(adminController.rewardCampaigns));
adminRoutes.get("/reward-campaigns/new", asyncHandler(adminController.newRewardCampaign));
adminRoutes.post("/reward-campaigns", asyncHandler(adminController.createRewardCampaign));
adminRoutes.get("/reward-campaigns/:id/edit", asyncHandler(adminController.editRewardCampaign));
adminRoutes.post("/reward-campaigns/:id", asyncHandler(adminController.updateRewardCampaign));
adminRoutes.post("/reward-campaigns/:id/delete", asyncHandler(adminController.deleteRewardCampaign));
adminRoutes.post("/reward-campaigns/:id/toggle", asyncHandler(adminController.toggleRewardCampaign));

// デイリー設問優先度管理
adminRoutes.get("/daily-question-priorities", asyncHandler(adminController.dailyQuestionPriorities));
adminRoutes.get("/daily-question-priorities/new", asyncHandler(adminController.newDailyQuestionPriority));
adminRoutes.post("/daily-question-priorities", asyncHandler(adminController.createDailyQuestionPriority));
adminRoutes.get("/daily-question-priorities/:id/edit", asyncHandler(adminController.editDailyQuestionPriority));
adminRoutes.post("/daily-question-priorities/:id", asyncHandler(adminController.updateDailyQuestionPriority));
adminRoutes.post("/daily-question-priorities/:id/delete", asyncHandler(adminController.deleteDailyQuestionPriority));
adminRoutes.post("/daily-question-priorities/:id/toggle", asyncHandler(adminController.toggleDailyQuestionPriority));

// デイリーアンケート管理
adminRoutes.get("/daily-surveys", asyncHandler(adminController.dailySurveys));
adminRoutes.get("/daily-surveys/new", asyncHandler(adminController.newDailySurvey));
adminRoutes.post("/daily-surveys", asyncHandler(adminController.createDailySurvey));
adminRoutes.get("/daily-surveys/:surveyId", asyncHandler(adminController.showDailySurvey));
adminRoutes.get("/daily-surveys/:surveyId/analytics", asyncHandler(adminController.dailySurveyAnalytics));
adminRoutes.get("/daily-surveys/:surveyId/edit", asyncHandler(adminController.editDailySurvey));
adminRoutes.post("/daily-surveys/:surveyId", asyncHandler(adminController.updateDailySurvey));
adminRoutes.post("/daily-surveys/:surveyId/delete", asyncHandler(adminController.deleteDailySurvey));
adminRoutes.post("/daily-surveys/:surveyId/status/:action", asyncHandler(adminController.updateDailySurveyStatus));
adminRoutes.post("/daily-surveys/:surveyId/deliver", asyncHandler(adminController.deliverDailySurvey));
adminRoutes.post("/daily-surveys/:surveyId/questions", asyncHandler(adminController.createDailySurveyQuestion));
adminRoutes.post("/daily-surveys/:surveyId/questions/:questionId", asyncHandler(adminController.updateDailySurveyQuestion));
adminRoutes.post("/daily-surveys/:surveyId/questions/:questionId/delete", asyncHandler(adminController.deleteDailySurveyQuestion));

// AI 不足属性自動判定 API
adminRoutes.get("/api/missing-attributes/coverage", asyncHandler(adminController.apiMissingAttributeCoverage));
adminRoutes.get("/api/missing-attributes/suggest", asyncHandler(adminController.apiMissingAttributeSuggest));

// 配信テンプレート管理
adminRoutes.get("/delivery-templates",                       asyncHandler(adminController.listDeliveryTemplates));
adminRoutes.get("/delivery-templates/new",                   asyncHandler(adminController.newDeliveryTemplate));
adminRoutes.post("/delivery-templates",                      asyncHandler(adminController.createDeliveryTemplate));
adminRoutes.get("/delivery-templates/:id/edit",              asyncHandler(adminController.editDeliveryTemplate));
adminRoutes.post("/delivery-templates/:id",                  asyncHandler(adminController.updateDeliveryTemplate));
adminRoutes.post("/delivery-templates/:id/delete",           asyncHandler(adminController.deleteDeliveryTemplate));
adminRoutes.post("/delivery-templates/:id/run",              asyncHandler(adminController.runDeliveryTemplate));

// 配信オペレーション
adminRoutes.get("/delivery-operations",                      asyncHandler(adminController.deliveryOperationsPage));
adminRoutes.post("/api/delivery-operations/update-project",  asyncHandler(adminController.apiDeliveryOperationsUpdateProject));

// 書類管理
adminRoutes.get("/documents",                                     asyncHandler(adminController.documentsList));
adminRoutes.get("/documents/new",                                 asyncHandler(adminController.newDocumentPage));
adminRoutes.post("/documents",                                    asyncHandler(adminController.createDocument));
adminRoutes.get("/documents/exports/consents.csv",                asyncHandler(adminController.exportDocumentConsents));
adminRoutes.get("/documents/:documentId",                         asyncHandler(adminController.showDocument));
adminRoutes.get("/documents/:documentId/edit",                    asyncHandler(adminController.editDocumentPage));
adminRoutes.post("/documents/:documentId",                        asyncHandler(adminController.updateDocument));
adminRoutes.get("/documents/:documentId/versions/new",            asyncHandler(adminController.newDocumentVersionPage));
adminRoutes.post("/documents/:documentId/versions",               asyncHandler(adminController.createDocumentVersion));
adminRoutes.get("/documents/:documentId/consent-audit",           asyncHandler(adminController.documentConsentAudit));
