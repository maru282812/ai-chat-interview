import type {
  Project,
  Question,
  ProjectAIState,
  QuestionBadAnswerPattern,
  QuestionCompletionCondition,
  QuestionExpectedSlot,
  QuestionMeta,
  QuestionProbeConfig,
  QuestionProbePriority,
  QuestionProbeStopCondition,
  ResearchMode,
  StructuredAnswerCompletion,
  StructuredAnswerPayload,
  StructuredAnswerSlotValue,
  StructuredProbeType,
  UserPostType
} from "../types/domain";
import { getProjectAIState } from "./projectAiState";

export type QuestionMetaContextType =
  | ResearchMode
  | Extract<UserPostType, "free_comment" | "rant" | "diary">;

interface NormalizeQuestionMetaOptions {
  projectAiState?: ProjectAIState | null;
}

interface NormalizedProbeConfig {
  max_probes: number;
  min_probes: number;
  force_probe_on_bad: boolean;
  probe_priority: QuestionProbePriority[];
  stop_conditions: QuestionProbeStopCondition[];
  allow_followup_expansion: boolean;
  strict_topic_lock: boolean;
}

export interface NormalizedQuestionMeta {
  research_goal: string | null;
  question_goal: string | null;
  probe_goal: string | null;
  expected_slots: QuestionExpectedSlot[];
  required_slots: string[];
  skippable_if_slots_present: string[];
  can_prefill_future_slots: boolean;
  skip_forbidden_on_bad_answer: boolean;
  bad_answer_patterns: QuestionBadAnswerPattern[];
  probe_config: NormalizedProbeConfig;
  completion_conditions: QuestionCompletionCondition[];
  render_style: NonNullable<QuestionMeta["render_style"]>;
}

export interface ProbeAssessment {
  shouldProbe: boolean;
  probeType: StructuredProbeType | null;
  missingSlots: string[];
  matchedBadPatterns: string[];
  isShort: boolean;
  isAbstract: boolean;
  isBadAnswer: boolean;
  isLowSpecificity: boolean;
}

export interface QuestionSlotProgress {
  requiredSlots: string[];
  missingRequiredSlots: string[];
  skippableSlots: string[];
  isCurrentQuestionSatisfied: boolean;
  areSkippableSlotsSatisfied: boolean;
  matchedBadPatterns: string[];
  isBadAnswer: boolean;
  isAbstract: boolean;
  isLowSpecificity: boolean;
  qualityScore: number;
}

export type AnalysisConfigSource = "question.question_config.meta" | "project.ai_state_json" | "default";

export interface ResolvedAnswerAnalysisContext {
  project_goal: string | null;
  user_understanding_goal: string | null;
  required_slots: QuestionExpectedSlot[];
  optional_slots: QuestionExpectedSlot[];
  next_question_required_slots: QuestionExpectedSlot[];
  project_required_slot_keys: string[];
  max_probes: number;
  strict_topic_lock: boolean;
  sources: {
    required_slots: AnalysisConfigSource;
    optional_slots: AnalysisConfigSource;
    max_probes: AnalysisConfigSource;
    strict_topic_lock: AnalysisConfigSource;
  };
}

const BAD_ANSWER_NOTE = {
  NO_CONTENT: "no_content",
  ABSTRACT: "abstract",
  LOW_SPECIFICITY: "low_specificity"
} as const;

const DEFAULT_PROBE_PRIORITY: QuestionProbePriority[] = ["missing", "bad_pattern", "low_specificity"];
const DEFAULT_STOP_CONDITIONS: QuestionProbeStopCondition[] = ["sufficient_slots", "high_quality"];
const DEFAULT_COMPLETION_QUALITY_THRESHOLD = 60;

const ABSTRACT_KEYWORDS = [
  "\u306a\u3093\u3068\u306a\u304f",
  "\u666e\u901a",
  "\u3044\u308d\u3044\u308d",
  "\u6f20\u7136",
  "\u7279\u306b\u7406\u7531\u306f\u306a\u3044",
  "\u307e\u3042\u307e\u3042"
];

function createDefaultBadAnswerPatterns(maxLength: number): QuestionBadAnswerPattern[] {
  return [
    { type: "exact", value: "\u7279\u306b\u306a\u3057", note: BAD_ANSWER_NOTE.NO_CONTENT },
    { type: "exact", value: "\u7279\u306b\u306a\u3044", note: BAD_ANSWER_NOTE.NO_CONTENT },
    { type: "exact", value: "\u306a\u3044", note: BAD_ANSWER_NOTE.NO_CONTENT },
    { type: "exact", value: "\u308f\u304b\u3089\u306a\u3044", note: BAD_ANSWER_NOTE.NO_CONTENT },
    { type: "exact", value: "\u601d\u3044\u3064\u304b\u306a\u3044", note: BAD_ANSWER_NOTE.NO_CONTENT },
    { type: "exact", value: "\u899a\u3048\u3066\u3044\u306a\u3044", note: BAD_ANSWER_NOTE.NO_CONTENT },
    { type: "contains", value: "\u306a\u3093\u3068\u306a\u304f", note: BAD_ANSWER_NOTE.ABSTRACT },
    { type: "contains", value: "\u666e\u901a", note: BAD_ANSWER_NOTE.ABSTRACT },
    { type: "contains", value: "\u3044\u308d\u3044\u308d", note: BAD_ANSWER_NOTE.ABSTRACT },
    { type: "max_length", value: maxLength, note: BAD_ANSWER_NOTE.LOW_SPECIFICITY }
  ];
}

