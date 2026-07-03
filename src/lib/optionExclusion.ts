import type { QuestionOption } from "../types/domain";

/**
 * 複数選択設問における「排他（同時選択不可）」判定。
 * 排他は無向（undirected）として扱う: 片側の exclusive_with に相手が入っていれば両方向に効く。
 *
 *   conflicts(a, b) =
 *        a.exclusive        （a は他全部と排他）
 *     || b.exclusive        （b は他全部と排他）
 *     || a.exclusive_with ⊇ b.value
 *     || b.exclusive_with ⊇ a.value
 */
export function conflicts(a: QuestionOption, b: QuestionOption): boolean {
  if (a.value === b.value) return false;
  if (a.exclusive === true || b.exclusive === true) return true;
  if ((a.exclusive_with ?? []).includes(b.value)) return true;
  if ((b.exclusive_with ?? []).includes(a.value)) return true;
  return false;
}

/**
 * 送信された選択値の集合に排他違反が含まれていれば、最初に見つかった違反ペアの
 * ラベル [labelA, labelB] を返す。違反が無ければ null。
 *
 * - options に存在しない値（「その他」自由記述の生テキスト等）は判定対象外としてスキップする。
 */
export function findExclusionViolation(
  values: string[],
  options: QuestionOption[]
): [string, string] | null {
  const byValue = new Map<string, QuestionOption>();
  for (const opt of options) byValue.set(opt.value, opt);

  // 送信値のうち、config.options に対応する選択肢だけを対象にする。
  const selected: QuestionOption[] = [];
  for (const v of values) {
    const opt = byValue.get(v);
    if (opt) selected.push(opt);
  }

  for (let i = 0; i < selected.length; i++) {
    const a = selected[i];
    if (!a) continue;
    for (let j = i + 1; j < selected.length; j++) {
      const b = selected[j];
      if (!b) continue;
      if (conflicts(a, b)) {
        return [a.label, b.label];
      }
    }
  }
  return null;
}
