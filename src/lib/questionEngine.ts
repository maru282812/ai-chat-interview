/**
 * questionEngine.ts
 *
 * アンケート/インタビュー共通の質問進行エンジン。
 * display_mode に関わらず、質問定義・タグ解釈・分岐評価を共通化する。
 *
 * 責務:
 *   - 表示すべき設問の決定 (visibility_conditions / pipe 評価)
 *   - 次の設問コードの決定 (branch_rule 評価)
 *   - <ans> 差し込みの適用
 *   - <disable> による選択肢フィルタリング
 *   - survey_page モード用のページグループ管理
 *
 * 責務外（LIFF の描画は呼び出し元が担う）:
 *   - HTML/EJS の生成
 *   - DB アクセス
 *   - AI 深掘り（既存 conversationOrchestratorService に委譲）
 */

import type { Question } from "../types/domain";
import type {
  DisplayTagsParsed,
  VisibilityCondition,
  PipingCondition,
  AnswerInsertion,
  DisableRule,
  QuestionPageGroup,
  QuestionPage,
  AnswerContext,
  PipeEvalResult,
} from "../types/questionSchema";

// ------------------------------------------------------------------
// 1. Pipe 条件式の評価
// ------------------------------------------------------------------

/**
 * シンプルな条件式評価器 (Phase 1)
 *
 * 対応する構文:
 *   q1=1               質問 q1 の回答が "1"
 *   q1=1 and q2=2      AND
 *   q1=1 or q2=2       OR
 *   ( q1=1 and q2=2 ) or q3=3   括弧
 *
 * Phase 2 で AST パーサに置き換える想定。
 * 現時点では再帰的な文字列マッチングで対応。
 */
export function evaluatePipeExpression(
  expression: string,
  ctx: AnswerContext
): PipeEvalResult {
  try {
    const result = evalExpr(expression.trim(), ctx);
    return { visible: result };
  } catch (err) {
    // パースエラーは安全側（表示する）に倒す
    return {
      visible: true,
      reason: `条件式の評価に失敗しました: ${String(err)}`,
    };
  }
}

function evalExpr(expr: string, ctx: AnswerContext): boolean {
  // 括弧の処理: 最外層の括弧を剥がす
  expr = expr.trim();
  if (expr.startsWith("(") && expr.endsWith(")") && isBalancedParens(expr.slice(1, -1))) {
    expr = expr.slice(1, -1).trim();
  }

  // OR (低優先度、左から評価)
  const orParts = splitByKeyword(expr, " or ");
  if (orParts.length > 1) {
    return orParts.some((part) => evalExpr(part, ctx));
  }

  // AND
  const andParts = splitByKeyword(expr, " and ");
  if (andParts.length > 1) {
    return andParts.every((part) => evalExpr(part, ctx));
  }

  // NOT
  if (/^not\s+/i.test(expr)) {
    return !evalExpr(expr.slice(4).trim(), ctx);
  }

  // 基本比較: q1=1 / q1!=1 / q1>=1 / q1<=1 / q1>1 / q1<1
  const cmpMatch = expr.match(/^(q\d+)\s*(!=|>=|<=|>|<|=)\s*(.+)$/i);
  if (cmpMatch) {
    const code   = cmpMatch[1] ?? "";
    const op     = cmpMatch[2] ?? "=";
    const rawVal = cmpMatch[3] ?? "";
    const actual = ctx.answers[code.toLowerCase()];
    return compare(actual, op, rawVal.trim());
  }

  // MA (multi_answer) 含有チェック: q1 includes 1 (Phase 2 向け)
  const inclMatch = expr.match(/^(q\d+)\s+includes\s+(.+)$/i);
  if (inclMatch) {
    const code   = inclMatch[1] ?? "";
    const rawVal = inclMatch[2] ?? "";
    const actual = ctx.answers[code.toLowerCase()];
    if (Array.isArray(actual)) {
      return actual.map(String).includes(rawVal.trim());
    }
    return String(actual ?? "") === rawVal.trim();
  }

  return false;
}

