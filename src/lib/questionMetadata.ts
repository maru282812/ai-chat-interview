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
  UserPostType,
  QuestionExtractionSchema
} from "../types/domain";
import { getProjectAIState } from "./projectAiState";

export type QuestionMetaContextType =
  | ResearchMode
  | "survey"
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

const DEFAULT_PROBE_PRIORITY: QuestionProbePriority[] = [
  "missing",
  "bad_pattern",
  "low_specificity"
];

const DEFAULT_STOP_CONDITIONS: QuestionProbeStopCondition[] = [
  "sufficient_slots",
  "high_quality",
  "no_new_information",
  "repetition_risk"
];

const DEFAULT_COMPLETION_QUALITY_THRESHOLD = 60;

const ABSTRACT_KEYWORDS = [
  "なんとなく",
  "普通",
  "いろいろ",
  "漠然",
  "特に理由はない",
  "まあまあ",
  "別に",
  "特には",
  "特にない",
  "よくわからない"
];

export interface QuestionAuthoringMetaInput {
  questionGoal: string;
  extractionItemLabels?: string[];
  maxProbes?: number | null;
  existingMeta?: QuestionMeta | null;
}

function normalizeAuthoringLabel(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function dedupeAuthoringLabels(values: unknown[]): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeAuthoringLabel(value);
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    labels.push(normalized);
  }

  return labels;
}

