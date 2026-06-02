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
import { getProjectResearchSettings, parseLineSeparatedList } from "../lib/projectResearch";
import { csvService } from "../services/csvService";
import { adminService } from "../services/adminService";
import { pointService } from "../services/pointService";
import { assignmentService, type AssignmentRuleFilter } from "../services/assignmentService";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
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
    statusCode?: number;
    screeningConditions?: import("../types/domain").ScreeningCondition[];
    screeningQuestions?: import("../types/domain").Question[];
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
    projectAiStateTemplates: getProjectAiStateTemplates(),
    projectForm,
    aiStateDisplay: projectForm.ai_state_summary,
    screeningConditions: allConditions,
    screeningQuestions: input.screeningQuestions ?? [],
    profileConditionsState: parseProfileConditionsForRender(allConditions)
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
    if (MULTI_CHOICE_TYPES.includes(questionType)) {
      const minSelect = parseOptionalInteger(req.body.min_select);
      const maxSelect = parseOptionalInteger(req.body.max_select);
      if (minSelect !== null) { questionConfig.min_select = minSelect; } else { delete questionConfig.min_select; }
      if (maxSelect !== null) { questionConfig.max_select = maxSelect; } else { delete questionConfig.max_select; }
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

  const meta = buildQuestionMetaFromAuthoringInput({
    questionGoal,
    extractionItemLabels: extractionEnabled ? extractionItems : [],
    maxProbes: parseOptionalInteger(req.body.max_probes),
    existingMeta: existing?.meta ?? null
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
        screening_last_question_order: null
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
      res.redirect(`/admin/projects/${created.id}/questions`);
    } catch (error) {
      renderProjectResearchForm(res, {
        title: "新規プロジェクト作成",
        project: null,
        action: "/admin/projects",
        projectFormOverrides: buildProjectFormOverridesFromRequest(req),
        errorMessage: getProjectRenderErrorMessage(error, "プロジェクトの作成に失敗しました。"),
        statusCode: getProjectRenderStatusCode(error)
      });
    }
  },

  async editProject(req: Request, res: Response): Promise<void> {
    const project = await projectRepository.getById(routeParam(req, "projectId"));
    const { screeningConditionRepository } = await import("../repositories/screeningConditionRepository");
    const [conditions, allQuestions] = await Promise.all([
      screeningConditionRepository.listByProject(project.id),
      questionRepository.listByProject(project.id, { includeHidden: false })
    ]);
    const screeningQuestions = allQuestions.filter(q => q.question_role === "screening");
    renderProjectResearchForm(res, {
      title: "プロジェクト編集",
      project,
      action: `/admin/projects/${project.id}`,
      successMessage: resolveNoticeMessage(req.query.notice),
      screeningConditions: conditions,
      screeningQuestions
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
        category: bodyString(req.body.category) || null,
        estimated_minutes: parseOptionalInteger(req.body.estimated_minutes) ?? null,
        max_respondents: parseOptionalInteger(req.body.max_respondents) ?? null,
        delivery_enabled: req.body.delivery_enabled === "true" || req.body.delivery_enabled === "on",
        delivery_type: (bodyString(req.body.delivery_type) || null) as import("../types/domain").DeliveryType | null,
      });
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
      try {
        const { screeningConditionRepository } = await import("../repositories/screeningConditionRepository");
        const [conds, allQs] = await Promise.all([
          screeningConditionRepository.listByProject(projectId),
          questionRepository.listByProject(projectId, { includeHidden: false })
        ]);
        updateErrorConditions = conds;
        updateErrorScreeningQuestions = allQs.filter(q => q.question_role === "screening");
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
        screeningQuestions: updateErrorScreeningQuestions
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

    const systemPrompt = [
      "あなたはアンケート設計の専門家です。",
      "必ず日本語で出力してください。",
      "JSONを求められた場合はJSON以外を一切出力しないでください。",
    ].join("\n");

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

    const userPrompt = `以下のアンケート設問に対して、回答設定の候補を提案してください。

設問文: 「${questionText}」
現在の回答形式: ${currentQuestionType}

${typeInstruction}

注意:
- 選択肢・行・列は実用的で一般的なアンケートで使われる粒度にしてください
- warnings は注意点がある場合のみ記述してください（通常は空配列）

以下のJSON形式のみで回答してください（前後に余分な文字を入れないこと）:
${responseFormat}`;

    try {
      const { openai } = await import("../config/openai");
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 600,
        response_format: { type: "json_object" },
      });

      const raw = response.choices[0]?.message?.content ?? "{}";
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
      const { openai } = await import("../config/openai");
      const systemPrompt = [
        "あなたはアンケート設計専門家です。",
        "参照元案件の設問テキストを、新規案件の「プロジェクト名」と「調査目的」に合わせて自然に書き換えてください。",
        "設問の構造・順番・回答形式・分岐設定は変更しないこと。",
        "必ずJSON形式のみで回答すること。日本語で出力すること。",
      ].join("\n");

      const userPrompt = `新規案件:
- プロジェクト名: ${targetProject.name}
- 調査目的: ${targetProject.objective ?? "未設定"}

参照元案件:
- プロジェクト名: ${sourceProject.name}
- 調査目的: ${sourceProject.objective ?? "未設定"}

以下の設問リストを新規案件向けに修正し、同じindex配列で返してください:
${JSON.stringify(questionsForAI, null, 2)}

以下のJSON形式のみで回答:
{"adjusted_questions":[{"index":0,"question_text":"修正後の設問文","options":["選択肢1"],"research_goal":"修正後のgoal"}]}`;

      const aiResp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: "json_object" },
      });

      const raw = aiResp.choices[0]?.message?.content ?? "{}";
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

    const systemPrompt = [
      "あなたはアンケート・インタビュー設計専門家です。",
      "プロジェクト名と調査目的に沿った実用的な設問フローをJSON形式で生成してください。",
      "設問は調査として成立する自然な流れで構成し、8〜15問程度にしてください。",
      "日本語で出力し、必ずJSON形式のみで回答してください。",
    ].join("\n");

    const userPrompt = `プロジェクト名: ${project.name}
調査目的: ${project.objective ?? ""}

以下のJSON形式でフロー設計を生成してください:
{
  "questions": [
    {
      "question_text": "設問文",
      "question_type": "single_choice|multi_choice|free_text_short|free_text_long|numeric",
      "question_role": "screening|main|attribute|free_comment",
      "is_required": true,
      "ai_probe_enabled": false,
      "research_goal": "この設問で知りたいこと（必須）",
      "options": ["選択肢1", "選択肢2"]
    }
  ]
}

回答形式:
- single_choice: 単一選択（options必須）
- multi_choice: 複数選択（options必須）
- free_text_short: 短文自由記述
- free_text_long: 長文自由記述
- numeric: 数値入力

注意: options は選択型のみ設定。research_goal は全設問に設定すること。`;

    let generatedList: Array<Record<string, unknown>> = [];

    try {
      const { openai } = await import("../config/openai");
      const aiResp = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
        max_tokens: 4000,
        response_format: { type: "json_object" },
      });

      const raw = aiResp.choices[0]?.message?.content ?? "{}";
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
    const { supabase: db } = await import("../config/supabase");

    const campaign = await deliveryCampaignRepository.getById(campaignId);
    if (campaign.status === "sent" || campaign.status === "cancelled") {
      res.status(400).json({ error: "このキャンペーンは実行できません" });
      return;
    }
    if (!campaign.project_id) {
      res.status(400).json({ error: "対象プロジェクトが設定されていません。編集画面でプロジェクトを選択してください。" });
      return;
    }

    // セグメント条件からターゲットユーザーを取得
    let targetLineUserIds: string[] = [];

    if (campaign.segment_id) {
      const segment = await segmentRepository.getById(campaign.segment_id);
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
      projectId: campaign.project_id,
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
    const [projects, segments, notificationTemplates, campaigns] = await Promise.all([
      projectRepository.list(),
      segmentRepository.list(),
      notificationTemplateRepository.list(),
      deliveryCampaignRepository.list(),
    ]);

    const campaignsByProject = new Map<string, typeof campaigns>();
    for (const c of campaigns) {
      if (!c.project_id) continue;
      if (!campaignsByProject.has(c.project_id)) campaignsByProject.set(c.project_id, []);
      campaignsByProject.get(c.project_id)!.push(c);
    }

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
      return { ...p, deliveryStatus, campaigns: pCampaigns };
    });

    res.render("admin/delivery-operations/index", {
      title: "配信オペレーション",
      projects: projectsWithMeta,
      segments,
      notificationTemplates,
      campaigns,
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
};
