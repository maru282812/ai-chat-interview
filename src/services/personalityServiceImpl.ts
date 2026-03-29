import { personalityProfileRepository } from "../repositories/personalityProfileRepository";
import { postAnalysisRepository } from "../repositories/postAnalysisRepository";
import { postRepository } from "../repositories/postRepository";
import type { UserPersonalityProfile, UserPost } from "../types/domain";

const MIN_POSTS_FOR_PROFILE = 3;
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

function buildInsufficientMessage(postCount: number): string {
  const missingCount = Math.max(0, MIN_POSTS_FOR_PROFILE - postCount);
  return `診断に必要な投稿がまだ足りません。あと${missingCount}件ほど投稿されると表示しやすくなります。`;
}

function buildTraits(input: {
  diaryCount: number;
  rantCount: number;
  negativeLikeCount: number;
  recurringKeywords: string[];
}): string[] {
  const traits: string[] = [];

  if (input.diaryCount >= 2) {
    traits.push("日々の気分や出来事を言葉にして整理する傾向があります。");
  }
  if (input.rantCount >= 2) {
    traits.push("感情が動いた出来事を率直に外へ出して整理する傾向があります。");
  }
  if (input.negativeLikeCount >= 2) {
    traits.push("悩みや違和感をそのままにせず、言葉にして扱う傾向があります。");
  }
  if (input.recurringKeywords.length > 0) {
    traits.push(`最近は「${input.recurringKeywords.join(" / ")}」に関する話題が繰り返し出ています。`);
  }
  if (traits.length === 0) {
    traits.push("投稿からは、自分の感情や出来事を無理なく言語化する様子が見えます。");
  }

  return traits;
}

function readyFromStoredProfile(profile: UserPersonalityProfile, evidencePosts: UserPost[]) {
  return {
    status: "ready" as const,
    message: profile.summary ?? "既存プロフィールを表示しています。",
    postCount: evidencePosts.length,
    profile,
    evidencePosts,
    recurringKeywords: [],
    recurringTags: []
  };
}

export const personalityService = {
  async getOrBuild(userId: string) {
    const [posts, storedProfile] = await Promise.all([
      postRepository.listByUserIdAndTypes(userId, ["free_comment", "rant", "diary"], 12),
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
    const traits = buildTraits({
      diaryCount,
      rantCount,
      negativeLikeCount: sentimentCounts.negative + sentimentCounts.mixed,
      recurringKeywords
    });

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
