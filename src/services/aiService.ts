import { env } from "../config/env";
import { openai } from "../config/openai";
import { getProjectAIState, getProjectAIStateTemplate, normalizeProjectAIState } from "../lib/projectAiState";
import { logger } from "../lib/logger";
import {
  assessProbeNeed,
  buildHeuristicStructuredPayload,
  buildInterviewQuestionFallback,
  evaluateCompletion,
  normalizeQuestionMeta,
  resolveAnswerAnalysisContext
} from "../lib/questionMetadata";
import {
  buildAnalyzeAnswerPrompt,
  buildCompletionCheckPrompt,
  buildFinalAnalysisPrompt,
  buildFinalStructuredSummaryPrompt,
  buildProbeGenerationPrompt,
  buildPostAnalysisPrompt,
  buildProjectInitialStatePrompt,
  buildProbePrompt,
  buildQuestionRenderingPrompt,
  buildProjectAnalysisPrompt,
  buildSessionSummaryPrompt,
  buildSlotFillingPrompt
} from "../prompts/researchPrompts";
import { aiLogRepository } from "../repositories/aiLogRepository";
import type {
  AnswerAnalysisAction,
  AnswerAnalysisResult,
  NormalizedExtractionResult,
  Project,
  ProjectAIState,
  Question,
  QuestionExtractionConfig,
  StructuredAnswerCompletion,
  StructuredAnswerPayload,
  StructuredAnswerSlotValue,
  StructuredProbeType
} from "../types/domain";

interface AITextResult {
  text: string;
  usage: Record<string, unknown> | null;
}

function buildJapaneseSystemInstruction(purpose: string): string {
  return [
    "あなたはLINEインタビュー支援AIです。",
    "必ず日本語で出力してください。",
    "JSONを求められた場合はJSON以外を一切出力しないでください。",
    "過去の別案件や別セッションの文脈を混ぜてはいけません。",
    `purpose: ${purpose}`
  ].join("\n");
}

function collectJsonStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectJsonStringValues(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => collectJsonStringValues(item));
  }
  return [];
}

function hasEnglishDominance(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  const englishWords = normalized.match(/[A-Za-z]{3,}/g) ?? [];
  const japaneseChars = normalized.match(/[ぁ-んァ-ン一-龠々ー]/g) ?? [];
  return englishWords.length >= 3 && englishWords.length > japaneseChars.length / 8;
}

function shouldRetryForJapanese(text: string, mode: "text" | "json_values"): boolean {
  if (mode === "text") {
    return hasEnglishDominance(text);
  }

  try {
    const parsed = parseJsonResponse<unknown>(text);
    return collectJsonStringValues(parsed).some((value) => hasEnglishDominance(value));
  } catch {
    return false;
  }
}

async function runTextPrompt(
  sessionId: string,
  purpose: string,
  prompt: string,
  options: {
    japaneseCheckMode?: "text" | "json_values" | "none";
  } = {}
): Promise<AITextResult> {
  const japaneseCheckMode = options.japaneseCheckMode ?? "text";
  let finalText = "";
  let finalUsage: Record<string, unknown> | null = null;
  let finalPrompt = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    finalPrompt = [
      buildJapaneseSystemInstruction(purpose),
      attempt > 0
        ? "前回の出力に英語が混ざりました。今回は日本語だけで出力し直してください。"
        : "",
      prompt
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await openai.responses.create({
      model: env.OPENAI_MODEL,
      input: finalPrompt
    });

    finalText = response.output_text.trim();
    finalUsage = (response.usage as Record<string, unknown> | undefined) ?? null;
    if (japaneseCheckMode === "none" || !shouldRetryForJapanese(finalText, japaneseCheckMode)) {
      break;
    }
  }

  await aiLogRepository.create({
    session_id: sessionId,
    purpose,
    prompt: finalPrompt,
    response: finalText,
    token_usage: finalUsage
  });

  return {
    text: finalText,
    usage: finalUsage
  };
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "").trim();
}

function parseJsonResponse<T>(text: string): T {
  return JSON.parse(stripCodeFence(text)) as T;
}

