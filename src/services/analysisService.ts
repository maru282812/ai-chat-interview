import { analysisRepository } from "../repositories/analysisRepository";
import { postAnalysisRepository } from "../repositories/postAnalysisRepository";
import { postRepository } from "../repositories/postRepository";
import { projectAnalysisRepository } from "../repositories/projectAnalysisRepository";
import type {
  PostActionability,
  PostInsightType,
  PostQualityLabel,
  PostSentiment,
  Project,
  Session
} from "../types/domain";
import { aiService } from "./aiService";
import { researchOpsService } from "./researchOpsService";

const MEANINGLESS_PATTERNS = [
  /^特になし[。！!]*$/u,
  /^特にない[。！!]*$/u,
  /^なし[。！!]*$/u,
  /^ないです?[。！!]*$/u,
  /^わからない[。！!]*$/u,
  /^不明[。！!]*$/u,
  /^n\/a$/i,
  /^test$/i,
  /^[0-9０-９]{1,3}$/u,
  /^[あアaA]{1,4}$/u
];

const ABSTRACT_PATTERNS = [
  "なんとなく",
  "ふつう",
  "普通",
  "色々",
  "いろいろ",
  "まあ",
  "特に",
  "別に",
  "特段",
  "特別"
];

const CONCRETE_PATTERNS = [
  /\d/u,
  /(今日|昨日|先週|平日|休日|朝|昼|夜|通勤|退勤|会議|学校|職場|店|アプリ|画面|機能|料金|価格|上司|同僚|家族)/u,
  /(例えば|たとえば|具体的|実際|この前|先日|一度|毎回|いつも)/u
];

const EMOTION_PATTERNS = [
  /(嬉しい|楽しい|助かる|安心|満足|良い|好き|良かった|便利|最高)/u,
  /(困る|不満|嫌|つらい|悲しい|怒り|腹立つ|面倒|怖い|しんどい|不安)/u,
  /[!！?？]/u
];

