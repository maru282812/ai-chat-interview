import { env } from "../config/env";
import { getProjectAIState } from "../lib/projectAiState";
import { getProjectResearchSettings } from "../lib/projectResearch";
import { logger } from "../lib/logger";
import { answerRepository } from "../repositories/answerRepository";
import { messageRepository } from "../repositories/messageRepository";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { buildCompletionFlex, buildMypageFlex, buildRankFlex, buildRankUpMessages, buildWelcomeMessages } from "../templates/flex";
import type { LineMessage, Question, Session } from "../types/domain";
import { analysisService } from "./analysisService";
import { aiService } from "./aiService";
import { lineMessagingService } from "./lineMessagingService";
import { pointService } from "./pointService";
import { questionFlowService } from "./questionFlowServiceV2";
import { rankService } from "./rankService";
import { respondentService } from "./respondentService";

const HELP_COMMANDS = ["help", "ヘルプ"];
const START_COMMANDS = ["start", "はじめる", "開始"];
const RESUME_COMMANDS = ["resume", "再開"];
const RANK_COMMANDS = ["rank", "ランク"];
const MYPAGE_COMMANDS = ["mypage", "マイページ"];
const POINT_COMMANDS = ["point", "points", "ポイント"];
const ABSTRACT_PATTERNS = ["普通", "いろいろ", "なんとなく", "特に", "状況による", "場合による"];

function normalizeCommand(text: string): string {
  return text.trim().toLowerCase();
}

function matchesCommand(text: string, candidates: string[]): boolean {
  return candidates.includes(normalizeCommand(text));
}

function shouldProbeHeuristically(answerText: string, conditions: string[]): boolean {
  const trimmed = answerText.trim();
  const conditionMatch = {
    short_answer: trimmed.length <= 12,
    abstract_answer: ABSTRACT_PATTERNS.some((pattern) => trimmed.includes(pattern))
  };

  return conditions.some((condition) => conditionMatch[condition as "short_answer" | "abstract_answer"]);
}

function canProbeForProject(input: {
  question: Question;
  answerText: string;
  session: Session;
  projectId: string;
}): Promise<boolean> {
  return projectRepository.getById(input.projectId).then((project) => {
    const settings = getProjectResearchSettings(project);
    const projectAiState = project.ai_state_json ? getProjectAIState(project) : null;
    const maxPerSession = Math.min(
      env.MAX_AI_PROBES_PER_SESSION,
      settings.probe_policy.max_probes_per_session
    );
    const maxPerAnswer = Math.min(
      env.MAX_AI_PROBES_PER_ANSWER,
      projectAiState?.probe_policy.default_max_probes ?? settings.probe_policy.max_probes_per_answer
    );

    if (!settings.probe_policy.enabled) {
      return false;
    }

    if (settings.probe_policy.require_question_probe_enabled && !input.question.ai_probe_enabled) {
      return false;
    }

    if (!shouldProbeHeuristically(input.answerText, settings.probe_policy.conditions)) {
      return false;
    }

    return (
      (input.session.state_json?.aiProbeCount ?? 0) < maxPerSession &&
      (input.session.state_json?.aiProbeCountCurrentAnswer ?? 0) < maxPerAnswer
    );
  });
}

function helpMessages(): LineMessage[] {
  return [
    {
      type: "text",
      text: "使えるコマンド: start / resume / help / points / rank / mypage"
    }
  ];
}

async function questionPrompt(projectId: string, question: Question): Promise<string> {
  const questions = await questionFlowService.listByProject(projectId);
  const currentIndex = questions.findIndex((item) => item.id === question.id) + 1;
  return questionFlowService.renderQuestion(question, `Q${currentIndex}/${questions.length}`);
}

async function logAssistantMessage(sessionId: string, text: string): Promise<void> {
  await messageRepository.create({
    session_id: sessionId,
    sender_type: "assistant",
    message_text: text,
    raw_payload: null
  });
}

async function refreshSummaryIfNeeded(session: Session): Promise<Session> {
  const answersSinceSummary = session.state_json?.answersSinceSummary ?? 0;
  if (answersSinceSummary < env.SESSION_SUMMARY_INTERVAL) {
    return session;
  }

  const [project, answers] = await Promise.all([
    projectRepository.getById(session.project_id),
    answerRepository.listBySession(session.id)
  ]);
  const recentTranscript = answers
    .slice(-env.SESSION_SUMMARY_INTERVAL)
    .map((answer) => `${answer.question_id}: ${answer.answer_text}`)
    .join("\n");

  const summary = await aiService.summarizeSession({
    sessionId: session.id,
    project,
    previousSummary: session.summary ?? "",
    recentTranscript
  });

  return sessionRepository.update(session.id, {
    summary,
    state_json: {
      ...session.state_json,
      answersSinceSummary: 0
    }
  });
}

