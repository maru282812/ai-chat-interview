import type { Request, Response } from "express";
import { HttpError } from "../lib/http";
import {
  normalizeBranchRule,
  normalizeQuestionConfig,
  validateBranchRule,
  validateQuestionConfig
} from "../lib/questionDesign";
import {
  getProjectAIState,
  getProjectAiStateTemplates,
  normalizeProjectAIState,
  stringifyProjectAIState
} from "../lib/projectAiState";
import { getProjectResearchSettings, parseLineSeparatedList, stringifyJsonField } from "../lib/projectResearch";
import { csvService } from "../services/csvService";
import { adminService } from "../services/adminService";
import { pointService } from "../services/pointService";
import { assignmentService, type AssignmentRuleFilter } from "../services/assignmentService";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
import { rankRepository } from "../repositories/rankRepository";
import { analysisService } from "../services/analysisService";
import { projectAiStateService } from "../services/projectAiStateService";
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
  if (value === "survey" || value === "interview" || value === "survey_with_interview_probe") {
    return value;
  }
  return "survey";
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

type ProjectFormOverrides = Partial<{
  name: string;
  client_name: string;
  objective: string;
  status: string;
  reward_points_text: string;
  research_mode: string;
  primary_objectives_text: string;
  secondary_objectives_text: string;
  comparison_constraints_text: string;
  prompt_rules_text: string;
  probe_policy_text: string;
  response_style_text: string;
  ai_state_template_key: string;
  ai_state_json: Project["ai_state_json"] | null;
  ai_state_json_text: string;
  ai_state_generated_at: string | null;
}>;

function buildProjectForm(project: Project | null, overrides: ProjectFormOverrides = {}) {
  const settings = getProjectResearchSettings(project);
  const name = overrides.name ?? project?.name ?? "";
  const objective = overrides.objective ?? project?.objective ?? "";
  const researchMode = overrides.research_mode ?? project?.research_mode ?? "survey";
  const primaryObjectivesText = overrides.primary_objectives_text ?? settings.primary_objectives.join("\n");
  const secondaryObjectivesText = overrides.secondary_objectives_text ?? settings.secondary_objectives.join("\n");
  const aiStateTemplateKey = overrides.ai_state_template_key ?? project?.ai_state_template_key ?? "";
  const fallbackProject = {
    name,
    objective: objective || null,
    research_mode: parseResearchMode(researchMode),
    primary_objectives: parseLineSeparatedList(primaryObjectivesText),
    secondary_objectives: parseLineSeparatedList(secondaryObjectivesText),
    ai_state_template_key: aiStateTemplateKey || null
  };
  const aiStateJsonText =
    overrides.ai_state_json_text ?? (project?.ai_state_json ? stringifyProjectAIState(project.ai_state_json) : "");
  const aiStateJson =
    overrides.ai_state_json ??
    (() => {
      const rawJson = aiStateJsonText.trim();
      if (!rawJson) {
        return project?.ai_state_json ?? null;
      }

      try {
        return normalizeProjectAIState(JSON.parse(rawJson), {
          fallbackTemplateKey: aiStateTemplateKey || null,
          fallbackProject
        });
      } catch {
        return project?.ai_state_json ?? null;
      }
    })();
  const aiState = getProjectAIState({
    ...fallbackProject,
    ai_state_json: aiStateJson,
    ai_state_template_key: aiStateTemplateKey || null
  });

  return {
    name,
    client_name: overrides.client_name ?? project?.client_name ?? "",
    objective,
    status: overrides.status ?? project?.status ?? "draft",
    reward_points_text: overrides.reward_points_text ?? String(project?.reward_points ?? 30),
    research_mode: researchMode,
    primary_objectives_text: primaryObjectivesText,
    secondary_objectives_text: secondaryObjectivesText,
    comparison_constraints_text:
      overrides.comparison_constraints_text ?? settings.comparison_constraints.join("\n"),
    prompt_rules_text: overrides.prompt_rules_text ?? settings.prompt_rules.join("\n"),
    probe_policy_text: overrides.probe_policy_text ?? stringifyJsonField(settings.probe_policy),
    response_style_text: overrides.response_style_text ?? stringifyJsonField(settings.response_style),
    ai_state_template_key: aiStateTemplateKey,
    ai_state_json: aiStateJson,
    ai_state_generated_at: overrides.ai_state_generated_at ?? project?.ai_state_generated_at ?? null,
    ai_state_json_text: aiStateJsonText,
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
    research_mode: bodyString(req.body.research_mode) || "survey",
    primary_objectives_text: bodyString(req.body.primary_objectives),
    secondary_objectives_text: bodyString(req.body.secondary_objectives),
    comparison_constraints_text: bodyString(req.body.comparison_constraints),
    prompt_rules_text: bodyString(req.body.prompt_rules),
    probe_policy_text: bodyString(req.body.probe_policy),
    response_style_text: bodyString(req.body.response_style),
    ai_state_template_key: bodyString(req.body.ai_state_template_key),
    ai_state_json_text: bodyString(req.body.ai_state_json),
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
  const payload = {
    title: input.title,
    project: input.project,
    action: input.action,
    errorMessage: input.errorMessage ?? null,
    successMessage: input.successMessage ?? null,
    projectAiStateTemplates: getProjectAiStateTemplates(),
    projectForm,
    aiStateDisplay: projectForm.ai_state_summary
  };

  if (typeof input.statusCode === "number") {
    res.status(input.statusCode);
  }

  res.render("admin/projects/researchForm", payload);
}

function getProjectRenderErrorMessage(error: unknown, fallbackMessage: string): string {
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
}): Project["ai_state_json"] | null {
  const rawJson = bodyString(input.req.body.ai_state_json).trim();
  if (!rawJson) {
    return input.existingAiState ?? null;
  }

  return normalizeProjectAIState(parseJsonField(rawJson, "ai_state_json", input.existingAiState ?? null), {
    fallbackTemplateKey: bodyString(input.req.body.ai_state_template_key) || input.fallbackProject.ai_state_template_key || null,
    fallbackProject: input.fallbackProject
  });
}

