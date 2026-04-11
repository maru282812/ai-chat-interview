import type {
  Project,
  ProjectAICompletionRule,
  ProjectAIProbePolicy,
  ProjectAISlot,
  ProjectAIState,
  ProjectAIStateTemplateKey,
  ProjectAITopicControl,
  ResearchMode
} from "../types/domain";

export interface ProjectAIStateTemplateDefinition {
  key: ProjectAIStateTemplateKey;
  label: string;
  description: string;
  state: ProjectAIState;
}

export interface ProjectAIStateTemplateOption {
  key: ProjectAIStateTemplateKey;
  label: string;
  description: string;
}

export interface NormalizedProjectAIState {
  version: string;
  template_key: string | null;
  project_goal: string;
  user_understanding_goal: string;
  required_slots: ProjectAISlot[];
  optional_slots: ProjectAISlot[];
  question_categories: string[];
  probe_policy: Required<ProjectAIProbePolicy>;
  completion_rule: Required<ProjectAICompletionRule>;
  topic_control: Required<ProjectAITopicControl>;
  language: string;
}

export interface ProjectSlotCompletionStatus {
  requiredSlotKeys: string[];
  missingRequiredSlotKeys: string[];
  filledRequiredCount: number;
  isComplete: boolean;
}

const DEFAULT_VERSION = "v1";
const DEFAULT_LANGUAGE = "ja";

const DEFAULT_PROBE_POLICY: Required<ProjectAIProbePolicy> = {
  default_max_probes: 1,
  force_probe_on_bad: true,
  strict_topic_lock: true,
  allow_followup_expansion: false
};

const DEFAULT_COMPLETION_RULE: Required<ProjectAICompletionRule> = {
  required_slots_needed: [],
  allow_finish_without_optional: true,
  min_required_slots_to_finish: 1
};

const DEFAULT_TOPIC_CONTROL: Required<ProjectAITopicControl> = {
  forbidden_topic_shift: true,
  topic_lock_note: "プロジェクトの主題から外れないように深掘りする"
};