const PRAISE_PATTERNS = ["良い", "好き", "助かる", "便利", "満足", "嬉しい", "良かった"];
const COMPLAINT_PATTERNS = ["不満", "嫌", "困る", "しんどい", "面倒", "つらい", "腹立つ"];
const REQUEST_PATTERNS = ["してほしい", "欲しい", "ほしい", "改善", "追加", "要望"];
const ISSUE_PATTERNS = ["課題", "問題", "うまくいか", "難しい", "できない", "不足"];

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return normalizeText(text)
    .split(/[。.!?\n]+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function uniqueCharacterRatio(text: string): number {
  const chars = [...text.replace(/\s+/g, "")];
  if (chars.length === 0) {
    return 0;
  }

  return new Set(chars).size / chars.length;
}

function matchesAnyPattern(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function containsAnyKeyword(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function resolveQualityLabel(score: number): PostQualityLabel {
  if (score >= 70) {
    return "high";
  }
  if (score >= 40) {
    return "medium";
  }
  return "low";
}

function normalizeSentiment(value: unknown): PostSentiment {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "positive" || normalized === "neutral" || normalized === "negative" || normalized === "mixed") {
    return normalized;
  }
  return "neutral";
}

function normalizeActionability(value: unknown): PostActionability {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "high" || normalized === "medium" || normalized === "low") {
    return normalized;
  }
  return "medium";
}

function normalizeInsightType(value: unknown, content: string): PostInsightType {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (
    normalized === "issue" ||
    normalized === "request" ||
    normalized === "complaint" ||
    normalized === "praise" ||
    normalized === "other"
  ) {
    return normalized;
  }

  if (["課題", "issue"].includes(String(value ?? ""))) {
    return "issue";
  }
  if (["要望", "request"].includes(String(value ?? ""))) {
    return "request";
  }
  if (["不満", "complaint"].includes(String(value ?? ""))) {
    return "complaint";
  }
  if (["好意", "praise"].includes(String(value ?? ""))) {
    return "praise";
  }

  if (containsAnyKeyword(content, REQUEST_PATTERNS)) {
    return "request";
  }
  if (containsAnyKeyword(content, COMPLAINT_PATTERNS)) {
    return "complaint";
  }
  if (containsAnyKeyword(content, ISSUE_PATTERNS)) {
    return "issue";
  }
  if (containsAnyKeyword(content, PRAISE_PATTERNS)) {
    return "praise";
  }

  return "other";
}

export const analysisService = {
  scorePostQuality(input: { content: string }) {
    const text = normalizeText(input.content);
    const charLength = text.length;
    const sentences = splitSentences(text);
    const meaningless = MEANINGLESS_PATTERNS.some((pattern) => pattern.test(text));
    const abstract = !meaningless && (charLength < 18 || ABSTRACT_PATTERNS.some((pattern) => text.includes(pattern)));
    const lengthScore =
      charLength >= 120 ? 35 : charLength >= 60 ? 28 : charLength >= 30 ? 18 : charLength >= 12 ? 8 : 2;
    const concreteSignalCount = CONCRETE_PATTERNS.filter((pattern) => pattern.test(text)).length;
    const specificityScore = clampScore(
      Math.min(40, sentences.length * 8 + concreteSignalCount * 12 + (charLength >= 40 ? 6 : 0))
    );
    const emotionScore = clampScore(
      Math.min(15, EMOTION_PATTERNS.filter((pattern) => pattern.test(text)).length * 5)
    );
    const originalityScore = clampScore(Math.min(15, uniqueCharacterRatio(text) * 25));
    const structureScore = sentences.length >= 2 ? 10 : sentences.length === 1 && charLength >= 25 ? 5 : 0;
    const penalty = meaningless ? 55 : abstract ? 15 : 0;
    const score = clampScore(
      lengthScore + Math.round(specificityScore * 0.45) + emotionScore + originalityScore + structureScore - penalty
    );

    return {
      score,
      label: resolveQualityLabel(score),
      specificity: specificityScore,
      novelty: clampScore(Math.min(100, originalityScore * 5 + (charLength >= 80 ? 10 : 0))),
      flags: {
        meaningless,
        abstract,
        short: charLength < 20
      }
    };
  },

  evaluateFreeCommentDepth(content: string): {
    shouldAskFollowUp: boolean;
    reason: "no_content" | "abstract" | null;
    prompt: string | null;
  } {
    const text = normalizeText(content);
    if (!text) {
      return {
        shouldAskFollowUp: true,
        reason: "no_content",
        prompt: "特になしとのことですが、そう感じた理由や背景があれば一言でも教えてください。"
      };
    }

    if (MEANINGLESS_PATTERNS.some((pattern) => pattern.test(text))) {
      return {
        shouldAskFollowUp: true,
        reason: "no_content",
        prompt: "「特になし」と感じた理由や、そう判断した場面があれば教えてください。"
      };
    }

    const quality = this.scorePostQuality({ content: text });
    if (quality.flags.abstract || quality.score < 45) {
      return {
        shouldAskFollowUp: true,
        reason: "abstract",
        prompt: "ありがとうございます。1つだけ、具体的な場面や実例があれば教えてください。"
      };
    }

    return {
      shouldAskFollowUp: false,
      reason: null,
      prompt: null
    };
  },

  async analyzeCompletedSession(input: {
    session: Session;
    project: Project;
    answers: Array<{
      question_code: string;
      question_text: string;
      answer_text: string;
      normalized_answer: Record<string, unknown> | null;
    }>;
  }) {
    const result = await aiService.finalAnalyze({
      sessionId: input.session.id,
      project: input.project,
      sessionSummary: input.session.summary ?? "",
      answers: input.answers
    });

    return analysisRepository.upsert({
      session_id: input.session.id,
      summary: String(result.summary ?? ""),
      usage_scene: String(result.usage_scene ?? ""),
      motive: String((result.motive ?? result.reason) ?? ""),
      pain_points: String((result.pain_points ?? result.pain_point) ?? ""),
      alternatives: String((result.alternatives ?? result.alternative) ?? ""),
      insight_candidates: String((result.insight_candidates ?? result.desired_state) ?? ""),
      raw_json: result
    });
  },

  async generateProjectAnalysisReport(projectId: string) {
    const dataset = await researchOpsService.buildProjectAnalysisDataset(projectId);
    if (dataset.respondent_count === 0) {
      return projectAnalysisRepository.create({
        project_id: dataset.project.id,
        respondent_count: 0,
        completed_session_count: 0,
        report_json: {
          executive_summary: "No respondent data available.",
          overall_trends: [],
          primary_objectives: [],
          secondary_objectives: [],
          comparison_focus: [],
          free_answer_policy: dataset.freeAnswerPolicy,
          respondent_summaries: []
        }
      });
    }

    const report = await aiService.generateProjectAnalysis({
      project: dataset.project,
      respondentSummaries: dataset.respondentSummaries,
      comparisonUnits: dataset.comparisonUnits,
      freeAnswerPolicy: dataset.freeAnswerPolicy
    });

    return projectAnalysisRepository.create({
      project_id: dataset.project.id,
      respondent_count: dataset.respondent_count,
      completed_session_count: dataset.completed_session_count,
      report_json: report
    });
  },

  async analyzePost(postId: string) {
    const post = await postRepository.getById(postId);
    if (!post) {
      return null;
    }

    const quality = this.scorePostQuality({ content: post.content });
    const result = await aiService.analyzePost({
      postId: post.id,
      postType: post.type,
      content: post.content,
      sourceMode: post.source_mode
    });

    const specificity =
      typeof result.specificity === "number" ? clampScore(result.specificity) : quality.specificity;
    const novelty = typeof result.novelty === "number" ? clampScore(result.novelty) : quality.novelty;
    const insightType = normalizeInsightType(result.insight_type, post.content);

    await postRepository.update(post.id, {
      quality_score: quality.score,
      quality_label: quality.label
    });

    return postAnalysisRepository.upsertByPostId({
      post_id: post.id,
      analysis_version: "v1",
      summary: result.summary ?? "",
      tags: result.tags ?? [],
      sentiment: normalizeSentiment(result.sentiment),
      keywords: result.keywords ?? [],
      actionability: normalizeActionability(result.actionability),
      insight_type: insightType,
      specificity,
      novelty,
      raw_json: {
        ...result,
        quality_score: quality.score,
        quality_label: quality.label,
        quality_flags: quality.flags,
        specificity,
        novelty,
        insight_type: insightType
      },
      analyzed_at: new Date().toISOString()
    });
  }
};
