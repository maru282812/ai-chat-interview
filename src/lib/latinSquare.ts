/**
 * latinSquare.ts — コンセプト提示順のローテーション（L1・純関数）。
 *
 * 複数コンセプト（例: おいしさ重視P / 品質重視Q / 価格重視R）を1人が全部回答する設計で、
 * 順序効果を抑えるため提示順を回答者ごとに均等ローテーションする。
 *
 *  - latin: 巡回ラテン方格。回答者iは concepts を i だけ回転した順。
 *    n人で各コンセプトが各提示位置に均等に出る（バランス設計・乱数ではない）。
 *  - full: 全順列を順番に割り当てる（人数管理は大変だが完全バランス）。
 */

export type ConceptRotationMode = "latin" | "full" | "off";

function mod(value: number, size: number): number {
  return ((value % size) + size) % size;
}

/** 巡回ラテン方格：items を index だけ回転した順を返す。 */
export function latinSquareOrder<T>(items: T[], index: number): T[] {
  const n = items.length;
  if (n === 0) {
    return [];
  }
  const shift = mod(index, n);
  return items.map((_, position) => items[(shift + position) % n]!);
}

/** 全順列（n は小さい前提：コンセプト数）。 */
export function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) {
    return [items.slice()];
  }
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += 1) {
    const rest = [...items.slice(0, index), ...items.slice(index + 1)];
    for (const permutation of permutations(rest)) {
      result.push([items[index]!, ...permutation]);
    }
  }
  return result;
}

/** 全順列を回答者indexで巡回割り当て。 */
export function fullPermutationOrder<T>(items: T[], index: number): T[] {
  if (items.length === 0) {
    return [];
  }
  const perms = permutations(items);
  return perms[mod(index, perms.length)] ?? items.slice();
}

/**
 * コンセプト提示順を解決する。
 * @param conceptCodes マスター順のコンセプトコード配列
 * @param respondentIndex 回答者の通し番号（0始まり・安定値）
 */
export function assignConceptOrder(
  conceptCodes: string[],
  respondentIndex: number,
  mode: ConceptRotationMode
): string[] {
  if (mode === "off" || conceptCodes.length <= 1) {
    return conceptCodes.slice();
  }
  return mode === "full"
    ? fullPermutationOrder(conceptCodes, respondentIndex)
    : latinSquareOrder(conceptCodes, respondentIndex);
}
