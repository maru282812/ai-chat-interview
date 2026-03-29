import { personalityProfileRepository } from "../repositories/personalityProfileRepository";
import { postAnalysisRepository } from "../repositories/postAnalysisRepository";
import { postRepository } from "../repositories/postRepository";
import type { PostAnalysis, UserPersonalityProfile, UserPost } from "../types/domain";

const MIN_POSTS_FOR_PROFILE = 4;
const MIN_CONTENT_LENGTH = 20;

function truncate(text: string, max = 120): string {
  return text.length <= max ? text : `${text.slice(0, max - 3).trim()}...`;
}

function topValues(values: unknown[] | null | undefined, limit = 3): string[] {
  const counts = new Map<string, number>();
  for (const value of values ?? []) {
    const normalized = String(value).trim();
    if (!normalized) {
      continue;
    }
    counts.set(normalized, (counts.get(normalized) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function percentage(part: number, total: number): number {
  if (total === 0) {
    return 0;
  }
  return Math.round((part / total) * 100);
}

function buildInsufficientMessage(postCount: number): string {
  const missingCount = Math.max(0, MIN_POSTS_FOR_PROFILE - postCount);
  return `データ不足です。あと${missingCount}件ほど投稿が集まると性格傾向を表示できます。`;
}

function buildProfileSummary(typeLabel: string, features: string[]): string {
  return `${typeLabel}寄り。${features.slice(0, 2).join(" ")}`;
}

function resolvePersonalityType(input: {
  averageSpecificity: number;
  averageQuality: number;
  positiveCount: number;
  negativeLikeCount: number;
}): string {
  if (input.averageSpecificity >= 60 && input.averageQuality >= 60) {
    return "論理型";
  }
  if (input.negativeLikeCount >= input.positiveCount + 1) {
    return "課題発見型";
  }
  if (input.positiveCount >= input.negativeLikeCount + 1) {
    return "ポジティブ表現型";
  }
  return "感情型";
}

function buildFeatures(input: {
  typeLabel: string;
  diaryCount: number;
  rantCount: number;
  recurringKeywords: string[];
  recurringTags: string[];
  averageSpecificity: number;
  averageQuality: number;
  insightTypes: string[];
}): string[] {
  const features: string[] = [];

  if (input.typeLabel === "論理型") {
    features.push("具体的な状況や理由を添えて書く傾向があります。");
  }
  if (input.typeLabel === "感情型") {
    features.push("感情の動きや体験の印象を言葉にしやすい傾向があります。");
  }
  if (input.typeLabel === "課題発見型") {
    features.push("使いづらさや改善点を見つける視点が強めです。");
  }
  if (input.typeLabel === "ポジティブ表現型") {
    features.push("満足した点や良かった点を素直に表現する傾向があります。");
  }
  if (input.diaryCount >= 2) {
    features.push("日常の出来事を継続的に振り返る習慣があります。");
  }
  if (input.rantCount >= 2) {
    features.push("不満や違和感を言語化して外に出す傾向があります。");
  }
  if (input.averageSpecificity >= 55) {
    features.push("発言の具体度が高く、企業分析に使いやすい投稿が多いです。");
  }
  if (input.averageQuality >= 65) {
    features.push("投稿品質が安定しており、継続観測に向いています。");
  }
  if (input.recurringKeywords.length > 0) {
    features.push(`関心テーマは「${input.recurringKeywords.join(" / ")}」に寄っています。`);
  }
  if (input.recurringTags.length > 0) {
    features.push(`投稿の主軸は「${input.recurringTags.join(" / ")}」です。`);
  }
  if (input.insightTypes.length > 0) {
    features.push(`よく出る示唆は「${input.insightTypes.join(" / ")}」です。`);
  }

  return Array.from(new Set(features)).slice(0, 5);
}

function buildBehaviorTendencies(input: {
  diaryCount: number;
  rantCount: number;
  recurringKeywords: string[];
  averageSpecificity: number;
  negativeLikeCount: number;
}): string[] {
  const tendencies: string[] = [];

  if (input.averageSpecificity >= 55) {
    tendencies.push("背景や具体例を添えて説明する行動が見られます。");
  } else {
    tendencies.push("まず印象ベースで話し、その後に詳細が出てくる傾向があります。");
  }
  if (input.rantCount >= input.diaryCount) {
    tendencies.push("違和感やストレスを感じた瞬間に反応しやすいです。");
  } else {
    tendencies.push("日々の出来事を落ち着いて整理する傾向があります。");
  }
  if (input.negativeLikeCount >= 2) {
    tendencies.push("改善余地を見つけると行動や発言に出やすいです。");
  }
  if (input.recurringKeywords.length > 0) {
    tendencies.push(`「${input.recurringKeywords[0]}」周辺の出来事に反応しやすいです。`);
  }

  return Array.from(new Set(tendencies)).slice(0, 4);
}

function readyFromStoredProfile(profile: UserPersonalityProfile, evidencePosts: UserPost[]) {
  const raw = profile.raw_json ?? {};
  return {
    status: "ready" as const,
    message: profile.summary ?? "性格傾向を表示しています。",
    postCount: evidencePosts.length,
    profile,
    evidencePosts,
    recurringKeywords: Array.isArray(raw.recurring_keywords) ? raw.recurring_keywords : [],
    recurringTags: Array.isArray(raw.recurring_tags) ? raw.recurring_tags : [],
    personalityType: typeof raw.personality_type === "string" ? raw.personality_type : "判定中",
    features: Array.isArray(raw.features) ? raw.features.map((item) => String(item)) : [],
    behaviorTendencies: Array.isArray(raw.behavior_tendencies)
      ? raw.behavior_tendencies.map((item) => String(item))
      : []
  };
}

function countBySentiment(analyses: PostAnalysis[]) {
  return {
    positive: analyses.filter((analysis) => analysis.sentiment === "positive").length,
    neutral: analyses.filter((analysis) => analysis.sentiment === "neutral").length,
    negative: analyses.filter((analysis) => analysis.sentiment === "negative").length,
    mixed: analyses.filter((analysis) => analysis.sentiment === "mixed").length
  };
}

export const personalityService = {
  async getOrBuild(userId: string) {
    const [posts, storedProfile] = await Promise.all([
      postRepository.listByUserIdAndTypes(userId, ["free_comment", "rant", "diary"], 16),
      personalityProfileRepository.getByUserId(userId)
    ]);

    const eligiblePosts = posts.filter((post) => post.content.trim().length >= MIN_CONTENT_LENGTH);
    if (eligiblePosts.length < MIN_POSTS_FOR_PROFILE) {
      if (storedProfile?.summary) {
        return readyFromStoredProfile(storedProfile, eligiblePosts.slice(0, 5));
      }

      return {
        status: "insufficient" as const,
        message: buildInsufficientMessage(eligiblePosts.length),
        postCount: eligiblePosts.length,
        profile: null,
        evidencePosts: posts.slice(0, 3)
      };
    }

    const analyses = await postAnalysisRepository.listByPostIds(eligiblePosts.map((post) => post.id));
    const sentimentCounts = countBySentiment(analyses);
    const diaryCount = eligiblePosts.filter((post) => post.type === "diary").length;
    const rantCount = eligiblePosts.filter((post) => post.type === "rant").length;
    const recurringKeywords = topValues(analyses.flatMap((analysis) => analysis.keywords ?? []));
    const recurringTags = topValues(analyses.flatMap((analysis) => analysis.tags ?? []));
    const recurringInsightTypes = topValues(analyses.map((analysis) => analysis.insight_type), 2);
    const averageSpecificity = average(analyses.map((analysis) => analysis.specificity ?? 0));
    const averageQuality = average(eligiblePosts.map((post) => post.quality_score ?? 0));
    const typeLabel = resolvePersonalityType({
      averageSpecificity,
      averageQuality,
      positiveCount: sentimentCounts.positive,
      negativeLikeCount: sentimentCounts.negative + sentimentCounts.mixed
    });
    const features = buildFeatures({
      typeLabel,
      diaryCount,
      rantCount,
      recurringKeywords,
      recurringTags,
      averageSpecificity,
      averageQuality,
      insightTypes: recurringInsightTypes
    });
    const behaviorTendencies = buildBehaviorTendencies({
      diaryCount,
      rantCount,
      recurringKeywords,
      averageSpecificity,
      negativeLikeCount: sentimentCounts.negative + sentimentCounts.mixed
    });
    const summary = buildProfileSummary(typeLabel, features);

    const profile = await personalityProfileRepository.upsertByUserId({
      user_id: userId,
      latest_post_id: eligiblePosts[0]?.id ?? null,
      summary,
      traits: features,
      segments: recurringTags,
      confidence: Math.min(0.92, 0.48 + eligiblePosts.length * 0.07),
      evidence_post_ids: eligiblePosts.slice(0, 5).map((post) => post.id),
      raw_json: {
        personality_type: typeLabel,
        features,
        behavior_tendencies: behaviorTendencies,
        post_count: eligiblePosts.length,
        diary_count: diaryCount,
        rant_count: rantCount,
        average_quality: averageQuality,
        average_specificity: averageSpecificity,
        recurring_keywords: recurringKeywords,
        recurring_tags: recurringTags,
        recurring_insight_types: recurringInsightTypes,
        sentiment_distribution: {
          positive: percentage(sentimentCounts.positive, analyses.length),
          neutral: percentage(sentimentCounts.neutral, analyses.length),
          negative: percentage(sentimentCounts.negative, analyses.length),
          mixed: percentage(sentimentCounts.mixed, analyses.length)
        }
      }
    });

    return {
      status: "ready" as const,
      message: summary,
      postCount: eligiblePosts.length,
      profile,
      evidencePosts: eligiblePosts.slice(0, 5),
      recurringKeywords,
      recurringTags,
      personalityType: typeLabel,
      features,
      behaviorTendencies
    };
  },

  async getPreview(userId: string) {
    const result = await this.getOrBuild(userId);
    if (result.status === "insufficient") {
      return {
        status: result.status,
        text: result.message
      };
    }

    return {
      status: result.status,
      text: `${truncate(result.message, 120)}\n投稿数: ${result.postCount}件`
    };
  }
};