const PROJECT_AI_STATE_TEMPLATES: Record<ProjectAIStateTemplateKey, ProjectAIStateTemplateDefinition> = {
  product_feedback: {
    key: "product_feedback",
    label: "商品評価調査",
    description: "商品利用者の評価、利用シーン、不満、改善要望を整理します。",
    state: {
      version: DEFAULT_VERSION,
      template_key: "product_feedback",
      project_goal: "商品利用者の評価と改善要望を把握する",
      user_understanding_goal: "利用場面、評価理由、不満、改善要望を具体的に理解する",
      required_slots: [
        { key: "product_name", label: "商品名", required: true, description: "対象となる商品やサービス名" },
        { key: "usage_scene", label: "利用シーン", required: true, description: "どんな場面で使ったか" },
        { key: "good_point", label: "良かった点", required: true, description: "評価している理由や価値" }
      ],
      optional_slots: [
        { key: "bad_point", label: "不満点", required: false, description: "困ったことや嫌だった点" },
        { key: "improvement_request", label: "改善要望", required: false, description: "今後よくしてほしいこと" }
      ],
      question_categories: ["基本情報", "利用状況", "評価理由", "不満点", "改善要望"],
      probe_policy: { ...DEFAULT_PROBE_POLICY },
      completion_rule: {
        required_slots_needed: ["product_name", "usage_scene", "good_point"],
        allow_finish_without_optional: true,
        min_required_slots_to_finish: 3
      },
      topic_control: {
        forbidden_topic_shift: true,
        topic_lock_note: "商品評価の話題から外れないように深掘りする"
      },
      language: DEFAULT_LANGUAGE
    }
  },
  ux_research: {
    key: "ux_research",
    label: "UX課題調査",
    description: "利用体験のつまずき、作業文脈、回避行動、理想体験を整理します。",
    state: {
      version: DEFAULT_VERSION,
      template_key: "ux_research",
      project_goal: "体験上の課題と改善機会を把握する",
      user_understanding_goal: "利用導線、作業文脈、つまずき、回避方法を具体的に理解する",
      required_slots: [
        { key: "entry_point", label: "利用開始点", required: true, description: "最初に触れたきっかけや導線" },
        { key: "task_scene", label: "利用タスク", required: true, description: "何をしようとしていた場面か" },
        { key: "ux_issue", label: "UX課題", required: true, description: "使いにくさや阻害要因" }
      ],
      optional_slots: [
        { key: "workaround", label: "回避行動", required: false, description: "その場で取った代替手段" },
        { key: "ideal_experience", label: "理想体験", required: false, description: "本来どうあってほしいか" }
      ],
      question_categories: ["導入経路", "利用文脈", "課題", "回避行動", "理想体験"],
      probe_policy: { ...DEFAULT_PROBE_POLICY },
      completion_rule: {
        required_slots_needed: ["entry_point", "task_scene", "ux_issue"],
        allow_finish_without_optional: true,
        min_required_slots_to_finish: 3
      },
      topic_control: {
        forbidden_topic_shift: true,
        topic_lock_note: "UX課題の話題から外れないように深掘りする"
      },
      language: DEFAULT_LANGUAGE
    }
  },
  emotion_value: {
    key: "emotion_value",
    label: "価値観インタビュー",
    description: "感情の動き、価値判断、意思決定理由を整理します。",
    state: {
      version: DEFAULT_VERSION,
      template_key: "emotion_value",
      project_goal: "行動の背景にある感情と価値観を把握する",
      user_understanding_goal: "感情が動いた場面、価値判断の基準、意思決定理由を理解する",
      required_slots: [
        { key: "trigger_scene", label: "きっかけ場面", required: true, description: "感情や判断が動いた場面" },
        { key: "emotion", label: "感情", required: true, description: "そのとき感じた気持ち" },
        { key: "value_basis", label: "価値基準", required: true, description: "大事にしている考え方や基準" }
      ],
      optional_slots: [
        { key: "decision_reason", label: "意思決定理由", required: false, description: "最終的にそう判断した理由" },
        { key: "desired_state", label: "理想状態", required: false, description: "今後どうなってほしいか" }
      ],
      question_categories: ["背景理解", "感情", "価値基準", "意思決定", "理想状態"],
      probe_policy: { ...DEFAULT_PROBE_POLICY },
      completion_rule: {
        required_slots_needed: ["trigger_scene", "emotion", "value_basis"],
        allow_finish_without_optional: true,
        min_required_slots_to_finish: 3
      },
      topic_control: {
        forbidden_topic_shift: true,
        topic_lock_note: "価値観の話題から外れないように深掘りする"
      },
      language: DEFAULT_LANGUAGE
    }
  },
  pain_request: {
    key: "pain_request",
    label: "不満収集",
    description: "不満、発生場面、影響、改善要望を整理します。",
    state: {
      version: DEFAULT_VERSION,
      template_key: "pain_request",
      project_goal: "不満と改善要望を構造的に把握する",
      user_understanding_goal: "困りごと、発生場面、影響、代替行動、改善要望を理解する",
      required_slots: [
        { key: "pain_point", label: "不満点", required: true, description: "最も不満に感じている点" },
        { key: "pain_scene", label: "発生場面", required: true, description: "その不満が起きた状況" },
        { key: "impact", label: "影響", required: true, description: "その不満で生じた困りごと" }
      ],
      optional_slots: [
        { key: "current_workaround", label: "現在の対処", required: false, description: "今はどうやってしのいでいるか" },
        { key: "improvement_request", label: "改善要望", required: false, description: "どう改善されるとよいか" }
      ],
      question_categories: ["不満点", "発生場面", "影響", "現状対処", "改善要望"],
      probe_policy: { ...DEFAULT_PROBE_POLICY },
      completion_rule: {
        required_slots_needed: ["pain_point", "pain_scene", "impact"],
        allow_finish_without_optional: true,
        min_required_slots_to_finish: 3
      },
      topic_control: {
        forbidden_topic_shift: true,
        topic_lock_note: "不満と改善要望の話題から外れないように深掘りする"
      },
      language: DEFAULT_LANGUAGE
    }
  },
  diary_rant: {
    key: "diary_rant",
    label: "本音・日記分析",
    description: "出来事、感情、本音、不満、理想状態を整理します。",
    state: {
      version: DEFAULT_VERSION,
      template_key: "diary_rant",
      project_goal: "日記や本音投稿から率直な認識と感情を把握する",
      user_understanding_goal: "起きた出来事、感情、その理由、不満、望む状態を理解する",
      required_slots: [
        { key: "event", label: "出来事", required: true, description: "何が起きたのか" },
        { key: "emotion", label: "感情", required: true, description: "そのときの率直な気持ち" },
        { key: "reason", label: "理由", required: true, description: "そう感じた背景や原因" }
      ],
      optional_slots: [
        { key: "pain_point", label: "不満点", required: false, description: "嫌だったことや困ったこと" },
        { key: "desired_state", label: "理想状態", required: false, description: "本当はどうなってほしいか" }
      ],
      question_categories: ["出来事", "感情", "背景", "不満点", "理想状態"],
      probe_policy: {
        ...DEFAULT_PROBE_POLICY,
        allow_followup_expansion: true
      },
      completion_rule: {
        required_slots_needed: ["event", "emotion", "reason"],
        allow_finish_without_optional: true,
        min_required_slots_to_finish: 3
      },
      topic_control: {
        forbidden_topic_shift: true,
        topic_lock_note: "本音や日記の話題から外れないように深掘りする"
      },
      language: DEFAULT_LANGUAGE
    }
  }
};

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeString(item)).filter(Boolean);
}

