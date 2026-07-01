/**
 * randomization.ts
 *
 * ブロック単位／ブロック内のランダム化を、依存順を壊さずに決定的（シード再現可能）に計算する純関数（§3/§22）。
 *
 * 設計:
 *  1. ブロック順を決める（is_randomizable のブロックのみ位置をシャッフル、それ以外は固定）。
 *  2. ブロック内の設問順を決める（randomize_within かつ not fix_within ならシャッフル）。
 *  3. 上記で得た「シャッフル後の優先順位」をタイブレークに、依存エッジで制約付きトポロジカルソート。
 *     → 依存先(source)は必ず依存元(dependent)より前に来る（§4/§13 を実行時にも保証）。
 *
 * 後方互換: ブロック未設定／ランダム化フラグなしなら、結果はマスター順に一致する。
 */

export interface RandomizationBlock {
  block_code: string;
  master_order: number;
  is_randomizable: boolean;
  randomize_within: boolean;
  fix_within: boolean;
}

export interface RandomizationQuestion {
  id: string;
  question_code: string;
  block_code: string | null;
  master_order: number;
}

/** from（依存元）は to（依存先）より後に表示される必要がある。 */
export interface RandomizationEdge {
  from: string; // question_code
  to: string; // question_code
}

export interface DisplayOrderResult {
  /** question_id -> 表示順位(1始まり) */
  order: Map<string, number>;
  /** 実際のブロック表示順（block_code 配列・ungrouped は "__q:<code>" 疑似ブロック） */
  blockOrder: string[];
}

/** 文字列シードを 32bit に畳み込む。 */
function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32: 決定的擬似乱数（0..1）。 */
function mulberry32(seedValue: number): () => number {
  let state = seedValue >>> 0;
  return () => {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(items: T[], rng: () => number): void {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    [items[index], items[swap]] = [items[swap]!, items[index]!];
  }
}

/** シード文字列から決定的な擬似乱数関数を作る（他モジュール再利用用）。 */
export function createSeededRng(seed: string): () => number {
  return mulberry32(hashSeed(seed));
}

/** シードで決定的にシャッフルした新しい配列を返す。 */
export function seededShuffle<T>(items: T[], seed: string): T[] {
  const copy = [...items];
  shuffleInPlace(copy, createSeededRng(seed));
  return copy;
}

interface PseudoBlock {
  block_code: string;
  master_order: number;
  is_randomizable: boolean;
  randomize_within: boolean;
  fix_within: boolean;
  questions: RandomizationQuestion[];
}

/** ブロック定義と未割当設問から、各設問が属する実効ブロック群を作る。 */
function buildBlocks(questions: RandomizationQuestion[], blocks: RandomizationBlock[]): PseudoBlock[] {
  const byCode = new Map<string, PseudoBlock>();
  for (const block of blocks) {
    byCode.set(block.block_code, { ...block, questions: [] });
  }

  const result: PseudoBlock[] = [];
  for (const question of questions) {
    const block = question.block_code ? byCode.get(question.block_code) : null;
    if (block) {
      block.questions.push(question);
    } else {
      // 未割当設問は、その設問のマスター順に固定された単独疑似ブロックにする
      result.push({
        block_code: `__q:${question.question_code}`,
        master_order: question.master_order,
        is_randomizable: false,
        randomize_within: false,
        fix_within: true,
        questions: [question]
      });
    }
  }
  for (const block of byCode.values()) {
    if (block.questions.length > 0) {
      result.push(block);
    }
  }
  return result;
}

/**
 * 依存順を壊さない決定的な表示順を計算する。
 */
export function computeDisplayOrder(input: {
  questions: RandomizationQuestion[];
  blocks?: RandomizationBlock[];
  edges?: RandomizationEdge[];
  seed: string;
}): DisplayOrderResult {
  const rng = mulberry32(hashSeed(input.seed));
  const blocks = buildBlocks(input.questions, input.blocks ?? []);

  // 1. ブロック順: master_order 昇順を基本に、is_randomizable のブロックのみ位置をシャッフル
  blocks.sort((left, right) => left.master_order - right.master_order || left.block_code.localeCompare(right.block_code));
  const randomizableIndexes = blocks.flatMap((block, index) => (block.is_randomizable ? [index] : []));
  const shuffledSlots = [...randomizableIndexes];
  shuffleInPlace(shuffledSlots, rng);
  const blockSequence = [...blocks];
  randomizableIndexes.forEach((slot, position) => {
    blockSequence[slot] = blocks[shuffledSlots[position]!]!;
  });

  // 2. ブロック内設問順 + フラット化して「シャッフル後の優先順位」を作る
  const priority = new Map<string, number>(); // question_code -> 優先index
  const codeToId = new Map<string, string>();
  let cursor = 0;
  for (const block of blockSequence) {
    const ordered = [...block.questions].sort((left, right) => left.master_order - right.master_order);
    if (block.randomize_within && !block.fix_within) {
      shuffleInPlace(ordered, rng);
    }
    for (const question of ordered) {
      priority.set(question.question_code, cursor);
      codeToId.set(question.question_code, question.id);
      cursor += 1;
    }
  }

  // 3. 依存エッジで制約付きトポロジカルソート（タイブレーク=優先index）
  const codes = [...priority.keys()];
  const indegree = new Map<string, number>(codes.map((code) => [code, 0]));
  const dependents = new Map<string, string[]>(); // to -> [from...]
  for (const edge of input.edges ?? []) {
    if (!priority.has(edge.from) || !priority.has(edge.to) || edge.from === edge.to) {
      continue;
    }
    indegree.set(edge.from, (indegree.get(edge.from) ?? 0) + 1);
    const list = dependents.get(edge.to) ?? [];
    list.push(edge.from);
    dependents.set(edge.to, list);
  }

  const available = codes.filter((code) => (indegree.get(code) ?? 0) === 0);
  const sequence: string[] = [];
  const taken = new Set<string>();
  while (available.length > 0) {
    available.sort((left, right) => (priority.get(left) ?? 0) - (priority.get(right) ?? 0));
    const next = available.shift()!;
    if (taken.has(next)) {
      continue;
    }
    taken.add(next);
    sequence.push(next);
    for (const dependent of dependents.get(next) ?? []) {
      const remaining = (indegree.get(dependent) ?? 0) - 1;
      indegree.set(dependent, remaining);
      if (remaining === 0) {
        available.push(dependent);
      }
    }
  }

  // 循環など未消化が残った場合は優先index順で末尾に積む（バリデーションで弾く前提のフォールバック）
  if (sequence.length < codes.length) {
    for (const code of codes.sort((left, right) => (priority.get(left) ?? 0) - (priority.get(right) ?? 0))) {
      if (!taken.has(code)) {
        sequence.push(code);
        taken.add(code);
      }
    }
  }

  const order = new Map<string, number>();
  sequence.forEach((code, index) => {
    const id = codeToId.get(code);
    if (id) {
      order.set(id, index + 1);
    }
  });

  return { order, blockOrder: blockSequence.map((block) => block.block_code) };
}