function createProbeConfig(
  input: Pick<
    NormalizedProbeConfig,
    "max_probes" | "min_probes" | "allow_followup_expansion" | "strict_topic_lock"
  >
): NormalizedProbeConfig {
  return {
    max_probes: input.max_probes,
    min_probes: input.min_probes,
    force_probe_on_bad: true,
    probe_priority: [...DEFAULT_PROBE_PRIORITY],
    stop_conditions: [...DEFAULT_STOP_CONDITIONS],
    allow_followup_expansion: input.allow_followup_expansion,
    strict_topic_lock: input.strict_topic_lock
  };
}

function defaultInterviewMeta(question: Question): NormalizedQuestionMeta {
  return {
    research_goal: null,
    question_goal: null,
    probe_goal: "Clarify only the missing detail needed for structured comparison.",
    expected_slots: [],
    required_slots: [],
    skippable_if_slots_present: [],
    can_prefill_future_slots: true,
    skip_forbidden_on_bad_answer: true,
    bad_answer_patterns: createDefaultBadAnswerPatterns(12),
    probe_config: createProbeConfig({
      max_probes: 1,
      min_probes: 0,
      allow_followup_expansion: false,
      strict_topic_lock: true
    }),
    completion_conditions: [{ type: "min_length", value: 10 }, { type: "no_bad_patterns" }],
    render_style: {
      mode: question.question_type === "text" ? "interview_natural" : "default",
      connect_from_previous_answer: true,
      avoid_question_number: true,
      preserve_options: question.question_type !== "text"
    }
  };
}

function defaultSurveyMeta(question: Question): NormalizedQuestionMeta {
  return {
    research_goal: null,
    question_goal: null,
    probe_goal: "Collect only the minimum missing detail needed for comparison.",
    expected_slots: [],
    required_slots: [],
    skippable_if_slots_present: [],
    can_prefill_future_slots: true,
    skip_forbidden_on_bad_answer: true,
    bad_answer_patterns: createDefaultBadAnswerPatterns(10),
    probe_config: createProbeConfig({
      max_probes: 1,
      min_probes: 0,
      allow_followup_expansion: false,
      strict_topic_lock: true
    }),
    completion_conditions: [{ type: "min_length", value: 8 }, { type: "no_bad_patterns" }],
    render_style: {
      mode: "default",
      connect_from_previous_answer: true,
      avoid_question_number: true,
      preserve_options: question.question_type !== "text"
    }
  };
}

function defaultFreeCommentMeta(): NormalizedQuestionMeta {
  return {
    research_goal: "Collect comparable context and any missing insight from the final free comment.",
    question_goal: "Capture what was left unsaid in a comparable structure.",
    probe_goal: "Turn a shallow free comment into concrete context and reasons.",
    expected_slots: [
      { key: "usage_scene", label: "利用場面", description: "いつ、どこで、どんな状況だったか", required: true },
      { key: "reason", label: "理由", description: "そう感じた理由や背景", required: true },
      { key: "pain_point", label: "不満点", description: "困りごとや不便だったこと", required: false },
      { key: "alternative", label: "代替手段", description: "代わりに使ったものや比較対象", required: false },
      { key: "desired_state", label: "理想状態", description: "本当はどうなってほしいか", required: false }
    ],
    required_slots: ["usage_scene", "reason"],
    skippable_if_slots_present: [],
    can_prefill_future_slots: true,
    skip_forbidden_on_bad_answer: true,
    bad_answer_patterns: createDefaultBadAnswerPatterns(14),
    probe_config: createProbeConfig({
      max_probes: 1,
      min_probes: 0,
      allow_followup_expansion: true,
      strict_topic_lock: true
    }),
    completion_conditions: [
      { type: "min_length", value: 18 },
      { type: "required_slots" },
      { type: "no_bad_patterns" }
    ],
    render_style: {
      mode: "free_comment",
      connect_from_previous_answer: true,
      avoid_question_number: true,
      preserve_options: false
    }
  };
}

function defaultDiaryMeta(): NormalizedQuestionMeta {
  return {
    ...defaultFreeCommentMeta(),
    research_goal: "Store daily events and feelings in a later-comparable structure.",
    question_goal: "Capture event context and emotional background concretely."
  };
}

function defaultRantMeta(): NormalizedQuestionMeta {
  return {
    ...defaultFreeCommentMeta(),
    research_goal: "Store strong complaints and emotions with comparable background and causes.",
    question_goal: "Capture complaint context and triggers concretely."
  };
}

function normalizeExpectedSlot(slot: QuestionExpectedSlot): QuestionExpectedSlot | null {
  const key = String(slot.key ?? "").trim();
  if (!key) {
    return null;
  }

  return {
    key,
    label: slot.label?.trim() || key,
    description: slot.description?.trim() || undefined,
    required: slot.required ?? true,
    examples: Array.isArray(slot.examples)
      ? slot.examples.map((value) => String(value).trim()).filter(Boolean)
      : []
  };
}

