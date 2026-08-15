/**
 * answerPresentation.ts
 *
 * 回答UIの「表示パターン」をサーバー権威で解決する純関数（migration 075 / spec-answer-ui-patterns）。
 *
 * 決定順:
 *   1. 設問単位の上書き   question_config.presentation.pattern（あれば最優先）
 *   2. プロジェクト単位   projects.answer_ui_preset（casual|standard|formal・デフォルト standard）
 *   3. 自動フォールバック  適用不能条件（設問文長・選択肢数）で casual→standard→formal 方向に降格
 *
 * 責務外:
 *   - HTML/EJS 生成（描画は survey.ejs のパターンレジストリが担う）
 *   - 回答の保存形式（既存 answers 経路のまま。表示層のみの変換）
 *   - pairwise のペア生成（questionEngine 側でペイロードに同梱。ここでは pattern 名のみ解決）
 */

import type { AnswerUiPreset, QuestionConfig, QuestionType } from "../types/domain";

/** 解決済みの表示パターン。resolveQuestionView の出力に同梱される。 */
export interface AnswerPresentation {
  /** 表示パターン名（下記 PATTERN 群のいずれか）。 */
  pattern: string;
  /** 実際に採用したプリセット。 */
  preset: AnswerUiPreset;
  /** 自動フォールバック（降格）が発生したか。 */
  fallback_applied: boolean;
  /** pairwise（duel）のとき、サーバー生成の対戦ペアと seed（再現性のため）。 */
  pairwise?: { pairs: Array<[string, string]>; seed: number };
}

export const DEFAULT_PRESET: AnswerUiPreset = "standard";

/** 設問文の全角換算長がこれを超える swipe_card は big_split へ降格。 */
const SWIPE_TEXT_MAX = 60;
/** 選択肢数がこれを超える carousel は tap_cards へ降格。 */
const CAROUSEL_OPTION_MAX = 8;
/** 選択肢数がこれ以上の face_scale / big_slider は tap_cards へ降格。 */
const SCALE_OPTION_MAX = 6;
/**
 * numeric の選択肢数がこれを超えたらドラムピッカー(number_wheel)で描く。
 * 0〜10 の11段階スケールまでは従来の丸ボタンで収まるため、それより多い場合のみ切り替える。
 */
const WHEEL_NUMERIC_MIN_COUNT = 12;

type ResolveInput = Pick<
  {
    question_type: QuestionType;
    question_text: string;
    question_config: QuestionConfig | null;
  },
  "question_type" | "question_text" | "question_config"
>;

/**
 * 1設問の表示パターンを解決する。
 *
 * @param question       question_type / question_text / question_config を持つ設問。
 * @param projectPreset  プロジェクトの answer_ui_preset（未指定は standard）。
 * @param optionCount    carry-forward / disable 反映後の実選択肢数。省略時は config.options 件数。
 */
export function resolveAnswerPresentation(
  question: ResolveInput,
  projectPreset: AnswerUiPreset | null | undefined,
  optionCount?: number,
): AnswerPresentation {
  const preset: AnswerUiPreset = projectPreset ?? DEFAULT_PRESET;
  const cfg = question.question_config ?? null;
  const n = optionCount ?? cfg?.options?.length ?? 0;

  // 1. 設問単位の上書き（あれば基底パターンに採用）。無ければ preset×type で基底を決める。
  const override = cfg?.presentation?.pattern?.trim();
  const base = override && override.length > 0
    ? override
    : basePattern(question.question_type, preset, cfg, n);

  // 3. 自動フォールバック（適用不能条件に該当したら降格）。
  const finalPattern = applyFallback(base, question.question_text ?? "", n);

  return {
    pattern: finalPattern,
    preset,
    fallback_applied: finalPattern !== base,
  };
}

