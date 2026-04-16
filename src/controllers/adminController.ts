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
import { parseDisplayTags, generateTagsFromParsed } from "../lib/tagParser";
import { validateDisplayTags } from "../lib/tagValidator";
import type { DisplayTagsParsed, VisibilityCondition } from "../types/questionSchema";

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

function parseScreeningPassAction(value: unknown): import("../types/domain").ScreeningPassAction {
  const s = bodyString(value).trim();
  if (s === "interview" || s === "manual_hold") return s;
  return "survey";
}

function buildScreeningConfig(req: Request): import("../types/domain").ScreeningConfig {
  return {
    pass_action: parseScreeningPassAction(req.body.screening_pass_action),
    pass_message: bodyString(req.body.screening_pass_message).trim() || null,
    fail_message: bodyString(req.body.screening_fail_message).trim() || null
  };
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
    matrix_rows: overrides.matrix_rows ?? "",
    matrix_cols: overrides.matrix_cols ?? "",
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

  res.render("admin/questions/formV3", {
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

  return {
    comment_top: commentTop,
    comment_bottom: commentBottom,
    answer_output_type: answerOutputType,
    display_tags_raw: rawTags,
    display_tags_parsed: parsedTags,
    visibility_conditions: visibilityConditions,
  };
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
        ai_state_generated_at: new Date().toISOString(),
        screening_config: buildScreeningConfig(req),
        screening_last_question_order: parseOptionalInteger(req.body.screening_last_question_order)
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
        ai_state_generated_at: new Date().toISOString(),
        screening_config: buildScreeningConfig(req),
        screening_last_question_order: parseOptionalInteger(req.body.screening_last_question_order)
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
      const createTagFields = buildTagFieldsFromRequest(req);
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
        render_strategy: bodyString(req.body.render_strategy) === "dynamic" ? "dynamic" : "static",
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
      const updateTagFields = buildTagFieldsFromRequest(req);
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
};