function parseQuestionExpectedSlots(
  value: string
): NonNullable<NonNullable<Question["question_config"]>["meta"]>["expected_slots"] {
  if (!value.trim()) {
    return [];
  }

  return parseJsonField(value, "expected_slots", []);
}

function buildQuestionMetaForm(question: Question | null) {
  const meta = question?.question_config?.meta ?? {};
  const probeConfig = meta.probe_config ?? {};

  return {
    question_goal: meta.question_goal ?? "",
    expected_slots_text: meta.expected_slots ? JSON.stringify(meta.expected_slots, null, 2) : "",
    required_slots_text: meta.required_slots ? JSON.stringify(meta.required_slots, null, 2) : "",
    skippable_if_slots_present_text: meta.skippable_if_slots_present
      ? JSON.stringify(meta.skippable_if_slots_present, null, 2)
      : "",
    can_prefill_future_slots: meta.can_prefill_future_slots ?? true,
    skip_forbidden_on_bad_answer: meta.skip_forbidden_on_bad_answer ?? true,
    bad_answer_patterns_text: meta.bad_answer_patterns ? JSON.stringify(meta.bad_answer_patterns, null, 2) : "",
    max_probes: typeof probeConfig.max_probes === "number" ? String(probeConfig.max_probes) : "",
    force_probe_on_bad: probeConfig.force_probe_on_bad ?? true,
    strict_topic_lock: probeConfig.strict_topic_lock ?? true
  };
}

type QuestionFormValues = ReturnType<typeof buildQuestionMetaForm> & {
  question_code: string;
  question_text: string;
  question_role: QuestionRole;
  question_type: QuestionType;
  sort_order_text: string;
  is_required: boolean;
  ai_probe_enabled: boolean;
  extraction_mode: "none" | "single_object" | "multi_object";
  extraction_target: "post_answer" | "post_session";
  extraction_schema_text: string;
  extracted_branch_enabled: boolean;
  question_config_text: string;
  branch_rule_text: string;
};

