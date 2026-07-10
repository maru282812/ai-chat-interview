import type { Request, Response } from "express";
import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";
import { env as appEnv } from "../config/env";
import { STORAGE_BUCKET } from "../config/storage";
import {
  getQuestionScaleRange,
  getYesNoLabels,
  normalizeBranchRule,
  normalizeQuestionConfig,
  validateBranchRule,
  validateQuestionConfig
} from "../lib/questionDesign";
import {
  getProjectAIState,
  getProjectAiStateTemplates,
  normalizeProjectAIState
} from "../lib/projectAiState";
import {
  buildExtractionSchemaFromExpectedSlots,
  buildQuestionMetaFromAuthoringInput
} from "../lib/questionMetadata";
import {
  METRIC_CATALOG,
  METRIC_DIRECTIONS,
  defaultMetricDirection,
  metricDirectionLabel,
  normalizeMetricCode,
  normalizeMetricDirection
} from "../lib/metricCatalog";
import { getProjectResearchSettings, parseLineSeparatedList } from "../lib/projectResearch";
import { csvService } from "../services/csvService";
import { statExportService } from "../services/statExportService";
import { snapshotService } from "../services/snapshotService";
import { conceptService } from "../services/conceptService";
import { projectConceptRepository } from "../repositories/projectConceptRepository";
import { blockDesignService, type BlockPlan } from "../services/blockDesignService";
import { validateSurvey } from "../lib/surveyValidation";
import { adminService } from "../services/adminService";
import { pointService } from "../services/pointService";
import { assignmentService, type AssignmentRuleFilter } from "../services/assignmentService";
import { projectRepository } from "../repositories/projectRepository";
import { clientRepository } from "../repositories/clientRepository";
import { projectAssignmentRepository } from "../repositories/projectAssignmentRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import { questionRepository } from "../repositories/questionRepository";
import { collectClientMetrics } from "../lib/aggregationScope";
import { rankRepository } from "../repositories/rankRepository";
import { analysisService } from "../services/analysisService";
import type {
  PostActionability,
  PostInsightType,
  PostSentiment,
  PostSourceChannel,
  Project,
  Question,
  QuestionRole,
  QuestionType,
  ResearchMode
} from "../types/domain";
import { parseDisplayTags, generateTagsFromParsed } from "../lib/tagParser";
import { validateDisplayTags } from "../lib/tagValidator";
import { questionPageGroupRepository } from "../repositories/questionPageGroupRepository";
import { segmentRepository } from "../repositories/segmentRepository";
import { userAttributeRepository } from "../repositories/userAttributeRepository";
import { deliveryCampaignRepository } from "../repositories/deliveryCampaignRepository";
import { dailySurveyService } from "../services/dailySurveyService";
import { dailySurveyRepository } from "../repositories/dailySurveyRepository";
import { notificationTemplateRepository } from "../repositories/notificationTemplateRepository";
import { userPointService } from "../services/userPointService";
import { userBadgeService } from "../services/userBadgeService";
import { notificationSchedulerService } from "../services/notificationSchedulerService";
import { rewardCampaignService } from "../services/rewardCampaignService";
import { dailyQuestionPriorityService } from "../services/dailyQuestionPriorityService";
import { missingAttributeService } from "../services/missingAttributeService";
import { deliveryTemplateRepository } from "../repositories/deliveryTemplateRepository";
import type { DeliveryTemplateMutationInput, DeliveryScheduleType } from "../repositories/deliveryTemplateRepository";
import { projectDeliveryService } from "../services/projectDeliveryService";
import type { DisplayTagsParsed, VisibilityCondition } from "../types/questionSchema";
import { normalizeAIPromptPolicy, resolveAIPromptPolicy, renderPromptPolicySections } from "../prompts/promptPolicies";
import { BASE_PROMPT_TEMPLATES, BUILDER_GENERATION_KEYS, describePlaceholder, describePolicyAxis, buildInitialTemplatesForPreset, PROMPT_PRESETS, PROMPT_KEY_PLACEMENT, PROMPT_FAMILY_LABEL, summarizeTemplateDefinitions, summarizeTemplateDefinitionsByFamily, type BasePromptKey, type PromptPresetKey } from "../prompts/basePromptTemplates";
import { normalizePromptBuilderSpec, buildGenerationMetaPrompt, parseGenerationResult, PROMPT_BUILDER_FIELDS } from "../services/promptBuilderService";
import { diffLines } from "../services/promptPackageDiffService";
import { validatePromptTemplatePlaceholders, extractTemplatePlaceholders, resolveBasePromptTemplate, renderPromptTemplate } from "../prompts/promptTemplateRenderer";
import { aiLogRepository } from "../repositories/aiLogRepository";
import type { AIPromptPolicy, AIPromptTemplateMap, PromptBuilderSpec } from "../types/domain";
import type { ProbePlaygroundMode } from "../services/probePlaygroundService";
import {
  validatePromptPackageVersionConfig,
  validatePromptPackageVersionForPublish,
  validatePromptPackageVersionForApply,
  type PromptPackageValidationResult,
} from "../services/promptPackageValidationService";
import { buildPackageVersionPreview } from "../services/promptPackagePreviewService";
import { runAdminToolPrompt } from "../services/aiService";
import {
  buildSurveyOptionsPrompt,
  buildAdjustQuestionsPrompt,
  buildGenerateFlowPrompt,
} from "../prompts/adminPrompts";
import { applicationService } from "../services/applicationService";
import { projectApplicationRepository } from "../repositories/projectApplicationRepository";
import { lineMessagingService } from "../services/lineMessagingService";
import { buildApplicationAcceptedFlex, buildApplicationRejectedFlex } from "../templates/flex";
import { buildProjectStartUrl } from "../services/liffService";

// USERプロファイル管理の簡易認証設定
const UP_ADMIN_ID = "admin";
const UP_ADMIN_PASS = "password123";
const UP_ADMIN_COOKIE = "upadmin_auth";
const UP_ADMIN_TOKEN = "upadmin_ok_v1";

function upAdminIsAuthenticated(req: Request): boolean {
  const cookieHeader = req.headers.cookie ?? "";
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === UP_ADMIN_COOKIE && part.slice(eq + 1).trim() === UP_ADMIN_TOKEN) {
      return true;
    }
  }
  return false;
}

function routeParam(req: Request, key: string): string {
  const value = req.params[key];
  if (!value) {
    throw new HttpError(400, `Missing route param: ${key}`);
  }
  return Array.isArray(value) ? String(value[0] ?? "") : value;
}

function bodyString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return "";
}

function extractVariables(text: string): string[] {
  const matches = text.match(/\{(\w+)\}/g) ?? [];
  return [...new Set(matches)];
}

function buildConditionValue(b: Record<string, string>): Record<string, unknown> {
  switch (b.condition_type) {
    case "streak_days":
      return { min_streak: Number(b.cond_min_streak ?? 7) };
    case "date_range":
      return { start: b.cond_start || null, end: b.cond_end || null };
    default:
      return {};
  }
}

function parseDqpOptions(raw: string | undefined): Array<{ label: string; value: string }> {
  if (!raw?.trim()) return [];
  try {
    return JSON.parse(raw) as Array<{ label: string; value: string }>;
  } catch {
    return [];
  }
}

// 書類の用途区分。未知値・未指定は安全側の "internal"（非配布）に倒す。
const DOCUMENT_USAGE_CATEGORIES = [
  "consent_global",
  "consent_project",
  "public",
  "b2b_contract",
  "internal",
] as const;
type DocumentUsageCategoryValue = (typeof DOCUMENT_USAGE_CATEGORIES)[number];

function normalizeUsageCategory(value: unknown): DocumentUsageCategoryValue {
  const v = bodyString(value).trim();
  return (DOCUMENT_USAGE_CATEGORIES as readonly string[]).includes(v)
    ? (v as DocumentUsageCategoryValue)
    : "internal";
}

function bodyStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "string" && value.trim()) {
    return [value];
  }
  return [];
}


function parseNullableDateTime(value: unknown): string | null {
  const text = bodyString(value).trim();
  if (!text) {
    return null;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    throw new HttpError(400, "deadline is invalid");
  }
  return date.toISOString();
}

function parseOptionalNumber(value: unknown): number | null {
  const text = bodyString(value).trim();
  if (!text) {
    return null;
  }
  const numeric = Number(text);
  if (!Number.isFinite(numeric)) {
    throw new HttpError(400, "number field is invalid");
  }
  return numeric;
}

function parseBooleanSelect(value: unknown): boolean | null {
  const text = bodyString(value).trim();
  if (text === "true") {
    return true;
  }
  if (text === "false") {
    return false;
  }
  return null;
}

function parseOptionalInteger(value: unknown): number | null {
  const numeric = parseOptionalNumber(value);
  return numeric === null ? null : Math.round(numeric);
}

function queryString(value: unknown): string {
  return bodyString(value).trim();
}


function resolveNoticeMessage(value: unknown): string | null {
  switch (queryString(value)) {
    case "project_created":
      return "プロジェクトを作成しました。";
    case "project_updated":
      return "プロジェクトを更新しました。";
    case "project_copied":
      return "プロジェクトをコピーしました。";
    case "project_deleted":
      return "プロジェクトを削除しました。";
    case "project_archived":
      return "回答履歴があるため、プロジェクトを archived に変更しました。";
    case "prompt_package_unset":
      return "プロジェクトを作成しました。プロンプトパッケージが未選択のため、公開済みパッケージ・バージョンを選択してください（未選択のままだと既定プロンプトで動作します）。";
    default:
      return null;
  }
}

function buildProjectEditRedirectPath(
  projectId: string,
  notice: "project_created" | "project_updated" | "project_copied"
): string {
  return `/admin/projects/${projectId}/edit?notice=${notice}`;
}

function renderProjectsIndex(
  res: Response,
  input: {
    projects: Awaited<ReturnType<typeof adminService.listProjects>>;
    notice?: unknown;
  }
): void {
  res.render("admin/projects/indexDesigner", {
    title: "プロジェクト一覧",
    projects: input.projects,
    noticeMessage: resolveNoticeMessage(input.notice)
  });
}

function parsePostTypeFilter(value: unknown): "free_comment" | "rant" | "diary" | null {
  const text = queryString(value);
  if (text === "free_comment" || text === "rant" || text === "diary") {
    return text;
  }
  return null;
}

function parseSourceChannelFilter(value: unknown): PostSourceChannel | null {
  const text = queryString(value);
  if (text === "line" || text === "liff" || text === "admin" || text === "system") {
    return text;
  }
  return null;
}

function parseAnalysisStatus(value: unknown): "analyzed" | "pending" | null {
  const text = queryString(value);
  if (text === "analyzed" || text === "pending") {
    return text;
  }
  return null;
}

function parseSentiment(value: unknown): PostSentiment | null {
  const text = queryString(value);
  if (text === "positive" || text === "neutral" || text === "negative" || text === "mixed") {
    return text;
  }
  return null;
}

function parseActionability(value: unknown): PostActionability | null {
  const text = queryString(value);
  if (text === "high" || text === "medium" || text === "low") {
    return text;
  }
  return null;
}

function parseInsightType(value: unknown): PostInsightType | null {
  const text = queryString(value);
  if (
    text === "issue" ||
    text === "request" ||
    text === "complaint" ||
    text === "praise" ||
    text === "other"
  ) {
    return text;
  }
  return null;
}

function buildPostFilters(req: Request) {
  return {
    type: parsePostTypeFilter(req.query.type),
    search: queryString(req.query.search) || null,
    projectId: queryString(req.query.project_id) || null,
    userId: queryString(req.query.user_id) || null,
    sourceChannel: parseSourceChannelFilter(req.query.source_channel),
    analysisStatus: parseAnalysisStatus(req.query.analysis_status),
    qualityScoreMin: parseOptionalInteger(req.query.quality_score_min),
    qualityScoreMax: parseOptionalInteger(req.query.quality_score_max),
    sentiment: parseSentiment(req.query.sentiment),
    insightType: parseInsightType(req.query.insight_type),
    dateFrom: queryString(req.query.date_from) || null,
    dateTo: queryString(req.query.date_to) || null
  };
}

function buildPostAnalysisFilters(req: Request) {
  return {
    ...buildPostFilters(req),
    actionability: parseActionability(req.query.actionability),
    tag: queryString(req.query.tag) || null,
    keyword: queryString(req.query.keyword) || null
  };
}

function buildScreeningConfig(req: Request): import("../types/domain").ScreeningConfig {
  return {
    enabled: req.body.screening_enabled === "1",
    pass_message: bodyString(req.body.screening_pass_message).trim() || null,
    fail_message: bodyString(req.body.screening_fail_message).trim() || null
  };
}

interface ProfileConditionsState {
  age: { enabled: boolean; min: number | null; max: number | null };
  gender: { enabled: boolean; allowed: string[] };
  occupation: { enabled: boolean; allowed: string[] };
  industry: { enabled: boolean; allowed: string[] };
  marital_status: { enabled: boolean; allowed: string[] };
  has_children: { enabled: boolean; allowed: string[] };
  prefecture: { enabled: boolean; allowed: string[] };
}

type ProfileConditionRow = {
  condition_type: "profile";
  target_key: string;
  operator: import("../types/domain").ScreeningOperator;
  value_json: unknown;
  priority: number;
};

function buildProfileConditionsFromRequest(req: Request): ProfileConditionRow[] {
  const rows: ProfileConditionRow[] = [];

  if (req.body.profile_cond_age_enabled === "1") {
    const min = parseOptionalInteger(req.body.profile_cond_age_min);
    const max = parseOptionalInteger(req.body.profile_cond_age_max);
    if (min !== null && max !== null) {
      rows.push({ condition_type: "profile", target_key: "age", operator: "between", value_json: [min, max], priority: 0 });
    } else if (min !== null) {
      rows.push({ condition_type: "profile", target_key: "age", operator: "gte", value_json: min, priority: 0 });
    } else if (max !== null) {
      rows.push({ condition_type: "profile", target_key: "age", operator: "lte", value_json: max, priority: 0 });
    }
  }

  for (const key of ["gender", "occupation", "industry", "marital_status", "prefecture"] as const) {
    if (req.body[`profile_cond_${key}_enabled`] === "1") {
      const vals = bodyStringArray(req.body[`profile_cond_${key}_values`]).filter(Boolean);
      // 値未選択でも enabled 状態を保持するため空配列で保存する。
      // value_json=[] の "in" 条件は screeningService 側で全員通過とみなす。
      rows.push({ condition_type: "profile", target_key: key, operator: "in", value_json: vals, priority: 0 });
    }
  }

  if (req.body.profile_cond_has_children_enabled === "1") {
    const rawVals = [...new Set(bodyStringArray(req.body.profile_cond_has_children_values).filter(Boolean))];
    const boolVals = rawVals.map(v => v === "true");
    if (boolVals.length === 1) {
      rows.push({ condition_type: "profile", target_key: "has_children", operator: "equals", value_json: boolVals[0], priority: 0 });
    } else if (boolVals.length > 1) {
      rows.push({ condition_type: "profile", target_key: "has_children", operator: "in", value_json: boolVals, priority: 0 });
    } else {
      // 値未選択でも enabled 状態を保持するため空配列で保存する
      rows.push({ condition_type: "profile", target_key: "has_children", operator: "in", value_json: [], priority: 0 });
    }
  }

  return rows;
}

function parseProfileConditionsForRender(
  conditions: import("../types/domain").ScreeningCondition[]
): ProfileConditionsState {
  const s: ProfileConditionsState = {
    age: { enabled: false, min: null, max: null },
    gender: { enabled: false, allowed: [] },
    occupation: { enabled: false, allowed: [] },
    industry: { enabled: false, allowed: [] },
    marital_status: { enabled: false, allowed: [] },
    has_children: { enabled: false, allowed: [] },
    prefecture: { enabled: false, allowed: [] }
  };
  for (const c of conditions.filter(c => c.condition_type === "profile")) {
    if (c.target_key === "age") {
      s.age.enabled = true;
      const toAgeNum = (v: unknown): number | null => {
        const n = Number(v);
        return Number.isFinite(n) ? n : null;
      };
      if (c.operator === "gte") s.age.min = toAgeNum(c.value_json);
      else if (c.operator === "lte") s.age.max = toAgeNum(c.value_json);
      else if (c.operator === "between" && Array.isArray(c.value_json)) {
        s.age.min = toAgeNum(c.value_json[0]);
        s.age.max = toAgeNum(c.value_json[1]);
      }
    } else if (c.target_key === "has_children") {
      s.has_children.enabled = true;
      const vals = Array.isArray(c.value_json) ? c.value_json : [c.value_json];
      s.has_children.allowed = vals.map(String);
    } else if (c.target_key in s) {
      const key = c.target_key as keyof Omit<ProfileConditionsState, "age" | "has_children">;
      s[key].enabled = true;
      const vals = Array.isArray(c.value_json) ? c.value_json : [c.value_json];
      s[key].allowed = vals.map(String);
    }
  }
  return s;
}

function parseStringListField(value: unknown): string[] | null {
  const text = bodyString(value).trim();
  if (!text) {
    return null;
  }
  const items = text.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

function parseAssignmentRule(req: Request): AssignmentRuleFilter {
  return {
    rank_code: bodyString(req.body.rank_code) || null,
    total_points_min: parseOptionalNumber(req.body.total_points_min),
    total_points_max: parseOptionalNumber(req.body.total_points_max),
    has_participated: parseBooleanSelect(req.body.has_participated),
    last_participated_before: parseNullableDateTime(req.body.last_participated_before),
    unanswered_project_id: bodyString(req.body.unanswered_project_id) || null,
    age_min: parseOptionalInteger(req.body.age_min),
    age_max: parseOptionalInteger(req.body.age_max),
    prefectures: parseStringListField(req.body.prefectures),
    occupations: parseStringListField(req.body.occupations),
    industries: parseStringListField(req.body.industries),
    marital_statuses: parseStringListField(req.body.marital_statuses) as import("../types/domain").MaritalStatus[] | null,
    has_children: parseBooleanSelect(req.body.has_children),
    household_compositions: parseStringListField(req.body.household_compositions)
  };
}

function numberField(value: unknown, defaultValue = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : defaultValue;
}
function parseResearchMode(value: string): ResearchMode {
  if (value === "survey_interview" || value === "interview") {
    return value;
  }
  return "survey_interview";
}

function parseQuestionRole(value: string): QuestionRole {
  if (
    value === "screening" ||
    value === "main" ||
    value === "probe_trigger" ||
    value === "attribute" ||
    value === "comparison_core" ||
    value === "free_comment"
  ) {
    return value;
  }
  return "main";
}

function parseQuestionType(value: string): QuestionType {
  const VALID: QuestionType[] = [
    "single_choice", "multi_choice",
    "matrix_single", "matrix_multi", "matrix_mixed",
    "free_text_short", "free_text_long",
    "numeric", "image_upload",
    "hidden_single", "hidden_multi",
    "text_with_image", "sd",
  ];
  if (VALID.includes(value as QuestionType)) {
    return value as QuestionType;
  }
  return "free_text_short";
}

type ProjectDisplayStyle = "survey" | "interview";

type ProjectFormOverrides = Partial<{
  name: string;
  user_display_title: string;
  client_name: string;
  objective: string;
  status: string;
  reward_points_text: string;
  research_mode: string;
  comparison_constraints_text: string;
  deep_probe_enabled: boolean;
  max_probe_depth_text: string;
  display_style: ProjectDisplayStyle;
  ai_state_json: Project["ai_state_json"] | null;
  ai_state_generated_at: string | null;
}>;

function parseProjectDisplayStyle(value: string): ProjectDisplayStyle {
  return value === "interview" ? "interview" : "survey";
}

function buildProjectProbePolicyFromSimpleInput(input: {
  deepProbeEnabled: boolean;
  maxProbeDepth: number;
  existing?: Project["probe_policy"] | null;
}): Project["probe_policy"] {
  const enabled = input.deepProbeEnabled && input.maxProbeDepth > 0;
  return {
    enabled,
    conditions: enabled ? ["short_answer", "abstract_answer"] : ["short_answer"],
    max_probes_per_answer: enabled ? input.maxProbeDepth : 0,
    max_probes_per_session: enabled ? Math.max(input.maxProbeDepth, 1) : 0,
    require_question_probe_enabled: true,
    target_question_codes: input.existing?.target_question_codes ?? [],
    blocked_question_codes: input.existing?.blocked_question_codes ?? [],
    short_answer_min_length: input.existing?.short_answer_min_length ?? 10,
    end_conditions:
      input.existing?.end_conditions ?? [
        "answer_sufficient",
        "max_probes_per_answer",
        "max_probes_per_session",
        "question_not_target",
        "question_blocked",
        "user_declined"
      ]
  };
}

function buildProjectResponseStyleFromSimpleInput(displayStyle: ProjectDisplayStyle): Project["response_style"] {
  return {
    channel: "line",
    tone: "natural_japanese",
    max_characters_per_message: displayStyle === "interview" ? 80 : 60,
    max_sentences: displayStyle === "interview" ? 2 : 1
  };
}

function buildProjectForm(project: Project | null, overrides: ProjectFormOverrides = {}) {
  const settings = getProjectResearchSettings(project);
  const name = overrides.name ?? project?.name ?? "";
  const objective = overrides.objective ?? project?.objective ?? "";
  const researchMode = parseResearchMode(overrides.research_mode ?? project?.research_mode ?? "survey_interview");
  const comparisonConstraintsText =
    overrides.comparison_constraints_text ?? settings.comparison_constraints.join("\n");
  const fallbackProject = {
    name,
    objective: objective || null,
    research_mode: researchMode,
    primary_objectives: objective ? [objective] : [],
    secondary_objectives: [],
    ai_state_template_key: project?.ai_state_template_key ?? null
  };
  const aiStateJson =
    overrides.ai_state_json ??
    normalizeProjectAIState(project?.ai_state_json, {
      fallbackTemplateKey: project?.ai_state_template_key ?? null,
      fallbackProject
    });
  const aiState = getProjectAIState({
    ...fallbackProject,
    ai_state_json: aiStateJson,
    ai_state_template_key: project?.ai_state_template_key ?? null
  });
  const deepProbeEnabled =
    overrides.deep_probe_enabled ??
    Boolean((aiState.probe_policy.default_max_probes ?? 0) > 0 || settings.probe_policy.enabled);

  return {
    name,
    user_display_title: overrides.user_display_title ?? project?.user_display_title ?? "",
    client_name: overrides.client_name ?? project?.client_name ?? "",
    objective,
    status: overrides.status ?? project?.status ?? "draft",
    reward_points_text: overrides.reward_points_text ?? String(project?.reward_points ?? 30),
    research_mode: researchMode,
    comparison_constraints_text: comparisonConstraintsText,
    deep_probe_enabled: deepProbeEnabled,
    max_probe_depth_text:
      overrides.max_probe_depth_text ??
      String(
        aiState.probe_policy.default_max_probes ??
          settings.probe_policy.max_probes_per_answer ??
          (deepProbeEnabled ? 1 : 0)
      ),
    display_style:
      overrides.display_style ??
      (researchMode === "interview" || (project?.response_style?.max_sentences ?? 0) > 1 ? "interview" : "survey"),
    ai_state_json: aiStateJson,
    ai_state_generated_at: overrides.ai_state_generated_at ?? project?.ai_state_generated_at ?? null,
    ai_state_summary: aiState
  };
}

function buildProjectFormOverridesFromRequest(req: Request): ProjectFormOverrides {
  return {
    name: bodyString(req.body.name),
    user_display_title: bodyString(req.body.user_display_title),
    client_name: bodyString(req.body.client_name),
    objective: bodyString(req.body.objective),
    status: bodyString(req.body.status) || "draft",
    reward_points_text: bodyString(req.body.reward_points) || "30",
    research_mode: bodyString(req.body.research_mode) || "survey_interview",
    comparison_constraints_text: bodyString(req.body.comparison_constraints),
    deep_probe_enabled: req.body.deep_probe_enabled === "on",
    max_probe_depth_text: bodyString(req.body.max_probe_depth) || "1",
    display_style: parseProjectDisplayStyle(bodyString(req.body.display_style)),
    ai_state_generated_at: null
  };
}

function renderProjectResearchForm(
  res: Response,
  input: {
    title: string;
    project: Project | null;
    action: string;
    projectFormOverrides?: ProjectFormOverrides;
    errorMessage?: string | null;
    successMessage?: string | null;
    templateErrors?: string[];
    templateWarnings?: string[];
    statusCode?: number;
    screeningConditions?: import("../types/domain").ScreeningCondition[];
    screeningQuestions?: import("../types/domain").Question[];
    promptPackages?: import("../repositories/promptPackageRepository").PromptPackage[];
    packageFallbackWarning?: import("../repositories/promptPackageRepository").PromptPackageVersion | null;
  }
): void {
  const projectForm = buildProjectForm(input.project, input.projectFormOverrides ?? {});
  if (typeof input.statusCode === "number") {
    res.status(input.statusCode);
  }

  const allConditions = input.screeningConditions ?? [];
  res.render("admin/projects/researchForm", {
    title: input.title,
    project: input.project,
    action: input.action,
    errorMessage: input.errorMessage ?? null,
    successMessage: input.successMessage ?? null,
    templateErrors: input.templateErrors ?? [],
    templateWarnings: input.templateWarnings ?? [],
    promptKeyDefs: buildPromptKeyDefs(),
    projectAiStateTemplates: getProjectAiStateTemplates(),
    projectForm,
    aiStateDisplay: projectForm.ai_state_summary,
    screeningConditions: allConditions,
    screeningQuestions: input.screeningQuestions ?? [],
    profileConditionsState: parseProfileConditionsForRender(allConditions),
    promptPackages: input.promptPackages ?? [],
    packageFallbackWarning: input.packageFallbackWarning ?? null,
  });
}

function getProjectRenderErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof HttpError && error.message.trim()) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallbackMessage;
}

function getProjectRenderStatusCode(error: unknown): number {
  return error instanceof HttpError ? error.statusCode : 500;
}

function parseAIPromptPolicyFromRequest(req: Request): AIPromptPolicy | null {
  const raw = bodyString(req.body.ai_prompt_policy_json).trim();
  if (!raw) return null;
  try {
    return normalizeAIPromptPolicy(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * フォームから ai_prompt_mode を読み取る。
 * Phase G: フィールド未指定時は fallback を返す。新規作成は 'package'（Package First）、
 * 更新は既存 mode を渡して維持する。
 * Phase B: 既定 fallback を 'package' に（Package First。プロジェクト編集UIはラジオ撤去し hidden 送信）。
 */
function parseAIPromptModeFromRequest(
  req: Request,
  fallback: 'custom' | 'package' = 'package'
): 'custom' | 'package' {
  const val = bodyString(req.body.ai_prompt_mode);
  if (val === 'package') return 'package';
  if (val === 'custom') return 'custom';
  return fallback;
}

/** Basic 認証ヘッダーから操作者（ユーザー名）を取得する。取得できない場合は null */
function resolveAdminOperator(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Basic ")) return null;
  try {
    const decoded = Buffer.from(header.slice(6), "base64").toString("utf8");
    const separator = decoded.indexOf(":");
    return separator > 0 ? decoded.slice(0, separator) : null;
  } catch {
    return null;
  }
}

/**
 * パッケージモード時に ai_prompt_package_version_id を検証して返す。
 * - draft・不正 ID はエラー（適用不可）
 * - archived は適用可能だが警告を返す（実行時に published へ fallback。fallback 先なしは強い警告）
 * Phase C: blockIfUnselected=true（新規作成）かつ適用可能なパッケージが存在する場合、
 *   未選択をエラーにして作成をブロックする（package 中心導線。選択可能パッケージが無い場合のみ許容）。
 */
async function resolvePackageVersionIdFromRequest(
  req: Request,
  mode: 'custom' | 'package',
  options: { blockIfUnselected?: boolean } = {}
): Promise<{ versionId: string | null; errorMessage: string | null; warnings: string[] }> {
  if (mode !== 'package') {
    return { versionId: null, errorMessage: null, warnings: [] };
  }
  const versionId = bodyString(req.body.ai_prompt_package_version_id).trim() || null;
  if (!versionId) {
    // Phase C: 適用可能（公開/アーカイブ）バージョンを持つパッケージが1つでもあれば、
    // 新規作成時は選択必須にしてブロックする。
    if (options.blockIfUnselected) {
      try {
        const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
        const pkgs = await promptPackageRepository.list().catch(() => []);
        const hasSelectable = pkgs.some(
          (p) => Array.isArray(p.selectable_versions) && p.selectable_versions.length > 0
        );
        if (hasSelectable) {
          return {
            versionId: null,
            errorMessage: 'プロンプトパッケージ（公開バージョン）を選択してください。',
            warnings: [],
          };
        }
      } catch {
        // 一覧取得に失敗した場合はブロックせず、従来の警告フローにフォールバックする
      }
    }
    // 適用可能パッケージが無い場合は作成を妨げない（実行時は BASE/legacy にフォールバック）。
    return {
      versionId: null,
      errorMessage: null,
      warnings: ['プロンプトパッケージが未選択です。公開済みパッケージを割り当てるまでは既定プロンプトで動作します。'],
    };
  }
  try {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const version = await promptPackageRepository.getVersionById(versionId);
    const publishedVersion = version && version.status === 'archived'
      ? await promptPackageRepository.getPublishedVersionByPackageId(version.package_id)
      : null;
    const validation = validatePromptPackageVersionForApply(version, publishedVersion);
    if (validation.errors.length > 0) {
      return { versionId: null, errorMessage: validation.errors[0] ?? null, warnings: validation.warnings };
    }
    return { versionId, errorMessage: null, warnings: validation.warnings };
  } catch {
    return { versionId: null, errorMessage: 'パッケージバージョンの検証に失敗しました。', warnings: [] };
  }
}

/**
 * プロジェクトのパッケージ適用が変わった際に変更ログ（FKなしスナップショット）を保存する。
 * slug / version_no はその時点の値を逆引きして記録する。失敗してもメイン処理は止めない。
 * updateProject（プロジェクト編集）と applyPackageToProject（パッケージ画面からの適用）で共用。
 */
async function recordPackageChangeLog(input: {
  projectId: string;
  oldVersionId: string | null;
  newVersionId: string | null;
  oldMode: string | null;
  newMode: 'custom' | 'package';
  changeReason: string | null;
  changedBy: string | null;
}): Promise<void> {
  try {
    const { projectPromptPackageChangeLogRepository } = await import("../repositories/projectPromptPackageChangeLogRepository");
    const { promptPackageRepository: pkgRepo } = await import("../repositories/promptPackageRepository");
    let oldSlug: string | null = null;
    let oldVersionNo: number | null = null;
    let newSlug: string | null = null;
    let newVersionNo: number | null = null;
    if (input.oldVersionId) {
      const oldVer = await pkgRepo.getVersionById(input.oldVersionId).catch(() => null);
      if (oldVer) {
        const oldPkg = await pkgRepo.getById(oldVer.package_id).catch(() => null);
        oldSlug = oldPkg?.slug ?? null;
        oldVersionNo = oldVer.version_no;
      }
    }
    if (input.newVersionId) {
      const newVer = await pkgRepo.getVersionById(input.newVersionId).catch(() => null);
      if (newVer) {
        const newPkg = await pkgRepo.getById(newVer.package_id).catch(() => null);
        newSlug = newPkg?.slug ?? null;
        newVersionNo = newVer.version_no;
      }
    }
    await projectPromptPackageChangeLogRepository.create({
      projectId: input.projectId,
      oldVersionId: input.oldVersionId,
      newVersionId: input.newVersionId,
      oldPackageSlug: oldSlug,
      newPackageSlug: newSlug,
      oldVersionNo,
      newVersionNo,
      oldMode: input.oldMode,
      newMode: input.newMode,
      changeReason: input.changeReason,
      changedBy: input.changedBy,
    });
  } catch (logErr) {
    logger.error("recordPackageChangeLog: failed", {
      projectId: input.projectId,
      error: logErr instanceof Error ? logErr.message : String(logErr),
    });
  }
}

/**
 * パッケージ名から slug を自動生成する。利用者は slug を意識しない（Package First）。
 * 英小文字・数字以外をハイフンに畳み、前後のハイフン/アンダースコアを除去。
 * 日本語のみ等で生成できない場合は安定したフォールバック slug を返す。
 */
export function generatePackageSlug(name: string): string {
  const base = (name || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  if (base) return base;
  return `package-${Date.now().toString(36)}`;
}

/**
 * 既存 slug 集合に対して衝突しない slug を返す（利用者は slug を意識しない）。
 * base が未使用ならそのまま、衝突する場合は base-2, base-3, ... と連番を付ける。
 */
export function resolveUniquePackageSlug(base: string, existingSlugs: Iterable<string>): string {
  const used = new Set(existingSlugs);
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * 「既存パッケージへの Version 追加」のコピー元バージョンを解決する純関数。
 * - copy_published: status === 'published' のバージョン
 * - copy_latest: version_no 降順の先頭（draft を含む最新）
 * - empty（その他）: null（空で作成）
 * versions は version_no 降順で渡される前提（promptPackageRepository.listVersions）。
 */
export function resolveVersionCopySource<T extends { status: string; version_no: number }>(
  versions: T[],
  copyMethod: string,
): T | null {
  if (copyMethod === "copy_published") return versions.find((v) => v.status === "published") ?? null;
  if (copyMethod === "copy_latest") return versions[0] ?? null;
  return null;
}

/**
 * プロンプト移行レポートに必要なデータをまとめて取得する。
 * promptMigrationReportPage（表示）と executePromptMigration（実行）で共用。
 */
async function loadPromptMigrationData(): Promise<{
  report: import("../services/promptMigrationService").PromptMigrationReport;
  projects: Awaited<ReturnType<typeof projectRepository.list>>;
}> {
  const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
  const { buildPromptMigrationReport } = await import("../services/promptMigrationService");
  const projects = await projectRepository.list();

  // package モードで参照されているバージョンのメタ情報を取得
  const referencedVersionIds = [
    ...new Set(
      projects
        .filter((p) => p.ai_prompt_mode === "package" && p.ai_prompt_package_version_id)
        .map((p) => p.ai_prompt_package_version_id as string)
    ),
  ];
  const versionMetaById = new Map<string, import("../services/promptMigrationService").ReferencedVersionMeta>();
  const versions = await Promise.all(
    referencedVersionIds.map((vid) => promptPackageRepository.getVersionById(vid).catch(() => null))
  );
  for (const v of versions) {
    if (v) versionMetaById.set(v.id, { status: v.status, version_no: v.version_no, package_id: v.package_id });
  }

  // archived 参照の fallback 先（公開中バージョン番号）を取得
  const archivedPackageIds = [
    ...new Set(
      Array.from(versionMetaById.values())
        .filter((m) => m.status === "archived")
        .map((m) => m.package_id)
    ),
  ];
  const publishedVersionNoByPackage = new Map<string, number>();
  const publishedVersions = await Promise.all(
    archivedPackageIds.map((pid) => promptPackageRepository.getPublishedVersionByPackageId(pid).catch(() => null))
  );
  archivedPackageIds.forEach((pid, i) => {
    const pv = publishedVersions[i];
    if (pv) publishedVersionNoByPackage.set(pid, pv.version_no);
  });

  const report = buildPromptMigrationReport({
    projects: projects.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      ai_prompt_mode: p.ai_prompt_mode,
      ai_prompt_package_version_id: p.ai_prompt_package_version_id,
      ai_prompt_policy_json: p.ai_prompt_policy_json,
      ai_prompt_templates_json: p.ai_prompt_templates_json,
    })),
    versionMetaById,
    publishedVersionNoByPackage,
  });

  return { report, projects };
}

/** body の JSON 文字列をオブジェクトとしてパース（配列・非オブジェクト・パース失敗は null） */
function parseOptionalJsonObject(raw: string): Record<string, unknown> | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseAIPromptTemplatesFromRequest(req: Request): AIPromptTemplateMap | null {
  const raw = bodyString(req.body.ai_prompt_templates_json).trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as AIPromptTemplateMap;
  } catch {
    return null;
  }
}

/**
 * Phase F: hidden builder_spec_json（プロンプトビルダー方針）をリクエストから取り出して正規化する。
 * 空・不正は null。
 */
function parseBuilderSpecFromRequest(req: Request): PromptBuilderSpec | null {
  const raw = bodyString(req.body.builder_spec_json).trim();
  if (!raw) return null;
  try {
    const spec = normalizePromptBuilderSpec(JSON.parse(raw));
    return Object.keys(spec).length > 0 ? spec : null;
  } catch {
    return null;
  }
}

interface PromptValidationResult {
  errors: string[];
  warnings: string[];
}

/** 保存済み ai_prompt_templates_json を検証してエラー・警告を返す */
function validateAIPromptTemplates(templates: AIPromptTemplateMap | null | undefined): PromptValidationResult {
  if (!templates) return { errors: [], warnings: [] };
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [key, entry] of Object.entries(templates)) {
    if (!entry) continue;
    const def = BASE_PROMPT_TEMPLATES[key as keyof typeof BASE_PROMPT_TEMPLATES];

    // 未知のキー
    if (!def) {
      warnings.push(`[${key}] 未定義のプロンプトキーです（無視されます）`);
      continue;
    }

    const isEnabled = entry.enabled !== false;
    const hasTemplate = typeof entry.template === "string" && entry.template.trim().length > 0;

    // enabled=true なのにテンプレートが空（空文字のみ）
    if (isEnabled && typeof entry.template === "string" && !entry.template.trim() && entry.template.length > 0) {
      errors.push(`[${key}] 有効にされていますがテンプレートが空白のみです`);
    }

    if (!hasTemplate) continue;

    const template = entry.template as string;
    const used = extractTemplatePlaceholders(template);
    const allowed = new Set(def.allowedPlaceholders);

    // 不正プレースホルダー → エラー
    const unknownKeys = used.filter(k => !allowed.has(k));
    if (unknownKeys.length > 0) {
      errors.push(`[${key}] 使用できないプレースホルダー: ${unknownKeys.map(k => `{{${k}}}`).join(", ")}`);
    }

    // 空テンプレート（enabled=true で template キーはあるが内容が空）はスキップ済み
  }

  return { errors, warnings };
}

