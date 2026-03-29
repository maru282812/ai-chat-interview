/*
import { personalityProfileRepository } from "../repositories/personalityProfileRepository";
import { postAnalysisRepository } from "../repositories/postAnalysisRepository";
import { postRepository } from "../repositories/postRepository";

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
    .sort((left, right) => right[1] - left[1])
    .slice(0, limit)
    .map(([value]) => value);
}

function percentage(part: number, total: number): number {
  if (total === 0) {
    return 0;
  }
  return Math.round((part / total) * 100);
}

export const personalityService = {
  async getOrBuild(userId: string) {
    const posts = await postRepository.listByUserIdAndTypes(userId, ["free_comment", "rant", "diary"], 12);
    const eligiblePosts = posts.filter((post) => post.content.trim().length >= 20);
    if (eligiblePosts.length < 3) {
      return {
        status: "insufficient" as const,
        message: `診断データが不足しています。あと${Math.max(0, 3 - eligiblePosts.length)}件ほど投稿があると安定した表示になります。`,
        postCount: eligiblePosts.length,
        profile: null,
        evidencePosts: posts.slice(0, 3)
      };
    }

    const analyses = await postAnalysisRepository.listByPostIds(eligiblePosts.map((post) => post.id));
    const sentimentCounts = {
      positive: analyses.filter((analysis) => analysis.sentiment === "positive").length,
      neutral: analyses.filter((analysis) => analysis.sentiment === "neutral").length,
      negative: analyses.filter((analysis) => analysis.sentiment === "negative").length,
      mixed: analyses.filter((analysis) => analysis.sentiment === "mixed").length
    };

    const diaryCount = eligiblePosts.filter((post) => post.type === "diary").length;
    const rantCount = eligiblePosts.filter((post) => post.type === "rant").length;
    const recurringKeywords = topValues(analyses.flatMap((analysis) => analysis.keywords ?? []));
    const recurringTags = topValues(analyses.flatMap((analysis) => analysis.tags ?? []));

    const traits: string[] = [];
    if (diaryCount >= 2) {
      traits.push("日々の出来事を継続的に言語化する傾向があります。");
    }
    if (rantCount >= 2) {
      traits.push("違和感や不満をそのまま言葉にできる傾向があります。");
    }
    if (sentimentCounts.negative + sentimentCounts.mixed >= 2) {
      traits.push("感情の揺れやストレス要因を率直に共有する傾向があります。");
    }
    if (recurringKeywords.length > 0) {
      traits.push(`最近は「${recurringKeywords.join(" / ")}」に関する話題が目立ちます。`);
    }
    if (traits.length === 0) {
      traits.push("投稿からは落ち着いた自己観察と出来事の整理が見られます。");
    }

    const summary = traits.slice(0, 2).join(" ");
    const profile = await personalityProfileRepository.upsertByUserId({
      user_id: userId,
      latest_post_id: eligiblePosts[0]?.id ?? null,
      summary,
      traits,
      segments: recurringTags,
      confidence: Math.min(0.9, 0.45 + eligiblePosts.length * 0.08),
      evidence_post_ids: eligiblePosts.slice(0, 5).map((post) => post.id),
      raw_json: {
        post_count: eligiblePosts.length,
        diary_count: diaryCount,
        rant_count: rantCount,
        recurring_keywords: recurringKeywords,
        recurring_tags: recurringTags,
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
      recurringTags
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
      text: `${truncate(result.message, 120)}\n対象投稿: ${result.postCount}件`
    };
  }
};
*/

export { personalityService } from "./personalityServiceV2";
