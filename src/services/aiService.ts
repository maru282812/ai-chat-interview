import { env } from "../config/env";
import { openai } from "../config/openai";
import { aiLogRepository } from "../repositories/aiLogRepository";
import { buildFinalAnalysisPrompt, buildProbePrompt, buildSessionSummaryPrompt } from "../prompts/aiPrompts";

interface AITextResult {
  text: string;
  usage: Record<string, unknown> | null;
}

async function runTextPrompt(sessionId: string, purpose: string, prompt: string): Promise<AITextResult> {
  const response = await openai.responses.create({
    model: env.OPENAI_MODEL,
    input: prompt
  });

  const text = response.output_text.trim();
  await aiLogRepository.create({
    session_id: sessionId,
    purpose,
    prompt,
    response: text,
    token_usage: (response.usage as Record<string, unknown> | undefined) ?? null
  });

  return {
    text,
    usage: (response.usage as Record<string, unknown> | undefined) ?? null
  };
}

export const aiService = {
  async generateProbeQuestion(input: {
    sessionId: string;
    question: string;
    answer: string;
    sessionSummary: string;
  }): Promise<string> {
    const prompt = buildProbePrompt(input);
    const result = await runTextPrompt(input.sessionId, "probe_generation", prompt);
    return result.text.replace(/^["']|["']$/g, "");
  },

  async summarizeSession(input: {
    sessionId: string;
    previousSummary: string;
    recentTranscript: string;
  }): Promise<string> {
    const prompt = buildSessionSummaryPrompt(input);
    const result = await runTextPrompt(input.sessionId, "session_summary", prompt);
    return result.text;
  },

  async finalAnalyze(input: {
    sessionId: string;
    sessionSummary: string;
    answers: string;
  }): Promise<Record<string, string>> {
    const prompt = buildFinalAnalysisPrompt(input);
    const result = await runTextPrompt(input.sessionId, "final_analysis", prompt);
    return JSON.parse(result.text) as Record<string, string>;
  }
};