function normalizeBadAnswerPattern(pattern: QuestionBadAnswerPattern): QuestionBadAnswerPattern | null {
  if (!pattern || !pattern.type) {
    return null;
  }

  if (pattern.type === "max_length") {
    const value = Number(pattern.value);
    if (!Number.isFinite(value)) {
      return null;
    }

    return {
      type: "max_length",
      value,
      note: pattern.note?.trim() || BAD_ANSWER_NOTE.LOW_SPECIFICITY
    };
  }

  const value = String(pattern.value ?? "").trim();
  if (!value) {
    return null;
  }

  return {
    type: pattern.type,
    value,
    note: pattern.note?.trim() || undefined
  };
}

function normalizeCompletionCondition(
  condition: QuestionCompletionCondition
): QuestionCompletionCondition | null {
  if (!condition?.type) {
    return null;
  }

  return {
    type: condition.type,
    value: condition.value
  };
}

function normalizeProbePriority(
  value: QuestionProbeConfig["probe_priority"] | undefined,
  fallback: QuestionProbePriority[]
): QuestionProbePriority[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [...fallback];
  }

  const normalized = value.filter(
    (item): item is QuestionProbePriority =>
      item === "missing" || item === "bad_pattern" || item === "low_specificity"
  );
  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeProbeStopConditions(
  value: QuestionProbeConfig["stop_conditions"] | undefined,
  fallback: QuestionProbeStopCondition[]
): QuestionProbeStopCondition[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [...fallback];
  }

  const normalized = value.filter(
    (item): item is QuestionProbeStopCondition =>
      item === "sufficient_slots" ||
      item === "high_quality" ||
      item === "no_new_information" ||
      item === "repetition_risk"
  );
  return normalized.length > 0 ? normalized : [...fallback];
}

function normalizeSlotKeyList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

export function getRequiredSlotKeys(meta: Pick<NormalizedQuestionMeta, "expected_slots" | "required_slots">): string[] {
  const configured = normalizeSlotKeyList(meta.required_slots);
  if (configured.length > 0) {
    return Array.from(new Set(configured));
  }

  return meta.expected_slots
    .filter((slot) => slot.required !== false)
    .map((slot) => slot.key);
}

export function getSkippableSlotKeys(
  meta: Pick<NormalizedQuestionMeta, "expected_slots" | "required_slots" | "skippable_if_slots_present">
): string[] {
  const configured = normalizeSlotKeyList(meta.skippable_if_slots_present);
  if (configured.length > 0) {
    return Array.from(new Set(configured));
  }

  return getRequiredSlotKeys(meta);
}

export function hasFilledSlot(slotMap: Record<string, string | null | undefined>, key: string): boolean {
  return typeof slotMap[key] === "string" && Boolean(slotMap[key]?.trim());
}

export function mergeSlotMaps(
  ...slotMaps: Array<Record<string, string | null | undefined> | null | undefined>
): Record<string, string | null> {
  return slotMaps.reduce<Record<string, string | null>>((accumulator, slotMap) => {
    if (!slotMap) {
      return accumulator;
    }

    for (const [key, value] of Object.entries(slotMap)) {
      if (typeof value === "string" && value.trim()) {
        accumulator[key] = value.trim();
      } else if (!(key in accumulator)) {
        accumulator[key] = null;
      }
    }

    return accumulator;
  }, {});
}

function normalizeProbeConfig(
  configured: QuestionProbeConfig | undefined,
  fallback: NormalizedProbeConfig
): NormalizedProbeConfig {
  const maxCandidate = Number(configured?.max_probes);
  const minCandidate = Number(configured?.min_probes);
  const maxProbes = Number.isFinite(maxCandidate) ? Math.max(0, Math.round(maxCandidate)) : fallback.max_probes;
  const minProbes = Number.isFinite(minCandidate) ? Math.max(0, Math.round(minCandidate)) : fallback.min_probes;

  return {
    max_probes: Math.max(maxProbes, minProbes),
    min_probes: Math.min(minProbes, Math.max(maxProbes, minProbes)),
    force_probe_on_bad:
      typeof configured?.force_probe_on_bad === "boolean"
        ? configured.force_probe_on_bad
        : fallback.force_probe_on_bad,
    probe_priority: normalizeProbePriority(configured?.probe_priority, fallback.probe_priority),
    stop_conditions: normalizeProbeStopConditions(configured?.stop_conditions, fallback.stop_conditions),
    allow_followup_expansion:
      typeof configured?.allow_followup_expansion === "boolean"
        ? configured.allow_followup_expansion
        : fallback.allow_followup_expansion,
    strict_topic_lock:
      typeof configured?.strict_topic_lock === "boolean"
        ? configured.strict_topic_lock
        : fallback.strict_topic_lock
  };
}

function resolveMetaContextType(
  question: Question,
  contextType?: QuestionMetaContextType
): "survey" | "interview" | "free_comment" | "rant" | "diary" {
  if (question.question_role === "free_comment" || question.question_code === "__free_comment__") {
    return "free_comment";
  }

  if (contextType === "free_comment" || contextType === "rant" || contextType === "diary") {
    return contextType;
  }

  if (contextType === "survey" || contextType === "survey_with_interview_probe") {
    return "survey";
  }

  return "interview";
}

