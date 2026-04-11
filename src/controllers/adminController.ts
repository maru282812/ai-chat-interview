import type { Request, Response } from "express";
import { HttpError } from "../lib/http";
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

function bodyStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "string" && value.trim()) {
    return [value];
  }
  return [];
}

function parseJsonField<T>(value: string | undefined, fieldName: string, fallback: T): T {
  if (!value || !value.trim()) {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    throw new HttpError(400, `${fieldName} はJSON形式で入力してください`);
  }
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

function parseStringArrayJsonField(value: string, fieldName: string): string[] {
  if (!value.trim()) {
    return [];
  }

  const parsed = parseJsonField<unknown[]>(value, fieldName, []);
  if (!Array.isArray(parsed)) {
    throw new HttpError(400, `${fieldName} は配列(JSON)で入力してください`);
  }

  return parsed.map((item) => String(item ?? "").trim()).filter(Boolean);
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

function parseAssignmentRule(req: Request): AssignmentRuleFilter {
  return {
    rank_code: bodyString(req.body.rank_code) || null,
    total_points_min: parseOptionalNumber(req.body.total_points_min),
    total_points_max: parseOptionalNumber(req.body.total_points_max),
    has_participated: parseBooleanSelect(req.body.has_participated),
    last_participated_before: parseNullableDateTime(req.body.last_participated_before),
    unanswered_project_id: bodyString(req.body.unanswered_project_id) || null
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
  if (
    value === "text" ||
    value === "single_select" ||
    value === "multi_select" ||
    value === "yes_no" ||
    value === "scale"
  ) {
    return value;
  }

  return "text";
}

type ProjectDisplayStyle = "survey" | "interview";

type ProjectFormOverrides = Partial<{
  name: string;
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
  }
): void {
  const projectForm = buildProjectForm(input.project, input.projectFormOverrides ?? {});
  if (typeof input.statusCode === "number") {
    res.status(input.statusCode);
  }

  res.render("admin/projects/researchForm", {
    title: input.title,
    project: input.project,
    action: input.action,
    errorMessage: input.errorMessage ?? null,
    successMessage: input.successMessage ?? null,
    projectAiStateTemplates: getProjectAiStateTemplates(),
    projectForm,
    aiStateDisplay: projectForm.ai_state_summary
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
  const yesNoLabels = getYesNoLabels(question?.question_config ?? null);
  const scale = getQuestionScaleRange(question?.question_config ?? null);

  return {
    question_code: overrides.question_code ?? question?.question_code ?? "",
    question_text: overrides.question_text ?? question?.question_text ?? "",
    question_role: overrides.question_role ?? question?.question_role ?? "main",
    question_type: overrides.question_type ?? question?.question_type ?? "text",
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
    branch_rows: overrides.branch_rows ?? branchRows
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
    })).filter((row) => row.field_label || row.value || row.next) as QuestionBranchRowFormValue[]
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
    errorMessage?: string | null;
    successMessage?: string | null;
    statusCode?: number;
  }
): void {
  if (typeof input.statusCode === "number") {
    res.status(input.statusCode);
  }

  res.render("admin/questions/formV2", {
    title: input.title,
    project: input.project,
    question: input.question,
    action: input.action,
    form: input.formValues,
    availableQuestions: input.availableQuestions.filter(
      (candidate) => !candidate.is_hidden || candidate.id === input.question?.id
    ),
    errorMessage: input.errorMessage ?? null,
    successMessage: input.successMessage ?? null
  });
}

function buildQuestionConfigFromRequest(
  req: Request,
  questionType: QuestionType,
  existing: Question["question_config"] | null
) {
  const questionGoal = bodyString(req.body.question_goal).trim();
  if (!questionGoal) {
    throw new HttpError(400, "question_goal は必須です");
  }

  const extractionEnabled = req.body.extraction_enabled === "on";
  const extractionItems = normalizeTextList(bodyStringArray(req.body.extraction_items));
  const questionConfig: NonNullable<Question["question_config"]> =
    normalizeQuestionConfig(questionType, existing ?? {}) ?? {};

  switch (questionType) {
    case "text": {
      const placeholder = bodyString(req.body.placeholder).trim();
      if (placeholder) {
        questionConfig.placeholder = placeholder;
      } else {
        delete questionConfig.placeholder;
      }
      break;
    }
    case "single_select":
    case "multi_select": {
      const optionLabels = normalizeTextList(bodyStringArray(req.body.option_labels));
      questionConfig.options = optionLabels.map((label) => ({ label, value: label }));
      if (questionType === "multi_select") {
        const minSelect = parseOptionalInteger(req.body.min_select);
        const maxSelect = parseOptionalInteger(req.body.max_select);
        if (minSelect !== null) {
          questionConfig.min_select = minSelect;
        } else {
          delete questionConfig.min_select;
        }
        if (maxSelect !== null) {
          questionConfig.max_select = maxSelect;
        } else {
          delete questionConfig.max_select;
        }
      }
      break;
    }
    case "yes_no":
      questionConfig.yes_label = bodyString(req.body.yes_label).trim() || "はい";
      questionConfig.no_label = bodyString(req.body.no_label).trim() || "いいえ";
      break;
    case "scale":
      questionConfig.min = parseOptionalInteger(req.body.scale_min) ?? 1;
      questionConfig.max = parseOptionalInteger(req.body.scale_max) ?? 5;
      questionConfig.min_label = bodyString(req.body.scale_min_label).trim() || undefined;
      questionConfig.max_label = bodyString(req.body.scale_max_label).trim() || undefined;
      break;
    default:
      break;
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
        client_name: bodyString(req.body.client_name) || null,
        objective,
        status: bodyString(req.body.status || "draft") as "draft" | "active" | "paused" | "archived",
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
        ai_state_generated_at: new Date().toISOString()
      });
      res.redirect(buildProjectEditRedirectPath(created.id, "project_created"));
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
    renderProjectResearchForm(res, {
      title: "プロジェクト編集",
      project,
      action: `/admin/projects/${project.id}`,
      successMessage: resolveNoticeMessage(req.query.notice)
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
        client_name: bodyString(req.body.client_name) || null,
        objective,
        status: bodyString(req.body.status || "draft") as "draft" | "active" | "paused" | "archived",
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
        ai_state_generated_at: new Date().toISOString()
      });
      res.redirect(buildProjectEditRedirectPath(projectId, "project_updated"));
    } catch (error) {
      renderProjectResearchForm(res, {
        title: "プロジェクト編集",
        project: existing,
        action: `/admin/projects/${projectId}`,
        projectFormOverrides: buildProjectFormOverridesFromRequest(req),
        errorMessage: getProjectRenderErrorMessage(error, "プロジェクトの更新に失敗しました。"),
        statusCode: getProjectRenderStatusCode(error)
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
    const availableQuestions = await questionRepository.listByProject(project.id);
    const nextSortOrder = await questionRepository.getNextSortOrder(project.id);
    renderQuestionForm(res, {
      title: "質問作成",
      project,
      question: null,
      action: `/admin/projects/${project.id}/questions`,
      formValues: buildQuestionFormValues(null, { sort_order_text: String(nextSortOrder) }),
      availableQuestions
    });
  },

  async createQuestion(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const project = await projectRepository.getById(projectId);
    const availableQuestions = await questionRepository.listByProject(projectId, { includeHidden: true });

    try {
      const questionType = parseQuestionType(bodyString(req.body.question_type || "text"));
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

      const createMaxProbeCount = parseOptionalInteger(bodyString(req.body.max_probe_count));
      await questionRepository.create({
        project_id: projectId,
        question_code: questionCode,
        question_text: bodyString(req.body.question_text),
        question_role: parseQuestionRole(bodyString(req.body.question_role)),
        question_type: questionType,
        is_required: req.body.is_required === "on",
        sort_order: sortOrder,
        branch_rule: branchRule,
        question_config: questionConfig,
        ai_probe_enabled: req.body.ai_probe_enabled === "on",
        probe_guideline: bodyString(req.body.probe_guideline) || null,
        max_probe_count: createMaxProbeCount,
        render_strategy: bodyString(req.body.render_strategy) === "dynamic" ? "dynamic" : "static"
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
        errorMessage: getProjectRenderErrorMessage(error, "質問の作成に失敗しました。"),
        statusCode: getProjectRenderStatusCode(error)
      });
    }
  },

  async editQuestion(req: Request, res: Response): Promise<void> {
    const question = await questionRepository.getById(routeParam(req, "questionId"));
    const project = await projectRepository.getById(question.project_id);
    const availableQuestions = await questionRepository.listByProject(question.project_id);
    renderQuestionForm(res, {
      title: "質問編集",
      project,
      question,
      action: `/admin/questions/${question.id}`,
      formValues: buildQuestionFormValues(question),
      availableQuestions,
      successMessage: resolveNoticeMessage(req.query.notice)
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
    const project = await projectRepository.getById(existing.project_id);
    const availableQuestions = await questionRepository.listByProject(existing.project_id, { includeHidden: true });

    try {
      const questionType = parseQuestionType(bodyString(req.body.question_type || "text"));
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

      const updateMaxProbeCount = parseOptionalInteger(bodyString(req.body.max_probe_count));
      await questionRepository.update(questionId, {
        question_code: questionCode,
        question_text: bodyString(req.body.question_text),
        question_role: parseQuestionRole(bodyString(req.body.question_role)),
        question_type: questionType,
        is_required: req.body.is_required === "on",
        sort_order: sortOrder,
        branch_rule: branchRule,
        question_config: questionConfig,
        ai_probe_enabled: req.body.ai_probe_enabled === "on",
        probe_guideline: bodyString(req.body.probe_guideline) || null,
        max_probe_count: updateMaxProbeCount,
        render_strategy: bodyString(req.body.render_strategy) === "dynamic" ? "dynamic" : "static"
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
      ...detail
    });
  },

  async assignProjectManual(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    await assignmentService.assignManual({
      projectId,
      sourceRespondentIds: bodyStringArray(req.body.selected_respondent_ids),
      deadline: parseNullableDateTime(req.body.deadline)
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
    const [respondentOverviews, ranks] = await Promise.all([
      adminService.listRespondents(),
      adminService.listRanks()
    ]);
    res.render("admin/points/index", {
      title: "Points",
      respondents: respondentOverviews.map((item) => item.respondent),
      ranks
    });
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
  }
};