/** 管理画面表示用: プロンプトキーごとの許可プレースホルダー情報＋配置メタ */
function buildPromptKeyDefs() {
  return Object.entries(BASE_PROMPT_TEMPLATES).map(([key, def]) => {
    const placement = PROMPT_KEY_PLACEMENT[key as BasePromptKey];
    return {
      key,
      label: def.label,
      description: def.description,
      callTiming: def.callTiming,
      impactScope: def.impactScope,
      outputFormat: def.outputFormat,
      baseTemplate: def.template,
      usedPolicies: def.usedPolicies.map(describePolicyAxis),
      // 配置メタ（可視化用）: どの系統で・どの文脈で発火し・深掘りに影響するか
      family: placement.family,
      familyLabel: PROMPT_FAMILY_LABEL[placement.family],
      contexts: placement.contexts,
      dormant: placement.dormant,
      probeImpact: placement.probeImpact,
      managedBy: placement.managedBy,
      allowedPlaceholders: def.allowedPlaceholders.map(ph => ({
        key: ph,
        description: describePlaceholder(ph)
      }))
    };
  });
}

/**
 * Phase D: パッケージバージョンの設定（templates_json / policy_json）から
 * 1キーのプロンプトをレンダリングする。プロジェクトを経由しない。
 * - templateOverride を渡すと該当キーの本文を上書き（version-form の未保存ドラフト用）
 * - sampleValues でプレースホルダーを埋める（未指定はラベル付きサンプル）
 */
function renderPromptForPackageConfig(input: {
  promptKey: BasePromptKey;
  templates: AIPromptTemplateMap | null;
  policy: AIPromptPolicy | null;
  templateOverride?: string | null;
  sampleValues?: Record<string, string>;
}): { template: string; rendered: string; isCustom: boolean; policy: AIPromptPolicy } {
  const def = BASE_PROMPT_TEMPLATES[input.promptKey];
  const sampleValues = input.sampleValues ?? {};

  // 実効テンプレート: override > version の該当キー > BASE フォールバック
  const override = (input.templateOverride ?? "").trim();
  const effectiveTemplates: AIPromptTemplateMap = { ...(input.templates ?? {}) };
  if (override) {
    effectiveTemplates[input.promptKey] = { enabled: true, template: override };
  }

  // pseudo-project（解決関数は ai_prompt_*_json のみ参照する）
  const pseudoProject = {
    ai_prompt_templates_json: effectiveTemplates,
    ai_prompt_policy_json: input.policy ?? null,
  } as unknown as Project;

  const template = resolveBasePromptTemplate(pseudoProject, input.promptKey);
  const isCustom = template !== def.template;

  const context: Record<string, string> = {};
  for (const ph of def.allowedPlaceholders) {
    context[ph] = sampleValues[ph] ?? `【${describePlaceholder(ph)}】`;
  }
  if (def.allowedPlaceholders.includes("sharedSections")) {
    const purpose = input.promptKey.includes("Probe") ? "probe"
      : input.promptKey.includes("Analysis") || input.promptKey.includes("Summary") ? "analysis"
      : "general";
    context["sharedSections"] = renderPromptPolicySections(pseudoProject, purpose) ?? "";
  }

  return {
    template,
    rendered: renderPromptTemplate(template, context),
    isCustom,
    policy: resolveAIPromptPolicy(pseudoProject),
  };
}

function buildProjectAiStateFromRequest(input: {
  req: Request;
  fallbackProject: Partial<
    Pick<
      Project,
      | "name"
      | "objective"
      | "research_mode"
      | "primary_objectives"
      | "secondary_objectives"
      | "ai_state_template_key"
    >
  >;
  existingAiState?: Project["ai_state_json"] | null;
}): Project["ai_state_json"] {
  const deepProbeEnabled = input.req.body.deep_probe_enabled === "on";
  const maxProbeDepth = Math.max(0, parseOptionalInteger(input.req.body.max_probe_depth) ?? (deepProbeEnabled ? 1 : 0));
  const comparisonConstraints = parseLineSeparatedList(bodyString(input.req.body.comparison_constraints));
  const displayStyle = parseProjectDisplayStyle(bodyString(input.req.body.display_style));
  const baseState = normalizeProjectAIState(input.existingAiState, {
    fallbackTemplateKey: input.fallbackProject.ai_state_template_key ?? null,
    fallbackProject: input.fallbackProject
  });

  return normalizeProjectAIState(
    {
      ...baseState,
      probe_policy: {
        ...baseState.probe_policy,
        default_max_probes: deepProbeEnabled ? maxProbeDepth : 0,
        force_probe_on_bad: deepProbeEnabled,
        allow_followup_expansion: displayStyle === "interview",
        strict_topic_lock: true
      },
      topic_control: {
        ...baseState.topic_control,
        forbidden_topic_shift: true,
        topic_lock_note:
          comparisonConstraints.length > 0
            ? `比較条件: ${comparisonConstraints.join(" / ")}`
            : baseState.topic_control.topic_lock_note
      }
    },
    {
      fallbackTemplateKey: input.fallbackProject.ai_state_template_key ?? null,
      fallbackProject: input.fallbackProject
    }
  );
}

type QuestionBranchOperator = "equals" | "includes" | "any_of" | "gte" | "lte";

interface QuestionBranchRowFormValue {
  source: "answer" | "extracted";
  field_label: string;
  operator: QuestionBranchOperator;
  value: string;
  next: string;
}

interface QuestionFormValues {
  question_code: string;
  question_text: string;
  question_role: QuestionRole;
  question_type: QuestionType;
  sort_order_text: string;
  is_required: boolean;
  ai_probe_enabled: boolean;
  probe_guideline: string;
  max_probe_count_text: string;
  render_strategy: "static" | "dynamic";
  question_goal: string;
  metric_code: string;
  metric_direction: string;
  max_probes: string;
  placeholder: string;
  option_labels: string[];
  option_image_urls: string[];
  option_extra_image_urls: string[];
  option_descriptions: string[];
  min_select_text: string;
  max_select_text: string;
  yes_label: string;
  no_label: string;
  scale_min_text: string;
  scale_max_text: string;
  scale_min_label: string;
  scale_max_label: string;
  extraction_enabled: boolean;
  extraction_items: string[];
  branch_rows: QuestionBranchRowFormValue[];
  // --- Phase 1 追加フィールド (formV3) ---
  comment_top: string;
  comment_bottom: string;
  answer_output_type: string;
  default_next: string;
  visibility_conditions: Array<{ expression: string }>;
  display_tags_raw: string;
  display_tags_parsed_json: string;
  ans_insertions: Array<{ source: string; target: string }>;
  matrix_rows: string;
  matrix_cols: string;
  // --- 画像拡張フィールド ---
  matrix_row_image_urls: string[];
  matrix_row_extra_image_urls: string[];
  matrix_row_descriptions: string[];
  matrix_col_image_urls: string[];
  matrix_col_extra_image_urls: string[];
  matrix_col_descriptions: string[];
  matrix_header_mode: string;
  presentation_pattern: string;
  presentation_scale: boolean;
  presentation_slider: boolean;
  display_format: string;
  grid_cols: string;
  image_upload_max_count: string;
  image_upload_allowed_types: string;
  image_upload_max_size_mb: string;
  image_upload_instructions: string;
  image_upload_text_mode: string;
  // --- 設問文画像 ---
  question_text_image_url: string;
  question_text_extra_image_urls: string;
  question_text_caption: string;
  question_display_mode: string;
  page_group_id: string;
  // --- スクリーニング ---
  is_screening_question: boolean;
  option_screening_pass: boolean[];
  // タグフォームフィールド (tab4)
  tag_size: string;
  tag_min: string;
  tag_max: string;
  tag_rows: string;
  tag_cols: string;
  tag_code: string;
  tag_numeric: boolean;
  tag_numeric_decimal: string;
  tag_al: boolean;
  tag_type_year: boolean;
  tag_type_jyear: boolean;
  tag_type_month: boolean;
  tag_type_day: boolean;
  tag_norep: boolean;
  tag_fix: boolean;
  tag_br: boolean;
  tag_must: boolean;
  tag_ex: boolean;
  tag_len_op: string;
  tag_len_val: string;
  tag_bf: string;
  tag_af: string;
}

function parseQuestionBranchOperator(value: string): QuestionBranchOperator {
  if (
    value === "equals" ||
    value === "includes" ||
    value === "any_of" ||
    value === "gte" ||
    value === "lte"
  ) {
    return value;
  }
  return "equals";
}

function normalizeTextList(values: string[]): string[] {
  return values.map((value) => value.trim()).filter(Boolean);
}

function branchConditionToFormValue(
  when: Record<string, unknown> | null | undefined
): Pick<QuestionBranchRowFormValue, "operator" | "value"> {
  if (!when) {
    return { operator: "equals", value: "" };
  }
  if ("equals" in when) {
    return { operator: "equals", value: String(when.equals ?? "") };
  }
  if ("includes" in when) {
    return { operator: "includes", value: String(when.includes ?? "") };
  }
  if ("gte" in when) {
    return { operator: "gte", value: String(when.gte ?? "") };
  }
  if ("lte" in when) {
    return { operator: "lte", value: String(when.lte ?? "") };
  }
  if ("any_of" in when && Array.isArray(when.any_of)) {
    return { operator: "any_of", value: when.any_of.map((value) => String(value ?? "")).join(", ") };
  }
  return { operator: "equals", value: "" };
}

function buildQuestionFormValues(
  question: Question | null,
  overrides: Partial<QuestionFormValues> = {}
): QuestionFormValues {
  const meta = question?.question_config?.meta ?? {};
  const extractionFields = Array.isArray(question?.question_config?.extraction?.schema?.fields)
    ? question?.question_config?.extraction?.schema?.fields ?? []
    : [];
  const extractionItems = extractionFields
    .map((field) => (typeof field.label === "string" && field.label.trim() ? field.label.trim() : field.key))
    .filter(Boolean);
  const fieldLabelByKey = new Map<string, string>(
    extractionFields.map((field) => [field.key, field.label?.trim() || field.key])
  );
  const branchRule = normalizeBranchRule(question?.branch_rule ?? null);
  const branchRows: QuestionBranchRowFormValue[] =
    (branchRule?.branches ?? []).map((branch) => {
      const condition = branchConditionToFormValue(branch.when as Record<string, unknown>);
      return {
        source: branch.source === "extracted" ? "extracted" : "answer",
        field_label: branch.source === "extracted" ? fieldLabelByKey.get(branch.field ?? "") ?? branch.field ?? "" : "",
        operator: condition.operator,
        value: condition.value,
        next: branch.next
      } as QuestionBranchRowFormValue;
    });
  const optionLabels =
    Array.isArray(question?.question_config?.options) && question?.question_config?.options.length > 0
      ? question.question_config.options.map((option) => option.label)
      : [];
  const optionExtraImageUrls =
    Array.isArray(question?.question_config?.options) && CHOICE_QUESTION_TYPES.includes(question?.question_type as QuestionType)
      ? question!.question_config!.options!.map((o) => {
          const primary = (o as { imageUrl?: string }).imageUrl ?? "";
          const all = (o as { imageUrls?: string[] }).imageUrls ?? [];
          return all.filter((u) => u && u !== primary).join("\n");
        })
      : [];
  const optionDescriptions =
    Array.isArray(question?.question_config?.options) && CHOICE_QUESTION_TYPES.includes(question?.question_type as QuestionType)
      ? question!.question_config!.options!.map((o) => (o as { description?: string }).description ?? "")
      : [];
  const optionImageUrls =
    Array.isArray(question?.question_config?.options) && question?.question_config?.options.length > 0
      ? question.question_config.options.map((option) => option.imageUrl ?? "")
      : [];
  const yesNoLabels = getYesNoLabels(question?.question_config ?? null);
  const scale = getQuestionScaleRange(question?.question_config ?? null);

  return {
    question_code: overrides.question_code ?? question?.question_code ?? "",
    question_text: overrides.question_text ?? question?.question_text ?? "",
    question_role: overrides.question_role ?? question?.question_role ?? "main",
    question_type: overrides.question_type ?? question?.question_type ?? "free_text_short",
    sort_order_text: overrides.sort_order_text ?? String(question?.sort_order ?? 1),
    is_required: overrides.is_required ?? question?.is_required ?? true,
    ai_probe_enabled: overrides.ai_probe_enabled ?? question?.ai_probe_enabled ?? true,
    probe_guideline: overrides.probe_guideline ?? question?.probe_guideline ?? "",
    max_probe_count_text:
      overrides.max_probe_count_text ??
      (question?.max_probe_count != null ? String(question.max_probe_count) : ""),
    render_strategy: overrides.render_strategy ?? question?.render_strategy ?? "static",
    question_goal: overrides.question_goal ?? meta.question_goal ?? "",
    metric_code: overrides.metric_code ?? meta.metric_code ?? "",
    metric_direction: overrides.metric_direction ?? meta.metric_direction ?? "",
    max_probes:
      overrides.max_probes ??
      String(typeof meta.probe_config?.max_probes === "number" ? meta.probe_config.max_probes : 1),
    placeholder: overrides.placeholder ?? question?.question_config?.placeholder ?? "",
    option_labels: overrides.option_labels ?? optionLabels,
    option_image_urls: overrides.option_image_urls ?? optionImageUrls,
    option_extra_image_urls: overrides.option_extra_image_urls ?? optionExtraImageUrls,
    option_descriptions: overrides.option_descriptions ?? optionDescriptions,
    min_select_text:
      overrides.min_select_text ??
      (typeof question?.question_config?.min_select === "number" ? String(question.question_config.min_select) : ""),
    max_select_text:
      overrides.max_select_text ??
      (typeof question?.question_config?.max_select === "number" ? String(question.question_config.max_select) : ""),
    yes_label: overrides.yes_label ?? yesNoLabels.yesLabel,
    no_label: overrides.no_label ?? yesNoLabels.noLabel,
    scale_min_text: overrides.scale_min_text ?? String(scale.min),
    scale_max_text: overrides.scale_max_text ?? String(scale.max),
    scale_min_label: overrides.scale_min_label ?? scale.minLabel,
    scale_max_label: overrides.scale_max_label ?? scale.maxLabel,
    extraction_enabled: overrides.extraction_enabled ?? extractionItems.length > 0,
    extraction_items: overrides.extraction_items ?? extractionItems,
    branch_rows: overrides.branch_rows ?? branchRows,
    // Phase 1 追加フィールド
    comment_top: overrides.comment_top ?? question?.comment_top ?? "",
    comment_bottom: overrides.comment_bottom ?? question?.comment_bottom ?? "",
    answer_output_type: overrides.answer_output_type ?? question?.answer_output_type ?? "",
    default_next: overrides.default_next ?? (normalizeBranchRule(question?.branch_rule ?? null)?.default_next ?? ""),
    visibility_conditions: overrides.visibility_conditions ?? (question?.visibility_conditions ?? []).map((c) => ({ expression: c.expression })),
    display_tags_raw: overrides.display_tags_raw ?? question?.display_tags_raw ?? "",
    display_tags_parsed_json: overrides.display_tags_parsed_json ?? (question?.display_tags_parsed ? JSON.stringify(question.display_tags_parsed) : ""),
    ans_insertions: overrides.ans_insertions ?? (question?.display_tags_parsed?.answerInsertions?.map((a) => ({ source: a.source, target: a.target })) ?? []),
    matrix_rows: overrides.matrix_rows ?? (() => {
      const opts = question?.question_config?.options;
      if (MATRIX_QUESTION_TYPES.includes(question?.question_type as QuestionType) && Array.isArray(opts)) {
        return opts.map((o: { label?: string }) => o.label ?? "").join("\n");
      }
      return "";
    })(),
    matrix_cols: overrides.matrix_cols ?? (() => {
      const mc = (question?.question_config as Record<string, unknown> | null)?.matrix_cols;
      if (Array.isArray(mc)) {
        return mc.map((c: { label?: string } | string) => (typeof c === "object" ? c.label ?? "" : c)).join("\n");
      }
      return "";
    })(),
    tag_size: overrides.tag_size ?? (question?.display_tags_parsed?.inputSize != null ? String(question.display_tags_parsed.inputSize) : ""),
    tag_min: overrides.tag_min ?? (question?.display_tags_parsed?.minValue != null ? String(question.display_tags_parsed.minValue) : ""),
    tag_max: overrides.tag_max ?? (question?.display_tags_parsed?.maxValue != null ? String(question.display_tags_parsed.maxValue) : ""),
    tag_rows: overrides.tag_rows ?? (question?.display_tags_parsed?.rows != null ? String(question.display_tags_parsed.rows) : ""),
    tag_cols: overrides.tag_cols ?? (question?.display_tags_parsed?.cols != null ? String(question.display_tags_parsed.cols) : ""),
    tag_code: overrides.tag_code ?? (question?.display_tags_parsed?.inputCode != null ? String(question.display_tags_parsed.inputCode) : ""),
    tag_numeric: overrides.tag_numeric ?? (question?.display_tags_parsed?.numericOnly ?? false),
    tag_numeric_decimal: overrides.tag_numeric_decimal ?? (question?.display_tags_parsed?.numericDecimalPlaces != null ? String(question.display_tags_parsed.numericDecimalPlaces) : ""),
    tag_al: overrides.tag_al ?? (question?.display_tags_parsed?.alphaNumericOnly ?? false),
    tag_type_year: overrides.tag_type_year ?? (question?.display_tags_parsed?.inputType?.year ?? false),
    tag_type_jyear: overrides.tag_type_jyear ?? (question?.display_tags_parsed?.inputType?.jyear ?? false),
    tag_type_month: overrides.tag_type_month ?? (question?.display_tags_parsed?.inputType?.month ?? false),
    tag_type_day: overrides.tag_type_day ?? (question?.display_tags_parsed?.inputType?.day ?? false),
    tag_norep: overrides.tag_norep ?? (question?.display_tags_parsed?.noRepeat ?? false),
    tag_fix: overrides.tag_fix ?? (question?.display_tags_parsed?.fixedChoice ?? false),
    tag_br: overrides.tag_br ?? (question?.display_tags_parsed?.lineBreak ?? false),
    tag_must: overrides.tag_must ?? (question?.display_tags_parsed?.mustInput ?? false),
    tag_ex: overrides.tag_ex ?? (question?.display_tags_parsed?.exampleInput ?? false),
    tag_len_op: overrides.tag_len_op ?? (question?.display_tags_parsed?.lengthRule?.operator ?? ""),
    tag_len_val: overrides.tag_len_val ?? (question?.display_tags_parsed?.lengthRule?.value != null ? String(question.display_tags_parsed.lengthRule.value) : ""),
    tag_bf: overrides.tag_bf ?? (question?.display_tags_parsed?.beforeText ?? ""),
    tag_af: overrides.tag_af ?? (question?.display_tags_parsed?.afterText ?? ""),
    question_display_mode: overrides.question_display_mode ?? "",
    page_group_id: overrides.page_group_id ?? (question?.page_group_id ?? ""),
    // 画像拡張フィールド
    matrix_row_image_urls: overrides.matrix_row_image_urls ?? (() => {
      const opts = question?.question_config?.options;
      if (MATRIX_QUESTION_TYPES.includes(question?.question_type as QuestionType) && Array.isArray(opts)) {
        return opts.map((o) => (o as { imageUrl?: string }).imageUrl ?? "");
      }
      return [];
    })(),
    matrix_row_extra_image_urls: overrides.matrix_row_extra_image_urls ?? (() => {
      const opts = question?.question_config?.options;
      if (MATRIX_QUESTION_TYPES.includes(question?.question_type as QuestionType) && Array.isArray(opts)) {
        return opts.map((o) => {
          const primary = (o as { imageUrl?: string }).imageUrl ?? "";
          const all = (o as { imageUrls?: string[] }).imageUrls ?? [];
          return all.filter((u) => u && u !== primary).join("\n");
        });
      }
      return [];
    })(),
    matrix_row_descriptions: overrides.matrix_row_descriptions ?? (() => {
      const opts = question?.question_config?.options;
      if (MATRIX_QUESTION_TYPES.includes(question?.question_type as QuestionType) && Array.isArray(opts)) {
        return opts.map((o) => (o as { description?: string }).description ?? "");
      }
      return [];
    })(),
    matrix_col_image_urls: overrides.matrix_col_image_urls ?? (() => {
      const mc = (question?.question_config as Record<string, unknown> | null)?.matrix_cols;
      if (Array.isArray(mc)) {
        return mc.map((c: { imageUrl?: string } | string) => (typeof c === "object" ? c.imageUrl ?? "" : ""));
      }
      return [];
    })(),
    matrix_col_extra_image_urls: overrides.matrix_col_extra_image_urls ?? (() => {
      const mc = (question?.question_config as Record<string, unknown> | null)?.matrix_cols;
      if (Array.isArray(mc)) {
        return mc.map((c: { imageUrl?: string; imageUrls?: string[] } | string) => {
          if (typeof c !== "object") return "";
          const primary = c.imageUrl ?? "";
          const all = c.imageUrls ?? [];
          return all.filter((u) => u && u !== primary).join("\n");
        });
      }
      return [];
    })(),
    matrix_col_descriptions: overrides.matrix_col_descriptions ?? (() => {
      const mc = (question?.question_config as Record<string, unknown> | null)?.matrix_cols;
      if (Array.isArray(mc)) {
        return mc.map((c: { description?: string } | string) => (typeof c === "object" ? c.description ?? "" : ""));
      }
      return [];
    })(),
    matrix_header_mode: overrides.matrix_header_mode ?? (question?.question_config?.matrix_header_mode ?? "normal"),
    // 回答UI表示パターンの設問単位上書き（migration 075）
    presentation_pattern: overrides.presentation_pattern ?? (question?.question_config?.presentation?.pattern ?? ""),
    presentation_scale: overrides.presentation_scale ?? (question?.question_config?.presentation?.scale ?? false),
    presentation_slider: overrides.presentation_slider ?? (question?.question_config?.presentation?.slider ?? false),
    display_format: overrides.display_format ?? (question?.question_config?.display_format ?? "list"),
    grid_cols: overrides.grid_cols ?? String(question?.question_config?.grid_cols ?? "2"),
    image_upload_max_count: overrides.image_upload_max_count ?? String(question?.question_config?.image_upload_config?.max_count ?? ""),
    image_upload_allowed_types: overrides.image_upload_allowed_types ?? (question?.question_config?.image_upload_config?.allowed_types ?? []).join(","),
    image_upload_max_size_mb: overrides.image_upload_max_size_mb ?? String(question?.question_config?.image_upload_config?.max_size_mb ?? ""),
    image_upload_instructions: overrides.image_upload_instructions ?? (question?.question_config?.image_upload_config?.instructions ?? ""),
    image_upload_text_mode: overrides.image_upload_text_mode ?? (question?.question_config?.image_upload_config?.text_input_mode ?? "optional"),
    question_text_image_url: overrides.question_text_image_url ?? (question?.question_config?.question_text_image?.mainUrl ?? ""),
    question_text_extra_image_urls: overrides.question_text_extra_image_urls ?? (question?.question_config?.question_text_image?.additionalUrls ?? []).join("\n"),
    question_text_caption: overrides.question_text_caption ?? (question?.question_config?.question_text_image?.caption ?? ""),
    is_screening_question: overrides.is_screening_question ?? (question?.is_screening_question ?? false),
    option_screening_pass: overrides.option_screening_pass ?? (() => {
      const opts = question?.question_config?.options;
      if (Array.isArray(opts)) return opts.map(o => o.isScreeningPass === true);
      return [];
    })(),
  };
}

function buildQuestionFormValuesFromRequest(req: Request): QuestionFormValues {
  const branchSources = bodyStringArray(req.body.branch_source);
  const branchFieldLabels = bodyStringArray(req.body.branch_field_label);
  const branchOperators = bodyStringArray(req.body.branch_operator);
  const branchValues = bodyStringArray(req.body.branch_value);
  const branchNextValues = bodyStringArray(req.body.branch_next);
  const branchRowCount = Math.max(
    branchSources.length,
    branchFieldLabels.length,
    branchOperators.length,
    branchValues.length,
    branchNextValues.length
  );

  return {
    question_code: bodyString(req.body.question_code),
    question_text: bodyString(req.body.question_text),
    question_role: parseQuestionRole(bodyString(req.body.question_role)),
    question_type: parseQuestionType(bodyString(req.body.question_type)),
    sort_order_text: bodyString(req.body.sort_order) || "1",
    is_required: req.body.is_required === "on",
    ai_probe_enabled: req.body.ai_probe_enabled === "on",
    probe_guideline: bodyString(req.body.probe_guideline),
    max_probe_count_text: bodyString(req.body.max_probe_count),
    render_strategy: (bodyString(req.body.render_strategy) === "dynamic" ? "dynamic" : "static") as "static" | "dynamic",
    question_goal: bodyString(req.body.question_goal),
    metric_code: bodyString(req.body.metric_code),
    metric_direction: bodyString(req.body.metric_direction),
    max_probes: bodyString(req.body.max_probes) || "1",
    placeholder: bodyString(req.body.placeholder),
    option_labels: normalizeTextList(bodyStringArray(req.body.option_labels)),
    option_image_urls: bodyStringArray(req.body.option_image_urls).map((u) => u.trim()),
    option_extra_image_urls: bodyStringArray(req.body.option_extra_image_urls).map((s) => s.trim()),
    option_descriptions: bodyStringArray(req.body.option_descriptions).map((d) => d.trim()),
    min_select_text: bodyString(req.body.min_select),
    max_select_text: bodyString(req.body.max_select),
    yes_label: bodyString(req.body.yes_label) || "はい",
    no_label: bodyString(req.body.no_label) || "いいえ",
    scale_min_text: bodyString(req.body.scale_min) || "1",
    scale_max_text: bodyString(req.body.scale_max) || "5",
    scale_min_label: bodyString(req.body.scale_min_label),
    scale_max_label: bodyString(req.body.scale_max_label),
    extraction_enabled: req.body.extraction_enabled === "on",
    extraction_items: normalizeTextList(bodyStringArray(req.body.extraction_items)),
    branch_rows: Array.from({ length: branchRowCount }, (_unused, index) => ({
      source: (branchSources[index] === "extracted" ? "extracted" : "answer") as "answer" | "extracted",
      field_label: branchFieldLabels[index] ?? "",
      operator: parseQuestionBranchOperator(branchOperators[index] ?? ""),
      value: branchValues[index] ?? "",
      next: branchNextValues[index] ?? ""
    })).filter((row) => row.field_label || row.value || row.next) as QuestionBranchRowFormValue[],
    // Phase 1 追加フィールド
    comment_top: bodyString(req.body.comment_top),
    comment_bottom: bodyString(req.body.comment_bottom),
    answer_output_type: bodyString(req.body.answer_output_type),
    default_next: bodyString(req.body.default_next),
    visibility_conditions: bodyStringArray(req.body.vis_condition_expr)
      .filter(Boolean)
      .map((expression) => ({ expression })),
    display_tags_raw: bodyString(req.body.display_tags_raw),
    display_tags_parsed_json: bodyString(req.body.display_tags_parsed_json),
    ans_insertions: (() => {
      const sources  = bodyStringArray(req.body.ans_source);
      const targets  = bodyStringArray(req.body.ans_target);
      const len = Math.max(sources.length, targets.length);
      return Array.from({ length: len }, (_, i) => ({
        source: sources[i] ?? "",
        target: targets[i] ?? "question_text",
      })).filter((a) => a.source);
    })(),
    matrix_rows: bodyString(req.body.matrix_rows),
    matrix_cols: bodyString(req.body.matrix_cols),
    matrix_row_image_urls: bodyStringArray(req.body.matrix_row_image_urls).map((u) => u.trim()),
    matrix_row_extra_image_urls: bodyStringArray(req.body.matrix_row_extra_image_urls).map((s) => s.trim()),
    matrix_row_descriptions: bodyStringArray(req.body.matrix_row_descriptions).map((d) => d.trim()),
    matrix_col_image_urls: bodyStringArray(req.body.matrix_col_image_urls).map((u) => u.trim()),
    matrix_col_extra_image_urls: bodyStringArray(req.body.matrix_col_extra_image_urls).map((s) => s.trim()),
    matrix_col_descriptions: bodyStringArray(req.body.matrix_col_descriptions).map((d) => d.trim()),
    matrix_header_mode: bodyString(req.body.matrix_header_mode) || "normal",
    presentation_pattern: bodyString(req.body.presentation_pattern),
    presentation_scale: req.body.presentation_scale === "true" || req.body.presentation_scale === "on",
    presentation_slider: req.body.presentation_slider === "true" || req.body.presentation_slider === "on",
    display_format: bodyString(req.body.display_format) || "list",
    grid_cols: bodyString(req.body.grid_cols) || "2",
    image_upload_max_count: bodyString(req.body.image_upload_max_count),
    image_upload_allowed_types: bodyString(req.body.image_upload_allowed_types),
    image_upload_max_size_mb: bodyString(req.body.image_upload_max_size_mb),
    image_upload_instructions: bodyString(req.body.image_upload_instructions),
    image_upload_text_mode: bodyString(req.body.image_upload_text_mode) || "hidden",
    question_text_image_url: bodyString(req.body.question_text_image_url).trim(),
    question_text_extra_image_urls: bodyString(req.body.question_text_extra_image_urls).trim(),
    question_text_caption: bodyString(req.body.question_text_caption).trim(),
    tag_size:           bodyString(req.body.tag_size),
    tag_min:            bodyString(req.body.tag_min),
    tag_max:            bodyString(req.body.tag_max),
    tag_rows:           bodyString(req.body.tag_rows),
    tag_cols:           bodyString(req.body.tag_cols),
    tag_code:           bodyString(req.body.tag_code),
    tag_numeric:        req.body.tag_numeric === "1",
    tag_numeric_decimal: bodyString(req.body.tag_numeric_decimal),
    tag_al:             req.body.tag_al === "1",
    tag_type_year:      req.body.tag_type_year === "1",
    tag_type_jyear:     req.body.tag_type_jyear === "1",
    tag_type_month:     req.body.tag_type_month === "1",
    tag_type_day:       req.body.tag_type_day === "1",
    tag_norep:          req.body.tag_norep === "1",
    tag_fix:            req.body.tag_fix === "1",
    tag_br:             req.body.tag_br === "1",
    tag_must:           req.body.tag_must === "1",
    tag_ex:             req.body.tag_ex === "1",
    tag_len_op:         bodyString(req.body.tag_len_op),
    tag_len_val:        bodyString(req.body.tag_len_val),
    tag_bf:             bodyString(req.body.tag_bf),
    tag_af:             bodyString(req.body.tag_af),
    question_display_mode: bodyString(req.body.question_display_mode),
    page_group_id:      bodyString(req.body.page_group_id),
    is_screening_question: req.body.is_screening_question === "1",
    option_screening_pass: (() => {
      const raw = req.body.option_screening_pass;
      if (Array.isArray(raw)) return raw.map(v => v === "1");
      if (typeof raw === "string") return [raw === "1"];
      return [];
    })(),
  };
}

function renderQuestionForm(
  res: Response,
  input: {
    title: string;
    project: Project;
    question: Question | null;
    action: string;
    formValues: QuestionFormValues;
    availableQuestions: Question[];
    pageGroups?: import("../types/domain").QuestionPageGroup[];
    errorMessage?: string | null;
    successMessage?: string | null;
    statusCode?: number;
    prevQuestion?: { id: string; question_code: string } | null;
    nextQuestion?: { id: string; question_code: string } | null;
  }
): void {
  if (typeof input.statusCode === "number") {
    res.status(input.statusCode);
  }

  res.render("admin/questions/formV3", {
    title: input.title,
    project: input.project,
    question: input.question,
    action: input.action,
    form: input.formValues,
    availableQuestions: input.availableQuestions.filter(
      (candidate) => !candidate.is_hidden || candidate.id === input.question?.id
    ),
    pageGroups: input.pageGroups ?? [],
    metricCatalog: METRIC_CATALOG,
    metricDirections: METRIC_DIRECTIONS.map((d) => ({ value: d, label: metricDirectionLabel(d) })),
    errorMessage: input.errorMessage ?? null,
    successMessage: input.successMessage ?? null,
    prevQuestion: input.prevQuestion ?? null,
    nextQuestion: input.nextQuestion ?? null,
  });
}

/**
 * formV3 の新フィールド（Phase 1 追加分）をリクエストから抽出する。
 * questionRepository.create / update の追加プロパティとして展開して使う。
 */
function buildTagFieldsFromRequest(req: Request): {
  comment_top: string | null;
  comment_bottom: string | null;
  answer_output_type: string | null;
  display_tags_raw: string | null;
  display_tags_parsed: DisplayTagsParsed | null;
  visibility_conditions: VisibilityCondition[] | null;
  page_group_id: string | null;
} {
  const commentTop       = bodyString(req.body.comment_top).trim() || null;
  const commentBottom    = bodyString(req.body.comment_bottom).trim() || null;
  const answerOutputType = bodyString(req.body.answer_output_type).trim() || null;

  // display_tags_raw: タブ5で直接編集した raw 文字列
  const rawTags = bodyString(req.body.display_tags_raw).trim() || null;

  // display_tags_parsed: hidden フィールド経由で JSON として送信される
  let parsedTags: DisplayTagsParsed | null = null;
  const parsedJson = bodyString(req.body.display_tags_parsed_json).trim();
  if (parsedJson) {
    try {
      parsedTags = JSON.parse(parsedJson) as DisplayTagsParsed;
    } catch {
      if (rawTags) {
        parsedTags = parseDisplayTags(rawTags).parsed;
      }
    }
  } else if (rawTags) {
    parsedTags = parseDisplayTags(rawTags).parsed;
  }

  // visibility_conditions: vis_condition_expr フィールド群から構築
  const visExprs = bodyStringArray(req.body.vis_condition_expr).filter(Boolean);
  const visibilityConditions: VisibilityCondition[] | null =
    visExprs.length > 0
      ? visExprs.map((expression) => ({ type: "pipe_expression" as const, expression }))
      : null;

  const pageGroupId = bodyString(req.body.page_group_id).trim() || null;

  return {
    comment_top: commentTop,
    comment_bottom: commentBottom,
    answer_output_type: answerOutputType,
    display_tags_raw: rawTags,
    display_tags_parsed: parsedTags,
    visibility_conditions: visibilityConditions,
    page_group_id: pageGroupId,
  };
}

const CHOICE_QUESTION_TYPES: QuestionType[] = [
  "single_choice", "multi_choice",
  "hidden_single", "hidden_multi", "text_with_image", "sd",
];
const MATRIX_QUESTION_TYPES: QuestionType[] = ["matrix_single", "matrix_multi", "matrix_mixed"];
const MULTI_CHOICE_TYPES: QuestionType[] = ["multi_choice"];
// この語を含むラベルの選択肢は複数選択で自動的に全排他(exclusive)にする（特になし等）。
const EXCLUSIVE_AUTO_LABEL_RE = /特になし|わからない|分からない|該当なし|その他/;
const SCREENING_CHOICE_QUESTION_TYPES: QuestionType[] = ["single_choice", "multi_choice"];