function buildQuestionFormValues(
  question: Question | null,
  overrides: Partial<QuestionFormValues> = {}
): QuestionFormValues {
  const extraction = question?.question_config?.extraction;
  return {
    question_code: overrides.question_code ?? question?.question_code ?? "",
    question_text: overrides.question_text ?? question?.question_text ?? "",
    question_role: overrides.question_role ?? question?.question_role ?? "main",
    question_type: overrides.question_type ?? question?.question_type ?? "text",
    sort_order_text: overrides.sort_order_text ?? String(question?.sort_order ?? 1),
    is_required: overrides.is_required ?? question?.is_required ?? true,
    ai_probe_enabled: overrides.ai_probe_enabled ?? question?.ai_probe_enabled ?? false,
    extraction_mode:
      overrides.extraction_mode ??
      (extraction?.mode === "single_object" || extraction?.mode === "multi_object" ? extraction.mode : "none"),
    extraction_target:
      overrides.extraction_target ??
      (extraction?.target === "post_session" ? "post_session" : "post_answer"),
    extraction_schema_text:
      overrides.extraction_schema_text ??
      (extraction?.schema ? JSON.stringify(extraction.schema, null, 2) : ""),
    extracted_branch_enabled: overrides.extracted_branch_enabled ?? extraction?.extracted_branch_enabled ?? false,
    question_config_text:
      overrides.question_config_text ??
      (question?.question_config ? JSON.stringify(question.question_config, null, 2) : ""),
    branch_rule_text:
      overrides.branch_rule_text ??
      (question?.branch_rule
        ? JSON.stringify(normalizeBranchRule(question.branch_rule) ?? question.branch_rule, null, 2)
        : ""),
    ...buildQuestionMetaForm(question),
    ...overrides
  };
}

