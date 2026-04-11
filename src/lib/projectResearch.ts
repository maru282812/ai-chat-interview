import type {
  ProbeCondition,
  ProbeEndCondition,
  Project,
  ProjectProbePolicy,
  ProjectResponseStyle,
  ResearchMode
} from "../types/domain";

export interface NormalizedProjectResearchSettings {
  research_mode: ResearchMode;
  primary_objectives: string[];
  secondary_objectives: string[];
  comparison_constraints: string[];
  prompt_rules: string[];
  probe_policy: Required<ProjectProbePolicy> & {
    conditions: ProbeCondition[];
    target_question_codes: string[];
    blocked_question_codes: string[];
    end_conditions: ProbeEndCondition[];
  };
  response_style: Required<ProjectResponseStyle> & { channel: "line" };
}

const DEFAULT_RESPONSE_STYLE: Required<ProjectResponseStyle> & { channel: "line" } = {
  channel: "line",
  tone: "natural_japanese",
  max_characters_per_message: 80,
  max_sentences: 2
};

const DEFAULT_PROBE_POLICY: Record<
  ResearchMode,
  Required<ProjectProbePolicy> & {
    conditions: ProbeCondition[];
    target_question_codes: string[];
    blocked_question_codes: string[];
    end_conditions: ProbeEndCondition[];
  }
> = {
  survey_interview: {
    enabled: true,
    conditions: ["short_answer", "abstract_answer"],
    max_probes_per_answer: 1,
    max_probes_per_session: 2,
    require_question_probe_enabled: true,
    target_question_codes: [],
    blocked_question_codes: [],
    short_answer_min_length: 10,
    end_conditions: [
      "answer_sufficient",
      "max_probes_per_answer",
      "max_probes_per_session",
      "question_not_target",
      "question_blocked",
      "user_declined"
    ]
  },
  interview: {
    enabled: true,
    conditions: ["short_answer", "abstract_answer"],
    max_probes_per_answer: 1,
    max_probes_per_session: 2,
    require_question_probe_enabled: true,
    target_question_codes: [],
    blocked_question_codes: [],
    short_answer_min_length: 10,
    end_conditions: [
      "answer_sufficient",
      "max_probes_per_answer",
      "max_probes_per_session",
      "question_not_target",
      "question_blocked",
      "user_declined"
    ]
  }
};

function isResearchMode(value: unknown): value is ResearchMode {
  return value === "survey_interview" || value === "interview";
}

function isProbeCondition(value: unknown): value is ProbeCondition {
  return value === "short_answer" || value === "abstract_answer";
}

function isProbeEndCondition(value: unknown): value is ProbeEndCondition {
  return (
    value === "answer_sufficient" ||
    value === "max_probes_per_answer" ||
    value === "max_probes_per_session" ||
    value === "question_not_target" ||
    value === "question_blocked" ||
    value === "user_declined"
  );
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeResponseStyle(value: unknown): ProjectResponseStyle {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const candidate = value as Record<string, unknown>;
  const maxCharacters = Number(candidate.max_characters_per_message);
  const maxSentences = Number(candidate.max_sentences);

  return {
    channel: candidate.channel === "line" ? "line" : undefined,
    tone: typeof candidate.tone === "string" ? candidate.tone.trim() : undefined,
    max_characters_per_message:
      Number.isFinite(maxCharacters) && maxCharacters > 0 ? maxCharacters : undefined,
    max_sentences: Number.isFinite(maxSentences) && maxSentences > 0 ? maxSentences : undefined
  };
}

function normalizeProbePolicy(
  researchMode: ResearchMode,
  value: unknown
): Required<ProjectProbePolicy> & {
  conditions: ProbeCondition[];
  target_question_codes: string[];
  blocked_question_codes: string[];
  end_conditions: ProbeEndCondition[];
} {
  const defaults = DEFAULT_PROBE_POLICY[researchMode];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ...defaults };
  }

  const candidate = value as Record<string, unknown>;
  const maxPerAnswer = Number(candidate.max_probes_per_answer);
  const maxPerSession = Number(candidate.max_probes_per_session);
  const shortAnswerMinLength = Number(candidate.short_answer_min_length);
  const conditions = Array.isArray(candidate.conditions)
    ? candidate.conditions.filter(isProbeCondition)
    : defaults.conditions;
  const endConditions = Array.isArray(candidate.end_conditions)
    ? candidate.end_conditions.filter(isProbeEndCondition)
    : defaults.end_conditions;

  return {
    enabled: typeof candidate.enabled === "boolean" ? candidate.enabled : defaults.enabled,
    conditions: conditions.length > 0 ? conditions : defaults.conditions,
    max_probes_per_answer:
      Number.isFinite(maxPerAnswer) && maxPerAnswer >= 0
        ? maxPerAnswer
        : defaults.max_probes_per_answer,
    max_probes_per_session:
      Number.isFinite(maxPerSession) && maxPerSession >= 0
        ? maxPerSession
        : defaults.max_probes_per_session,
    require_question_probe_enabled:
      typeof candidate.require_question_probe_enabled === "boolean"
        ? candidate.require_question_probe_enabled
        : defaults.require_question_probe_enabled,
    target_question_codes: normalizeStringList(candidate.target_question_codes),
    blocked_question_codes: normalizeStringList(candidate.blocked_question_codes),
    short_answer_min_length:
      Number.isFinite(shortAnswerMinLength) && shortAnswerMinLength > 0
        ? shortAnswerMinLength
        : defaults.short_answer_min_length,
    end_conditions: endConditions.length > 0 ? endConditions : defaults.end_conditions
  };
}

export function getProjectResearchSettings(
  project: Partial<
    Pick<
      Project,
      | "objective"
      | "research_mode"
      | "primary_objectives"
      | "secondary_objectives"
      | "comparison_constraints"
      | "prompt_rules"
      | "probe_policy"
      | "response_style"
    >
  > | null
): NormalizedProjectResearchSettings {
  const research_mode = isResearchMode(project?.research_mode) ? project.research_mode : "survey_interview";
  const primary_objectives = normalizeStringList(project?.primary_objectives);
  const secondary_objectives = normalizeStringList(project?.secondary_objectives);
  const comparison_constraints = normalizeStringList(project?.comparison_constraints);
  const prompt_rules = normalizeStringList(project?.prompt_rules);

  if (primary_objectives.length === 0 && typeof project?.objective === "string" && project.objective.trim()) {
    primary_objectives.push(project.objective.trim());
  }

  return {
    research_mode,
    primary_objectives,
    secondary_objectives,
    comparison_constraints,
    prompt_rules,
    probe_policy: normalizeProbePolicy(research_mode, project?.probe_policy),
    response_style: {
      ...DEFAULT_RESPONSE_STYLE,
      ...normalizeResponseStyle(project?.response_style)
    }
  };
}

export function parseLineSeparatedList(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function stringifyJsonField(value: unknown): string {
  return JSON.stringify(value, null, 2);
}