function buildQuestionConfigFromRequest(
  req: Request,
  questionType: QuestionType,
  existing: Question["question_config"] | null
) {
  const questionGoal = bodyString(req.body.question_goal).trim();
  const aiProbeEnabled = req.body.ai_probe_enabled === "on";
  if (aiProbeEnabled && !questionGoal) {
    throw new HttpError(400, "AI深掘り有効時は「この質問で知りたいこと」は必須です");
  }

  const extractionEnabled = req.body.extraction_enabled === "on";
  const extractionItems = normalizeTextList(bodyStringArray(req.body.extraction_items));
  const questionConfig: NonNullable<Question["question_config"]> =
    normalizeQuestionConfig(questionType, existing ?? {}) ?? {};

  if (CHOICE_QUESTION_TYPES.includes(questionType)) {
    const optionLabels = normalizeTextList(bodyStringArray(req.body.option_labels));
    const optionImageUrls = bodyStringArray(req.body.option_image_urls).map((u) => u.trim());
    const optionExtraImageUrls = bodyStringArray(req.body.option_extra_image_urls).map((s) =>
      s.trim().split("\n").map((u) => u.trim()).filter(Boolean)
    );
    const optionDescriptions = bodyStringArray(req.body.option_descriptions).map((d) => d.trim());
    const isScreeningQ = req.body.is_screening_question === "1";
    const screeningPassRaw = req.body.option_screening_pass;
    const screeningPassFlags: boolean[] = (() => {
      if (Array.isArray(screeningPassRaw)) return screeningPassRaw.map(v => v === "1");
      if (typeof screeningPassRaw === "string") return [screeningPassRaw === "1"];
      return [];
    })();
    questionConfig.options = optionLabels.map((label, i) => {
      const opt: import("../types/domain").QuestionOption = { label, value: label };
      const imageUrl = optionImageUrls[i] ?? "";
      const extraImages = optionExtraImageUrls[i] ?? [];
      const description = optionDescriptions[i] ?? "";
      if (imageUrl) opt.imageUrl = imageUrl;
      const allImages = [imageUrl, ...extraImages].filter(Boolean);
      if (allImages.length > 0) opt.imageUrls = allImages;
      if (description) opt.description = description;
      if (isScreeningQ) {
        opt.isScreeningPass = screeningPassFlags[i] === true;
      } else {
        delete opt.isScreeningPass;
      }
      return opt;
    });
    if (process.env.DEBUG_QUESTION_SAVE) {
      console.log("[question save debug] question_type:", questionType);
      console.log("[question save debug] raw options payload:", req.body.option_labels);
      console.log("[question save debug] normalized options:", JSON.stringify(questionConfig.options));
      console.log("[question save debug] valid options count:", (questionConfig.options ?? []).length);
    }
    // 選択肢ランダム化 (L3): ラベル名で指定（option.value === label）
    const splitList = (raw: unknown): string[] =>
      bodyString(raw)
        .split(/[\n,、]/)
        .map((s) => s.trim())
        .filter(Boolean);
    const optAnchors = splitList(req.body.option_anchors);
    const optFreeText = new Set(splitList(req.body.option_freetext_labels));
    const optGroups = bodyString(req.body.option_groups_text)
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const sep = line.indexOf(":");
        const colon = sep >= 0 ? sep : line.indexOf("：");
        const label = colon >= 0 ? line.slice(0, colon).trim() : "";
        const values = (colon >= 0 ? line.slice(colon + 1) : line)
          .split(/[,、]/)
          .map((s) => s.trim())
          .filter(Boolean);
        return { label, values };
      })
      .filter((group) => group.values.length > 0);
    const optRandEnabled = req.body.option_randomize_enabled === "1";
    if (optFreeText.size > 0 && questionConfig.options) {
      questionConfig.options = questionConfig.options.map((opt) =>
        optFreeText.has(opt.label) ? { ...opt, allow_free_text: true } : opt
      );
    }
    if (optRandEnabled || optGroups.length > 0 || optAnchors.length > 0) {
      questionConfig.option_randomization = {
        enabled: optRandEnabled,
        ...(optAnchors.length > 0 ? { anchored_values: optAnchors } : {}),
        ...(optGroups.length > 0 ? { groups: optGroups, randomize_groups: req.body.option_randomize_groups === "1" } : {})
      };
    }

    if (MULTI_CHOICE_TYPES.includes(questionType)) {
      const minSelect = parseOptionalInteger(req.body.min_select);
      const maxSelect = parseOptionalInteger(req.body.max_select);
      if (minSelect !== null) { questionConfig.min_select = minSelect; } else { delete questionConfig.min_select; }
      if (maxSelect !== null) { questionConfig.max_select = maxSelect; } else { delete questionConfig.max_select; }
    }

    // 排他制御 (multi_choice のみ・自動): ラベルが「特になし/わからない/該当なし/その他」
    // または自由記述(allow_free_text)の選択肢を、自動的に全排他(exclusive)にする。
    // 手動UIは廃止したため body からは読まない。exclusive_with は使用しない。
    if (MULTI_CHOICE_TYPES.includes(questionType) && questionConfig.options) {
      questionConfig.options = questionConfig.options.map((opt) => {
        const next = { ...opt };
        delete next.exclusive_with;
        if (EXCLUSIVE_AUTO_LABEL_RE.test(opt.label) || opt.allow_free_text === true) {
          next.exclusive = true;
        } else {
          delete next.exclusive;
        }
        return next;
      });
    }
  } else if (MATRIX_QUESTION_TYPES.includes(questionType)) {
    const rowLabels = parseLineSeparatedList(bodyString(req.body.matrix_rows));
    const colLabels = parseLineSeparatedList(bodyString(req.body.matrix_cols));
    if (rowLabels.length === 0) throw new HttpError(400, "マトリクスの行（row）を1つ以上設定してください。");
    if (colLabels.length === 0) throw new HttpError(400, "マトリクスの列（column）を1つ以上設定してください。");
    const rowImageUrls = bodyStringArray(req.body.matrix_row_image_urls).map((u) => u.trim());
    const rowExtraImageUrls = bodyStringArray(req.body.matrix_row_extra_image_urls).map((s) =>
      s.trim().split("\n").map((u) => u.trim()).filter(Boolean)
    );
    const rowDescriptions = bodyStringArray(req.body.matrix_row_descriptions).map((d) => d.trim());
    const colImageUrls = bodyStringArray(req.body.matrix_col_image_urls).map((u) => u.trim());
    const colExtraImageUrls = bodyStringArray(req.body.matrix_col_extra_image_urls).map((s) =>
      s.trim().split("\n").map((u) => u.trim()).filter(Boolean)
    );
    const colDescriptions = bodyStringArray(req.body.matrix_col_descriptions).map((d) => d.trim());
    questionConfig.options = rowLabels.map((label, i) => {
      const opt: import("../types/domain").QuestionOption = { label, value: label };
      const imageUrl = rowImageUrls[i] ?? "";
      const extraImages = rowExtraImageUrls[i] ?? [];
      const description = rowDescriptions[i] ?? "";
      if (imageUrl) opt.imageUrl = imageUrl;
      const allImages = [imageUrl, ...extraImages].filter(Boolean);
      if (allImages.length > 0) opt.imageUrls = allImages;
      if (description) opt.description = description;
      return opt;
    });
    (questionConfig as Record<string, unknown>).matrix_cols = colLabels.map((label, i) => {
      const entry: Record<string, unknown> = { label, value: label };
      const colImageUrl = colImageUrls[i] ?? "";
      const colExtraImages = colExtraImageUrls[i] ?? [];
      const colDescription = colDescriptions[i] ?? "";
      if (colImageUrl) entry.imageUrl = colImageUrl;
      const allColImages = [colImageUrl, ...colExtraImages].filter(Boolean);
      if (allColImages.length > 0) entry.imageUrls = allColImages;
      if (colDescription) entry.description = colDescription;
      return entry;
    });
    const headerMode = bodyString(req.body.matrix_header_mode).trim();
    if (headerMode === "vertical" || headerMode === "rotated") {
      questionConfig.matrix_header_mode = headerMode;
    } else {
      delete questionConfig.matrix_header_mode;
    }
  } else {
    switch (questionType) {
      case "text":
      case "free_text_short":
      case "free_text_long": {
        const placeholder = bodyString(req.body.placeholder).trim();
        if (placeholder) { questionConfig.placeholder = placeholder; } else { delete questionConfig.placeholder; }
        break;
      }
      case "scale":
        questionConfig.min = parseOptionalInteger(req.body.scale_min) ?? 1;
        questionConfig.max = parseOptionalInteger(req.body.scale_max) ?? 5;
        questionConfig.min_label = bodyString(req.body.scale_min_label).trim() || undefined;
        questionConfig.max_label = bodyString(req.body.scale_max_label).trim() || undefined;
        break;
      case "image_upload": {
        const maxCount = parseOptionalInteger(req.body.image_upload_max_count);
        const allowedTypesRaw = bodyString(req.body.image_upload_allowed_types).trim();
        const maxSizeMb = parseOptionalInteger(req.body.image_upload_max_size_mb);
        const instructions = bodyString(req.body.image_upload_instructions).trim();
        const textModeRaw = bodyString(req.body.image_upload_text_mode).trim();
        const textMode = (textModeRaw === 'optional' || textModeRaw === 'required') ? textModeRaw : undefined;
        questionConfig.image_upload_config = {
          max_count: maxCount ?? 1,
          allowed_types: allowedTypesRaw
            ? allowedTypesRaw.split(",").map((t) => t.trim()).filter(Boolean)
            : ["image/jpeg", "image/png", "image/webp"],
          max_size_mb: maxSizeMb ?? 10,
          instructions: instructions || undefined,
          text_input_mode: textMode,
        };
        break;
      }
      default:
        break;
    }
  }

  // 設問文画像（全設問タイプ共通）
  const qtImageUrl = bodyString(req.body.question_text_image_url).trim();
  const qtExtraUrls = bodyString(req.body.question_text_extra_image_urls).trim()
    .split("\n").map((u) => u.trim()).filter(Boolean);
  const qtCaption = bodyString(req.body.question_text_caption).trim();
  if (qtImageUrl || qtExtraUrls.length > 0 || qtCaption) {
    questionConfig.question_text_image = {
      mainUrl: qtImageUrl || null,
      additionalUrls: qtExtraUrls,
      caption: qtCaption || null,
    };
  } else {
    delete questionConfig.question_text_image;
  }

  // 選択肢系の display_format / grid_cols
  if (CHOICE_QUESTION_TYPES.includes(questionType)) {
    const displayFormat = bodyString(req.body.display_format).trim();
    if (displayFormat === "card") {
      questionConfig.display_format = "card";
      const gridCols = parseOptionalInteger(req.body.grid_cols);
      questionConfig.grid_cols = gridCols && gridCols > 0 ? gridCols : 2;
    } else {
      delete questionConfig.display_format;
      delete questionConfig.grid_cols;
    }
  }

  // 「その他（自由入力）」= select が __custom__ の場合は自由入力欄を採用（JS無効時のフォールバック）。
  const rawMetricCode =
    bodyString(req.body.metric_code) === "__custom__"
      ? req.body.metric_code_custom
      : req.body.metric_code;
  const metricCode = normalizeMetricCode(rawMetricCode);
  const meta = buildQuestionMetaFromAuthoringInput({
    questionGoal,
    extractionItemLabels: extractionEnabled ? extractionItems : [],
    maxProbes: parseOptionalInteger(req.body.max_probes),
    existingMeta: existing?.meta ?? null,
    metricCode,
    metricDirection: metricCode
      ? normalizeMetricDirection(req.body.metric_direction) ?? defaultMetricDirection(metricCode)
      : null
  });
  questionConfig.meta = meta;

  if (extractionEnabled && extractionItems.length > 0) {
    questionConfig.extraction = {
      mode: "single_object",
      target: "post_answer",
      schema: buildExtractionSchemaFromExpectedSlots(meta.expected_slots ?? []),
      extracted_branch_enabled: true
    };
  } else {
    delete questionConfig.extraction;
  }

  // 回答UI表示パターンの設問単位上書き（migration 075）。空=プロジェクトのプリセット準拠。
  // 既存 presentation.icons は UI 非対象のため保持する。
  const presPattern = bodyString(req.body.presentation_pattern).trim();
  const presScale = req.body.presentation_scale === "true" || req.body.presentation_scale === "on";
  const presSlider = req.body.presentation_slider === "true" || req.body.presentation_slider === "on";
  const existingIcons = existing?.presentation?.icons;
  if (presPattern || presScale || presSlider || (Array.isArray(existingIcons) && existingIcons.length > 0)) {
    const presentation: NonNullable<NonNullable<Question["question_config"]>["presentation"]> = {};
    if (presPattern) presentation.pattern = presPattern;
    if (presScale) presentation.scale = true;
    if (presSlider) presentation.slider = true;
    if (Array.isArray(existingIcons) && existingIcons.length > 0) presentation.icons = existingIcons;
    questionConfig.presentation = presentation;
  } else {
    delete questionConfig.presentation;
  }

  return questionConfig;
}

function parseBranchPrimitive(value: string): string | number | boolean {
  const normalized = value.trim();
  if (/^-?\d+(\.\d+)?$/.test(normalized)) {
    return Number(normalized);
  }
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  return normalized;
}

function buildBranchCondition(operator: QuestionBranchOperator, value: string) {
  const normalizedValue = value.trim();
  if (!normalizedValue) {
    throw new HttpError(400, "分岐条件の値を入力してください。");
  }

  switch (operator) {
    case "includes":
      return { includes: parseBranchPrimitive(normalizedValue) };
    case "any_of":
      return { any_of: normalizeTextList(normalizedValue.split(",")).map((item) => parseBranchPrimitive(item)) };
    case "gte":
      return { gte: Number(normalizedValue) };
    case "lte":
      return { lte: Number(normalizedValue) };
    default:
      return { equals: parseBranchPrimitive(normalizedValue) };
  }
}

function resolveExpectedSlotKeyByLabel(
  expectedSlots: NonNullable<NonNullable<Question["question_config"]>["meta"]>["expected_slots"],
  label: string
) {
  const normalizedLabel = label.trim();
  const matched = (expectedSlots ?? []).find(
    (slot) => slot.label?.trim() === normalizedLabel || slot.key === normalizedLabel
  );
  if (!matched) {
    throw new HttpError(400, `分岐項目が見つかりません: ${normalizedLabel}`);
  }
  return matched.key;
}

function buildBranchRuleFromRequest(
  req: Request,
  expectedSlots: NonNullable<NonNullable<Question["question_config"]>["meta"]>["expected_slots"]
): Question["branch_rule"] | null {
  const sources = bodyStringArray(req.body.branch_source);
  const fieldLabels = bodyStringArray(req.body.branch_field_label);
  const operators = bodyStringArray(req.body.branch_operator);
  const values = bodyStringArray(req.body.branch_value);
  const nextValues = bodyStringArray(req.body.branch_next);
  const rowCount = Math.max(sources.length, fieldLabels.length, operators.length, values.length, nextValues.length);
  const branches = Array.from({ length: rowCount }, (_unused, index) => {
    const next = (nextValues[index] ?? "").trim();
    const value = values[index] ?? "";
    if (!next || !value.trim()) {
      return null;
    }

    const source = (sources[index] === "extracted" ? "extracted" : "answer") as "answer" | "extracted";
    const fieldLabel = fieldLabels[index] ?? "";
    return {
      source,
      field: source === "extracted" ? resolveExpectedSlotKeyByLabel(expectedSlots, fieldLabel) : undefined,
      when: buildBranchCondition(parseQuestionBranchOperator(operators[index] ?? ""), value),
      next
    };
  }).filter((branch): branch is NonNullable<typeof branch> => Boolean(branch));

  return normalizeBranchRule(branches.length > 0 ? { branches } : null);
}

function slugifyQuestionCode(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

function buildQuestionCode(input: {
  requestedCode: string;
  questionText: string;
  sortOrder: number;
  existingQuestionCode?: string;
  existingQuestions: Question[];
  currentQuestionId?: string | null;
}): string {
  const requested = input.requestedCode.trim();
  if (requested) {
    return requested;
  }
  if (input.existingQuestionCode?.trim()) {
    return input.existingQuestionCode.trim();
  }

  const base = slugifyQuestionCode(input.questionText) || `q_${input.sortOrder}`;
  const normalizedBase = base.startsWith("q_") ? base : `q_${base}`;
  const existingCodes = new Set(
    input.existingQuestions
      .filter((question) => question.id !== input.currentQuestionId)
      .map((question) => question.question_code)
  );
  let candidate = normalizedBase;
  let suffix = 2;
  while (existingCodes.has(candidate)) {
    candidate = `${normalizedBase}_${suffix}`;
    suffix += 1;
  }
  return candidate;
}

async function validateQuestionDefinition(input: {
  projectId: string;
  questionId?: string | null;
  questionCode: string;
  questionType: QuestionType;
  questionConfig: Question["question_config"] | null;
  branchRule: Question["branch_rule"] | null;
}): Promise<void> {
  if (!input.questionCode.trim()) {
    throw new HttpError(400, "question_code は必須です。");
  }

  const existingQuestions = await questionRepository.listByProject(input.projectId, { includeHidden: true });
  const duplicate = existingQuestions.find(
    (question) => question.question_code === input.questionCode && question.id !== input.questionId
  );
  if (duplicate) {
    throw new HttpError(400, `question_code は同一プロジェクト内で一意にしてください: ${input.questionCode}`);
  }

  const configErrors = validateQuestionConfig(input.questionType, input.questionConfig);
  if (configErrors.length > 0) {
    throw new HttpError(400, configErrors[0] ?? "question_config が不正です。");
  }

  const allowedQuestionCodes = new Set(
    existingQuestions
      .filter((question) => !question.is_hidden || question.id === input.questionId)
      .map((question) => (question.id === input.questionId ? input.questionCode : question.question_code))
  );
  allowedQuestionCodes.add(input.questionCode);

  const branchErrors = validateBranchRule(input.branchRule, allowedQuestionCodes);
  if (branchErrors.length > 0) {
    throw new HttpError(400, branchErrors[0] ?? "branch_rule が不正です。");
  }
}

// ====================================================================
// セグメント条件評価ヘルパー（previewSegment / evaluateSegment 共用）
// ====================================================================

type SegCond = { field: string; op: string; value: unknown };
interface SegGroup { operator: "AND" | "OR"; conditions: SegCond[] }
interface NormConds { operator: "AND" | "OR"; groups: SegGroup[] }

function normalizeSegConds(raw: unknown): NormConds {
  const r = raw as Record<string, unknown>;
  if (Array.isArray(r.groups)) return r as unknown as NormConds;
  // 旧フォーマット: { operator, conditions[] }
  return {
    operator: (r.operator as "AND" | "OR") ?? "AND",
    groups: [{ operator: "AND" as const, conditions: (r.conditions as SegCond[]) ?? [] }],
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyProfileCond(query: any, c: SegCond): any {
  const { field, op, value } = c;
  switch (field) {
    case "gender":
      if (op === "eq")  return query.eq("gender", value);
      if (op === "neq") return query.neq("gender", value);
      if (op === "in" && Array.isArray(value)) return query.in("gender", value as string[]);
      break;
    case "prefecture":
      if (op === "in" && Array.isArray(value)) return query.in("prefecture", value as string[]);
      if (op === "eq")  return query.eq("prefecture", value);
      if (op === "neq") return query.neq("prefecture", value);
      break;
    case "age": {
      const today = new Date();
      const n = Number(value);
      if (op === "gte") {
        // age >= n → birth_date <= today - n年
        const d = new Date(today); d.setFullYear(d.getFullYear() - n);
        return query.lte("birth_date", d.toISOString().split("T")[0]);
      }
      if (op === "lte") {
        // age <= n → birth_date >= today - (n+1)年 + 1日
        const d = new Date(today); d.setFullYear(d.getFullYear() - n - 1); d.setDate(d.getDate() + 1);
        return query.gte("birth_date", d.toISOString().split("T")[0]);
      }
      if (op === "eq") {
        const dMax = new Date(today); dMax.setFullYear(dMax.getFullYear() - n);
        const dMin = new Date(today); dMin.setFullYear(dMin.getFullYear() - n - 1); dMin.setDate(dMin.getDate() + 1);
        return query
          .lte("birth_date", dMax.toISOString().split("T")[0])
          .gte("birth_date", dMin.toISOString().split("T")[0]);
      }
      break;
    }
    case "occupation":
      if (op === "eq")       return query.eq("occupation", value);
      if (op === "neq")      return query.neq("occupation", value);
      if (op === "contains") return query.ilike("occupation", `%${value}%`);
      break;
    case "industry":
      if (op === "eq")       return query.eq("industry", value);
      if (op === "neq")      return query.neq("industry", value);
      if (op === "contains") return query.ilike("industry", `%${value}%`);
      break;
    case "marital_status":
      if (op === "eq")  return query.eq("marital_status", value);
      if (op === "neq") return query.neq("marital_status", value);
      break;
    case "has_children":    return query.eq("has_children", value);
    case "is_blocked":      return query.eq("is_blocked", value);
    case "profile_completed": return query.eq("profile_completed", value);
    case "registered_at":
      if (op === "gte") return query.gte("created_at", value);
      if (op === "lte") return query.lte("created_at", value);
      break;
  }
  return query;
}

const PROFILE_FIELDS = new Set([
  "gender", "prefecture", "age", "occupation", "industry",
  "marital_status", "has_children", "is_blocked", "profile_completed", "registered_at",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function evalGroupIds(db: any, group: SegGroup): Promise<Set<string>> {
  const profConds = group.conditions.filter(c => PROFILE_FIELDS.has(c.field));
  const ptsConds  = group.conditions.filter(c => c.field === "total_points");

  // プロフィール条件 → user_profiles
  let profIds: Set<string> | null = null;
  if (profConds.length > 0 || ptsConds.length === 0) {
    if (group.operator === "AND") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = db.from("user_profiles").select("line_user_id");
      for (const c of profConds) q = applyProfileCond(q, c);
      const { data } = await q;
      profIds = new Set((data ?? []).map((r: any) => r.line_user_id as string));
    } else {
      profIds = new Set<string>();
      if (profConds.length === 0) {
        const { data } = await db.from("user_profiles").select("line_user_id");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data ?? []).forEach((r: any) => profIds!.add(r.line_user_id));
      } else {
        for (const c of profConds) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let q = db.from("user_profiles").select("line_user_id");
          q = applyProfileCond(q, c);
          const { data } = await q;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (data ?? []).forEach((r: any) => profIds!.add(r.line_user_id));
        }
      }
    }
  }

  // total_points 条件 → user_points
  let ptsIds: Set<string> | null = null;
  if (ptsConds.length > 0) {
    if (group.operator === "AND") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let q = db.from("user_points").select("line_user_id");
      for (const c of ptsConds) {
        if (c.op === "gte") q = q.gte("total_points", c.value);
        else if (c.op === "lte") q = q.lte("total_points", c.value);
        else if (c.op === "eq")  q = q.eq("total_points", c.value);
      }
      const { data } = await q;
      ptsIds = new Set((data ?? []).map((r: any) => r.line_user_id as string));
    } else {
      ptsIds = new Set<string>();
      for (const c of ptsConds) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q = db.from("user_points").select("line_user_id");
        if (c.op === "gte") q = q.gte("total_points", c.value);
        else if (c.op === "lte") q = q.lte("total_points", c.value);
        else if (c.op === "eq")  q = q.eq("total_points", c.value);
        const { data } = await q;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (data ?? []).forEach((r: any) => ptsIds!.add(r.line_user_id));
      }
    }
  }

  // 結合
  if (profIds === null && ptsIds === null) return new Set();
  if (profIds === null) return ptsIds!;
  if (ptsIds  === null) return profIds;
  if (group.operator === "AND") {
    return new Set([...profIds].filter(id => ptsIds!.has(id)));
  }
  for (const id of ptsIds!) profIds.add(id);
  return profIds;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function evaluateConditionsCount(db: any, rawConditions: unknown): Promise<number> {
  const norm = normalizeSegConds(rawConditions);

  // 高速パス: 単一グループ AND かつ全フィールドが user_profiles 上
  const firstGroup = norm.groups[0];
  if (
    norm.groups.length === 1 &&
    firstGroup &&
    firstGroup.operator === "AND" &&
    firstGroup.conditions.every(c => PROFILE_FIELDS.has(c.field))
  ) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q = db.from("user_profiles").select("line_user_id", { count: "exact", head: true });
    for (const c of firstGroup.conditions) q = applyProfileCond(q, c);
    const { count, error } = await q;
    if (error) throw new HttpError(500, error.message);
    return count ?? 0;
  }

  // 通常パス: グループごとに ID 集合を評価して結合
  const sets = await Promise.all(norm.groups.map(g => evalGroupIds(db, g)));
  if (sets.length === 0) return 0;

  if (norm.operator === "AND") {
    let result: Set<string> = sets[0] ?? new Set();
    for (let i = 1; i < sets.length; i++) {
      const next = sets[i] ?? new Set<string>();
      result = new Set([...result].filter(id => next.has(id)));
    }
    return result.size;
  }
  const result = new Set<string>();
  for (const s of sets) if (s) for (const id of s) result.add(id);
  return result.size;
}

function buildScheduleConfig(
  scheduleType: string,
  b: Record<string, string | string[]>
): import("../repositories/deliveryTemplateRepository").DeliveryScheduleConfig {
  if (scheduleType === "weekly") {
    return {
      weekday: Number(bodyString(b.schedule_weekday)) || 1,
      hour: Number(bodyString(b.schedule_hour)) || 9,
      minute: Number(bodyString(b.schedule_minute)) || 0,
    };
  }
  if (scheduleType === "interval") {
    return {
      interval_minutes: Number(bodyString(b.schedule_interval_minutes)) || 60,
    };
  }
  // daily (default)
  return {
    hour: Number(bodyString(b.schedule_hour)) || 9,
    minute: Number(bodyString(b.schedule_minute)) || 0,
  };
}