function toAsciiSlotKey(label: string): string {
  return label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function buildAuthoringSlotKey(label: string, index: number, prefix = "slot"): string {
  const asciiKey = toAsciiSlotKey(label);
  return asciiKey || `${prefix}_${index + 1}`;
}

function deriveGoalLabel(questionGoal: string): string {
  const normalized = questionGoal
    .trim()
    .replace(/について知りたい$/u, "")
    .replace(/について把握したい$/u, "")
    .replace(/について理解したい$/u, "")
    .replace(/を知りたい$/u, "")
    .replace(/を把握したい$/u, "")
    .replace(/を理解したい$/u, "")
    .replace(/が知りたい$/u, "")
    .replace(/か知りたい$/u, "")
    .trim();

  return normalized || "知りたいこと";
}

export function inferRequiredSlotKeysFromGoal(
  questionGoal: string,
  expectedSlots: QuestionExpectedSlot[]
): string[] {
  if (expectedSlots.length === 0) {
    return [];
  }

  const goal = questionGoal.trim();
  const goalLabel = deriveGoalLabel(goal);
  const matched = expectedSlots.filter((slot) => {
    const label = slot.label?.trim() || slot.key;
    return Boolean(label) && (goal.includes(label) || goalLabel.includes(label) || label.includes(goalLabel));
  });

  if (matched.length > 0) {
    return matched.map((slot) => slot.key);
  }

  return [expectedSlots[0]?.key ?? ""].filter(Boolean);
}

export function buildExpectedSlotsFromAuthoringInput(input: {
  questionGoal: string;
  extractionItemLabels?: string[];
}): QuestionExpectedSlot[] {
  const labels = dedupeAuthoringLabels(input.extractionItemLabels ?? []);
  const slots =
    labels.length > 0
      ? labels.map((label, index) => ({
          key: buildAuthoringSlotKey(label, index),
          label,
          description: `${label}を回答から整理する`,
          required: false,
          examples: []
        }))
      : input.questionGoal.trim()
        ? [
            {
              key: buildAuthoringSlotKey(deriveGoalLabel(input.questionGoal), 0, "goal"),
              label: deriveGoalLabel(input.questionGoal),
              description: input.questionGoal.trim(),
              required: true,
              examples: []
            }
          ]
        : [];

  const requiredKeys = new Set(inferRequiredSlotKeysFromGoal(input.questionGoal, slots));
  return slots.map((slot) => ({
    ...slot,
    required: requiredKeys.has(slot.key)
  }));
}

export function buildExtractionSchemaFromExpectedSlots(
  expectedSlots: QuestionExpectedSlot[]
): QuestionExtractionSchema {
  return {
    version: "v1",
    entity_name: "question_answer",
    entity_label: "質問回答",
    fields: expectedSlots.map((slot) => ({
      key: slot.key,
      label: slot.label ?? slot.key,
      description: slot.description,
      type: "string",
      required: slot.required ?? false,
      aliases: [],
      options: []
    }))
  };
}

export function buildQuestionMetaFromAuthoringInput(input: QuestionAuthoringMetaInput): QuestionMeta {
  const existingMeta = input.existingMeta ?? {};
  const questionGoal = input.questionGoal.trim();
  const expectedSlots = buildExpectedSlotsFromAuthoringInput({
    questionGoal,
    extractionItemLabels: input.extractionItemLabels ?? []
  });
  const requiredSlots = expectedSlots.filter((slot) => slot.required !== false).map((slot) => slot.key);
  const configuredMaxProbes = Number(input.maxProbes);
  const maxProbes =
    Number.isFinite(configuredMaxProbes) && configuredMaxProbes >= 0
      ? Math.round(configuredMaxProbes)
      : typeof existingMeta.probe_config?.max_probes === "number"
        ? existingMeta.probe_config.max_probes
        : 1;

  return {
    ...existingMeta,
    question_goal: questionGoal,
    expected_slots: expectedSlots,
    required_slots: requiredSlots,
    skippable_if_slots_present: requiredSlots,
    can_prefill_future_slots: existingMeta.can_prefill_future_slots ?? true,
    skip_forbidden_on_bad_answer: existingMeta.skip_forbidden_on_bad_answer ?? true,
    probe_config: {
      ...(existingMeta.probe_config ?? {}),
      max_probes: maxProbes,
      force_probe_on_bad: existingMeta.probe_config?.force_probe_on_bad ?? true,
      strict_topic_lock: existingMeta.probe_config?.strict_topic_lock ?? true
    },
    completion_conditions:
      Array.isArray(existingMeta.completion_conditions) && existingMeta.completion_conditions.length > 0
        ? existingMeta.completion_conditions
        : requiredSlots.length > 0
          ? [{ type: "required_slots" }, { type: "no_bad_patterns" }]
          : [{ type: "no_bad_patterns" }]
  };
}

function createDefaultBadAnswerPatterns(maxLength = 12): QuestionBadAnswerPattern[] {
  return [
    { type: "exact", value: "特になし", note: BAD_ANSWER_NOTE.NO_CONTENT },
    { type: "exact", value: "特にない", note: BAD_ANSWER_NOTE.NO_CONTENT },
    { type: "exact", value: "ない", note: BAD_ANSWER_NOTE.NO_CONTENT },
    { type: "exact", value: "わからない", note: BAD_ANSWER_NOTE.NO_CONTENT },
    { type: "exact", value: "思いつかない", note: BAD_ANSWER_NOTE.NO_CONTENT },
    { type: "exact", value: "覚えていない", note: BAD_ANSWER_NOTE.NO_CONTENT },

    { type: "contains", value: "なんとなく", note: BAD_ANSWER_NOTE.ABSTRACT },
    { type: "contains", value: "普通", note: BAD_ANSWER_NOTE.ABSTRACT },
    { type: "contains", value: "いろいろ", note: BAD_ANSWER_NOTE.ABSTRACT },
    { type: "contains", value: "まあまあ", note: BAD_ANSWER_NOTE.ABSTRACT },

    { type: "max_length", value: maxLength, note: BAD_ANSWER_NOTE.LOW_SPECIFICITY }
  ];
}

function createProbeConfig(
  input: Pick<
    NormalizedProbeConfig,
    "max_probes" | "min_probes" | "allow_followup_expansion" | "strict_topic_lock"
  > & {
    force_probe_on_bad?: boolean;
    probe_priority?: QuestionProbePriority[];
    stop_conditions?: QuestionProbeStopCondition[];
  }
): NormalizedProbeConfig {
  const maxProbes = Math.max(0, Math.round(input.max_probes));
  const minProbes = Math.max(0, Math.round(input.min_probes));

  return {
    max_probes: Math.max(maxProbes, minProbes),
    min_probes: Math.min(minProbes, Math.max(maxProbes, minProbes)),
    force_probe_on_bad: input.force_probe_on_bad ?? true,
    probe_priority:
      Array.isArray(input.probe_priority) && input.probe_priority.length > 0
        ? [...input.probe_priority]
        : [...DEFAULT_PROBE_PRIORITY],
    stop_conditions:
      Array.isArray(input.stop_conditions) && input.stop_conditions.length > 0
        ? [...input.stop_conditions]
        : [...DEFAULT_STOP_CONDITIONS],
    allow_followup_expansion: input.allow_followup_expansion,
    strict_topic_lock: input.strict_topic_lock
  };
}

function defaultInterviewMeta(question: Question): NormalizedQuestionMeta {
  const isText = question.question_type === "text";

  return {
    research_goal: null,
    question_goal: null,
    probe_goal: "比較や理解に必要な不足情報を1点だけ自然に補う。",
    expected_slots: [],
    required_slots: [],
    skippable_if_slots_present: [],
    can_prefill_future_slots: true,
    skip_forbidden_on_bad_answer: true,
    bad_answer_patterns: isText ? createDefaultBadAnswerPatterns(12) : [],
    probe_config: createProbeConfig({
      max_probes: isText ? 1 : 0,
      min_probes: 0,
      force_probe_on_bad: isText,
      allow_followup_expansion: false,
      strict_topic_lock: true
    }),
    completion_conditions: [{ type: "no_bad_patterns" }],
    render_style: {
      mode: isText ? "interview_natural" : "default",
      connect_from_previous_answer: true,
      avoid_question_number: true,
      preserve_options: !isText
    }
  };
}

function defaultSurveyMeta(question: Question): NormalizedQuestionMeta {
  const isText = question.question_type === "text";

  return {
    research_goal: null,
    question_goal: null,
    probe_goal: "必要最小限の補足だけを回収し、回答負荷を増やしすぎない。",
    expected_slots: [],
    required_slots: [],
    skippable_if_slots_present: [],
    can_prefill_future_slots: true,
    skip_forbidden_on_bad_answer: true,
    bad_answer_patterns: isText ? createDefaultBadAnswerPatterns(10) : [],
    probe_config: createProbeConfig({
      max_probes: isText ? 1 : 0,
      min_probes: 0,
      force_probe_on_bad: isText,
      allow_followup_expansion: false,
      strict_topic_lock: true
    }),
    completion_conditions: [{ type: "no_bad_patterns" }],
    render_style: {
      mode: "default",
      connect_from_previous_answer: false,
      avoid_question_number: false,
      preserve_options: !isText
    }
  };
}

function defaultFreeCommentMeta(): NormalizedQuestionMeta {
  return {
    research_goal: "セッション末尾の任意コメントを受け取り、無理に構造化しない。",
    question_goal: "自由に補足したい内容をそのまま受け取る。",
    probe_goal: "既定では深掘りしない。明示設定があるときだけ補足を聞く。",
    expected_slots: [],
    required_slots: [],
    skippable_if_slots_present: [],
    can_prefill_future_slots: false,
    skip_forbidden_on_bad_answer: false,
    bad_answer_patterns: [],
    probe_config: createProbeConfig({
      max_probes: 0,
      min_probes: 0,
      force_probe_on_bad: false,
      allow_followup_expansion: false,
      strict_topic_lock: true
    }),
    completion_conditions: [],
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
    research_goal: "日々の出来事と感情を、あとから比較しやすい粒度で蓄積する。",
    question_goal: "出来事・感情・理由を最低限おさえて記録する。",
    probe_goal: "浅い記述なら、背景や理由を1段だけ具体化する。",
    expected_slots: [
      { key: "event", label: "出来事", description: "何があったか", required: true, examples: [] },
      { key: "emotion", label: "感情", description: "どう感じたか", required: true, examples: [] },
      { key: "reason", label: "理由", description: "そう感じた背景や理由", required: true, examples: [] },
      { key: "pain_point", label: "不満点", description: "困ったことや嫌だったこと", required: false, examples: [] },
      { key: "desired_state", label: "理想状態", description: "本当はどうなってほしいか", required: false, examples: [] }
    ],
    required_slots: ["event", "emotion", "reason"],
    skippable_if_slots_present: ["event", "emotion", "reason"],
    can_prefill_future_slots: true,
    skip_forbidden_on_bad_answer: true,
    bad_answer_patterns: createDefaultBadAnswerPatterns(14),
    probe_config: createProbeConfig({
      max_probes: 1,
      min_probes: 0,
      force_probe_on_bad: true,
      allow_followup_expansion: true,
      strict_topic_lock: true
    }),
    completion_conditions: [{ type: "required_slots" }, { type: "no_bad_patterns" }]
  };
}

function defaultRantMeta(): NormalizedQuestionMeta {
  return {
    ...defaultFreeCommentMeta(),
    research_goal: "不満や怒りの内容を、原因と影響が比較できる形で蓄積する。",
    question_goal: "不満の中身・きっかけ・理由を最低限おさえる。",
    probe_goal: "浅い愚痴なら、発生場面や理由を1段だけ具体化する。",
    expected_slots: [
      { key: "pain_point", label: "不満点", description: "最も不満だったこと", required: true, examples: [] },
      { key: "trigger", label: "きっかけ", description: "その不満が起きた場面や出来事", required: true, examples: [] },
      { key: "reason", label: "理由", description: "そう感じた背景や理由", required: true, examples: [] },
      { key: "impact", label: "影響", description: "困ったことや嫌だった影響", required: false, examples: [] },
      { key: "desired_state", label: "理想状態", description: "本当はどうなってほしいか", required: false, examples: [] }
    ],
    required_slots: ["pain_point", "trigger", "reason"],
    skippable_if_slots_present: ["pain_point", "trigger", "reason"],
    can_prefill_future_slots: true,
    skip_forbidden_on_bad_answer: true,
    bad_answer_patterns: createDefaultBadAnswerPatterns(14),
    probe_config: createProbeConfig({
      max_probes: 1,
      min_probes: 0,
      force_probe_on_bad: true,
      allow_followup_expansion: true,
      strict_topic_lock: true
    }),
    completion_conditions: [{ type: "required_slots" }, { type: "no_bad_patterns" }]
  };
}

function isFreeCommentQuestion(question: Question): boolean {
  return question.question_role === "free_comment" || question.question_code === "__free_comment__";
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
): QuestionMetaContextType | "interview" {
  if (question.question_role === "free_comment" || question.question_code === "__free_comment__") {
    return "free_comment";
  }

  if (contextType === "free_comment" || contextType === "rant" || contextType === "diary") {
    return contextType;
  }

  if (contextType === "survey" || contextType === "survey_interview") {
    return contextType;
  }

  return "interview";
}

function defaultMetaByContext(
  question: Question,
  contextType?: QuestionMetaContextType
): NormalizedQuestionMeta {
  switch (resolveMetaContextType(question, contextType)) {
    case "survey":
    case "survey_interview":
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getExplicitFreeCommentProjectConfig(projectAiState?: ProjectAIState | null): Record<string, unknown> | null {
  if (!isPlainObject(projectAiState)) {
    return null;
  }

  const candidate =
    (isPlainObject((projectAiState as Record<string, unknown>).free_comment_config)
      ? (projectAiState as Record<string, unknown>).free_comment_config
      : null) ??
    (isPlainObject((projectAiState as Record<string, unknown>).free_comment)
      ? (projectAiState as Record<string, unknown>).free_comment
      : null);

  return isPlainObject(candidate) ? candidate : null;
}

function normalizeProjectStateSlots(value: unknown, requiredDefault: boolean): QuestionExpectedSlot[] {
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
      required:
        typeof candidate.required === "boolean" ? candidate.required : requiredDefault,
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

  const requiredSlots = normalizeProjectStateSlots(projectAiState.required_slots, true);
  return requiredSlots.concat(
    normalizeProjectStateSlots(projectAiState.optional_slots, false).filter(
      (slot) => !requiredSlots.some((requiredSlot) => requiredSlot.key === slot.key)
    )
  );
}

function getProjectRequiredSlotKeys(projectAiState?: ProjectAIState | null): string[] {
  if (!projectAiState) {
    return [];
  }

  return normalizeProjectStateSlots(projectAiState.required_slots, true).map((slot) => slot.key);
}

function buildExplicitFreeCommentProjectSlots(projectAiState?: ProjectAIState | null): QuestionExpectedSlot[] {
  const config = getExplicitFreeCommentProjectConfig(projectAiState);
  if (!config) {
    return [];
  }

  const requiredSlots = normalizeProjectStateSlots(config.required_slots, true);
  return requiredSlots.concat(
    normalizeProjectStateSlots(config.optional_slots, false).filter(
      (slot) => !requiredSlots.some((requiredSlot) => requiredSlot.key === slot.key)
    )
  );
}

function getExplicitFreeCommentProjectRequiredSlotKeys(projectAiState?: ProjectAIState | null): string[] {
  const config = getExplicitFreeCommentProjectConfig(projectAiState);
  if (!config) {
    return [];
  }

  return normalizeProjectStateSlots(config.required_slots, true).map((slot) => slot.key);
}

function hasExplicitConfiguredFreeCommentMeta(meta: QuestionMeta): boolean {
  return Boolean(
    (Array.isArray(meta.expected_slots) && meta.expected_slots.length > 0) ||
      (Array.isArray(meta.required_slots) && meta.required_slots.length > 0) ||
      (Array.isArray(meta.bad_answer_patterns) && meta.bad_answer_patterns.length > 0) ||
      (Array.isArray(meta.completion_conditions) && meta.completion_conditions.length > 0) ||
      normalizeProjectStateText(meta.probe_goal) ||
      Object.values(meta.probe_config ?? {}).some((value) => value !== undefined)
  );
}

function hasExplicitFreeCommentProjectContext(projectAiState?: ProjectAIState | null): boolean {
  const config = getExplicitFreeCommentProjectConfig(projectAiState);
  if (!config) {
    return false;
  }

  return Boolean(
    normalizeProjectStateText(config.project_goal) ||
      normalizeProjectStateText(config.research_goal) ||
      normalizeProjectStateText(config.user_understanding_goal) ||
      normalizeProjectStateText(config.question_goal) ||
      normalizeProjectStateText(config.probe_goal) ||
      buildExplicitFreeCommentProjectSlots(projectAiState).length > 0 ||
      isPlainObject(config.probe_policy) ||
      isPlainObject(config.probe_config)
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

function applyExplicitFreeCommentProjectProbeDefaults(
  fallback: NormalizedProbeConfig,
  projectAiState?: ProjectAIState | null
): NormalizedProbeConfig {
  const config = getExplicitFreeCommentProjectConfig(projectAiState);
  const probePolicy =
    (isPlainObject(config?.probe_policy) ? config.probe_policy : null) ??
    (isPlainObject(config?.probe_config) ? config.probe_config : null);

  return {
    ...fallback,
    max_probes:
      typeof probePolicy?.max_probes === "number"
        ? Math.max(0, Math.round(probePolicy.max_probes))
        : typeof probePolicy?.default_max_probes === "number"
          ? Math.max(0, Math.round(probePolicy.default_max_probes))
          : fallback.max_probes,
    min_probes:
      typeof probePolicy?.min_probes === "number"
        ? Math.max(0, Math.round(probePolicy.min_probes))
        : fallback.min_probes,
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

  if (isFreeCommentQuestion(question) && buildExplicitFreeCommentProjectSlots(projectAiState).length > 0) {
    return "project.ai_state_json";
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

  if (isFreeCommentQuestion(question)) {
    const config = getExplicitFreeCommentProjectConfig(projectAiState);
    const probePolicy =
      (isPlainObject(config?.probe_policy) ? config.probe_policy : null) ??
      (isPlainObject(config?.probe_config) ? config.probe_config : null);
    if (
      setting === "max_probes" &&
      (typeof probePolicy?.max_probes === "number" || typeof probePolicy?.default_max_probes === "number")
    ) {
      return "project.ai_state_json";
    }
    if (setting === "strict_topic_lock" && typeof probePolicy?.strict_topic_lock === "boolean") {
      return "project.ai_state_json";
    }
    return "default";
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
  const metaContext = resolveMetaContextType(question, contextType);
  const configured = question.question_config?.meta ?? {};
  const base = defaultMetaByContext(question, metaContext);
  const explicitFreeCommentProbeEnabled =
    metaContext === "free_comment" &&
    question.ai_probe_enabled &&
    (hasExplicitConfiguredFreeCommentMeta(configured) || hasExplicitFreeCommentProjectContext(options.projectAiState));
  const effectiveConfigured =
    metaContext === "free_comment" && !explicitFreeCommentProbeEnabled
      ? {
          ...configured,
          expected_slots: [],
          required_slots: [],
          bad_answer_patterns: [],
          completion_conditions: [],
          probe_goal: undefined,
          probe_config: undefined
        }
      : configured;
  const explicitFreeCommentProjectConfig =
    metaContext === "free_comment" ? getExplicitFreeCommentProjectConfig(options.projectAiState) : null;
  const configuredExpectedSlots = (effectiveConfigured.expected_slots ?? [])
    .map(normalizeExpectedSlot)
    .filter((slot): slot is QuestionExpectedSlot => Boolean(slot));
  const inheritedProjectSlots =
    question.question_type !== "text"
      ? []
      : metaContext === "free_comment"
        ? explicitFreeCommentProbeEnabled
          ? buildExplicitFreeCommentProjectSlots(options.projectAiState)
          : []
        : buildInheritedProjectSlots(options.projectAiState);
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
  const inheritedRequiredSlots =
    configuredExpectedSlots.length === 0 && inheritedProjectSlots.length > 0
      ? (
          metaContext === "free_comment"
            ? getExplicitFreeCommentProjectRequiredSlotKeys(options.projectAiState)
            : getProjectRequiredSlotKeys(options.projectAiState)
        ).filter((key) => expectedSlots.some((slot) => slot.key === key))
      : [];
  const projectBackedProbeConfig =
    metaContext === "free_comment"
      ? applyExplicitFreeCommentProjectProbeDefaults(base.probe_config, options.projectAiState)
      : applyProjectStateProbeDefaults(base.probe_config, options.projectAiState);
  const requiredSlots = Array.from(
    new Set([
      ...normalizeSlotKeyList(effectiveConfigured.required_slots),
      ...(effectiveConfigured.required_slots?.length
        ? []
        : inheritedRequiredSlots.length > 0
          ? inheritedRequiredSlots
          : getRequiredSlotKeys({ expected_slots: expectedSlots, required_slots: base.required_slots }))
    ])
  );
  const skippableIfSlotsPresent = Array.from(
    new Set([
      ...normalizeSlotKeyList(effectiveConfigured.skippable_if_slots_present),
      ...(effectiveConfigured.skippable_if_slots_present?.length
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
      effectiveConfigured.research_goal?.trim() ||
      (metaContext === "free_comment"
        ? normalizeProjectStateText(
            explicitFreeCommentProjectConfig?.research_goal ?? explicitFreeCommentProjectConfig?.project_goal
          )
        : null) ||
      normalizeProjectStateText(options.projectAiState?.project_goal) ||
      base.research_goal,
    question_goal:
      effectiveConfigured.question_goal?.trim() ||
      (metaContext === "free_comment"
        ? normalizeProjectStateText(
            explicitFreeCommentProjectConfig?.question_goal ??
              explicitFreeCommentProjectConfig?.user_understanding_goal
          )
        : null) ||
      normalizeProjectStateText(options.projectAiState?.user_understanding_goal) ||
      base.question_goal,
    probe_goal:
      effectiveConfigured.probe_goal?.trim() ||
      (metaContext === "free_comment"
        ? normalizeProjectStateText(explicitFreeCommentProjectConfig?.probe_goal)
        : null) ||
      base.probe_goal,
    expected_slots: expectedSlots,
    required_slots: requiredSlots,
    skippable_if_slots_present: skippableIfSlotsPresent,
    can_prefill_future_slots:
      typeof effectiveConfigured.can_prefill_future_slots === "boolean"
        ? effectiveConfigured.can_prefill_future_slots
        : base.can_prefill_future_slots,
    skip_forbidden_on_bad_answer:
      typeof effectiveConfigured.skip_forbidden_on_bad_answer === "boolean"
        ? effectiveConfigured.skip_forbidden_on_bad_answer
        : base.skip_forbidden_on_bad_answer,
    bad_answer_patterns: (effectiveConfigured.bad_answer_patterns ?? [])
      .map(normalizeBadAnswerPattern)
      .filter((pattern): pattern is QuestionBadAnswerPattern => Boolean(pattern))
      .concat(base.bad_answer_patterns.filter(() => !effectiveConfigured.bad_answer_patterns?.length)),
    probe_config: normalizeProbeConfig(
      {
        ...effectiveConfigured.probe_config,
        ...(question.max_probe_count != null ? { max_probes: question.max_probe_count } : {})
      },
      projectBackedProbeConfig
    ),
    completion_conditions: (effectiveConfigured.completion_conditions ?? [])
      .map(normalizeCompletionCondition)
      .filter((condition): condition is QuestionCompletionCondition => Boolean(condition))
      .concat(base.completion_conditions.filter(() => !effectiveConfigured.completion_conditions?.length)),
    render_style: {
      mode: effectiveConfigured.render_style?.mode ?? base.render_style.mode ?? "default",
      lead_in: effectiveConfigured.render_style?.lead_in?.trim(),
      connect_from_previous_answer:
        effectiveConfigured.render_style?.connect_from_previous_answer ??
        base.render_style.connect_from_previous_answer ??
        true,
      avoid_question_number:
        effectiveConfigured.render_style?.avoid_question_number ?? base.render_style.avoid_question_number ?? true,
      preserve_options:
        effectiveConfigured.render_style?.preserve_options ?? base.render_style.preserve_options ?? false
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
  return ABSTRACT_KEYWORDS.some((keyword) => normalized.includes(keyword));
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
      ? text
        ? 80
        : 0
      : Math.round((filledSlotCount / totalSlots) * 100);
  const lengthScore =
    text.length >= 60 ? 100 : text.length >= 30 ? 85 : text.length >= 16 ? 70 : text.length >= 8 ? 50 : text ? 30 : 0;
  let qualityScore = Math.round(slotCoverage * 0.6 + lengthScore * 0.4);
  const hasFullRequiredSlotCoverage = totalSlots > 0 && filledSlotCount >= totalSlots;

  if (hasFullRequiredSlotCoverage) {
    qualityScore = Math.max(qualityScore, 80);
  }

  if (hasMatchedBadAnswerNote(text, meta.bad_answer_patterns, BAD_ANSWER_NOTE.NO_CONTENT)) {
    qualityScore = Math.min(qualityScore, 15);
  }
  if (hasMatchedBadAnswerNote(text, meta.bad_answer_patterns, BAD_ANSWER_NOTE.ABSTRACT)) {
    qualityScore = Math.min(qualityScore, 55);
  }
  if (hasMatchedBadAnswerNote(text, meta.bad_answer_patterns, BAD_ANSWER_NOTE.LOW_SPECIFICITY)) {
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
  const missingSlots = requiredSlots.filter((slot) => {
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
  const hasRequiredCoverage = requiredSlots.length > 0 && missingSlots.length === 0;
  if (qualityScore < DEFAULT_COMPLETION_QUALITY_THRESHOLD && !hasRequiredCoverage) {
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
  const isLowSpecificity = hasMatchedBadAnswerNote(
    text,
    meta.bad_answer_patterns,
    BAD_ANSWER_NOTE.LOW_SPECIFICITY
  );
  const currentProbeCount = input.currentProbeCountForAnswer ?? 0;
  const filledSlotCount = countFilledSlots(input.extractedSlots);
  const matchedNoContent =
    meta.probe_config.force_probe_on_bad &&
    isBadAnswer;
  const matchedAbstractPattern =
    meta.probe_config.force_probe_on_bad &&
    hasMatchedBadAnswerNote(text, meta.bad_answer_patterns, BAD_ANSWER_NOTE.ABSTRACT);
  const matchedLowSpecificityPattern = meta.probe_config.force_probe_on_bad && isLowSpecificity;
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

  if (matchedAbstractPattern) {
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

  if (filledSlotCount > 0 && completion.missing_slots.length === 0) {
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

  if (matchedLowSpecificityPattern) {
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

  if (currentProbeCount < meta.probe_config.min_probes && !completion.is_complete) {
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
      ? "ありがとうございます。もう少し詳しく教えてください。"
      : "");
  const base = input.question.question_text.trim();

  if (input.question.question_type !== "text" || meta.render_style.mode !== "interview_natural") {
    return [lead, base].filter(Boolean).join("\n");
  }

  return [lead, base].filter(Boolean).join(" ");
}