function defaultMetaByContext(
  question: Question,
  contextType?: QuestionMetaContextType
): NormalizedQuestionMeta {
  switch (resolveMetaContextType(question, contextType)) {
    case "survey":
      return defaultSurveyMeta(question);
    case "free_comment":
      return defaultFreeCommentMeta();
    case "rant":
      return defaultRantMeta();
    case "diary":
      return defaultDiaryMeta();
    default:
      return defaultInterviewMeta(question);
  }
}

function normalizeProjectStateText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeProjectStateSlots(value: unknown): QuestionExpectedSlot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedSlots: Array<QuestionExpectedSlot | null> = value.map((slot) => {
      if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
        return null;
      }

      const candidate = slot as Record<string, unknown>;
      const key = typeof candidate.key === "string" ? candidate.key.trim() : "";
      if (!key) {
        return null;
      }

      return {
        key,
        label:
          typeof candidate.label === "string" && candidate.label.trim()
            ? candidate.label.trim()
            : key,
        description:
          typeof candidate.description === "string" && candidate.description.trim()
            ? candidate.description.trim()
            : undefined,
        required: false,
        examples: Array.isArray(candidate.examples)
          ? candidate.examples.map((example) => String(example).trim()).filter(Boolean)
          : []
      } satisfies QuestionExpectedSlot;
    });

  return normalizedSlots.filter((slot): slot is QuestionExpectedSlot => slot !== null);
}

function buildInheritedProjectSlots(projectAiState?: ProjectAIState | null): QuestionExpectedSlot[] {
  if (!projectAiState) {
    return [];
  }

  const requiredSlots = normalizeProjectStateSlots(projectAiState.required_slots);
  return requiredSlots.concat(
    normalizeProjectStateSlots(projectAiState.optional_slots).filter(
      (slot) => !requiredSlots.some((requiredSlot) => requiredSlot.key === slot.key)
    )
  );
}

function applyProjectStateProbeDefaults(
  fallback: NormalizedProbeConfig,
  projectAiState?: ProjectAIState | null
): NormalizedProbeConfig {
  const probePolicy =
    projectAiState?.probe_policy && typeof projectAiState.probe_policy === "object"
      ? projectAiState.probe_policy
      : null;

  return {
    ...fallback,
    max_probes:
      typeof probePolicy?.default_max_probes === "number"
        ? Math.max(0, Math.round(probePolicy.default_max_probes))
        : fallback.max_probes,
    force_probe_on_bad:
      typeof probePolicy?.force_probe_on_bad === "boolean"
        ? probePolicy.force_probe_on_bad
        : fallback.force_probe_on_bad,
    allow_followup_expansion:
      typeof probePolicy?.allow_followup_expansion === "boolean"
        ? probePolicy.allow_followup_expansion
        : fallback.allow_followup_expansion,
    strict_topic_lock:
      typeof probePolicy?.strict_topic_lock === "boolean"
        ? probePolicy.strict_topic_lock
        : fallback.strict_topic_lock
  };
}

function resolveSlotSource(
  question: Question,
  projectAiState?: ProjectAIState | null
): AnalysisConfigSource {
  const configured = question.question_config?.meta ?? {};
  const hasQuestionSlots =
    (Array.isArray(configured.expected_slots) && configured.expected_slots.length > 0) ||
    (Array.isArray(configured.required_slots) && configured.required_slots.length > 0);
  if (hasQuestionSlots) {
    return "question.question_config.meta";
  }

  if (question.question_type === "text" && buildInheritedProjectSlots(projectAiState).length > 0) {
    return "project.ai_state_json";
  }

  return "default";
}

function resolveProbeSettingSource(
  question: Question,
  setting: "max_probes" | "strict_topic_lock",
  projectAiState?: ProjectAIState | null
): AnalysisConfigSource {
  const configured = question.question_config?.meta?.probe_config;
  if (setting === "max_probes" && typeof configured?.max_probes === "number") {
    return "question.question_config.meta";
  }
  if (setting === "strict_topic_lock" && typeof configured?.strict_topic_lock === "boolean") {
    return "question.question_config.meta";
  }

  const probePolicy =
    projectAiState?.probe_policy && typeof projectAiState.probe_policy === "object"
      ? projectAiState.probe_policy
      : null;
  if (setting === "max_probes" && typeof probePolicy?.default_max_probes === "number") {
    return "project.ai_state_json";
  }
  if (setting === "strict_topic_lock" && typeof probePolicy?.strict_topic_lock === "boolean") {
    return "project.ai_state_json";
  }

  return "default";
}