function hasFilledSlot(slotMap: Record<string, string | null | undefined>, key: string): boolean {
  return typeof slotMap[key] === "string" && Boolean(slotMap[key]?.trim());
}

function parseProjectAIStateSource(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  const raw = value.trim();
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
}

function normalizeSlotArray(value: unknown, requiredDefault: boolean): ProjectAISlot[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalizedSlots: Array<ProjectAISlot | null> = value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return null;
    }

    const candidate = item as Record<string, unknown>;
    const key = normalizeString(candidate.key);
    const label = normalizeString(candidate.label) || key;
    if (!key || !label) {
      return null;
    }

    return {
      key,
      label,
      required: typeof candidate.required === "boolean" ? candidate.required : requiredDefault,
      description: normalizeString(candidate.description) || undefined,
      examples: normalizeStringList(candidate.examples)
    } satisfies ProjectAISlot;
  });

  return normalizedSlots.filter((slot): slot is ProjectAISlot => slot !== null);
}

function normalizeProbePolicy(value: unknown): Required<ProjectAIProbePolicy> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_PROBE_POLICY };
  }

  const candidate = value as Record<string, unknown>;
  const defaultMaxProbes = Number(candidate.default_max_probes);

  return {
    default_max_probes:
      Number.isFinite(defaultMaxProbes) && defaultMaxProbes >= 0
        ? Math.round(defaultMaxProbes)
        : DEFAULT_PROBE_POLICY.default_max_probes,
    force_probe_on_bad:
      typeof candidate.force_probe_on_bad === "boolean"
        ? candidate.force_probe_on_bad
        : DEFAULT_PROBE_POLICY.force_probe_on_bad,
    strict_topic_lock:
      typeof candidate.strict_topic_lock === "boolean"
        ? candidate.strict_topic_lock
        : DEFAULT_PROBE_POLICY.strict_topic_lock,
    allow_followup_expansion:
      typeof candidate.allow_followup_expansion === "boolean"
        ? candidate.allow_followup_expansion
        : DEFAULT_PROBE_POLICY.allow_followup_expansion
  };
}

function normalizeCompletionRule(value: unknown): Required<ProjectAICompletionRule> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_COMPLETION_RULE };
  }

  const candidate = value as Record<string, unknown>;
  const minRequiredSlots = Number(candidate.min_required_slots_to_finish);

  return {
    required_slots_needed: normalizeStringList(candidate.required_slots_needed),
    allow_finish_without_optional:
      typeof candidate.allow_finish_without_optional === "boolean"
        ? candidate.allow_finish_without_optional
        : DEFAULT_COMPLETION_RULE.allow_finish_without_optional,
    min_required_slots_to_finish:
      Number.isFinite(minRequiredSlots) && minRequiredSlots >= 0
        ? Math.round(minRequiredSlots)
        : DEFAULT_COMPLETION_RULE.min_required_slots_to_finish
  };
}