function compare(
  actual: string | string[] | number | null | undefined,
  op: string,
  expected: string
): boolean {
  const a = String(actual ?? "");
  const e = expected;
  const aNum = parseFloat(a);
  const eNum = parseFloat(e);

  switch (op) {
    case "=":  return a === e;
    case "!=": return a !== e;
    case ">":  return !isNaN(aNum) && !isNaN(eNum) ? aNum > eNum : a > e;
    case "<":  return !isNaN(aNum) && !isNaN(eNum) ? aNum < eNum : a < e;
    case ">=": return !isNaN(aNum) && !isNaN(eNum) ? aNum >= eNum : a >= e;
    case "<=": return !isNaN(aNum) && !isNaN(eNum) ? aNum <= eNum : a <= e;
    default:   return false;
  }
}

/** キーワードで分割（括弧内のキーワードは無視） */
function splitByKeyword(expr: string, keyword: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;

  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") depth--;
    else if (depth === 0 && expr.slice(i).toLowerCase().startsWith(keyword)) {
      parts.push(expr.slice(last, i).trim());
      last = i + keyword.length;
      i = last - 1;
    }
  }
  parts.push(expr.slice(last).trim());
  return parts.length > 1 ? parts : [expr];
}

function isBalancedParens(s: string): boolean {
  let depth = 0;
  for (const ch of s) {
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    if (depth < 0) return false;
  }
  return depth === 0;
}

// ------------------------------------------------------------------
// 2. 設問の表示可否判定
// ------------------------------------------------------------------

/**
 * 設問の visibility_conditions を評価して表示すべきか判断する。
 * 条件なし → 常に表示
 * 複数条件 → すべて満たす場合に表示 (AND)
 */
export function isQuestionVisible(
  question: Pick<Question, "visibility_conditions">,
  ctx: AnswerContext
): boolean {
  const conditions = question.visibility_conditions;
  if (!conditions || conditions.length === 0) return true;

  return conditions.every((cond) => {
    if (cond.type === "pipe_expression") {
      return evaluatePipeExpression(cond.expression, ctx).visible;
    }
    return true; // 未知の条件タイプは表示とみなす
  });
}

// ------------------------------------------------------------------
// 3. 次の質問コード決定
// ------------------------------------------------------------------

/**
 * branch_rule と現在の回答コンテキストから次の質問コードを決定する。
 * @returns 次の question_code。null = 終了
 */
export function resolveNextQuestionCode(
  question: Pick<Question, "branch_rule">,
  ctx: AnswerContext
): string | null {
  const rule = question.branch_rule as {
    default_next?: string | null;
    branches?: Array<{
      source?: string;
      field?: string | null;
      when: Record<string, unknown>;
      next: string;
    }>;
    merge_question_code?: string | null;
  } | null;

  if (!rule) return null;

  if (rule.branches) {
    for (const branch of rule.branches) {
      const sourceCode = branch.field
        ? `${branch.source ?? "answer"}.${branch.field}`
        : (branch.source ?? "answer");

      // 回答値を取得
      let actual: unknown = null;
      if (branch.source === "extracted" && branch.field) {
        // extracted フィールドの参照は Phase 2 で実装
        actual = null;
      } else {
        // answer そのもの: ctx.answers から現在の質問コードで取得
        actual = Object.values(ctx.answers).at(-1); // 最後に追加された回答
      }

      const when = branch.when;
      let matched = false;

      if (when.equals !== undefined) {
        matched = String(actual) === String(when.equals);
      } else if (when.includes !== undefined) {
        matched = Array.isArray(actual)
          ? actual.map(String).includes(String(when.includes))
          : String(actual).includes(String(when.includes));
      } else if (when.any_of !== undefined && Array.isArray(when.any_of)) {
        matched = when.any_of.map(String).includes(String(actual));
      } else if (when.gte !== undefined) {
        matched = parseFloat(String(actual)) >= Number(when.gte);
      } else if (when.lte !== undefined) {
        matched = parseFloat(String(actual)) <= Number(when.lte);
      }

      if (matched) return branch.next;
    }
  }

  return rule.default_next ?? null;
}

// ------------------------------------------------------------------
// 4. <ans> 差し込み
// ------------------------------------------------------------------