export const adminController = {
  async dashboard(_req: Request, res: Response): Promise<void> {
    const stats = await adminService.dashboard();
    res.render("admin/dashboard", { title: "Dashboard", stats });
  },

  async projects(req: Request, res: Response): Promise<void> {
    const projects = await adminService.listProjects();
    renderProjectsIndex(res, {
      projects,
      notice: req.query.notice
    });
  },

  async newProject(_req: Request, res: Response): Promise<void> {
    renderProjectResearchForm(res, {
      title: "新規プロジェクト作成",
      project: null,
      action: "/admin/projects"
    });
  },

  async createProject(req: Request, res: Response): Promise<void> {
    try {
      const researchMode = parseResearchMode(bodyString(req.body.research_mode));
      const name = bodyString(req.body.name);
      const objective = bodyString(req.body.objective) || null;
      const comparisonConstraints = parseLineSeparatedList(bodyString(req.body.comparison_constraints));
      const deepProbeEnabled = req.body.deep_probe_enabled === "on";
      const maxProbeDepth = Math.max(0, parseOptionalInteger(req.body.max_probe_depth) ?? (deepProbeEnabled ? 1 : 0));
      const displayStyle = parseProjectDisplayStyle(bodyString(req.body.display_style));
      const aiStateTemplateKey = null;
      // Phase G: 新規プロジェクトの既定モードは package（Package First）
      const aiPromptMode = parseAIPromptModeFromRequest(req, 'package');
      // Phase C: 新規作成は package 中心導線。選択可能パッケージがあるのに未選択ならブロック。
      const { versionId: packageVersionId, errorMessage: pkgError, warnings: pkgWarnings } =
        await resolvePackageVersionIdFromRequest(req, aiPromptMode, { blockIfUnselected: true });
      if (pkgError) throw new HttpError(400, pkgError);

      const created = await projectRepository.create({
        name,
        user_display_title: bodyString(req.body.user_display_title) || null,
        client_name: bodyString(req.body.client_name) || null,
        objective,
        status: bodyString(req.body.status || "draft") as import("../types/domain").ProjectStatus,
        reward_points: numberField(req.body.reward_points),
        research_mode: researchMode,
        primary_objectives: objective ? [objective] : [],
        secondary_objectives: [],
        comparison_constraints: comparisonConstraints,
        prompt_rules: [],
        probe_policy: buildProjectProbePolicyFromSimpleInput({
          deepProbeEnabled,
          maxProbeDepth
        }),
        response_style: buildProjectResponseStyleFromSimpleInput(displayStyle),
        ai_state_template_key: aiStateTemplateKey,
        ai_state_json: buildProjectAiStateFromRequest({
          req,
          fallbackProject: {
            name,
            objective,
            research_mode: researchMode,
            primary_objectives: objective ? [objective] : [],
            secondary_objectives: [],
            ai_state_template_key: aiStateTemplateKey
          }
        }),
        ai_state_generated_at: new Date().toISOString(),
        screening_config: buildScreeningConfig(req),
        screening_last_question_order: null,
        // Phase B: プロジェクト個別の policy / override 編集UIは撤去。プロンプトの真実はパッケージ側。
        ai_prompt_policy_json: null,
        // Phase 6-A: テンプレート編集はパッケージ画面に集約（プロジェクト編集UIから撤去）
        ai_prompt_templates_json: null,
        ai_prompt_mode: aiPromptMode,
        ai_prompt_package_version_id: packageVersionId,
        ai_prompt_overrides_json: null,
      });
      try {
        const { screeningConditionRepository: scRepo } = await import("../repositories/screeningConditionRepository");
        await scRepo.replaceProfileConditions(created.id, buildProfileConditionsFromRequest(req));
      } catch (screeningError) {
        logger.error("createProject: screening_conditions save failed", {
          projectId: created.id,
          error: screeningError instanceof Error ? screeningError.message : String(screeningError)
        });
      }
      // Phase G: package モードでバージョン未選択のまま作成された場合は、
      // 編集画面（警告パネル＋パッケージ選択あり）へ誘導して明確に警告する
      if (aiPromptMode === 'package' && !packageVersionId && pkgWarnings.length > 0) {
        res.redirect(`/admin/projects/${created.id}/edit?notice=prompt_package_unset#ai-prompt-section`);
        return;
      }
      res.redirect(`/admin/projects/${created.id}/questions`);
    } catch (error) {
      const { promptPackageRepository } = await import("../repositories/promptPackageRepository").catch(() => ({ promptPackageRepository: { list: async () => [] } }));
      const promptPackages = await promptPackageRepository.list().catch(() => []);
      renderProjectResearchForm(res, {
        title: "新規プロジェクト作成",
        project: null,
        action: "/admin/projects",
        projectFormOverrides: buildProjectFormOverridesFromRequest(req),
        errorMessage: getProjectRenderErrorMessage(error, "プロジェクトの作成に失敗しました。"),
        statusCode: getProjectRenderStatusCode(error),
        promptPackages,
      });
    }
  },

  async editProject(req: Request, res: Response): Promise<void> {
    const project = await projectRepository.getById(routeParam(req, "projectId"));
    const { screeningConditionRepository } = await import("../repositories/screeningConditionRepository");
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const [conditions, allQuestions, promptPackages] = await Promise.all([
      screeningConditionRepository.listByProject(project.id),
      questionRepository.listByProject(project.id, { includeHidden: false }),
      promptPackageRepository.list(),
    ]);
    const screeningQuestions = allQuestions.filter(q => q.question_role === "screening");
    const validation = validateAIPromptTemplates(
      project.ai_prompt_templates_json as import("../types/domain").AIPromptTemplateMap | null
    );

    // archived バージョンを使用中かチェック → fallback 先バージョンを警告として渡す
    let packageFallbackWarning: import("../repositories/promptPackageRepository").PromptPackageVersion | null = null;
    if (project.ai_prompt_mode === "package" && project.ai_prompt_package_version_id) {
      const currentVersion = await promptPackageRepository.getVersionById(project.ai_prompt_package_version_id);
      if (currentVersion?.status === "archived") {
        packageFallbackWarning = await promptPackageRepository.getPublishedVersionByPackageId(currentVersion.package_id);
      }
    }

    renderProjectResearchForm(res, {
      title: "プロジェクト編集",
      project,
      action: `/admin/projects/${project.id}`,
      successMessage: resolveNoticeMessage(req.query.notice),
      templateErrors: validation.errors,
      templateWarnings: validation.warnings,
      screeningConditions: conditions,
      screeningQuestions,
      promptPackages,
      packageFallbackWarning,
    });
  },

  async updateProject(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const existing = await projectRepository.getById(projectId);
    try {
      const researchMode = parseResearchMode(bodyString(req.body.research_mode));
      const name = bodyString(req.body.name);
      const objective = bodyString(req.body.objective) || null;
      const comparisonConstraints = parseLineSeparatedList(bodyString(req.body.comparison_constraints));
      const deepProbeEnabled = req.body.deep_probe_enabled === "on";
      const maxProbeDepth = Math.max(0, parseOptionalInteger(req.body.max_probe_depth) ?? (deepProbeEnabled ? 1 : 0));
      const displayStyle = parseProjectDisplayStyle(bodyString(req.body.display_style));
      const aiStateTemplateKey = existing.ai_state_template_key ?? null;
      // Phase G: 更新時はフィールド未指定なら既存モードを維持
      const aiPromptMode = parseAIPromptModeFromRequest(req, existing.ai_prompt_mode);
      const { versionId: packageVersionId, errorMessage: pkgError } =
        await resolvePackageVersionIdFromRequest(req, aiPromptMode);
      if (pkgError) throw new HttpError(400, pkgError);
      const aiStateJson = buildProjectAiStateFromRequest({
        req,
        fallbackProject: {
          name,
          objective,
          research_mode: researchMode,
          primary_objectives: objective ? [objective] : [],
          secondary_objectives: [],
          ai_state_template_key: aiStateTemplateKey
        },
        existingAiState: existing.ai_state_json
      });

      await projectRepository.update(projectId, {
        name,
        user_display_title: bodyString(req.body.user_display_title) || null,
        client_name: bodyString(req.body.client_name) || null,
        objective,
        status: bodyString(req.body.status || "draft") as import("../types/domain").ProjectStatus,
        reward_points: numberField(req.body.reward_points),
        research_mode: researchMode,
        primary_objectives: objective ? [objective] : [],
        secondary_objectives: [],
        comparison_constraints: comparisonConstraints,
        prompt_rules: [],
        probe_policy: buildProjectProbePolicyFromSimpleInput({
          deepProbeEnabled,
          maxProbeDepth,
          existing: existing.probe_policy
        }),
        response_style: buildProjectResponseStyleFromSimpleInput(displayStyle),
        ai_state_template_key: aiStateTemplateKey,
        ai_state_json: aiStateJson,
        ai_state_generated_at: new Date().toISOString(),
        screening_config: buildScreeningConfig(req),
        screening_last_question_order: existing.screening_last_question_order ?? null,
        is_discoverable: req.body.is_discoverable === "true" || req.body.is_discoverable === "on",
        randomize_question_order: req.body.randomize_question_order === "true" || req.body.randomize_question_order === "on",
        answer_ui_preset: (["casual", "standard", "formal"] as const).includes(
          bodyString(req.body.answer_ui_preset) as "casual" | "standard" | "formal",
        )
          ? (bodyString(req.body.answer_ui_preset) as "casual" | "standard" | "formal")
          : "standard",
        category: bodyString(req.body.category) || null,
        estimated_minutes: parseOptionalInteger(req.body.estimated_minutes) ?? null,
        max_respondents: parseOptionalInteger(req.body.max_respondents) ?? null,
        visibility_type: bodyString(req.body.visibility_type) === "private_store" ? "private_store" : "public",
        entry_code: bodyString(req.body.visibility_type) === "private_store"
          ? (bodyString(req.body.entry_code) || null)
          : null,
        apply_mode: bodyString(req.body.apply_mode) === "auto" ? "auto" : "manual",
        tags: bodyString(req.body.tags)
          .split(",")
          .map((t) => t.trim())
          .filter((t) => t.length > 0),
        ng_conditions: bodyString(req.body.ng_conditions).trim() || null,
        // datetime-local はタイムゾーンなしのJST入力 → UTCへ変換して保存
        recruit_deadline: bodyString(req.body.recruit_deadline)
          ? new Date(new Date(`${bodyString(req.body.recruit_deadline)}:00+09:00`).getTime()).toISOString()
          : null,
        interview_format: bodyString(req.body.interview_format).trim() || null,
        delivery_enabled: req.body.delivery_enabled === "true" || req.body.delivery_enabled === "on",
        delivery_type: (bodyString(req.body.delivery_type) || null) as import("../types/domain").DeliveryType | null,
        // Phase B: プロジェクト個別の policy / override 編集UIは撤去。編集はせず既存値を保全する
        // （legacy custom プロジェクトのデータ保護。真実はパッケージバージョン側へ寄せる）。
        ai_prompt_policy_json: existing.ai_prompt_policy_json ?? null,
        // Phase 6-A: テンプレート編集UIは撤去済み。custom モード継続プロジェクトの
        // 既存テンプレート設定を壊さないよう、保存済みの値をそのまま保持する
        ai_prompt_templates_json: existing.ai_prompt_templates_json ?? null,
        ai_prompt_mode: aiPromptMode,
        ai_prompt_package_version_id: packageVersionId,
        ai_prompt_overrides_json: existing.ai_prompt_overrides_json ?? null,
      });

      // パッケージ設定が変更された場合に変更ログを保存
      const packageChanged =
        existing.ai_prompt_mode !== aiPromptMode ||
        existing.ai_prompt_package_version_id !== packageVersionId;
      if (packageChanged) {
        await recordPackageChangeLog({
          projectId,
          oldVersionId: existing.ai_prompt_package_version_id ?? null,
          newVersionId: packageVersionId,
          oldMode: existing.ai_prompt_mode ?? null,
          newMode: aiPromptMode,
          changeReason: bodyString(req.body.package_change_reason) || null,
          changedBy: resolveAdminOperator(req),
        });
      }

      try {
        const { screeningConditionRepository: scRepo } = await import("../repositories/screeningConditionRepository");
        await scRepo.replaceProfileConditions(projectId, buildProfileConditionsFromRequest(req));
      } catch (screeningError) {
        logger.error("updateProject: screening_conditions save failed", {
          projectId,
          error: screeningError instanceof Error ? screeningError.message : String(screeningError)
        });
      }
      res.redirect(buildProjectEditRedirectPath(projectId, "project_updated"));
    } catch (error) {
      let updateErrorConditions: import("../types/domain").ScreeningCondition[] = [];
      let updateErrorScreeningQuestions: import("../types/domain").Question[] = [];
      let updateErrorPromptPackages: import("../repositories/promptPackageRepository").PromptPackage[] = [];
      try {
        const { screeningConditionRepository } = await import("../repositories/screeningConditionRepository");
        const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
        const [conds, allQs, pkgs] = await Promise.all([
          screeningConditionRepository.listByProject(projectId),
          questionRepository.listByProject(projectId, { includeHidden: false }),
          promptPackageRepository.list(),
        ]);
        updateErrorConditions = conds;
        updateErrorScreeningQuestions = allQs.filter(q => q.question_role === "screening");
        updateErrorPromptPackages = pkgs;
      } catch {
        // DB 未準備の場合は空配列のまま
      }
      renderProjectResearchForm(res, {
        title: "プロジェクト編集",
        project: existing,
        action: `/admin/projects/${projectId}`,
        projectFormOverrides: buildProjectFormOverridesFromRequest(req),
        errorMessage: getProjectRenderErrorMessage(error, "プロジェクトの更新に失敗しました。"),
        statusCode: getProjectRenderStatusCode(error),
        screeningConditions: updateErrorConditions,
        screeningQuestions: updateErrorScreeningQuestions,
        promptPackages: updateErrorPromptPackages,
      });
    }
  },

  async questions(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const project = await projectRepository.getById(projectId);
    const questions = await adminService.listQuestions(projectId);
    res.render("admin/questions/indexDesigner", { title: "質問一覧", project, questions });
  },

  async newQuestion(req: Request, res: Response): Promise<void> {
    const project = await projectRepository.getById(routeParam(req, "projectId"));
    const [availableQuestions, pageGroups, nextSortOrder] = await Promise.all([
      questionRepository.listByProject(project.id),
      questionPageGroupRepository.listByProject(project.id),
      questionRepository.getNextSortOrder(project.id),
    ]);
    renderQuestionForm(res, {
      title: "質問作成",
      project,
      question: null,
      action: `/admin/projects/${project.id}/questions`,
      formValues: buildQuestionFormValues(null, { sort_order_text: String(nextSortOrder) }),
      availableQuestions,
      pageGroups,
    });
  },

  async createQuestion(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const [project, availableQuestions, pageGroups] = await Promise.all([
      projectRepository.getById(projectId),
      questionRepository.listByProject(projectId, { includeHidden: true }),
      questionPageGroupRepository.listByProject(projectId),
    ]);

    try {
      const questionType = parseQuestionType(bodyString(req.body.question_type || "free_text_short"));
      const questionConfig = buildQuestionConfigFromRequest(req, questionType, null);
      const sortOrder = numberField(req.body.sort_order, await questionRepository.getNextSortOrder(projectId));
      const questionCode = buildQuestionCode({
        requestedCode: bodyString(req.body.question_code),
        questionText: bodyString(req.body.question_text),
        sortOrder,
        existingQuestions: availableQuestions
      });
      const branchRule = buildBranchRuleFromRequest(req, questionConfig.meta?.expected_slots ?? []);

      await validateQuestionDefinition({
        projectId,
        questionCode,
        questionType,
        questionConfig,
        branchRule
      });

      const createIsScreeningQuestion = req.body.is_screening_question === "1";
      const createQuestionRole = createIsScreeningQuestion
        ? "screening" as const
        : parseQuestionRole(bodyString(req.body.question_role));
      if (createIsScreeningQuestion && SCREENING_CHOICE_QUESTION_TYPES.includes(questionType)) {
        const passCount = (questionConfig.options ?? []).filter(o => o.isScreeningPass).length;
        if (passCount === 0) throw new HttpError(400, "スクリーニング設問には最低1つ以上の通過対象回答を設定してください。");
      }
      const createMaxProbeCount = parseOptionalInteger(bodyString(req.body.max_probe_count));
      const createTagFields = buildTagFieldsFromRequest(req);
      await questionRepository.create({
        project_id: projectId,
        question_code: questionCode,
        question_text: bodyString(req.body.question_text),
        question_role: createQuestionRole,
        question_type: questionType,
        is_required: req.body.is_required === "on",
        sort_order: sortOrder,
        branch_rule: branchRule,
        question_config: questionConfig,
        ai_probe_enabled: req.body.ai_probe_enabled === "on",
        probe_guideline: bodyString(req.body.probe_guideline) || null,
        max_probe_count: createMaxProbeCount,
        render_strategy: bodyString(req.body.render_strategy) === "dynamic" ? "dynamic" : "static",
        is_screening_question: createIsScreeningQuestion,
        ...createTagFields,
      });

      res.redirect(`/admin/projects/${projectId}/questions`);
    } catch (error) {
      renderQuestionForm(res, {
        title: "質問作成",
        project,
        question: null,
        action: `/admin/projects/${project.id}/questions`,
        formValues: buildQuestionFormValues(null, buildQuestionFormValuesFromRequest(req)),
        availableQuestions,
        pageGroups,
        errorMessage: getProjectRenderErrorMessage(error, "質問の作成に失敗しました。"),
        statusCode: getProjectRenderStatusCode(error)
      });
    }
  },

  async editQuestion(req: Request, res: Response): Promise<void> {
    const question = await questionRepository.getById(routeParam(req, "questionId"));
    const [project, availableQuestions, pageGroups] = await Promise.all([
      projectRepository.getById(question.project_id),
      questionRepository.listByProject(question.project_id),
      questionPageGroupRepository.listByProject(question.project_id),
    ]);
    const currentIndex = availableQuestions.findIndex(q => q.id === question.id);
    const prevQ = currentIndex > 0 ? availableQuestions[currentIndex - 1] : undefined;
    const nextQ = currentIndex !== -1 && currentIndex < availableQuestions.length - 1 ? availableQuestions[currentIndex + 1] : undefined;
    const prevQuestion = prevQ ? { id: prevQ.id, question_code: prevQ.question_code } : null;
    const nextQuestion = nextQ ? { id: nextQ.id, question_code: nextQ.question_code } : null;
    renderQuestionForm(res, {
      title: "質問編集",
      project,
      question,
      action: `/admin/questions/${question.id}`,
      formValues: buildQuestionFormValues(question),
      availableQuestions,
      pageGroups,
      successMessage: resolveNoticeMessage(req.query.notice),
      prevQuestion,
      nextQuestion,
    });
  },

  async projectPromptPackageHistoryPage(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const { projectPromptPackageChangeLogRepository } = await import("../repositories/projectPromptPackageChangeLogRepository");
    const [project, logs] = await Promise.all([
      projectRepository.getById(projectId),
      projectPromptPackageChangeLogRepository.listByProject(projectId),
    ]);

    // Phase 5-C: 各ログのバージョンの現在ステータスを付与（ログはスナップショットのため status は現時点の値）
    const versionStatusById = new Map<string, string>();
    const versionIds = [...new Set(
      logs.flatMap((l) => [l.old_prompt_package_version_id, l.new_prompt_package_version_id])
        .filter((id): id is string => !!id)
    )];
    if (versionIds.length > 0) {
      try {
        const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
        await Promise.all(versionIds.map(async (id) => {
          const v = await promptPackageRepository.getVersionById(id).catch(() => null);
          if (v) versionStatusById.set(id, v.status);
        }));
      } catch {
        // ステータスが取得できなくても履歴自体は表示する
      }
    }

    res.render("admin/projects/prompt-package-history", {
      title: `AIプロンプト変更履歴: ${project.name}`,
      project,
      logs,
      versionStatusById,
    });
  },

  async copyProject(req: Request, res: Response): Promise<void> {
    const copied = await projectRepository.copyProject(routeParam(req, "projectId"));
    res.redirect(buildProjectEditRedirectPath(copied.id, "project_copied"));
  },

  async deleteProject(req: Request, res: Response): Promise<void> {
    const result = await projectRepository.deleteById(routeParam(req, "projectId"));
    res.redirect(`/admin/projects?notice=${result.mode === "archived" ? "project_archived" : "project_deleted"}`);
  },

  async updateQuestion(req: Request, res: Response): Promise<void> {
    const questionId = routeParam(req, "questionId");
    const existing = await questionRepository.getById(questionId);
    const [project, availableQuestions, pageGroups] = await Promise.all([
      projectRepository.getById(existing.project_id),
      questionRepository.listByProject(existing.project_id, { includeHidden: true }),
      questionPageGroupRepository.listByProject(existing.project_id),
    ]);

    try {
      const questionType = parseQuestionType(bodyString(req.body.question_type || "free_text_short"));
      const questionConfig = buildQuestionConfigFromRequest(req, questionType, existing.question_config);
      const sortOrder = numberField(req.body.sort_order, existing.sort_order);
      const questionCode = buildQuestionCode({
        requestedCode: bodyString(req.body.question_code),
        questionText: bodyString(req.body.question_text),
        sortOrder,
        existingQuestionCode: existing.question_code,
        existingQuestions: availableQuestions,
        currentQuestionId: questionId
      });
      const branchRule = buildBranchRuleFromRequest(req, questionConfig.meta?.expected_slots ?? []);

      await validateQuestionDefinition({
        projectId: existing.project_id,
        questionId,
        questionCode,
        questionType,
        questionConfig,
        branchRule
      });

      const updateIsScreeningQuestion = req.body.is_screening_question === "1";
      const updateQuestionRole = updateIsScreeningQuestion
        ? "screening" as const
        : parseQuestionRole(bodyString(req.body.question_role));
      if (updateIsScreeningQuestion && SCREENING_CHOICE_QUESTION_TYPES.includes(questionType)) {
        const passCount = (questionConfig.options ?? []).filter(o => o.isScreeningPass).length;
        if (passCount === 0) throw new HttpError(400, "スクリーニング設問には最低1つ以上の通過対象回答を設定してください。");
      }
      const updateMaxProbeCount = parseOptionalInteger(bodyString(req.body.max_probe_count));
      const updateTagFields = buildTagFieldsFromRequest(req);
      await questionRepository.update(questionId, {
        question_code: questionCode,
        question_text: bodyString(req.body.question_text),
        question_role: updateQuestionRole,
        question_type: questionType,
        is_required: req.body.is_required === "on",
        sort_order: sortOrder,
        branch_rule: branchRule,
        question_config: questionConfig,
        ai_probe_enabled: req.body.ai_probe_enabled === "on",
        is_screening_question: updateIsScreeningQuestion,
        probe_guideline: bodyString(req.body.probe_guideline) || null,
        max_probe_count: updateMaxProbeCount,
        render_strategy: bodyString(req.body.render_strategy) === "dynamic" ? "dynamic" : "static",
        ...updateTagFields,
      });

      res.redirect(`/admin/projects/${existing.project_id}/questions`);
    } catch (error) {
      renderQuestionForm(res, {
        title: "質問編集",
        project,
        question: existing,
        action: `/admin/questions/${existing.id}`,
        formValues: buildQuestionFormValues(existing, buildQuestionFormValuesFromRequest(req)),
        availableQuestions,
        pageGroups,
        errorMessage: getProjectRenderErrorMessage(error, "質問の更新に失敗しました。"),
        statusCode: getProjectRenderStatusCode(error)
      });
    }
  },

  async respondents(_req: Request, res: Response): Promise<void> {
    const respondents = await adminService.listRespondents();
    res.render("admin/respondents/index", { title: "Respondents", respondents });
  },

  async projectRespondents(req: Request, res: Response): Promise<void> {
    const detail = await adminService.listProjectRespondents(routeParam(req, "projectId"));
    res.render("admin/projects/respondents", {
      title: "Project Respondents",
      ...detail
    });
  },

  async projectDelivery(req: Request, res: Response): Promise<void> {
    const detail = await adminService.projectDelivery(routeParam(req, "projectId"));
    res.render("admin/projects/deliveryV2", {
      title: "Project Delivery",
      appBaseUrl: appEnv.APP_BASE_URL,
      ...detail
    });
  },

  async assignProjectManual(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const deliveryChannel: "liff" | "line" =
      req.body.use_liff_delivery === "on" ? "liff" : "line";
    await assignmentService.assignManual({
      projectId,
      sourceRespondentIds: bodyStringArray(req.body.selected_respondent_ids),
      deadline: parseNullableDateTime(req.body.deadline),
      deliveryChannel
    });
    res.redirect(`/admin/projects/${projectId}/delivery`);
  },

  async assignProjectByRules(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    await assignmentService.assignByRules({
      projectId,
      rule: parseAssignmentRule(req),
      deadline: parseNullableDateTime(req.body.rule_deadline)
    });
    res.redirect(`/admin/projects/${projectId}/delivery`);
  },

  async sendProjectReminders(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    await assignmentService.sendReminders(projectId);
    res.redirect(`/admin/projects/${projectId}/delivery`);
  },

  async respondentDetail(req: Request, res: Response): Promise<void> {
    const detail = await adminService.respondentDetail(routeParam(req, "respondentId"));
    res.render("admin/respondents/show", { title: "Respondent Detail", ...detail });
  },

  async posts(req: Request, res: Response): Promise<void> {
    const filters = buildPostFilters(req);
    const [rows, projects] = await Promise.all([
      adminService.listPosts(filters),
      adminService.listProjects()
    ]);

    res.render("admin/posts/index", {
      title: "Posts",
      rows,
      tagSummary: adminService.summarizeTags(rows),
      projects,
      filters
    });
  },

  async postDetail(req: Request, res: Response): Promise<void> {
    const detail = await adminService.getPostDetail(routeParam(req, "postId"));
    if (!detail) {
      throw new HttpError(404, "Post not found");
    }

    res.render("admin/posts/show", {
      title: "Post Detail",
      detail,
      from: queryString(req.query.from) || "posts"
    });
  },

  async postAnalysis(req: Request, res: Response): Promise<void> {
    const filters = buildPostAnalysisFilters(req);
    const [rows, projects] = await Promise.all([
      adminService.listPostAnalysis(filters),
      adminService.listProjects()
    ]);

    res.render("admin/postAnalysis/index", {
      title: "Post Analysis",
      rows,
      tagSummary: adminService.summarizeTags(rows),
      projects,
      filters
    });
  },

  async sessionDetail(req: Request, res: Response): Promise<void> {
    const detail = await adminService.sessionDetail(routeParam(req, "sessionId"));
    res.render("admin/sessions/show", {
      title: "Session Detail",
      ...detail
    });
  },

  async projectAnalysis(req: Request, res: Response): Promise<void> {
    const detail = await adminService.projectAnalysis(routeParam(req, "projectId"));
    res.render("admin/projects/analysis", {
      title: "Project Analysis",
      ...detail
    });
  },

  async runProjectAnalysis(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    await analysisService.generateProjectAnalysisReport(projectId);
    res.redirect(`/admin/projects/${projectId}/analysis`);
  },

  async points(_req: Request, res: Response): Promise<void> {
    let summaries: Awaited<ReturnType<typeof userPointService.listSummaries>> = [];
    let fetchError: string | null = null;
    try {
      summaries = await userPointService.listSummaries(500);
    } catch (err) {
      logger.error("Failed to fetch point summaries", {
        error: String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
      fetchError = "ポイント情報の取得に失敗しました。管理者へお問い合わせください。";
    }
    res.render("admin/points/index", {
      title: "ポイント管理",
      summaries,
      fetchError
    });
  },

  async adjustUserPoints(req: Request, res: Response): Promise<void> {
    const lineUserId = routeParam(req, "lineUserId");
    const b = req.body as Record<string, string>;
    const points = Number(b.points);
    const reason = bodyString(b.reason) || "管理者調整";
    if (isNaN(points) || points === 0) {
      res.redirect("/admin/points");
      return;
    }
    await userPointService.awardPoints({
      lineUserId,
      transactionType: "manual_adjustment",
      points,
      reason,
      referenceType: "manual"
    });
    res.redirect("/admin/points");
  },

  async badgesPage(_req: Request, res: Response): Promise<void> {
    const [badges, userSummaries, awardCounts] = await Promise.all([
      userBadgeService.listAllDefinitions(),
      userBadgeService.listUserBadgeSummary(),
      userBadgeService.getAwardCounts()
    ]);
    res.render("admin/badges/index", {
      title: "バッジ管理",
      badges,
      userSummaries: userSummaries.slice(0, 50),
      awardCounts
    });
  },

  async updateBadgeStatus(req: Request, res: Response): Promise<void> {
    const badgeId = routeParam(req, "badgeId");
    const isActive = req.body.isActive === true || req.body.isActive === "true";
    logger.info("[badge] updateStatus start", { badgeId, isActive });
    try {
      await userBadgeService.updateStatus(badgeId, isActive);
      logger.info("[badge] updateStatus ok", { badgeId, isActive });
      res.json({ ok: true });
    } catch (err) {
      logger.error("[badge] updateStatus failed", {
        badgeId,
        isActive,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined
      });
      const statusCode = err instanceof HttpError ? err.statusCode : 500;
      res.status(statusCode).json({ ok: false, error: err instanceof Error ? err.message : "更新に失敗しました" });
    }
  },

  async adjustPoints(req: Request, res: Response): Promise<void> {
    const respondentId = routeParam(req, "respondentId");
    await pointService.manualAdjust({
      respondentId,
      points: numberField(req.body.points),
      reason: bodyString(req.body.reason || "Manual adjustment")
    });
    res.redirect(`/admin/respondents/${respondentId}`);
  },

  async ranks(_req: Request, res: Response): Promise<void> {
    const ranks = await adminService.listRanks();
    res.render("admin/ranks/index", { title: "Ranks", ranks });
  },

  async updateRank(req: Request, res: Response): Promise<void> {
    await rankRepository.updateThreshold(routeParam(req, "rankId"), {
      min_points: numberField(req.body.min_points),
      badge_label: bodyString(req.body.badge_label) || null
    });
    res.redirect("/admin/ranks");
  },

  async exportAnswers(_req: Request, res: Response): Promise<void> {
    res.type("text/csv").send(await csvService.answersCsv());
  },

  async exportMessages(_req: Request, res: Response): Promise<void> {
    res.type("text/csv").send(await csvService.messagesCsv());
  },

  async exportAnalysis(_req: Request, res: Response): Promise<void> {
    res.type("text/csv").send(await csvService.analysisCsv());
  },

  async exportPoints(_req: Request, res: Response): Promise<void> {
    res.type("text/csv").send(await csvService.pointsCsv());
  },

  async exportRanks(_req: Request, res: Response): Promise<void> {
    res.type("text/csv").send(await csvService.ranksCsv());
  },

  async exportUserPosts(req: Request, res: Response): Promise<void> {
    res.type("text/csv").send(await csvService.userPostsCsv(buildPostFilters(req)));
  },

  async exportPostAnalysis(req: Request, res: Response): Promise<void> {
    res.type("text/csv").send(await csvService.postAnalysisCsv(buildPostAnalysisFilters(req)));
  },

  async exportProjectRespondents(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const columnKey =
      bodyString(req.query.column) === "question_order" ? "question_order" : "question_code";
    res
      .type("text/csv")
      .send(await csvService.projectRespondentsCsv(projectId, columnKey));
  },

  async exportProjectAssignments(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    res.type("text/csv").send(await csvService.projectAssignmentsCsv(projectId));
  },

  async exportProjectUnansweredAssignments(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    res.type("text/csv").send(await csvService.unansweredAssignmentsCsv(projectId));
  },

  async exportProjectExpiredAssignments(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    res.type("text/csv").send(await csvService.expiredAssignmentsCsv(projectId));
  },

  // ------------------------------------------------------------------
  // 統計向けエクスポート (§11)。既存CSVは変更せず追加 (§12)。
  // 出力は UTF-8 BOM + RFC4180 (§21)。respondent_key は擬似匿名 (§19)。
  // ------------------------------------------------------------------
  sendStatCsv(res: Response, filename: string, body: string): void {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename=${filename}`);
    res.send(body);
  },

  statExportOptions(req: Request): { excludeTest: boolean; consentedOnly: boolean; consentDocType?: string } {
    return {
      excludeTest: bodyString(req.query.includeTest) !== "1",
      consentedOnly: bodyString(req.query.consentedOnly) === "1",
      consentDocType: bodyString(req.query.consentDocType) || undefined
    };
  },

  async exportStatRespondentsWide(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    adminController.sendStatCsv(
      res,
      "respondents_wide.csv",
      await statExportService.respondentsWideCsv(projectId, adminController.statExportOptions(req))
    );
  },

  async exportStatAnswersLong(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    adminController.sendStatCsv(
      res,
      "answers_long.csv",
      await statExportService.answersLongCsv(projectId, adminController.statExportOptions(req))
    );
  },

  async exportStatCodebook(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    adminController.sendStatCsv(res, "codebook.csv", await statExportService.codebookCsv(projectId));
  },

  async exportStatSnapshot(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=questionnaire_snapshot.json");
    res.send(await statExportService.questionnaireSnapshotJson(projectId));
  },

  async exportStatRandomizationLog(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    adminController.sendStatCsv(
      res,
      "randomization_log.csv",
      await statExportService.randomizationLogCsv(projectId, adminController.statExportOptions(req))
    );
  },

  // 送付前バリデーション (§4/§5/§6/§13)。JSONでレポートを返す。
  async validateProjectSurvey(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const questions = await questionRepository.listByProject(projectId);
    res.json(validateSurvey(questions));
  },

  // 送付前「確定（凍結＋検証ゲート）」(§1/§6)。
  // 検証で error があれば 400 でブロック（?force=1 で警告のみ無視して凍結も可）。
  async createProjectSnapshot(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const questions = await questionRepository.listByProject(projectId);
    const report = validateSurvey(questions);
    const force = bodyString(req.query.force) === "1";
    if (!report.ok && !force) {
      res.status(400).json({ ok: false, blocked: true, report });
      return;
    }
    const snapshot = await snapshotService.createOrReuse(projectId, bodyString(req.body.wave_code) || null);
    res.json({ ok: true, snapshot_id: snapshot.id, snapshot_version: snapshot.version, wave_code: snapshot.wave_code, report });
  },

  // スナップショット一覧 (§1/§14)
  async listProjectSnapshots(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const snapshots = await snapshotService.list(projectId);
    res.json(
      snapshots.map((snapshot) => ({
        id: snapshot.id,
        version: snapshot.version,
        wave_code: snapshot.wave_code,
        snapshot_hash: snapshot.snapshot_hash,
        is_active: snapshot.is_active,
        created_at: snapshot.created_at
      }))
    );
  },

  // ------------------------------------------------------------------
  // ページグループ管理 (survey_page モード)
  // ------------------------------------------------------------------

  async listPageGroups(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const project = await projectRepository.getById(projectId);
    const pageGroups = await questionPageGroupRepository.listByProject(projectId);
    const questions = await questionRepository.listByProject(projectId);
    res.render("admin/projects/pageGroups", {
      title: "ページグループ管理",
      project,
      pageGroups,
      questions
    });
  },

  async createPageGroup(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const existing = await questionPageGroupRepository.listByProject(projectId);
    const nextPageNumber = existing.reduce((max, pg) => Math.max(max, pg.page_number), 0) + 1;
    await questionPageGroupRepository.create({
      project_id: projectId,
      page_number: parseOptionalInteger(req.body.page_number) ?? nextPageNumber,
      title: bodyString(req.body.title).trim() || null,
      description: bodyString(req.body.description).trim() || null,
      sort_order: parseOptionalInteger(req.body.sort_order) ?? nextPageNumber,
    });
    res.redirect(`/admin/projects/${projectId}/page-groups`);
  },

  async updatePageGroup(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const pageGroupId = routeParam(req, "pageGroupId");
    await questionPageGroupRepository.update(pageGroupId, {
      title: bodyString(req.body.title).trim() || null,
      description: bodyString(req.body.description).trim() || null,
      sort_order: parseOptionalInteger(req.body.sort_order) ?? undefined,
      page_number: parseOptionalInteger(req.body.page_number) ?? undefined,
      // §3 ブロック(ページ)ランダム化フラグ（チェックボックス）
      is_randomizable: req.body.is_randomizable === "on" || req.body.is_randomizable === "true",
      randomize_within: req.body.randomize_within === "on" || req.body.randomize_within === "true",
      fix_within: req.body.fix_within === "on" || req.body.fix_within === "true",
    });
    res.redirect(`/admin/projects/${projectId}/page-groups`);
  },

  async deletePageGroup(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const pageGroupId = routeParam(req, "pageGroupId");
    await questionPageGroupRepository.deleteById(pageGroupId);
    res.redirect(`/admin/projects/${projectId}/page-groups`);
  },

  // ------------------------------------------------------------------
  // コンセプト・ローテーション（L1・ラテン方格）
  // ------------------------------------------------------------------
  async conceptsPage(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const [project, concepts] = await Promise.all([
      projectRepository.getById(projectId),
      conceptService.list(projectId)
    ]);
    res.render("admin/projects/concepts", { title: "コンセプト管理", project, concepts });
  },

  async setConceptRotationMode(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const mode = bodyString(req.body.concept_rotation_mode);
    const allowed = ["off", "latin", "full"] as const;
    await projectRepository.update(projectId, {
      concept_rotation_mode: (allowed as readonly string[]).includes(mode) ? (mode as "off" | "latin" | "full") : "off"
    });
    res.redirect(`/admin/projects/${projectId}/concepts`);
  },

  async createConcept(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const existing = await projectConceptRepository.listByProject(projectId);
    const nextOrder = existing.reduce((max, concept) => Math.max(max, concept.master_order), 0) + 1;
    await projectConceptRepository.create({
      project_id: projectId,
      concept_code: bodyString(req.body.concept_code).trim() || `C${nextOrder}`,
      title: bodyString(req.body.title).trim() || null,
      description: bodyString(req.body.description).trim() || null,
      master_order: parseOptionalInteger(req.body.master_order) ?? nextOrder
    });
    res.redirect(`/admin/projects/${projectId}/concepts`);
  },

  async updateConcept(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const conceptId = routeParam(req, "conceptId");
    await projectConceptRepository.update(conceptId, {
      concept_code: bodyString(req.body.concept_code).trim() || undefined,
      title: bodyString(req.body.title).trim() || null,
      description: bodyString(req.body.description).trim() || null,
      master_order: parseOptionalInteger(req.body.master_order) ?? undefined,
      is_active: req.body.is_active === "1" || req.body.is_active === "on"
    });
    res.redirect(`/admin/projects/${projectId}/concepts`);
  },

  async deleteConcept(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const conceptId = routeParam(req, "conceptId");
    await projectConceptRepository.deleteById(conceptId);
    res.redirect(`/admin/projects/${projectId}/concepts`);
  },

  // ------------------------------------------------------------------
  // ブロック自動設計（AI提案＋プレビュー編集・統計エクスポート §3 支援）
  // ------------------------------------------------------------------
  async blockDesigner(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const [project, questions, pageGroups] = await Promise.all([
      projectRepository.getById(projectId),
      questionRepository.listByProject(projectId),
      questionPageGroupRepository.listByProject(projectId)
    ]);
    res.render("admin/projects/blockDesigner", {
      title: "ブロック自動設計",
      project,
      questions: blockDesignService.designableQuestions(questions),
      pageGroups
    });
  },

  async suggestBlocks(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const count = Number(req.body?.count) || 0; // 0 = 自動
    res.json(await blockDesignService.suggest(projectId, count));
  },

  async previewBlocks(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const plan = (req.body?.plan ?? { blocks: [] }) as BlockPlan;
    const n = Number(req.body?.n) || 3;
    res.json({ respondents: await blockDesignService.preview(projectId, plan, n) });
  },

  async applyBlocks(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const plan = (req.body?.plan ?? { blocks: [] }) as BlockPlan;
    const result = await blockDesignService.apply(projectId, plan);
    res.json({ ok: true, ...result });
  },

  // ------------------------------------------------------------------
  // Tag API: タグ解析・生成 (formV3.ejs から呼び出される)
  // ------------------------------------------------------------------

  /**
   * POST /admin/api/parse-tags
   * body: { raw: string, question_type: string, question_code?: string, project_id?: string }
   * → TagParserResult + バリデーション errors を返す
   */
  async parseTagsApi(req: Request, res: Response): Promise<void> {
    const raw = bodyString(req.body.raw);
    const questionType = bodyString(req.body.question_type) || "text";
    const questionCode = bodyString(req.body.question_code) || "q_preview";
    const projectId    = bodyString(req.body.project_id);

    const result = parseDisplayTags(raw);

    // 設問コンテキストがある場合のみバリデーション実行
    let validationErrors: ReturnType<typeof validateDisplayTags> = [];
    if (projectId && questionCode) {
      try {
        const allQs = await questionRepository.listByProject(projectId);
        validationErrors = validateDisplayTags(
          result.parsed,
          { question_code: questionCode, question_type: questionType as never },
          allQs
        );
      } catch {
        // プロジェクトが取れない場合はスキップ
      }
    }

    res.json({
      parsed:       result.parsed,
      errors:       [...result.errors, ...validationErrors.filter(e => e.severity === "error")],
      warnings:     [...result.warnings, ...validationErrors.filter(e => e.severity === "warning")],
      rawGenerated: result.rawGenerated,
    });
  },

  /**
   * POST /admin/api/generate-tags
   * body: フォームの tag_* フィールド群
   * → { parsed, rawGenerated, errors, warnings }
   */
  async generateTagsApi(req: Request, res: Response): Promise<void> {
    const b = req.body as Record<string, unknown>;

    const parsed: DisplayTagsParsed = {};

    const numOrUndef = (key: string) => {
      const v = bodyString(b[key]).trim();
      return v ? Number(v) : undefined;
    };
    const boolField = (key: string) => bodyString(b[key]) === "1" || b[key] === true;

    if (numOrUndef("tag_size") !== undefined)  parsed.inputSize = numOrUndef("tag_size");
    if (numOrUndef("tag_min")  !== undefined)  parsed.minValue  = numOrUndef("tag_min");
    if (numOrUndef("tag_max")  !== undefined)  parsed.maxValue  = numOrUndef("tag_max");
    if (numOrUndef("tag_rows") !== undefined)  parsed.rows      = numOrUndef("tag_rows");
    if (numOrUndef("tag_cols") !== undefined)  parsed.cols      = numOrUndef("tag_cols");
    if (numOrUndef("tag_code") !== undefined)  parsed.inputCode = numOrUndef("tag_code");

    if (boolField("tag_numeric")) {
      parsed.numericOnly = true;
      const dec = numOrUndef("tag_numeric_decimal");
      if (dec !== undefined) parsed.numericDecimalPlaces = dec;
    }
    if (boolField("tag_al"))     parsed.alphaNumericOnly = true;
    if (boolField("tag_norep"))  parsed.noRepeat         = true;
    if (boolField("tag_fix"))    parsed.fixedChoice      = true;
    if (boolField("tag_br"))     parsed.lineBreak        = true;
    if (boolField("tag_must"))   parsed.mustInput        = true;
    if (boolField("tag_ex"))     parsed.exampleInput     = true;

    const lenOp  = bodyString(b["tag_len_op"]).trim();
    const lenVal = numOrUndef("tag_len_val");
    if (lenOp && lenVal !== undefined) {
      parsed.lengthRule = { operator: lenOp as import("../types/questionSchema").LengthRule["operator"], value: lenVal };
    }

    const bf = bodyString(b["tag_bf"]).trim();
    const af = bodyString(b["tag_af"]).trim();
    if (bf) parsed.beforeText = bf;
    if (af) parsed.afterText  = af;

    if (boolField("tag_type_year") || boolField("tag_type_jyear") ||
        boolField("tag_type_month") || boolField("tag_type_day")) {
      parsed.inputType = {
        year:  boolField("tag_type_year")  || undefined,
        jyear: boolField("tag_type_jyear") || undefined,
        month: boolField("tag_type_month") || undefined,
        day:   boolField("tag_type_day")   || undefined,
      };
    }

    const rawGenerated = generateTagsFromParsed(parsed);
    // 生成した raw を再パースしてエラーチェック
    const reparse = parseDisplayTags(rawGenerated);

    res.json({
      parsed,
      rawGenerated,
      errors:   reparse.errors,
      warnings: reparse.warnings,
    });
  },

  // ------------------------------------------------------------------
  // フローデザイナー
  // ------------------------------------------------------------------

  /**
   * GET /projects/:projectId/questions/flow
   * フロー設計画面を表示する
   */
  async questionFlow(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const [project, allQuestions, pageGroups] = await Promise.all([
      projectRepository.getById(projectId),
      questionRepository.listByProject(projectId, { includeHidden: false }),
      questionPageGroupRepository.listByProject(projectId),
    ]);

    const initialData = {
      projectId,
      project: {
        id: project.id,
        name: project.name,
        objective: project.objective ?? null,
        display_mode: project.display_mode ?? null,
      },
      questions: allQuestions.map((q) => ({
        id:               q.id,
        question_code:    q.question_code,
        question_text:    q.question_text,
        question_type:    q.question_type,
        question_role:    q.question_role,
        sort_order:       q.sort_order,
        is_required:      q.is_required,
        ai_probe_enabled: q.ai_probe_enabled,
        probe_guideline:  q.probe_guideline ?? null,
        max_probe_count:  q.max_probe_count ?? null,
        render_strategy:  q.render_strategy ?? null,
        branch_rule:      q.branch_rule ?? null,
        question_config:  q.question_config ?? null,
        visibility_conditions: q.visibility_conditions ?? null,
        page_group_id:    q.page_group_id ?? null,
        answer_options_locked: q.answer_options_locked ?? false,
      })),
      pageGroups,
    };

    res.render("admin/questions/flowDesigner", {
      title: `フロー設計 - ${project.name}`,
      project,
      questions: allQuestions,
      initialData,
    });
  },

  // ------------------------------------------------------------------
  // フローデザイナー用 JSON API
  // ------------------------------------------------------------------

  /**
   * POST /admin/api/questions/:questionId
   * 右パネルの簡易フォームから質問を保存する（JSON body）
   */
  async apiUpdateQuestionFlow(req: Request, res: Response): Promise<void> {
    const questionId = routeParam(req, "questionId");
    const existing = await questionRepository.getById(questionId);
    const body = req.body as Record<string, unknown>;

    const questionType = parseQuestionType(String(body.question_type ?? existing.question_type));
    const questionText = String(body.question_text ?? "").trim();
    const existingConfig = (existing.question_config ?? {}) as Record<string, unknown>;
    const existingMeta = (existingConfig.meta ?? {}) as Record<string, unknown>;
    // body に question_goal が含まれていない場合は既存の research_goal を引き継ぐ
    const questionGoal = String(body.question_goal ?? existingMeta.research_goal ?? "").trim();
    const sortOrder    = Number(body.sort_order)    || existing.sort_order;

    if (!questionText) {
      res.status(400).json({ error: "question_text は必須です" });
      return;
    }
    if (!questionGoal) {
      res.status(400).json({ error: "question_goal は必須です" });
      return;
    }

    // question_config: 既存を保持しつつ上書き
    const newConfig: Record<string, unknown> = { ...existingConfig };

    // 選択肢（選択型）
    if (CHOICE_QUESTION_TYPES.includes(questionType) && Array.isArray(body.options)) {
      newConfig.options = (body.options as string[])
        .filter((l) => l && l.trim())
        .map((label) => ({ label: label.trim(), value: label.trim() }));
    }

    // マトリクス設定
    if (MATRIX_QUESTION_TYPES.includes(questionType)) {
      if (Array.isArray(body.matrix_rows)) {
        newConfig.options = (body.matrix_rows as string[])
          .map((r) => String(r).trim()).filter(Boolean)
          .map((r) => ({ label: r, value: r }));
      }
      if (Array.isArray(body.matrix_cols)) {
        newConfig.matrix_cols = (body.matrix_cols as string[])
          .map((c) => String(c).trim()).filter(Boolean)
          .map((c) => ({ label: c, value: c }));
      }
    }

    // 数値入力設定
    if (questionType === "numeric") {
      if (body.numeric_min != null && body.numeric_min !== "") newConfig.min = Number(body.numeric_min);
      if (body.numeric_max != null && body.numeric_max !== "") newConfig.max = Number(body.numeric_max);
      if (body.numeric_unit != null && String(body.numeric_unit).trim()) newConfig.unit = String(body.numeric_unit).trim();
      newConfig.allow_decimal = Boolean(body.numeric_allow_decimal);
    }

    // テキスト系設定
    if (["free_text_short", "free_text_long", "text"].includes(questionType)) {
      if (body.text_placeholder != null) newConfig.placeholder = String(body.text_placeholder).trim() || undefined;
      if (body.text_max_length != null && body.text_max_length !== "") newConfig.max_length = Number(body.text_max_length);
    }

    // 複数選択の選択数制約
    if (questionType === "multi_choice") {
      newConfig.min_select = body.min_select != null && body.min_select !== "" ? Number(body.min_select) : undefined;
      newConfig.max_select = body.max_select != null && body.max_select !== "" ? Number(body.max_select) : undefined;
    }


    // 画像アップロード設定
    if (questionType === "image_upload") {
      if (body.image_max_images != null && body.image_max_images !== "") newConfig.max_images = Math.max(1, Number(body.image_max_images));
      if (body.image_notes != null) newConfig.notes = String(body.image_notes).trim() || undefined;
    }

    // meta.research_goal
    newConfig.meta = { ...existingMeta, research_goal: questionGoal };

    await questionRepository.update(questionId, {
      question_text:    questionText,
      question_type:    questionType,
      question_role:    parseQuestionRole(String(body.question_role ?? existing.question_role)),
      is_required:      Boolean(body.is_required),
      sort_order:       sortOrder,
      ai_probe_enabled: Boolean(body.ai_probe_enabled),
      probe_guideline:  body.ai_probe_enabled && body.probe_guideline
        ? String(body.probe_guideline).trim() || null
        : null,
      max_probe_count:  body.ai_probe_enabled && body.max_probe_count != null
        ? Math.round(Number(body.max_probe_count)) || null
        : null,
      question_config:  newConfig as Question["question_config"],
      branch_rule:      body.branch_rule as Question["branch_rule"] ?? null,
      answer_options_locked: body.answer_options_locked === true || body.answer_options_locked === "true",
    });

    const updated = await questionRepository.getById(questionId);
    res.json({ ok: true, question: updated });
  },

  /**
   * POST /admin/api/projects/:projectId/questions
   * フローデザイナーから新しい質問を作成する（JSON body）
   */
  async apiCreateQuestionFlow(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const body = req.body as Record<string, unknown>;

    const [availableQuestions] = await Promise.all([
      questionRepository.listByProject(projectId, { includeHidden: false }),
    ]);

    const questionType = parseQuestionType(String(body.question_type ?? "free_text_short"));
    const questionText = String(body.question_text ?? "新しい質問").trim();
    const questionGoal = String(body.question_goal ?? "").trim();
    const sortOrder    = Number(body.sort_order)
      || (await questionRepository.getNextSortOrder(projectId));

    const questionCode = buildQuestionCode({
      requestedCode:   "",
      questionText,
      sortOrder,
      existingQuestions: availableQuestions,
    });

    const options = Array.isArray(body.options)
      ? (body.options as string[]).filter(Boolean).map((l) => ({ label: l, value: l }))
      : [];

    const newConfig: Record<string, unknown> = {};
    if (CHOICE_QUESTION_TYPES.includes(questionType) && options.length > 0) {
      newConfig.options = options;
    }
    if (questionGoal) {
      newConfig.meta = { research_goal: questionGoal };
    }

    const created = await questionRepository.create({
      project_id:       projectId,
      question_code:    questionCode,
      question_text:    questionText,
      question_role:    parseQuestionRole(String(body.question_role ?? "main")),
      question_type:    questionType,
      is_required:      Boolean(body.is_required),
      sort_order:       sortOrder,
      ai_probe_enabled: Boolean(body.ai_probe_enabled),
      probe_guideline:  null,
      max_probe_count:  null,
      question_config:  newConfig as Question["question_config"],
      branch_rule:      null,
    });

    res.json({ ok: true, question: created });
  },

  /**
   * POST /admin/api/questions/:questionId/suggest-options
   * 設問文に基づいてAIが回答形式候補・選択肢候補を提案する
   */
  async apiSuggestAnswerOptions(req: Request, res: Response): Promise<void> {
    const questionId = routeParam(req, "questionId");
    const existing = await questionRepository.getById(questionId);

    // 固定フラグが ON の場合は提案しない
    if (existing.answer_options_locked) {
      res.json({
        ok: false,
        locked: true,
        message: "回答項目が固定されています。提案を生成するには固定を解除してください。",
      });
      return;
    }

    // フロントの入力値を優先し、未送信の場合はDBの値にフォールバック
    const questionText =
      (typeof req.body?.questionText === "string" && req.body.questionText.trim().length >= 3
        ? req.body.questionText.trim()
        : null) ?? existing.question_text;

    if (!questionText || questionText.trim().length < 3) {
      res.status(400).json({ error: "設問文が短すぎます。" });
      return;
    }

    // フロントから受け取った現在の回答形式（未指定ならDBの値を使用）
    const currentQuestionType = String(
      req.body?.currentQuestionType ?? existing.question_type ?? "free_text_short"
    );

    const CHOICE_TYPES_SET = new Set([
      "single_choice", "multi_choice",
      "hidden_single", "hidden_multi", "text_with_image", "sd",
    ]);
    const MATRIX_TYPES_SET = new Set(["matrix_single", "matrix_multi", "matrix_mixed"]);
    const MULTI_CHOICE_SET = new Set(["multi_choice"]);

    // 回答形式に応じたプロンプトとレスポンス形式を構築
    let typeInstruction: string;
    let responseFormat: string;

    if (MATRIX_TYPES_SET.has(currentQuestionType)) {
      typeInstruction =
        "マトリクス形式（行ごとに選択）として、評価する行項目（評価対象）と列項目（評価軸）を提案してください。" +
        "行は3〜6件、列は3〜5件を目安にしてください。";
      responseFormat = JSON.stringify({
        suggestedRows: ["行項目1", "行項目2"],
        suggestedCols: ["列項目1", "列項目2"],
        reason: "提案理由（1-2文）",
        warnings: [],
      }, null, 2);
    } else if (currentQuestionType === "numeric") {
      typeInstruction =
        "数値入力形式として、この設問に適した最小値・最大値・単位を提案してください。";
      responseFormat = JSON.stringify({
        suggestedMin: 0,
        suggestedMax: 100,
        suggestedUnit: "単位（例: 円・回・歳）",
        suggestedStep: 1,
        reason: "提案理由（1-2文）",
        warnings: [],
      }, null, 2);
    } else if (currentQuestionType === "free_text_short" || currentQuestionType === "free_text_long" || currentQuestionType === "text") {
      typeInstruction =
        "自由記述形式として、回答者の入力を助ける補助テキスト（プレースホルダー）と適切な最大文字数を提案してください。";
      responseFormat = JSON.stringify({
        suggestedPlaceholder: "例: 具体的に記入してください",
        suggestedMaxLength: 200,
        reason: "提案理由（1-2文）",
        warnings: [],
      }, null, 2);
    } else if (currentQuestionType === "image_upload") {
      typeInstruction =
        "画像アップロード形式として、回答者への注意事項・補足条件テキストと最大枚数を提案してください。";
      responseFormat = JSON.stringify({
        suggestedMaxImages: 1,
        suggestedNotes: "例: 実際の状況が分かる写真を添付してください",
        reason: "提案理由（1-2文）",
        warnings: [],
      }, null, 2);
    } else if (CHOICE_TYPES_SET.has(currentQuestionType)) {
      const isMulti = MULTI_CHOICE_SET.has(currentQuestionType);
      typeInstruction = isMulti
        ? "「複数選択」形式として、複数選べることを前提にバランスよく選択肢を5〜8件提案してください。"
        : "「単一選択」形式として、1つだけ選ぶ排他的な選択肢を5〜8件提案してください。";
      responseFormat = JSON.stringify({
        suggestedOptions: ["選択肢1", "選択肢2"],
        reason: "提案理由（1-2文）",
        warnings: [],
      }, null, 2);
    } else {
      // 回答形式未確定の場合は形式ごと提案
      typeInstruction = "最も適切な回答形式と選択肢（またはその他設定）を提案してください。";
      responseFormat = JSON.stringify({
        suggestedQuestionType: "single_choice",
        suggestedOptions: ["選択肢1", "選択肢2"],
        reason: "提案理由（1-2文）",
        warnings: [],
      }, null, 2);
    }

    // プロジェクトを取得してテンプレート解決に使用する
    const projectForTemplate = existing.project_id
      ? await projectRepository.getById(existing.project_id).catch(() => null)
      : null;

    const built = buildSurveyOptionsPrompt(
      { questionText, currentQuestionType, typeInstruction, responseFormat },
      projectForTemplate
    );

    try {
      const raw = await runAdminToolPrompt({
        purpose: "survey_options_suggestion",
        systemPrompt: built.systemPrompt,
        userPrompt: built.userPrompt,
        maxTokens: 600,
        temperature: 0.3,
        promptKey: built.promptKey,
        templateMode: built.templateMode,
        renderedPrompt: built.renderedPrompt,
      });

      let suggestions: Record<string, unknown>;
      try {
        suggestions = JSON.parse(raw);
      } catch {
        res.status(500).json({ error: "AI応答の解析に失敗しました。" });
        return;
      }

      res.json({ ok: true, suggestions });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: "AI候補の生成に失敗しました: " + msg });
    }
  },

  /**
   * POST /admin/api/questions/:questionId/delete
   * フローデザイナーから質問を削除する
   */
  async apiDeleteQuestion(req: Request, res: Response): Promise<void> {
    const questionId = routeParam(req, "questionId");
    // Verify question exists (throws HttpError 404 if not)
    await questionRepository.getById(questionId);

    const { supabase } = await import("../config/supabase");
    const { error } = await supabase
      .from("questions")
      .delete()
      .eq("id", questionId);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }
    res.json({ ok: true });
  },

  // ------------------------------------------------------------------
  // フロー流用・自動生成 API
  // ------------------------------------------------------------------

  /**
   * GET /admin/api/projects-for-import
   * フロー流用のための過去案件一覧を取得する
   */
  async apiListProjectsForImport(req: Request, res: Response): Promise<void> {
    const excludeId = queryString(req.query.exclude);
    const allProjects = await projectRepository.list();
    const result = allProjects
      .filter((p) => p.id !== excludeId)
      .map((p) => ({
        id: p.id,
        name: p.name,
        objective: p.objective ?? "",
        status: p.status,
        created_at: p.created_at,
      }));
    res.json({ ok: true, projects: result });
  },

  /**
   * GET /admin/api/projects/:sourceProjectId/flow-preview
   * 過去案件の質問一覧をプレビュー用に取得する
   */
  async apiGetProjectFlowPreview(req: Request, res: Response): Promise<void> {
    const sourceProjectId = routeParam(req, "sourceProjectId");
    const [project, questions] = await Promise.all([
      projectRepository.getById(sourceProjectId),
      questionRepository.listByProject(sourceProjectId, { includeHidden: false }),
    ]);

    const result = questions
      .filter((q) => !(q as unknown as Record<string, unknown>).is_system)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((q) => ({
        id: q.id,
        question_code: q.question_code,
        question_text: q.question_text,
        question_type: q.question_type,
        question_role: q.question_role,
        sort_order: q.sort_order,
        is_required: q.is_required,
        ai_probe_enabled: q.ai_probe_enabled,
        branch_rule: q.branch_rule ?? null,
        question_config: q.question_config ?? null,
      }));

    res.json({
      ok: true,
      project: {
        id: project.id,
        name: project.name,
        objective: project.objective ?? "",
      },
      questions: result,
    });
  },

  /**
   * POST /admin/api/projects/:projectId/flow/import-from-project
   * 過去案件のフローをAIでテキスト調整して新規案件に複製する
   */
  async apiImportFlowFromProject(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const body = req.body as Record<string, unknown>;
    const sourceProjectId = String(body.source_project_id ?? "").trim();

    if (!sourceProjectId) {
      res.status(400).json({ error: "参照元プロジェクトIDが必要です" });
      return;
    }

    const IMAGE_QUESTION_TYPES = ["image_upload", "text_with_image"];

    const [targetProject, sourceProject, sourceQuestions, existingQuestions] =
      await Promise.all([
        projectRepository.getById(projectId),
        projectRepository.getById(sourceProjectId),
        questionRepository.listByProject(sourceProjectId, { includeHidden: false }),
        questionRepository.listByProject(projectId, { includeHidden: false }),
      ]);

    const filteredSource = sourceQuestions
      .filter((q) => !(q as unknown as Record<string, unknown>).is_system)
      .sort((a, b) => a.sort_order - b.sort_order);

    if (filteredSource.length === 0) {
      res.status(400).json({ error: "参照元プロジェクトに流用できる質問がありません" });
      return;
    }

    // AI によるテキスト調整
    const questionsForAI = filteredSource.map((q, i) => {
      const cfg = (q.question_config ?? {}) as Record<string, unknown>;
      const meta = (cfg.meta ?? {}) as Record<string, unknown>;
      const opts = (cfg.options ?? []) as Array<{ label?: string; value?: string }>;
      return {
        index: i,
        question_code: q.question_code,
        question_text: q.question_text,
        question_type: q.question_type,
        options: opts.map((o) => o.label ?? o.value ?? "").filter(Boolean),
        research_goal: String(meta.research_goal ?? ""),
      };
    });

    const adjustedMap: Record<
      number,
      { question_text: string; options: string[]; research_goal: string }
    > = {};

    try {
      const built = buildAdjustQuestionsPrompt(
        {
          targetProjectName: targetProject.name,
          targetProjectObjective: targetProject.objective ?? "未設定",
          sourceProjectName: sourceProject.name,
          sourceProjectObjective: sourceProject.objective ?? "未設定",
          questionsJson: JSON.stringify(questionsForAI, null, 2),
        },
        targetProject
      );

      const raw = await runAdminToolPrompt({
        purpose: "flow_import_adjust",
        systemPrompt: built.systemPrompt,
        userPrompt: built.userPrompt,
        maxTokens: 4000,
        temperature: 0.3,
        promptKey: built.promptKey,
        templateMode: built.templateMode,
        renderedPrompt: built.renderedPrompt,
      });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const list = (parsed.adjusted_questions ?? []) as Array<Record<string, unknown>>;
      for (const item of list) {
        if (typeof item.index === "number") {
          adjustedMap[item.index] = {
            question_text: String(item.question_text ?? ""),
            options: Array.isArray(item.options)
              ? (item.options as unknown[]).map(String)
              : [],
            research_goal: String(item.research_goal ?? ""),
          };
        }
      }
    } catch {
      // AI 調整失敗時は元テキストをそのまま使用
    }

    const warnings: string[] = [];
    const createdQuestions: Question[] = [];
    const sortOrderBase =
      existingQuestions.length > 0
        ? Math.max(...existingQuestions.map((q) => q.sort_order)) + 1
        : 1;

    // 質問コードのマッピング (旧→新) を事前収集するため2パスで処理
    const codeMapping: Record<string, string> = {};

    for (const [i, src] of filteredSource.entries()) {
      const adjusted = adjustedMap[i];
      const sortOrder = sortOrderBase + i;

      // 画像系タイプを安全な形式に変換
      let questionType = src.question_type as QuestionType;
      let hadImageType = false;
      if (IMAGE_QUESTION_TYPES.includes(questionType)) {
        const original = questionType;
        questionType = questionType === "image_upload" ? "free_text_short" : "single_choice";
        hadImageType = true;
        warnings.push(
          `「${src.question_code}」: 画像型（${original}）を ${questionType} に変換しました。画像の再設定が必要です。`
        );
      }

      // 選択肢
      const cfg = (src.question_config ?? {}) as Record<string, unknown>;
      const meta = (cfg.meta ?? {}) as Record<string, unknown>;
      const srcOpts = (cfg.options ?? []) as Array<{ label?: string; value?: string }>;

      let newOptions: string[];
      if (adjusted?.options && adjusted.options.length > 0) {
        newOptions = adjusted.options;
      } else if (!hadImageType) {
        newOptions = srcOpts.map((o) => o.label ?? o.value ?? "").filter(Boolean);
      } else {
        newOptions = [];
      }

      const newConfig: Record<string, unknown> = {};
      if (CHOICE_QUESTION_TYPES.includes(questionType) && newOptions.length > 0) {
        newConfig.options = newOptions.map((l) => ({ label: l, value: l }));
      }
      const researchGoal =
        adjusted?.research_goal || String(meta.research_goal ?? "");
      newConfig.meta = { ...meta, research_goal: researchGoal };

      const questionText =
        (adjusted?.question_text || src.question_text || "（設問を入力してください）").trim() ||
        "（設問を入力してください）";

      const allForCode = [
        ...existingQuestions,
        ...createdQuestions,
      ] as typeof existingQuestions;
      const questionCode = buildQuestionCode({
        requestedCode: "",
        questionText,
        sortOrder,
        existingQuestions: allForCode,
      });

      codeMapping[src.question_code] = questionCode;

      const created = await questionRepository.create({
        project_id: projectId,
        question_code: questionCode,
        question_text: questionText,
        question_role: parseQuestionRole(src.question_role),
        question_type: questionType,
        is_required: src.is_required,
        sort_order: sortOrder,
        ai_probe_enabled: src.ai_probe_enabled,
        probe_guideline: src.probe_guideline ?? null,
        max_probe_count: src.max_probe_count ?? null,
        question_config: newConfig as Question["question_config"],
        branch_rule: null,
      });

      createdQuestions.push(created);
    }

    // branch_rule を新コードで書き換え
    for (const [i, src] of filteredSource.entries()) {
      const created = createdQuestions[i];
      if (!created) continue;
      const srcBr = src.branch_rule;
      if (!srcBr || Array.isArray(srcBr)) continue;

      const br = srcBr as Record<string, unknown>;
      const newBr: Record<string, unknown> = {};

      if (br.default_next) {
        const srcCode = String(br.default_next);
        newBr.default_next =
          srcCode === "END" ? "END" : (codeMapping[srcCode] ?? null);
      }
      if (Array.isArray(br.branches)) {
        newBr.branches = (br.branches as Array<Record<string, unknown>>).map(
          (b) => ({
            ...b,
            next:
              b.next === "END"
                ? "END"
                : (codeMapping[String(b.next ?? "")] ?? b.next),
          })
        );
      }

      await questionRepository.update(created.id, {
        branch_rule: newBr as Question["branch_rule"],
      });
    }

    // 作成済み質問を再取得して返す
    const allNew = await questionRepository.listByProject(projectId, {
      includeHidden: false,
    });
    const newOnly = allNew.filter((q) =>
      createdQuestions.some((c) => c.id === q.id)
    );

    res.json({ ok: true, questions: newOnly, warnings });
  },

  /**
   * POST /admin/api/projects/:projectId/flow/generate
   * プロジェクト名と調査目的からAIがフローを自動生成する
   */
  async apiGenerateFlow(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const [project, existingQuestions] = await Promise.all([
      projectRepository.getById(projectId),
      questionRepository.listByProject(projectId, { includeHidden: false }),
    ]);

    if (!project.name.trim() || !(project.objective ?? "").trim()) {
      res.status(400).json({
        error:
          "プロジェクト名と調査目的を設定してからフロー生成を実行してください",
      });
      return;
    }

    const built = buildGenerateFlowPrompt(
      { projectName: project.name, objective: project.objective ?? "" },
      project
    );

    let generatedList: Array<Record<string, unknown>> = [];

    try {
      const raw = await runAdminToolPrompt({
        purpose: "flow_generation",
        systemPrompt: built.systemPrompt,
        userPrompt: built.userPrompt,
        maxTokens: 4000,
        temperature: 0.7,
        promptKey: built.promptKey,
        templateMode: built.templateMode,
        renderedPrompt: built.renderedPrompt,
      });
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      generatedList = (parsed.questions ?? []) as Array<Record<string, unknown>>;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      res.status(500).json({ error: "AIフロー生成に失敗しました: " + msg });
      return;
    }

    if (generatedList.length === 0) {
      res.status(500).json({
        error: "AI生成結果が空でした。もう一度お試しください。",
      });
      return;
    }

    const sortOrderBase =
      existingQuestions.length > 0
        ? Math.max(...existingQuestions.map((q) => q.sort_order)) + 1
        : 1;

    const createdQuestions: Question[] = [];

    for (const [i, gen] of generatedList.entries()) {
      const questionType = parseQuestionType(
        String(gen.question_type ?? "free_text_short")
      );
      const questionText =
        String(gen.question_text ?? "").trim() || "設問を入力してください";
      const questionGoal =
        String(gen.research_goal ?? "").trim() || "調査目的に沿った情報収集";
      const sortOrder = sortOrderBase + i;

      const allForCode = [
        ...existingQuestions,
        ...createdQuestions,
      ] as typeof existingQuestions;
      const questionCode = buildQuestionCode({
        requestedCode: "",
        questionText,
        sortOrder,
        existingQuestions: allForCode,
      });

      const options = Array.isArray(gen.options)
        ? (gen.options as unknown[])
            .map(String)
            .filter((o) => o.trim())
        : [];

      const newConfig: Record<string, unknown> = {
        meta: { research_goal: questionGoal },
      };
      if (CHOICE_QUESTION_TYPES.includes(questionType) && options.length > 0) {
        newConfig.options = options.map((l) => ({ label: l, value: l }));
      }

      const created = await questionRepository.create({
        project_id: projectId,
        question_code: questionCode,
        question_text: questionText,
        question_role: parseQuestionRole(String(gen.question_role ?? "main")),
        question_type: questionType,
        is_required: Boolean(gen.is_required ?? true),
        sort_order: sortOrder,
        ai_probe_enabled: Boolean(gen.ai_probe_enabled ?? false),
        probe_guideline: null,
        max_probe_count: null,
        question_config: newConfig as Question["question_config"],
        branch_rule: null,
      });

      createdQuestions.push(created);
    }

    res.json({
      ok: true,
      questions: createdQuestions,
      generated_count: createdQuestions.length,
    });
  },

  /**
   * GET /admin/api/projects/:projectId/option-sets
   * 選択肢流用のための同プロジェクト内の選択肢セット一覧を取得
   */
  async apiGetOptionSets(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const questions = await questionRepository.listByProject(projectId, {
      includeHidden: false,
    });

    const optionSets = questions
      .filter((q) => {
        const cfg = (q.question_config ?? {}) as Record<string, unknown>;
        const opts = (cfg.options ?? []) as Array<{ label?: string }>;
        return opts.length > 0;
      })
      .map((q) => {
        const cfg = (q.question_config ?? {}) as Record<string, unknown>;
        const opts = (cfg.options ?? []) as Array<{ label?: string; value?: string }>;
        return {
          question_id: q.id,
          question_code: q.question_code,
          question_text: q.question_text.slice(0, 60),
          question_type: q.question_type,
          options: opts
            .map((o) => o.label ?? o.value ?? "")
            .filter(Boolean),
        };
      });

    res.json({ ok: true, option_sets: optionSets });
  },

  async uploadImage(req: Request, res: Response): Promise<void> {
    const body = req.body as { data?: unknown; filename?: unknown; mimeType?: unknown };
    const base64Data = typeof body.data === "string" ? body.data : null;
    const filename = typeof body.filename === "string" ? body.filename.replace(/[^a-zA-Z0-9._-]/g, "_") : "image";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "image/png";

    if (!base64Data) {
      res.status(400).json({ error: "data (base64) は必須です" });
      return;
    }
    if (!["image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"].includes(mimeType)) {
      res.status(400).json({ error: "サポートされていない画像形式です" });
      return;
    }

    const buffer = Buffer.from(base64Data, "base64");
    if (buffer.byteLength > 5 * 1024 * 1024) {
      res.status(400).json({ error: "画像サイズは5MB以下にしてください" });
      return;
    }

    const { supabase } = await import("../config/supabase");
    const ext = mimeType.split("/")[1] ?? "png";
    const storagePath = `questions/${Date.now()}-${filename}.${ext}`;

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, { contentType: mimeType, upsert: false });

    if (uploadError) {
      res.status(500).json({ error: `アップロード失敗: ${uploadError.message}` });
      return;
    }

    const { data: urlData } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(storagePath);
    res.json({ ok: true, url: urlData.publicUrl });
  },

  // ============================================================
  // Phase 2-B: 属性管理
  // ============================================================

  async attributesPage(req: Request, res: Response): Promise<void> {
    const [definitions, attrCounts] = await Promise.all([
      userAttributeRepository.listDefinitions(),
      userAttributeRepository.countByAttrKey(),
    ]);
    const countMap = Object.fromEntries(attrCounts.map(r => [r.attr_key, r.count]));
    res.render("admin/attributes/index", {
      title: "属性管理",
      definitions,
      countMap,
    });
  },

  async createAttributeDefinition(req: Request, res: Response): Promise<void> {
    const attrKey = bodyString(req.body.attr_key).trim();
    const label = bodyString(req.body.label).trim();
    const category = bodyString(req.body.category).trim() as "basic" | "lifestyle" | "interest" | "ai_inferred";
    const dataType = bodyString(req.body.data_type).trim() as "text" | "boolean" | "number" | "json" | "tags";
    if (!attrKey || !label || !category) {
      throw new HttpError(400, "attr_key, label, category は必須です");
    }
    await userAttributeRepository.createDefinition({
      attr_key: attrKey,
      label,
      category,
      data_type: dataType || "text",
      is_user_editable: req.body.is_user_editable === "true",
      is_admin_only: req.body.is_admin_only === "true",
      is_company_visible: req.body.is_company_visible === "true",
      sort_order: Number(bodyString(req.body.sort_order)) || 0,
    });
    res.redirect("/admin/attributes");
  },

  async deleteAttributeDefinition(req: Request, res: Response): Promise<void> {
    const defId = routeParam(req, "defId");
    await userAttributeRepository.deleteDefinition(defId);
    res.redirect("/admin/attributes");
  },

  // ============================================================
  // Phase 2-B: セグメント管理
  // ============================================================

  async segmentsPage(_req: Request, res: Response): Promise<void> {
    const [segments, campaigns] = await Promise.all([
      segmentRepository.list(),
      deliveryCampaignRepository.list(),
    ]);
    res.render("admin/segments/index", {
      title: "セグメント配信",
      segments,
      campaigns,
    });
  },

  async newSegmentPage(_req: Request, res: Response): Promise<void> {
    const projects = await projectRepository.list();
    res.render("admin/segments/form", {
      title: "セグメント作成",
      segment: null,
      projects,
    });
  },

  async createSegment(req: Request, res: Response): Promise<void> {
    const name = bodyString(req.body.name).trim();
    const description = bodyString(req.body.description).trim() || null;
    const conditionsRaw = bodyString(req.body.conditions).trim();
    if (!name) throw new HttpError(400, "セグメント名は必須です");

    let conditions: { operator: "AND" | "OR"; conditions: import("../repositories/segmentRepository").SegmentCondition[] } = { operator: "AND", conditions: [] };
    if (conditionsRaw) {
      try {
        conditions = JSON.parse(conditionsRaw);
      } catch {
        throw new HttpError(400, "conditions の JSON 形式が不正です");
      }
    }
    await segmentRepository.create({ name, description, conditions });
    res.redirect("/admin/segments");
  },

  async editSegmentPage(req: Request, res: Response): Promise<void> {
    const segmentId = routeParam(req, "segmentId");
    const [segment, projects] = await Promise.all([
      segmentRepository.getById(segmentId),
      projectRepository.list(),
    ]);
    res.render("admin/segments/form", {
      title: "セグメント編集",
      segment,
      projects,
    });
  },

  async updateSegment(req: Request, res: Response): Promise<void> {
    const segmentId = routeParam(req, "segmentId");
    const name = bodyString(req.body.name).trim();
    const description = bodyString(req.body.description).trim() || null;
    const conditionsRaw = bodyString(req.body.conditions).trim();
    if (!name) throw new HttpError(400, "セグメント名は必須です");

    let conditions: import("../repositories/segmentRepository").Segment["conditions"] | undefined;
    if (conditionsRaw) {
      try {
        conditions = JSON.parse(conditionsRaw) as import("../repositories/segmentRepository").Segment["conditions"];
      } catch {
        throw new HttpError(400, "conditions の JSON 形式が不正です");
      }
    }
    await segmentRepository.update(segmentId, { name, description, ...(conditions ? { conditions } : {}) });
    res.redirect("/admin/segments");
  },

  async deleteSegment(req: Request, res: Response): Promise<void> {
    const segmentId = routeParam(req, "segmentId");
    await segmentRepository.delete(segmentId);
    res.redirect("/admin/segments");
  },

  async evaluateSegment(req: Request, res: Response): Promise<void> {
    const segmentId = routeParam(req, "segmentId");
    const segment = await segmentRepository.getById(segmentId);
    const { supabase: db } = await import("../config/supabase");
    const count = await evaluateConditionsCount(db, segment.conditions);
    await segmentRepository.updateEstimatedCount(segmentId, count);
    res.json({ ok: true, estimated_count: count });
  },

  async previewSegment(req: Request, res: Response): Promise<void> {
    let conditions: unknown;
    try {
      const raw = req.body.conditions;
      conditions = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      res.json({ ok: false, error: "不正な条件 JSON です" });
      return;
    }
    const { supabase: db } = await import("../config/supabase");
    try {
      const count = await evaluateConditionsCount(db, conditions);
      res.json({ ok: true, estimated_count: count });
    } catch (e) {
      res.json({ ok: false, error: e instanceof Error ? e.message : "評価エラー" });
    }
  },

  // ============================================================
  // Phase 2-B: AI分析ダッシュボード
  // ============================================================

  async aiAnalysisPage(_req: Request, res: Response): Promise<void> {
    const { supabase: db } = await import("../config/supabase");

    const [postAnalysisResult, behaviorResult, rantPostResult, diaryPostResult] = await Promise.all([
      db.from("post_analysis")
        .select("sentiment, actionability, insight_type, raw_json, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      db.from("behavior_logs")
        .select("event_type, created_at")
        .order("created_at", { ascending: false })
        .limit(500),
      db.from("user_posts")
        .select("id, type, created_at")
        .eq("type", "rant")
        .order("created_at", { ascending: false })
        .limit(500),
      db.from("user_posts")
        .select("id, type, created_at")
        .eq("type", "diary")
        .order("created_at", { ascending: false })
        .limit(500),
    ]);

    const analyses = (postAnalysisResult.data ?? []) as {
      sentiment: string;
      actionability: string;
      insight_type: string;
      raw_json: Record<string, unknown> | null;
      created_at: string;
    }[];
    const behaviors = (behaviorResult.data ?? []) as { event_type: string; created_at: string }[];
    const rantPosts = (rantPostResult.data ?? []) as { id: string; type: string; created_at: string }[];
    const diaryPosts = (diaryPostResult.data ?? []) as { id: string; type: string; created_at: string }[];

    const sentimentCounts: Record<string, number> = {};
    for (const a of analyses) {
      if (a.sentiment) sentimentCounts[a.sentiment] = (sentimentCounts[a.sentiment] ?? 0) + 1;
    }

    const eventCounts: Record<string, number> = {};
    for (const b of behaviors) {
      eventCounts[b.event_type] = (eventCounts[b.event_type] ?? 0) + 1;
    }

    const insightCounts: Record<string, number> = {};
    for (const a of analyses) {
      if (a.insight_type) insightCounts[a.insight_type] = (insightCounts[a.insight_type] ?? 0) + 1;
    }

    // 愚痴拡張分析集計（raw_json.rant_extended が存在するもの）
    const rantExtCounts: Record<string, number> = {};
    let dangerFlagCount = 0;
    let rantExtAnalyzedCount = 0;
    const severityCounts: Record<number, number> = { 1: 0, 2: 0, 3: 0 };

    for (const a of analyses) {
      const ext = (a.raw_json as Record<string, unknown> | null)?.rant_extended as
        | { rant_category?: string; danger_flag?: boolean; severity?: number }
        | undefined;
      if (ext) {
        rantExtAnalyzedCount++;
        if (ext.rant_category) {
          rantExtCounts[ext.rant_category] = (rantExtCounts[ext.rant_category] ?? 0) + 1;
        }
        if (ext.danger_flag) dangerFlagCount++;
        if (ext.severity && [1, 2, 3].includes(ext.severity)) {
          const sev = ext.severity as 1 | 2 | 3;
          severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;
        }
      }
    }

    // 日記拡張分析集計
    let moodScoreSum = 0;
    let diaryExtAnalyzedCount = 0;
    const behaviorSignalCounts: Record<string, number> = {};
    const topicCategoryCounts: Record<string, number> = {};

    for (const a of analyses) {
      const ext = (a.raw_json as Record<string, unknown> | null)?.diary_extended as
        | { mood_score?: number; topic_categories?: string[]; behavior_signals?: string[] }
        | undefined;
      if (ext) {
        diaryExtAnalyzedCount++;
        if (typeof ext.mood_score === "number") moodScoreSum += ext.mood_score;
        for (const tc of ext.topic_categories ?? []) {
          topicCategoryCounts[tc] = (topicCategoryCounts[tc] ?? 0) + 1;
        }
        for (const bs of ext.behavior_signals ?? []) {
          behaviorSignalCounts[bs] = (behaviorSignalCounts[bs] ?? 0) + 1;
        }
      }
    }

    const avgMoodScore =
      diaryExtAnalyzedCount > 0
        ? Math.round((moodScoreSum / diaryExtAnalyzedCount) * 10) / 10
        : null;

    res.render("admin/ai-analysis/index", {
      title: "AI分析ダッシュボード",
      sentimentCounts,
      eventCounts,
      insightCounts,
      totalAnalyses: analyses.length,
      totalBehaviors: behaviors.length,
      totalRantPosts: rantPosts.length,
      totalDiaryPosts: diaryPosts.length,
      rantExtCounts,
      dangerFlagCount,
      rantExtAnalyzedCount,
      severityCounts,
      diaryExtAnalyzedCount,
      avgMoodScore,
      behaviorSignalCounts,
      topicCategoryCounts,
    });
  },

  // ============================================================
  // Phase 2-C: AI拡張分析 API
  // ============================================================

  async runExtendedPostAnalysis(req: Request, res: Response): Promise<void> {
    const { aiTagService } = await import("../services/aiTagService");
    const { supabase: db } = await import("../config/supabase");

    const postId = String(req.params.postId ?? "");
    if (!postId) {
      res.status(400).json({ error: "postId required" });
      return;
    }

    const { data: post } = await db
      .from("user_posts")
      .select("id, type, content")
      .eq("id", postId)
      .maybeSingle();

    if (!post) {
      res.status(404).json({ error: "post not found" });
      return;
    }

    const postData = post as { id: string; type: string; content: string };
    let result: Record<string, unknown> | null = null;

    if (postData.type === "rant") {
      result = await aiTagService.analyzeRantPost(postData.id, postData.content);
    } else if (postData.type === "diary") {
      result = await aiTagService.analyzeDiaryPost(postData.id, postData.content);
    } else {
      res.status(400).json({ error: "post type must be rant or diary" });
      return;
    }

    res.json({ ok: true, result });
  },

  async runUserTagGeneration(req: Request, res: Response): Promise<void> {
    const { aiTagService } = await import("../services/aiTagService");
    const { supabase: db } = await import("../config/supabase");

    const respondentId = String(req.params.respondentId ?? "");
    if (!respondentId) {
      res.status(400).json({ error: "respondentId required" });
      return;
    }

    const { data: respondent } = await db
      .from("respondents")
      .select("id, line_user_id")
      .eq("id", respondentId)
      .maybeSingle();

    if (!respondent) {
      res.status(404).json({ error: "respondent not found" });
      return;
    }

    const resp = respondent as { id: string; line_user_id: string };
    const result = await aiTagService.generateTagsForUser(resp.line_user_id);

    res.json({ ok: true, result });
  },

  async aiReportPage(_req: Request, res: Response): Promise<void> {
    const { supabase: db } = await import("../config/supabase");

    const [paResult, ppResult, respondentsResult] = await Promise.all([
      db.from("post_analysis")
        .select("sentiment, insight_type, raw_json, tags, keywords")
        .limit(1000),
      db.from("user_personality_profiles")
        .select("raw_json, summary, segments, confidence")
        .limit(500),
      db.from("respondents")
        .select("id, total_points, current_rank_id")
        .limit(500),
    ]);

    const analyses = (paResult.data ?? []) as {
      sentiment: string;
      insight_type: string;
      raw_json: Record<string, unknown> | null;
      tags: unknown[];
      keywords: unknown[];
    }[];

    const profiles = (ppResult.data ?? []) as {
      raw_json: Record<string, unknown> | null;
      summary: string | null;
      segments: string[] | null;
      confidence: number | null;
    }[];

    // 感情分布（匿名）
    const sentimentDist: Record<string, number> = {};
    for (const a of analyses) {
      sentimentDist[a.sentiment] = (sentimentDist[a.sentiment] ?? 0) + 1;
    }

    // インサイトタイプ分布（匿名）
    const insightDist: Record<string, number> = {};
    for (const a of analyses) {
      if (a.insight_type) insightDist[a.insight_type] = (insightDist[a.insight_type] ?? 0) + 1;
    }

    // 性格タイプ分布（匿名・10件以上のみ）
    const personalityTypeCounts: Record<string, number> = {};
    for (const p of profiles) {
      const pt = (p.raw_json as Record<string, unknown> | null)?.personality_type as
        | string
        | undefined;
      if (pt) personalityTypeCounts[pt] = (personalityTypeCounts[pt] ?? 0) + 1;
    }
    const safePersonalityTypes: Record<string, number> = {};
    for (const [k, v] of Object.entries(personalityTypeCounts)) {
      if (v >= 3) safePersonalityTypes[k] = v;
    }

    // 愚痴カテゴリ分布（匿名）
    const rantCatDist: Record<string, number> = {};
    let totalDangerFlags = 0;
    for (const a of analyses) {
      const ext = (a.raw_json as Record<string, unknown> | null)?.rant_extended as
        | { rant_category?: string; danger_flag?: boolean }
        | undefined;
      if (ext?.rant_category) {
        rantCatDist[ext.rant_category] = (rantCatDist[ext.rant_category] ?? 0) + 1;
      }
      if (ext?.danger_flag) totalDangerFlags++;
    }

    // よく出るキーワード（上位10件）
    const keywordCounts: Record<string, number> = {};
    for (const a of analyses) {
      for (const kw of a.keywords ?? []) {
        const s = String(kw).trim();
        if (s) keywordCounts[s] = (keywordCounts[s] ?? 0) + 1;
      }
    }
    const topKeywords = Object.entries(keywordCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word, count]) => ({ word, count }));

    const totalRespondents = (respondentsResult.data ?? []).length;

    res.render("admin/ai-analysis/report", {
      title: "企業向けレポート（匿名統計）",
      totalRespondents,
      totalAnalyses: analyses.length,
      sentimentDist,
      insightDist,
      safePersonalityTypes,
      rantCatDist,
      totalDangerFlags,
      topKeywords,
      generatedAt: new Date().toISOString().slice(0, 16).replace("T", " "),
    });
  },

  // ============================================================
  // Phase 2-D: キャンペーン管理
  // ============================================================

  async campaignsPage(_req: Request, res: Response): Promise<void> {
    const campaigns = await deliveryCampaignRepository.list();
    res.render("admin/segments/campaigns", { title: "配信キャンペーン", campaigns });
  },

  async newCampaignPage(_req: Request, res: Response): Promise<void> {
    const [projects, segments] = await Promise.all([
      projectRepository.list(),
      segmentRepository.list(),
    ]);
    res.render("admin/segments/campaign-form", {
      title: "キャンペーン作成",
      campaign: null,
      projects,
      segments,
    });
  },

  async createCampaign(req: Request, res: Response): Promise<void> {
    const name = bodyString(req.body.name).trim();
    if (!name) throw new HttpError(400, "キャンペーン名は必須です");
    const projectId = bodyString(req.body.project_id).trim() || null;
    const segmentId = bodyString(req.body.segment_id).trim() || null;
    const deliveryChannel = bodyString(req.body.delivery_channel) === "line" ? "line" : "liff";
    const scheduledAt = parseNullableDateTime(req.body.scheduled_at);
    const deadline = parseNullableDateTime(req.body.deadline);

    await deliveryCampaignRepository.create({
      name,
      project_id: projectId,
      segment_id: segmentId,
      delivery_channel: deliveryChannel,
      scheduled_at: scheduledAt,
    });

    void deadline;
    res.redirect("/admin/segments/campaigns");
  },

  async editCampaignPage(req: Request, res: Response): Promise<void> {
    const campaignId = routeParam(req, "campaignId");
    const [campaign, projects, segments] = await Promise.all([
      deliveryCampaignRepository.getById(campaignId),
      projectRepository.list(),
      segmentRepository.list(),
    ]);
    res.render("admin/segments/campaign-form", {
      title: "キャンペーン編集",
      campaign,
      projects,
      segments,
    });
  },

  async updateCampaign(req: Request, res: Response): Promise<void> {
    const campaignId = routeParam(req, "campaignId");
    const name = bodyString(req.body.name).trim();
    if (!name) throw new HttpError(400, "キャンペーン名は必須です");
    const projectId = bodyString(req.body.project_id).trim() || null;
    const segmentId = bodyString(req.body.segment_id).trim() || null;
    const deliveryChannel = bodyString(req.body.delivery_channel) === "line" ? "line" : "liff";
    const scheduledAt = parseNullableDateTime(req.body.scheduled_at);

    await deliveryCampaignRepository.update(campaignId, {
      name,
      project_id: projectId,
      segment_id: segmentId,
      delivery_channel: deliveryChannel,
      scheduled_at: scheduledAt,
      status: scheduledAt ? "scheduled" : "draft",
    });
    res.redirect("/admin/segments/campaigns");
  },

  async cancelCampaign(req: Request, res: Response): Promise<void> {
    const campaignId = routeParam(req, "campaignId");
    await deliveryCampaignRepository.update(campaignId, { status: "cancelled" });
    res.redirect("/admin/segments/campaigns");
  },

  async executeCampaign(req: Request, res: Response): Promise<void> {
    const campaignId = routeParam(req, "campaignId");
    const segmentIdOverride = bodyString(req.body.segment_id) || null;
    const projectIdOverride = bodyString(req.body.project_id) || null;
    const { supabase: db } = await import("../config/supabase");

    const campaign = await deliveryCampaignRepository.getById(campaignId);
    if (campaign.status === "sent" || campaign.status === "cancelled") {
      res.status(400).json({ error: "このキャンペーンは実行できません" });
      return;
    }

    // 画面で選択したプロジェクトを優先。それもなければキャンペーンのproject_idを使用
    const effectiveProjectId = projectIdOverride ?? campaign.project_id;
    if (!effectiveProjectId) {
      res.status(400).json({ error: "対象プロジェクトが設定されていません。配信オペレーション画面でプロジェクトを選択してください。" });
      return;
    }

    // セグメント条件からターゲットユーザーを取得（画面からのsegment_idがあれば優先）
    const effectiveSegmentId = segmentIdOverride ?? campaign.segment_id;
    let targetLineUserIds: string[] = [];

    if (effectiveSegmentId) {
      const segment = await segmentRepository.getById(effectiveSegmentId);
      const conds = segment.conditions.conditions as Array<{
        field: string; op: string; value: unknown;
      }>;

      let q = db.from("user_profiles").select("line_user_id").eq("profile_completed", true);
      for (const c of conds) {
        if (c.field === "gender" && c.op === "in" && Array.isArray(c.value))
          q = q.in("gender", c.value as string[]);
        else if (c.field === "prefecture" && c.op === "in" && Array.isArray(c.value))
          q = q.in("prefecture", c.value as string[]);
        else if (c.field === "is_blocked")
          q = q.eq("is_blocked", c.value as boolean);
      }
      const { data } = await q;
      targetLineUserIds = (data ?? []).map((r: { line_user_id: string }) => r.line_user_id);
    } else {
      // セグメント未指定 → profile_completed 全員
      const { data } = await db
        .from("user_profiles")
        .select("line_user_id")
        .eq("profile_completed", true)
        .eq("is_blocked", false);
      targetLineUserIds = (data ?? []).map((r: { line_user_id: string }) => r.line_user_id);
    }

    if (targetLineUserIds.length === 0) {
      res.json({ ok: true, sent_count: 0 });
      return;
    }

    // respondent ID を取得
    const { data: respondents } = await db
      .from("respondents")
      .select("id, line_user_id")
      .in("line_user_id", targetLineUserIds);

    const respondentIds = (respondents ?? []).map((r: { id: string }) => r.id);

    // assignmentService でバッチアサイン
    const createdAssignments = await assignmentService.assignManual({
      projectId: effectiveProjectId,
      sourceRespondentIds: respondentIds,
      deadline: null,
      deliveryChannel: campaign.delivery_channel,
    });

    const sentCount = Array.isArray(createdAssignments) ? createdAssignments.length : respondentIds.length;

    // campaign_assignment_map に記録
    if (Array.isArray(createdAssignments) && createdAssignments.length > 0) {
      const maps = (createdAssignments as { id: string }[]).map((a) => ({
        campaign_id: campaignId,
        assignment_id: a.id,
      }));
      await db.from("campaign_assignment_map").insert(maps);
    }

    // delivery_campaigns を sent に更新
    await deliveryCampaignRepository.update(campaignId, {
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_count: sentCount,
    });

    res.json({ ok: true, sent_count: sentCount });
  },

  // ============================================================
  // Phase 2-D: データ管理（NGワード・カテゴリ）
  // ============================================================

  async dataManagementPage(_req: Request, res: Response): Promise<void> {
    const { supabase: db } = await import("../config/supabase");
    const [ngResult, catResult] = await Promise.all([
      db.from("ng_words").select("*").order("created_at", { ascending: false }),
      db.from("post_categories").select("*").order("category_type").order("sort_order"),
    ]);
    res.render("admin/data-management/index", {
      title: "データ管理",
      ngWords: ngResult.data ?? [],
      categories: catResult.data ?? [],
    });
  },

  async createNgWord(req: Request, res: Response): Promise<void> {
    const word = bodyString(req.body.word).trim();
    if (!word) throw new HttpError(400, "ワードを入力してください");
    const category = bodyString(req.body.category).trim() || "general";
    const { supabase: db } = await import("../config/supabase");
    await db.from("ng_words").insert({ word, category });
    res.redirect("/admin/data-management");
  },

  async toggleNgWord(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    const { supabase: db } = await import("../config/supabase");
    const { data } = await db.from("ng_words").select("is_active").eq("id", id).single();
    if (data) {
      await db.from("ng_words").update({ is_active: !(data as { is_active: boolean }).is_active }).eq("id", id);
    }
    res.redirect("/admin/data-management");
  },

  async deleteNgWord(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    const { supabase: db } = await import("../config/supabase");
    await db.from("ng_words").delete().eq("id", id);
    res.redirect("/admin/data-management");
  },

  async createCategory(req: Request, res: Response): Promise<void> {
    const categoryType = bodyString(req.body.category_type).trim();
    if (categoryType !== "rant" && categoryType !== "diary") throw new HttpError(400, "種別が不正です");
    const name = bodyString(req.body.name).trim();
    if (!name) throw new HttpError(400, "カテゴリ名を入力してください");
    const sortOrder = Number(bodyString(req.body.sort_order)) || 0;
    const { supabase: db } = await import("../config/supabase");
    await db.from("post_categories").insert({ category_type: categoryType, name, sort_order: sortOrder });
    res.redirect("/admin/data-management");
  },

  async toggleCategory(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    const { supabase: db } = await import("../config/supabase");
    const { data } = await db.from("post_categories").select("is_active").eq("id", id).single();
    if (data) {
      await db.from("post_categories").update({ is_active: !(data as { is_active: boolean }).is_active }).eq("id", id);
    }
    res.redirect("/admin/data-management");
  },

  async deleteCategory(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    const { supabase: db } = await import("../config/supabase");
    await db.from("post_categories").delete().eq("id", id);
    res.redirect("/admin/data-management");
  },

  // ============================================================
  // スクリーニング条件管理
  // ============================================================

  async screeningPage(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    res.redirect(`/admin/projects/${projectId}/edit#screening-section`);
  },

  async addScreeningCondition(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const conditionType = bodyString(req.body.condition_type).trim();
    const targetKey = bodyString(req.body.target_key).trim();
    const operator = bodyString(req.body.operator).trim();
    const valueRaw = bodyString(req.body.value_json).trim();
    const priority = Number(bodyString(req.body.priority)) || 0;

    if (!conditionType || !targetKey || !operator || !valueRaw) {
      res.redirect(`/admin/projects/${projectId}/edit#screening-section`);
      return;
    }

    let valueJson: unknown;
    try {
      valueJson = JSON.parse(valueRaw);
    } catch {
      valueJson = valueRaw;
    }

    const { screeningConditionRepository } = await import("../repositories/screeningConditionRepository");
    await screeningConditionRepository.create({
      project_id: projectId,
      condition_type: conditionType as import("../types/domain").ScreeningConditionType,
      target_key: targetKey,
      operator: operator as import("../types/domain").ScreeningOperator,
      value_json: valueJson,
      priority
    });

    res.redirect(`/admin/projects/${projectId}/edit?notice=project_updated#screening-section`);
  },

  async deleteScreeningCondition(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const condId = routeParam(req, "condId");
    const { screeningConditionRepository } = await import("../repositories/screeningConditionRepository");
    await screeningConditionRepository.delete(condId);
    res.redirect(`/admin/projects/${projectId}/edit?notice=project_updated#screening-section`);
  },

  // ============================================================
  // USERプロファイル管理 (簡易パスワード認証付き)
  // ============================================================

  async userProfilesLoginPage(req: Request, res: Response): Promise<void> {
    if (upAdminIsAuthenticated(req)) {
      res.redirect("/admin/user-profiles");
      return;
    }
    const errorMessage = req.query.error === "1" ? "IDまたはパスワードが違います" : null;
    res.render("admin/user-profiles/login", { title: "ユーザー情報管理 ログイン", errorMessage });
  },

  async userProfilesLogin(req: Request, res: Response): Promise<void> {
    const id = bodyString(req.body.admin_id).trim();
    const pass = bodyString(req.body.admin_pass).trim();
    if (id === UP_ADMIN_ID && pass === UP_ADMIN_PASS) {
      res.setHeader(
        "Set-Cookie",
        `${UP_ADMIN_COOKIE}=${UP_ADMIN_TOKEN}; HttpOnly; Path=/admin/user-profiles; SameSite=Strict; Max-Age=86400`
      );
      res.redirect("/admin/user-profiles");
    } else {
      res.redirect("/admin/user-profiles/login?error=1");
    }
  },

  async userProfilesLogout(_req: Request, res: Response): Promise<void> {
    res.setHeader(
      "Set-Cookie",
      `${UP_ADMIN_COOKIE}=; HttpOnly; Path=/admin/user-profiles; SameSite=Strict; Max-Age=0`
    );
    res.redirect("/admin/user-profiles/login");
  },

  async userProfilesAdmin(req: Request, res: Response): Promise<void> {
    if (!upAdminIsAuthenticated(req)) {
      res.redirect("/admin/user-profiles/login");
      return;
    }

    const { supabase: db } = await import("../config/supabase");
    const q = req.query as Record<string, string>;

    let query = db.from("user_profiles").select("*", { count: "exact" });

    if (q.nickname) query = query.ilike("nickname", `%${q.nickname}%`);
    if (q.gender) query = query.eq("gender", q.gender);
    if (q.prefecture) query = query.eq("prefecture", q.prefecture);
    if (q.occupation) query = query.ilike("occupation", `%${q.occupation}%`);
    if (q.industry) query = query.ilike("industry", `%${q.industry}%`);
    if (q.marital_status) query = query.eq("marital_status", q.marital_status);
    if (q.has_children === "true") query = query.eq("has_children", true);
    if (q.has_children === "false") query = query.eq("has_children", false);
    if (q.profile_completed === "true") query = query.eq("profile_completed", true);
    if (q.profile_completed === "false") query = query.eq("profile_completed", false);
    if (q.age_from) {
      const yearTo = new Date().getFullYear() - Number(q.age_from);
      query = query.lte("birth_date", `${yearTo}-12-31`);
    }
    if (q.age_to) {
      const yearFrom = new Date().getFullYear() - Number(q.age_to) - 1;
      query = query.gte("birth_date", `${yearFrom + 1}-01-01`);
    }
    if (q.updated_from) query = query.gte("updated_at", q.updated_from);
    if (q.updated_to) query = query.lte("updated_at", `${q.updated_to}T23:59:59Z`);

    const page = Math.max(1, Number(q.page ?? "1"));
    const perPage = 50;
    const offset = (page - 1) * perPage;

    const { data, error, count } = await query
      .order("updated_at", { ascending: false })
      .range(offset, offset + perPage - 1);

    if (error) throw new HttpError(500, error.message);

    const profiles = (data ?? []) as import("../types/domain").UserProfile[];
    const total = count ?? 0;
    const totalPages = Math.ceil(total / perPage);

    res.render("admin/user-profiles/index", {
      title: "ユーザー情報管理",
      profiles,
      total,
      page,
      totalPages,
      perPage,
      filters: q,
    });
  },

  // ============================================================
  // デイリーアンケート管理
  // ============================================================

  async dailySurveys(req: Request, res: Response): Promise<void> {
    const surveys = await dailySurveyService.list();
    res.render("admin/daily-surveys/index", {
      title: "デイリーアンケート",
      surveys
    });
  },

  async newDailySurvey(req: Request, res: Response): Promise<void> {
    const templates = await notificationTemplateRepository.listByCategory("daily_survey");
    let segments: Awaited<ReturnType<typeof segmentRepository.list>> = [];
    try {
      segments = await segmentRepository.list();
    } catch {
      // segments テーブルが未設定または権限なしの場合は空配列で続行
    }
    res.render("admin/daily-surveys/form", {
      title: "デイリーアンケート作成",
      survey: null,
      questions: [],
      templates,
      segments,
      mode: "create"
    });
  },

  async createDailySurvey(req: Request, res: Response): Promise<void> {
    const b = req.body as Record<string, string>;
    const survey = await dailySurveyService.create({
      title: bodyString(b.title),
      description: b.description || null,
      reward_type: (b.reward_type as "fixed" | "random") || "fixed",
      reward_points: Number(b.reward_points ?? 5),
      reward_min_points: Number(b.reward_min_points ?? 3),
      reward_max_points: Number(b.reward_max_points ?? 20),
      target_segment_id: b.target_segment_id || null,
      scheduled_at: b.scheduled_at || null,
      expires_at: b.expires_at || null,
      notification_template_id: b.notification_template_id || null
    });
    res.redirect(`/admin/daily-surveys/${survey.id}`);
  },

  async editDailySurvey(req: Request, res: Response): Promise<void> {
    const surveyId = routeParam(req, "surveyId");
    const [survey, questions, templates, segmentsResult] = await Promise.all([
      dailySurveyService.getById(surveyId),
      dailySurveyService.listQuestions(surveyId),
      notificationTemplateRepository.listByCategory("daily_survey"),
      segmentRepository.list().catch(() => [] as Awaited<ReturnType<typeof segmentRepository.list>>)
    ]);
    const segments = segmentsResult;
    res.render("admin/daily-surveys/form", {
      title: "デイリーアンケート編集",
      survey,
      questions,
      templates,
      segments,
      mode: "edit"
    });
  },

  async updateDailySurvey(req: Request, res: Response): Promise<void> {
    const surveyId = routeParam(req, "surveyId");
    const b = req.body as Record<string, string>;
    await dailySurveyService.update(surveyId, {
      title: bodyString(b.title),
      description: b.description || null,
      reward_type: (b.reward_type as "fixed" | "random") || "fixed",
      reward_points: Number(b.reward_points ?? 5),
      reward_min_points: Number(b.reward_min_points ?? 3),
      reward_max_points: Number(b.reward_max_points ?? 20),
      target_segment_id: b.target_segment_id || null,
      scheduled_at: b.scheduled_at || null,
      expires_at: b.expires_at || null,
      notification_template_id: b.notification_template_id || null
    });
    res.redirect(`/admin/daily-surveys/${surveyId}`);
  },

  async deleteDailySurvey(req: Request, res: Response): Promise<void> {
    const surveyId = routeParam(req, "surveyId");
    await dailySurveyService.delete(surveyId);
    res.redirect("/admin/daily-surveys");
  },

  async showDailySurvey(req: Request, res: Response): Promise<void> {
    const surveyId = routeParam(req, "surveyId");
    const [survey, questions, deliveryStats] = await Promise.all([
      dailySurveyService.getById(surveyId),
      dailySurveyService.listQuestions(surveyId),
      dailySurveyRepository.getDeliveryStats(surveyId)
    ]);
    res.render("admin/daily-surveys/show", {
      title: survey.title,
      survey,
      questions,
      deliveryStats,
      queryParams: new URLSearchParams(req.query as Record<string, string>).toString()
    });
  },

  async updateDailySurveyStatus(req: Request, res: Response): Promise<void> {
    const surveyId = routeParam(req, "surveyId");
    const action = routeParam(req, "action") as "activate" | "pause" | "complete";
    if (action === "activate") await dailySurveyService.activate(surveyId);
    else if (action === "pause") await dailySurveyService.pause(surveyId);
    else if (action === "complete") await dailySurveyService.complete(surveyId);
    res.redirect(`/admin/daily-surveys/${surveyId}`);
  },

  async deliverDailySurvey(req: Request, res: Response): Promise<void> {
    const surveyId = routeParam(req, "surveyId");
    const b = req.body as Record<string, string>;
    const testMode = b.test_mode === "1";
    const targetIds = b.target_user_ids
      ? b.target_user_ids.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean)
      : [];
    const result = await dailySurveyService.deliver(surveyId, {
      testMode,
      targetLineUserIds: targetIds.length > 0 ? targetIds : undefined,
      liffBaseUrl: req.body.liff_base_url as string | undefined
    });
    res.redirect(
      `/admin/daily-surveys/${surveyId}?delivered=${result.sent}&failed=${result.failed}&total=${result.total}`
    );
  },

  // ── デイリーアンケート 設問管理 ──────────────────────────────

  async createDailySurveyQuestion(req: Request, res: Response): Promise<void> {
    const surveyId = routeParam(req, "surveyId");
    const b = req.body as Record<string, string>;
    let parsedOptions: Array<{ label: string; value: string }> = [];
    try {
      parsedOptions = JSON.parse(b.answer_options || "[]");
    } catch {
      parsedOptions = (b.answer_options || "")
        .split("\n")
        .map((line, i) => ({ label: line.trim(), value: `opt_${i + 1}` }))
        .filter((o) => o.label);
    }
    await dailySurveyService.createQuestion({
      survey_id: surveyId,
      question_text: bodyString(b.question_text),
      question_type: (b.question_type as import("../repositories/dailySurveyRepository").DailySurveyQuestion["question_type"]) || "single_choice",
      answer_options: parsedOptions,
      attribute_key: b.attribute_key || null,
      sort_order: Number(b.sort_order ?? 0)
    });
    res.redirect(`/admin/daily-surveys/${surveyId}/edit`);
  },

  async updateDailySurveyQuestion(req: Request, res: Response): Promise<void> {
    const surveyId = routeParam(req, "surveyId");
    const questionId = routeParam(req, "questionId");
    const b = req.body as Record<string, string>;
    let parsedOptions: Array<{ label: string; value: string }> = [];
    try {
      parsedOptions = JSON.parse(b.answer_options || "[]");
    } catch {
      parsedOptions = (b.answer_options || "")
        .split("\n")
        .map((line, i) => ({ label: line.trim(), value: `opt_${i + 1}` }))
        .filter((o) => o.label);
    }
    await dailySurveyService.updateQuestion(questionId, {
      question_text: bodyString(b.question_text),
      question_type: (b.question_type as import("../repositories/dailySurveyRepository").DailySurveyQuestion["question_type"]) || "single_choice",
      answer_options: parsedOptions,
      attribute_key: b.attribute_key || null,
      sort_order: Number(b.sort_order ?? 0)
    });
    res.redirect(`/admin/daily-surveys/${surveyId}/edit`);
  },

  async deleteDailySurveyQuestion(req: Request, res: Response): Promise<void> {
    const surveyId = routeParam(req, "surveyId");
    const questionId = routeParam(req, "questionId");
    await dailySurveyService.deleteQuestion(questionId);
    res.redirect(`/admin/daily-surveys/${surveyId}/edit`);
  },

  // ── デイリーアンケート 配信分析ダッシュボード ──────────────────

  async dailySurveyAnalytics(req: Request, res: Response): Promise<void> {
    const surveyId = routeParam(req, "surveyId");
    const [survey, deliveryStats, answerDistribution, timeline, notificationLogs] = await Promise.all([
      dailySurveyService.getById(surveyId),
      dailySurveyRepository.getDeliveryStats(surveyId),
      dailySurveyRepository.getAnswerDistribution(surveyId),
      dailySurveyRepository.getDeliveryTimeline(surveyId),
      dailySurveyRepository.getNotificationLogs(surveyId, 50)
    ]);
    res.render("admin/daily-surveys/analytics", {
      title: `${survey.title} - 配信分析`,
      survey,
      deliveryStats,
      answerDistribution,
      timeline,
      notificationLogs
    });
  },

  // ── AI 不足属性自動判定 API ────────────────────────────────────

  async apiMissingAttributeCoverage(_req: Request, res: Response): Promise<void> {
    const coverage = await missingAttributeService.computeCoverage();
    res.json({ coverage });
  },

  async apiMissingAttributeSuggest(req: Request, res: Response): Promise<void> {
    const topN = Number((req.query as Record<string, string>).top_n ?? "5");
    const suggestions = await missingAttributeService.suggestQuestions(Math.min(topN, 10));
    res.json({ suggestions });
  },

  // ============================================================
  // 通知テンプレート管理
  // ============================================================

  async notificationTemplates(req: Request, res: Response): Promise<void> {
    const filterCategory = (req.query.category as string) || "";
    const templates = filterCategory
      ? await notificationTemplateRepository.listByCategory(
          filterCategory as import("../repositories/notificationTemplateRepository").NotificationCategory,
          false
        )
      : await notificationTemplateRepository.list();
    res.render("admin/notification-templates/index", {
      title: "通知テンプレート",
      templates,
      filterCategory
    });
  },

  async newNotificationTemplate(req: Request, res: Response): Promise<void> {
    const prefillCategory = (req.query.category as string) || "";
    res.render("admin/notification-templates/form", {
      title: "通知テンプレート作成",
      template: null,
      prefillCategory,
      mode: "create"
    });
  },

  async createNotificationTemplate(req: Request, res: Response): Promise<void> {
    const b = req.body as Record<string, string>;
    const variables = extractVariables(b.body_text || "");
    await notificationTemplateRepository.create({
      category: b.category as import("../repositories/notificationTemplateRepository").NotificationCategory,
      name: bodyString(b.name),
      description: b.description || null,
      message_type: (b.message_type as "text" | "flex") || "text",
      title_text: b.title_text || null,
      body_text: bodyString(b.body_text),
      action_label: b.action_label || null,
      action_url: b.action_url || null,
      flex_template: null,
      variables,
      is_active: b.is_active === "1",
      is_default: b.is_default === "1"
    });
    res.redirect("/admin/notification-templates");
  },

  async editNotificationTemplate(req: Request, res: Response): Promise<void> {
    const templateId = routeParam(req, "templateId");
    const template = await notificationTemplateRepository.getById(templateId);
    res.render("admin/notification-templates/form", {
      title: "通知テンプレート編集",
      template,
      prefillCategory: template.category,
      mode: "edit"
    });
  },

  async updateNotificationTemplate(req: Request, res: Response): Promise<void> {
    const templateId = routeParam(req, "templateId");
    const b = req.body as Record<string, string>;
    const variables = extractVariables(b.body_text || "");
    await notificationTemplateRepository.update(templateId, {
      category: b.category as import("../repositories/notificationTemplateRepository").NotificationCategory,
      name: bodyString(b.name),
      description: b.description || null,
      message_type: (b.message_type as "text" | "flex") || "text",
      title_text: b.title_text || null,
      body_text: bodyString(b.body_text),
      action_label: b.action_label || null,
      action_url: b.action_url || null,
      variables,
      is_active: b.is_active === "1",
      is_default: b.is_default === "1"
    });
    res.redirect("/admin/notification-templates");
  },

  async deleteNotificationTemplate(req: Request, res: Response): Promise<void> {
    const templateId = routeParam(req, "templateId");
    await notificationTemplateRepository.delete(templateId);
    res.redirect("/admin/notification-templates");
  },

  async toggleNotificationTemplateActive(req: Request, res: Response): Promise<void> {
    const templateId = routeParam(req, "templateId");
    const current = await notificationTemplateRepository.getById(templateId);
    await notificationTemplateRepository.update(templateId, { is_active: !current.is_active });
    res.redirect("/admin/notification-templates");
  },

  async setNotificationTemplateDefault(req: Request, res: Response): Promise<void> {
    const templateId = routeParam(req, "templateId");
    const current = await notificationTemplateRepository.getById(templateId);
    // 同カテゴリの既存デフォルトを外す
    const allInCategory = await notificationTemplateRepository.listByCategory(current.category);
    for (const t of allInCategory) {
      if (t.is_default && t.id !== templateId) {
        await notificationTemplateRepository.update(t.id, { is_default: false });
      }
    }
    await notificationTemplateRepository.update(templateId, { is_default: true, is_active: true });
    res.redirect("/admin/notification-templates");
  },

  // ============================================================
  // 通知スケジューラ設定
  // ============================================================

  async schedulerSettings(req: Request, res: Response): Promise<void> {
    const settings = await notificationSchedulerService.getSettings();
    const flash = req.query.saved ? "設定を保存しました" : null;
    const jobResult = req.query.job
      ? { job: req.query.job as string, sent: Number(req.query.sent ?? 0), failed: Number(req.query.failed ?? 0), total: Number(req.query.total ?? 0) }
      : null;
    res.render("admin/scheduler-settings/index", {
      title: "通知スケジューラ設定",
      settings,
      flash,
      jobResult,
      activeJobCount: notificationSchedulerService.activeJobCount
    });
  },

  async updateSchedulerSettings(req: Request, res: Response): Promise<void> {
    const b = req.body as Record<string, string>;
    await notificationSchedulerService.updateSettings({
      morning_enabled: b.morning_enabled === "1",
      morning_time: b.morning_time || "08:00",
      evening_enabled: b.evening_enabled === "1",
      evening_time: b.evening_time || "18:00",
      reminder_enabled: b.reminder_enabled === "1",
      reminder_time: b.reminder_time || "20:00"
    });
    res.redirect("/admin/scheduler-settings?saved=1");
  },

  async runSchedulerJob(req: Request, res: Response): Promise<void> {
    const job = routeParam(req, "job") as "morning" | "evening" | "reminder";
    let result;
    if (job === "morning") result = await notificationSchedulerService.runDailyMorning();
    else if (job === "evening") result = await notificationSchedulerService.runDailyEvening();
    else result = await notificationSchedulerService.runUnansweredReminder();
    res.redirect(
      `/admin/scheduler-settings?job=${result.job}&sent=${result.sent}&failed=${result.failed}&total=${result.total}`
    );
  },

  // ============================================================
  // 報酬キャンペーン管理
  // ============================================================

  async rewardCampaigns(req: Request, res: Response): Promise<void> {
    const campaigns = await rewardCampaignService.list();
    const flash = req.query.saved ? "保存しました" : null;
    res.render("admin/reward-campaigns/index", { title: "報酬キャンペーン", campaigns, flash });
  },

  async newRewardCampaign(req: Request, res: Response): Promise<void> {
    const segments = await segmentRepository.list();
    res.render("admin/reward-campaigns/form", {
      title: "キャンペーン作成",
      campaign: null,
      segments,
      mode: "create"
    });
  },

  async createRewardCampaign(req: Request, res: Response): Promise<void> {
    const b = req.body as Record<string, string>;
    const conditionValue = buildConditionValue(b);
    await rewardCampaignService.create({
      name: bodyString(b.name),
      description: b.description || null,
      campaign_type: b.campaign_type as import("../repositories/rewardCampaignRepository").CampaignType,
      bonus_points: Number(b.bonus_points ?? 0),
      condition_type: b.condition_type as import("../repositories/rewardCampaignRepository").ConditionType,
      condition_value: conditionValue,
      target_segment_id: b.target_segment_id || null,
      start_at: b.start_at || null,
      end_at: b.end_at || null,
      is_active: b.is_active === "1"
    });
    res.redirect("/admin/reward-campaigns?saved=1");
  },

  async editRewardCampaign(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    const [campaign, segments] = await Promise.all([
      rewardCampaignService.getById(id),
      segmentRepository.list()
    ]);
    res.render("admin/reward-campaigns/form", {
      title: "キャンペーン編集",
      campaign,
      segments,
      mode: "edit"
    });
  },

  async updateRewardCampaign(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    const b = req.body as Record<string, string>;
    const conditionValue = buildConditionValue(b);
    await rewardCampaignService.update(id, {
      name: bodyString(b.name),
      description: b.description || null,
      campaign_type: b.campaign_type as import("../repositories/rewardCampaignRepository").CampaignType,
      bonus_points: Number(b.bonus_points ?? 0),
      condition_type: b.condition_type as import("../repositories/rewardCampaignRepository").ConditionType,
      condition_value: conditionValue,
      target_segment_id: b.target_segment_id || null,
      start_at: b.start_at || null,
      end_at: b.end_at || null,
      is_active: b.is_active === "1"
    });
    res.redirect("/admin/reward-campaigns?saved=1");
  },

  async deleteRewardCampaign(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    await rewardCampaignService.delete(id);
    res.redirect("/admin/reward-campaigns");
  },

  async toggleRewardCampaign(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    await rewardCampaignService.toggleActive(id);
    res.redirect("/admin/reward-campaigns");
  },

  // ============================================================
  // デイリー設問優先度管理
  // ============================================================

  async dailyQuestionPriorities(req: Request, res: Response): Promise<void> {
    const questions = await dailyQuestionPriorityService.list();
    const flash = req.query.saved ? "保存しました" : null;
    res.render("admin/daily-question-priorities/index", {
      title: "デイリー設問優先度",
      questions,
      flash
    });
  },

  async newDailyQuestionPriority(req: Request, res: Response): Promise<void> {
    const attrKeys = await userAttributeRepository.listDefinitions();
    res.render("admin/daily-question-priorities/form", {
      title: "優先設問 作成",
      question: null,
      attrKeys,
      mode: "create"
    });
  },

  async createDailyQuestionPriority(req: Request, res: Response): Promise<void> {
    const b = req.body as Record<string, string>;
    const answerOptions = parseDqpOptions(b.answer_options);
    await dailyQuestionPriorityService.create({
      priority_type: b.priority_type as import("../repositories/dailyQuestionPriorityRepository").PriorityType,
      attr_key: b.attr_key || null,
      question_text: bodyString(b.question_text),
      question_type: b.question_type as import("../repositories/dailyQuestionPriorityRepository").DailyQuestionType,
      answer_options: answerOptions,
      sort_order: Number(b.sort_order ?? 0),
      weight: Number(b.weight ?? 10),
      is_active: b.is_active === "1"
    });
    res.redirect("/admin/daily-question-priorities?saved=1");
  },

  async editDailyQuestionPriority(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    const [question, attrKeys] = await Promise.all([
      dailyQuestionPriorityService.getById(id),
      userAttributeRepository.listDefinitions()
    ]);
    res.render("admin/daily-question-priorities/form", {
      title: "優先設問 編集",
      question,
      attrKeys,
      mode: "edit"
    });
  },

  async updateDailyQuestionPriority(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    const b = req.body as Record<string, string>;
    const answerOptions = parseDqpOptions(b.answer_options);
    await dailyQuestionPriorityService.update(id, {
      priority_type: b.priority_type as import("../repositories/dailyQuestionPriorityRepository").PriorityType,
      attr_key: b.attr_key || null,
      question_text: bodyString(b.question_text),
      question_type: b.question_type as import("../repositories/dailyQuestionPriorityRepository").DailyQuestionType,
      answer_options: answerOptions,
      sort_order: Number(b.sort_order ?? 0),
      weight: Number(b.weight ?? 10),
      is_active: b.is_active === "1"
    });
    res.redirect("/admin/daily-question-priorities?saved=1");
  },

  async deleteDailyQuestionPriority(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    await dailyQuestionPriorityService.delete(id);
    res.redirect("/admin/daily-question-priorities");
  },

  async toggleDailyQuestionPriority(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    await dailyQuestionPriorityService.toggleActive(id);
    res.redirect("/admin/daily-question-priorities");
  },

  // ============================================================
  // 配信テンプレート管理
  // ============================================================

  async listDeliveryTemplates(_req: Request, res: Response): Promise<void> {
    const [templates, logs] = await Promise.all([
      deliveryTemplateRepository.list(),
      deliveryTemplateRepository.listAllLogs(30),
    ]);
    const notificationTemplates = await notificationTemplateRepository.list();
    res.render("admin/delivery-templates/list", {
      title: "配信テンプレート管理",
      templates,
      logs,
      notificationTemplates,
    });
  },

  async newDeliveryTemplate(_req: Request, res: Response): Promise<void> {
    const notificationTemplates = await notificationTemplateRepository.list();
    res.render("admin/delivery-templates/form", {
      title: "配信テンプレート 新規作成",
      template: null,
      action: "/admin/delivery-templates",
      notificationTemplates,
    });
  },

  async createDeliveryTemplate(req: Request, res: Response): Promise<void> {
    const b = req.body as Record<string, string | string[]>;
    const rawTargetTypes = Array.isArray(b.target_types) ? b.target_types : (b.target_types ? [b.target_types] : []);
    const scheduleType = bodyString(b.schedule_type) as DeliveryScheduleType;
    const scheduleConfig = buildScheduleConfig(scheduleType, b);
    const input: DeliveryTemplateMutationInput = {
      name: bodyString(b.name),
      is_enabled: b.is_enabled === "on" || b.is_enabled === "true",
      schedule_type: scheduleType,
      schedule_config: scheduleConfig,
      target_types: rawTargetTypes as import("../types/domain").DeliveryType[],
      require_status: bodyString(b.require_status) || "ready",
      require_delivery_enabled: b.require_delivery_enabled !== "false",
      created_within_hours: parseOptionalInteger(b.created_within_hours),
      notification_template_id: bodyString(b.notification_template_id) || null,
    };
    await deliveryTemplateRepository.create(input);
    res.redirect("/admin/delivery-templates?created=1");
  },

  async editDeliveryTemplate(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    const [template, notificationTemplates] = await Promise.all([
      deliveryTemplateRepository.getById(id),
      notificationTemplateRepository.list(),
    ]);
    const logs = await deliveryTemplateRepository.listLogs(id);
    res.render("admin/delivery-templates/form", {
      title: "配信テンプレート 編集",
      template,
      action: `/admin/delivery-templates/${id}`,
      notificationTemplates,
      logs,
    });
  },

  async updateDeliveryTemplate(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    const b = req.body as Record<string, string | string[]>;
    const rawTargetTypes = Array.isArray(b.target_types) ? b.target_types : (b.target_types ? [b.target_types] : []);
    const scheduleType = bodyString(b.schedule_type) as DeliveryScheduleType;
    const scheduleConfig = buildScheduleConfig(scheduleType, b);
    const input: Partial<DeliveryTemplateMutationInput> = {
      name: bodyString(b.name),
      is_enabled: b.is_enabled === "on" || b.is_enabled === "true",
      schedule_type: scheduleType,
      schedule_config: scheduleConfig,
      target_types: rawTargetTypes as import("../types/domain").DeliveryType[],
      require_status: bodyString(b.require_status) || "ready",
      require_delivery_enabled: b.require_delivery_enabled !== "false",
      created_within_hours: parseOptionalInteger(b.created_within_hours),
      notification_template_id: bodyString(b.notification_template_id) || null,
    };
    await deliveryTemplateRepository.update(id, input);
    // スケジューラーを再起動して新しいcronを反映
    const { notificationSchedulerService } = await import("../services/notificationSchedulerService");
    await notificationSchedulerService.restartScheduler();
    res.redirect(`/admin/delivery-templates/${id}/edit?saved=1`);
  },

  async deleteDeliveryTemplate(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    await deliveryTemplateRepository.deleteById(id);
    const { notificationSchedulerService } = await import("../services/notificationSchedulerService");
    await notificationSchedulerService.restartScheduler();
    res.redirect("/admin/delivery-templates?deleted=1");
  },

  async runDeliveryTemplate(req: Request, res: Response): Promise<void> {
    const id = routeParam(req, "id");
    const result = await projectDeliveryService.runTemplate(id);
    res.json({ ok: true, result });
  },

  // ============================================================
  // 配信オペレーション
  // ============================================================

  async deliveryOperationsPage(_req: Request, res: Response): Promise<void> {
    const { documentRepository } = await import("../repositories/documentRepository");
    const [projects, segments, notificationTemplates, campaigns] = await Promise.all([
      projectRepository.list(),
      segmentRepository.list(),
      notificationTemplateRepository.list(),
      deliveryCampaignRepository.list(),
    ]);
    const [globalDocuments, projectDocumentRows] = await Promise.all([
      documentRepository.listGlobalRequired(),
      documentRepository.listProjectDocumentsForProjects(projects.map((p) => p.id)),
    ]);

    const campaignsByProject = new Map<string, typeof campaigns>();
    for (const c of campaigns) {
      if (!c.project_id) continue;
      if (!campaignsByProject.has(c.project_id)) campaignsByProject.set(c.project_id, []);
      campaignsByProject.get(c.project_id)!.push(c);
    }

    const documentRequirementsByProject = new Map<string, Array<{
      documentId: string;
      title: string;
      versionNo: string | null;
      isRequired: boolean;
    }>>();
    for (const row of projectDocumentRows) {
      if (!documentRequirementsByProject.has(row.project_id)) {
        documentRequirementsByProject.set(row.project_id, []);
      }
      documentRequirementsByProject.get(row.project_id)!.push({
        documentId: row.document_id,
        title: row.document.title,
        versionNo: row.document.current_version?.version_no ?? null,
        isRequired: row.is_required,
      });
    }

    const globalConsentDocuments = globalDocuments.map((doc) => ({
      documentId: doc.id,
      title: doc.title,
      versionNo: doc.current_version?.version_no ?? null,
      isRequired: true,
    }));

    const projectsWithMeta = projects.map(p => {
      const pCampaigns = campaignsByProject.get(p.id) ?? [];
      const hasScheduled = pCampaigns.some(c => c.status === "scheduled");
      const hasSent = pCampaigns.some(c => c.status === "sent");
      let deliveryStatus = "undelivered";
      if (hasScheduled) deliveryStatus = "scheduled";
      else if (hasSent && p.delivery_enabled) deliveryStatus = "in_progress";
      else if (hasSent) deliveryStatus = "completed";
      else if (p.delivery_enabled) deliveryStatus = "ready";
      else if (p.delivered_at) deliveryStatus = "paused";
      return {
        ...p,
        deliveryStatus,
        campaigns: pCampaigns,
        documentRequirements: documentRequirementsByProject.get(p.id) ?? [],
      };
    });

    res.render("admin/delivery-operations/index", {
      title: "配信オペレーション",
      projects: projectsWithMeta,
      segments,
      notificationTemplates,
      campaigns,
      globalConsentDocuments,
    });
  },

  async apiDeliveryOperationsUpdateProject(req: Request, res: Response): Promise<void> {
    const projectId = bodyString(req.body.project_id);
    if (!projectId) {
      res.status(400).json({ error: "project_id is required" });
      return;
    }
    const deliveryEnabled: boolean = req.body.delivery_enabled === true || req.body.delivery_enabled === "true";
    await projectRepository.update(projectId, { delivery_enabled: deliveryEnabled });
    res.json({ ok: true });
  },

  // ============================================================
  // 書類管理 (documents)
  // ============================================================

  async documentsList(req: Request, res: Response): Promise<void> {
    const { documentRepository } = await import("../repositories/documentRepository");
    let documents: Awaited<ReturnType<typeof documentRepository.list>> = [];
    let errorMessage: string | null = null;
    try {
      documents = await documentRepository.list();
    } catch {
      errorMessage = "書類の取得に失敗しました。システム管理者へお問い合わせください。";
      logger.error("documentsList: failed to fetch documents");
    }
    res.render("admin/documents/index", {
      title: "書類管理",
      documents,
      errorMessage,
      created: req.query.created === "1",
      saved: req.query.saved === "1",
    });
  },

  async newDocumentPage(_req: Request, res: Response): Promise<void> {
    res.render("admin/documents/form", {
      title: "書類を新規作成",
      action: "/admin/documents",
      document: null,
    });
  },

  async createDocument(req: Request, res: Response): Promise<void> {
    const { documentRepository } = await import("../repositories/documentRepository");
    const { consentService } = await import("../services/consentService");

    const title = bodyString(req.body.title).trim();
    const documentType = bodyString(req.body.document_type).trim();
    const usageCategory = normalizeUsageCategory(req.body.usage_category);
    const description = bodyString(req.body.description).trim() || null;
    const isActive = req.body.is_active === "true";
    const isRequiredGlobal = req.body.is_required_global === "true";

    if (!title || !documentType) {
      res.render("admin/documents/form", {
        title: "書類を新規作成",
        action: "/admin/documents",
        document: req.body,
        error: "書類種別とタイトルは必須です",
      });
      return;
    }

    let doc;
    try {
      doc = await documentRepository.create({ document_type: documentType, usage_category: usageCategory, title, description: description ?? undefined, is_active: isActive, is_required_global: isRequiredGlobal });
    } catch {
      logger.error("createDocument: failed to create document");
      res.render("admin/documents/form", {
        title: "書類を新規作成",
        action: "/admin/documents",
        document: req.body,
        error: "書類の登録に失敗しました。システム管理者へお問い合わせください。",
      });
      return;
    }

    const content = bodyString(req.body.content).trim();
    const versionNo = bodyString(req.body.version_no).trim() || "1.0";
    if (content) {
      try {
        await consentService.publishNewVersion(doc.id, {
          versionNo,
          content,
          changeReason: bodyString(req.body.change_reason).trim() || "初版",
          createdBy: "admin",
        });
      } catch {
        logger.error("createDocument: failed to create initial version");
        res.render("admin/documents/form", {
          title: "書類を新規作成",
          action: "/admin/documents",
          document: req.body,
          error: "書類は登録されましたが、バージョンの作成に失敗しました。システム管理者へお問い合わせください。",
        });
        return;
      }
    }

    res.redirect(`/admin/documents?created=1`);
  },

  async showDocument(req: Request, res: Response): Promise<void> {
    const { documentRepository } = await import("../repositories/documentRepository");
    const docId = routeParam(req, "documentId");
    const [doc, versions] = await Promise.all([
      documentRepository.getById(docId),
      documentRepository.listVersions(docId),
    ]);
    if (!doc) throw new HttpError(404, "書類が見つかりません");
    res.render("admin/documents/show", {
      title: doc.title,
      document: doc,
      versions,
    });
  },

  async editDocumentPage(req: Request, res: Response): Promise<void> {
    const { documentRepository } = await import("../repositories/documentRepository");
    const docId = routeParam(req, "documentId");
    const doc = await documentRepository.getById(docId);
    if (!doc) throw new HttpError(404, "書類が見つかりません");
    res.render("admin/documents/form", {
      title: `編集: ${doc.title}`,
      action: `/admin/documents/${docId}`,
      document: doc,
    });
  },

  async updateDocument(req: Request, res: Response): Promise<void> {
    const { documentRepository } = await import("../repositories/documentRepository");
    const docId = routeParam(req, "documentId");
    const title = bodyString(req.body.title).trim();
    const documentType = bodyString(req.body.document_type).trim();
    const usageCategory = normalizeUsageCategory(req.body.usage_category);
    const description = bodyString(req.body.description).trim() || null;
    const isActive = req.body.is_active === "true";
    const isRequiredGlobal = req.body.is_required_global === "true";

    try {
      await documentRepository.update(docId, {
        title: title || undefined,
        document_type: documentType || undefined,
        usage_category: usageCategory,
        description: description !== null ? description : undefined,
        is_active: isActive,
        is_required_global: isRequiredGlobal,
      });
    } catch {
      logger.error("updateDocument: failed to update document", { docId });
      const doc = await documentRepository.getById(docId).catch(() => null);
      res.status(500).render("admin/documents/form", {
        title: `編集: ${doc?.title ?? docId}`,
        action: `/admin/documents/${docId}`,
        document: { ...req.body, id: docId },
        error: "書類の更新に失敗しました。システム管理者へお問い合わせください。",
      });
      return;
    }
    res.redirect(`/admin/documents/${docId}?saved=1`);
  },

  async newDocumentVersionPage(req: Request, res: Response): Promise<void> {
    const { documentRepository } = await import("../repositories/documentRepository");
    const docId = routeParam(req, "documentId");
    const doc = await documentRepository.getById(docId);
    if (!doc) throw new HttpError(404, "書類が見つかりません");

    let suggestedVersionNo = "1.0";
    if (doc.current_version) {
      const parts = doc.current_version.version_no.split(".");
      const minor = parseInt(parts[1] ?? "0", 10) + 1;
      suggestedVersionNo = `${parts[0]}.${minor}`;
    }

    res.render("admin/documents/version-form", {
      title: `新バージョン追加: ${doc.title}`,
      document: doc,
      suggestedVersionNo,
    });
  },

  async createDocumentVersion(req: Request, res: Response): Promise<void> {
    const { consentService } = await import("../services/consentService");
    const docId = routeParam(req, "documentId");
    const versionNo = bodyString(req.body.version_no).trim();
    const content = bodyString(req.body.content).trim();
    const changeReason = bodyString(req.body.change_reason).trim();

    if (!versionNo || !content) {
      const { documentRepository } = await import("../repositories/documentRepository");
      const doc = await documentRepository.getById(docId);
      res.render("admin/documents/version-form", {
        title: `新バージョン追加`,
        document: doc,
        suggestedVersionNo: versionNo,
        error: "バージョン番号と本文は必須です",
      });
      return;
    }

    try {
      await consentService.publishNewVersion(docId, {
        versionNo,
        content,
        changeReason: changeReason || undefined,
        createdBy: "admin",
      });
    } catch {
      logger.error("createDocumentVersion: failed to publish version", { docId });
      const { documentRepository: repo } = await import("../repositories/documentRepository");
      const doc = await repo.getById(docId).catch(() => null);
      res.status(500).render("admin/documents/version-form", {
        title: `新バージョン追加`,
        document: doc,
        suggestedVersionNo: versionNo,
        error: "バージョンの公開に失敗しました。システム管理者へお問い合わせください。",
      });
      return;
    }

    res.redirect(`/admin/documents/${docId}?saved=1`);
  },

  async documentConsentAudit(req: Request, res: Response): Promise<void> {
    const { documentRepository } = await import("../repositories/documentRepository");
    const { userConsentRecordRepository } = await import("../repositories/userConsentRecordRepository");
    const docId = routeParam(req, "documentId");

    const doc = await documentRepository.getById(docId);
    if (!doc) throw new HttpError(404, "書類が見つかりません");

    const versions = await documentRepository.listVersions(docId);
    const selectedVersionId = typeof req.query.version_id === "string" ? req.query.version_id : undefined;
    const selectedLineUserId = typeof req.query.line_user_id === "string" ? req.query.line_user_id : undefined;
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const pageSize = 50;

    const { records, total } = await userConsentRecordRepository.listByDocument(
      docId,
      selectedVersionId,
      pageSize,
      (page - 1) * pageSize
    );

    // ユーザーIDフィルタ（DBフィルタに追加）
    const filteredRecords = selectedLineUserId
      ? records.filter(r => r.line_user_id.includes(selectedLineUserId))
      : records;

    res.render("admin/documents/consent-audit", {
      title: `同意者一覧: ${doc.title}`,
      document: doc,
      versions,
      records: filteredRecords,
      total,
      page,
      pageSize,
      selectedVersionId,
      selectedLineUserId,
    });
  },

  // ── 交換申請管理 ────────────────────────────────────────────────

  async exchangeRequestsPage(req: Request, res: Response): Promise<void> {
    const { pointExchangeRepository } = await import("../repositories/pointExchangeRepository");
    const statusFilter = typeof req.query.status === "string" ? req.query.status : "all";
    const page  = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
    const limit = 50;

    const [allRequests, monthlyStats, flaggedUsers] = await Promise.all([
      pointExchangeRepository.listAll(500, 0),
      pointExchangeRepository.getMonthlyStats(),
      pointExchangeRepository.getFlaggedUsers(30, 3),
    ]);

    const filtered = statusFilter === "all"
      ? allRequests
      : allRequests.filter(r => r.status === statusFilter);
    const total   = filtered.length;
    const requests = filtered.slice((page - 1) * limit, page * limit);

    const counts = {
      all:       allRequests.length,
      pending:   allRequests.filter(r => r.status === "pending").length,
      approved:  allRequests.filter(r => r.status === "approved").length,
      fulfilled: allRequests.filter(r => r.status === "fulfilled").length,
      rejected:  allRequests.filter(r => r.status === "rejected").length,
      canceled:  allRequests.filter(r => r.status === "canceled").length,
    };

    const flaggedUserIds = new Set(flaggedUsers.map(u => u.line_user_id));

    res.render("admin/exchange-requests/index", {
      title: "交換申請管理",
      requests,
      counts,
      statusFilter,
      total,
      page,
      limit,
      monthlyStats,
      flaggedUsers,
      flaggedUserIds: [...flaggedUserIds],
    });
  },

  /** ヘッダーの通知バッジ用: 申請中(pending)の交換申請件数を返す */
  async pendingExchangeCount(_req: Request, res: Response): Promise<void> {
    const { pointExchangeRepository } = await import("../repositories/pointExchangeRepository");
    const count = await pointExchangeRepository.countPending();
    res.json({ count });
  },

  async approveExchange(req: Request, res: Response): Promise<void> {
    const { pointExchangeRepository } = await import("../repositories/pointExchangeRepository");
    const { pointExchangeAuditLogRepository } = await import("../repositories/pointExchangeAuditLogRepository");
    const { pointExchangeService } = await import("../services/pointExchangeService");
    const id = routeParam(req, "id");
    await pointExchangeRepository.approve(id, "admin");
    // 金銭系の監査ログ・通知はレスポンス前に await（サーバーレスで打ち切られないように）。
    // 監査ログは必ず残す。通知失敗は redirect を止めないようログのみ。
    await pointExchangeAuditLogRepository.create({ requestId: id, action: "approved", adminId: "admin" });
    try { await pointExchangeService.sendApprovedNotification(id); }
    catch (err) { logger.warn("approveExchange.notify.failed", { id, error: String(err) }); }
    res.redirect("/admin/exchange-requests?status=approved");
  },

  async rejectExchange(req: Request, res: Response): Promise<void> {
    const { pointExchangeService } = await import("../services/pointExchangeService");
    const { pointExchangeAuditLogRepository } = await import("../repositories/pointExchangeAuditLogRepository");
    const id     = routeParam(req, "id");
    const reason = typeof req.body.reason === "string" ? req.body.reason.trim() : "管理者による却下";
    await pointExchangeService.rejectExchange(id, "admin", reason);
    await pointExchangeAuditLogRepository.create({ requestId: id, action: "rejected", adminId: "admin", detail: { reason } });
    res.redirect("/admin/exchange-requests?status=rejected");
  },

  async fulfillExchange(req: Request, res: Response): Promise<void> {
    const { pointExchangeRepository } = await import("../repositories/pointExchangeRepository");
    const id      = routeParam(req, "id");
    const adminId = (req as Request & { user?: { id?: string } }).user?.id ?? "admin";
    const giftUrl      = typeof req.body.gift_url      === "string" ? req.body.gift_url.trim()      : "";
    const giftProvider = typeof req.body.gift_provider === "string" ? req.body.gift_provider.trim() : "manual";
    const giftCode     = typeof req.body.gift_code     === "string" ? req.body.gift_code.trim()     : undefined;
    const expiresAt    = typeof req.body.expires_at    === "string" ? req.body.expires_at.trim()    : undefined;
    const adminMemo    = typeof req.body.admin_memo    === "string" ? req.body.admin_memo.trim()     : undefined;

    if (!giftUrl) throw new HttpError(400, "gift_url は必須です");

    const { pointExchangeService } = await import("../services/pointExchangeService");
    const { pointExchangeAuditLogRepository } = await import("../repositories/pointExchangeAuditLogRepository");
    await pointExchangeRepository.fulfill(id, adminId, {
      giftProvider,
      giftCode:    giftCode    || undefined,
      giftUrl,
      expiresAt:   expiresAt   || undefined,
      adminMemo:   adminMemo   || undefined,
    });
    await pointExchangeAuditLogRepository.create({
      requestId: id,
      action:    "fulfilled",
      adminId:   "admin",
      detail:    { gift_provider: giftProvider, expires_at: expiresAt || null },
    });
    try { await pointExchangeService.sendFulfilledNotification(id); }
    catch (err) { logger.warn("fulfillExchange.notify.failed", { id, error: String(err) }); }

    res.redirect("/admin/exchange-requests?status=fulfilled");
  },

  async resendExchangeNotification(req: Request, res: Response): Promise<void> {
    const { pointExchangeRepository } = await import("../repositories/pointExchangeRepository");
    const { pointExchangeService } = await import("../services/pointExchangeService");
    const id = routeParam(req, "id");
    const request = await pointExchangeRepository.getById(id);
    if (!request) throw new HttpError(404, "申請が見つかりません");

    if (request.status === "approved") {
      await pointExchangeService.sendApprovedNotification(id);
    } else if (request.status === "fulfilled") {
      await pointExchangeService.sendFulfilledNotification(id);
    } else {
      throw new HttpError(400, `通知再送できないステータスです（現在: ${request.status}）`);
    }

    res.redirect("/admin/exchange-requests");
  },

  // ─────────────────────────────────────────────────────────────────────────
  // プロンプトプレビュー API
  // ─────────────────────────────────────────────────────────────────────────

  async apiPreviewPrompt(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const rawProject = await projectRepository.getById(projectId);
    const promptKey = bodyString(req.body.prompt_key) as BasePromptKey;

    if (!BASE_PROMPT_TEMPLATES[promptKey]) {
      res.status(400).json({ error: `不正なpromptKey: ${promptKey}` });
      return;
    }

    // Phase 6: パッケージ + 個別オーバーライド適用後の実効設定でプレビューする
    const { resolveEffectiveProjectConfig } = await import("../services/aiService");
    const { effectiveProject: project } = await resolveEffectiveProjectConfig(rawProject);

    const def = BASE_PROMPT_TEMPLATES[promptKey];
    const template = resolveBasePromptTemplate(project, promptKey);
    const isCustom = template !== def.template;

    // 各プレースホルダーをラベル付きサンプル値で埋める
    const context: Record<string, string> = {};
    for (const ph of def.allowedPlaceholders) {
      context[ph] = `【${describePlaceholder(ph)}】`;
    }

    // sharedSections は実際のポリシーを適用する
    if (def.allowedPlaceholders.includes("sharedSections")) {
      const purpose = promptKey.includes("Probe") ? "probe"
        : promptKey.includes("Analysis") || promptKey.includes("Summary") ? "analysis"
        : "general";
      context["sharedSections"] = renderPromptPolicySections(project, purpose) ?? "";
    }

    const rendered = renderPromptTemplate(template, context);
    const policy = resolveAIPromptPolicy(project);

    res.json({
      promptKey,
      label: def.label,
      templateMode: isCustom ? "custom_template" : "base_template",
      template,
      rendered,
      policy,
      allowedPlaceholders: def.allowedPlaceholders.map(ph => ({
        key: ph,
        description: describePlaceholder(ph)
      }))
    });
  },

  // ─────────────────────────────────────────────────────────────────────────
  // プロンプトテスト実行 API
  // ─────────────────────────────────────────────────────────────────────────

  async apiTestRunPrompt(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const rawProject = await projectRepository.getById(projectId);
    const promptKey = bodyString(req.body.prompt_key) as BasePromptKey;

    if (!BASE_PROMPT_TEMPLATES[promptKey]) {
      res.status(400).json({ error: `不正なpromptKey: ${promptKey}` });
      return;
    }

    // Phase 6: パッケージ + 個別オーバーライド適用後の実効設定でテストする
    const { resolveEffectiveProjectConfig } = await import("../services/aiService");
    const { effectiveProject: project } = await resolveEffectiveProjectConfig(rawProject);

    const def = BASE_PROMPT_TEMPLATES[promptKey];
    const template = resolveBasePromptTemplate(project, promptKey);
    const isCustom = template !== def.template;

    // リクエストから提供されたサンプル値を取得
    const sampleValues: Record<string, string> = {};
    try {
      const raw = bodyString(req.body.sample_values);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          for (const [k, v] of Object.entries(parsed)) {
            if (typeof v === "string") sampleValues[k] = v;
          }
        }
      }
    } catch {
      // 無視: サンプル値が無効でもデフォルトで続行
    }

    // プレースホルダーを埋める（提供値 > ラベル付きサンプル値）
    const context: Record<string, string> = {};
    for (const ph of def.allowedPlaceholders) {
      context[ph] = sampleValues[ph] ?? `【${describePlaceholder(ph)}】`;
    }

    // sharedSections は実際のポリシーを適用
    if (def.allowedPlaceholders.includes("sharedSections")) {
      const purpose = promptKey.includes("Probe") ? "probe"
        : promptKey.includes("Analysis") || promptKey.includes("Summary") ? "analysis"
        : "general";
      context["sharedSections"] = renderPromptPolicySections(project, purpose) ?? "";
    }

    const rendered = renderPromptTemplate(template, context);
    const policy = resolveAIPromptPolicy(project);

    // AI呼び出しが要求されている場合
    const callAI = req.body.call_ai === "1" || req.body.call_ai === "true";
    let aiResponse: string | null = null;
    let aiError: string | null = null;
    let tokenUsage: Record<string, unknown> | null = null;

    if (callAI) {
      try {
        const { aiService } = await import("../services/aiService");
        const result = await aiService.callRaw({ prompt: rendered });
        aiResponse = result.content ?? null;
        tokenUsage = result.tokenUsage ?? null;
      } catch (err) {
        aiError = err instanceof Error ? err.message : String(err);
      }
    }

    res.json({
      promptKey,
      label: def.label,
      templateMode: isCustom ? "custom_template" : "base_template",
      template,
      rendered,
      policy,
      sampleValues: context,
      aiResponse,
      aiError,
      tokenUsage
    });
  },

  // ─────────────────────────────────────────────────────────────────────────
  // AIログ閲覧
  // ─────────────────────────────────────────────────────────────────────────

  async aiLogsPage(req: Request, res: Response): Promise<void> {
    const projectId = typeof req.query.project_id === "string" ? req.query.project_id : undefined;
    const promptKey = typeof req.query.prompt_key === "string" ? req.query.prompt_key : undefined;
    const page = Math.max(1, parseInt(typeof req.query.page === "string" ? req.query.page : "1", 10) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const { logs, total } = await aiLogRepository.listWithProject({ projectId, promptKey, limit, offset });
    const promptKeyOptions = Object.keys(BASE_PROMPT_TEMPLATES);

    res.render("admin/ai-logs/index", {
      title: "AIログ",
      logs,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
      filters: { projectId, promptKey },
      promptKeyOptions
    });
  },

  async aiLogDetailPage(req: Request, res: Response): Promise<void> {
    const logId = routeParam(req, "logId");
    const log = await aiLogRepository.getByIdWithProject(logId);
    if (!log) throw new HttpError(404, "ログが見つかりません");
    res.render("admin/ai-logs/show", { title: "AIログ詳細", log });
  },

  async exportDocumentConsents(req: Request, res: Response): Promise<void> {
    const { userConsentRecordRepository } = await import("../repositories/userConsentRecordRepository");
    const filters = {
      documentId: typeof req.query.document_id === "string" ? req.query.document_id : undefined,
      versionId: typeof req.query.version_id === "string" ? req.query.version_id : undefined,
      projectId: typeof req.query.project_id === "string" ? req.query.project_id : undefined,
      lineUserId: typeof req.query.line_user_id === "string" ? req.query.line_user_id : undefined,
      fromDate: typeof req.query.from_date === "string" ? req.query.from_date : undefined,
      toDate: typeof req.query.to_date === "string" ? req.query.to_date : undefined,
    };

    const records = await userConsentRecordRepository.listForExport(filters);

    const header = "line_user_id,document_id,document_title,version_no,project_id,consented_at,consent_source,ip_address\n";
    const rows = records.map(r => {
      const docTitle = (r.document as { title?: string } | null)?.title ?? "";
      const versionNo = (r.document_version as { version_no?: string } | null)?.version_no ?? "";
      return [
        r.line_user_id,
        r.document_id,
        `"${docTitle.replace(/"/g, '""')}"`,
        versionNo,
        r.project_id ?? "",
        r.consented_at,
        r.consent_source,
        r.ip_address ?? "",
      ].join(",");
    });

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=consents.csv");
    res.send("﻿" + header + rows.join("\n"));
  },

  // ============================================================
  // プロンプトパッケージ管理
  // ============================================================

  async promptPackagesPage(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const packages = await promptPackageRepository.list();
    res.render("admin/prompt-packages/index", {
      title: "プロンプトパッケージ管理",
      packages,
      summarizeTemplateDefinitions,
      summarizeTemplateDefinitionsByFamily,
      created: req.query.created === "1",
      saved: req.query.saved === "1",
      cloned: req.query.cloned === "1",
    });
  },

  /**
   * Phase G: custom モード整理のための移行レポート。
   * - custom プロジェクト一覧と移行候補
   * - package モードだがバージョン未設定
   * - archived バージョン参照（実行時 fallback）
   * - orphan 参照（draft / 削除済みバージョン）
   */
  async promptMigrationReportPage(_req: Request, res: Response): Promise<void> {
    const { report } = await loadPromptMigrationData();
    res.render("admin/prompt-packages/migration", {
      title: "プロンプト移行レポート（custom 整理）",
      report,
    });
  },

  /**
   * Phase D: custom→package 実データ移行を実行する。
   * confirm=1 で確定実行、それ以外は dry-run（プラン提示のみ・書込みなし）。
   * 失敗アイテムはそのプロジェクトを custom 維持（可逆）。legacy 経路・列は温存する。
   */
  async executePromptMigration(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const { buildMigrationPlan, executeMigrationPlan } = await import("../services/promptMigrationService");

    const dryRun = bodyString(req.body.confirm) !== "1";
    const changedBy = resolveAdminOperator(req);

    const { projects } = await loadPromptMigrationData();
    const plan = buildMigrationPlan(
      projects.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        ai_prompt_mode: p.ai_prompt_mode,
        ai_prompt_package_version_id: p.ai_prompt_package_version_id,
        ai_prompt_policy_json: p.ai_prompt_policy_json,
        ai_prompt_templates_json: p.ai_prompt_templates_json,
      }))
    );

    const migrationResult = await executeMigrationPlan(
      plan,
      {
        createPackage: (input) => promptPackageRepository.create(input),
        createVersion: (input) =>
          promptPackageRepository.createVersion({
            package_id: input.package_id,
            policy_json: input.policy_json as AIPromptPolicy | null,
            templates_json: input.templates_json as AIPromptTemplateMap | null,
            change_note: input.change_note,
          }),
        publishVersion: (versionId) => promptPackageRepository.publishVersion(versionId),
        repointProject: async (projectId, versionId) => {
          await projectRepository.update(projectId, {
            ai_prompt_mode: "package",
            ai_prompt_package_version_id: versionId,
            ai_prompt_policy_json: null,
            ai_prompt_templates_json: null,
            ai_prompt_overrides_json: null,
          });
        },
        recordChangeLog: (input) => recordPackageChangeLog(input),
      },
      { dryRun, changedBy }
    );

    // 実行後は最新状態でレポートを再生成（dry-run でも害なし）
    const { report } = await loadPromptMigrationData();
    res.render("admin/prompt-packages/migration", {
      title: "プロンプト移行レポート（custom 整理）",
      report,
      migrationResult,
    });
  },

  async newPromptPackagePage(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const existingPackages = await promptPackageRepository.list().catch(() => []);
    // 深いリンク（一覧/詳細の「Version追加」）: ?mode=version&package_id=<id> で初期選択する
    const initialMode = queryString(req.query.mode) === "version" ? "version" : "package";
    const initialPackageId = queryString(req.query.package_id) || "";
    res.render("admin/prompt-packages/form", {
      title: "パッケージを新規作成",
      action: "/admin/prompt-packages",
      pkg: null,
      existingPackages,
      initialMode,
      initialPackageId,
    });
  },

  async createPromptPackage(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const name = bodyString(req.body.name).trim();
    const description = bodyString(req.body.description).trim() || null;
    const category = bodyString(req.body.category).trim() || null;
    const presetRaw = bodyString(req.body.preset).trim();
    const preset: PromptPresetKey = (presetRaw in PROMPT_PRESETS ? presetRaw : "standard") as PromptPresetKey;

    if (!name) {
      const existingPackages = await promptPackageRepository.list().catch(() => []);
      res.render("admin/prompt-packages/form", {
        title: "パッケージを新規作成",
        action: "/admin/prompt-packages",
        pkg: req.body,
        existingPackages,
        initialMode: "package",
        initialPackageId: "",
        error: "パッケージ名は必須です。",
      });
      return;
    }

    // slug はパッケージ名から自動生成（利用者は slug を意識しない）。
    // 既存 slug と衝突する場合は base-2, base-3, ... と連番を付ける。
    // 採番〜挿入の間に他リクエストが同じ slug を奪うレースに備え、最大2回試行する。
    const baseSlug = generatePackageSlug(name);
    let pkg;
    for (let attempt = 0; attempt < 2 && !pkg; attempt++) {
      try {
        const existingSlugs = await promptPackageRepository.listSlugs();
        const slug = resolveUniquePackageSlug(baseSlug, existingSlugs);
        pkg = await promptPackageRepository.create({ slug, name, description, category });
      } catch {
        if (attempt === 1) {
          logger.error("createPromptPackage: failed", { name });
          const existingPackages = await promptPackageRepository.list().catch(() => []);
          res.render("admin/prompt-packages/form", {
            title: "パッケージを新規作成",
            action: "/admin/prompt-packages",
            pkg: req.body,
            existingPackages,
            initialMode: "package",
            initialPackageId: "",
            error: "識別子の自動生成に失敗しました。もう一度お試しください。",
          });
          return;
        }
      }
    }
    if (!pkg) return;

    // Version 1 を用途プリセットから自動生成（全21キーを実体化＝空Version撲滅）。
    const v1TemplatesJson: AIPromptTemplateMap = buildInitialTemplatesForPreset(preset);
    const presetPolicy = PROMPT_PRESETS[preset]?.policy ?? {};
    const v1PolicyJson: AIPromptPolicy | null = Object.keys(presetPolicy).length > 0 ? presetPolicy : null;
    const v1 = await promptPackageRepository.createVersion({
      package_id: pkg.id,
      policy_json: v1PolicyJson,
      templates_json: v1TemplatesJson,
      change_note: `標準テンプレートから作成（用途: ${PROMPT_PRESETS[preset]?.label ?? preset}）`,
    });

    res.redirect(`/admin/prompt-packages/${pkg.id}/versions/${v1.id}/edit?init=1`);
  },

  async showPromptPackage(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const packageId = routeParam(req, "packageId");
    const [pkg, versions, usingProjects] = await Promise.all([
      promptPackageRepository.getById(packageId),
      promptPackageRepository.listVersions(packageId),
      promptPackageRepository.getProjectsUsingPackage(packageId),
    ]);
    if (!pkg) throw new HttpError(404, "パッケージが見つかりません");

    // Phase 5-B: 各バージョンの検証結果（警告は保存後も画面に表示し続ける）
    const versionValidations: Record<string, PromptPackageValidationResult> = {};
    for (const v of versions) {
      versionValidations[v.id] = validatePromptPackageVersionForPublish(v);
    }

    // Phase C: パッケージ画面から「公開版を適用」できるよう、現在の公開バージョンを渡す
    const publishedVersion = versions.find((v) => v.status === "published") ?? null;

    res.render("admin/prompt-packages/show", {
      title: pkg.name,
      pkg,
      versions,
      usingProjects,
      publishedVersion,
      versionValidations,
      summarizeTemplateDefinitions,
      summarizeTemplateDefinitionsByFamily,
      created: req.query.created === "1",
      saved: req.query.saved === "1",
      versionSaved: req.query.version_saved === "1",
      publishBlocked: req.query.publish_blocked === "1",
      applied: req.query.applied === "1",
      applyError: req.query.apply_error === "1",
    });
  },

  /**
   * Phase C: パッケージ画面から、利用中プロジェクトへ指定バージョン（通常は公開版）を適用する。
   * package 中心導線。draft は適用不可、archived は実行時 published へ fallback。
   */
  async applyPackageToProject(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const packageId = routeParam(req, "packageId");
    const projectId = bodyString(req.body.project_id).trim();
    const versionId = bodyString(req.body.version_id).trim();
    const fail = (reason: string) =>
      res.redirect(`/admin/prompt-packages/${packageId}?apply_error=1&reason=${reason}#using-projects`);

    if (!projectId || !versionId) {
      fail("missing");
      return;
    }
    // 指定バージョンがこのパッケージのものか検証
    const version = await promptPackageRepository.getVersionById(versionId).catch(() => null);
    if (!version || version.package_id !== packageId) {
      fail("invalid_version");
      return;
    }
    // 適用可否（draft はエラー、archived は published fallback の有無で警告）
    const publishedVersion = version.status === "archived"
      ? await promptPackageRepository.getPublishedVersionByPackageId(version.package_id).catch(() => null)
      : null;
    const validation = validatePromptPackageVersionForApply(version, publishedVersion);
    if (validation.errors.length > 0) {
      fail("not_applicable");
      return;
    }

    const existing = await projectRepository.getById(projectId).catch(() => null);
    if (!existing) {
      fail("project_not_found");
      return;
    }

    await projectRepository.update(projectId, {
      ai_prompt_mode: "package",
      ai_prompt_package_version_id: versionId,
    });

    if (existing.ai_prompt_mode !== "package" || existing.ai_prompt_package_version_id !== versionId) {
      await recordPackageChangeLog({
        projectId,
        oldVersionId: existing.ai_prompt_package_version_id ?? null,
        newVersionId: versionId,
        oldMode: existing.ai_prompt_mode ?? null,
        newMode: "package",
        changeReason: bodyString(req.body.change_reason) || "パッケージ画面から適用",
        changedBy: resolveAdminOperator(req),
      });
    }
    res.redirect(`/admin/prompt-packages/${packageId}?applied=1#using-projects`);
  },

  async editPromptPackagePage(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const packageId = routeParam(req, "packageId");
    const pkg = await promptPackageRepository.getById(packageId);
    if (!pkg) throw new HttpError(404, "パッケージが見つかりません");
    res.render("admin/prompt-packages/form", {
      title: `編集: ${pkg.name}`,
      action: `/admin/prompt-packages/${packageId}`,
      pkg,
    });
  },

  async updatePromptPackage(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const packageId = routeParam(req, "packageId");
    const name = bodyString(req.body.name).trim();
    const description = bodyString(req.body.description).trim() || null;
    const category = bodyString(req.body.category).trim() || null;

    if (!name) {
      const pkg = await promptPackageRepository.getById(packageId).catch(() => null);
      res.render("admin/prompt-packages/form", {
        title: `編集: ${pkg?.name ?? packageId}`,
        action: `/admin/prompt-packages/${packageId}`,
        pkg: { ...req.body, id: packageId },
        error: "名前は必須です。",
      });
      return;
    }

    try {
      await promptPackageRepository.update(packageId, { name, description, category });
    } catch {
      logger.error("updatePromptPackage: failed", { packageId });
      const pkg = await promptPackageRepository.getById(packageId).catch(() => null);
      res.status(500).render("admin/prompt-packages/form", {
        title: `編集: ${pkg?.name ?? packageId}`,
        action: `/admin/prompt-packages/${packageId}`,
        pkg: { ...req.body, id: packageId },
        error: "更新に失敗しました。",
      });
      return;
    }
    res.redirect(`/admin/prompt-packages/${packageId}?saved=1`);
  },

  async clonePromptPackage(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const sourceId = routeParam(req, "packageId");
    const newName = bodyString(req.body.new_name).trim();
    // slug は複製後の名前から自動生成する（利用者は slug を意識しない）。
    const baseSlug = generatePackageSlug(newName);

    if (!newName) {
      const pkg = await promptPackageRepository.getById(sourceId).catch(() => null);
      const versions = await promptPackageRepository.listVersions(sourceId).catch(() => []);
      res.render("admin/prompt-packages/show", {
        title: pkg?.name ?? sourceId,
        pkg,
        versions,
        cloneError: "複製後のパッケージ名は必須です。",
      });
      return;
    }

    // 既存 slug と衝突する場合は base-2, base-3, ... と連番を付ける（レースに備え最大2回試行）。
    let newPkg;
    for (let attempt = 0; attempt < 2 && !newPkg; attempt++) {
      try {
        const existingSlugs = await promptPackageRepository.listSlugs();
        const newSlug = resolveUniquePackageSlug(baseSlug, existingSlugs);
        newPkg = await promptPackageRepository.clone(sourceId, newSlug, newName);
      } catch {
        if (attempt === 1) {
          logger.error("clonePromptPackage: failed", { sourceId, baseSlug });
          const pkg = await promptPackageRepository.getById(sourceId).catch(() => null);
          const versions = await promptPackageRepository.listVersions(sourceId).catch(() => []);
          res.render("admin/prompt-packages/show", {
            title: pkg?.name ?? sourceId,
            pkg,
            versions,
            cloneError: "複製に失敗しました。もう一度お試しください。",
          });
          return;
        }
      }
    }
    if (!newPkg) return;
    res.redirect(`/admin/prompt-packages/${newPkg.id}?cloned=1`);
  },

  // ── バージョン操作 ──────────────────────────────────────────────

  /**
   * 旧「新バージョン追加（空エディタ）」ページ。
   * 統合作成画面（Version作成方法を選べる）へ寄せたため、パッケージ選択済みで /new へリダイレクトする。
   * 旧ブックマーク・既存リンクの後方互換のために維持。
   */
  async newPromptPackageVersionPage(req: Request, res: Response): Promise<void> {
    const packageId = routeParam(req, "packageId");
    res.redirect(`/admin/prompt-packages/new?mode=version&package_id=${encodeURIComponent(packageId)}`);
  },

  /**
   * 統合作成画面の「既存パッケージへの Version 追加」送信先。
   * copy_method（公開中をコピー / 最新をコピー / 空）で draft を即生成し、編集エディタへ遷移する。
   */
  async createPromptPackageVersionFromCopy(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const packageId = routeParam(req, "packageId");
    const pkg = await promptPackageRepository.getById(packageId);
    if (!pkg) throw new HttpError(404, "パッケージが見つかりません");

    const copyMethod = bodyString(req.body.copy_method).trim() || "copy_published";
    const versions = await promptPackageRepository.listVersions(packageId).catch(() => []);
    const source = resolveVersionCopySource(versions, copyMethod);

    let changeNote = "空のバージョンを作成";
    if (source && copyMethod === "copy_published") {
      changeNote = `公開中バージョン（v${source.version_no}）をコピーして作成`;
    } else if (source && copyMethod === "copy_latest") {
      changeNote = `最新バージョン（v${source.version_no}）をコピーして作成`;
    } else if (copyMethod !== "empty") {
      changeNote = "新バージョンを作成";
    }

    const created = await promptPackageRepository.createVersion({
      package_id: packageId,
      policy_json: source?.policy_json ?? null,
      templates_json: source?.templates_json ?? null,
      builder_spec_json: source?.builder_spec_json ?? null,
      change_note: changeNote,
    });

    res.redirect(`/admin/prompt-packages/${packageId}/versions/${created.id}/edit?init=1`);
  },

  async createPromptPackageVersion(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const packageId = routeParam(req, "packageId");
    const pkg = await promptPackageRepository.getById(packageId);
    if (!pkg) throw new HttpError(404, "パッケージが見つかりません");

    const policyJson = parseAIPromptPolicyFromRequest(req);
    const templatesJson = parseAIPromptTemplatesFromRequest(req);
    const builderSpec = parseBuilderSpecFromRequest(req);
    const changeNote = bodyString(req.body.change_note).trim() || null;

    // Phase 5-B: 保存前バリデーション（エラーは保存不可・警告は保存可能）
    const validation = validatePromptPackageVersionConfig({
      rawPolicyJson: bodyString(req.body.ai_prompt_policy_json),
      rawTemplatesJson: bodyString(req.body.ai_prompt_templates_json),
    });
    if (validation.errors.length > 0) {
      res.status(400).render("admin/prompt-packages/version-form", {
        title: `新バージョン追加: ${pkg.name}`,
        pkg,
        version: { policy_json: policyJson, templates_json: templatesJson, builder_spec_json: builderSpec, change_note: changeNote },
        action: `/admin/prompt-packages/${packageId}/versions`,
        promptKeyDefs: buildPromptKeyDefs(),
        builderFields: PROMPT_BUILDER_FIELDS,
        validationErrors: validation.errors,
        validationWarnings: validation.warnings,
        error: "バリデーションエラーがあるため保存できません。",
      });
      return;
    }

    try {
      await promptPackageRepository.createVersion({
        package_id: packageId,
        policy_json: policyJson,
        templates_json: templatesJson,
        builder_spec_json: builderSpec,
        change_note: changeNote,
      });
    } catch {
      logger.error("createPromptPackageVersion: failed", { packageId });
      res.render("admin/prompt-packages/version-form", {
        title: `新バージョン追加: ${pkg.name}`,
        pkg,
        version: null,
        action: `/admin/prompt-packages/${packageId}/versions`,
        promptKeyDefs: buildPromptKeyDefs(),
        builderFields: PROMPT_BUILDER_FIELDS,
        error: "バージョンの作成に失敗しました。",
      });
      return;
    }
    res.redirect(`/admin/prompt-packages/${packageId}?version_saved=1`);
  },

  async editPromptPackageVersionPage(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const packageId = routeParam(req, "packageId");
    const versionId = routeParam(req, "versionId");
    const [pkg, version] = await Promise.all([
      promptPackageRepository.getById(packageId),
      promptPackageRepository.getVersionById(versionId),
    ]);
    if (!pkg) throw new HttpError(404, "パッケージが見つかりません");
    if (!version) throw new HttpError(404, "バージョンが見つかりません");
    if (version.status !== "draft") throw new HttpError(400, "公開済み・アーカイブ済みバージョンは編集できません");

    res.render("admin/prompt-packages/version-form", {
      title: `バージョン編集: ${pkg.name} v${version.version_no}`,
      pkg,
      version,
      action: `/admin/prompt-packages/${packageId}/versions/${versionId}`,
      promptKeyDefs: buildPromptKeyDefs(),
      builderFields: PROMPT_BUILDER_FIELDS,
      isInit: req.query.init === "1",
    });
  },

  async updatePromptPackageVersion(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const packageId = routeParam(req, "packageId");
    const versionId = routeParam(req, "versionId");

    const policyJson = parseAIPromptPolicyFromRequest(req);
    const templatesJson = parseAIPromptTemplatesFromRequest(req);
    const builderSpec = parseBuilderSpecFromRequest(req);
    const changeNote = bodyString(req.body.change_note).trim() || null;

    // Phase 5-B: 保存前バリデーション（エラーは保存不可・警告は保存可能）
    const validation = validatePromptPackageVersionConfig({
      rawPolicyJson: bodyString(req.body.ai_prompt_policy_json),
      rawTemplatesJson: bodyString(req.body.ai_prompt_templates_json),
    });
    if (validation.errors.length > 0) {
      const [pkg, version] = await Promise.all([
        promptPackageRepository.getById(packageId).catch(() => null),
        promptPackageRepository.getVersionById(versionId).catch(() => null),
      ]);
      res.status(400).render("admin/prompt-packages/version-form", {
        title: `バージョン編集`,
        pkg,
        version: version
          ? { ...version, policy_json: policyJson, templates_json: templatesJson, builder_spec_json: builderSpec, change_note: changeNote }
          : version,
        action: `/admin/prompt-packages/${packageId}/versions/${versionId}`,
        promptKeyDefs: buildPromptKeyDefs(),
        builderFields: PROMPT_BUILDER_FIELDS,
        validationErrors: validation.errors,
        validationWarnings: validation.warnings,
        error: "バリデーションエラーがあるため保存できません。",
      });
      return;
    }

    try {
      await promptPackageRepository.updateVersion(versionId, {
        policy_json: policyJson,
        templates_json: templatesJson,
        builder_spec_json: builderSpec,
        change_note: changeNote,
      });
    } catch {
      logger.error("updatePromptPackageVersion: failed", { versionId });
      const [pkg, version] = await Promise.all([
        promptPackageRepository.getById(packageId).catch(() => null),
        promptPackageRepository.getVersionById(versionId).catch(() => null),
      ]);
      res.status(500).render("admin/prompt-packages/version-form", {
        title: `バージョン編集`,
        pkg,
        version,
        action: `/admin/prompt-packages/${packageId}/versions/${versionId}`,
        promptKeyDefs: buildPromptKeyDefs(),
        builderFields: PROMPT_BUILDER_FIELDS,
        error: "更新に失敗しました。",
      });
      return;
    }
    res.redirect(`/admin/prompt-packages/${packageId}?version_saved=1`);
  },

  /** Phase 5-D: 公開バージョン切り替え前の影響確認画面 */
  async publishConfirmPromptPackageVersion(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const packageId = routeParam(req, "packageId");
    const versionId = routeParam(req, "versionId");
    const [pkg, version, usingProjects] = await Promise.all([
      promptPackageRepository.getById(packageId),
      promptPackageRepository.getVersionById(versionId),
      promptPackageRepository.getProjectsUsingPackage(packageId),
    ]);
    if (!pkg) throw new HttpError(404, "パッケージが見つかりません");
    if (!version) throw new HttpError(404, "バージョンが見つかりません");
    if (version.status !== "draft") throw new HttpError(400, "draft バージョンのみ公開できます");

    // 現在の公開バージョン（公開すると archived になり、利用中プロジェクトは新バージョンへ fallback する）
    const currentPublished = await promptPackageRepository.getPublishedVersionByPackageId(packageId).catch(() => null);
    const versions = await promptPackageRepository.listVersions(packageId);
    const versionById = new Map(versions.map((v) => [v.id, v]));

    // 影響プロジェクト: このパッケージのいずれかのバージョンを使用中の全プロジェクト
    const affectedProjects = usingProjects.map((p) => {
      const used = p.ai_prompt_package_version_id ? versionById.get(p.ai_prompt_package_version_id) ?? null : null;
      return {
        project: p,
        usedVersionNo: used?.version_no ?? null,
        usedStatus: used?.status ?? null,
        // 公開後: 選択中バージョンが published のままでなくなるプロジェクトは新バージョンへ fallback
        willFallback: !!used && used.id !== versionId,
      };
    });

    const validation = validatePromptPackageVersionForPublish(version);

    res.render("admin/prompt-packages/publish-confirm", {
      title: `公開確認: ${pkg.name} v${version.version_no}`,
      pkg,
      version,
      currentPublished,
      affectedProjects,
      validationErrors: validation.errors,
      validationWarnings: validation.warnings,
    });
  },

  async publishPromptPackageVersion(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const packageId = routeParam(req, "packageId");
    const versionId = routeParam(req, "versionId");

    // Phase 5-B: 公開前バリデーション。エラーがある場合は公開不可
    const version = await promptPackageRepository.getVersionById(versionId).catch(() => null);
    if (!version) {
      res.redirect(`/admin/prompt-packages/${packageId}?publish_blocked=1`);
      return;
    }
    const validation = validatePromptPackageVersionForPublish(version);
    if (validation.errors.length > 0) {
      logger.warn("publishPromptPackageVersion: blocked by validation", { versionId, errors: validation.errors });
      res.redirect(`/admin/prompt-packages/${packageId}?publish_blocked=1`);
      return;
    }

    try {
      await promptPackageRepository.publishVersion(versionId);
    } catch {
      logger.error("publishPromptPackageVersion: failed", { versionId });
    }
    res.redirect(`/admin/prompt-packages/${packageId}`);
  },

  async archiveConfirmPromptPackageVersion(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const packageId = routeParam(req, "packageId");
    const versionId = routeParam(req, "versionId");
    const [pkg, version, usingProjects] = await Promise.all([
      promptPackageRepository.getById(packageId),
      promptPackageRepository.getVersionById(versionId),
      promptPackageRepository.getProjectsUsingVersion(versionId),
    ]);
    if (!pkg) throw new HttpError(404, "パッケージが見つかりません");
    if (!version) throw new HttpError(404, "バージョンが見つかりません");

    // fallback 先が存在するか確認
    const fallbackVersion = await promptPackageRepository.getPublishedVersionByPackageId(packageId)
      .then((v) => (v && v.id !== versionId ? v : null))
      .catch(() => null);

    res.render("admin/prompt-packages/archive-confirm", {
      title: `アーカイブ確認: ${pkg.name} v${version.version_no}`,
      pkg,
      version,
      usingProjects,
      fallbackVersion,
    });
  },

  async archivePromptPackageVersion(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const packageId = routeParam(req, "packageId");
    const versionId = routeParam(req, "versionId");
    try {
      await promptPackageRepository.archiveVersion(versionId);
    } catch {
      logger.error("archivePromptPackageVersion: failed", { versionId });
    }
    res.redirect(`/admin/prompt-packages/${packageId}`);
  },

  /** Phase 6-E: 同一パッケージ内のバージョン差分比較画面 */
  async comparePromptPackageVersionsPage(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const { buildVersionDiff } = await import("../services/promptPackageDiffService");
    const packageId = routeParam(req, "packageId");
    const [pkg, versions] = await Promise.all([
      promptPackageRepository.getById(packageId),
      promptPackageRepository.listVersions(packageId),
    ]);
    if (!pkg) throw new HttpError(404, "パッケージが見つかりません");

    // デフォルト: to = 公開中（なければ最新）, from = その1つ前のバージョン
    const queryFrom = typeof req.query.from === "string" ? req.query.from : "";
    const queryTo = typeof req.query.to === "string" ? req.query.to : "";
    const defaultTo = versions.find((v) => v.status === "published") ?? versions[0] ?? null;
    const toVersion = versions.find((v) => v.id === queryTo) ?? defaultTo;
    const defaultFrom = toVersion
      ? versions.find((v) => v.version_no < toVersion.version_no) ?? null
      : null;
    const fromVersion = versions.find((v) => v.id === queryFrom) ?? defaultFrom;

    const diff = fromVersion && toVersion && fromVersion.id !== toVersion.id
      ? buildVersionDiff(fromVersion, toVersion)
      : null;

    res.render("admin/prompt-packages/compare", {
      title: `バージョン比較: ${pkg.name}`,
      pkg,
      versions,
      fromVersion: fromVersion ?? null,
      toVersion: toVersion ?? null,
      diff,
      placement: PROMPT_KEY_PLACEMENT,
      familyLabels: PROMPT_FAMILY_LABEL,
    });
  },

  /** Phase 5-A: パッケージバージョンの適用プレビュー（JSON API。プロジェクト編集画面から fetch される） */
  async promptPackageVersionPreview(req: Request, res: Response): Promise<void> {
    const versionId = routeParam(req, "versionId");
    try {
      const preview = await buildPackageVersionPreview(versionId);
      if (!preview) {
        res.status(404).json({ error: "バージョンが見つかりません" });
        return;
      }
      res.json(preview);
    } catch (error) {
      logger.error("promptPackageVersionPreview: failed", {
        versionId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ error: "プレビューの取得に失敗しました" });
    }
  },

  /**
   * Phase D: パッケージバージョン単位のプロンプトプレビュー（JSON API）。
   * プロジェクトを経由せず version の templates_json / policy_json（または未保存の override）でレンダリングする。
   */
  async promptPackageVersionPromptPreview(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const versionId = routeParam(req, "versionId");
    const promptKey = bodyString(req.body.prompt_key) as BasePromptKey;
    if (!BASE_PROMPT_TEMPLATES[promptKey]) {
      res.status(400).json({ error: `不正なpromptKey: ${promptKey}` });
      return;
    }
    const version = await promptPackageRepository.getVersionById(versionId);
    if (!version) {
      res.status(404).json({ error: "バージョンが見つかりません" });
      return;
    }
    const policyOverride = parseOptionalJsonObject(bodyString(req.body.policy_override));
    const result = renderPromptForPackageConfig({
      promptKey,
      templates: version.templates_json,
      policy: (policyOverride as AIPromptPolicy | null) ?? version.policy_json,
      templateOverride: bodyString(req.body.template_override),
    });
    res.json({
      promptKey,
      label: BASE_PROMPT_TEMPLATES[promptKey].label,
      templateMode: result.isCustom ? "package_template" : "base_template",
      template: result.template,
      rendered: result.rendered,
      policy: result.policy,
      allowedPlaceholders: BASE_PROMPT_TEMPLATES[promptKey].allowedPlaceholders.map(ph => ({
        key: ph,
        description: describePlaceholder(ph),
      })),
    });
  },

  /**
   * Phase D: パッケージバージョン単位のテスト実行（JSON API）。
   * call_ai=1 で実 AI 呼び出し。プロジェクト非依存。
   */
  async promptPackageVersionPromptTest(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const versionId = routeParam(req, "versionId");
    const promptKey = bodyString(req.body.prompt_key) as BasePromptKey;
    if (!BASE_PROMPT_TEMPLATES[promptKey]) {
      res.status(400).json({ error: `不正なpromptKey: ${promptKey}` });
      return;
    }
    const version = await promptPackageRepository.getVersionById(versionId);
    if (!version) {
      res.status(404).json({ error: "バージョンが見つかりません" });
      return;
    }

    const sampleValues: Record<string, string> = {};
    const parsedSamples = parseOptionalJsonObject(bodyString(req.body.sample_values));
    if (parsedSamples) {
      for (const [k, v] of Object.entries(parsedSamples)) {
        if (typeof v === "string") sampleValues[k] = v;
      }
    }
    const policyOverride = parseOptionalJsonObject(bodyString(req.body.policy_override));

    const result = renderPromptForPackageConfig({
      promptKey,
      templates: version.templates_json,
      policy: (policyOverride as AIPromptPolicy | null) ?? version.policy_json,
      templateOverride: bodyString(req.body.template_override),
      sampleValues,
    });

    const callAI = req.body.call_ai === "1" || req.body.call_ai === "true";
    let aiResponse: string | null = null;
    let aiError: string | null = null;
    let tokenUsage: Record<string, unknown> | null = null;
    if (callAI) {
      try {
        const { aiService } = await import("../services/aiService");
        const ai = await aiService.callRaw({ prompt: result.rendered });
        aiResponse = ai.content ?? null;
        tokenUsage = ai.tokenUsage ?? null;
      } catch (err) {
        aiError = err instanceof Error ? err.message : String(err);
      }
    }

    res.json({
      promptKey,
      label: BASE_PROMPT_TEMPLATES[promptKey].label,
      templateMode: result.isCustom ? "package_template" : "base_template",
      template: result.template,
      rendered: result.rendered,
      policy: result.policy,
      aiResponse,
      aiError,
      tokenUsage,
    });
  },

  /**
   * Phase F: プロンプトビルダー方針から会話系テンプレート本文をAI生成する（JSON API）。
   * - 生成対象は BUILDER_GENERATION_KEYS（会話系10キー）のみ。
   * - DBには書き込まない（ステートレス）。返却した本文を画面側で詳細モードの textarea に
   *   読み込み、運用者が確認してから通常の保存で確定する。
   * - 実行時には一切呼ばれない（管理画面のボタン押下時のみ）。
   */
  async generatePromptPackageVersionTemplates(req: Request, res: Response): Promise<void> {
    const spec = normalizePromptBuilderSpec(parseOptionalJsonObject(bodyString(req.body.builder_spec_json)) ?? {});
    if (Object.keys(spec).length === 0) {
      res.status(400).json({ error: "方針が入力されていません。基本モードで方針を入力してください。" });
      return;
    }

    const prompt = buildGenerationMetaPrompt(spec, BUILDER_GENERATION_KEYS);

    let aiContent: string | null = null;
    try {
      const { aiService } = await import("../services/aiService");
      const ai = await aiService.callRaw({ prompt });
      aiContent = ai.content ?? null;
    } catch (err) {
      res.status(502).json({ error: `AI生成に失敗しました: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    const parsed = parseGenerationResult(aiContent, BUILDER_GENERATION_KEYS);
    res.json({
      templates: parsed.templates,
      generatedKeys: parsed.generatedKeys,
      warnings: parsed.warnings,
      targetKeys: BUILDER_GENERATION_KEYS,
    });
  },

  /**
   * Phase I (A part2): 深掘りプレイグラウンド（JSON API・ステートレス）。
   * 設問＋回答を、選択中バージョンの本文＋コード側 buildProbeTypeGuidance＋policy を含む
   * 実パイプラインのプロンプトで実行し、そのバージョンが出す深掘り文を返す。
   * - DB には書き込まない。ai_logs にも残さない（テスト用途）。
   * - template_overrides（未保存の編集中本文）を渡すと該当キーを差し替えて評価する。
   */
  async promptPackageVersionProbePlayground(req: Request, res: Response): Promise<void> {
    const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
    const {
      buildProbePlaygroundPrompt,
      parseProbePlaygroundResult,
      PROBE_PLAYGROUND_KEY,
    } = await import("../services/probePlaygroundService");

    const versionId = routeParam(req, "versionId");
    const version = await promptPackageRepository.getVersionById(versionId);
    if (!version) {
      res.status(404).json({ error: "バージョンが見つかりません" });
      return;
    }

    const rawMode = bodyString(req.body.mode);
    const mode: ProbePlaygroundMode =
      rawMode === "interview" || rawMode === "probe" ? rawMode : "analyze";
    const questionText = bodyString(req.body.question_text).trim();
    const answer = bodyString(req.body.answer).trim();
    if (!questionText || !answer) {
      res.status(400).json({ error: "設問文と回答を入力してください。" });
      return;
    }

    const questionType = bodyString(req.body.question_type).trim() || undefined;
    const projectGoal = bodyString(req.body.project_goal).trim() || undefined;
    const parsedMax = Number.parseInt(bodyString(req.body.max_probes), 10);
    const maxProbes = Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : 1;

    // 選択肢（[{value,label}]）
    let options: { value: string; label: string }[] | undefined;
    const optionsRaw = bodyString(req.body.options_json).trim();
    if (optionsRaw) {
      try {
        const arr = JSON.parse(optionsRaw);
        if (Array.isArray(arr)) {
          options = arr
            .filter((o) => o && typeof o === "object")
            .map((o) => ({ value: String(o.value ?? ""), label: String(o.label ?? o.value ?? "") }))
            .filter((o) => o.value || o.label);
        }
      } catch {
        // 不正な選択肢JSONは無視（選択肢なしで実行）
      }
    }

    // 未保存の編集中本文を反映（template_overrides: {key: body}）
    let templates = version.templates_json;
    const overrides = parseOptionalJsonObject(bodyString(req.body.template_overrides));
    if (overrides) {
      const merged: AIPromptTemplateMap = { ...(version.templates_json ?? {}) };
      for (const [k, v] of Object.entries(overrides)) {
        if (typeof v === "string" && v.trim() && BASE_PROMPT_TEMPLATES[k as BasePromptKey]) {
          merged[k as BasePromptKey] = { enabled: true, template: v };
        }
      }
      templates = merged;
    }

    const prompt = buildProbePlaygroundPrompt({
      mode,
      templates,
      policy: version.policy_json,
      questionText,
      answer,
      questionType: questionType as never,
      options,
      projectGoal,
      maxProbes,
    });

    let raw: string | null = null;
    let aiError: string | null = null;
    let tokenUsage: Record<string, unknown> | null = null;
    try {
      const { aiService } = await import("../services/aiService");
      const ai = await aiService.callRaw({ prompt });
      raw = ai.content ?? null;
      tokenUsage = ai.tokenUsage ?? null;
    } catch (err) {
      aiError = err instanceof Error ? err.message : String(err);
    }

    const parsed = parseProbePlaygroundResult(mode, raw);
    res.json({
      mode,
      promptKey: PROBE_PLAYGROUND_KEY[mode],
      prompt,
      raw,
      probe: parsed.probe,
      action: parsed.action,
      reason: parsed.reason,
      parsedJson: parsed.parsedJson,
      aiError,
      tokenUsage,
    });
  },

  /**
   * 改修案1+2: 振る舞い方針から会話系テンプレートをAI生成し、影響範囲・生成本文・
   * 現在値との行差分を返す（確認パネル用 JSON API）。DBには書き込まない（ステートレス）。
   * 画面側は「振る舞いを確認」で本APIを呼び、プレビュー/差分を確認してから
   * 「この内容を反映」で詳細モードの textarea に流し込み、通常保存で確定する。
   */
  async previewPromptPackageBehavior(req: Request, res: Response): Promise<void> {
    const spec = normalizePromptBuilderSpec(parseOptionalJsonObject(bodyString(req.body.builder_spec_json)) ?? {});
    if (Object.keys(spec).length === 0) {
      res.status(400).json({ error: "方針が入力されていません。振る舞い方針または詳細な方針を入力してください。" });
      return;
    }

    // フォームの現在の各キー本文（差分の before 基準）。未指定キーは BASE 本文を基準にする。
    const currentTemplates: Record<string, string> = {};
    const parsedCurrent = parseOptionalJsonObject(bodyString(req.body.current_templates_json));
    if (parsedCurrent) {
      for (const [k, v] of Object.entries(parsedCurrent)) {
        if (typeof v === "string") currentTemplates[k] = v;
      }
    }

    const prompt = buildGenerationMetaPrompt(spec, BUILDER_GENERATION_KEYS);
    let aiContent: string | null = null;
    try {
      const { aiService } = await import("../services/aiService");
      const ai = await aiService.callRaw({ prompt });
      aiContent = ai.content ?? null;
    } catch (err) {
      res.status(502).json({ error: `AI生成に失敗しました: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }

    const parsed = parseGenerationResult(aiContent, BUILDER_GENERATION_KEYS);

    // 採用された生成キーごとに「現在値（before）→ 生成本文（after）」の行差分を計算
    const affected = parsed.generatedKeys.map((key) => {
      const generated = parsed.templates[key] ?? "";
      const currentBody = currentTemplates[key];
      const before = currentBody && currentBody.trim() ? currentBody : BASE_PROMPT_TEMPLATES[key].template;
      return {
        key,
        label: BASE_PROMPT_TEMPLATES[key].label,
        generated,
        diffRows: diffLines(before.trim(), generated.trim()),
      };
    });

    // 影響しない（生成対象外＝usedPolicies 空）キー一覧
    const notAffected = (Object.keys(BASE_PROMPT_TEMPLATES) as BasePromptKey[])
      .filter((key) => !BUILDER_GENERATION_KEYS.includes(key))
      .map((key) => ({ key, label: BASE_PROMPT_TEMPLATES[key].label }));

    res.json({
      affected,
      notAffected,
      generatedKeys: parsed.generatedKeys,
      warnings: parsed.warnings,
    });
  },

  // ============================================================
  // 店舗専用アンケート管理（visibility_type='private_store'）
  // 専用URL/QR で配布し、一般の「探す」一覧には出さない単発アンケート。
  // ============================================================

  async storeSurveys(req: Request, res: Response): Promise<void> {
    const [storeProjects, allProjects] = await Promise.all([
      projectRepository.listStoreProjects(),
      projectRepository.list()
    ]);

    // clients テーブルの GRANT 未適用（migration 065 未実行）でも画面は遷移できるようにする。
    // 失敗時は店舗マスタ機能だけ無効化し、適用案内を表示する。
    let clients: Awaited<ReturnType<typeof clientRepository.list>> = [];
    let clientsError = false;
    try {
      clients = await clientRepository.list();
    } catch (error) {
      clientsError = true;
      logger.warn("store-surveys: clients テーブル読み込み失敗（migration 065 未適用の可能性）", {
        error: String(error)
      });
    }

    const clientNameById = new Map(clients.map((c) => [c.id, c.name]));

    const rows = await Promise.all(
      storeProjects.map(async (p) => ({
        project: p,
        clientName: p.client_id ? clientNameById.get(p.client_id) ?? null : null,
        entryUrl: buildStoreEntryUrl(p.entry_code),
        // 「回答数」は完了数（URLを開いただけの流入は含めない）
        responseCount: await projectAssignmentRepository.countCompletedByProject(p.id)
      }))
    );

    // 「店舗専用にする」候補（まだ店舗専用化されていない案件）
    const convertibleProjects = allProjects.filter((p) => p.visibility_type !== "private_store");

    res.render("admin/store-surveys/index", {
      title: "店舗専用アンケート管理",
      rows,
      clients,
      clientsError,
      convertibleProjects,
      msg: typeof req.query.msg === "string" ? req.query.msg : null,
      err: typeof req.query.err === "string" ? req.query.err : null
    });
  },

  // ---- 企業ごとまとめ画面（複数アンケートを client 単位で合算・納品物リンク） ----

  async clientOverview(req: Request, res: Response): Promise<void> {
    const clientId = routeParam(req, "clientId");
    const client = await clientRepository.getById(clientId);

    // client 配下の案件を created_at 昇順で（将来の wave 列を差し込める自然順・★予約③）
    const projects = await projectRepository.listByClient(clientId);

    // 各案件の件数系(A)＋設問（横断指標の可視化用）を並行取得
    const rows = await Promise.all(
      projects.map(async (project) => {
        const [respondentCount, completedCount, questions] = await Promise.all([
          respondentRepository.countByProject(project.id),
          projectAssignmentRepository.countCompletedByProject(project.id),
          questionRepository.listByProject(project.id, { includeHidden: false })
        ]);
        return { project, respondentCount, completedCount, questions };
      })
    );

    // 件数系の単純合算(A)
    const totals = rows.reduce(
      (acc, r) => ({
        respondents: acc.respondents + r.respondentCount,
        completed: acc.completed + r.completedCount
      }),
      { respondents: 0, completed: 0 }
    );

    // 横断集計できる指標の可視化（実合算(B)は将来Slice）
    const metrics = collectClientMetrics(
      rows.map((r) => ({ project_id: r.project.id, questions: r.questions }))
    );

    res.render("admin/clients/overview", {
      title: `企業まとめ - ${client.name}`,
      // NOTE: EJS(renderFile/__express) は data 内の `client` キーを compile オプション
      // （client-mode）として解釈し include ヘルパーを外してしまう。キー名は clientInfo にする。
      clientInfo: client,
      rows: rows.map((r) => ({
        project: r.project,
        respondentCount: r.respondentCount,
        completedCount: r.completedCount
      })),
      totals,
      projectCount: projects.length,
      metrics,
      backUrl: "/admin/store-surveys"
    });
  },

  // ---- 配布用フライヤー（印刷 / PDF 化向けの単独ページ） ----

  async storeSurveyFlyer(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const project = await projectRepository.getById(projectId);

    let clientName: string | null = null;
    if (project.client_id) {
      try {
        const client = await clientRepository.getById(project.client_id);
        clientName = client?.name ?? null;
      } catch {
        // clients テーブル未 GRANT（migration 065 未適用）でもフライヤーは表示する
      }
    }

    const surveyTitle = project.user_display_title || project.name;
    res.render("admin/store-surveys/flyer", {
      title: `配布用QR - ${clientName || surveyTitle}`,
      storeName: clientName,
      surveyTitle,
      entryUrl: buildStoreEntryUrl(project.entry_code),
      entryCode: project.entry_code ?? null,
      isPublished: project.status === "published",
      backUrl: "/admin/store-surveys"
    });
  },

  // ---- 店舗マスタ（clients）CRUD ----

  async createClient(req: Request, res: Response): Promise<void> {
    const name = bodyString(req.body.name).trim();
    if (!name) {
      res.redirect("/admin/store-surveys?err=" + encodeURIComponent("店舗名を入力してください"));
      return;
    }
    await clientRepository.create({ name, contact: bodyString(req.body.contact).trim() || null });
    res.redirect("/admin/store-surveys?msg=" + encodeURIComponent("店舗を追加しました"));
  },

  async updateClient(req: Request, res: Response): Promise<void> {
    const clientId = routeParam(req, "clientId");
    const name = bodyString(req.body.name).trim();
    if (!name) {
      res.redirect("/admin/store-surveys?err=" + encodeURIComponent("店舗名を入力してください"));
      return;
    }
    await clientRepository.update(clientId, {
      name,
      contact: bodyString(req.body.contact).trim() || null
    });
    res.redirect("/admin/store-surveys?msg=" + encodeURIComponent("店舗を更新しました"));
  },

  async deleteClient(req: Request, res: Response): Promise<void> {
    const clientId = routeParam(req, "clientId");
    await clientRepository.delete(clientId);
    res.redirect("/admin/store-surveys?msg=" + encodeURIComponent("店舗を削除しました"));
  },

  // ---- 既存案件を店舗専用にする ----

  async markProjectAsStore(req: Request, res: Response): Promise<void> {
    const projectId = bodyString(req.body.project_id).trim();
    if (!projectId) {
      res.redirect("/admin/store-surveys?err=" + encodeURIComponent("案件を選択してください"));
      return;
    }
    // 店舗コードは登録時に自動付与する（一意なランダムコード）。編集フォームで後から変更可。
    // 既に entry_code を持つ案件（再設定など）は上書きしない。
    const clientId = bodyString(req.body.client_id).trim() || null;
    const current = await projectRepository.getById(projectId);
    const entryCode = current.entry_code?.trim() || (await generateUniqueEntryCode());
    await projectRepository.update(projectId, {
      visibility_type: "private_store",
      client_id: clientId,
      entry_code: entryCode
    });
    res.redirect(
      "/admin/store-surveys?msg=" +
        encodeURIComponent(`店舗専用アンケートに設定しました（店舗コード: ${entryCode}）。コードは編集から変更できます`)
    );
  },

  // ---- 店舗専用アンケートの編集（コード/店舗/公開状態の変更・通常案件へ戻す） ----

  async updateStoreSurvey(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");

    // 通常案件へ戻す
    if (bodyString(req.body.action) === "revert") {
      await projectRepository.update(projectId, {
        visibility_type: "public",
        entry_code: null
      });
      res.redirect("/admin/store-surveys?msg=" + encodeURIComponent("通常案件に戻しました"));
      return;
    }

    const validation = await validateEntryCode(bodyString(req.body.entry_code), projectId);
    if (!validation.ok) {
      res.redirect("/admin/store-surveys?err=" + encodeURIComponent(validation.error));
      return;
    }

    const statusInput = bodyString(req.body.status).trim();
    const allowedStatuses = ["draft", "published", "paused", "closed"];
    const clientId = bodyString(req.body.client_id).trim() || null;

    await projectRepository.update(projectId, {
      entry_code: validation.code,
      client_id: clientId,
      ...(allowedStatuses.includes(statusInput)
        ? { status: statusInput as import("../types/domain").ProjectStatus }
        : {})
    });
    res.redirect("/admin/store-surveys?msg=" + encodeURIComponent("店舗専用アンケートを更新しました"));
  },

  // ---- 応募管理（案件検索サイト・project_applications） ----

  /** 応募一覧。?project_id= で案件フィルタ。 */
  async applications(req: Request, res: Response): Promise<void> {
    const projectIdFilter = typeof req.query.project_id === "string" ? req.query.project_id.trim() : "";
    const allProjects = await projectRepository.list();
    const projectById = new Map(allProjects.map((p) => [p.id, p]));

    let applications;
    if (projectIdFilter) {
      applications = await projectApplicationRepository.listByProject(projectIdFilter);
    } else {
      // 全件: 応募のある案件を新しい順に。件数規模が小さい前提の素朴な実装。
      const lists = await Promise.all(
        allProjects
          .filter((p) => p.visibility_type !== "private_store")
          .map((p) => projectApplicationRepository.listByProject(p.id))
      );
      applications = lists.flat().sort((a, b) => (a.applied_at < b.applied_at ? 1 : -1));
    }

    const rows = applications.map((a) => ({
      application: a,
      project: projectById.get(a.project_id) ?? null,
    }));

    res.render("admin/applications/index", {
      title: "応募管理",
      rows,
      projects: allProjects.filter((p) => p.visibility_type !== "private_store"),
      projectIdFilter: projectIdFilter || null,
      msg: typeof req.query.msg === "string" ? req.query.msg : null,
      err: typeof req.query.err === "string" ? req.query.err : null
    });
  },

  /** 当選: respondent/assignment を確保し、当選Flexを送る。 */
  async acceptApplication(req: Request, res: Response): Promise<void> {
    const applicationId = routeParam(req, "id");
    const backProject = typeof req.body?.back === "string" ? req.body.back : "";
    const back = `/admin/applications${backProject ? `?project_id=${encodeURIComponent(backProject)}&` : "?"}`;

    const result = await applicationService.accept(applicationId);
    if (!result.ok) {
      res.redirect(`${back}err=` + encodeURIComponent(
        result.reason === "not_found" ? "応募が見つかりません" : "選考中の応募のみ当選にできます"
      ));
      return;
    }

    // 当選通知（失敗しても当選自体は成立させ、エラーはメッセージで知らせる）
    let notified = true;
    try {
      const startUrl = buildProjectStartUrl(result.assignmentId);
      await lineMessagingService.push(result.application.line_user_id, [
        buildApplicationAcceptedFlex({
          projectTitle: result.project.user_display_title || result.project.name,
          rewardPoints: result.project.reward_points,
          estimatedMinutes: (result.project as unknown as { estimated_minutes?: number | null }).estimated_minutes ?? null,
          surveyUrl: startUrl.url,
        }),
      ]);
    } catch (error) {
      notified = false;
      logger.warn("applications.accept: 当選通知の送信に失敗", { applicationId, error: String(error) });
    }

    res.redirect(`${back}msg=` + encodeURIComponent(
      notified ? "当選にしました（LINE通知済み）" : "当選にしました（LINE通知は失敗。手動で連絡してください）"
    ));
  },

  /** 落選: rejected にし、チェック時のみ落選Flexを送る。 */
  async rejectApplication(req: Request, res: Response): Promise<void> {
    const applicationId = routeParam(req, "id");
    const backProject = typeof req.body?.back === "string" ? req.body.back : "";
    const back = `/admin/applications${backProject ? `?project_id=${encodeURIComponent(backProject)}&` : "?"}`;
    const notify = req.body?.notify === "1";
    const note = bodyString(req.body?.note).trim() || null;

    const result = await applicationService.reject(applicationId, note);
    if (!result.ok) {
      res.redirect(`${back}err=` + encodeURIComponent(
        result.reason === "not_found" ? "応募が見つかりません" : "選考中の応募のみ落選にできます"
      ));
      return;
    }

    let suffix = "";
    if (notify) {
      try {
        const project = await projectRepository.getById(result.application.project_id);
        await lineMessagingService.push(result.application.line_user_id, [
          buildApplicationRejectedFlex({
            projectTitle: project.user_display_title || project.name,
            projectsUrl: `${appEnv.APP_BASE_URL}/liff/projects`,
          }),
        ]);
        suffix = "（LINE通知済み）";
      } catch (error) {
        suffix = "（LINE通知は失敗）";
        logger.warn("applications.reject: 落選通知の送信に失敗", { applicationId, error: String(error) });
      }
    }
    res.redirect(`${back}msg=` + encodeURIComponent(`落選にしました${suffix}`));
  }
};

/**
 * 一意な店舗コード（entry_code）を自動生成する。
 * - URL/QR で扱いやすい英数小文字（紛らわしい 0/o/1/l/i を除外）。
 * - `st-` プレフィックス + 6 文字。DB の部分 unique index と衝突しないよう事前確認し再試行。
 */
async function generateUniqueEntryCode(): Promise<string> {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const makeCode = (): string => {
    let s = "";
    for (let i = 0; i < 6; i++) {
      s += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return `st-${s}`;
  };
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = makeCode();
    const existing = await projectRepository.findAnyByEntryCode(code);
    if (!existing) return code;
  }
  // 極めて稀な衝突連続時のフォールバック（タイムスタンプで一意性を担保）
  return `st-${Date.now().toString(36)}`;
}

/**
 * 店舗流入用の専用URL。entry_code 未設定時は null。
 * LIFF 恒久URL（liff.line.me）を優先する。サイト直URLだと LINE の QR リーダーから
 * 開いたとき LIFF ブラウザではなく in-app ブラウザで開き、Web ログイン
 * （LINE⇄サイトのリダイレクト往復）が必須になってループ事故の温床になるため。
 * liff.line.me 経由なら LIFF ブラウザがログイン済みで開き、リダイレクト自体が発生しない。
 * 着地はLIFF endpoint となるため、entry_code は liffController 側の liff.state 配管で
 * /liff/store へ引き継ぐ。
 */
function buildStoreEntryUrl(entryCode: string | null | undefined): string | null {
  if (!entryCode) return null;
  const liffId = appEnv.LINE_LIFF_ID_SURVEY ?? appEnv.LINE_LIFF_ID;
  if (liffId) {
    return `https://liff.line.me/${liffId}?entry_code=${encodeURIComponent(entryCode)}`;
  }
  return `${appEnv.APP_BASE_URL}/liff/store?entry_code=${encodeURIComponent(entryCode)}`;
}

type EntryCodeValidation =
  | { ok: true; code: string | null }
  | { ok: false; error: string };

/**
 * 店舗コード（entry_code）の検証。
 * - 空は許容（null で保存）。店舗専用化の初期設定では未割り当てで、編集で後から設定する運用。
 * - 入力時は英数とハイフン/アンダースコアのみ（QR/URL で扱いやすくするため）
 * - 他案件と重複しないこと（DB 側に部分 unique index あり。事前検証で親切なエラーに）
 */
async function validateEntryCode(rawCode: string, selfProjectId: string): Promise<EntryCodeValidation> {
  const code = rawCode.trim();
  if (!code) {
    return { ok: true, code: null };
  }
  if (!/^[A-Za-z0-9_-]+$/.test(code)) {
    return { ok: false, error: "店舗コードは半角英数・ハイフン・アンダースコアのみ使用できます" };
  }
  const existing = await projectRepository.findAnyByEntryCode(code);
  if (existing && existing.id !== selfProjectId) {
    return { ok: false, error: `店舗コード「${code}」は既に他の案件で使われています` };
  }
  return { ok: true, code };
}
