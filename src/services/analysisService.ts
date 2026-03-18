import { analysisRepository } from "../repositories/analysisRepository";
import type { Session } from "../types/domain";
import { aiService } from "./aiService";

export const analysisService = {
  async analyzeCompletedSession(input: { session: Session; formattedAnswers: string }) {
    const result = await aiService.finalAnalyze({
      sessionId: input.session.id,
      sessionSummary: input.session.summary ?? "",
      answers: input.formattedAnswers
    });

    return analysisRepository.upsert({
      session_id: input.session.id,
      summary: result.summary ?? "",
      usage_scene: result.usage_scene ?? "",
      motive: result.motive ?? "",
      pain_points: result.pain_points ?? "",
      alternatives: result.alternatives ?? "",
      insight_candidates: result.insight_candidates ?? "",
      raw_json: result
    });
  }
};
