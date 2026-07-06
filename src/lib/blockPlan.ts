import type { Question } from "../types/domain";
import { computeDisplayOrder } from "./randomization";
import { extractOrderingEdges } from "./surveyValidation";

/**
 * blockPlan.ts — ブロック自動設計の純ロジック（DB・AI 非依存・テスト可能）。
 * AI 呼び出し・保存は services/blockDesignService が担当する。
 */

export interface BlockPlanBlock {
  /** 既存 page_group の id（あれば更新、無ければ新規） */
  id?: string | null;
  title: string;
  is_randomizable: boolean;
  randomize_within: boolean;
  fix_within: boolean;
  /** 所属設問 id（表示順） */
  question_ids: string[];
}

export interface BlockPlan {
  blocks: BlockPlanBlock[];
}

export interface PreviewRespondent {
  seed: string;
  block_order: string[];
  question_codes: string[];
}

/** 対象設問（本番設問のみ。system / hidden は除外）。 */
export function designableQuestions(questions: Question[]): Question[] {
  return [...questions]
    .filter((question) => !question.is_system && !question.is_hidden)
    .sort((left, right) => left.sort_order - right.sort_order);
}

function clampCount(count: number, max: number): number {
  if (!Number.isFinite(count) || count <= 0) {
    return Math.max(1, Math.min(max, Math.ceil(max / 4))); // 自動: 4問前後で1ブロック
  }
  return Math.max(1, Math.min(max, Math.floor(count)));
}

/** 決定的フォールバック: マスター順の連続チャンクで count 個に等分する（依存順を壊さない）。 */
export function buildFallbackPlan(questions: Question[], count: number): BlockPlan {
  const targets = designableQuestions(questions);
  if (targets.length === 0) {
    return { blocks: [] };
  }
  const blockCount = clampCount(count, targets.length);
  const perBlock = Math.ceil(targets.length / blockCount);
  const blocks: BlockPlanBlock[] = [];
  for (let index = 0; index < blockCount; index += 1) {
    const slice = targets.slice(index * perBlock, (index + 1) * perBlock);
    if (slice.length === 0) {
      continue;
    }
    blocks.push({
      title: `ブロック${index + 1}`,
      is_randomizable: false,
      randomize_within: false,
      fix_within: false,
      question_ids: slice.map((question) => question.id)
    });
  }
  return { blocks };
}

/** AIのJSON出力をBlockPlanへ変換する。未知コードは無視し、未割当設問は最後のブロックへ寄せる。 */
export function parseAiPlan(content: string, questions: Question[]): BlockPlan | null {
  const targets = designableQuestions(questions);
  const idByCode = new Map(targets.map((question) => [question.question_code.toLowerCase(), question.id]));

  let json: unknown;
  try {
    const cleaned = content.replace(/```json\s*|\s*```/g, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    json = JSON.parse(start >= 0 && end >= 0 ? cleaned.slice(start, end + 1) : cleaned);
  } catch {
    return null;
  }

  const rawBlocks = (json as { blocks?: unknown }).blocks;
  if (!Array.isArray(rawBlocks)) {
    return null;
  }

  const used = new Set<string>();
  const blocks: BlockPlanBlock[] = [];
  for (const raw of rawBlocks) {
    const record = raw as Record<string, unknown>;
    const codes = Array.isArray(record.question_codes) ? record.question_codes : [];
    const questionIds: string[] = [];
    for (const code of codes) {
      const id = idByCode.get(String(code).toLowerCase());
      if (id && !used.has(id)) {
        used.add(id);
        questionIds.push(id);
      }
    }
    if (questionIds.length === 0) {
      continue;
    }
    blocks.push({
      title: typeof record.title === "string" && record.title.trim() ? record.title.trim() : `ブロック${blocks.length + 1}`,
      is_randomizable: record.is_randomizable === true,
      randomize_within: record.randomize_within === true,
      fix_within: record.fix_within === true,
      question_ids: questionIds
    });
  }

  if (blocks.length === 0) {
    return null;
  }

  const leftovers = targets.filter((question) => !used.has(question.id)).map((question) => question.id);
  if (leftovers.length > 0) {
    blocks[blocks.length - 1]!.question_ids.push(...leftovers);
  }
  return { blocks };
}

/** ブロック案から回答者N人分の実表示順サンプルを生成（保存前のプレビュー可・依存順保持）。 */
export function previewOrders(input: { plan: BlockPlan; questions: Question[]; n: number }): PreviewRespondent[] {
  const { plan, questions } = input;
  const n = Math.max(1, Math.min(10, Math.floor(input.n) || 3));
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const codeById = new Map(questions.map((question) => [question.id, question.question_code]));

  const blocks = plan.blocks.map((block, index) => ({
    block_code: String(index),
    master_order: index,
    is_randomizable: block.is_randomizable,
    randomize_within: block.randomize_within,
    fix_within: block.fix_within
  }));
  const titleByIndex = new Map(plan.blocks.map((block, index) => [String(index), block.title]));

  const randomizationQuestions = plan.blocks.flatMap((block, blockIndex) =>
    block.question_ids
      .filter((id) => questionById.has(id))
      .map((id, withinIndex) => ({
        id,
        question_code: (codeById.get(id) ?? id).toLowerCase(),
        block_code: String(blockIndex),
        master_order: blockIndex * 1000 + withinIndex
      }))
  );
  const edges = extractOrderingEdges(questions);

  const results: PreviewRespondent[] = [];
  for (let index = 0; index < n; index += 1) {
    const seed = `preview-${index + 1}`;
    const { order, blockOrder } = computeDisplayOrder({ questions: randomizationQuestions, blocks, edges, seed });
    const ordered = [...order.entries()]
      .sort((left, right) => left[1] - right[1])
      .map(([id]) => codeById.get(id) ?? id);
    results.push({
      seed,
      block_order: blockOrder.map((code) => titleByIndex.get(code) ?? code),
      question_codes: ordered
    });
  }
  return results;
}
