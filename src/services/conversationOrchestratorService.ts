import { env } from "../config/env";
import { evaluateProjectSlotCompletion } from "../lib/projectAiState";
import {
  buildCompletedSessionText,
  buildEmptyAnswerText,
  buildHelpText,
  buildInvalidAnswerText,
  buildNoActiveSessionText,
  buildNonTextInputText,
  buildRestartAfterCompletionText,
  buildRestartedSessionText,
  buildResumeExistingSessionText,
  buildStoppedSessionText,
  detectConversationCommand
} from "../lib/conversationControl";
import {
  evaluateCompletion,
  evaluateQuestionSlotProgress,
  mergeSlotMaps,
  normalizeQuestionMeta
} from "../lib/questionMetadata";
import { normalizeBranchRule } from "../lib/questionDesign";
import { getProjectResearchSettings } from "../lib/projectResearch";
import { logger } from "../lib/logger";
import { answerRepository } from "../repositories/answerRepository";
import { messageRepository } from "../repositories/messageRepository";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { buildMypageLiffFlex, buildRankFlex, buildWelcomeMessages } from "../templates/flex";
import { liffService } from "./liffService";
import type {
  AnswerAnalysisAction,
  LineMessage,
  PendingNextQuestionCache,
  Project,
  Question,
  ResearchMode,
  Session,
  StructuredAnswerPayload,
  StructuredProbeType
} from "../types/domain";
import { analysisService } from "./analysisService";
import { aiService } from "./aiService";
import { answerExtractionService } from "./answerExtractionService";
import { lineMessagingService } from "./lineMessagingService";
import { menuActionServiceDb } from "./menuActionServiceDb";
import { pointService } from "./pointService";
import { assignmentService } from "./assignmentService";
import { screeningService } from "./screeningService";
import { postService } from "./postService";
import { questionFlowService } from "./questionFlowServiceV2";
import { rankService } from "./rankService";
import { respondentService } from "./respondentService";

function buildTextMessage(text: string): LineMessage {
  return { type: "text", text };
}

interface TurnDiagnostics {
  sessionId: string | null;
  startedAt: number;
  aiCallCount: number;
  aiPurposes: string[];
  actionPath: string[];
}

function createTurnDiagnostics(sessionId: string | null = null): TurnDiagnostics {
  return {
    sessionId,
    startedAt: Date.now(),
    aiCallCount: 0,
    aiPurposes: [],
    actionPath: []
  };
}

function recordAiCall(diagnostics: TurnDiagnostics | undefined, purpose: string): void {
  if (!diagnostics) {
    return;
  }

  diagnostics.aiCallCount += 1;
  diagnostics.aiPurposes.push(purpose);
}

function recordActionPath(diagnostics: TurnDiagnostics | undefined, step: string): void {
  if (!diagnostics) {
    return;
  }

  diagnostics.actionPath = [step];
}

function logTurnDiagnostics(diagnostics: TurnDiagnostics | undefined, phase: string): void {
  if (!diagnostics?.sessionId || env.NODE_ENV !== "development") {
    return;
  }

  logger.info("conversation.turn", {
    sessionId: diagnostics.sessionId,
    phase,
    elapsed_ms: Date.now() - diagnostics.startedAt,
    ai_call_count: diagnostics.aiCallCount,
    ai_call_purposes: diagnostics.aiPurposes,
    action_path: diagnostics.actionPath
  });
}

function runDeferredTask(
  taskName: string,
  task: () => Promise<void>,
  context: Record<string, unknown> = {}
): void {
  void Promise.resolve()
    .then(task)
    .catch((error) => {
      logger.warn(taskName, {
        ...context,
        error: error instanceof Error ? error.message : String(error)
      });
    });
}

