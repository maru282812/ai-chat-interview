import type { OptionRandomizationConfig, QuestionOption } from "../types/domain";
import { seededShuffle } from "./randomization";

/**
 * optionRandomization.ts — 設問内の選択肢ランダム化（L3・純関数）。
 *
 *  - 選択肢順をシードで決定的にシャッフル。
 *  - 「その他」「特になし」等のアンカー（anchored_values）は元の位置に固定。
 *  - 選択肢グループ（groups）があれば、群単位で扱い、群内をシャッフル。
 *    randomize_groups=true なら群の順序もシャッフル。
 *
 * アンカーは「元のindexに残す」。非アンカーの並びだけを空きスロットへ詰める。
 */

export function computeOptionOrder(
  options: QuestionOption[],
  config: OptionRandomizationConfig | undefined | null,
  seed: string
): QuestionOption[] {
  if (!config?.enabled || options.length <= 1) {
    return options;
  }

  const anchoredValues = new Set(config.anchored_values ?? []);
  const isAnchor = (option: QuestionOption) => anchoredValues.has(option.value);

  const nonAnchored = options.filter((option) => !isAnchor(option));

  // 非アンカーの並び（シャッフル後の順序）を作る
  let sequence: QuestionOption[];
  const groups = config.groups?.filter((group) => group.values.length > 0) ?? [];
  if (groups.length > 0) {
    const byValue = new Map(nonAnchored.map((option) => [option.value, option]));
    const grouped = new Set<string>();
    let groupOrder = groups.map((group, index) => ({ group, index }));
    if (config.randomize_groups) {
      groupOrder = seededShuffle(groupOrder, `${seed}:groups`);
    }
    sequence = [];
    for (const { group, index } of groupOrder) {
      const members = group.values
        .map((value) => byValue.get(value))
        .filter((option): option is QuestionOption => Boolean(option) && !grouped.has(option!.value));
      for (const option of members) {
        grouped.add(option.value);
      }
      sequence.push(...seededShuffle(members, `${seed}:g${index}`));
    }
    // どの群にも属さない非アンカー選択肢は末尾にシャッフルして付ける（取りこぼし防止）
    const leftovers = nonAnchored.filter((option) => !grouped.has(option.value));
    sequence.push(...seededShuffle(leftovers, `${seed}:rest`));
  } else {
    sequence = seededShuffle(nonAnchored, `${seed}:opts`);
  }

  // アンカーを元の位置へ。残りスロットへ sequence を順に詰める。
  const result: (QuestionOption | null)[] = options.map((option) => (isAnchor(option) ? option : null));
  let cursor = 0;
  for (let index = 0; index < result.length; index += 1) {
    if (result[index] === null) {
      result[index] = sequence[cursor] ?? options[index]!;
      cursor += 1;
    }
  }
  return result.map((option, index) => option ?? options[index]!);
}
