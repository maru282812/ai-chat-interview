/**
 * dailyChatAnswer.ts
 *
 * デイリーアンケートを「LINE のトーク内で 1 タップ回答」させるための純関数群。
 *
 * 前提: トーク内で完結できるのは選択肢を押すだけで確定する設問だけ。
 * 自由記述・複数選択は LINE のボタンでは確定できないので、その場合は
 * 従来どおり LIFF を開くリンク付きの通知にフォールバックする（judge* が判定する）。
 *
 * postback の data には delivery_id を載せない。載せると「他人の配信レコード ID を
 * 詰めた postback」で他人の回答を確定できてしまう。回答者は署名検証済み webhook の
 * source.userId で決め、data には survey / question / 選択肢の位置だけを入れる。
 */

import type { DailySurveyQuestion } from "../repositories/dailySurveyRepository";

/** postback data の action 名。 */
export const DAILY_ANSWER_ACTION = "daily_answer";

/** LINE の postback data は 300 文字まで。UUID 2 本 + 位置なら十分収まる。 */
const POSTBACK_DATA_MAX = 300;

/** LINE のボタン label は 20 文字まで。 */
const BUTTON_LABEL_MAX = 20;

/**
 * トーク内 1 タップ回答の対象にできる選択肢の数。
 * 1 個だと選ばせる意味がなく、多すぎるとバブルが縦に伸びて「開いた瞬間に選べる」体験を壊す。
 */
const MIN_OPTIONS = 2;
const MAX_OPTIONS = 6;

export interface DailyChatQuestion {
  question: DailySurveyQuestion;
  options: Array<{ label: string; value: string }>;
}

/**
 * この設問群がトーク内 1 タップ回答の対象かを判定する。
 * 対象なら設問と選択肢を返し、対象外なら null（＝リンク通知にフォールバック）。
 */
export function resolveChatAnswerable(
  questions: DailySurveyQuestion[]
): DailyChatQuestion | null {
  const question = questions.length === 1 ? questions[0] : undefined;
  if (!question) return null;

  if (question.question_type !== "single_choice" && question.question_type !== "scale") {
    return null;
  }

  const options = (question.answer_options ?? []).filter(
    (o) => o && typeof o.label === "string" && o.label.trim() !== ""
  );
  if (options.length < MIN_OPTIONS || options.length > MAX_OPTIONS) return null;

  return { question, options };
}

/** ボタン label は 20 文字上限。溢れたら省略記号で詰める。 */
export function truncateButtonLabel(label: string): string {
  const trimmed = label.trim();
  if (trimmed.length <= BUTTON_LABEL_MAX) return trimmed;
  return `${trimmed.slice(0, BUTTON_LABEL_MAX - 1)}…`;
}

export function buildDailyPostbackData(input: {
  surveyId: string;
  questionId: string;
  optionIndex: number;
}): string {
  const data = new URLSearchParams({
    action: DAILY_ANSWER_ACTION,
    s: input.surveyId,
    q: input.questionId,
    o: String(input.optionIndex),
  }).toString();

  if (data.length > POSTBACK_DATA_MAX) {
    throw new Error(`postback data が長すぎます (${data.length} > ${POSTBACK_DATA_MAX})`);
  }
  return data;
}

export interface ParsedDailyPostback {
  surveyId: string;
  questionId: string;
  optionIndex: number;
}

/**
 * postback data を読む。デイリー回答以外・壊れた data は null（呼び出し側は無視する）。
 * ここでは「形として読めるか」しか見ない。実在性・所有権・受付中かはサービス層で確かめる。
 */
export function parseDailyPostbackData(data: string): ParsedDailyPostback | null {
  if (!data || data.length > POSTBACK_DATA_MAX) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(data);
  } catch {
    return null;
  }

  if (params.get("action") !== DAILY_ANSWER_ACTION) return null;

  const surveyId = params.get("s") ?? "";
  const questionId = params.get("q") ?? "";
  const rawIndex = params.get("o") ?? "";

  if (!surveyId || !questionId) return null;
  if (!/^\d+$/.test(rawIndex)) return null;

  return { surveyId, questionId, optionIndex: Number(rawIndex) };
}