async function replyWithTiming(input: {
  replyToken: string;
  messages: LineMessage[];
  label: string;
  diagnostics?: TurnDiagnostics;
  sessionId?: string | null;
}): Promise<void> {
  const sessionId = input.diagnostics?.sessionId ?? input.sessionId ?? null;
  const replyStartedAt = Date.now();

  if (env.NODE_ENV === "development") {
    logger.info("line.reply.start", {
      sessionId,
      label: input.label,
      started_at: new Date(replyStartedAt).toISOString(),
      elapsed_before_reply_ms: input.diagnostics ? replyStartedAt - input.diagnostics.startedAt : null
    });
  }

  await lineMessagingService.reply(input.replyToken, input.messages);

  if (env.NODE_ENV === "development") {
    const replyCompletedAt = Date.now();
    logger.info("line.reply.end", {
      sessionId,
      label: input.label,
      completed_at: new Date(replyCompletedAt).toISOString(),
      reply_elapsed_ms: replyCompletedAt - replyStartedAt,
      total_processing_ms: input.diagnostics ? replyCompletedAt - input.diagnostics.startedAt : null
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- PendingNextQuestionCache helpers ---

function computeSimpleHash(value: unknown): string {
  const str = JSON.stringify(
    value === null || value === undefined ? null : value,
    Object.keys(typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}).sort()
  );
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return String(hash >>> 0);
}

function buildFlowSignature(branchRule: Question["branch_rule"]): string {
  return computeSimpleHash(branchRule);
}

function buildCollectedFieldSignature(slotMap: Record<string, string | null>): string {
  const entries = Object.entries(slotMap)
    .filter(([, v]) => typeof v === "string" && Boolean(v.trim()))
    .sort(([a], [b]) => a.localeCompare(b));
  return computeSimpleHash(entries);
}

function buildNextQuestionCache(input: {
  sessionId: string;
  nextQuestion: Question;
  collectedSlotMap: Record<string, string | null>;
  questionText: string | null;
  hasBranching: boolean;
  hasSkip: boolean;
}): PendingNextQuestionCache {
  const renderStrategy = input.nextQuestion.render_strategy ?? "static";
  return {
    sessionId: input.sessionId,
    nextQuestionId: input.nextQuestion.id,
    nextQuestionVersion: input.nextQuestion.updated_at,
    flowSignature: buildFlowSignature(input.nextQuestion.branch_rule),
    collectedFieldSignature: buildCollectedFieldSignature(input.collectedSlotMap),
    renderStrategy,
    renderKey: input.nextQuestion.id,
    questionText:
      renderStrategy === "static" && !input.hasBranching && !input.hasSkip && input.questionText
        ? input.questionText
        : undefined,
    createdAt: new Date().toISOString()
  };
}

function canReuseQuestionText(
  cache: PendingNextQuestionCache,
  sessionId: string,
  question: Question,
  currentSlotMap: Record<string, string | null>,
  opts: { hasBranching: boolean; hasSkip: boolean; resumedSession: boolean }
): boolean {
  return (
    cache.sessionId === sessionId &&
    cache.nextQuestionId === question.id &&
    cache.nextQuestionVersion === question.updated_at &&
    cache.flowSignature === buildFlowSignature(question.branch_rule) &&
    cache.collectedFieldSignature === buildCollectedFieldSignature(currentSlotMap) &&
    cache.renderStrategy === "static" &&
    !opts.hasBranching &&
    !opts.hasSkip &&
    !opts.resumedSession &&
    typeof cache.questionText === "string" &&
    Boolean(cache.questionText.trim())
  );
}

// Structured per-turn log per spec section 8
function logTurnResult(input: {
  sessionId: string;
  questionId: string;
  questionType: string;
  mode: ResearchMode;
  usedInterviewTurn: boolean;
  probeExecuted: boolean;
  probeReason: string | null;
  skippedReason: string | null;
  usedCache: boolean;
  cacheType: "text" | "id" | "none";
  collectedFieldSignature: string;
}): void {
  logger.info("conversation.turn_result", input);
}

function normalizeQuestionText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

function buildQuestionEmbedding(text: string): string[] {
  const normalized = normalizeQuestionText(text);
  if (!normalized) {
    return [];
  }
  if (normalized.length < 2) {
    return [normalized];
  }

  const tokens = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    tokens.add(normalized.slice(index, index + 2));
  }
  return [...tokens];
}

function calculateQuestionSimilarity(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0;
  }

  const rightSet = new Set(right);
  const overlap = left.filter((token) => rightSet.has(token)).length;
  return overlap / Math.max(left.length, right.length);
}

function withQuestionMemory(
  state: Session["state_json"],
  prompt: string,
  probeType: StructuredProbeType | null
): Session["state_json"] {
  return {
    ...state,
    lastQuestionText: prompt,
    lastQuestionEmbedding: buildQuestionEmbedding(prompt),
    lastProbeType: probeType
  };
}

function isQuestionSimilarToLast(session: Session, prompt: string): boolean {
  const currentEmbedding = buildQuestionEmbedding(prompt);
  const previousEmbedding = session.state_json?.lastQuestionEmbedding ?? [];
  return calculateQuestionSimilarity(previousEmbedding, currentEmbedding) > 0.8;
}

async function resolveQuestionIndex(projectId: string, questionId: string | null): Promise<number | null> {
  if (!questionId) {
    return null;
  }

  const questions = await questionFlowService.listByProject(projectId);
  const index = questions.findIndex((question) => question.id === questionId);
  return index >= 0 ? index : null;
}

function buildCombinedFreeComment(primaryText: string, followUpTexts: string[] = []): string {
  const base = primaryText.trim();
  const normalizedFollowUps = followUpTexts.map((value) => value.trim()).filter(Boolean);
  if (normalizedFollowUps.length === 0) {
    return base;
  }

  return [base, ...normalizedFollowUps.map((value, index) => `Follow-up ${index + 1}: ${value}`)].join("\n\n");
}

function buildAggregateProbeAnswerText(probeAnswers: string[]): string | null {
  const normalized = probeAnswers.map((value) => value.trim()).filter(Boolean);
  return normalized.length > 0 ? normalized.join("\n") : null;
}

function resolveQuestionMetaContext(question: Question, projectMode: ResearchMode) {
  return question.question_role === "free_comment" ? "free_comment" : projectMode;
}

function resolveTextProbeBudget(input: {
  project: Project;
  settings: ReturnType<typeof getProjectResearchSettings>;
  question: Question;
  currentProbeCountForAnswer: number;
  currentProbeCountForSession: number;
}) {
  const contextType = resolveQuestionMetaContext(input.question, input.project.research_mode);
  const meta = normalizeQuestionMeta(input.question, contextType, {
    projectAiState: input.project.ai_state_json
  });
  const maxProbesPerSession = Math.min(
    env.MAX_AI_PROBES_PER_SESSION,
    input.settings.probe_policy.max_probes_per_session
  );
  const maxProbesPerAnswer = Math.min(
    env.MAX_AI_PROBES_PER_ANSWER,
    input.settings.probe_policy.max_probes_per_answer,
    meta.probe_config.max_probes
  );

  return {
    contextType,
    meta,
    maxProbesPerSession,
    maxProbesPerAnswer,
    canProbe:
      input.currentProbeCountForSession < maxProbesPerSession &&
      input.currentProbeCountForAnswer < maxProbesPerAnswer
  };
}

function extractSlotMap(normalizedAnswer: Record<string, unknown> | null | undefined): Record<string, string | null> {
  if (
    normalizedAnswer?.extracted_slot_map &&
    typeof normalizedAnswer.extracted_slot_map === "object" &&
    !Array.isArray(normalizedAnswer.extracted_slot_map)
  ) {
    return Object.entries(normalizedAnswer.extracted_slot_map as Record<string, unknown>).reduce<
      Record<string, string | null>
    >((accumulator, [key, value]) => {
      accumulator[key] = typeof value === "string" && value.trim() ? value.trim() : null;
      return accumulator;
    }, {});
  }

  if (Array.isArray(normalizedAnswer?.extracted_slots)) {
    return (normalizedAnswer.extracted_slots as Array<{ key?: unknown; value?: unknown }>).reduce<
      Record<string, string | null>
    >((accumulator, slot) => {
      const key = typeof slot.key === "string" ? slot.key.trim() : "";
      if (!key) {
        return accumulator;
      }
      accumulator[key] = typeof slot.value === "string" && slot.value.trim() ? slot.value.trim() : null;
      return accumulator;
    }, {});
  }

  return {};
}

function canSkipFutureQuestions(input: {
  question: Question;
  questionProgress: ReturnType<typeof evaluateQuestionSlotProgress>;
  projectMode: ResearchMode;
  projectAiState: Project["ai_state_json"] | null;
}): boolean {
  const meta = normalizeQuestionMeta(input.question, resolveQuestionMetaContext(input.question, input.projectMode), {
    projectAiState: input.projectAiState
  });
  return (
    meta.can_prefill_future_slots &&
    input.questionProgress.isCurrentQuestionSatisfied &&
    !input.questionProgress.isBadAnswer &&
    !input.questionProgress.isAbstract
  );
}

async function buildSessionSlotMap(sessionId: string): Promise<Record<string, string | null>> {
  const answers = await answerRepository.listBySession(sessionId);
  return answers
    .filter((answer) => answer.answer_role === "primary")
    .reduce<Record<string, string | null>>((accumulator, answer) => {
      return mergeSlotMaps(accumulator, extractSlotMap(answer.normalized_answer));
    }, {});
}

function shouldSkipQuestionBySlots(input: {
  question: Question;
  aggregateSlotMap: Record<string, string | null>;
  projectMode: ResearchMode;
  projectAiState: Project["ai_state_json"] | null;
}): boolean {
  const meta = normalizeQuestionMeta(input.question, resolveQuestionMetaContext(input.question, input.projectMode), {
    projectAiState: input.projectAiState
  });
  const requiredSlots = meta.skippable_if_slots_present;
  if (requiredSlots.length === 0) {
    return false;
  }

  return requiredSlots.every((key) => typeof input.aggregateSlotMap[key] === "string" && Boolean(input.aggregateSlotMap[key]?.trim()));
}

async function evaluateAnswerProgressForSession(input: {
  session: Session;
  project: Project;
  question: Question;
  answerText: string;
}): Promise<{
  sessionSlotMap: Record<string, string | null>;
  questionProgress: ReturnType<typeof evaluateQuestionSlotProgress>;
  allowSkippingFutureQuestions: boolean;
}> {
  const sessionSlotMap = await buildSessionSlotMap(input.session.id);
  const questionProgress = evaluateQuestionSlotProgress({
    question: input.question,
    slotMap: sessionSlotMap,
    answerText: input.answerText,
    contextType: resolveQuestionMetaContext(input.question, input.project.research_mode),
    projectAiState: input.project.ai_state_json
  });

  return {
    sessionSlotMap,
    questionProgress,
    allowSkippingFutureQuestions: canSkipFutureQuestions({
      question: input.question,
      questionProgress,
      projectMode: input.project.research_mode,
      projectAiState: input.project.ai_state_json
    })
  };
}

async function listProbeAnswersForSource(sessionId: string, sourceAnswerId: string): Promise<string[]> {
  const answers = await answerRepository.listBySession(sessionId);
  return answers
    .filter((answer) => answer.answer_role === "ai_probe" && answer.parent_answer_id === sourceAnswerId)
    .map((answer) => answer.answer_text);
}

function buildFreeCommentPrompt(): string {
  return "最後に、ここまでで話しきれなかったことがあれば自由に教えてください。";
}
async function resolveProjectContext(projectId: string) {
  const project = await projectRepository.getById(projectId);
  return {
    project,
    settings: getProjectResearchSettings(project)
  };
}

function buildStructuredProbeFallback(input: {
  question: Question;
  probeType: StructuredProbeType;
  missingSlots?: string[];
  projectMode?: ResearchMode;
  projectAiState?: Project["ai_state_json"] | null;
}): string {
  const meta = normalizeQuestionMeta(
    input.question,
    input.projectMode ? resolveQuestionMetaContext(input.question, input.projectMode) : undefined,
    { projectAiState: input.projectAiState }
  );
  const firstMissingSlot = input.missingSlots?.[0];
  const rawSlotLabel =
    meta.expected_slots.find((slot) => slot.key === firstMissingSlot)?.label ??
    meta.expected_slots.find((slot) => slot.key === firstMissingSlot)?.description ??
    firstMissingSlot ??
    "その点";
  const slotLabel = /^[a-z][a-z0-9_]*$/i.test(rawSlotLabel) ? "その点" : rawSlotLabel;
  const conversational = true; // both survey_interview and interview use conversational phrasing

  switch (input.probeType) {
    case "missing_slot":
      return conversational
        ? `${slotLabel}について、もう少し具体的に教えてください。`
        : `${slotLabel}を補足してください。`;
    case "clarify":
      return conversational
        ? "今のご回答の意味が伝わるように、もう少し詳しく教えてください。"
        : "補足として、もう少しわかるように教えてください。";
    default:
      return conversational
        ? "そのときの状況や理由がわかる具体例を1つ教えてください。"
        : "補足として、具体例を1つ教えてください。";
  }
}
async function resolveConversationRespondent(lineUserId: string, displayName?: string | null) {
  const assignmentContext = await assignmentService.resolveConversationContext(lineUserId, displayName);
  if (assignmentContext) {
    return assignmentContext;
  }

  const respondent = await respondentService.ensureRespondent(lineUserId, displayName);
  return {
    respondent,
    assignment: null
  };
}

async function resolvePreviousQuestionContext(session: Session): Promise<{
  previousQuestionText: string | null;
  previousAnswerText: string | null;
}> {
  const answers = await answerRepository.listBySession(session.id);
  const primaryAnswers = answers.filter((answer) => answer.answer_role === "primary");
  const previousAnswer = primaryAnswers[primaryAnswers.length - 1] ?? null;

  if (!previousAnswer) {
    return {
      previousQuestionText: null,
      previousAnswerText: null
    };
  }

  const previousQuestion = await questionFlowService.getQuestion(previousAnswer.question_id);
  return {
    previousQuestionText: previousQuestion.question_text,
    previousAnswerText: previousAnswer.answer_text
  };
}

async function questionPrompt(
  session: Session,
  question: Question,
  diagnostics?: TurnDiagnostics
): Promise<string> {
  if (question.question_role === "free_comment") {
    return question.question_text?.trim() || buildFreeCommentPrompt();
  }

  const [questions, project] = await Promise.all([
    questionFlowService.listByProject(session.project_id),
    projectRepository.getById(session.project_id)
  ]);
  const currentIndex = questions.findIndex((item) => item.id === question.id) + 1;
  const progressLabel =
    project.research_mode === "interview" ? undefined : `Q${currentIndex}/${questions.length}`;

  if (project.research_mode === "interview" && question.question_type === "text") {
    // Try structured cache first (PendingNextQuestionCache)
    const cache = session.state_json?.pendingNextQuestionCache;
    if (cache && cache.sessionId === session.id && cache.nextQuestionId === question.id) {
      const currentSlotMap = await buildSessionSlotMap(session.id);
      const useText = canReuseQuestionText(cache, session.id, question, currentSlotMap, {
        hasBranching: false,
        hasSkip: false,
        resumedSession: false
      });
      if (useText && cache.questionText) {
        return cache.questionText;
      }
      // id matches but text not reusable (dynamic) — fall through to AI render
    }
    // Fallback: legacy pendingNextQuestionText (single-use, no validation)
    const legacyCached = session.state_json?.pendingNextQuestionText;
    if (typeof legacyCached === "string" && legacyCached.trim()) {
      return legacyCached;
    }
    const previousContext = await resolvePreviousQuestionContext(session);
    recordAiCall(diagnostics, "renderQuestion");
    return aiService.renderQuestion({
      sessionId: session.id,
      project,
      question,
      previousQuestionText: previousContext.previousQuestionText,
      previousAnswerText: previousContext.previousAnswerText
    });
  }

  return questionFlowService.renderQuestion(question, progressLabel);
}

async function currentPromptForSession(session: Session): Promise<string | null> {
  if (session.current_phase === "ai_probe" && session.state_json?.pendingProbeQuestion) {
    return session.state_json.pendingProbeQuestion;
  }

  if (session.current_phase === "free_comment" && session.state_json?.pendingFreeComment) {
    if (session.state_json.pendingFreeCommentPrompt) {
      return session.state_json.pendingFreeCommentPrompt;
    }

    if (!session.current_question_id) {
      return null;
    }

    const freeCommentQuestion = await questionFlowService.getQuestion(session.current_question_id);
    return questionPrompt(session, freeCommentQuestion);
  }

  if (!session.current_question_id) {
    return null;
  }

  const currentQuestion = await questionFlowService.getQuestion(session.current_question_id);
  return questionPrompt(session, currentQuestion);
}

function buildStructuredSlotArray(slotMap: Record<string, string | null>) {
  return Object.entries(slotMap).map(([key, value]) => ({
    key,
    value,
    confidence: value ? 0.8 : null,
    evidence: value
  }));
}

function extractAnalysisAction(normalizedAnswer: Record<string, unknown> | null | undefined): AnswerAnalysisAction | null {
  const action = normalizedAnswer?.analysis_action;
  return action === "ask_next" || action === "probe" || action === "skip" || action === "finish"
    ? action
    : null;
}

function extractSuggestedProbeQuestion(normalizedAnswer: Record<string, unknown> | null | undefined): string | null {
  return typeof normalizedAnswer?.suggested_probe_question === "string" &&
    normalizedAnswer.suggested_probe_question.trim()
    ? normalizedAnswer.suggested_probe_question.trim()
    : null;
}

function extractCompletionMissingSlots(
  normalizedAnswer: Record<string, unknown> | null | undefined
): string[] {
  const completion =
    normalizedAnswer?.completion &&
    typeof normalizedAnswer.completion === "object" &&
    !Array.isArray(normalizedAnswer.completion)
      ? (normalizedAnswer.completion as Record<string, unknown>)
      : null;

  if (!Array.isArray(completion?.missing_slots)) {
    return [];
  }

  return completion.missing_slots.map((slot) => String(slot)).filter(Boolean);
}

async function buildStructuredAnswer(input: {
  session: Session;
  question: Question;
  nextQuestion?: Question | null;
  projectId: string;
  answerText: string;
  source: string;
  reason?: string | null;
  probeType?: StructuredProbeType | null;
  probeAnswer?: string | null;
  baseNormalized?: Record<string, unknown> | null;
  probeCount?: number;
  existingSlots?: Record<string, string | null>;
  diagnostics?: TurnDiagnostics;
}): Promise<Record<string, unknown>> {
  const project = await projectRepository.getById(input.projectId);
  const settings = getProjectResearchSettings(project);
  const baseNormalized = input.baseNormalized ?? {};

  if (input.question.question_type !== "text") {
    return {
      ...baseNormalized,
      source: input.source,
      reason: input.reason ?? null,
      probe_type: input.probeType ?? null,
      metadata_version: "v2"
    };
  }

  const combinedAnswer = [input.answerText, input.probeAnswer].filter(Boolean).join("\n");
  const sessionSlotMap = await buildSessionSlotMap(input.session.id);
  const existingSlots = mergeSlotMaps(
    sessionSlotMap,
    input.existingSlots ?? extractSlotMap(input.baseNormalized)
  );
  const contextType = resolveQuestionMetaContext(input.question, project.research_mode);
  const meta = normalizeQuestionMeta(input.question, contextType, {
    projectAiState: project.ai_state_json
  });
  // survey_interview: probe only if ai_probe_enabled === true (strict)
  // interview: probe if ai_probe_enabled !== false (lenient default)
  const aiProbeAllowed = project.research_mode === "interview"
    ? input.question.ai_probe_enabled !== false
    : input.question.ai_probe_enabled === true;
  const aiProbeEnabled =
    aiProbeAllowed &&
    settings.probe_policy.enabled &&
    meta.probe_config.max_probes > 0;
  let answerAnalysis: Awaited<ReturnType<typeof aiService.analyzeAnswer>>;

  if (project.research_mode === "interview") {
    // interview mode: single AI call controls full turn
    recordAiCall(input.diagnostics, "interviewTurn");
    try {
      const turnResult = await aiService.interviewTurn({
        sessionId: input.session.id,
        project,
        question: input.question,
        answer: combinedAnswer,
        nextQuestion: input.nextQuestion,
        existingSlots,
        currentProbeCount: input.probeCount ?? 0,
        maxProbes: meta.probe_config.max_probes,
        aiProbeEnabled,
        conversationSummary: input.session.summary ?? null
      });
      answerAnalysis = {
        action: turnResult.action,
        question: turnResult.response_text,
        reason: turnResult.reason,
        collected_slots: turnResult.collected_slots,
        is_sufficient: turnResult.action !== "probe",
        missing_slots: [],
        probe_type: turnResult.action === "probe" ? "clarify" : null,
        confidence: 0.8
      };
    } catch {
      // interview fallback: AI failed → use fixed text for next question
      logger.warn("buildStructuredAnswer.interviewTurn.fallback", { sessionId: input.session.id });
      answerAnalysis = {
        action: "ask_next",
        question: null,
        reason: "interview_turn_fallback",
        collected_slots: existingSlots,
        is_sufficient: true,
        missing_slots: [],
        probe_type: null,
        confidence: 0.3
      };
    }
  } else {
    // survey_interview: AI is probe-assist only; flow controls next question
    recordAiCall(input.diagnostics, "analyzeAnswer");
    try {
      answerAnalysis = await aiService.analyzeAnswer({
        sessionId: input.session.id,
        project,
        question: input.question,
        nextQuestion: input.nextQuestion,
        answer: combinedAnswer,
        existingSlots,
        maxProbes: meta.probe_config.max_probes,
        aiProbeEnabled,
        currentProbeCount: input.probeCount ?? 0
      });
    } catch {
      // survey_interview fallback: AI failed → skip probe, continue to next question
      logger.warn("buildStructuredAnswer.analyzeAnswer.fallback", { sessionId: input.session.id });
      answerAnalysis = {
        action: "ask_next",
        question: null,
        reason: "survey_interview_ai_fallback",
        collected_slots: existingSlots,
        is_sufficient: true,
        missing_slots: [],
        probe_type: null,
        confidence: 0.3
      };
    }
  }
  recordActionPath(
    input.diagnostics,
    `analyze:${answerAnalysis.action}:${answerAnalysis.reason}`
  );
  if (env.NODE_ENV === "development") {
    logger.info("conversation.answer_analysis", {
      sessionId: input.session.id,
      questionCode: input.question.question_code,
      action: answerAnalysis.action,
      reason: answerAnalysis.reason,
      collected_slots: answerAnalysis.collected_slots
    });
  }
  const extractedSlotMap = answerAnalysis.collected_slots;
  const extractedSlots = buildStructuredSlotArray(extractedSlotMap);
  const currentProgress = evaluateQuestionSlotProgress({
    question: input.question,
    slotMap: extractedSlotMap,
    answerText: combinedAnswer,
    contextType,
    projectAiState: project.ai_state_json
  });
  const nextProgress = input.nextQuestion
    ? evaluateQuestionSlotProgress({
        question: input.nextQuestion,
        slotMap: extractedSlotMap,
        answerText: combinedAnswer,
        contextType: resolveQuestionMetaContext(input.nextQuestion, project.research_mode),
        projectAiState: project.ai_state_json
      })
    : null;
  const heuristicCompletion = evaluateCompletion({
    question: input.question,
    answerText: combinedAnswer,
    extractedSlots,
    contextType,
    projectAiState: project.ai_state_json
  });
  const completion = {
    is_complete:
      answerAnalysis.is_sufficient &&
      answerAnalysis.action !== "probe" &&
      heuristicCompletion.missing_slots.length === 0,
    missing_slots: Array.from(
      new Set([...answerAnalysis.missing_slots, ...heuristicCompletion.missing_slots])
    ),
    reasons: Array.from(
      new Set([
        ...heuristicCompletion.reasons,
        ...(answerAnalysis.action === "probe" ? ["needs_probe"] : [])
      ])
    ),
    quality_score: heuristicCompletion.quality_score
  };

  return {
    ...baseNormalized,
    value: input.answerText,
    source: input.source,
    reason: input.reason ?? null,
    probe_type: input.probeType ?? null,
    structured_summary: combinedAnswer || null,
    completion,
    extracted_slots: extractedSlots,
    extracted_slot_map: extractedSlotMap,
    comparable_payload: extractedSlotMap,
    metadata_version: "v3",
    analysis_confidence: answerAnalysis.confidence,
    analysis_action: answerAnalysis.action,
    analysis_reason: answerAnalysis.reason,
    analysis_question: answerAnalysis.question,
    is_sufficient: answerAnalysis.is_sufficient,
    needs_probe: answerAnalysis.action === "probe",
    suggested_probe_type: answerAnalysis.probe_type,
    suggested_probe_question: answerAnalysis.question,
    pending_next_question_text:
      answerAnalysis.action === "ask_next" && answerAnalysis.question ? answerAnalysis.question : null,
    question_code: input.question.question_code,
    slot_progress: {
      current_question: currentProgress,
      next_question: input.nextQuestion
        ? {
            question_code: input.nextQuestion.question_code,
            ...nextProgress
          }
        : null
    }
  };
}

async function logAssistantMessage(sessionId: string, text: string): Promise<void> {
  await messageRepository.create({
    session_id: sessionId,
    sender_type: "assistant",
    message_text: text,
    raw_payload: null
  });
}

async function logSystemMessage(
  sessionId: string,
  messageText: string,
  rawPayload: Record<string, unknown> | null = null
): Promise<void> {
  await messageRepository.create({
    session_id: sessionId,
    sender_type: "system",
    message_text: messageText,
    raw_payload: rawPayload
  });
}

async function enterFreeCommentPhase(input: {
  session: Session;
  replyToken: string;
  diagnostics?: TurnDiagnostics;
}): Promise<void> {
  const freeCommentQuestion =
    (await questionRepository.getSystemFreeCommentQuestion(input.session.project_id)) ??
    (await questionRepository.ensureSystemFreeCommentQuestion(input.session.project_id));
  const sessionForPrompt = {
    ...input.session,
    current_question_id: freeCommentQuestion.id,
    current_phase: "free_comment" as const
  };
  const prompt = await questionPrompt(sessionForPrompt, freeCommentQuestion, input.diagnostics);
  await replyWithTiming({
    replyToken: input.replyToken,
    messages: [buildTextMessage(prompt)],
    label: "enter_free_comment",
    diagnostics: input.diagnostics,
    sessionId: input.session.id
  });

  const nextSession = await sessionRepository.update(input.session.id, {
    current_question_id: freeCommentQuestion.id,
    current_phase: "free_comment",
    state_json: {
      ...withQuestionMemory(input.session.state_json, prompt, null),
      phase: "free_comment",
      currentQuestionIndex: await resolveQuestionIndex(input.session.project_id, freeCommentQuestion.id),
      pendingQuestionId: null,
      pendingProbeQuestion: null,
      pendingProbeSourceQuestionId: null,
      pendingProbeSourceAnswerId: null,
      pendingProbeReason: null,
      pendingProbeType: null,
      pendingProbeMissingSlots: [],
      pendingFreeComment: true,
      freeCommentPromptShown: true,
      freeCommentProbeAsked: false,
      pendingFreeCommentPrompt: prompt,
      pendingFreeCommentSourceAnswerId: null,
      pendingFreeCommentSourceText: null,
      pendingFreeCommentReason: null,
      pendingFreeCommentProbeType: null,
      pendingFreeCommentMissingSlots: [],
      finalQuestionCompletedAt: new Date().toISOString(),
      aiProbeCountCurrentAnswer: 0
    }
  });

  await logAssistantMessage(nextSession.id, prompt);
}

async function refreshSummaryIfNeeded(session: Session): Promise<Session> {
  const answersSinceSummary = session.state_json?.answersSinceSummary ?? 0;
  if (answersSinceSummary < env.SESSION_SUMMARY_INTERVAL) {
    return session;
  }

  const answers = await answerRepository.listBySession(session.id);
  const recentTranscript = answers
    .slice(-env.SESSION_SUMMARY_INTERVAL)
    .map((answer) => `${answer.question_id}: ${answer.answer_text}`)
    .join(" / ");
  const summary = [session.summary ?? "", recentTranscript].filter(Boolean).join(" / ").slice(-800);

  return sessionRepository.update(session.id, {
    summary,
    state_json: {
      ...session.state_json,
      answersSinceSummary: 0
    }
  });
}

async function ensureRespondentActive(respondentId: string): Promise<void> {
  await respondentRepository.update(respondentId, { status: "active" });
}

async function abandonSession(
  session: Session,
  reason: string,
  rawPayload: Record<string, unknown> | null = null
): Promise<Session> {
  const updated = await sessionRepository.update(session.id, {
    status: "abandoned",
    current_phase: "completed",
    current_question_id: null,
    state_json: {
      ...session.state_json,
      phase: "completed",
      pendingQuestionId: null,
      pendingProbeQuestion: null,
      pendingProbeSourceQuestionId: null,
      pendingProbeSourceAnswerId: null,
      pendingProbeReason: null,
      pendingProbeType: null,
      pendingProbeMissingSlots: [],
      pendingFreeComment: false,
      freeCommentPromptShown: false,
      freeCommentProbeAsked: false,
      pendingFreeCommentPrompt: null,
      pendingFreeCommentSourceAnswerId: null,
      pendingFreeCommentSourceText: null,
      pendingFreeCommentReason: null,
      pendingFreeCommentProbeType: null,
      pendingFreeCommentMissingSlots: [],
      finalQuestionCompletedAt: null,
      aiProbeCountCurrentAnswer: 0
    }
  });
  await logSystemMessage(session.id, reason, rawPayload);
  return updated;
}

async function completeSession(session: Session, lineUserId: string): Promise<LineMessage[]> {
  const project = await projectRepository.getById(session.project_id);
  const respondent = await respondentRepository.getById(session.respondent_id);

  const finalizedSession =
    session.status === "completed"
      ? session
      : await sessionRepository.update(session.id, {
          status: "completed",
          current_phase: "completed",
          current_question_id: null,
          completed_at: new Date().toISOString(),
          state_json: {
            ...session.state_json,
            phase: "completed",
            pendingQuestionId: null,
            pendingProbeQuestion: null,
            pendingProbeSourceQuestionId: null,
            pendingProbeSourceAnswerId: null,
            pendingProbeReason: null,
            pendingProbeType: null,
            pendingProbeMissingSlots: [],
            pendingFreeComment: false,
            freeCommentPromptShown: false,
            freeCommentProbeAsked: false,
            pendingFreeCommentPrompt: null,
            pendingFreeCommentSourceAnswerId: null,
            pendingFreeCommentSourceText: null,
            pendingFreeCommentReason: null,
            pendingFreeCommentProbeType: null,
            pendingFreeCommentMissingSlots: [],
            finalQuestionCompletedAt: null,
            aiProbeCountCurrentAnswer: 0
          }
        });

  await logSystemMessage(session.id, "session_completed");

  const [answers, questions] = await Promise.all([
    answerRepository.listBySession(session.id),
    questionRepository.listByProject(session.project_id, { includeHidden: true })
  ]);
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const primaryAnswers = answers.filter((answer) => answer.answer_role === "primary");

  for (const answer of primaryAnswers) {
    const question = questionMap.get(answer.question_id);
    if (!question || question.question_type !== "text" || !answerExtractionService.getExtractionConfig(question)) {
      continue;
    }

    await answerExtractionService.reprocessAnswer({
      sessionId: session.id,
      project,
      question,
      answer,
      forceAi: false
    });
  }

  const refreshedAnswers = await answerRepository.listBySession(session.id);
  const analysisAnswers = refreshedAnswers
    .filter((answer) => answer.answer_role === "primary")
    .map((answer) => {
      const question = questionMap.get(answer.question_id);
      return {
        question_code: question?.question_code ?? answer.question_id,
        question_text: question?.question_text ?? "",
        answer_text: answer.answer_text,
        normalized_answer: answer.normalized_answer
      };
    });

  void analysisService
    .analyzeCompletedSession({
      session: finalizedSession,
      project,
      answers: analysisAnswers
    })
    .catch((error) => {
      logger.warn("Final analysis failed", {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error)
      });
    });

  const awardResult = await pointService.awardCompletionPoints({
    respondent,
    sessionId: session.id,
    projectId: project.id,
    projectRewardPoints: project.reward_points,
    lineUserId
  });

  const rankResult = await rankService.syncRespondentRank(
    awardResult.updatedRespondent,
    "session_completed"
  );
  const [currentRank, nextRank] = await Promise.all([
    rankResult.newRank
      ? Promise.resolve(rankResult.newRank)
      : rankService.resolveRank(awardResult.updatedRespondent.total_points),
    rankService.getNextRank(awardResult.updatedRespondent.total_points)
  ]);

  await assignmentService.completeAssignmentForRespondentProject(
    finalizedSession.respondent_id,
    finalizedSession.project_id
  );

  const lines = [
    `獲得ポイント: ${awardResult.totalAwarded}pt`,
    `累計ポイント: ${awardResult.updatedRespondent.total_points}pt`,
    `現在ランク: ${currentRank?.rank_name ?? "Bronze"}`,
    nextRank
      ? `次ランクまで: ${nextRank.min_points - awardResult.updatedRespondent.total_points}pt`
      : "次ランク: 最上位ランクです"
  ];
  if (rankResult.changed && currentRank) {
    lines.push(`ランクアップ: ${currentRank.rank_name}`);
  }

  return [
    buildTextMessage(lines.join("\n")),
    buildTextMessage("インタビューが完了しました。ご協力ありがとうございました。")
  ];
}
async function replyAndFinalizeCompletion(input: {
  session: Session;
  userId: string;
  replyToken: string;
}): Promise<void> {
  await replyWithTiming({
    replyToken: input.replyToken,
    messages: [buildTextMessage("ありがとうございます。完了処理を進めています。")],
    label: "completion_ack",
    sessionId: input.session.id
  });

  void completeSession(input.session, input.userId)
    .then((completionMessages) => lineMessagingService.push(input.userId, completionMessages))
    .catch(async (error) => {
      logger.error("Failed to finalize completed session", {
        sessionId: input.session.id,
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error)
      });

      await lineMessagingService.push(input.userId, [
        buildTextMessage("完了処理で一時的なエラーが発生しました。少し時間をおいてご確認ください。")
      ]);
    });
}
async function replyAndFinalizeCompletionV2(input: {
  session: Session;
  userId: string;
  replyToken: string;
}): Promise<void> {
  await replyWithTiming({
    replyToken: input.replyToken,
    messages: [buildTextMessage("ありがとうございます。完了処理を進めています。")],
    label: "completion_ack",
    sessionId: input.session.id
  });

  void completeSession(input.session, input.userId)
    .then(async (completionMessages) => {
      await sleep(300);
      await lineMessagingService.push(input.userId, completionMessages);
    })
    .catch(async (error) => {
      logger.error("Failed to finalize completed session", {
        sessionId: input.session.id,
        userId: input.userId,
        error: error instanceof Error ? error.message : String(error)
      });

      await lineMessagingService.push(input.userId, [
        buildTextMessage("完了処理で一時的なエラーが発生しました。少し時間をおいてご確認ください。")
      ]);
    });
}
async function startSession(input: {
  respondentId: string;
  projectId: string;
  replyToken: string;
  rawPayload: Record<string, unknown>;
  leadMessage?: string | null;
  assignmentId?: string | null;
}): Promise<void> {
  const firstQuestion = await questionFlowService.getFirstQuestion(input.projectId);
  if (!firstQuestion) {
    await replyWithTiming({
      replyToken: input.replyToken,
      messages: [buildTextMessage("この案件にはまだ質問が設定されていません。")],
      label: "start_session_missing_question"
    });
    return;
  }

  await ensureRespondentActive(input.respondentId);

  const session = await sessionRepository.create({
    respondent_id: input.respondentId,
    project_id: input.projectId,
    current_question_id: firstQuestion.id,
    current_phase: "question",
    status: "active",
    summary: null,
    state_json: {
      phase: "question",
      currentQuestionIndex: 0,
      answersSinceSummary: 0,
      aiProbeCount: 0,
      aiProbeCountCurrentAnswer: 0,
      pendingQuestionId: null,
      pendingProbeQuestion: null,
      pendingProbeSourceQuestionId: null,
      pendingProbeSourceAnswerId: null,
      pendingProbeReason: null,
      pendingProbeType: null,
      pendingProbeMissingSlots: [],
      pendingFreeComment: false,
      freeCommentPromptShown: false,
      freeCommentProbeAsked: false,
      pendingFreeCommentPrompt: null,
      pendingFreeCommentSourceAnswerId: null,
      pendingFreeCommentSourceText: null,
      pendingFreeCommentReason: null,
      pendingFreeCommentProbeType: null,
      pendingFreeCommentMissingSlots: [],
      finalQuestionCompletedAt: null,
      lastQuestionText: null,
      lastQuestionEmbedding: [],
      lastProbeType: null
    }
  });

  await logSystemMessage(session.id, "session_started", input.rawPayload);
  if (input.assignmentId) {
    await assignmentService.markAssignmentOpened(input.assignmentId);
  }
  const prompt = await questionPrompt(session, firstQuestion);
  const promptSession = await sessionRepository.update(session.id, {
    state_json: withQuestionMemory(session.state_json, prompt, null)
  });
  await logAssistantMessage(promptSession.id, prompt);

  const replyMessages = input.leadMessage
    ? [buildTextMessage(input.leadMessage), buildTextMessage(prompt)]
    : [buildTextMessage(prompt)];

  await replyWithTiming({
    replyToken: input.replyToken,
    messages: replyMessages,
    label: "start_session",
    sessionId: promptSession.id
  });
}

