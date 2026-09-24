import type { Answer, Question, QuestionOption } from "../types/domain";

/**
 * answerOptionMatch.ts
 *
 * 「この回答は、どの選択肢を選んだことになるのか」を判定する唯一の正。
 *
 * ## なぜ共有モジュールにするのか
 *
 * GT集計表のセルに出る人数と、そのセルから抽出される回答者の人数は、**必ず一致しなければならない**。
 * 顧客は「492人」というセルを見てインタビューを実施するので、抽出が480人だとその場で信用が失われる。
 * 実装が2箇所あると必ずズレるため、突合ロジックはこのモジュールに一本化する。
 *
 * ## 統合前に存在していた2つの実装（どちらも正しく、どちらも不完全だった）
 *
 * 1. `partnerSurveyService.getResults`（顧客向け集計）
 *    `answer_text` をカンマで split して `option.value` と突合していた。
 *    → multi_choice がカンマ連結で保存される事実に対応している。
 *    → しかし `normalized_answer` を見ないため、`answer_text` にラベルが入る経路を取りこぼす。
 *
 * 2. `researchOpsService.labelsForStructuredAnswer`（運営向け集計）
 *    `normalized_answer` の labels/label/values/value を順に見て、無ければ `answer_text`。
 *    → クライアントが送ってくる正規化済みの値に対応している。
 *    → しかし `answer_text` にフォールバックした際、カンマ連結を分解しない（複数選択が1件に潰れる）。
 *
 * このモジュールは両方の経路を扱う。**normalized_answer を優先し、無ければ answer_text をカンマ分解する。**
 *
 * ## 突合は value と label の両方で行う
 *
 * `answer_text` に `option.value` が入る経路と `option.label` が入る経路の両方が実在する
 * （`normalized_answer.labels` は名前どおりラベル、`getResults` は value で突合していた）。
 * どちらで来ても同じ選択肢に寄せるため、value/label の両方をキーにした逆引き表を作る。
 *
 * ⚠ 選択肢の value にカンマが含まれると、カンマ連結された answer_text を正しく分解できない。
 *   これは保存形式に起因する制約なので、入力側（surveyValidation）でカンマを禁止する。
 *   このモジュールは防御的に「カンマを含む value/label は連結分解の対象外として完全一致でも拾う」形にしてある。
 */

/** 回答から取り出した「選択された選択肢の value」の集合。 */
export type SelectedOptionValues = Set<string>;

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return value as Record<string, unknown>;
}

/** 設問に定義された選択肢を取り出す。matrix 系は対象外（GT表では行×列を別途扱う）。 */
export function optionsForQuestion(question: Question): QuestionOption[] {
  const options = question.question_config?.options;
  return Array.isArray(options) ? options : [];
}

/**
 * value / label の両方から value を引ける逆引き表を作る。
 *
 * 衝突時は value 側を優先する（value は一意、label は重複し得る）。
 */
export function buildOptionIndex(options: QuestionOption[]): Map<string, string> {
  const index = new Map<string, string>();
  // label を先に入れてから value で上書きする（value 優先）。
  for (const option of options) {
    const label = typeof option.label === "string" ? option.label.trim() : "";
    if (label.length > 0 && !index.has(label)) {
      index.set(label, option.value);
    }
  }
  for (const option of options) {
    const value = typeof option.value === "string" ? option.value.trim() : "";
    if (value.length > 0) {
      index.set(value, option.value);
    }
  }
  return index;
}

/**
 * normalized_answer から選択された値の生文字列を取り出す。
 *
 * 取り出せなければ null を返す（呼び出し側が answer_text へフォールバックする）。
 * 空配列は「正規化済みだが未選択」なので空配列を返す（null と区別する）。
 */
function rawTokensFromNormalized(answer: Answer): string[] | null {
  const normalized = asRecord(answer.normalized_answer);

  if (Array.isArray(normalized.labels)) {
    return normalized.labels.map((value) => String(value));
  }
  if (typeof normalized.label === "string" && normalized.label.trim().length > 0) {
    return [normalized.label.trim()];
  }
  if (Array.isArray(normalized.values)) {
    return normalized.values.map((value) => String(value));
  }
  if (normalized.value !== undefined && normalized.value !== null) {
    return [String(normalized.value)];
  }
  return null;
}

/**
 * この回答が選んだ選択肢の value 集合を返す。
 *
 * - normalized_answer があればそれを使う（既に分解済みなのでカンマ分解しない）
 * - 無ければ answer_text を使う。まず完全一致を試し、当たらなければカンマ分解する
 *   （value にカンマを含む選択肢を取りこぼさないため）
 * - 定義済みの選択肢に当たらないトークンは捨てる（自由記述・古い値・「その他」の入力文字列）
 */
export function selectedOptionValues(answer: Answer, optionIndex: Map<string, string>): SelectedOptionValues {
  const selected: SelectedOptionValues = new Set();

  const normalizedTokens = rawTokensFromNormalized(answer);
  if (normalizedTokens !== null) {
    for (const token of normalizedTokens) {
      const key = token.trim();
      const value = optionIndex.get(key);
      if (value !== undefined) {
        selected.add(value);
      }
    }
    return selected;
  }

  const text = String(answer.answer_text ?? "").trim();
  if (text.length === 0) {
    return selected;
  }

  // 単一選択、または value にカンマを含む選択肢の完全一致。
  const exact = optionIndex.get(text);
  if (exact !== undefined) {
    selected.add(exact);
    return selected;
  }

  // multi_choice はカンマ連結で入る。⚠ クライアント側で分解させない。
  for (const token of text.split(",")) {
    const key = token.trim();
    if (key.length === 0) {
      continue;
    }
    const value = optionIndex.get(key);
    if (value !== undefined) {
      selected.add(value);
    }
  }

  return selected;
}

/** この回答が、指定した選択肢を選んでいるか。セル→回答者抽出の判定に使う。 */
export function answerSelectedOption(
  answer: Answer,
  optionIndex: Map<string, string>,
  optionValue: string
): boolean {
  return selectedOptionValues(answer, optionIndex).has(optionValue);
}

/**
 * 選択肢ごとの件数を数える。定義済みの選択肢は 0 埋めで必ず返す。
 *
 * 返すのは Map（選択肢の並び順は呼び出し側が options で決める）。
 */
export function countByOption(answers: Answer[], options: QuestionOption[]): Map<string, number> {
  const optionIndex = buildOptionIndex(options);
  const counts = new Map<string, number>();
  for (const option of options) {
    counts.set(option.value, 0);
  }
  for (const answer of answers) {
    for (const value of selectedOptionValues(answer, optionIndex)) {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * 「1人でも選択肢を選んだ回答」の件数。GT表の n（有効回答数）に使う。
 *
 * ⚠ 複数選択の設問では「件数の合計 ≠ n」になる（1人が複数選ぶため）。
 *   %の分母は必ずこの n を使うこと（合計を分母にすると 100% にならない）。
 */
export function countAnsweredAny(answers: Answer[], options: QuestionOption[]): number {
  const optionIndex = buildOptionIndex(options);
  let count = 0;
  for (const answer of answers) {
    if (selectedOptionValues(answer, optionIndex).size > 0) {
      count += 1;
    }
  }
  return count;
}