export function normalizeQuestionMeta(
  question: Question,
  contextType?: QuestionMetaContextType,
  options: NormalizeQuestionMetaOptions = {}
): NormalizedQuestionMeta {
  const configured = question.question_config?.meta ?? {};
  const base = defaultMetaByContext(question, contextType);
  const configuredExpectedSlots = (configured.expected_slots ?? [])
    .map(normalizeExpectedSlot)
    .filter((slot): slot is QuestionExpectedSlot => Boolean(slot));
  const inheritedProjectSlots =
    question.question_type === "text" ? buildInheritedProjectSlots(options.projectAiState) : [];
  const expectedSlots =
    configuredExpectedSlots.length > 0
      ? configuredExpectedSlots.concat(
          base.expected_slots.filter(
            (slot) => !configuredExpectedSlots.some((configuredSlot) => configuredSlot.key === slot.key)
          )
        )
      : inheritedProjectSlots.length > 0
        ? inheritedProjectSlots
        : base.expected_slots;
  const projectBackedProbeConfig = applyProjectStateProbeDefaults(base.probe_config, options.projectAiState);
  const requiredSlots = Array.from(
    new Set([
      ...normalizeSlotKeyList(configured.required_slots),
      ...(configured.required_slots?.length ? [] : getRequiredSlotKeys({ expected_slots: expectedSlots, required_slots: base.required_slots }))
    ])
  );
  const skippableIfSlotsPresent = Array.from(
    new Set([
      ...normalizeSlotKeyList(configured.skippable_if_slots_present),
      ...(configured.skippable_if_slots_present?.length
        ? []
        : getSkippableSlotKeys({
            expected_slots: expectedSlots,
            required_slots: requiredSlots,
            skippable_if_slots_present: base.skippable_if_slots_present
          }))
    ])
  );

  return {
    research_goal:
      configured.research_goal?.trim() ||
      normalizeProjectStateText(options.projectAiState?.project_goal) ||
      base.research_goal,
    question_goal:
      configured.question_goal?.trim() ||
      normalizeProjectStateText(options.projectAiState?.user_understanding_goal) ||
      base.question_goal,
    probe_goal: configured.probe_goal?.trim() || base.probe_goal,
    expected_slots: expectedSlots,
    required_slots: requiredSlots,
    skippable_if_slots_present: skippableIfSlotsPresent,
    can_prefill_future_slots:
      typeof configured.can_prefill_future_slots === "boolean"
        ? configured.can_prefill_future_slots
        : base.can_prefill_future_slots,
    skip_forbidden_on_bad_answer:
      typeof configured.skip_forbidden_on_bad_answer === "boolean"
        ? configured.skip_forbidden_on_bad_answer
        : base.skip_forbidden_on_bad_answer,
    bad_answer_patterns: (configured.bad_answer_patterns ?? [])
      .map(normalizeBadAnswerPattern)
      .filter((pattern): pattern is QuestionBadAnswerPattern => Boolean(pattern))
      .concat(base.bad_answer_patterns.filter(() => !configured.bad_answer_patterns?.length)),
    probe_config: normalizeProbeConfig(configured.probe_config, projectBackedProbeConfig),
    completion_conditions: (configured.completion_conditions ?? [])
      .map(normalizeCompletionCondition)
      .filter((condition): condition is QuestionCompletionCondition => Boolean(condition))
      .concat(base.completion_conditions.filter(() => !configured.completion_conditions?.length)),
    render_style: {
      mode: configured.render_style?.mode ?? base.render_style.mode ?? "default",
      lead_in: configured.render_style?.lead_in?.trim(),
      connect_from_previous_answer:
        configured.render_style?.connect_from_previous_answer ??
        base.render_style.connect_from_previous_answer ??
        true,
      avoid_question_number:
        configured.render_style?.avoid_question_number ?? base.render_style.avoid_question_number ?? true,
      preserve_options:
        configured.render_style?.preserve_options ?? base.render_style.preserve_options ?? false
    }
  };
}

export function resolveAnswerAnalysisContext(input: {
  project: Pick<
    Project,
    | "name"
    | "objective"
    | "research_mode"
    | "primary_objectives"
    | "secondary_objectives"
    | "ai_state_json"
    | "ai_state_template_key"
  >;
  question: Question;
  nextQuestion?: Question | null;
  contextType?: QuestionMetaContextType;
}): ResolvedAnswerAnalysisContext {
  const projectAiState = getProjectAIState(input.project);
  const currentContextType = input.contextType ?? resolveMetaContextType(input.question, input.project.research_mode);
  const questionMeta = normalizeQuestionMeta(input.question, currentContextType, {
    projectAiState: input.project.ai_state_json
  });
  const nextContextType = input.nextQuestion
    ? resolveMetaContextType(input.nextQuestion, input.project.research_mode)
    : undefined;
  const nextQuestionMeta = input.nextQuestion
    ? normalizeQuestionMeta(input.nextQuestion, nextContextType, {
        projectAiState: input.project.ai_state_json
      })
    : null;
  const requiredKeys = new Set(getRequiredSlotKeys(questionMeta));
  const requiredSlots = questionMeta.expected_slots.filter((slot) => requiredKeys.has(slot.key));
  const optionalSlots = questionMeta.expected_slots.filter((slot) => !requiredKeys.has(slot.key));
  const nextRequiredKeys = nextQuestionMeta ? new Set(getRequiredSlotKeys(nextQuestionMeta)) : new Set<string>();

  return {
    project_goal: projectAiState.project_goal || questionMeta.research_goal,
    user_understanding_goal: projectAiState.user_understanding_goal || questionMeta.question_goal,
    required_slots: requiredSlots,
    optional_slots: optionalSlots,
    next_question_required_slots: nextQuestionMeta
      ? nextQuestionMeta.expected_slots.filter((slot) => nextRequiredKeys.has(slot.key))
      : [],
    project_required_slot_keys:
      projectAiState.completion_rule.required_slots_needed.length > 0
        ? projectAiState.completion_rule.required_slots_needed
        : projectAiState.required_slots.map((slot) => slot.key),
    max_probes: questionMeta.probe_config.max_probes,
    strict_topic_lock: questionMeta.probe_config.strict_topic_lock,
    sources: {
      required_slots: resolveSlotSource(input.question, input.project.ai_state_json),
      optional_slots: resolveSlotSource(input.question, input.project.ai_state_json),
      max_probes: resolveProbeSettingSource(input.question, "max_probes", input.project.ai_state_json),
      strict_topic_lock: resolveProbeSettingSource(
        input.question,
        "strict_topic_lock",
        input.project.ai_state_json
      )
    }
  };
}