async function replyWithCurrentPrompt(input: {
  session: Session;
  replyToken: string;
  leadMessage?: string | null;
  assignmentId?: string | null;
}): Promise<void> {
  const prompt = await currentPromptForSession(input.session);
  if (!prompt) {
    const { settings } = await resolveProjectContext(input.session.project_id);
    await replyWithTiming({
      replyToken: input.replyToken,
      messages: [buildTextMessage(buildNoActiveSessionText(settings.response_style))],
      label: "reply_current_prompt_missing",
      sessionId: input.session.id
    });
    return;
  }

  if (input.assignmentId) {
    await assignmentService.markAssignmentOpened(input.assignmentId);
  }
  await logAssistantMessage(input.session.id, prompt);
  const messages = input.leadMessage
    ? [buildTextMessage(input.leadMessage), buildTextMessage(prompt)]
    : [buildTextMessage(prompt)];
  await replyWithTiming({
    replyToken: input.replyToken,
    messages,
    label: "reply_current_prompt",
    sessionId: input.session.id
  });
}

async function resolveDistinctNextQuestion(input: {
  session: Session;
  project: Project;
  currentQuestion: Question;
  candidateQuestionId: string | null;
  allowSkippingFutureQuestions: boolean;
}): Promise<Question | null> {
  const [questions, sessionSlotMap] = await Promise.all([
    questionFlowService.listByProject(input.session.project_id),
    buildSessionSlotMap(input.session.id)
  ]);
  const projectCompletion = evaluateProjectSlotCompletion(input.project, sessionSlotMap);
  if (input.allowSkippingFutureQuestions && projectCompletion.isComplete) {
    return null;
  }

  const currentIndex = questions.findIndex((question) => question.id === input.currentQuestion.id);
  const candidateIndex = input.candidateQuestionId
    ? questions.findIndex((question) => question.id === input.candidateQuestionId)
    : -1;
  const startIndex = candidateIndex >= 0 ? candidateIndex : currentIndex + 1;

  for (let index = Math.max(0, startIndex); index < questions.length; index += 1) {
    const candidate = questions[index];
    if (!candidate) {
      continue;
    }

    if (
      input.allowSkippingFutureQuestions &&
      shouldSkipQuestionBySlots({
        question: candidate,
        aggregateSlotMap: sessionSlotMap,
        projectMode: input.project.research_mode,
        projectAiState: input.project.ai_state_json
      })
    ) {
      continue;
    }

    const candidatePrompt = questionFlowService.renderQuestion(
      candidate,
      input.project.research_mode === "interview" ? undefined : `Q${index + 1}/${questions.length}`
    );
    if (!isQuestionSimilarToLast(input.session, candidatePrompt)) {
      return candidate;
    }
  }

  return null;
}

