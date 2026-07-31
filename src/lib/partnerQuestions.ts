import type { Question, QuestionOption, QuestionType } from "../types/domain";

/**
 * partnerQuestions.ts
 *
 * パートナーAPI（docs/partner-api.md）が扱う設問4種と、
 * ai-chat-interview の内部 question_type との対応。純関数のみ。
 *
 * パートナー側（ポータル B4 エディタ）は 4 種類しか扱わない:
 *   single_choice  単一選択
 *   multi_choice   複数選択
 *   free_text      自由記述
 *   scale          スケール（段階評価）
 *
 * 内部 DB の question_type（types/domain.ts QuestionType）は種類が多いので、
 * ここで 1 対 1 に写像する。scale は「順序尺度として扱う single_choice」として保存する
 * （question_config.presentation.scale=true・migration 075 の既存表現に合わせる）。
 * 内部に "scale" という後方互換値もあるが、これは migration 016 以前のレガシー値で
 * 現行の回答UIが選択肢を描画しないため使わない。
 */

export const PARTNER_QUESTION_TYPES = [
  "single_choice",
  "multi_choice",
  "free_text",
  "scale"
] as const;

export type PartnerQuestionType = (typeof PARTNER_QUESTION_TYPES)[number];

/** 選択肢が必須の種別か。 */
export function partnerTypeRequiresOptions(type: PartnerQuestionType): boolean {
  return type !== "free_text";
}

/** パートナー種別 → 内部 question_type。 */
export function toInternalQuestionType(type: PartnerQuestionType): QuestionType {
  switch (type) {
    case "multi_choice":
      return "multi_choice";
    case "free_text":
      return "free_text_long";
    // scale は「順序尺度として描画する single_choice」。内部型は single_choice のまま。
    case "scale":
    case "single_choice":
      return "single_choice";
  }
}

/**
 * 内部 question_type + question_config → パートナー種別。
 * 内部で扱える種別のうちパートナーが表現できないもの（マトリクス等）は null。
 * null の設問は、パートナー向けの GET レスポンスから除外する。
 */
export function toPartnerQuestionType(question: Question): PartnerQuestionType | null {
  if (question.question_config?.presentation?.scale === true) {
    return "scale";
  }
  switch (question.question_type) {
    case "single_choice":
    case "single_select":
      return "single_choice";
    case "multi_choice":
    case "multi_select":
      return "multi_choice";
    case "free_text_long":
    case "free_text_short":
    case "text":
      return "free_text";
    default:
      return null;
  }
}

/** 内部 question_config を、パートナー種別と選択肢から組み立てる。 */
export function buildPartnerQuestionConfig(
  type: PartnerQuestionType,
  options: QuestionOption[] | null
): Question["question_config"] {
  const config: NonNullable<Question["question_config"]> = {};
  if (options && options.length > 0) {
    config.options = options;
  }
  if (type === "scale") {
    // 順序尺度として描画させる（migration 075 の presentation 上書き）。
    config.presentation = { scale: true };
  }
  return config;
}

/** パートナー向けレスポンス用の設問表現。 */
export interface PartnerQuestionView {
  question_code: string;
  question_text: string;
  question_type: PartnerQuestionType;
  answer_options: QuestionOption[] | null;
  sort_order: number;
  is_required: boolean;
  /** 性年代設問など、パートナーが編集できない固定設問か。 */
  is_fixed: boolean;
}
