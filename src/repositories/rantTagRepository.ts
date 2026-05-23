import { supabase } from "../config/supabase";
import { logger } from "../lib/logger";
import type { RantTag } from "../types/domain";

interface RantTagRow {
  id: string;
  code: string;
  label: string;
  emoji: string;
  category: string | null;
  sort_order: number;
  is_active: boolean;
}

interface RantPostTagInsert {
  rant_post_id: string;
  rant_tag_id: string;
}

function toRantTag(row: RantTagRow, count = 0): RantTag {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    emoji: row.emoji,
    category: row.category,
    sort_order: row.sort_order,
    is_active: row.is_active,
    post_count: count
  };
}

export const rantTagRepository = {
  async listWithCounts(): Promise<RantTag[]> {
    const [tagsResult, countsResult] = await Promise.all([
      supabase
        .from("rant_tags")
        .select("id, code, label, emoji, category, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order"),
      supabase
        .from("rant_post_tags")
        .select("rant_tag_id")
    ]);

    if (tagsResult.error) {
      logger.warn("rantTagRepository.listWithCounts.tags_error", { error: tagsResult.error.message });
      return [];
    }

    const countMap = new Map<string, number>();
    for (const row of (countsResult.data ?? []) as { rant_tag_id: string }[]) {
      countMap.set(row.rant_tag_id, (countMap.get(row.rant_tag_id) ?? 0) + 1);
    }

    return ((tagsResult.data ?? []) as RantTagRow[]).map((row) =>
      toRantTag(row, countMap.get(row.id) ?? 0)
    );
  },

  async findByCodes(codes: string[]): Promise<RantTag[]> {
    if (codes.length === 0) {
      return [];
    }
    const { data, error } = await supabase
      .from("rant_tags")
      .select("id, code, label, emoji, category, sort_order, is_active")
      .in("code", codes)
      .eq("is_active", true);

    if (error) {
      logger.warn("rantTagRepository.findByCodes.error", { error: error.message });
      return [];
    }
    return ((data ?? []) as RantTagRow[]).map((row) => toRantTag(row, 0));
  },

  async savePostTags(postId: string, tagIds: string[]): Promise<void> {
    if (tagIds.length === 0) {
      return;
    }
    const rows: RantPostTagInsert[] = tagIds.map((tagId) => ({
      rant_post_id: postId,
      rant_tag_id: tagId
    }));
    const { error } = await supabase.from("rant_post_tags").insert(rows);
    if (error) {
      logger.warn("rantTagRepository.savePostTags.error", { postId, error: error.message });
    }
  },

  async getTagsByPostId(postId: string): Promise<RantTag[]> {
    const { data: postTagData, error: ptError } = await supabase
      .from("rant_post_tags")
      .select("rant_tag_id")
      .eq("rant_post_id", postId);

    if (ptError || !postTagData || postTagData.length === 0) {
      if (ptError) {
        logger.warn("rantTagRepository.getTagsByPostId.error", { postId, error: ptError.message });
      }
      return [];
    }

    const tagIds = (postTagData as { rant_tag_id: string }[]).map((r) => r.rant_tag_id);
    const { data, error } = await supabase
      .from("rant_tags")
      .select("id, code, label, emoji, category, sort_order, is_active")
      .in("id", tagIds);

    if (error) {
      logger.warn("rantTagRepository.getTagsByPostId.tags_error", { postId, error: error.message });
      return [];
    }
    return ((data ?? []) as RantTagRow[]).map((row) => toRantTag(row, 0));
  }
};