async function completeSession(session: Session, lineUserId: string): Promise<LineMessage[]> {
  const project = await projectRepository.getById(session.project_id);
  const respondent = await respondentService.getRespondent(lineUserId);
  if (!respondent) {
    throw new Error("Respondent not found during completion");
  }

  const finalizedSession = await sessionRepository.update(session.id, {
    status: "completed",
    current_phase: "completed",
    current_question_id: null,
    completed_at: new Date().toISOString()
  });

  const [answers, questions] = await Promise.all([
    answerRepository.listBySession(session.id),
    questionRepository.listByProject(session.project_id, { includeHidden: true })
  ]);
  const questionMap = new Map(questions.map((question) => [question.id, question]));
  const analysisAnswers = answers
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

  try {
    await analysisService.analyzeCompletedSession({
      session: finalizedSession,
      project,
      answers: analysisAnswers
    });
  } catch (error) {
    logger.warn("Final analysis failed", {
      sessionId: session.id,
      error: error instanceof Error ? error.message : String(error)
    });
  }

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
  const currentRank =
    rankResult.newRank ?? (await rankService.resolveRank(awardResult.updatedRespondent.total_points));

  const replyMessages: LineMessage[] = [
    buildCompletionFlex(
      awardResult.totalAwarded,
      awardResult.updatedRespondent.total_points,
      currentRank?.rank_name ?? "Bronze"
    )
  ];

  if (rankResult.changed && currentRank) {
    replyMessages.push(...buildRankUpMessages(currentRank.rank_name));
  }

  return replyMessages;
}