function normalizeTopicControl(value: unknown): Required<ProjectAITopicControl> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...DEFAULT_TOPIC_CONTROL };
  }

  const candidate = value as Record<string, unknown>;
  return {
    forbidden_topic_shift:
      typeof candidate.forbidden_topic_shift === "boolean"
        ? candidate.forbidden_topic_shift
        : DEFAULT_TOPIC_CONTROL.forbidden_topic_shift,
    topic_lock_note: normalizeString(candidate.topic_lock_note) || DEFAULT_TOPIC_CONTROL.topic_lock_note
  };
}

function cloneTemplateState(template: ProjectAIStateTemplateDefinition): ProjectAIState {
  return JSON.parse(JSON.stringify(template.state)) as ProjectAIState;
}

export function resolveProjectAIStateTemplateKey(input: {
  templateKey?: string | null;
  researchMode?: ResearchMode | null;
}): ProjectAIStateTemplateKey {
  if (
    input.templateKey === "product_feedback" ||
    input.templateKey === "ux_research" ||
    input.templateKey === "emotion_value" ||
    input.templateKey === "pain_request" ||
    input.templateKey === "diary_rant"
  ) {
    return input.templateKey;
  }

  if (input.researchMode === "interview") {
    return "ux_research";
  }

  if (input.researchMode === "survey_interview") {
    return "pain_request";
  }

  return "product_feedback";
}

export function listProjectAIStateTemplates(): ProjectAIStateTemplateDefinition[] {
  return Object.values(PROJECT_AI_STATE_TEMPLATES);
}

export function getProjectAiStateTemplates(): ProjectAIStateTemplateOption[] {
  return listProjectAIStateTemplates().map(({ key, label, description }) => ({
    key,
    label,
    description
  }));
}

export function getProjectAIStateTemplate(
  templateKey?: string | null,
  researchMode?: ResearchMode | null
): ProjectAIStateTemplateDefinition {
  const resolvedKey = resolveProjectAIStateTemplateKey({ templateKey, researchMode });
  return PROJECT_AI_STATE_TEMPLATES[resolvedKey];
}

export function buildProjectAIStateFallback(input: {
  project: Partial<
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
  templateKey?: string | null;
}): ProjectAIState {
  const template = getProjectAIStateTemplate(
    input.templateKey ?? input.project.ai_state_template_key,
    input.project.research_mode
  );
  const state = cloneTemplateState(template);
  const objective = normalizeString(input.project.objective);
  const name = normalizeString(input.project.name);
  const primaryObjectives = Array.isArray(input.project.primary_objectives)
    ? input.project.primary_objectives.filter(
        (value): value is string => typeof value === "string" && Boolean(value.trim())
      )
    : [];
  const secondaryObjectives = Array.isArray(input.project.secondary_objectives)
    ? input.project.secondary_objectives.filter(
        (value): value is string => typeof value === "string" && Boolean(value.trim())
      )
    : [];

  state.template_key = template.key;
  if (objective) {
    state.project_goal = objective;
  } else if (name) {
    state.project_goal = `${name}で本質的に知るべき情報を整理する`;
  }

  if (primaryObjectives.length > 0 || secondaryObjectives.length > 0) {
    state.user_understanding_goal = [
      primaryObjectives.length > 0 ? `主目的: ${primaryObjectives.join(" / ")}` : "",
      secondaryObjectives.length > 0 ? `副目的: ${secondaryObjectives.join(" / ")}` : ""
    ]
      .filter(Boolean)
      .join(" / ");
  }

  return state;
}

