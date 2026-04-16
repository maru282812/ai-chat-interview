/**
 * tagValidator.ts
 *
 * DisplayTagsParsed を検証する。
 * parser とは分離し、ここでは「設問コンテキストへの整合性」を検証する。
 *
 * 検証内容:
 *   - タグと設問タイプの不整合
 *   - 参照先設問が存在しない <ans> / <pipe> / <disable>
 *   - 競合するタグの共存 (year+jyear, n+al など)
 *   - matrix 専用タグを non-matrix 設問に使用
 *   - <disable> を non-matrix 設問に使用
 *   - year/jyear/month/day の同時指定不正
 *   - 循環分岐は branch_rule 側で別途チェック (ここでは対象外)
 */

import type { DisplayTagsParsed, TagValidationError } from "../types/questionSchema";
import type { Question } from "../types/domain";
import { MATRIX_TYPES, TEXT_INPUT_TYPES } from "../types/questionSchema";

// ------------------------------------------------------------------
// 主エントリ
// ------------------------------------------------------------------

/**
 * @param parsed    - tagParser.parseDisplayTags() の結果
 * @param question  - 対象の質問オブジェクト（type チェック用）
 * @param allQuestions - プロジェクト内の全質問（参照先チェック用）
 * @returns エラー・警告の配列（空 = バリデーション通過）
 */
export function validateDisplayTags(
  parsed: DisplayTagsParsed,
  question: Pick<Question, "question_code" | "question_type">,
  allQuestions: Pick<Question, "question_code">[]
): TagValidationError[] {
  const errors: TagValidationError[] = [];
  const allCodes = new Set(allQuestions.map((q) => q.question_code));
  const qType = question.question_type;

  // ----------------------------------------------------------------
  // 1. <disable> はマトリクス系のみ
  // ----------------------------------------------------------------
  if (parsed.disableRules && parsed.disableRules.length > 0) {
    if (!MATRIX_TYPES.includes(qType as never)) {
      errors.push({
        code: "DISABLE_NOT_MATRIX",
        message: `${question.question_code}: <disable> はマトリクス系のみ使用できます（現在: ${qType}）`,
        severity: "error",
        tagName: "disable",
      });
    }
  }

  // ----------------------------------------------------------------
  // 2. マトリクス列設定タグ (<sa> <ma> <fs> <fl>) はマトリクス系のみ
  // ----------------------------------------------------------------
  if (parsed.matrixColSettings && parsed.matrixColSettings.length > 0) {
    if (!MATRIX_TYPES.includes(qType as never)) {
      errors.push({
        code: "MATRIX_TAG_NOT_MATRIX",
        message: `${question.question_code}: <sa>/<ma>/<fs>/<fl> はマトリクス設問のみ使用できます（現在: ${qType}）`,
        severity: "error",
        tagName: "matrix",
      });
    }
  }

  // ----------------------------------------------------------------
  // 3. <ans q●●> の参照先チェック
  // ----------------------------------------------------------------
  if (parsed.answerInsertions) {
    for (const ins of parsed.answerInsertions) {
      if (!allCodes.has(ins.source)) {
        errors.push({
          code: "ANS_REFERENCE_NOT_FOUND",
          message: `${question.question_code}: <ans ${ins.source}> の参照先が存在しません`,
          severity: "error",
          tagName: "ans",
          detail: `参照先: ${ins.source}`,
        });
      }
      if (ins.source === question.question_code) {
        errors.push({
          code: "ANS_SELF_REFERENCE",
          message: `${question.question_code}: <ans ${ins.source}> が自身を参照しています（循環参照不可）`,
          severity: "error",
          tagName: "ans",
        });
      }
    }
  }

  // ----------------------------------------------------------------
  // 4. <pipe 条件式> 内の質問コード参照チェック
  // ----------------------------------------------------------------
  if (parsed.pipingConditions) {
    for (const pipe of parsed.pipingConditions) {
      const referencedCodes = extractQuestionCodesFromExpression(pipe.expression);
      for (const code of referencedCodes) {
        if (!allCodes.has(code)) {
          errors.push({
            code: "PIPE_REFERENCE_NOT_FOUND",
            message: `${question.question_code}: <pipe> 条件式の参照先 "${code}" が存在しません`,
            severity: "error",
            tagName: "pipe",
            detail: `条件式: ${pipe.expression}`,
          });
        }
      }
    }
  }

  // ----------------------------------------------------------------
  // 5. <disable 条件> 内の質問コード参照チェック
  // ----------------------------------------------------------------
  if (parsed.disableRules) {
    for (const rule of parsed.disableRules) {
      const referencedCodes = extractQuestionCodesFromExpression(rule.condition);
      for (const code of referencedCodes) {
        if (!allCodes.has(code)) {
          errors.push({
            code: "DISABLE_REFERENCE_NOT_FOUND",
            message: `${question.question_code}: <disable> 条件式の参照先 "${code}" が存在しません`,
            severity: "error",
            tagName: "disable",
            detail: `条件式: ${rule.condition}`,
          });
        }
      }
    }
  }

  // ----------------------------------------------------------------
  // 6. type(year) と type(jyear) の共存不可
  // ----------------------------------------------------------------
  if (parsed.inputType?.year && parsed.inputType?.jyear) {
    errors.push({
      code: "TYPE_YEAR_JYEAR_CONFLICT",
      message: `${question.question_code}: <type(year)> と <type(jyear)> は同時使用できません`,
      severity: "error",
      tagName: "type",
    });
  }

  // ----------------------------------------------------------------
  // 7. <n>（数値のみ）と <al>（英数字）の共存不可
  // ----------------------------------------------------------------
  if (parsed.numericOnly && parsed.alphaNumericOnly) {
    errors.push({
      code: "NUMERIC_ALPHA_CONFLICT",
      message: `${question.question_code}: <n>（数値のみ）と <al>（英数字）は同時使用できません`,
      severity: "error",
      tagName: "n",
    });
  }

  // ----------------------------------------------------------------
  // 8. <rows>/<cols> はテキスト入力系のみ
  // ----------------------------------------------------------------
  if (parsed.rows !== undefined || parsed.cols !== undefined) {
    if (!TEXT_INPUT_TYPES.includes(qType as never)) {
      errors.push({
        code: "ROWS_COLS_INVALID_TYPE",
        message: `${question.question_code}: <rows>/<cols> はテキスト入力系設問のみ使用できます（現在: ${qType}）`,
        severity: "warning",
        tagName: "rows",
      });
    }
  }

  // ----------------------------------------------------------------
  // 9. type(year/jyear/month/day) は numeric 系のみ
  // ----------------------------------------------------------------
  if (parsed.inputType) {
    const hasDateType =
      parsed.inputType.year || parsed.inputType.jyear ||
      parsed.inputType.month || parsed.inputType.day;
    if (hasDateType) {
      const numericTypes = ["numeric", "text", "free_text_short"];
      if (!numericTypes.includes(qType)) {
        errors.push({
          code: "DATE_TYPE_INVALID_QUESTION_TYPE",
          message: `${question.question_code}: <type(year/month/day)> は数値・テキスト系設問のみ使用できます（現在: ${qType}）`,
          severity: "warning",
          tagName: "type",
        });
      }
    }
  }

  // ----------------------------------------------------------------
  // 10. <min>/<max> は numeric 系のみ
  // ----------------------------------------------------------------
  if (parsed.minValue !== undefined || parsed.maxValue !== undefined) {
    const numericTypes = ["numeric", "text", "free_text_short", "free_text_long", "scale"];
    if (!numericTypes.includes(qType)) {
      errors.push({
        code: "MIN_MAX_INVALID_TYPE",
        message: `${question.question_code}: <min>/<max> は数値・テキスト・スケール系設問のみ使用できます（現在: ${qType}）`,
        severity: "warning",
        tagName: "min",
      });
    }
  }

  // ----------------------------------------------------------------
  // 11. min > max の矛盾
  // ----------------------------------------------------------------
  if (
    parsed.minValue !== undefined &&
    parsed.maxValue !== undefined &&
    parsed.minValue > parsed.maxValue
  ) {
    errors.push({
      code: "MIN_GREATER_THAN_MAX",
      message: `${question.question_code}: <min=${parsed.minValue}> が <max=${parsed.maxValue}> より大きくなっています`,
      severity: "error",
      tagName: "min",
    });
  }

  return errors;
}