/** preset × question_type × config から基底パターン名を決める（フォールバック前）。 */
function basePattern(
  type: QuestionType,
  preset: AnswerUiPreset,
  cfg: QuestionConfig | null,
  n: number,
): string {
  const casual = preset === "casual";
  const standard = preset === "standard";
  const formal = preset === "formal";
  const scale = cfg?.presentation?.scale === true;
  const slider = cfg?.presentation?.slider === true;

  switch (type) {
    case "single_choice":
    case "single_select": // legacy 別名
    case "yes_no": {
      // 0–100 スライダー指定 / 順序尺度指定は scale 系レイアウトへ
      if (slider) return formal ? "radio_list" : "big_slider";
      if (scale) return casual ? "face_scale" : standard ? "big_slider" : "radio_list";
      if (n <= 2) return casual ? "swipe_card" : standard ? "big_split" : "radio_list";
      return casual ? "carousel" : standard ? "tap_cards" : "radio_list";
    }
    case "multi_choice":
    case "multi_select": // legacy 別名
      return casual ? "sort_swipe" : standard ? "chip_select" : "checkbox_list";
    case "matrix_single":
    case "matrix_multi":
    case "matrix_mixed":
      // casual / standard は行分解（1行=1画面）。formal は従来のマトリクス表。
      return formal ? "matrix_table" : "matrix_rows";
    case "free_text_short":
    case "free_text_long":
    case "text": // legacy 別名
      return "textarea";
    // --- 新設問形式（migration 075）---
    case "pairwise":
      return "duel";
    case "ranking_top_n":
      return formal ? "ranking_numbered" : "podium";
    case "point_allocation":
      return "alloc_bars";
    case "image_heatmap":
      return "heat_tap";
    case "numeric":
      // 年齢のような広い数値レンジは丸ボタンを敷き詰めると数十個並んで実用にならないため、
      // ドラム(ホイール)ピッカーで描く。狭いレンジ(5段階評価など)は従来の丸ボタンのまま。
      return isWheelNumeric(cfg, n) ? "number_wheel" : "legacy";
    // image_upload / hidden_* / text_with_image / sd / scale(legacy) は従来描画
    default:
      return "legacy";
  }
}

/**
 * numeric 設問をドラム(ホイール)ピッカーで描くべきか判定する。
 *
 * 判定は「選ばせる値が多すぎて丸ボタンが破綻するか」の一点で行う。
 * 年齢(10〜100 = 91個)は該当し、5段階評価や 0〜10 のスケールは該当しない。
 * presentation.pattern による設問単位の明示指定は resolveAnswerPresentation 側で
 * 先に処理されるため、ここに来る時点で自動判定してよい。
 */
function isWheelNumeric(cfg: QuestionConfig | null, n: number): boolean {
  // scale / slider を明示している設問は尺度として描きたい意図なので対象外。
  if (cfg?.presentation?.scale === true || cfg?.presentation?.slider === true) return false;
  // options を明示列挙している場合はその件数、していない場合は min..max の幅で数える。
  const count = n > 0 ? n : numericRangeCount(cfg);
  return count > WHEEL_NUMERIC_MIN_COUNT;
}

/** options 未指定の numeric 設問について min..max が生む選択肢数を数える。 */
function numericRangeCount(cfg: QuestionConfig | null): number {
  const min = typeof cfg?.min === "number" ? cfg.min : null;
  const max = typeof cfg?.max === "number" ? cfg.max : null;
  if (min === null || max === null || max < min) return 0;
  return max - min + 1;
}

/** 適用不能条件に該当したパターンを降格する。降格が起きなければ入力をそのまま返す。 */
function applyFallback(pattern: string, questionText: string, n: number): string {
  switch (pattern) {
    case "swipe_card":
      // 設問文が全角60文字超 → big_split
      return charCount(questionText) > SWIPE_TEXT_MAX ? "big_split" : pattern;
    case "carousel":
      // 選択肢8件超 → tap_cards
      return n > CAROUSEL_OPTION_MAX ? "tap_cards" : pattern;
    case "face_scale":
    case "big_slider":
      // 選択肢6件以上 → tap_cards（尺度として破綻するため）
      return n >= SCALE_OPTION_MAX ? "tap_cards" : pattern;
    default:
      return pattern;
  }
}

/** 全角/半角を区別せず「文字数」で数える（絵文字はコードポイント単位）。 */
function charCount(text: string): number {
  return [...text].length;
}
