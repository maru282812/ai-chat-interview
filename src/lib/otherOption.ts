/**
 * otherOption.ts
 *
 * 「その他」系選択肢に自由記述欄(allow_free_text)を自動付与する共通ルール。
 *
 * 背景:
 *   allow_free_text は管理画面の「自由記述を出す選択肢」テキストエリアでのみ付いていたため、
 *   シードスクリプトや Partner API 経由で作られた「その他（）」は、ラベル上は自由記述に
 *   見えるのに入力欄が出ないという不一致が起きていた。
 *   ラベルが「その他」で始まる選択肢は自由記述を出すのが常に意図であるため、既定で付与する。
 *
 * 責務外:
 *   - 排他(exclusive)の付与。これは adminController 側の既存ルールが担う
 *     （EXCLUSIVE_AUTO_LABEL_RE と allow_free_text の両方を見ている）。
 *   - 描画。survey.ejs / answer-ui.ejs が allow_free_text を見て入力欄を出す。
 */

import type { QuestionOption } from "../types/domain";

/**
 * 「その他」で始まるラベルとみなす正規表現。
 *
 * 先頭一致にしているのは「その他の店舗」のような通常の選択肢を巻き込まないため
 * ではなく、逆に「その他（）」「その他(具体的に)」「その他・自由記述」を確実に拾うため。
 * 先頭の空白・記号は許容する。
 */
const OTHER_LABEL_RE = /^[\s　]*その他/;

/** ラベルが「その他」系か判定する。 */
export function isOtherLabel(label: string | null | undefined): boolean {
  if (!label) return false;
  return OTHER_LABEL_RE.test(label);
}

/**
 * 「その他」系選択肢に allow_free_text を自動付与する。
 *
 * - 既に allow_free_text が明示されている選択肢は尊重する（false の明示指定も上書きしない）。
 * - それ以外の選択肢には一切触れない（参照同一性も保つ）。
 */
export function applyAutoFreeText(options: QuestionOption[]): QuestionOption[];
export function applyAutoFreeText(
  options: QuestionOption[] | undefined,
): QuestionOption[] | undefined;
export function applyAutoFreeText(
  options: QuestionOption[] | null | undefined,
): QuestionOption[] | null | undefined;
export function applyAutoFreeText(
  options: QuestionOption[] | null | undefined,
): QuestionOption[] | null | undefined {
  // options 未設定の設問（numeric 等）で空配列を生やさないよう、入力をそのまま返す。
  if (!options || options.length === 0) return options;
  return options.map((opt) => {
    if (opt.allow_free_text !== undefined) return opt;
    if (!isOtherLabel(opt.label)) return opt;
    return { ...opt, allow_free_text: true };
  });
}
