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
import { surveyOrderingService } from "./surveyOrderingService";
import type { AnswerUiPreset, Answer, Project, Question, QuestionPageGroup, Session } from "../types/domain";
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

/**
 * is_hidden を除外し sort_order 昇順に整列した設問配列を返す。
 * ランダム化時は sort_order が表示順位で上書き済み（surveyOrderingService）なので、
 * ここでの整列＝実際の表示順になる。以降の「次」判定は配列インデックスで行う。
 */
function orderedVisibleUniverse(questions: Question[]): Question[] {
  return questions
    .filter((q) => !q.is_hidden)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** ordered 配列の index 位置から、現 ctx で可視な最初の設問（自身含む前進）を返す。 */
function advancePastInvisible(
  startIndex: number,
  ordered: Question[],
  ctx: AnswerContext
): Question | null {
  for (let i = startIndex; i >= 0 && i < ordered.length; i++) {
    const q = ordered[i];
    if (q && isQuestionVisible(q, ctx)) return q;
  }
  return null;
}

/**
 * 直前に回答した設問（fromQuestion）と、その回答を反映した ctx から、次に出す設問ビューを返す。
 * 決定順: branch_rule（一致 or default/merge） → 無ければ表示順の次 → 不可視はスキップ。
 * 表示順はランダム化を含む ordered 配列の index で辿る（sort_order 直接比較はしない）。
 * @param normalizedAnswer 分岐評価に使う fromQuestion の回答ペイロード（{value|values|boolean|...}）
 */
export function computeNextView(input: {
  questions: Question[];
  ctx: AnswerContext;
  fromQuestion: Question;
  normalizedAnswer: Record<string, unknown>;
  /** 回答UIプリセット（migration 075）。渡すと presentation を同梱する。 */
  answerUiPreset?: AnswerUiPreset | null;
}): ResolvedQuestionView | null {
  const ordered = orderedVisibleUniverse(input.questions);

  const nextCode = resolveBranchNextCode(input.fromQuestion.branch_rule ?? null, input.normalizedAnswer);
  let candidate: Question | null = null;
  if (nextCode) {
    // 分岐ジャンプ先。不可視ならそこから表示順で前進する。
    const jumpIndex = ordered.findIndex((q) => q.question_code === nextCode);
    candidate = jumpIndex >= 0 ? advancePastInvisible(jumpIndex, ordered, input.ctx) : null;
  }
  if (!candidate) {
    const fromIndex = ordered.findIndex((q) => q.question_code === input.fromQuestion.question_code);
    candidate = advancePastInvisible(fromIndex + 1, ordered, input.ctx);
  }

  return candidate ? resolveQuestionView(candidate, input.ctx, input.answerUiPreset) : null;
}

// ------------------------------------------------------------------
// フェーズ絞り込み＋表示順の解決（surveyPage と同一の設問集合をフロー側でも再現する）
// ------------------------------------------------------------------

export type SurveyPhase = "screening" | "main";

/**
 * スクリーニング/メインのフェーズに応じて表示対象設問を絞り込む（surveyPage と同一ロジック）。
 * - screeningEnabled かつスクリーニング設問があり未判定 → スクリーニング設問のみ（phase=screening）
 * - それ以外 → 非スクリーニング設問のみ（phase=main）
 */
export function selectPhaseQuestions(
  allQuestions: Question[],
  opts: { screeningEnabled: boolean; screeningJudged: boolean }
): { questions: Question[]; phase: SurveyPhase } {
  const allVisible = allQuestions.filter((q) => !q.is_hidden);
  const screeningQuestions = allVisible.filter((q) => q.question_role === "screening");
  const hasScreening = screeningQuestions.length > 0 && opts.screeningEnabled;
  if (hasScreening && !opts.screeningJudged) {
    return { questions: screeningQuestions, phase: "screening" };
  }
  return { questions: allVisible.filter((q) => q.question_role !== "screening"), phase: "main" };
}

/**
 * surveyPage がクライアントへ渡すのと同一の「フェーズ絞り込み＋ランダム化順序」を再現する。
 * main フェーズのみ surveyOrderingService で表示順を確定（回答者ごとに決定的・既に確定済みなら再利用）。
 * 副作用（assignment status 更新等）は含めない＝フロー用の純粋な集合解決。
 */
export async function resolveOrderedRenderSet(input: {
  session: Session;
  project: Project;
  questions: Question[];
  pageGroups: QuestionPageGroup[];
  screeningEnabled: boolean;
  screeningJudged: boolean;
}): Promise<{ questions: Question[]; phase: SurveyPhase }> {
  const { questions: phaseQuestions, phase } = selectPhaseQuestions(input.questions, {
    screeningEnabled: input.screeningEnabled,
    screeningJudged: input.screeningJudged,
  });
  if (phase !== "main") {
    return { questions: phaseQuestions, phase };
  }
  try {
    const reordered = await surveyOrderingService.resolveOrder({
      session: input.session,
      project: input.project,
      questions: phaseQuestions,
      pageGroups: input.pageGroups,
    });
    return { questions: reordered.questions, phase };
  } catch {
    return { questions: phaseQuestions, phase };
  }
}

/**
 * 未回答かつ可視な最初の設問ビューを返す（初回ロード・再開用）。答え済みは answeredCodes で除外。
 */
export function resumeView(
  questions: Question[],
  ctx: AnswerContext,
  answeredCodes: Set<string>,
  answerUiPreset?: AnswerUiPreset | null
): ResolvedQuestionView | null {
  const ordered = orderedVisibleUniverse(questions);
  for (const q of ordered) {
    if (answeredCodes.has(q.question_code)) continue;
    if (!isQuestionVisible(q, ctx)) continue;
    return resolveQuestionView(q, ctx, answerUiPreset);
  }
  return null;
}