export function isTextQuestion(question: Question): boolean {
  return question.question_type === "text";
}

export function normalizeFreeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export function isAbstractAnswer(text: string): boolean {
  const normalized = normalizeFreeText(text);
  return normalized.length <= 16 || ABSTRACT_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

function isBadAnswerPatternMatched(text: string, pattern: QuestionBadAnswerPattern): boolean {
  switch (pattern.type) {
    case "contains":
      return text.includes(String(pattern.value));
    case "exact":
      return text === String(pattern.value);
    case "regex":
      try {
        return new RegExp(String(pattern.value), "u").test(text);
      } catch {
        return false;
      }
    case "max_length":
      return text.length <= Number(pattern.value);
    default:
      return false;
  }
}

function getMatchedBadAnswerPatternEntries(
  text: string,
  patterns: QuestionBadAnswerPattern[]
): QuestionBadAnswerPattern[] {
  const normalized = normalizeFreeText(text);
  return patterns.filter((pattern) => isBadAnswerPatternMatched(normalized, pattern));
}

function hasMatchedBadAnswerNote(
  text: string,
  patterns: QuestionBadAnswerPattern[],
  note: (typeof BAD_ANSWER_NOTE)[keyof typeof BAD_ANSWER_NOTE]
): boolean {
  return getMatchedBadAnswerPatternEntries(text, patterns).some((pattern) => pattern.note === note);
}

function countFilledSlots(slots: StructuredAnswerSlotValue[] | null | undefined): number {
  return (slots ?? []).filter((slot) => slot.value?.trim()).length;
}

function calculateQualityScore(input: {
  question: Question;
  answerText: string;
  extractedSlots?: StructuredAnswerSlotValue[] | null;
  contextType?: QuestionMetaContextType;
  projectAiState?: ProjectAIState | null;
}): number {
  const meta = normalizeQuestionMeta(input.question, input.contextType, {
    projectAiState: input.projectAiState
  });
  const text = normalizeFreeText(input.answerText);
  const extractedSlots = input.extractedSlots ?? [];
  const requiredSlots = meta.expected_slots.filter((slot) => slot.required !== false);
  const totalSlots = requiredSlots.length;
  const filledSlotCount =
    totalSlots > 0
      ? requiredSlots.filter((slot) =>
          extractedSlots.some((extractedSlot) => extractedSlot.key === slot.key && extractedSlot.value?.trim())
        ).length
      : 0;
  const slotCoverage =
    totalSlots === 0
      ? text.length >= 24
        ? 100
        : text.length >= 12
          ? 75
          : text.length >= 6
            ? 50
            : 20
      : Math.round((filledSlotCount / totalSlots) * 100);
  const lengthScore =
    text.length >= 60 ? 100 : text.length >= 30 ? 85 : text.length >= 16 ? 70 : text.length >= 8 ? 50 : text ? 30 : 0;
  let qualityScore = Math.round(slotCoverage * 0.6 + lengthScore * 0.4);

  if (hasMatchedBadAnswerNote(text, meta.bad_answer_patterns, BAD_ANSWER_NOTE.NO_CONTENT)) {
    qualityScore = Math.min(qualityScore, 15);
  }
  if (hasMatchedBadAnswerNote(text, meta.bad_answer_patterns, BAD_ANSWER_NOTE.ABSTRACT)) {
    qualityScore = Math.min(qualityScore, 55);
  }
  if (
    hasMatchedBadAnswerNote(text, meta.bad_answer_patterns, BAD_ANSWER_NOTE.LOW_SPECIFICITY) ||
    text.length <= 12
  ) {
    qualityScore = Math.min(qualityScore, 50);
  }

  return Math.max(0, Math.min(100, qualityScore));
}

export function matchBadAnswerPatterns(text: string, patterns: QuestionBadAnswerPattern[]): string[] {
  return getMatchedBadAnswerPatternEntries(text, patterns).map((pattern) =>
    pattern.note ?? (pattern.type === "max_length" ? `max_length:${pattern.value}` : String(pattern.value))
  );
}

export function fillComparablePayload(
  slots: StructuredAnswerSlotValue[]
): Record<string, string | string[] | null> {
  return slots.reduce<Record<string, string | string[] | null>>((accumulator, slot) => {
    accumulator[slot.key] = slot.value ?? null;
    return accumulator;
  }, {});
}

export function buildHeuristicStructuredPayload(input: {
  question: Question;
  answerText: string;
  source: string;
  reason?: string | null;
  probeType?: StructuredProbeType | null;
  contextType?: QuestionMetaContextType;
  projectAiState?: ProjectAIState | null;
}): StructuredAnswerPayload {
  const meta = normalizeQuestionMeta(input.question, input.contextType, {
    projectAiState: input.projectAiState
  });
  const normalized = normalizeFreeText(input.answerText);
  const extractedSlots = meta.expected_slots.map<StructuredAnswerSlotValue>((slot, index) => ({
    key: slot.key,
    value: index === 0 && normalized ? normalized : null,
    confidence: index === 0 && normalized ? 0.2 : null,
    evidence: index === 0 && normalized ? normalized : null
  }));
  const completion = evaluateCompletion({
    question: input.question,
    answerText: normalized,
    extractedSlots,
    contextType: input.contextType,
    projectAiState: input.projectAiState
  });

  return {
    value: normalized,
    source: input.source,
    reason: input.reason ?? null,
    probe_type: input.probeType ?? null,
    render_style: meta.render_style.mode ?? null,
    structured_summary: normalized || null,
    extracted_slots: extractedSlots,
    completion,
    bad_pattern_matches: matchBadAnswerPatterns(normalized, meta.bad_answer_patterns),
    comparable_payload: fillComparablePayload(extractedSlots),
    metadata_version: "v2"
  };
}

export function evaluateCompletion(input: {
  question: Question;
  answerText: string;
  extractedSlots?: StructuredAnswerSlotValue[] | null;
  contextType?: QuestionMetaContextType;
  qualityScore?: number | null;
  projectAiState?: ProjectAIState | null;
}): StructuredAnswerCompletion {
  const meta = normalizeQuestionMeta(input.question, input.contextType, {
    projectAiState: input.projectAiState
  });
  const text = normalizeFreeText(input.answerText);
  const extractedSlots = input.extractedSlots ?? [];
  const requiredSlots = getRequiredSlotKeys(meta);
  const missingSlots = requiredSlots
    .filter((slot) => {
      const resolved = extractedSlots.find((item) => item.key === slot)?.value?.trim();
      return !resolved;
    });
  const badPatterns = matchBadAnswerPatterns(text, meta.bad_answer_patterns);
  const qualityScore =
    typeof input.qualityScore === "number" && Number.isFinite(input.qualityScore)
      ? Math.max(0, Math.min(100, Math.round(input.qualityScore)))
        : calculateQualityScore({
          question: input.question,
          answerText: text,
          extractedSlots,
          contextType: input.contextType,
          projectAiState: input.projectAiState
        });
  const reasons = new Set<string>();

  if (missingSlots.length > 0) {
    reasons.add("expected_slots");
  }
  if (badPatterns.length > 0) {
    reasons.add("bad_patterns");
  }
  if (qualityScore < DEFAULT_COMPLETION_QUALITY_THRESHOLD) {
    reasons.add("low_quality");
  }

  for (const condition of meta.completion_conditions) {
    if (condition.type === "min_length" && text.length < Number(condition.value ?? 0)) {
      reasons.add("min_length");
    }
    if (condition.type === "required_slots" && missingSlots.length > 0) {
      reasons.add("required_slots");
    }
    if (condition.type === "any_slot_filled" && extractedSlots.every((slot) => !slot.value?.trim())) {
      reasons.add("any_slot_filled");
    }
    if (condition.type === "no_bad_patterns" && badPatterns.length > 0) {
      reasons.add("bad_patterns");
    }
  }

  return {
    is_complete:
      missingSlots.length === 0 &&
      badPatterns.length === 0 &&
      qualityScore >= DEFAULT_COMPLETION_QUALITY_THRESHOLD &&
      reasons.size === 0,
    missing_slots: missingSlots,
    reasons: Array.from(reasons),
    quality_score: qualityScore
  };
}

export function assessProbeNeed(input: {
  question: Question;
  answerText: string;
  extractedSlots?: StructuredAnswerSlotValue[] | null;
  currentProbeCountForAnswer?: number;
  contextType?: QuestionMetaContextType;
  projectAiState?: ProjectAIState | null;
}): ProbeAssessment {
  const meta = normalizeQuestionMeta(input.question, input.contextType, {
    projectAiState: input.projectAiState
  });
  const text = normalizeFreeText(input.answerText);
  const completion = evaluateCompletion({
    question: input.question,
    answerText: text,
    extractedSlots: input.extractedSlots,
    contextType: input.contextType,
    projectAiState: input.projectAiState
  });
  const matchedBadPatterns = matchBadAnswerPatterns(text, meta.bad_answer_patterns);
  const isShort = text.length <= 12;
  const isBadAnswer = hasMatchedBadAnswerNote(text, meta.bad_answer_patterns, BAD_ANSWER_NOTE.NO_CONTENT);
  const isLowSpecificity =
    hasMatchedBadAnswerNote(text, meta.bad_answer_patterns, BAD_ANSWER_NOTE.LOW_SPECIFICITY) || isShort;
  const currentProbeCount = input.currentProbeCountForAnswer ?? 0;
  const matchedNoContent =
    meta.probe_config.force_probe_on_bad &&
    isBadAnswer;
  const matchedAbstractPattern =
    meta.probe_config.force_probe_on_bad &&
    hasMatchedBadAnswerNote(text, meta.bad_answer_patterns, BAD_ANSWER_NOTE.ABSTRACT);
  const matchedLowSpecificityPattern =
    meta.probe_config.force_probe_on_bad &&
    isLowSpecificity;
  const abstract = !matchedNoContent && !matchedAbstractPattern && isAbstractAnswer(text);

  if (currentProbeCount >= meta.probe_config.max_probes) {
    return {
      shouldProbe: false,
      probeType: null,
      missingSlots: completion.missing_slots,
      matchedBadPatterns,
      isShort,
      isAbstract: abstract,
      isBadAnswer,
      isLowSpecificity
    };
  }

  if (matchedNoContent) {
    return {
      shouldProbe: true,
      probeType: "clarify",
      missingSlots: completion.missing_slots,
      matchedBadPatterns,
      isShort,
      isAbstract: abstract,
      isBadAnswer,
      isLowSpecificity
    };
  }

  if (completion.missing_slots.length > 0) {
    return {
      shouldProbe: true,
      probeType: "missing_slot",
      missingSlots: completion.missing_slots,
      matchedBadPatterns,
      isShort,
      isAbstract: abstract,
      isBadAnswer,
      isLowSpecificity
    };
  }

  if (matchedAbstractPattern || matchedLowSpecificityPattern || isShort) {
    return {
      shouldProbe: true,
      probeType: "concretize",
      missingSlots: completion.missing_slots,
      matchedBadPatterns,
      isShort,
      isAbstract: abstract,
      isBadAnswer,
      isLowSpecificity
    };
  }

  if (abstract) {
    return {
      shouldProbe: true,
      probeType: "clarify",
      missingSlots: completion.missing_slots,
      matchedBadPatterns,
      isShort,
      isAbstract: abstract,
      isBadAnswer,
      isLowSpecificity
    };
  }

  if (currentProbeCount < meta.probe_config.min_probes) {
    return {
      shouldProbe: true,
      probeType: "concretize",
      missingSlots: completion.missing_slots,
      matchedBadPatterns,
      isShort,
      isAbstract: abstract,
      isBadAnswer,
      isLowSpecificity
    };
  }

  return {
    shouldProbe: false,
    probeType: null,
    missingSlots: completion.missing_slots,
    matchedBadPatterns,
    isShort,
    isAbstract: abstract,
    isBadAnswer,
    isLowSpecificity
  };
}

export function evaluateQuestionSlotProgress(input: {
  question: Question;
  slotMap: Record<string, string | null | undefined>;
  answerText: string;
  contextType?: QuestionMetaContextType;
  projectAiState?: ProjectAIState | null;
}): QuestionSlotProgress {
  const meta = normalizeQuestionMeta(input.question, input.contextType, {
    projectAiState: input.projectAiState
  });
  const requiredSlots = getRequiredSlotKeys(meta);
  const skippableSlots = getSkippableSlotKeys(meta);
  const matchedBadPatterns = matchBadAnswerPatterns(input.answerText, meta.bad_answer_patterns);
  const isBadAnswer = hasMatchedBadAnswerNote(
    input.answerText,
    meta.bad_answer_patterns,
    BAD_ANSWER_NOTE.NO_CONTENT
  );
  const isLowSpecificity = hasMatchedBadAnswerNote(
    input.answerText,
    meta.bad_answer_patterns,
    BAD_ANSWER_NOTE.LOW_SPECIFICITY
  );
  const isAbstract =
    hasMatchedBadAnswerNote(input.answerText, meta.bad_answer_patterns, BAD_ANSWER_NOTE.ABSTRACT) ||
    isAbstractAnswer(input.answerText);
  const qualityScore = calculateQualityScore({
    question: input.question,
    answerText: input.answerText,
    extractedSlots: Object.entries(input.slotMap).map(([key, value]) => ({
      key,
      value: value ?? null
    })),
    contextType: input.contextType,
    projectAiState: input.projectAiState
  });

  return {
    requiredSlots,
    missingRequiredSlots: requiredSlots.filter((key) => !hasFilledSlot(input.slotMap, key)),
    skippableSlots,
    isCurrentQuestionSatisfied: requiredSlots.every((key) => hasFilledSlot(input.slotMap, key)),
    areSkippableSlotsSatisfied:
      skippableSlots.length > 0 && skippableSlots.every((key) => hasFilledSlot(input.slotMap, key)),
    matchedBadPatterns,
    isBadAnswer,
    isAbstract,
    isLowSpecificity,
    qualityScore
  };
}

export function buildInterviewQuestionFallback(input: {
  question: Question;
  previousAnswerText?: string | null;
  contextType?: QuestionMetaContextType;
  projectAiState?: ProjectAIState | null;
}): string {
  const meta = normalizeQuestionMeta(input.question, input.contextType, {
    projectAiState: input.projectAiState
  });
  const lead =
    meta.render_style.lead_in?.trim() ||
    (meta.render_style.connect_from_previous_answer && input.previousAnswerText?.trim()
      ? "\u3042\u308a\u304c\u3068\u3046\u3054\u3056\u3044\u307e\u3059\u3002\u3082\u3046\u5c11\u3057\u8a73\u3057\u304f\u6559\u3048\u3066\u304f\u3060\u3055\u3044\u3002"
      : "");
  const base = input.question.question_text.trim();

  if (input.question.question_type !== "text" || meta.render_style.mode !== "interview_natural") {
    return [lead, base].filter(Boolean).join("\n");
  }

  return [lead, base].filter(Boolean).join(" ");
}
