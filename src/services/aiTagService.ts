import { logger } from "../lib/logger";
import { postAnalysisRepository } from "../repositories/postAnalysisRepository";
import { postRepository } from "../repositories/postRepository";
import { projectRepository } from "../repositories/projectRepository";
import { userAttributeRepository } from "../repositories/userAttributeRepository";
import { userProfileRepository } from "../repositories/userProfileRepository";
import type { Project } from "../types/domain";
import { aiService } from "./aiService";

/** Phase 7-A: 投稿に紐づくプロジェクト/セッションを解決する（テンプレート解決・ai_logs記録用）。失敗時は legacy 動作 */
async function resolvePostContext(postId: string): Promise<{
  project: Project | null;
  sessionId: string | null;
}> {
  try {
    const post = await postRepository.getById(postId);
    if (!post) {
      return { project: null, sessionId: null };
    }
    const project = post.project_id
      ? await projectRepository.getById(post.project_id).catch(() => null)
      : null;
    return { project, sessionId: post.session_id ?? null };
  } catch {
    return { project: null, sessionId: null };
  }
}

export const aiTagService = {
  async generateTagsForUser(lineUserId: string): Promise<{
    tags: string[];
    persona_summary: string;
  } | null> {
    const posts = await postRepository.listByUserIdAndTypes(
      lineUserId,
      ["rant", "diary", "free_comment"],
      20
    );
    if (posts.length === 0) {
      return null;
    }

    const analyses = await postAnalysisRepository.listByPostIds(posts.map((p) => p.id));
    if (analyses.length === 0) {
      return null;
    }

    const input = analyses.map((a) => ({
      summary: a.summary ?? null,
      tags: Array.isArray(a.tags) ? a.tags : [],
      sentiment: a.sentiment ?? "neutral"
    }));

    const result = await aiService.generateUserPersonaTags(input);
    if (!result) {
      return null;
    }

    const { tags, persona_summary } = result;

    await Promise.all([
      userProfileRepository.updateAiTags(lineUserId, tags, persona_summary),
      userAttributeRepository.upsert({
        line_user_id: lineUserId,
        attr_key: "ai_persona_summary",
        value_text: persona_summary,
        source: "ai_inferred",
        confidence: 0.8
      }),
      ...tags.map((tag, i) =>
        userAttributeRepository.upsert({
          line_user_id: lineUserId,
          attr_key: `ai_tag_${i + 1}`,
          value_text: tag,
          source: "ai_inferred",
          confidence: 0.75
        })
      )
    ]);

    logger.info("ai_tags_generated", { line_user_id: lineUserId, tag_count: tags.length });
    return result;
  },

  async analyzeRantPost(postId: string, content: string): Promise<Record<string, unknown> | null> {
    const { project, sessionId } = await resolvePostContext(postId);
    const result = await aiService.analyzeRantExtended(content, { project, sessionId });
    if (!result) {
      return null;
    }
    const existing = await postAnalysisRepository.getByPostId(postId);
    if (!existing) {
      return null;
    }
    const mergedRaw = {
      ...(typeof existing.raw_json === "object" && existing.raw_json !== null
        ? existing.raw_json
        : {}),
      rant_extended: result
    };
    await postAnalysisRepository.upsertByPostId({
      post_id: postId,
      sentiment: existing.sentiment,
      actionability: existing.actionability,
      raw_json: mergedRaw
    });
    logger.info("rant_extended_analyzed", { post_id: postId, danger_flag: result.danger_flag });
    return mergedRaw;
  },

  async analyzeDiaryPost(postId: string, content: string): Promise<Record<string, unknown> | null> {
    const { project, sessionId } = await resolvePostContext(postId);
    const result = await aiService.analyzeDiaryExtended(content, { project, sessionId });
    if (!result) {
      return null;
    }
    const existing = await postAnalysisRepository.getByPostId(postId);
    if (!existing) {
      return null;
    }
    const mergedRaw = {
      ...(typeof existing.raw_json === "object" && existing.raw_json !== null
        ? existing.raw_json
        : {}),
      diary_extended: result
    };
    await postAnalysisRepository.upsertByPostId({
      post_id: postId,
      sentiment: existing.sentiment,
      actionability: existing.actionability,
      raw_json: mergedRaw,
      behavior_signals: result.behavior_signals as unknown[]
    });
    return mergedRaw;
  }
};
