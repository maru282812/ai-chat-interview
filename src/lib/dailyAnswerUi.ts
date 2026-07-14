/**
 * dailyAnswerUi.ts
 *
 * デイリーアンケートの設問モデル（daily_survey_questions）を、案件アンケートと同じ
 * 回答UIレンダラ（partials/answer-ui.ejs）が食える形に変換する純関数群。
 * plan-daily-survey-queue.md Phase 3。
 *
 * デイリーの設問は案件アンケートの QuestionType / question_config とは別物なので、
 * ここでアダプトしてから resolveAnswerPresentation に渡す:
 *
 *   scale           → single_choice + presentation.scale = true（既定 1〜5）
 *   multiple_choice → multi_choice
 *   text            → free_text_short
 *   single_choice   → single_choice
 *   answer_options[{label,value}] → choices[{value,label}]
 *
 * 責務外:
 *   - HTML 生成（描画は partials/answer-ui.ejs の AnswerUI）
 *   - 回答の保存形式（従来どおり questionId → value。UI を変えても不変）
 */

import type { DailySurveyQuestion } from "../repositories/dailySurveyRepository";
import type { AnswerUiPreset, QuestionConfig, QuestionType } from "../types/domain";
import { type AnswerPresentation, resolveAnswerPresentation } from "./answerPresentation";

/** デイリーは既定 casual（スワイプ/タップ系）。 */
export const DEFAULT_DAILY_PRESET: AnswerUiPreset = "casual";

/** scale で answer_options が空のときの既定尺度。 */
const DEFAULT_SCALE_OPTIONS: Array<{ label: string; value: string }> = [1, 2, 3, 4, 5].map((n) => ({
  label: String(n),
  value: String(n),
}));

/** レンダラが期待する選択肢の形。 */
export interface DailyChoice {
  value: string;
  label: string;
}

/** クライアントへ返す1設問ぶんのビュー（表示パターン解決済み）。 */
export interface DailyQuestionView {
  id: string;
  question_text: string;
  /** 元の設問タイプ（保存形式の判定は従来どおりこれを使う）。 */
  question_type: DailySurveyQuestion["question_type"];
  answer_options: Array<{ label: string; value: string }>;
  /** 解決済みの選択肢（scale の既定 1〜5 を含む）。 */
  choices: DailyChoice[];
  /** サーバー権威で解決した表示パターン。 */
  presentation: AnswerPresentation;
}

/** 設問タイプを案件アンケートの QuestionType へ写す。 */
export function toQuestionType(type: DailySurveyQuestion["question_type"]): QuestionType {
  switch (type) {
    case "multiple_choice":
      return "multi_choice";
    case "text":
      return "free_text_short";
    case "scale":
    case "single_choice":
      return "single_choice";
    default:
      return "single_choice";
  }
}

/** 実際に描画する選択肢（scale で未設定なら 1〜5 を補う）。 */
export function toChoices(question: DailySurveyQuestion): DailyChoice[] {
  const options = Array.isArray(question.answer_options) ? question.answer_options : [];
  const source = options.length > 0
    ? options
    : question.question_type === "scale"
      ? DEFAULT_SCALE_OPTIONS
      : [];
  return source
    .filter((o) => o && o.value !== undefined && o.value !== null)
    .map((o) => ({ value: String(o.value), label: String(o.label ?? o.value) }));
}

/** resolveAnswerPresentation に渡す設問形へ変換する。 */
export function toPresentationInput(question: DailySurveyQuestion): {
  question_type: QuestionType;
  question_text: string;
  question_config: QuestionConfig | null;
} {
  const choices = toChoices(question);
  const config: QuestionConfig = {
    options: choices.map((c) => ({ value: c.value, label: c.label })),
  };
  // scale は「順序尺度」として扱う（casual → face_scale / standard → big_slider）。
  if (question.question_type === "scale") {
    config.presentation = { scale: true };
  }
  return {
    question_type: toQuestionType(question.question_type),
    question_text: question.question_text ?? "",
    question_config: config,
  };
}

/** 1設問を表示パターン付きのビューに解決する。 */
export function resolveDailyQuestionView(
  question: DailySurveyQuestion,
  preset: AnswerUiPreset | null | undefined,
): DailyQuestionView {
  const choices = toChoices(question);
  const presentation = resolveAnswerPresentation(
    toPresentationInput(question),
    preset ?? DEFAULT_DAILY_PRESET,
    choices.length,
  );
  return {
    id: question.id,
    question_text: question.question_text,
    question_type: question.question_type,
    answer_options: question.answer_options ?? [],
    choices,
    presentation,
  };
}

/** 設問配列をまとめて解決する。 */
export function resolveDailyQuestionViews(
  questions: DailySurveyQuestion[],
  preset: AnswerUiPreset | null | undefined,
): DailyQuestionView[] {
  return questions.map((q) => resolveDailyQuestionView(q, preset));
}