async function advanceAfterProbeOrComplete(input: {
  session: Session;
  project: Project;
  currentQuestion: Question;
  pendingQuestionId: string | null;
  allowSkippingFutureQuestions: boolean;
  preferredAction?: AnswerAnalysisAction | null;
  preRenderedPrompt?: string | null;
  replyToken: string;
  diagnostics?: TurnDiagnostics;
}): Promise<void> {
  if (input.preferredAction === "finish") {
    recordActionPath(input.diagnostics, "orchestrator:finish");
    await enterFreeCommentPhase({
      session: input.session,
      replyToken: input.replyToken,
      diagnostics: input.diagnostics
    });
    return;
  }

  const nextQuestion = await resolveDistinctNextQuestion({
    session: input.session,
    project: input.project,
    currentQuestion: input.currentQuestion,
    candidateQuestionId: input.pendingQuestionId
,
    allowSkippingFutureQuestions:
      input.allowSkippingFutureQuestions || input.preferredAction === "skip"
  });

  if (!nextQuestion) {
    recordActionPath(input.diagnostics, "orchestrator:free_comment");
    await enterFreeCommentPhase({
      session: input.session,
      replyToken: input.replyToken,
      diagnostics: input.diagnostics
    });
    return;
  }

  const prompt =
    input.preRenderedPrompt && input.preRenderedPrompt.trim()
      ? input.preRenderedPrompt
      : await questionPrompt(
          {
            ...input.session,
            current_question_id: nextQuestion.id,
            current_phase: "question"
          },
          nextQuestion,
          input.diagnostics
        );
  const nextQuestionIndex = await resolveQuestionIndex(input.session.project_id, nextQuestion.id);

  await replyWithTiming({
    replyToken: input.replyToken,
    messages: [buildTextMessage(prompt)],
    label: "next_question",
    diagnostics: input.diagnostics,
    sessionId: input.session.id
  });

  const slotMapForCache = await buildSessionSlotMap(input.session.id);
  const probeCache =
    input.project.research_mode === "interview"
      ? buildNextQuestionCache({
          sessionId: input.session.id,
          nextQuestion,
          collectedSlotMap: slotMapForCache,
          questionText: input.preRenderedPrompt ?? null,
          hasBranching: false,
          hasSkip: input.preferredAction === "skip"
        })
      : null;

  const nextSession = await sessionRepository.update(input.session.id, {
    current_question_id: nextQuestion.id,
    current_phase: "question",
    state_json: {
      ...withQuestionMemory(input.session.state_json, prompt, null),
      phase: "question",
      currentQuestionIndex: nextQuestionIndex,
      pendingQuestionId: null,
      pendingProbeQuestion: null,
      pendingProbeSourceQuestionId: null,
      pendingProbeSourceAnswerId: null,
      pendingProbeReason: null,
      pendingProbeType: null,
      pendingProbeMissingSlots: [],
      aiProbeCountCurrentAnswer: 0,
      pendingNextQuestionText: input.project.research_mode === "interview" ? prompt : null,
      pendingNextQuestionCache: probeCache
    }
  });
  recordActionPath(input.diagnostics, `orchestrator:next_question:${nextQuestion.question_code}`);
  await logAssistantMessage(nextSession.id, prompt);
}