// ------------------------------------------------------------------
// 循環分岐チェック（branch_rule 用・別途呼び出し）
// ------------------------------------------------------------------

/**
 * プロジェクト内の全質問の branch_rule から循環参照を検出する。
 * @returns 循環が検出された場合、エラーメッセージを含む配列
 */
export function validateNoCyclicBranch(
  questions: Pick<Question, "question_code" | "branch_rule">[]
): TagValidationError[] {
  const errors: TagValidationError[] = [];

  // question_code → 到達可能な next codes のマップ
  const nextMap = new Map<string, string[]>();

  for (const q of questions) {
    const rule = q.branch_rule as {
      default_next?: string | null;
      branches?: Array<{ next: string }>;
    } | null;
    if (!rule) continue;

    const nexts: string[] = [];
    if (rule.default_next) nexts.push(rule.default_next);
    if (rule.branches) {
      for (const b of rule.branches) {
        if (b.next) nexts.push(b.next);
      }
    }
    nextMap.set(q.question_code, nexts);
  }

  // DFS で循環検出
  for (const startCode of nextMap.keys()) {
    const visited = new Set<string>();
    const path: string[] = [];

    function dfs(code: string): boolean {
      if (path.includes(code)) {
        const cycleStart = path.indexOf(code);
        const cycle = [...path.slice(cycleStart), code].join(" → ");
        errors.push({
          code: "CYCLIC_BRANCH",
          message: `循環分岐を検出しました: ${cycle}`,
          severity: "error",
          tagName: "branch_rule",
          detail: `開始: ${startCode}`,
        });
        return true;
      }
      if (visited.has(code)) return false;
      visited.add(code);
      path.push(code);
      const nexts = nextMap.get(code) ?? [];
      for (const next of nexts) {
        if (dfs(next)) return true;
      }
      path.pop();
      return false;
    }

    dfs(startCode);
  }

  return errors;
}

// ------------------------------------------------------------------
// util: 条件式から質問コード (q1, q2, ...) を抽出
// ------------------------------------------------------------------

function extractQuestionCodesFromExpression(expr: string): string[] {
  const matches = expr.match(/\bq\d+\b/gi) ?? [];
  return [...new Set(matches.map((m) => m.toLowerCase()))];
}