export function normalizeProjectAIState(
  value: unknown,
  options: {
    fallbackTemplateKey?: string | null;
    fallbackProject?: Partial<
      Pick<
        Project,
        | "name"
        | "objective"
        | "research_mode"
        | "primary_objectives"
        | "secondary_objectives"
        | "ai_state_template_key"
      >
    > | null;
  } = {}
): NormalizedProjectAIState {
  const fallbackState = buildProjectAIStateFallback({
    project: options.fallbackProject ?? {},
    templateKey: options.fallbackTemplateKey ?? options.fallbackProject?.ai_state_template_key ?? null
  });
  const parsedValue = parseProjectAIStateSource(value);
  const candidate =
    parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)
      ? (parsedValue as Record<string, unknown>)
      : (fallbackState as Record<string, unknown>);
  const fallbackRequiredSlots = normalizeSlotArray(fallbackState.required_slots, true);
  const fallbackOptionalSlots = normalizeSlotArray(fallbackState.optional_slots, false);
  const completionRule = normalizeCompletionRule(candidate.completion_rule ?? fallbackState.completion_rule);
  const requiredSlots = normalizeSlotArray(candidate.required_slots, true);

  return {
    version: normalizeString(candidate.version) || fallbackState.version || DEFAULT_VERSION,
    template_key:
      normalizeString(candidate.template_key) ||
      normalizeString(fallbackState.template_key) ||
      resolveProjectAIStateTemplateKey({
        templateKey: options.fallbackTemplateKey ?? options.fallbackProject?.ai_state_template_key ?? null,
        researchMode: options.fallbackProject?.research_mode ?? null
      }),
    project_goal: normalizeString(candidate.project_goal) || normalizeString(fallbackState.project_goal),
    user_understanding_goal:
      normalizeString(candidate.user_understanding_goal) || normalizeString(fallbackState.user_understanding_goal),
    required_slots: requiredSlots.length > 0 ? requiredSlots : fallbackRequiredSlots,
    optional_slots: (() => {
      const normalized = normalizeSlotArray(candidate.optional_slots, false);
      return normalized.length > 0 ? normalized : fallbackOptionalSlots;
    })(),
    question_categories: (() => {
      const normalized = normalizeStringList(candidate.question_categories);
      return normalized.length > 0 ? normalized : normalizeStringList(fallbackState.question_categories);
    })(),
    probe_policy: normalizeProbePolicy(candidate.probe_policy ?? fallbackState.probe_policy),
    completion_rule: {
      ...completionRule,
      required_slots_needed:
        completionRule.required_slots_needed.length > 0
          ? completionRule.required_slots_needed
          : (requiredSlots.length > 0 ? requiredSlots : fallbackRequiredSlots).map((slot) => slot.key),
      min_required_slots_to_finish: Math.max(
        completionRule.min_required_slots_to_finish,
        completionRule.required_slots_needed.length > 0 ? completionRule.required_slots_needed.length : 1
      )
    },
    topic_control: normalizeTopicControl(candidate.topic_control ?? fallbackState.topic_control),
    language: normalizeString(candidate.language) || normalizeString(fallbackState.language) || DEFAULT_LANGUAGE
  };
}

export function getProjectAIState(
  project: Partial<
    Pick<
      Project,
      | "name"
      | "objective"
      | "research_mode"
      | "primary_objectives"
      | "secondary_objectives"
      | "ai_state_json"
      | "ai_state_template_key"
    >
  > | null
): NormalizedProjectAIState {
  return normalizeProjectAIState(project?.ai_state_json, {
    fallbackTemplateKey: project?.ai_state_template_key ?? null,
    fallbackProject: project ?? null
  });
}

export function evaluateProjectSlotCompletion(
  project: Partial<
    Pick<
      Project,
      | "name"
      | "objective"
      | "research_mode"
      | "primary_objectives"
      | "secondary_objectives"
      | "ai_state_json"
      | "ai_state_template_key"
    >
  > | null,
  slotMap: Record<string, string | null | undefined>
): ProjectSlotCompletionStatus {
  const aiState = getProjectAIState(project);
  const requiredSlotKeys = Array.from(
    new Set(
      aiState.completion_rule.required_slots_needed.length > 0
        ? aiState.completion_rule.required_slots_needed
        : aiState.required_slots.map((slot) => slot.key)
    )
  );
  const missingRequiredSlotKeys = requiredSlotKeys.filter((key) => !hasFilledSlot(slotMap, key));
  const filledRequiredCount = requiredSlotKeys.length - missingRequiredSlotKeys.length;
  const minRequiredSlots = Math.max(0, aiState.completion_rule.min_required_slots_to_finish);

  return {
    requiredSlotKeys,
    missingRequiredSlotKeys,
    filledRequiredCount,
    isComplete:
      (requiredSlotKeys.length === 0 && filledRequiredCount >= minRequiredSlots) ||
      (missingRequiredSlotKeys.length === 0 && filledRequiredCount >= minRequiredSlots)
  };
}

export function stringifyProjectAIState(value: unknown): string {
  if (value == null) {
    return "";
  }

  try {
    return JSON.stringify(parseProjectAIStateSource(value) ?? value, null, 2);
  } catch {
    return JSON.stringify(normalizeProjectAIState(value), null, 2);
  }
}