async function maybeAskProbe(input: {
  session: Session;
  question: Question;
  answerText: string;
  answerId?: string | null;
  answerPayload?: Record<string, unknown> | null;
  pendingQuestionId: string | null;
  replyToken: string;
  diagnostics?: TurnDiagnostics;
}): Promise<boolean> {
  const { project, settings } = await resolveProjectContext(input.session.project_id);
  const currentProbeCountForAnswer = input.session.state_json?.aiProbeCountCurrentAnswer ?? 0;
  const currentProbeCountForSession = input.session.state_json?.aiProbeCount ?? 0;
  const probeBudget = resolveTextProbeBudget({
    project,
    settings,
    question: input.question,
    currentProbeCountForAnswer,
    currentProbeCountForSession
  });
  const { maxProbesPerAnswer, maxProbesPerSession } = probeBudget;

  if (currentProbeCountForSession >= maxProbesPerSession) {
    recordActionPath(input.diagnostics, "probe_gate:max_probes_session");
    return false;
  }

  if (input.question.question_type === "text") {
    if (!probeBudget.canProbe) {
      recordActionPath(input.diagnostics, "probe_gate:max_probes_answer");
      return false;
    }

    const analysisAction = extractAnalysisAction(input.answerPayload);
    const payloadProbeType =
      input.answerPayload?.suggested_probe_type === "missing_slot" ||
      input.answerPayload?.suggested_probe_type === "concretize" ||
      input.answerPayload?.suggested_probe_type === "clarify"
        ? (input.answerPayload.suggested_probe_type as StructuredProbeType)
        : null;
    const missingSlots = extractCompletionMissingSlots(input.answerPayload);
    const probeType = payloadProbeType ?? "clarify";

    if (analysisAction !== "probe") {
      recordActionPath(input.diagnostics, `probe_gate:analysis_${analysisAction ?? "none"}`);
      return false;
    }

    let prompt = extractSuggestedProbeQuestion(input.answerPayload);
    if (!prompt) {
      prompt = buildStructuredProbeFallback({
        question: input.question,
        probeType,
        missingSlots,
        projectMode: project.research_mode,
        projectAiState: project.ai_state_json
      });
    }

    if ((input.session.state_json?.lastProbeType === probeType && probeType) || isQuestionSimilarToLast(input.session, prompt)) {
      recordActionPath(input.diagnostics, "probe_gate:duplicate_probe");
      return false;
    }

    await replyWithTiming({
      replyToken: input.replyToken,
      messages: [buildTextMessage(prompt)],
      label: "probe",
      diagnostics: input.diagnostics,
      sessionId: input.session.id
    });

    const probingSession = await sessionRepository.update(input.session.id, {
      current_phase: "ai_probe",
      current_question_id: input.question.id,
      state_json: {
        ...withQuestionMemory(input.session.state_json, prompt, probeType),
        phase: "ai_probe",
        pendingQuestionId: input.pendingQuestionId,
        pendingProbeQuestion: prompt,
        pendingProbeSourceQuestionId: input.question.id,
        pendingProbeSourceAnswerId:
          input.answerId ?? input.session.state_json?.pendingProbeSourceAnswerId ?? null,
        pendingProbeReason: probeType,
        pendingProbeType: probeType,
        pendingProbeMissingSlots: missingSlots,
        aiProbeCount: currentProbeCountForSession + 1,
        aiProbeCountCurrentAnswer: currentProbeCountForAnswer + 1
      }
    });

    recordActionPath(input.diagnostics, `probe_sent:${probeType}`);
    await logAssistantMessage(probingSession.id, prompt);
    return true;
  }

  // Non-text types (yes_no, single_select, multi_select, scale) are never probed
  recordActionPath(input.diagnostics, "probe_gate:non_text_type");
  return false;
}
export const conversationOrchestratorService = {
  async handleFollowEvent(userId: string, replyToken: string): Promise<void> {
    const profile = await lineMessagingService.getProfile(userId);
    await respondentService.ensureRespondent(userId, profile.displayName);
    await lineMessagingService.reply(replyToken, buildWelcomeMessages());
  },

  async handleUnfollowEvent(userId: string): Promise<void> {
    const respondents = await respondentRepository.listByLineUserId(userId);
    if (respondents.length === 0) {
      return;
    }

    for (const respondent of respondents) {
      const activeSession = await sessionRepository.getActiveByRespondent(
        respondent.id,
        respondent.project_id
      );
      if (activeSession) {
        await abandonSession(activeSession, "session_abandoned_by_unfollow");
      }
      await respondentRepository.update(respondent.id, { status: "dropped" });
    }
  },

  async handleNonTextMessage(input: {
    userId: string;
    replyToken: string;
    messageType: string;
    rawPayload: Record<string, unknown>;
  }): Promise<void> {
    const profile = await lineMessagingService.getProfile(input.userId);
    const resolved = await resolveConversationRespondent(input.userId, profile.displayName);
    const respondent = resolved.respondent;
    const activeSession = await sessionRepository.getActiveByRespondent(
      respondent.id,
      respondent.project_id
    );
    const { project, settings } = await resolveProjectContext(respondent.project_id);

    if (activeSession) {
      await messageRepository.create({
        session_id: activeSession.id,
        sender_type: "user",
        message_text: `[${input.messageType}]`,
        raw_payload: input.rawPayload
      });
    }

    const lead = buildNonTextInputText({
      responseStyle: settings.response_style,
      messageType: input.messageType,
      hasActiveSession: Boolean(activeSession)
    });

    if (!activeSession) {
      await lineMessagingService.reply(input.replyToken, [buildTextMessage(lead)]);
      return;
    }

    const prompt = await currentPromptForSession(activeSession);
    const messages = prompt
      ? [buildTextMessage(lead), buildTextMessage(prompt)]
      : [buildTextMessage(lead)];
    await lineMessagingService.reply(input.replyToken, messages);
  },

  async handleTextMessage(input: {
    userId: string;
    replyToken: string;
    text: string;
    rawPayload: Record<string, unknown>;
  }): Promise<void> {
    const profile = await lineMessagingService.getProfile(input.userId);
    const menuAction = await menuActionServiceDb.resolveTextAction({
      lineUserId: input.userId,
      displayName: profile.displayName,
      text: input.text
    });

    if (menuAction.handled) {
      if (menuAction.behavior === "reply") {
        logger.info("menu_action.reply.dispatch.start", {
          userId: input.userId,
          inputText: input.text,
          messageCount: menuAction.messages.length,
          messagePreview: menuAction.messages.map((message) =>
            message.type === "text" ? message.text.slice(0, 120) : message.altText.slice(0, 120)
          )
        });
        try {
          await lineMessagingService.reply(input.replyToken, menuAction.messages);
          logger.info("menu_action.reply.dispatch.success", {
            userId: input.userId,
            inputText: input.text,
            messageCount: menuAction.messages.length
          });
        } catch (error) {
          logger.info("menu_action.resolve_text.final", {
            finalDecision: "LINE_REPLY_FAILED",
            userId: input.userId,
            inputText: input.text
          });
          logger.error("menu_action.reply.dispatch.failed", {
            userId: input.userId,
            inputText: input.text,
            finalDecision: "LINE_REPLY_FAILED",
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
          });
          throw error;
        }
        return;
      }

      if (menuAction.behavior === "resume") {
        await replyWithCurrentPrompt({
          session: menuAction.session,
          replyToken: input.replyToken,
          leadMessage: menuAction.leadMessage,
          assignmentId: menuAction.assignmentId
        });
        return;
      }

      await startSession({
        respondentId: menuAction.respondentId,
        projectId: menuAction.projectId,
        replyToken: input.replyToken,
        rawPayload: input.rawPayload,
        leadMessage: menuAction.leadMessage,
        assignmentId: menuAction.assignmentId
      });
      return;
    }

    const resolved = await resolveConversationRespondent(input.userId, profile.displayName);
    const respondent = resolved.respondent;
    const activeAssignment = resolved.assignment;
    const { project, settings } = await resolveProjectContext(respondent.project_id);
    const activeSession = await sessionRepository.getActiveByRespondent(
      respondent.id,
      respondent.project_id
    );
    const latestSession = (await sessionRepository.listByRespondent(respondent.id))[0] ?? null;
    const command = detectConversationCommand(input.text);
    const pendingPostCapture =
      !activeSession && !command && input.text.trim()
        ? menuActionServiceDb.consumePendingPostCapture(input.userId)
        : null;

    if (pendingPostCapture) {
      const post = await postService.createStandalonePost({
        userId: input.userId,
        respondentId: respondent.id,
        projectId: project.id,
        sessionId: null,
        type: pendingPostCapture.type,
        content: input.text.trim(),
        sourceMode: project.research_mode,
        sourceChannel: "line",
        menuActionKey: pendingPostCapture.menuActionKey,
        postedOn: pendingPostCapture.postedOn,
        metadata: {
          captured_from: "menu_action"
        }
      });

      await lineMessagingService.reply(input.replyToken, [
        buildTextMessage(
          pendingPostCapture.type === "diary" ? "日記を保存しました。" : "投稿を保存しました。"
        )
      ]);

      void analysisService.analyzePost(post.id).catch((error) => {
        logger.warn("Post analysis failed", {
          postId: post.id,
          error: error instanceof Error ? error.message : String(error)
        });
      });
      return;
    }

    if (command === "help") {
      await lineMessagingService.reply(input.replyToken, [
        buildTextMessage(buildHelpText(settings.response_style))
      ]);
      return;
    }
    if (command === "mypage") {
      const mypageLiff = await liffService.getPage("mypage");
      const mypageUrl = mypageLiff?.url ?? `${env.APP_BASE_URL}/liff/mypage`;
      await lineMessagingService.reply(input.replyToken, [buildMypageLiffFlex(mypageUrl)]);
      return;
    }

    if (command === "points" || command === "rank") {
      const currentRank = await rankService.resolveRank(respondent.total_points);
      const nextRank = await rankService.getNextRank(respondent.total_points);
      const card = buildRankFlex({
        rankName: currentRank?.rank_name ?? "Bronze",
        badgeLabel: currentRank?.badge_label ?? "",
        totalPoints: respondent.total_points,
        nextRank,
        pointsToNext: nextRank ? nextRank.min_points - respondent.total_points : null
      });
      await lineMessagingService.reply(input.replyToken, [card]);
      return;
    }

    if (command === "stop") {
      if (!activeSession) {
        await lineMessagingService.reply(input.replyToken, [buildTextMessage(buildNoActiveSessionText(settings.response_style))]);
        return;
      }

      await abandonSession(activeSession, "session_stopped_by_user", input.rawPayload);
      await lineMessagingService.reply(input.replyToken, [buildTextMessage(buildStoppedSessionText(settings.response_style))]);
      return;
    }

    if (command === "restart") {
      if (activeSession) {
        await abandonSession(activeSession, "session_restarted_by_user", input.rawPayload);
        await startSession({
          respondentId: respondent.id,
          projectId: respondent.project_id,
          replyToken: input.replyToken,
          rawPayload: input.rawPayload,
          leadMessage: buildRestartedSessionText(settings.response_style),
          assignmentId: activeAssignment?.id ?? null
        });
        return;
      }

      if (latestSession?.status === "completed" && !activeAssignment) {
        await lineMessagingService.reply(input.replyToken, [buildTextMessage(buildRestartAfterCompletionText(settings.response_style))]);
        return;
      }

      await startSession({
        respondentId: respondent.id,
        projectId: respondent.project_id,
        replyToken: input.replyToken,
        rawPayload: input.rawPayload,
        leadMessage: buildRestartedSessionText(settings.response_style),
        assignmentId: activeAssignment?.id ?? null
      });
      return;
    }

    if (command === "start") {
      if (activeSession) {
        await replyWithCurrentPrompt({
          session: activeSession,
          replyToken: input.replyToken,
          leadMessage: buildResumeExistingSessionText(settings.response_style),
          assignmentId: activeAssignment?.id ?? null
        });
        return;
      }

      if (latestSession?.status === "completed" && !activeAssignment) {
        await lineMessagingService.reply(input.replyToken, [buildTextMessage(buildCompletedSessionText(settings.response_style))]);
        return;
      }

      await startSession({
        respondentId: respondent.id,
        projectId: respondent.project_id,
        replyToken: input.replyToken,
        rawPayload: input.rawPayload,
        assignmentId: activeAssignment?.id ?? null
      });
      return;
    }

    if (command === "resume") {
      if (!activeSession) {
        if (activeAssignment) {
          await startSession({
            respondentId: respondent.id,
            projectId: respondent.project_id,
            replyToken: input.replyToken,
            rawPayload: input.rawPayload,
            assignmentId: activeAssignment.id
          });
          return;
        }

        const text =
          latestSession?.status === "completed"
            ? buildCompletedSessionText(settings.response_style)
            : buildNoActiveSessionText(settings.response_style);
        await lineMessagingService.reply(input.replyToken, [buildTextMessage(text)]);
        return;
      }

      await replyWithCurrentPrompt({
        session: activeSession,
        replyToken: input.replyToken,
        assignmentId: activeAssignment?.id ?? null
      });
      return;
    }

    if (!activeSession || !activeSession.current_question_id) {
      if (activeAssignment) {
        await startSession({
          respondentId: respondent.id,
          projectId: respondent.project_id,
          replyToken: input.replyToken,
          rawPayload: input.rawPayload,
          assignmentId: activeAssignment.id
        });
        return;
      }

      await lineMessagingService.reply(input.replyToken, [buildTextMessage(buildNoActiveSessionText(settings.response_style))]);
      return;
    }

    const diagnostics = createTurnDiagnostics(activeSession.id);

    try {
      await messageRepository.create({
        session_id: activeSession.id,
        sender_type: "user",
        message_text: input.text,
        raw_payload: input.rawPayload
      });

      if (!input.text.trim()) {
        const prompt = await currentPromptForSession(activeSession);
        const messages = [buildTextMessage(buildEmptyAnswerText(settings.response_style))];
        if (prompt) {
          messages.push(buildTextMessage(prompt));
        }
        await lineMessagingService.reply(input.replyToken, messages);
        return;
      }

      if (activeSession.current_phase === "free_comment") {
      const freeCommentQuestion =
        activeSession.current_question_id
          ? await questionFlowService.getQuestion(activeSession.current_question_id)
          : await questionRepository.ensureSystemFreeCommentQuestion(activeSession.project_id);
      const trimmedFreeComment = input.text.trim();
      const freeCommentSourceAnswerId = activeSession.state_json?.pendingFreeCommentSourceAnswerId ?? null;
      const isFreeCommentFollowUp =
        Boolean(activeSession.state_json?.freeCommentProbeAsked) && Boolean(freeCommentSourceAnswerId);
      const existingFreeCommentSourceAnswer =
        isFreeCommentFollowUp && freeCommentSourceAnswerId
          ? await answerRepository.getById(freeCommentSourceAnswerId)
          : null;
      const previousProbeAnswers =
        isFreeCommentFollowUp && freeCommentSourceAnswerId
          ? await listProbeAnswersForSource(activeSession.id, freeCommentSourceAnswerId)
          : [];
      const aggregatedProbeAnswers = isFreeCommentFollowUp
        ? [...previousProbeAnswers, trimmedFreeComment]
        : [];
      const aggregatedProbeAnswerText = buildAggregateProbeAnswerText(aggregatedProbeAnswers);
      const freeCommentBaseText =
        activeSession.state_json?.pendingFreeCommentSourceText ?? trimmedFreeComment;
      const combinedFreeCommentText = [freeCommentBaseText, aggregatedProbeAnswerText]
        .filter(Boolean)
        .join("\n");
      const freeCommentNormalized = await buildStructuredAnswer({
        session: activeSession,
        question: freeCommentQuestion,
        projectId: activeSession.project_id,
        answerText: freeCommentBaseText,
        probeAnswer: aggregatedProbeAnswerText,
        source: isFreeCommentFollowUp ? "free_comment_probe" : "free_comment",
        reason: activeSession.state_json?.pendingFreeCommentReason ?? null,
        probeType: activeSession.state_json?.pendingFreeCommentProbeType ?? null,
        baseNormalized: {
          value: trimmedFreeComment
        },
        probeCount: activeSession.state_json?.aiProbeCountCurrentAnswer ?? 0,
        existingSlots: extractSlotMap(existingFreeCommentSourceAnswer?.normalized_answer ?? null),
        diagnostics
      });
      const freeCommentAnswer = await answerRepository.create({
        session_id: activeSession.id,
        question_id: freeCommentQuestion.id,
        answer_text: trimmedFreeComment,
        answer_role: isFreeCommentFollowUp ? "ai_probe" : "primary",
        parent_answer_id: isFreeCommentFollowUp ? freeCommentSourceAnswerId : null,
        normalized_answer: freeCommentNormalized
      });
      const sourceAnswer = existingFreeCommentSourceAnswer ?? freeCommentAnswer;

      if (isFreeCommentFollowUp && sourceAnswer) {
        await answerRepository.update(sourceAnswer.id, {
          normalized_answer: freeCommentNormalized
        });
      }

      const currentProbeCountForAnswer = activeSession.state_json?.aiProbeCountCurrentAnswer ?? 0;
      const currentProbeCountForSession = activeSession.state_json?.aiProbeCount ?? 0;
      const probeBudget = resolveTextProbeBudget({
        project,
        settings,
        question: freeCommentQuestion,
        currentProbeCountForAnswer,
        currentProbeCountForSession
      });
      const freeCommentMissingSlots = extractCompletionMissingSlots(freeCommentNormalized);
      const freeCommentProbeType =
        freeCommentNormalized.suggested_probe_type === "missing_slot" ||
        freeCommentNormalized.suggested_probe_type === "concretize" ||
        freeCommentNormalized.suggested_probe_type === "clarify"
          ? (freeCommentNormalized.suggested_probe_type as StructuredProbeType)
          : "clarify";
      const freeCommentAction = extractAnalysisAction(freeCommentNormalized);
      const freeCommentPrompt =
        freeCommentAction === "probe"
          ? extractSuggestedProbeQuestion(freeCommentNormalized) ??
            (freeCommentProbeType
              ? buildStructuredProbeFallback({
                  question: freeCommentQuestion,
                  probeType: freeCommentProbeType,
                  missingSlots: freeCommentMissingSlots,
                  projectMode: project.research_mode,
                  projectAiState: project.ai_state_json
                })
              : null)
          : null;

      if (
        freeCommentAction === "probe" &&
        probeBudget.canProbe &&
        freeCommentProbeType &&
        freeCommentPrompt &&
        activeSession.state_json?.lastProbeType !== freeCommentProbeType &&
        !isQuestionSimilarToLast(activeSession, freeCommentPrompt)
      ) {
        recordActionPath(diagnostics, `free_comment_probe:${freeCommentProbeType}`);

        await replyWithTiming({
          replyToken: input.replyToken,
          messages: [buildTextMessage(freeCommentPrompt)],
          label: "free_comment_probe",
          diagnostics,
          sessionId: activeSession.id
        });

        const probingSession = await sessionRepository.update(activeSession.id, {
          state_json: {
            ...withQuestionMemory(activeSession.state_json, freeCommentPrompt, freeCommentProbeType),
            phase: "free_comment",
            pendingFreeComment: true,
            freeCommentPromptShown: true,
            freeCommentProbeAsked: true,
            pendingFreeCommentPrompt: freeCommentPrompt,
            pendingFreeCommentSourceAnswerId: sourceAnswer?.id ?? freeCommentAnswer.id,
            pendingFreeCommentSourceText: freeCommentBaseText,
            pendingFreeCommentReason: freeCommentProbeType,
            pendingFreeCommentProbeType: freeCommentProbeType,
            pendingFreeCommentMissingSlots: freeCommentMissingSlots,
            answersSinceSummary: (activeSession.state_json?.answersSinceSummary ?? 0) + 1,
            aiProbeCount: currentProbeCountForSession + 1,
            aiProbeCountCurrentAnswer: currentProbeCountForAnswer + 1
          }
        });

        await logAssistantMessage(probingSession.id, freeCommentPrompt);
        return;
      }

      if (freeCommentAction === "probe" && !probeBudget.canProbe) {
        recordActionPath(diagnostics, "free_comment_probe_gate");
      }

      const relatedAnswers =
        sourceAnswer?.id ? await answerRepository.listBySession(activeSession.id) : [];
      const freeCommentFollowUps = sourceAnswer?.id
        ? relatedAnswers
            .filter((answer) => answer.answer_role === "ai_probe" && answer.parent_answer_id === sourceAnswer.id)
            .map((answer) => answer.answer_text)
        : [];
      const followUpAnswerIds = sourceAnswer?.id
        ? relatedAnswers
            .filter((answer) => answer.answer_role === "ai_probe" && answer.parent_answer_id === sourceAnswer.id)
            .map((answer) => answer.id)
        : [];
      const combinedFreeComment = buildCombinedFreeComment(
        activeSession.state_json?.pendingFreeCommentSourceText ?? sourceAnswer?.answer_text ?? trimmedFreeComment,
        freeCommentFollowUps
      );

      const updatedSession = await sessionRepository.update(activeSession.id, {
        state_json: {
          ...activeSession.state_json,
          phase: "free_comment",
          pendingFreeComment: false,
          freeCommentPromptShown: true,
          freeCommentProbeAsked: false,
          pendingFreeCommentPrompt: null,
          pendingFreeCommentSourceAnswerId: null,
          pendingFreeCommentSourceText: null,
          pendingFreeCommentReason: null,
          pendingFreeCommentProbeType: null,
          pendingFreeCommentMissingSlots: [],
          answersSinceSummary: (activeSession.state_json?.answersSinceSummary ?? 0) + 1,
          aiProbeCountCurrentAnswer: 0
        }
      });

      await replyAndFinalizeCompletionV2({
        session: updatedSession,
        userId: input.userId,
        replyToken: input.replyToken
      });

      runDeferredTask(
        "free_comment_post_sync_failed",
        async () => {
          const freeCommentPost = await postService.syncAnswerToPost({
            answer: sourceAnswer ?? freeCommentAnswer,
            respondent,
            session: activeSession,
            project,
            questionCode: freeCommentQuestion.question_code,
            questionRole: freeCommentQuestion.question_role,
            overrideType: "free_comment",
            contentOverride: combinedFreeComment,
            metadata: {
              free_comment_probe: {
                asked: followUpAnswerIds.length > 0,
                prompt: activeSession.state_json?.pendingFreeCommentPrompt ?? null,
                source_reason: activeSession.state_json?.pendingFreeCommentReason ?? null,
                probe_type: activeSession.state_json?.pendingFreeCommentProbeType ?? null,
                missing_slots: activeSession.state_json?.pendingFreeCommentMissingSlots ?? [],
                source_answer_id: freeCommentSourceAnswerId,
                follow_up_answer_id: followUpAnswerIds[followUpAnswerIds.length - 1] ?? null,
                follow_up_answer_ids: followUpAnswerIds
              }
            }
          });

          if (freeCommentPost?.id) {
            runDeferredTask("free_comment_post_analysis_failed", async () => {
              await analysisService.analyzePost(freeCommentPost.id);
            }, { postId: freeCommentPost.id, sessionId: activeSession.id });
          }
        },
        { sessionId: activeSession.id, questionCode: freeCommentQuestion.question_code }
      );
        return;
      }
      if (activeSession.current_phase === "ai_probe") {
      const currentQuestion = await questionFlowService.getQuestion(activeSession.current_question_id);
      const probeAnswerText = input.text.trim();
      const sourceAnswerId = activeSession.state_json?.pendingProbeSourceAnswerId ?? null;
      const sourceAnswer = sourceAnswerId ? await answerRepository.getById(sourceAnswerId) : null;
      const pendingQuestionId = activeSession.state_json?.pendingQuestionId ?? null;
      const pendingQuestion = pendingQuestionId
        ? await questionFlowService.getQuestion(pendingQuestionId)
        : null;
      const previousProbeAnswers =
        sourceAnswerId ? await listProbeAnswersForSource(activeSession.id, sourceAnswerId) : [];
      const aggregatedProbeAnswerText = buildAggregateProbeAnswerText([
        ...previousProbeAnswers,
        probeAnswerText
      ]);
      const mergedAnswerText = [sourceAnswer?.answer_text ?? probeAnswerText, aggregatedProbeAnswerText]
        .filter(Boolean)
        .join("\n");
      const mergedNormalizedAnswer = await buildStructuredAnswer({
        session: activeSession,
        question: currentQuestion,
        nextQuestion: pendingQuestion,
        projectId: activeSession.project_id,
        answerText: sourceAnswer?.answer_text ?? probeAnswerText,
        probeAnswer: aggregatedProbeAnswerText,
        source: "ai_probe",
        reason: activeSession.state_json?.pendingProbeReason ?? null,
        probeType: activeSession.state_json?.pendingProbeType ?? null,
        baseNormalized: sourceAnswer?.normalized_answer ?? null,
        probeCount: activeSession.state_json?.aiProbeCountCurrentAnswer ?? 0,
        existingSlots: extractSlotMap(sourceAnswer?.normalized_answer ?? null),
        diagnostics
      });
      await answerRepository.create({
        session_id: activeSession.id,
        question_id: activeSession.current_question_id,
        answer_text: probeAnswerText,
        answer_role: "ai_probe",
        parent_answer_id: sourceAnswerId,
        normalized_answer: mergedNormalizedAnswer
      });

      if (sourceAnswer) {
        await answerRepository.update(sourceAnswer.id, {
          normalized_answer: mergedNormalizedAnswer
        });
      }

      let updatedSession = await sessionRepository.update(activeSession.id, {
        state_json: {
          ...activeSession.state_json,
          phase: "ai_probe",
          answersSinceSummary: (activeSession.state_json?.answersSinceSummary ?? 0) + 1
        }
      });

      const nextPendingQuestionId = updatedSession.state_json?.pendingQuestionId ?? null;
      const preferredAction = extractAnalysisAction(mergedNormalizedAnswer);
      const askedNextProbe = await maybeAskProbe({
        session: updatedSession,
        question: currentQuestion,
        answerText: mergedAnswerText,
        answerId: sourceAnswerId,
        answerPayload: mergedNormalizedAnswer,
        pendingQuestionId: nextPendingQuestionId,
        replyToken: input.replyToken,
        diagnostics
      });

      if (askedNextProbe) {
        runDeferredTask("probe_summary_refresh_failed", async () => {
          await refreshSummaryIfNeeded(updatedSession);
        }, { sessionId: activeSession.id });
        return;
      }

      const probeAnswerProgress = await evaluateAnswerProgressForSession({
        session: updatedSession,
        project,
        question: currentQuestion,
        answerText: mergedAnswerText
      });

      await advanceAfterProbeOrComplete({
        session: updatedSession,
        project,
        currentQuestion,
        pendingQuestionId: nextPendingQuestionId,
        allowSkippingFutureQuestions: probeAnswerProgress.allowSkippingFutureQuestions,
        preferredAction,
        replyToken: input.replyToken,
        diagnostics
      });
      runDeferredTask("probe_summary_refresh_failed", async () => {
        await refreshSummaryIfNeeded(updatedSession);
      }, { sessionId: activeSession.id });
        return;
      }
      const currentQuestion = await questionFlowService.getQuestion(activeSession.current_question_id);

    let parsedAnswer;
    try {
      parsedAnswer = questionFlowService.parseAnswer(currentQuestion, input.text);
    } catch {
      const prompt = await questionPrompt(activeSession, currentQuestion, diagnostics);
      await replyWithTiming({
        replyToken: input.replyToken,
        messages: [
          buildTextMessage(buildInvalidAnswerText({ question: currentQuestion, responseStyle: settings.response_style })),
          buildTextMessage(prompt)
        ],
        label: "invalid_answer",
        diagnostics,
        sessionId: activeSession.id
      });
      return;
    }

    const branchRule = normalizeBranchRule(currentQuestion.branch_rule);
    const requiresExtractedBranching = Boolean(
      branchRule?.branches?.some((branch) => branch.source === "extracted")
    );
    const extractedPrimaryAnswer =
      currentQuestion.question_type === "text" && requiresExtractedBranching
        ? await answerExtractionService.enrichAnswerForConversation({
            sessionId: activeSession.id,
            project,
            question: currentQuestion,
            answerText: parsedAnswer.answerText,
            baseNormalized: parsedAnswer.normalizedAnswer,
            requireForBranching: requiresExtractedBranching
          })
        : null;
    if (extractedPrimaryAnswer?.usedAi) {
      recordAiCall(diagnostics, "answerExtraction");
    }
    const normalizedForFlow = extractedPrimaryAnswer?.normalizedAnswer ?? parsedAnswer.normalizedAnswer;

    const rawNextQuestion = await questionFlowService.determineNextQuestion(
      activeSession.project_id,
      currentQuestion,
      normalizedForFlow
    );

    const structuredPrimaryAnswer = await buildStructuredAnswer({
      session: activeSession,
      question: currentQuestion,
      nextQuestion: rawNextQuestion,
      projectId: activeSession.project_id,
      answerText: parsedAnswer.answerText,
      source: "primary",
      baseNormalized: normalizedForFlow,
      probeCount: 0,
      existingSlots: {},
      diagnostics
    });
    const primaryAnswer = await answerRepository.create({
      session_id: activeSession.id,
      question_id: currentQuestion.id,
      answer_text: parsedAnswer.answerText,
      answer_role: "primary",
      parent_answer_id: null,
      normalized_answer: structuredPrimaryAnswer
    });

    let updatedSession = await sessionRepository.update(activeSession.id, {
      current_phase: "question",
      state_json: {
        ...activeSession.state_json,
        phase: "question",
        answersSinceSummary: (activeSession.state_json?.answersSinceSummary ?? 0) + 1,
        aiProbeCountCurrentAnswer: 0,
        pendingQuestionId: null,
        pendingProbeQuestion: null,
        pendingProbeSourceQuestionId: null,
        pendingProbeSourceAnswerId: null,
        pendingProbeReason: null,
        pendingProbeType: null,
        pendingProbeMissingSlots: []
      }
    });

    const askedProbe = await maybeAskProbe({
      session: updatedSession,
      question: currentQuestion,
      answerText: parsedAnswer.answerText,
      answerId: primaryAnswer.id,
      answerPayload: structuredPrimaryAnswer,
      pendingQuestionId: rawNextQuestion?.id ?? null,
      replyToken: input.replyToken,
      diagnostics
    });

    if (askedProbe) {
      runDeferredTask("post_answer_followups_failed", async () => {
        if (currentQuestion.question_type === "text") {
          await answerExtractionService.persistForAnswer(primaryAnswer, activeSession.project_id);
        }
        await postService.syncAnswerToPost({
          answer: primaryAnswer,
          respondent,
          session: activeSession,
          project,
          questionCode: currentQuestion.question_code,
          questionRole: currentQuestion.question_role
        });
        if (activeAssignment?.id) {
          await assignmentService.markAssignmentStarted(activeAssignment.id);
        }
        await refreshSummaryIfNeeded(updatedSession);
      }, { sessionId: activeSession.id, answerId: primaryAnswer.id });
      return;
    }

    const preferredAction = extractAnalysisAction(structuredPrimaryAnswer);
    const primaryAnswerProgress = await evaluateAnswerProgressForSession({
      session: updatedSession,
      project,
      question: currentQuestion,
      answerText: parsedAnswer.answerText
    });

    if (preferredAction === "finish") {
      recordActionPath(diagnostics, "orchestrator:finish");
      await enterFreeCommentPhase({
        session: updatedSession,
        replyToken: input.replyToken,
        diagnostics
      });
      runDeferredTask("post_answer_followups_failed", async () => {
        if (currentQuestion.question_type === "text") {
          await answerExtractionService.persistForAnswer(primaryAnswer, activeSession.project_id);
        }
        await postService.syncAnswerToPost({
          answer: primaryAnswer,
          respondent,
          session: activeSession,
          project,
          questionCode: currentQuestion.question_code,
          questionRole: currentQuestion.question_role
        });
        if (activeAssignment?.id) {
          await assignmentService.markAssignmentStarted(activeAssignment.id);
        }
        await refreshSummaryIfNeeded(updatedSession);
      }, { sessionId: activeSession.id, answerId: primaryAnswer.id });
      return;
    }

    const nextQuestion = await resolveDistinctNextQuestion({
      session: updatedSession,
      project,
      currentQuestion,
      candidateQuestionId: rawNextQuestion?.id ?? null,
      allowSkippingFutureQuestions:
        primaryAnswerProgress.allowSkippingFutureQuestions || preferredAction === "skip"
    });

    if (!nextQuestion) {
      recordActionPath(diagnostics, "orchestrator:free_comment");
      await enterFreeCommentPhase({
        session: updatedSession,
        replyToken: input.replyToken,
        diagnostics
      });
      runDeferredTask("post_answer_followups_failed", async () => {
        if (currentQuestion.question_type === "text") {
          await answerExtractionService.persistForAnswer(primaryAnswer, activeSession.project_id);
        }
        await postService.syncAnswerToPost({
          answer: primaryAnswer,
          respondent,
          session: activeSession,
          project,
          questionCode: currentQuestion.question_code,
          questionRole: currentQuestion.question_role
        });
        if (activeAssignment?.id) {
          await assignmentService.markAssignmentStarted(activeAssignment.id);
        }
        await refreshSummaryIfNeeded(updatedSession);
      }, { sessionId: activeSession.id, answerId: primaryAnswer.id });
      return;
    }

    // ── スクリーニングゲート ──────────────────────────────────────────────────
    // screening_last_question_order が設定されており、今回の回答でスクリーニング区間
    // (sort_order <= boundary) を抜けるタイミング（次の質問が区間外 or null）に判定する。
    const screeningBoundary =
      typeof project.screening_last_question_order === "number"
        ? project.screening_last_question_order
        : null;
    const isLeavingScreeningSection =
      screeningBoundary !== null &&
      currentQuestion.sort_order <= screeningBoundary &&
      (nextQuestion === null || nextQuestion.sort_order > screeningBoundary);

    if (isLeavingScreeningSection && activeAssignment?.id && !activeAssignment.screening_result) {
      try {
        const screeningOutput = await screeningService.recordResult({
          assignmentId: activeAssignment.id,
          result: "passed",
          lineUserId: input.userId
        });
        recordActionPath(
          diagnostics,
          `orchestrator:screening_passed:${screeningOutput.pass_action}`
        );

        if (screeningOutput.pass_action === "manual_hold") {
          // 手動送付待ち: スクリーニング通過メッセージは push 送信済み。セッションを終了。
          await sessionRepository.update(updatedSession.id, {
            status: "completed",
            current_phase: "completed",
            current_question_id: null,
            completed_at: new Date().toISOString()
          });
          // replyToken は空応答で消化（reply は messages.length === 0 のとき no-op）
          await replyWithTiming({
            replyToken: input.replyToken,
            messages: [],
            label: "screening_manual_hold",
            diagnostics,
            sessionId: activeSession.id
          });
          runDeferredTask(
            "post_answer_followups_failed",
            async () => {
              if (currentQuestion.question_type === "text") {
                await answerExtractionService.persistForAnswer(
                  primaryAnswer,
                  activeSession.project_id
                );
              }
              await postService.syncAnswerToPost({
                answer: primaryAnswer,
                respondent,
                session: activeSession,
                project,
                questionCode: currentQuestion.question_code,
                questionRole: currentQuestion.question_role
              });
              if (activeAssignment?.id) {
                await assignmentService.markAssignmentStarted(activeAssignment.id);
              }
            },
            { sessionId: activeSession.id, answerId: primaryAnswer.id }
          );
          return;
        }
        // survey / interview: pass メッセージ送信済み。そのまま次の質問へ進む。
      } catch (err) {
        logger.warn("Screening gate failed", {
          sessionId: activeSession.id,
          assignmentId: activeAssignment?.id,
          error: err instanceof Error ? err.message : String(err)
        });
      }
    }
    // ── /スクリーニングゲート ────────────────────────────────────────────────

    const pendingNextQuestionText =
      typeof structuredPrimaryAnswer.pending_next_question_text === "string" &&
      structuredPrimaryAnswer.pending_next_question_text.trim()
        ? structuredPrimaryAnswer.pending_next_question_text
        : null;
    const prompt =
      pendingNextQuestionText ??
      (await questionPrompt(
        {
          ...updatedSession,
          current_question_id: nextQuestion.id,
          current_phase: "question"
        },
        nextQuestion,
        diagnostics
      ));
    await replyWithTiming({
      replyToken: input.replyToken,
      messages: [buildTextMessage(prompt)],
      label: "next_question",
      diagnostics,
      sessionId: activeSession.id
    });

    // Build PendingNextQuestionCache for session resume support
    const hasBranching = preferredAction === null && rawNextQuestion?.id !== nextQuestion.id;
    const hasSkip = preferredAction === "skip";
    const sessionSlotMapForCache = await buildSessionSlotMap(activeSession.id);
    const nextQuestionCache =
      project.research_mode === "interview"
        ? buildNextQuestionCache({
            sessionId: activeSession.id,
            nextQuestion,
            collectedSlotMap: sessionSlotMapForCache,
            questionText: pendingNextQuestionText,
            hasBranching,
            hasSkip
          })
        : null;

    const nextSession = await sessionRepository.update(activeSession.id, {
      current_question_id: nextQuestion.id,
      current_phase: "question",
      state_json: {
        ...withQuestionMemory(updatedSession.state_json, prompt, null),
        phase: "question",
        currentQuestionIndex: await resolveQuestionIndex(activeSession.project_id, nextQuestion.id),
        pendingNextQuestionText: project.research_mode === "interview" ? prompt : null,
        pendingNextQuestionCache: nextQuestionCache
      }
    });

    // Emit structured turn log (spec section 8)
    logTurnResult({
      sessionId: activeSession.id,
      questionId: currentQuestion.id,
      questionType: currentQuestion.question_type,
      mode: project.research_mode,
      usedInterviewTurn: project.research_mode === "interview",
      probeExecuted: false,
      probeReason: null,
      skippedReason: hasSkip ? (preferredAction ?? null) : null,
      usedCache: Boolean(pendingNextQuestionText),
      cacheType: pendingNextQuestionText ? "text" : "none",
      collectedFieldSignature: buildCollectedFieldSignature(sessionSlotMapForCache)
    });

      recordActionPath(diagnostics, `orchestrator:next_question:${nextQuestion.question_code}`);
      await logAssistantMessage(nextSession.id, prompt);
      runDeferredTask("post_answer_followups_failed", async () => {
        if (currentQuestion.question_type === "text") {
          await answerExtractionService.persistForAnswer(primaryAnswer, activeSession.project_id);
        }
        await postService.syncAnswerToPost({
          answer: primaryAnswer,
          respondent,
          session: activeSession,
          project,
          questionCode: currentQuestion.question_code,
          questionRole: currentQuestion.question_role
        });
        if (activeAssignment?.id) {
          await assignmentService.markAssignmentStarted(activeAssignment.id);
        }
        await refreshSummaryIfNeeded(nextSession);
      }, { sessionId: activeSession.id, answerId: primaryAnswer.id, nextQuestion: nextQuestion.question_code });
    } finally {
      logTurnDiagnostics(diagnostics, activeSession.current_phase);
    }
  }
};
