function buildQuestionFormValuesFromRequest(req: Request): QuestionFormValues {
  return {
    question_code: bodyString(req.body.question_code),
    question_text: bodyString(req.body.question_text),
    question_role: parseQuestionRole(bodyString(req.body.question_role)),
    question_type: parseQuestionType(bodyString(req.body.question_type)),
    sort_order_text: bodyString(req.body.sort_order) || "1",
    is_required: req.body.is_required === "on",
    ai_probe_enabled: req.body.ai_probe_enabled === "on",
    question_goal: bodyString(req.body.question_goal),
    expected_slots_text: bodyString(req.body.expected_slots),
    required_slots_text: bodyString(req.body.required_slots),
    skippable_if_slots_present_text: bodyString(req.body.skippable_if_slots_present),
    can_prefill_future_slots: req.body.can_prefill_future_slots === "on",
    skip_forbidden_on_bad_answer: req.body.skip_forbidden_on_bad_answer === "on",
    bad_answer_patterns_text: bodyString(req.body.bad_answer_patterns),
    max_probes: bodyString(req.body.max_probes) || "1",
    force_probe_on_bad: req.body.force_probe_on_bad === "on",
    strict_topic_lock: req.body.strict_topic_lock === "on",
    extraction_mode:
      bodyString(req.body.extraction_mode) === "single_object" || bodyString(req.body.extraction_mode) === "multi_object"
        ? (bodyString(req.body.extraction_mode) as "single_object" | "multi_object")
        : "none",
    extraction_target: bodyString(req.body.extraction_target) === "post_session" ? "post_session" : "post_answer",
    extraction_schema_text: bodyString(req.body.extraction_schema),
    extracted_branch_enabled: req.body.extracted_branch_enabled === "on",
    question_config_text: bodyString(req.body.question_config),
    branch_rule_text: bodyString(req.body.branch_rule)
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

  res.render("admin/questions/formDesigner", {
    title: input.title,
    project: input.project,
    question: input.question,
    action: input.action,
    form: input.formValues,
    availableQuestions: input.availableQuestions,
    errorMessage: input.errorMessage ?? null,
    successMessage: input.successMessage ?? null
  });
}

function buildQuestionConfigFromRequest(
  req: Request,
  questionType: QuestionType,
  existing: Question["question_config"] | null
) {
  const parsed = parseJsonField(bodyString(req.body.question_config), "question_config", existing ?? null);
  const questionConfig: NonNullable<Question["question_config"]> =
    normalizeQuestionConfig(questionType, parsed) ?? {};
  const meta =
    questionConfig.meta && typeof questionConfig.meta === "object" && !Array.isArray(questionConfig.meta)
      ? { ...questionConfig.meta }
      : {};
  const maxProbes = parseOptionalInteger(req.body.max_probes);
  const questionGoal = bodyString(req.body.question_goal).trim();

  if (!questionGoal) {
    throw new HttpError(400, "question_goal は必須です");
  }

  meta.question_goal = questionGoal;
  meta.expected_slots = parseQuestionExpectedSlots(bodyString(req.body.expected_slots));
  meta.required_slots = parseStringArrayJsonField(bodyString(req.body.required_slots), "required_slots");
  meta.skippable_if_slots_present = parseStringArrayJsonField(
    bodyString(req.body.skippable_if_slots_present),
    "skippable_if_slots_present"
  );
  meta.can_prefill_future_slots = req.body.can_prefill_future_slots === "on";
  meta.skip_forbidden_on_bad_answer = req.body.skip_forbidden_on_bad_answer === "on";
  meta.bad_answer_patterns = parseJsonField(
    bodyString(req.body.bad_answer_patterns),
    "bad_answer_patterns",
    meta.bad_answer_patterns ?? []
  );
  meta.probe_config = {
    ...(meta.probe_config ?? {}),
    max_probes: maxProbes ?? 1,
    force_probe_on_bad: req.body.force_probe_on_bad === "on",
    strict_topic_lock: req.body.strict_topic_lock === "on"
  };

  const extractionMode =
    bodyString(req.body.extraction_mode) === "single_object" || bodyString(req.body.extraction_mode) === "multi_object"
      ? (bodyString(req.body.extraction_mode) as "single_object" | "multi_object")
      : "none";
  if (extractionMode === "none") {
    delete questionConfig.extraction;
  } else {
    const extractionSchema = parseJsonField(
      bodyString(req.body.extraction_schema),
      "extraction_schema",
      existing?.extraction?.schema ?? null
    );
    questionConfig.extraction = {
      mode: extractionMode,
      target: bodyString(req.body.extraction_target) === "post_session" ? "post_session" : "post_answer",
      schema: extractionSchema,
      extracted_branch_enabled: req.body.extracted_branch_enabled === "on"
    };
  }

  questionConfig.meta = meta;
  return questionConfig;
}

function buildBranchRuleFromRequest(req: Request, existing: Question["branch_rule"] | null) {
  const parsed = parseJsonField(bodyString(req.body.branch_rule), "branch_rule", existing ?? null);
  return normalizeBranchRule(parsed);
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
      const primaryObjectives = parseLineSeparatedList(bodyString(req.body.primary_objectives));
      const secondaryObjectives = parseLineSeparatedList(bodyString(req.body.secondary_objectives));
      const aiStateTemplateKey = bodyString(req.body.ai_state_template_key) || null;

      const created = await projectRepository.create({
        name,
        client_name: bodyString(req.body.client_name) || null,
        objective,
        status: bodyString(req.body.status || "draft") as "draft" | "active" | "paused" | "archived",
        reward_points: numberField(req.body.reward_points),
        research_mode: researchMode,
        primary_objectives: primaryObjectives,
        secondary_objectives: secondaryObjectives,
        comparison_constraints: parseLineSeparatedList(bodyString(req.body.comparison_constraints)),
        prompt_rules: parseLineSeparatedList(bodyString(req.body.prompt_rules)),
        probe_policy: parseJsonField(bodyString(req.body.probe_policy), "probe_policy", null),
        response_style: parseJsonField(bodyString(req.body.response_style), "response_style", null),
        ai_state_template_key: aiStateTemplateKey,
        ai_state_json: buildProjectAiStateFromRequest({
          req,
          fallbackProject: {
            name,
            objective,
            research_mode: researchMode,
            primary_objectives: primaryObjectives,
            secondary_objectives: secondaryObjectives,
            ai_state_template_key: aiStateTemplateKey
          }
        }),
        ai_state_generated_at: bodyString(req.body.ai_state_json).trim() ? new Date().toISOString() : null
      });
      const project = created.ai_state_json ? created : await projectAiStateService.ensureGenerated(created.id);
      res.redirect(`/admin/projects/${project.id}/edit?notice=project_created`);
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
      const primaryObjectives = parseLineSeparatedList(bodyString(req.body.primary_objectives));
      const secondaryObjectives = parseLineSeparatedList(bodyString(req.body.secondary_objectives));
      const aiStateTemplateKey = bodyString(req.body.ai_state_template_key) || null;
      const aiStateJson = buildProjectAiStateFromRequest({
        req,
        fallbackProject: {
          name,
          objective,
          research_mode: researchMode,
          primary_objectives: primaryObjectives,
          secondary_objectives: secondaryObjectives,
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
        primary_objectives: primaryObjectives,
        secondary_objectives: secondaryObjectives,
        comparison_constraints: parseLineSeparatedList(bodyString(req.body.comparison_constraints)),
        prompt_rules: parseLineSeparatedList(bodyString(req.body.prompt_rules)),
        probe_policy: parseJsonField(bodyString(req.body.probe_policy), "probe_policy", null),
        response_style: parseJsonField(bodyString(req.body.response_style), "response_style", null),
        ai_state_template_key: aiStateTemplateKey,
        ai_state_json: aiStateJson,
        ai_state_generated_at:
          aiStateJson && !existing.ai_state_generated_at
            ? new Date().toISOString()
            : existing.ai_state_generated_at
      });
      res.redirect(`/admin/projects/${projectId}/edit?notice=project_updated`);
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
    renderQuestionForm(res, {
      title: "質問作成",
      project,
      question: null,
      action: `/admin/projects/${project.id}/questions`,
      formValues: buildQuestionFormValues(null),
      availableQuestions
    });
  },

  async createQuestion(req: Request, res: Response): Promise<void> {
    const projectId = routeParam(req, "projectId");
    const project = await projectRepository.getById(projectId);
    const availableQuestions = await questionRepository.listByProject(projectId);

    try {
      const questionType = parseQuestionType(bodyString(req.body.question_type || "text"));
      const questionConfig = buildQuestionConfigFromRequest(req, questionType, null);
      const branchRule = buildBranchRuleFromRequest(req, null);

      await validateQuestionDefinition({
        projectId,
        questionCode: bodyString(req.body.question_code),
        questionType,
        questionConfig,
        branchRule
      });

      await questionRepository.create({
        project_id: projectId,
        question_code: bodyString(req.body.question_code),
        question_text: bodyString(req.body.question_text),
        question_role: parseQuestionRole(bodyString(req.body.question_role)),
        question_type: questionType,
        is_required: req.body.is_required === "on",
        sort_order: numberField(req.body.sort_order),
        branch_rule: branchRule,
        question_config: questionConfig,
        ai_probe_enabled: req.body.ai_probe_enabled === "on"
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
    res.redirect(`/admin/projects/${copied.id}/edit?notice=project_copied`);
  },

  async deleteProject(req: Request, res: Response): Promise<void> {
    const result = await projectRepository.deleteById(routeParam(req, "projectId"));
    res.redirect(`/admin/projects?notice=${result.mode === "archived" ? "project_archived" : "project_deleted"}`);
  },

  async updateQuestion(req: Request, res: Response): Promise<void> {
    const questionId = routeParam(req, "questionId");
    const existing = await questionRepository.getById(questionId);
    const project = await projectRepository.getById(existing.project_id);
    const availableQuestions = await questionRepository.listByProject(existing.project_id);

    try {
      const questionType = parseQuestionType(bodyString(req.body.question_type || "text"));
      const questionConfig = buildQuestionConfigFromRequest(req, questionType, existing.question_config);
      const branchRule = buildBranchRuleFromRequest(req, existing.branch_rule);

      await validateQuestionDefinition({
        projectId: existing.project_id,
        questionId,
        questionCode: bodyString(req.body.question_code),
        questionType,
        questionConfig,
        branchRule
      });

      await questionRepository.update(questionId, {
        question_code: bodyString(req.body.question_code),
        question_text: bodyString(req.body.question_text),
        question_role: parseQuestionRole(bodyString(req.body.question_role)),
        question_type: questionType,
        is_required: req.body.is_required === "on",
        sort_order: numberField(req.body.sort_order),
        branch_rule: branchRule,
        question_config: questionConfig,
        ai_probe_enabled: req.body.ai_probe_enabled === "on"
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
