import {
  type BlockPlan,
  type PreviewRespondent,
  buildFallbackPlan,
  designableQuestions,
  parseAiPlan,
  previewOrders
} from "../lib/blockPlan";
import { questionPageGroupRepository } from "../repositories/questionPageGroupRepository";
import { questionRepository } from "../repositories/questionRepository";
import { aiService } from "./aiService";
import { logger } from "../lib/logger";
import type { Question } from "../types/domain";

export type { BlockPlan, BlockPlanBlock, PreviewRespondent } from "../lib/blockPlan";

/**
 * blockDesignService（ブロック自動設計）
 * - suggest: AIが設問を内容で束ねたブロック案を返す（AI不可/失敗時は決定的フォールバック）。
 * - preview: ブロック案から回答者N人分の実表示順サンプルを生成。
 * - apply: ブロック案を page_groups＋設問の割当・マスター順に反映して保存（破壊的・明示操作のみ）。
 * 純ロジックは lib/blockPlan.ts。
 */

function buildSuggestPrompt(targets: Question[], count: number): string {
  const list = targets
    .map((question) => `${question.question_code}: ${question.question_text.replace(/\s+/g, " ").slice(0, 80)}`)
    .join("\n");
  const countInstruction =
    count > 0
      ? `設問を内容のまとまりで「ちょうど${count}個」のブロックに分けてください。`
      : "設問を内容のまとまりで適切な数のブロックに分けてください（目安: 1ブロック3〜6問）。";
  return [
    "あなたはアンケート設計の専門家です。",
    countInstruction,
    "各ブロックに短い日本語タイトルを付け、所属する設問コードを列挙してください。",
    "前の設問の回答・文言を参照する設問は、参照先と同じか後のブロックに置いてください。",
    "出力は次のJSONのみ（説明文なし）: {\"blocks\":[{\"title\":\"...\",\"question_codes\":[\"Q1\",\"Q2\"],\"randomize_within\":false}]}",
    "",
    "設問一覧:",
    list
  ].join("\n");
}

export const blockDesignService = {
  designableQuestions,
  buildFallbackPlan,
  parseAiPlan,
  previewOrders,

  /** AIにブロック案を作らせる（失敗・未設定時は決定的フォールバック）。 */
  async suggest(projectId: string, count: number): Promise<{ plan: BlockPlan; source: "ai" | "fallback" }> {
    const questions = await questionRepository.listByProject(projectId);
    const targets = designableQuestions(questions);
    if (targets.length === 0) {
      return { plan: { blocks: [] }, source: "fallback" };
    }
    try {
      const { content } = await aiService.callRaw({ prompt: buildSuggestPrompt(targets, count) });
      const plan = content ? parseAiPlan(content, questions) : null;
      if (plan && plan.blocks.length > 0) {
        return { plan, source: "ai" };
      }
    } catch (error) {
      logger.warn("[blockDesignService] AI suggest failed, using fallback", { projectId, error: String(error) });
    }
    return { plan: buildFallbackPlan(questions, count), source: "fallback" };
  },

  async preview(projectId: string, plan: BlockPlan, n: number): Promise<PreviewRespondent[]> {
    const questions = await questionRepository.listByProject(projectId);
    return previewOrders({ plan, questions, n });
  },

  /**
   * ブロック案を保存する。既存ページグループを作り直し、設問の割当とマスター順(sort_order)を
   * 設計どおりに更新する。明示的な「保存」操作からのみ呼ぶ（破壊的）。
   */
  async apply(projectId: string, plan: BlockPlan): Promise<{ blockCount: number; assignedCount: number }> {
    const questions = await questionRepository.listByProject(projectId);
    const validIds = new Set(designableQuestions(questions).map((question) => question.id));

    const existing = await questionPageGroupRepository.listByProject(projectId);
    for (const group of existing) {
      await questionPageGroupRepository.deleteById(group.id);
    }

    let assignedCount = 0;
    let globalOrder = 1;
    let pageNumber = 1;
    for (const block of plan.blocks) {
      const ids = block.question_ids.filter((id) => validIds.has(id));
      if (ids.length === 0) {
        continue;
      }
      const created = await questionPageGroupRepository.create({
        project_id: projectId,
        page_number: pageNumber,
        sort_order: pageNumber,
        title: block.title || `ブロック${pageNumber}`,
        is_randomizable: block.is_randomizable,
        randomize_within: block.randomize_within,
        fix_within: block.fix_within
      });
      for (const id of ids) {
        await questionRepository.setPageGroup(id, created.id);
        await questionRepository.update(id, { sort_order: globalOrder });
        globalOrder += 1;
        assignedCount += 1;
      }
      pageNumber += 1;
    }

    return { blockCount: pageNumber - 1, assignedCount };
  }
};