function clampConfidence(value: unknown, fallback = 0.5): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function sanitizeProbeType(value: unknown): StructuredProbeType | null {
  if (value === "missing_slot" || value === "concretize" || value === "clarify") {
    return value;
  }
  return null;
}

function sanitizeAction(value: unknown): AnswerAnalysisAction | null {
  if (value === "ask_next" || value === "probe" || value === "skip" || value === "finish") {
    return value;
  }
  return null;
}

function mergeSlotMaps(
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

function isLikelyInternalSlotLabel(value: string): boolean {
  return /^[a-z][a-z0-9_]*$/i.test(value.trim());
}

function resolveUserFacingSlotLabel(input: {
  slotKey: string | null | undefined;
  question: Question;
  project: Project;
}): string {
  const meta = normalizeQuestionMeta(
    input.question,
    input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
    { projectAiState: input.project.ai_state_json }
  );
  const slot = meta.expected_slots.find((candidate) => candidate.key === input.slotKey);
  const label = slot?.label?.trim();

  if (label && !isLikelyInternalSlotLabel(label) && !hasEnglishDominance(label)) {
    return label;
  }
  if (slot?.description?.trim()) {
    return slot.description.trim();
  }
  return "その点";
}

function shouldRejectUserFacingQuestion(
  question: string,
  project: Project,
  slotKeys: string[]
): boolean {
  const normalized = question.trim();
  if (!normalized) {
    return false;
  }

  if (hasEnglishDominance(normalized)) {
    return true;
  }

  return slotKeys.some((slotKey) => {
    if (!slotKey) {
      return false;
    }
    return normalized.toLowerCase().includes(slotKey.toLowerCase());
  });
}

function buildFallbackProbeQuestion(input: {
  question: Question;
  missingSlots: string[];
  probeType: StructuredProbeType | null;
  project: Project;
}): string | null {
  if (!input.probeType) {
    return null;
  }

  const meta = normalizeQuestionMeta(
    input.question,
    input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
    { projectAiState: input.project.ai_state_json }
  );
  const firstMissingSlot = input.missingSlots[0];
  const slotLabel =
    meta.expected_slots.find((slot) => slot.key === firstMissingSlot)?.label ??
    firstMissingSlot ??
    "その点";

  switch (input.probeType) {
    case "missing_slot":
      return `${slotLabel}について、もう少し具体的に教えてください。`;
    case "clarify":
      return "今のご回答の意味が伝わるように、もう少し詳しく教えてください。";
    case "concretize":
      return "そのときの状況や理由がわかる具体例を1つ教えてください。";
    default:
      return null;
  }
}

function convertSlotMapToArray(slotMap: Record<string, string | null>): StructuredAnswerSlotValue[] {
  return Object.entries(slotMap).map(([key, value]) => ({
    key,
    value,
    confidence: value ? 0.8 : null,
    evidence: value
  }));
}

function buildAnswerExtractionPrompt(input: {
  project: Project;
  question: Question;
  answer: string;
  extractionConfig: QuestionExtractionConfig;
  ruleResult: NormalizedExtractionResult;
}): string {
  return [
    "You extract structured entities from one free-text answer.",
    "Return JSON only.",
    "Use the configured schema keys exactly.",
    "Keep the output concise and grounded only in the answer text.",
    "",
    `Project objective: ${input.project.objective ?? input.project.name}`,
    `Question: ${input.question.question_text}`,
    `Extraction config: ${JSON.stringify(input.extractionConfig)}`,
    `Rule result: ${JSON.stringify(input.ruleResult)}`,
    `Answer: ${input.answer}`,
    "",
    "Return this JSON shape:",
    JSON.stringify(
      {
        mode: input.extractionConfig.mode ?? "multi_object",
        status: "completed",
        method: "ai_assisted",
        target: input.extractionConfig.target ?? "post_answer",
        summary: {},
        entities: [{ index: 0, fields: {} }],
        missing_fields: [],
        needs_ai_assist: false
      },
      null,
      2
    )
  ].join("\n");
}

export const aiService = {
  async generateProjectInitialState(input: {
    project: Pick<
      Project,
      | "name"
      | "client_name"
      | "objective"
      | "research_mode"
      | "primary_objectives"
      | "secondary_objectives"
      | "comparison_constraints"
      | "prompt_rules"
      | "ai_state_template_key"
    >;
  }): Promise<ProjectAIState> {
    const template = getProjectAIStateTemplate(
      input.project.ai_state_template_key,
      input.project.research_mode
    );
    const prompt = buildProjectInitialStatePrompt({
      project: input.project,
      template
    });
    const response = await openai.responses.create({
      model: env.OPENAI_MODEL,
      input: [buildJapaneseSystemInstruction("project_initial_state"), prompt].join("\n\n")
    });

    return normalizeProjectAIState(parseJsonResponse<ProjectAIState>(response.output_text.trim()), {
      fallbackTemplateKey: template.key,
      fallbackProject: input.project
    });
  },

  async renderQuestion(input: {
    sessionId: string;
    project: Project;
    question: Question;
    previousQuestionText?: string | null;
    previousAnswerText?: string | null;
  }): Promise<string> {
    const prompt = buildQuestionRenderingPrompt(input);

    try {
      const result = await runTextPrompt(input.sessionId, "question_render", prompt, {
        japaneseCheckMode: "text"
      });
      return (
        result.text.replace(/^["']|["']$/g, "") ||
        buildInterviewQuestionFallback({
          ...input,
          contextType:
            input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
          projectAiState: input.project.ai_state_json
        })
      );
    } catch {
      return buildInterviewQuestionFallback({
        ...input,
        contextType:
          input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
        projectAiState: input.project.ai_state_json
      });
    }
  },

  async analyzeAnswer(input: {
    sessionId: string;
    project: Project;
    question: Question;
    nextQuestion?: Question | null;
    answer: string;
    existingSlots: Record<string, string | null>;
    maxProbes: number;
    aiProbeEnabled: boolean;
    currentProbeCount: number;
  }): Promise<AnswerAnalysisResult> {
    const contextType =
      input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode;
    const projectAiState = getProjectAIState(input.project);
    const promptContext = resolveAnswerAnalysisContext({
      project: input.project,
      question: input.question,
      nextQuestion: input.nextQuestion,
      contextType
    });
    const meta = normalizeQuestionMeta(input.question, contextType, {
      projectAiState: input.project.ai_state_json
    });
    const nextMeta =
      input.nextQuestion && meta.can_prefill_future_slots
        ? normalizeQuestionMeta(
            input.nextQuestion,
            input.nextQuestion.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
            { projectAiState: input.project.ai_state_json }
          )
        : null;
    const allowedKeys = new Set([
      ...meta.expected_slots.map((slot) => slot.key),
      ...(nextMeta?.expected_slots ?? []).map((slot) => slot.key),
      ...projectAiState.required_slots.map((slot) => slot.key),
      ...projectAiState.optional_slots.map((slot) => slot.key)
    ]);
    const prompt = buildAnalyzeAnswerPrompt({
      ...input,
      maxProbes: input.maxProbes,
      aiProbeEnabled: input.aiProbeEnabled,
      currentProbeCount: input.currentProbeCount
    });

    const normalizeCollectedSlots = (rawValue: unknown): Record<string, string | null> => {
      const parsedSlots =
        rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
          ? (rawValue as Record<string, unknown>)
          : {};
      const filtered = Object.entries(parsedSlots).reduce<Record<string, string | null>>(
        (accumulator, [key, value]) => {
          if (allowedKeys.size > 0 && !allowedKeys.has(key)) {
            return accumulator;
          }
          accumulator[key] = typeof value === "string" && value.trim() ? value.trim() : null;
          return accumulator;
        },
        {}
      );

      return mergeSlotMaps(input.existingSlots, filtered);
    };

    const buildResult = (raw: {
      action?: unknown;
      question?: unknown;
      reason?: unknown;
      collected_slots?: unknown;
      is_sufficient?: unknown;
    } | null,
    confidenceFallback: number): AnswerAnalysisResult => {
      const collectedSlots = normalizeCollectedSlots(raw?.collected_slots);
      const extractedSlots = convertSlotMapToArray(collectedSlots);
      const assessment = assessProbeNeed({
        question: input.question,
        answerText: input.answer,
        extractedSlots,
        currentProbeCountForAnswer: input.currentProbeCount,
        contextType,
        projectAiState: input.project.ai_state_json
      });
      const completion = evaluateCompletion({
        question: input.question,
        answerText: input.answer,
        extractedSlots,
        contextType,
        projectAiState: input.project.ai_state_json
      });
      const currentQuestionSatisfied = completion.missing_slots.length === 0;
      const nextQuestionRequiredKeys =
        promptContext.next_question_required_slots.length > 0
          ? promptContext.next_question_required_slots.map((slot) => slot.key)
          : [];
      const nextQuestionSatisfied =
        nextQuestionRequiredKeys.length > 0 && nextQuestionRequiredKeys.every((key) => Boolean(collectedSlots[key]?.trim()));
      const projectCompletionRequiredKeys =
        promptContext.project_required_slot_keys.length > 0
          ? promptContext.project_required_slot_keys
          : Array.from(allowedKeys);
      const projectCompletionSatisfied =
        projectCompletionRequiredKeys.length > 0 &&
        projectCompletionRequiredKeys.every((key) => Boolean(collectedSlots[key]?.trim()));
      const canProbe =
        input.aiProbeEnabled &&
        input.currentProbeCount < input.maxProbes &&
        Boolean(assessment.probeType);
      const skipEligible =
        currentQuestionSatisfied &&
        nextQuestionSatisfied &&
        !assessment.isBadAnswer &&
        !assessment.isAbstract &&
        !assessment.isLowSpecificity;
      const derivedSufficient =
        currentQuestionSatisfied &&
        !assessment.isBadAnswer &&
        !assessment.isAbstract &&
        !assessment.isLowSpecificity;
      const parsedAction = sanitizeAction(raw?.action);
      const probeType = canProbe ? assessment.probeType : null;

      let action: AnswerAnalysisAction;
      if (projectCompletionSatisfied) {
        action = "finish";
      } else if (canProbe && assessment.shouldProbe) {
        action = "probe";
      } else if (skipEligible) {
        action = "skip";
      } else if (parsedAction === "finish" && projectCompletionSatisfied) {
        action = "finish";
      } else if (parsedAction === "probe" && canProbe) {
        action = "probe";
      } else if (parsedAction === "skip" && skipEligible) {
        action = "skip";
      } else {
        action = "ask_next";
      }

      const rawQuestion =
        typeof raw?.question === "string" && raw.question.trim() ? raw.question.trim() : null;
      const safeQuestion =
        action === "probe" && rawQuestion && !shouldRejectUserFacingQuestion(rawQuestion, input.project, Array.from(allowedKeys))
          ? rawQuestion
          : action === "probe"
            ? buildFallbackProbeQuestion({
                question: input.question,
                missingSlots: assessment.missingSlots,
                probeType,
                project: input.project
              })
            : null;
      const reason =
        typeof raw?.reason === "string" && raw.reason.trim()
          ? raw.reason.trim()
          : projectCompletionSatisfied
            ? "project_required_slots_filled"
            : action === "probe"
              ? assessment.missingSlots.length > 0
                ? `missing_slots:${assessment.missingSlots.join(",")}`
                : "insufficient_answer"
              : action === "skip"
                ? "current_and_next_required_slots_filled"
                : "continue_to_next_question";

      return {
        action,
        question: safeQuestion,
        reason,
        collected_slots: collectedSlots,
        is_sufficient: Boolean(raw?.is_sufficient) || derivedSufficient,
        missing_slots: completion.missing_slots,
        probe_type: probeType,
        confidence: clampConfidence((raw as { confidence?: unknown } | null)?.confidence, confidenceFallback)
      };
    };

    if (env.NODE_ENV === "development") {
      logger.info("analyzeAnswer.input", {
        sessionId: input.sessionId,
        questionCode: input.question.question_code,
        project_goal: promptContext.project_goal,
        current_question: input.question.question_text,
        user_answer: input.answer,
        required_slots: promptContext.required_slots.map((slot) => slot.key),
        optional_slots: promptContext.optional_slots.map((slot) => slot.key),
        existing_slots: input.existingSlots,
        max_probes: input.maxProbes,
        ai_probe_enabled: input.aiProbeEnabled,
        current_probe_count: input.currentProbeCount
      });
    }

    try {
      const result = await runTextPrompt(input.sessionId, "answer_analysis", prompt, {
        japaneseCheckMode: "json_values"
      });
      const parsed = parseJsonResponse<{
        action?: unknown;
        question?: unknown;
        reason?: unknown;
        collected_slots?: unknown;
        is_sufficient?: unknown;
        confidence?: unknown;
      }>(result.text);
      const normalized = buildResult(parsed, 0.7);

      if (env.NODE_ENV === "development") {
        logger.info("analyzeAnswer.output", {
          sessionId: input.sessionId,
          action: normalized.action,
          question: normalized.question,
          reason: normalized.reason,
          collected_slots: normalized.collected_slots,
          is_sufficient: normalized.is_sufficient
        });
      }

      return normalized;
    } catch (error) {
      const heuristic = buildHeuristicStructuredPayload({
        question: input.question,
        answerText: input.answer,
        source: input.currentProbeCount > 0 ? "ai_probe" : "primary",
        contextType,
        projectAiState: input.project.ai_state_json
      });
      const heuristicSlots = (heuristic.extracted_slots ?? []).reduce<Record<string, string | null>>(
        (accumulator, slot) => {
          accumulator[slot.key] = slot.value ?? null;
          return accumulator;
        },
        {}
      );
      const normalized = buildResult(
        {
          action: null,
          question: null,
          reason: "fallback_after_parse_error",
          collected_slots: mergeSlotMaps(input.existingSlots, heuristicSlots),
          is_sufficient: false
        },
        0.45
      );

      if (env.NODE_ENV === "development") {
        logger.warn("analyzeAnswer.fallback", {
          sessionId: input.sessionId,
          error: error instanceof Error ? error.message : String(error),
          action: normalized.action,
          collected_slots: normalized.collected_slots
        });
      }

      return normalized;
    }
  },

  async extractAnswerEntities(input: {
    sessionId: string;
    project: Project;
    question: Question;
    answer: string;
    extractionConfig: QuestionExtractionConfig;
    ruleResult: NormalizedExtractionResult;
  }): Promise<NormalizedExtractionResult | null> {
    const prompt = buildAnswerExtractionPrompt(input);

    try {
      const result = await runTextPrompt(input.sessionId, "answer_extraction", prompt, {
        japaneseCheckMode: "json_values"
      });
      const parsed = parseJsonResponse<Partial<NormalizedExtractionResult>>(result.text);

      return {
        mode:
          parsed.mode === "single_object" || parsed.mode === "multi_object" || parsed.mode === "none"
            ? parsed.mode
            : input.extractionConfig.mode ?? input.ruleResult.mode,
        status:
          parsed.status === "completed" ||
          parsed.status === "partial" ||
          parsed.status === "pending" ||
          parsed.status === "failed" ||
          parsed.status === "skipped"
            ? parsed.status
            : input.ruleResult.status,
        method: "ai_assisted",
        target:
          parsed.target === "post_answer" || parsed.target === "post_session"
            ? parsed.target
            : input.extractionConfig.target ?? input.ruleResult.target,
        schema_version:
          typeof parsed.schema_version === "string" ? parsed.schema_version : input.ruleResult.schema_version ?? null,
        summary:
          parsed.summary && typeof parsed.summary === "object" && !Array.isArray(parsed.summary)
            ? (parsed.summary as Record<string, unknown>)
            : input.ruleResult.summary,
        entities: Array.isArray(parsed.entities)
          ? parsed.entities
              .map((entity, index) => {
                const fields =
                  entity && typeof entity === "object" && "fields" in entity && entity.fields && typeof entity.fields === "object"
                    ? (entity.fields as Record<string, string | number | boolean | null>)
                    : {};
                return {
                  index:
                    entity && typeof entity === "object" && "index" in entity && typeof entity.index === "number"
                      ? entity.index
                      : index,
                  fields
                };
              })
          : input.ruleResult.entities,
        missing_fields: Array.isArray(parsed.missing_fields)
          ? parsed.missing_fields.map((item) => String(item))
          : input.ruleResult.missing_fields,
        needs_ai_assist:
          typeof parsed.needs_ai_assist === "boolean" ? parsed.needs_ai_assist : false,
        extracted_at: new Date().toISOString()
      };
    } catch {
      return null;
    }
  },

  async generateProbeQuestion(input: {
    sessionId: string;
    project: Project;
    question: string;
    answer: string;
    sessionSummary: string;
  }): Promise<string> {
    const prompt = buildProbePrompt(input);
    const result = await runTextPrompt(input.sessionId, "probe_generation", prompt, {
      japaneseCheckMode: "text"
    });
    return result.text.replace(/^["']|["']$/g, "");
  },

  async generateStructuredProbe(input: {
    sessionId: string;
    project: Project;
    question: Question;
    answer: string;
    extractedSlots: StructuredAnswerSlotValue[];
    completion: StructuredAnswerCompletion | null;
    probeType: StructuredProbeType;
    missingSlots: string[];
    previousAnswerText?: string | null;
    sessionSummary: string;
  }): Promise<{
    probe_question: string;
    probe_type: StructuredProbeType;
    focus: string;
  }> {
    const prompt = buildProbeGenerationPrompt(input);
    const result = await runTextPrompt(input.sessionId, "structured_probe_generation", prompt, {
      japaneseCheckMode: "json_values"
    });
    const parsed = parseJsonResponse<{
      probe_question?: string;
      probe_type?: StructuredProbeType;
      focus?: string;
    }>(result.text);

    return {
      probe_question: String(parsed.probe_question ?? "").trim(),
      probe_type: parsed.probe_type ?? input.probeType,
      focus: String(parsed.focus ?? "").trim()
    };
  },

  async fillAnswerSlots(input: {
    sessionId: string;
    project: Project;
    question: Question;
    answer: string;
    probeAnswer?: string | null;
    source: string;
    reason?: string | null;
    probeType?: StructuredProbeType | null;
  }): Promise<StructuredAnswerPayload> {
    const prompt = buildSlotFillingPrompt(input);

    try {
      const result = await runTextPrompt(input.sessionId, "slot_filling", prompt, {
        japaneseCheckMode: "json_values"
      });
      const parsed = parseJsonResponse<{
        structured_summary?: string;
        extracted_slots?: StructuredAnswerSlotValue[];
        comparable_payload?: Record<string, string | string[] | null>;
      }>(result.text);
      const extractedSlots = Array.isArray(parsed.extracted_slots) ? parsed.extracted_slots : [];
      const completion = evaluateCompletion({
        question: input.question,
        answerText: [input.answer, input.probeAnswer].filter(Boolean).join("\n"),
        extractedSlots,
        contextType:
          input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
        projectAiState: input.project.ai_state_json
      });

      return {
        ...buildHeuristicStructuredPayload({
          question: input.question,
          answerText: [input.answer, input.probeAnswer].filter(Boolean).join("\n"),
          source: input.source,
          reason: input.reason,
          probeType: input.probeType,
          contextType:
            input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
          projectAiState: input.project.ai_state_json
        }),
        structured_summary: parsed.structured_summary?.trim() || null,
        extracted_slots: extractedSlots,
        comparable_payload: parsed.comparable_payload ?? undefined,
        completion
      };
    } catch {
      return buildHeuristicStructuredPayload({
        question: input.question,
        answerText: [input.answer, input.probeAnswer].filter(Boolean).join("\n"),
        source: input.source,
        reason: input.reason,
        probeType: input.probeType,
        contextType:
          input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
        projectAiState: input.project.ai_state_json
      });
    }
  },

  async checkAnswerCompletion(input: {
    sessionId: string;
    project: Project;
    question: Question;
    answer: string;
    extractedSlots: StructuredAnswerSlotValue[];
  }): Promise<StructuredAnswerCompletion> {
    const prompt = buildCompletionCheckPrompt(input);

    try {
      const result = await runTextPrompt(input.sessionId, "completion_check", prompt, {
        japaneseCheckMode: "json_values"
      });
      const parsed = parseJsonResponse<{
        is_complete?: boolean;
        missing_slots?: string[];
        reasons?: string[];
        quality_score?: number;
      }>(result.text);

      return evaluateCompletion({
        question: input.question,
        answerText: input.answer,
        extractedSlots: input.extractedSlots,
        contextType:
          input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
        projectAiState: input.project.ai_state_json,
        qualityScore:
          typeof parsed.quality_score === "number" && Number.isFinite(parsed.quality_score)
            ? parsed.quality_score
            : null
      });
    } catch {
      return evaluateCompletion({
        question: input.question,
        answerText: input.answer,
        extractedSlots: input.extractedSlots,
        contextType:
          input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
        projectAiState: input.project.ai_state_json
      });
    }
  },

  async summarizeSession(input: {
    sessionId: string;
    project: Project;
    previousSummary: string;
    recentTranscript: string;
  }): Promise<string> {
    const prompt = buildSessionSummaryPrompt(input);
    const result = await runTextPrompt(input.sessionId, "session_summary", prompt, {
      japaneseCheckMode: "text"
    });
    return result.text;
  },

  async finalAnalyze(input: {
    sessionId: string;
    project: Project;
    sessionSummary: string;
    answers: Array<{
      question_code: string;
      question_text: string;
      answer_text: string;
      normalized_answer: Record<string, unknown> | null;
    }>;
  }): Promise<Record<string, unknown>> {
    const prompt = buildFinalStructuredSummaryPrompt(input);

    try {
      const result = await runTextPrompt(input.sessionId, "final_structured_summary", prompt, {
        japaneseCheckMode: "json_values"
      });
      return parseJsonResponse<Record<string, unknown>>(result.text);
    } catch {
      const fallbackPrompt = buildFinalAnalysisPrompt({
        project: input.project,
        sessionSummary: input.sessionSummary,
        answers: input.answers
          .map((answer) => `${answer.question_code}: ${answer.answer_text}`)
          .join("\n")
      });
      const fallback = await runTextPrompt(input.sessionId, "final_analysis", fallbackPrompt, {
        japaneseCheckMode: "json_values"
      });
      return parseJsonResponse<Record<string, unknown>>(fallback.text);
    }
  },

  async generateProjectAnalysis(input: {
    project: Project;
    respondentSummaries: Array<{
      respondent_id: string;
      respondent_name: string;
      line_user_id: string;
      session_id: string;
      session_status: string;
      completed_at: string | null;
      summary: string;
    }>;
    comparisonUnits: Array<{
      question_code: string;
      question_order: number;
      question_text: string;
      question_role: string;
      question_type: string;
      aggregation_type: string;
      response_count: number;
      values: Array<{ label: string; count: number }>;
      note: string;
    }>;
    freeAnswerPolicy: {
      policy: string;
      target_question_codes: string[];
    };
  }): Promise<Record<string, unknown>> {
    const prompt = buildProjectAnalysisPrompt(input);
    const response = await openai.responses.create({
      model: env.OPENAI_MODEL,
      input: [buildJapaneseSystemInstruction("project_analysis"), prompt].join("\n\n")
    });

    return JSON.parse(response.output_text.trim()) as Record<string, unknown>;
  },

  async analyzePost(input: {
    postId: string;
    postType: string;
    sourceMode: string | null;
    content: string;
  }): Promise<{
    summary?: string;
    tags?: string[];
    sentiment?: "positive" | "neutral" | "negative" | "mixed";
    keywords?: string[];
    actionability?: "high" | "medium" | "low";
    insight_type?: "issue" | "request" | "complaint" | "praise" | "other" | string;
    specificity?: number;
    novelty?: number;
  }> {
    const prompt = buildPostAnalysisPrompt(input);
    const response = await openai.responses.create({
      model: env.OPENAI_MODEL,
      input: [buildJapaneseSystemInstruction("post_analysis"), prompt].join("\n\n")
    });
    return JSON.parse(response.output_text.trim()) as {
      summary?: string;
      tags?: string[];
      sentiment?: "positive" | "neutral" | "negative" | "mixed";
      keywords?: string[];
      actionability?: "high" | "medium" | "low";
      insight_type?: "issue" | "request" | "complaint" | "praise" | "other" | string;
      specificity?: number;
      novelty?: number;
    };
  }
};
