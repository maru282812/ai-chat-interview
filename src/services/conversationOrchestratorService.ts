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
  detectConversationCommand,
  evaluateProbeDecision
} from "../lib/conversationControl";
import {
  assessProbeNeed,
  buildInterviewQuestionFallback,
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
import { buildMypageFlex, buildRankFlex, buildWelcomeMessages } from "../templates/flex";
import type {
  AnswerAnalysisAction,
  LineMessage,
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
import { postService } from "./postService";
import { questionFlowService } from "./questionFlowServiceV2";
import { rankService } from "./rankService";
import { respondentService } from "./respondentService";

function buildTextMessage(text: string): LineMessage {
  return { type: "text", text };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
}): boolean {
  const meta = normalizeQuestionMeta(input.question, resolveQuestionMetaContext(input.question, input.projectMode));
  return (
    meta.can_prefill_future_slots &&
    input.questionProgress.isCurrentQuestionSatisfied &&
    !input.questionProgress.isBadAnswer &&
    !input.questionProgress.isAbstract &&
    !input.questionProgress.isLowSpecificity
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
      projectMode: input.project.research_mode
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
}): string {
  const meta = normalizeQuestionMeta(
    input.question,
    input.projectMode ? resolveQuestionMetaContext(input.question, input.projectMode) : undefined
  );
  const firstMissingSlot = input.missingSlots?.[0];
  const rawSlotLabel =
    meta.expected_slots.find((slot) => slot.key === firstMissingSlot)?.label ??
    meta.expected_slots.find((slot) => slot.key === firstMissingSlot)?.description ??
    firstMissingSlot ??
    "その点";
  const slotLabel = /^[a-z][a-z0-9_]*$/i.test(rawSlotLabel) ? "その点" : rawSlotLabel;

  switch (input.probeType) {
    case "missing_slot":
      return `${slotLabel}について、もう少し具体的に教えてください。`;
    case "clarify":
      return "今のご回答の意味が伝わるように、もう少し詳しく教えてください。";
    default:
      return "そのときの状況や理由がわかる具体例を1つ教えてください。";
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

async function questionPrompt(session: Session, question: Question): Promise<string> {
  const [questions, project] = await Promise.all([
    questionFlowService.listByProject(session.project_id),
    projectRepository.getById(session.project_id)
  ]);
  const currentIndex = questions.findIndex((item) => item.id === question.id) + 1;
  const progressLabel =
    project.research_mode === "interview" ? undefined : `Q${currentIndex}/${questions.length}`;

  if (project.research_mode === "interview" && question.question_type === "text") {
    const previousContext = await resolvePreviousQuestionContext(session);
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

function resolveImmediateProbe(input: {
  question: Question;
  answerText: string;
  projectMode: ResearchMode;
}): {
  probeType: StructuredProbeType;
  prompt: string;
  missingSlots: string[];
} | null {
  const trimmed = input.answerText.trim();
  const meta = normalizeQuestionMeta(input.question, resolveQuestionMetaContext(input.question, input.projectMode));
  const normalized = trimmed.replace(/\s+/g, "");
  const hardBadAnswers = new Set(["特になし", "なし", "わからない", "特にない"]);

  if (hardBadAnswers.has(normalized)) {
    return {
      probeType: "clarify",
      prompt: "そのままでは判断できないため、理由や具体例を1つ教えてください。",
      missingSlots: meta.expected_slots.filter((slot) => slot.required !== false).map((slot) => slot.key)
    };
  }

  if (trimmed.length < 5) {
    return {
      probeType: "concretize",
      prompt: "短いご回答だったため、そのときの状況や理由がわかるようにもう少し具体的に教えてください。",
      missingSlots: meta.expected_slots.filter((slot) => slot.required !== false).map((slot) => slot.key)
    };
  }

  return null;
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
  const immediateProbe = resolveImmediateProbe({
    question: input.question,
    answerText: combinedAnswer,
    projectMode: project.research_mode
  });
  const existingSlots = mergeSlotMaps(
    sessionSlotMap,
    input.existingSlots ?? extractSlotMap(input.baseNormalized)
  );
  const contextType = resolveQuestionMetaContext(input.question, project.research_mode);
  const meta = normalizeQuestionMeta(input.question, contextType, {
    projectAiState: project.ai_state_json
  });
  const aiProbeEnabled =
    settings.probe_policy.enabled &&
    (!settings.probe_policy.require_question_probe_enabled || input.question.ai_probe_enabled) &&
    meta.probe_config.max_probes > 0;
  const answerAnalysis = immediateProbe
    ? {
        action: "probe" as const,
        question: immediateProbe.prompt,
        reason: "immediate_probe_rule",
        collected_slots: existingSlots,
        is_sufficient: false,
        missing_slots: immediateProbe.missingSlots,
        probe_type: immediateProbe.probeType,
        confidence: 0.99
      }
    : await aiService.analyzeAnswer({
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
    contextType
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
}): Promise<void> {
  const freeCommentQuestion =
    (await questionRepository.getSystemFreeCommentQuestion(input.session.project_id)) ??
    (await questionRepository.ensureSystemFreeCommentQuestion(input.session.project_id));
  const sessionForPrompt = {
    ...input.session,
    current_question_id: freeCommentQuestion.id,
    current_phase: "free_comment" as const
  };
  const prompt = await questionPrompt(sessionForPrompt, freeCommentQuestion);
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
  await lineMessagingService.reply(input.replyToken, [buildTextMessage(prompt)]);
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
  await lineMessagingService.reply(input.replyToken, [
    buildTextMessage("ありがとうございます。完了処理を進めています。")
  ]);

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
  await lineMessagingService.reply(input.replyToken, [
    buildTextMessage("ありがとうございます。完了処理を進めています。")
  ]);

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
    await lineMessagingService.reply(input.replyToken, [
      buildTextMessage("この案件にはまだ質問が設定されていません。")
    ]);
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

  await lineMessagingService.reply(input.replyToken, replyMessages);
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
    await lineMessagingService.reply(input.replyToken, [buildTextMessage(buildNoActiveSessionText(settings.response_style))]);
    return;
  }

  if (input.assignmentId) {
    await assignmentService.markAssignmentOpened(input.assignmentId);
  }
  await logAssistantMessage(input.session.id, prompt);
  const messages = input.leadMessage
    ? [buildTextMessage(input.leadMessage), buildTextMessage(prompt)]
    : [buildTextMessage(prompt)];
  await lineMessagingService.reply(input.replyToken, messages);
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
  replyToken: string;
}): Promise<void> {
  if (input.preferredAction === "finish") {
    await enterFreeCommentPhase({
      session: input.session,
      replyToken: input.replyToken
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
    await enterFreeCommentPhase({
      session: input.session,
      replyToken: input.replyToken
    });
    return;
  }

  const prompt = await questionPrompt(
    {
      ...input.session,
      current_question_id: nextQuestion.id,
      current_phase: "question"
    },
    nextQuestion
  );
  const nextQuestionIndex = await resolveQuestionIndex(input.session.project_id, nextQuestion.id);

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
      aiProbeCountCurrentAnswer: 0
    }
  });
  await logAssistantMessage(nextSession.id, prompt);
  await lineMessagingService.reply(input.replyToken, [buildTextMessage(prompt)]);
}

async function maybeAskProbe(input: {
  session: Session;
  question: Question;
  answerText: string;
  answerId?: string | null;
  answerPayload?: Record<string, unknown> | null;
  pendingQuestionId: string | null;
  replyToken: string;
}): Promise<boolean> {
  const { project, settings } = await resolveProjectContext(input.session.project_id);
  const currentProbeCountForAnswer = input.session.state_json?.aiProbeCountCurrentAnswer ?? 0;
  const currentProbeCountForSession = input.session.state_json?.aiProbeCount ?? 0;
  const contextType = resolveQuestionMetaContext(input.question, project.research_mode);
  const meta = normalizeQuestionMeta(input.question, contextType);
  const maxProbesPerSession = Math.min(
    env.MAX_AI_PROBES_PER_SESSION,
    settings.probe_policy.max_probes_per_session
  );
  const maxProbesPerAnswer = Math.min(
    env.MAX_AI_PROBES_PER_ANSWER,
    settings.probe_policy.max_probes_per_answer,
    meta.probe_config.max_probes
  );

  if (currentProbeCountForSession >= maxProbesPerSession) {
    return false;
  }

  if (input.question.question_type === "text") {
    if (currentProbeCountForAnswer >= maxProbesPerAnswer) {
      return false;
    }

    const extractedSlots = Array.isArray(input.answerPayload?.extracted_slots)
      ? (input.answerPayload?.extracted_slots as StructuredAnswerPayload["extracted_slots"])
      : [];
    const analysisAction = extractAnalysisAction(input.answerPayload);
    const payloadProbeType =
      input.answerPayload?.suggested_probe_type === "missing_slot" ||
      input.answerPayload?.suggested_probe_type === "concretize" ||
      input.answerPayload?.suggested_probe_type === "clarify"
        ? (input.answerPayload.suggested_probe_type as StructuredProbeType)
        : null;
    const assessment = assessProbeNeed({
      question: input.question,
      answerText: input.answerText,
      extractedSlots: extractedSlots ?? [],
      currentProbeCountForAnswer,
      contextType
    });
    const probeType = payloadProbeType ?? assessment.probeType;

    if ((analysisAction === "probe" || input.answerPayload?.needs_probe || assessment.shouldProbe) && probeType) {
      let prompt =
        extractSuggestedProbeQuestion(input.answerPayload)
          ? extractSuggestedProbeQuestion(input.answerPayload)
          : buildStructuredProbeFallback({
              question: input.question,
              probeType,
              missingSlots: assessment.missingSlots,
              projectMode: project.research_mode
            });
      prompt = prompt ?? buildStructuredProbeFallback({
        question: input.question,
        probeType,
        missingSlots: assessment.missingSlots,
        projectMode: project.research_mode
      });

      if (input.session.state_json?.lastProbeType === probeType || isQuestionSimilarToLast(input.session, prompt)) {
        return false;
      }

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
          pendingProbeMissingSlots: assessment.missingSlots,
          aiProbeCount: currentProbeCountForSession + 1,
          aiProbeCountCurrentAnswer: currentProbeCountForAnswer + 1
        }
      });

      await logAssistantMessage(probingSession.id, prompt);
      await lineMessagingService.reply(input.replyToken, [buildTextMessage(prompt)]);
      return true;
    }

    return false;
  }

  if (currentProbeCountForAnswer >= maxProbesPerAnswer) {
    return false;
  }

  const decision = evaluateProbeDecision({
    question: input.question,
    answerText: input.answerText,
    projectSettings: settings,
    currentProbeCountForAnswer,
    currentProbeCountForSession,
    maxProbesPerAnswer,
    maxProbesPerSession
  });

  if (!decision.shouldProbe || !decision.prompt) {
    return false;
  }

  if (isQuestionSimilarToLast(input.session, decision.prompt)) {
    return false;
  }

  const probingSession = await sessionRepository.update(input.session.id, {
    current_phase: "ai_probe",
    current_question_id: input.question.id,
    state_json: {
      ...withQuestionMemory(input.session.state_json, decision.prompt, null),
      phase: "ai_probe",
      pendingQuestionId: input.pendingQuestionId,
      pendingProbeQuestion: decision.prompt,
      pendingProbeSourceQuestionId: input.question.id,
      pendingProbeSourceAnswerId:
        input.answerId ?? input.session.state_json?.pendingProbeSourceAnswerId ?? null,
      pendingProbeReason: decision.reason,
      pendingProbeType: null,
      pendingProbeMissingSlots: [],
      aiProbeCount: currentProbeCountForSession + 1,
      aiProbeCountCurrentAnswer: currentProbeCountForAnswer + 1
    }
  });

  await logAssistantMessage(probingSession.id, decision.prompt);
  await lineMessagingService.reply(input.replyToken, [buildTextMessage(decision.prompt)]);
  return true;
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
        await lineMessagingService.reply(input.replyToken, menuAction.messages);
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
    if (command === "points" || command === "rank" || command === "mypage") {
      const currentRank = await rankService.resolveRank(respondent.total_points);
      const nextRank = await rankService.getNextRank(respondent.total_points);
      const card =
        command === "mypage"
          ? buildMypageFlex({
              rankName: currentRank?.rank_name ?? "Bronze",
              badgeLabel: currentRank?.badge_label ?? "",
              totalPoints: respondent.total_points,
              nextRank,
              pointsToNext: nextRank ? nextRank.min_points - respondent.total_points : null,
              hasActiveSession: Boolean(activeSession)
            })
          : buildRankFlex({
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
        existingSlots: extractSlotMap(existingFreeCommentSourceAnswer?.normalized_answer ?? null)
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

      const extractedSlots = Array.isArray(freeCommentNormalized.extracted_slots)
        ? (freeCommentNormalized.extracted_slots as StructuredAnswerPayload["extracted_slots"])
        : [];
      const currentProbeCountForAnswer = activeSession.state_json?.aiProbeCountCurrentAnswer ?? 0;
      const assessment = assessProbeNeed({
        question: freeCommentQuestion,
        answerText: combinedFreeCommentText,
        extractedSlots: extractedSlots ?? [],
        currentProbeCountForAnswer,
        contextType: "free_comment"
      });
      const freeCommentProbeType =
        freeCommentNormalized.suggested_probe_type === "missing_slot" ||
        freeCommentNormalized.suggested_probe_type === "concretize" ||
        freeCommentNormalized.suggested_probe_type === "clarify"
          ? (freeCommentNormalized.suggested_probe_type as StructuredProbeType)
          : assessment.probeType;
      const freeCommentAction = extractAnalysisAction(freeCommentNormalized);
      const freeCommentPrompt =
        extractSuggestedProbeQuestion(freeCommentNormalized) ??
        (freeCommentProbeType
          ? buildStructuredProbeFallback({
              question: freeCommentQuestion,
              probeType: freeCommentProbeType,
              missingSlots: assessment.missingSlots,
              projectMode: project.research_mode
            })
          : null);

      if (
        (freeCommentAction === "probe" || Boolean(freeCommentNormalized.needs_probe) || assessment.shouldProbe) &&
        freeCommentProbeType &&
        freeCommentPrompt &&
        activeSession.state_json?.lastProbeType !== freeCommentProbeType &&
        !isQuestionSimilarToLast(activeSession, freeCommentPrompt)
      ) {

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
            pendingFreeCommentMissingSlots: assessment.missingSlots,
            answersSinceSummary: (activeSession.state_json?.answersSinceSummary ?? 0) + 1,
            aiProbeCount: (activeSession.state_json?.aiProbeCount ?? 0) + 1,
            aiProbeCountCurrentAnswer: currentProbeCountForAnswer + 1
          }
        });

        await logAssistantMessage(probingSession.id, freeCommentPrompt);
        await lineMessagingService.reply(input.replyToken, [buildTextMessage(freeCommentPrompt)]);
        return;
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

      if (freeCommentPost?.id) {
        void analysisService.analyzePost(freeCommentPost.id).catch((error) => {
          logger.warn("Post analysis failed", {
            postId: freeCommentPost.id,
            error: error instanceof Error ? error.message : String(error)
          });
        });
      }
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
        existingSlots: extractSlotMap(sourceAnswer?.normalized_answer ?? null)
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

      try {
        updatedSession = await refreshSummaryIfNeeded(updatedSession);
      } catch (error) {
        logger.warn("Session summary update failed", {
          sessionId: activeSession.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }

      const nextPendingQuestionId = updatedSession.state_json?.pendingQuestionId ?? null;
      const preferredAction = extractAnalysisAction(mergedNormalizedAnswer);
      const askedNextProbe = await maybeAskProbe({
        session: updatedSession,
        question: currentQuestion,
        answerText: mergedAnswerText,
        answerId: sourceAnswerId,
        answerPayload: mergedNormalizedAnswer,
        pendingQuestionId: nextPendingQuestionId,
        replyToken: input.replyToken
      });

      if (askedNextProbe) {
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
        replyToken: input.replyToken
      });
      return;
    }
    const currentQuestion = await questionFlowService.getQuestion(activeSession.current_question_id);

    let parsedAnswer;
    try {
      parsedAnswer = questionFlowService.parseAnswer(currentQuestion, input.text);
    } catch {
      const prompt = await questionPrompt(activeSession, currentQuestion);
      await lineMessagingService.reply(input.replyToken, [buildTextMessage(buildInvalidAnswerText({ question: currentQuestion, responseStyle: settings.response_style })), buildTextMessage(prompt)]);
      return;
    }

    const branchRule = normalizeBranchRule(currentQuestion.branch_rule);
    const requiresExtractedBranching = Boolean(
      branchRule?.branches?.some((branch) => branch.source === "extracted")
    );
    const extractedPrimaryAnswer =
      currentQuestion.question_type === "text"
        ? await answerExtractionService.enrichAnswerForConversation({
            sessionId: activeSession.id,
            project,
            question: currentQuestion,
            answerText: parsedAnswer.answerText,
            baseNormalized: parsedAnswer.normalizedAnswer,
            requireForBranching: requiresExtractedBranching
          })
        : null;
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
      existingSlots: {}
    });
    const primaryAnswer = await answerRepository.create({
      session_id: activeSession.id,
      question_id: currentQuestion.id,
      answer_text: parsedAnswer.answerText,
      answer_role: "primary",
      parent_answer_id: null,
      normalized_answer: structuredPrimaryAnswer
    });
    await answerExtractionService.persistForAnswer(primaryAnswer, activeSession.project_id);

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

    try {
      updatedSession = await refreshSummaryIfNeeded(updatedSession);
    } catch (error) {
      logger.warn("Session summary update failed", {
        sessionId: activeSession.id,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    const askedProbe = await maybeAskProbe({
      session: updatedSession,
      question: currentQuestion,
      answerText: parsedAnswer.answerText,
      answerId: primaryAnswer.id,
      answerPayload: structuredPrimaryAnswer,
      pendingQuestionId: rawNextQuestion?.id ?? null,
      replyToken: input.replyToken
    });

    if (askedProbe) {
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
      await enterFreeCommentPhase({
        session: updatedSession,
        replyToken: input.replyToken
      });
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
      await enterFreeCommentPhase({
        session: updatedSession,
        replyToken: input.replyToken
      });
      return;
    }

    const prompt = await questionPrompt(
      {
        ...updatedSession,
        current_question_id: nextQuestion.id,
        current_phase: "question"
      },
      nextQuestion
    );
    const nextSession = await sessionRepository.update(activeSession.id, {
      current_question_id: nextQuestion.id,
      current_phase: "question",
      state_json: {
        ...withQuestionMemory(updatedSession.state_json, prompt, null),
        phase: "question",
        currentQuestionIndex: await resolveQuestionIndex(activeSession.project_id, nextQuestion.id)
      }
    });

    await logAssistantMessage(nextSession.id, prompt);
    await lineMessagingService.reply(input.replyToken, [buildTextMessage(prompt)]);
  }
};


