/**
 * displayTagsParsed.answerInsertions を評価し、
 * 設問文/コメント内の差し込みプレースホルダを実際の回答値に置き換える。
 *
 * プレースホルダ記法: {ans:q1}  (内部処理用・LIFF 側で適用)
 *
 * この関数は「差し込み後の文字列」を返す。
 * プレースホルダを使わず、直接差し込む場合は insertAnswerValue を使う。
 */
export function applyAnswerInsertions(
  text: string,
  insertions: AnswerInsertion[] | undefined,
  ctx: AnswerContext
): string {
  if (!insertions || insertions.length === 0) return text;

  let result = text;
  for (const ins of insertions) {
    const answerValue = ctx.answers[ins.source.toLowerCase()];
    const displayValue = Array.isArray(answerValue)
      ? answerValue.join("、")
      : String(answerValue ?? "");

    // <ans q1> スタイルのプレースホルダを置換
    const placeholder = new RegExp(`<ans\\s+${ins.source}>`, "gi");
    result = result.replace(placeholder, displayValue);

    // {ans:q1} スタイルのプレースホルダも対応
    const placeholder2 = new RegExp(`\\{ans:${ins.source}\\}`, "gi");
    result = result.replace(placeholder2, displayValue);
  }

  return result;
}

// ------------------------------------------------------------------
// 5. <disable> による選択肢フィルタリング
// ------------------------------------------------------------------

/**
 * <disable> ルールを評価し、表示すべき選択肢の value セットを返す。
 * @param allChoiceValues - 全選択肢の value 配列
 * @param disableRules    - DisplayTagsParsed.disableRules
 * @param ctx             - 現在の回答コンテキスト
 * @returns 表示すべき選択肢の value セット
 */
export function filterEnabledChoices(
  allChoiceValues: string[],
  disableRules: DisableRule[] | undefined,
  ctx: AnswerContext
): Set<string> {
  const enabled = new Set(allChoiceValues);

  if (!disableRules || disableRules.length === 0) return enabled;

  for (const rule of disableRules) {
    const shouldDisable = evaluatePipeExpression(rule.condition, ctx).visible;
    if (shouldDisable) {
      enabled.delete(rule.targetChoice);
    }
  }

  return enabled;
}

// ------------------------------------------------------------------
// 6. survey_page モード: 質問をページ単位にグループ化
// ------------------------------------------------------------------

/**
 * survey_page モード用に質問をページグループ単位でまとめる。
 * page_group_id = null の質問は「未割当ページ」として末尾にまとめる。
 */
export function groupQuestionsByPage(
  questions: Question[],
  pageGroups: QuestionPageGroup[]
): QuestionPage[] {
  const pageGroupMap = new Map(pageGroups.map((pg) => [pg.id, pg]));
  const pageMap = new Map<string | null, Question[]>();

  // ページグループ順にキーを初期化
  for (const pg of pageGroups.sort((a, b) => a.sort_order - b.sort_order)) {
    pageMap.set(pg.id, []);
  }
  pageMap.set(null, []); // 未割当

  // 設問を各ページに振り分け
  for (const q of questions.sort((a, b) => a.sort_order - b.sort_order)) {
    const key = q.page_group_id ?? null;
    if (!pageMap.has(key)) pageMap.set(key, []);
    pageMap.get(key)!.push(q);
  }

  // QuestionPage 配列を組み立て
  const pages: QuestionPage[] = [];

  for (const [groupId, qs] of pageMap.entries()) {
    if (qs.length === 0) continue;
    pages.push({
      pageGroup: groupId ? (pageGroupMap.get(groupId) ?? null) : null,
      questions: qs.map((q) => ({ ...q, question_type: q.question_type as never })),
    });
  }

  return pages;
}

// ------------------------------------------------------------------
// 7. 可視設問のみに絞り込む
// ------------------------------------------------------------------

/**
 * 質問リストから、現在の回答コンテキストで表示すべき設問のみを返す。
 */
export function filterVisibleQuestions(
  questions: Question[],
  ctx: AnswerContext
): Question[] {
  return questions.filter((q) => isQuestionVisible(q, ctx));
}