export const conversationRuntimeService = {
  async handleFollowEvent(userId: string, replyToken: string): Promise<void> {
    const profile = await lineMessagingService.getProfile(userId);
    await respondentService.ensureRespondent(userId, profile.displayName);
    await lineMessagingService.reply(replyToken, buildWelcomeMessages());
  },

  async handleTextMessage(input: {
    userId: string;
    replyToken: string;
    text: string;
    rawPayload: Record<string, unknown>;
  }): Promise<void> {
    const profile = await lineMessagingService.getProfile(input.userId);
    const respondent = await respondentService.ensureRespondent(input.userId, profile.displayName);
    const normalizedCommand = normalizeCommand(input.text);
    const activeSession = await sessionRepository.getActiveByRespondent(
      respondent.id,
      respondent.project_id
    );

    if (HELP_COMMANDS.includes(normalizedCommand)) {
      await lineMessagingService.reply(input.replyToken, helpMessages());
      return;
    }

    if (
      POINT_COMMANDS.includes(normalizedCommand) ||
      RANK_COMMANDS.includes(normalizedCommand) ||
      MYPAGE_COMMANDS.includes(normalizedCommand)
    ) {
      const currentRank = await rankService.resolveRank(respondent.total_points);
      const nextRank = await rankService.getNextRank(respondent.total_points);
      const card = MYPAGE_COMMANDS.includes(normalizedCommand)
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

    if (START_COMMANDS.includes(normalizedCommand)) {
      if (activeSession?.current_question_id) {
        const currentQuestion = await questionFlowService.getQuestion(activeSession.current_question_id);
        const prompt = await questionPrompt(activeSession.project_id, currentQuestion);
        await logAssistantMessage(activeSession.id, prompt);
        await lineMessagingService.reply(input.replyToken, [{ type: "text", text: prompt }]);
        return;
      }

      const firstQuestion = await questionFlowService.getFirstQuestion(respondent.project_id);
      if (!firstQuestion) {
        await lineMessagingService.reply(input.replyToken, [
          { type: "text", text: "このプロジェクトにはまだ質問がありません。" }
        ]);
        return;
      }

      const session = await sessionRepository.create({
        respondent_id: respondent.id,
        project_id: respondent.project_id,
        current_question_id: firstQuestion.id,
        current_phase: "question",
        status: "active",
        summary: null,
        state_json: {
          answersSinceSummary: 0,
          aiProbeCount: 0,
          aiProbeCountCurrentAnswer: 0
        }
      });

      await messageRepository.create({
        session_id: session.id,
        sender_type: "system",
        message_text: "session_started",
        raw_payload: input.rawPayload
      });

      const prompt = await questionPrompt(session.project_id, firstQuestion);
      await logAssistantMessage(session.id, prompt);
      await lineMessagingService.reply(input.replyToken, [{ type: "text", text: prompt }]);
      return;
    }

    if (RESUME_COMMANDS.includes(normalizedCommand)) {
      if (!activeSession?.current_question_id) {
        await lineMessagingService.reply(input.replyToken, [
          { type: "text", text: "再開できるセッションがありません。start と送って開始してください。" }
        ]);
        return;
      }

      const currentQuestion = await questionFlowService.getQuestion(activeSession.current_question_id);
      const prompt = await questionPrompt(activeSession.project_id, currentQuestion);
      await logAssistantMessage(activeSession.id, prompt);
      await lineMessagingService.reply(input.replyToken, [{ type: "text", text: prompt }]);
      return;
    }

    if (!activeSession || !activeSession.current_question_id) {
      await lineMessagingService.reply(input.replyToken, [
        { type: "text", text: "start と送るとインタビューを開始できます。" }
      ]);
      return;
    }

    await messageRepository.create({
      session_id: activeSession.id,
      sender_type: "user",
      message_text: input.text,
      raw_payload: input.rawPayload
    });

    if (activeSession.current_phase === "ai_probe") {
      await answerRepository.create({
        session_id: activeSession.id,
        question_id: activeSession.current_question_id,
        answer_text: input.text.trim(),
        answer_role: "ai_probe",
        parent_answer_id: activeSession.state_json?.pendingProbeSourceAnswerId ?? null,
        normalized_answer: {
          value: input.text.trim(),
          source: "ai_probe"
        }
      });

      const pendingQuestionId = activeSession.state_json?.pendingQuestionId ?? null;
      if (!pendingQuestionId) {
        const completionMessages = await completeSession(activeSession, input.userId);
        await lineMessagingService.reply(input.replyToken, completionMessages);
        return;
      }

      const nextSession = await sessionRepository.update(activeSession.id, {
        current_question_id: pendingQuestionId,
        current_phase: "question",
        state_json: {
          ...activeSession.state_json,
          pendingQuestionId: null,
          pendingProbeQuestion: null,
          pendingProbeSourceAnswerId: null,
          aiProbeCountCurrentAnswer: 0
        }
      });

      const nextQuestion = await questionFlowService.getQuestion(pendingQuestionId);
      const prompt = await questionPrompt(nextSession.project_id, nextQuestion);
      await logAssistantMessage(nextSession.id, prompt);
      await lineMessagingService.reply(input.replyToken, [{ type: "text", text: prompt }]);
      return;
    }

    const currentQuestion = await questionFlowService.getQuestion(activeSession.current_question_id);

    let parsedAnswer;
    try {
      parsedAnswer = questionFlowService.parseAnswer(currentQuestion, input.text);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "回答を解釈できませんでした。";
      await lineMessagingService.reply(input.replyToken, [{ type: "text", text: errorMessage }]);
      return;
    }

    const primaryAnswer = await answerRepository.create({
      session_id: activeSession.id,
      question_id: currentQuestion.id,
      answer_text: parsedAnswer.answerText,
      answer_role: "primary",
      parent_answer_id: null,
      normalized_answer: parsedAnswer.normalizedAnswer
    });

    const nextQuestion = await questionFlowService.determineNextQuestion(
      activeSession.project_id,
      currentQuestion,
      parsedAnswer.normalizedAnswer
    );

    let updatedSession = await sessionRepository.update(activeSession.id, {
      current_phase: "question",
      state_json: {
        ...activeSession.state_json,
        answersSinceSummary: (activeSession.state_json?.answersSinceSummary ?? 0) + 1,
        aiProbeCountCurrentAnswer: 0
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

    const canProbe = await canProbeForProject({
      question: currentQuestion,
      answerText: parsedAnswer.answerText,
      session: updatedSession,
      projectId: activeSession.project_id
    });

    if (canProbe) {
      try {
        const project = await projectRepository.getById(activeSession.project_id);
        const probeQuestion = await aiService.generateProbeQuestion({
          sessionId: activeSession.id,
          project,
          question: currentQuestion.question_text,
          answer: parsedAnswer.answerText,
          sessionSummary: updatedSession.summary ?? ""
        });

        const probingSession = await sessionRepository.update(activeSession.id, {
          current_phase: "ai_probe",
          current_question_id: currentQuestion.id,
          state_json: {
            ...updatedSession.state_json,
            pendingQuestionId: nextQuestion?.id ?? null,
            pendingProbeQuestion: probeQuestion,
            pendingProbeSourceAnswerId: primaryAnswer.id,
            aiProbeCount: (updatedSession.state_json?.aiProbeCount ?? 0) + 1,
            aiProbeCountCurrentAnswer: 1
          }
        });

        await logAssistantMessage(probingSession.id, probeQuestion);
        await lineMessagingService.reply(input.replyToken, [{ type: "text", text: probeQuestion }]);
        return;
      } catch (error) {
        logger.warn("AI probe generation failed", {
          sessionId: activeSession.id,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    if (!nextQuestion) {
      const completionMessages = await completeSession(updatedSession, input.userId);
      await lineMessagingService.reply(input.replyToken, completionMessages);
      return;
    }

    const nextSession = await sessionRepository.update(activeSession.id, {
      current_question_id: nextQuestion.id,
      current_phase: "question"
    });

    const prompt = await questionPrompt(nextSession.project_id, nextQuestion);
    await logAssistantMessage(nextSession.id, prompt);
    await lineMessagingService.reply(input.replyToken, [{ type: "text", text: prompt }]);
  }
};
