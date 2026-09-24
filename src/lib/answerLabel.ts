/**
 * answerLabel.ts
 *
 * 選択肢設問の「保存値(value)」を「回答者が実際に見たラベル(label)」へ変換する。
 *
 * 用途は AI に渡す文面の組み立てに限る。深掘り(probe)プロンプトへ value のまま
 * 渡すと、生成文が「『yes』と回答されていますが…」のように内部値を露出してしまう
 * （回答者は「はい」というラベルしか見ていない）。
 *
 * ⚠ answers.answer_text をラベル化してはいけない。分岐(branch_rule)・表示条件・
 * スクリーニング・統計エクスポートはいずれも value 基準で動いており、保存形式は
 * 凍結契約。本関数は「AI へ渡す文字列」だけを差し替えるために使う。
 *
 * 変換規則は LINE webhook 経路（questionFlowServiceV2.parseAnswer）に合わせる:
 *   - 単一選択: option.label
 *   - 複数選択: option.label をカンマ区切りで結合
 * これにより LIFF と LINE でプロンプトに載る文面が揃う。
 */

import type { Question } from "../types/domain";

/** 複数選択の保存値はカンマ結合（surveyFlowService の解釈と同一規則）。 */
const MULTI_VALUE_SEPARATOR = /[,、]/;

const CHOICE_QUESTION_TYPES = new Set(["single_choice", "multi_choice", "text_with_image"]);

function normalize(input: string): string {
  return input.trim().toLowerCase();
}

/**
 * value（あるいは既にラベルの文字列）から選択肢を引く。
 * 保存値は value だが、経路によっては label が入ることもあるため両方を受ける。
 */
function findOptionLabel(token: string, options: Array<{ label?: unknown; value?: unknown }>): string | null {
  const normalized = normalize(token);
  if (!normalized) return null;

  for (const option of options) {
    const value = typeof option?.value === "string" ? option.value : null;
    const label = typeof option?.label === "string" ? option.label : null;
    if (!label) continue;
    if ((value !== null && normalize(value) === normalized) || normalize(label) === normalized) {
      return label;
    }
  }
  return null;
}

/**
 * AI へ渡す回答文面を作る。選択肢設問なら value をラベルに置き換え、
 * それ以外（自由記述・数値など）や未知の値はそのまま返す（安全側）。
 */
export function toDisplayAnswerForPrompt(answerText: string, question: Question | null | undefined): string {
  const raw = answerText ?? "";
  if (!question || !raw.trim()) return raw;
  if (!CHOICE_QUESTION_TYPES.has(question.question_type)) return raw;

  const options = Array.isArray(question.question_config?.options)
    ? (question.question_config.options as Array<{ label?: unknown; value?: unknown }>)
    : [];
  if (options.length === 0) return raw;

  const tokens = raw.split(MULTI_VALUE_SEPARATOR).map((part) => part.trim()).filter(Boolean);
  if (tokens.length === 0) return raw;

  const labels = tokens.map((token) => findOptionLabel(token, options));

  // 1つでも引けなかったら変換しない。「その他」の自由記述など選択肢に無い回答を
  // 部分的にラベル化すると、かえって元の回答が読めなくなるため。
  if (labels.some((label) => label === null)) return raw;

  return labels.join(", ");
}
