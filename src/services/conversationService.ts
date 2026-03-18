import { env } from "../config/env";
import { answerRepository } from "../repositories/answerRepository";
import { messageRepository } from "../repositories/messageRepository";
import { projectRepository } from "../repositories/projectRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { logger } from "../lib/logger";
import { buildCompletionFlex, buildMypageFlex, buildRankFlex, buildRankUpMessages, buildWelcomeMessages } from "../templates/flex";
import type { LineMessage, Question, Session } from "../types/domain";
import { analysisService } from "./analysisService";
import { aiService } from "./aiService";
import { lineMessagingService } from "./lineMessagingService";
import { pointService } from "./pointService";
import { questionFlowService } from "./questionFlowService";
import { rankService } from "./rankService";
import { respondentService } from "./respondentService";

function normalizeCommand(text: string): string {
  return text.trim().toLowerCase();
}

function shouldProbeHeuristically(answerText: string): boolean {
  const trimmed = answerText.trim();
  if (trimmed.length <= 12) {
    return true;
  }

  const abstractPatterns = ["特にない", "普通", "いろいろ", "その時による", "場合による", "なんとなく"];
  return abstractPatterns.some((pattern) => trimmed.includes(pattern));
}

function helpMessages(): LineMessage[] {
  return [
    {
      type: "text",
      text: "使える操作: はじめる / 再開 / ポイント / ランク / マイページ / ヘルプ"
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

  const answers = await answerRepository.listBySession(session.id);
  const recentTranscript = answers
    .slice(-env.SESSION_SUMMARY_INTERVAL)
    .map((answer) => `${answer.question_id}: ${answer.answer_text}`)
    .join("\n");

  const summary = await aiService.summarizeSession({
    sessionId: session.id,
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

  const answers = await answerRepository.listBySession(session.id);
  const formattedAnswers = answers
    .map((answer, index) => `${index + 1}. ${answer.answer_text}`)
    .join("\n");

  try {
    await analysisService.analyzeCompletedSession({
      session: finalizedSession,
      formattedAnswers
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

export const conversationService = {
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

    if (normalizedCommand === "ヘルプ" || normalizedCommand === "help") {
      await lineMessagingService.reply(input.replyToken, helpMessages());
      return;
    }

    const activeSession = await sessionRepository.getActiveByRespondent(respondent.id, respondent.project_id);

    if (["ポイント", "ランク", "マイページ"].includes(input.text.trim())) {
      const currentRank = await rankService.resolveRank(respondent.total_points);
      const nextRank = await rankService.getNextRank(respondent.total_points);
      const card =
        input.text.trim() === "マイページ"
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

    if (["はじめる", "開始", "start"].includes(normalizedCommand)) {
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
          { type: "text", text: "現在開始できるインタビューがありません。" }
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

    if (normalizedCommand === "再開" || normalizedCommand === "resume") {
      if (!activeSession?.current_question_id) {
        await lineMessagingService.reply(input.replyToken, [
          { type: "text", text: "再開できる未完了インタビューはありません。「はじめる」で開始してください。" }
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
        { type: "text", text: "「はじめる」でインタビューを開始してください。" }
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
      const errorMessage = error instanceof Error ? error.message : "回答形式が正しくありません";
      await lineMessagingService.reply(input.replyToken, [{ type: "text", text: errorMessage }]);
      return;
    }

    await answerRepository.create({
      session_id: activeSession.id,
      question_id: currentQuestion.id,
      answer_text: parsedAnswer.answerText,
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

    const canProbe =
      currentQuestion.ai_probe_enabled &&
      shouldProbeHeuristically(parsedAnswer.answerText) &&
      (updatedSession.state_json?.aiProbeCount ?? 0) < env.MAX_AI_PROBES_PER_SESSION &&
      (updatedSession.state_json?.aiProbeCountCurrentAnswer ?? 0) < env.MAX_AI_PROBES_PER_ANSWER;

    if (canProbe) {
      try {
        const probeQuestion = await aiService.generateProbeQuestion({
          sessionId: activeSession.id,
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
