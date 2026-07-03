/**
 * surveyFlowService.ts
 *
 * サーバー権威の設問進行ロジック（plan §Phase1）。
 * クライアント(survey.ejs)の isVisible/applyAns/filterChoices/resolveNext を置き換える単一の正。
 *
 * - buildAnswerContext: 永続化された answers から question_code キーの AnswerContext を再構築。
 * - computeNextView:     直前設問の回答をもとに「次に出す設問の解決済みビュー」を返す（分岐→順送り、不可視スキップ）。
 * - resumeView:          未回答かつ可視の最初の設問ビューを返す（初回ロード・再開用）。
 *
 * 分岐評価は questionDesign の堅牢版 resolveNextQuestionCode を用いる（LINE会話経路と同一ロジック）。
 * 表示可否・差し込み・carry-forward・disable は questionEngine.resolveQuestionView に委譲する。
 */

import { resolveNextQuestionCode as resolveBranchNextCode } from "../lib/questionDesign";
import {
  isQuestionVisible,
  resolveQuestionView,
  type ResolvedQuestionView,
} from "../lib/questionEngine";
import type { Answer, Question } from "../types/domain";
import type { AnswerContext } from "../types/questionSchema";

/** 配列（複数選択）として ctx に格納すべき設問タイプ。 */
const MULTI_SELECT_TYPES = new Set([
  "multi_choice",
  "matrix_multi",
  "hidden_multi",
  "multi_select", // legacy
]);

/** answer_text（single=値 / multi=カンマ結合）を ctx 値へ正規化する。 */
export function answerValueForContext(
  questionType: string,
  answerText: string | null | undefined
): string | string[] {
  const text = answerText ?? "";
  if (MULTI_SELECT_TYPES.has(questionType)) {
    return text === "" ? [] : text.split(",");
  }
  return text;
}

/**
 * 永続化された answers から AnswerContext を組み立てる。
 * - primary 回答のみを対象（probe 等は除外）。
 * - 同一設問に複数 primary があれば後勝ち（listBySession は created_at 昇順前提）。
 */
export function buildAnswerContext(questions: Question[], answers: Answer[]): AnswerContext {
  const byId = new Map(questions.map((q) => [q.id, q]));
  const map: AnswerContext["answers"] = {};

  for (const a of answers) {
    if (a.answer_role && a.answer_role !== "primary") continue;
    const q = byId.get(a.question_id);
    if (!q) continue;
    map[q.question_code.toLowerCase()] = answerValueForContext(q.question_type, a.answer_text);
  }

  return { answers: map };
}

/** is_hidden を除外し sort_order 昇順に整列した設問配列を返す。 */
function orderedVisibleUniverse(questions: Question[]): Question[] {
  return questions
    .filter((q) => !q.is_hidden)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** 指定設問より後ろ（sort_order 昇順）で、現 ctx で可視な最初の設問を返す。 */
function advancePastInvisible(
  start: Question | null,
  ordered: Question[],
  ctx: AnswerContext
): Question | null {
  let candidate = start;
  const seen = new Set<string>();
  while (candidate && !isQuestionVisible(candidate, ctx)) {
    if (seen.has(candidate.question_code)) return null; // 循環ガード
    seen.add(candidate.question_code);
    const cursor = candidate;
    candidate = ordered.find((q) => q.sort_order > cursor.sort_order) ?? null;
  }
  return candidate;
}

/**
 * 直前に回答した設問（fromQuestion）と、その回答を反映した ctx から、次に出す設問ビューを返す。
 * 決定順: branch_rule（一致 or default/merge） → 無ければ sort_order の次 → 不可視はスキップ。
 * @param normalizedAnswer 分岐評価に使う fromQuestion の回答ペイロード（{value|values|boolean|...}）
 */
export function computeNextView(input: {
  questions: Question[];
  ctx: AnswerContext;
  fromQuestion: Question;
  normalizedAnswer: Record<string, unknown>;
}): ResolvedQuestionView | null {
  const ordered = orderedVisibleUniverse(input.questions);

  const nextCode = resolveBranchNextCode(input.fromQuestion.branch_rule ?? null, input.normalizedAnswer);
  let candidate: Question | null = null;
  if (nextCode) {
    candidate = ordered.find((q) => q.question_code === nextCode) ?? null;
  }
  if (!candidate) {
    candidate = ordered.find((q) => q.sort_order > input.fromQuestion.sort_order) ?? null;
  }

  candidate = advancePastInvisible(candidate, ordered, input.ctx);
  return candidate ? resolveQuestionView(candidate, input.ctx) : null;
}

/**
 * 未回答かつ可視な最初の設問ビューを返す（初回ロード・再開用）。答え済みは answeredCodes で除外。
 */
export function resumeView(
  questions: Question[],
  ctx: AnswerContext,
  answeredCodes: Set<string>
): ResolvedQuestionView | null {
  const ordered = orderedVisibleUniverse(questions);
  for (const q of ordered) {
    if (answeredCodes.has(q.question_code)) continue;
    if (!isQuestionVisible(q, ctx)) continue;
    return resolveQuestionView(q, ctx);
  }
  return null;
}
