import type { LegacyBranchRule, Question, QuestionBranchRule } from "../types/domain";
import { deriveVariableDefinition } from "./codebook";

/**
 * surveyValidation.ts
 *
 * 送付前バリデーション（純関数）。改修指示の以下に対応:
 *  §4 設問間依存（answer_reference / display_logic / branch_logic / piping / analysis_dependency）
 *  §5 文言整合性（順序依存の文言とランダム化/依存順の矛盾検出）
 *  §6 送付前バリデーション（code一意・変数名重複・依存先存在・循環依存・分岐先存在・
 *     表示条件参照先存在・依存順・選択肢value安定・クリーニングメタ最低限）
 *  §13 受け入れ条件（Aに依存するBをB→A順にできない＝マスター順が逆なら error）
 *
 * DB追加なし。branch_rule / visibility_conditions / display_tags_parsed / question_config から
 * 依存関係を導出して検査する。
 */

export type DependencyType =
  | "answer_reference"
  | "wording_reference"
  | "display_logic"
  | "branch_logic"
  | "piping"
  | "analysis_dependency";

/** 表示順の前後関係を要求する依存タイプ（source は dependent より前に出る必要がある）。 */
const ORDERING_TYPES: DependencyType[] = [
  "answer_reference",
  "wording_reference",
  "display_logic",
  "piping",
  "analysis_dependency"
];

export interface DependencyEdge {
  /** 依存している側（後に来るべき設問） */
  from: string;
  /** 依存先（先に来るべき設問） */
  to: string;
  type: DependencyType;
}

export interface ValidationFinding {
  level: "error" | "warning";
  code: string;
  message: string;
  question_code?: string;
}

export interface ValidationReport {
  ok: boolean;
  errorCount: number;
  warningCount: number;
  dependencies: DependencyEdge[];
  findings: ValidationFinding[];
}

/** 順序依存を示唆する日本語の語句（§5） */
const ORDER_DEPENDENT_PHRASES = [
  "前の質問",
  "前問",
  "先ほど",
  "先程",
  "さきほど",
  "先のご回答",
  "上記",
  "前述",
  "を踏まえ",
  "を参考に",
  "に基づいて",
  "で答えた"
];

function normalizeCode(code: string): string {
  return code.trim().toLowerCase();
}

/** pipe/条件式から参照されている設問コードを抽出する（"q1=1 and q2=2" → ["q1","q2"]）。 */
function extractCodeTokens(expression: string | null | undefined): string[] {
  if (!expression) {
    return [];
  }
  return Array.from(expression.matchAll(/q\d+\w*/gi)).map((match) => normalizeCode(match[0]));
}

function branchTargets(question: Question): string[] {
  const rule = question.branch_rule;
  if (!rule) {
    return [];
  }
  if (Array.isArray(rule)) {
    return (rule as LegacyBranchRule[]).map((entry) => entry.targetQuestionCode).filter(Boolean);
  }
  const objectRule = rule as QuestionBranchRule;
  const targets: string[] = [];
  for (const branch of objectRule.branches ?? []) {
    if (branch.next) {
      targets.push(branch.next);
    }
  }
  if (objectRule.default_next) {
    targets.push(objectRule.default_next);
  }
  if (objectRule.merge_question_code) {
    targets.push(objectRule.merge_question_code);
  }
  return targets;
}

interface ExplicitDependency {
  source_question_code: string;
  type?: DependencyType;
}

/** question_config.meta.dependencies（任意・将来の明示登録用）を読み取る。 */
function explicitDependencies(question: Question): ExplicitDependency[] {
  const meta = question.question_config?.meta as Record<string, unknown> | undefined;
  const deps = meta?.dependencies;
  return Array.isArray(deps) ? (deps as ExplicitDependency[]) : [];
}

/** 1設問が参照する依存エッジ（自身=from, 参照先=to）を導出する。 */
function deriveEdges(question: Question): DependencyEdge[] {
  const self = normalizeCode(question.question_code);
  const edges: DependencyEdge[] = [];
  const push = (to: string, type: DependencyType) => {
    const target = normalizeCode(to);
    if (target && target !== self) {
      edges.push({ from: self, to: target, type });
    }
  };

  // 明示登録 (§4)
  for (const dep of explicitDependencies(question)) {
    push(dep.source_question_code, dep.type ?? "analysis_dependency");
  }

  // 分岐 (branch_logic) — 存在チェック用
  for (const target of branchTargets(question)) {
    push(target, "branch_logic");
  }

  // 表示条件 (display_logic)
  for (const condition of question.visibility_conditions ?? []) {
    for (const token of extractCodeTokens(condition.expression)) {
      push(token, "display_logic");
    }
  }

  // タグ由来: piping / answer insertion / disable
  const tags = question.display_tags_parsed;
  if (tags) {
    for (const piping of tags.pipingConditions ?? []) {
      for (const token of extractCodeTokens(piping.expression)) {
        push(token, "piping");
      }
    }
    for (const insertion of tags.answerInsertions ?? []) {
      push(insertion.source, "answer_reference");
    }
    for (const disable of tags.disableRules ?? []) {
      for (const token of extractCodeTokens(disable.condition)) {
        push(token, "display_logic");
      }
    }
  }

  return edges;
}

/**
 * ランダム化が壊してはならない順序制約エッジ（from は to より後に表示される必要がある）を抽出する。
 * branch_logic は順序制約に含めない（分岐先は前後どちらでもよい）。
 */
export function extractOrderingEdges(questions: Question[]): Array<{ from: string; to: string }> {
  return questions
    .filter((question) => !question.is_system)
    .flatMap((question) => deriveEdges(question))
    .filter((edge) => ORDERING_TYPES.includes(edge.type))
    .map((edge) => ({ from: edge.from, to: edge.to }));
}

function hasOrderDependentWording(question: Question): boolean {
  const text = `${question.question_text ?? ""}${question.comment_top ?? ""}${question.comment_bottom ?? ""}`;
  return ORDER_DEPENDENT_PHRASES.some((phrase) => text.includes(phrase));
}

/** 順序依存エッジのみで循環依存を検出する（dependent -> source の有向グラフ）。 */
function findCycle(edges: DependencyEdge[]): string[] | null {
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    if (!ORDERING_TYPES.includes(edge.type)) {
      continue;
    }
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }

  const visited = new Set<string>();
  const stack = new Set<string>();
  const path: string[] = [];

  const dfs = (node: string): string[] | null => {
    visited.add(node);
    stack.add(node);
    path.push(node);
    for (const next of adjacency.get(node) ?? []) {
      if (stack.has(next)) {
        return [...path.slice(path.indexOf(next)), next];
      }
      if (!visited.has(next)) {
        const found = dfs(next);
        if (found) {
          return found;
        }
      }
    }
    stack.delete(node);
    path.pop();
    return null;
  };

  for (const node of adjacency.keys()) {
    if (!visited.has(node)) {
      const cycle = dfs(node);
      if (cycle) {
        return cycle;
      }
    }
  }
  return null;
}

/**
 * 送付前バリデーション本体。error が 1件もなければ ok=true。
 */
export function validateSurvey(questions: Question[]): ValidationReport {
  const findings: ValidationFinding[] = [];
  const activeQuestions = questions.filter((question) => !question.is_system);

  const codeToQuestion = new Map<string, Question>();
  const orderByCode = new Map<string, number>();

  // §6 question_code 一意性
  const codeCounts = new Map<string, number>();
  for (const question of activeQuestions) {
    const code = normalizeCode(question.question_code);
    codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
    codeToQuestion.set(code, question);
    orderByCode.set(code, question.sort_order);
  }
  for (const [code, count] of codeCounts) {
    if (count > 1) {
      findings.push({
        level: "error",
        code: "duplicate_question_code",
        message: `question_code が重複しています: ${code}（${count}件）`,
        question_code: code
      });
    }
  }

  // §6 出力変数名 重複
  const variableNames = new Map<string, string[]>();
  for (const question of activeQuestions) {
    const variable = deriveVariableDefinition(question);
    const list = variableNames.get(variable.variable_name) ?? [];
    list.push(question.question_code);
    variableNames.set(variable.variable_name, list);

    // §6 クリーニングメタ最低限: 選択系で選択肢が空
    if (
      (variable.data_type === "categorical" || variable.data_type === "categorical_multi") &&
      variable.allowed_values.length === 0
    ) {
      findings.push({
        level: "warning",
        code: "missing_options",
        message: `選択式設問に選択肢(allowed_values)が設定されていません: ${question.question_code}`,
        question_code: question.question_code
      });
    }

    // §6 選択肢 value の安定性: 空 value / 重複 value
    const values = variable.allowed_values.map((option) => option.value);
    if (values.some((value) => !value || !value.trim())) {
      findings.push({
        level: "error",
        code: "empty_option_value",
        message: `空の選択肢 value があります: ${question.question_code}`,
        question_code: question.question_code
      });
    }
    if (new Set(values).size !== values.length) {
      findings.push({
        level: "error",
        code: "duplicate_option_value",
        message: `選択肢 value が重複しています: ${question.question_code}`,
        question_code: question.question_code
      });
    }
  }
  for (const [name, codes] of variableNames) {
    if (codes.length > 1) {
      findings.push({
        level: "error",
        code: "duplicate_variable_name",
        message: `出力変数名が重複しています: ${name}（${codes.join(", ")}）`
      });
    }
  }

  // 依存エッジ導出
  const allEdges = activeQuestions.flatMap((question) => deriveEdges(question));

  // §6 依存先・分岐先・表示条件参照先の存在
  for (const edge of allEdges) {
    if (!codeToQuestion.has(edge.to)) {
      findings.push({
        level: "error",
        code: edge.type === "branch_logic" ? "branch_target_not_found" : "dependency_target_not_found",
        message: `${edge.type} の参照先 ${edge.to} が存在しません（${edge.from} から参照）`,
        question_code: edge.from
      });
    }
  }

  // §4/§13 依存順: source は dependent より前のマスター順でなければならない
  for (const edge of allEdges) {
    if (!ORDERING_TYPES.includes(edge.type)) {
      continue;
    }
    const fromOrder = orderByCode.get(edge.from);
    const toOrder = orderByCode.get(edge.to);
    if (fromOrder === undefined || toOrder === undefined) {
      continue;
    }
    if (toOrder >= fromOrder) {
      findings.push({
        level: "error",
        code: "dependency_order_violation",
        message: `${edge.from} は ${edge.to}（${edge.type}）に依存していますが、マスター順が ${edge.to} より前または同位です。ランダム化しても依存順が壊れます。`,
        question_code: edge.from
      });
    }
  }

  // §6 循環依存
  const cycle = findCycle(allEdges);
  if (cycle) {
    findings.push({
      level: "error",
      code: "circular_dependency",
      message: `循環依存を検出しました: ${cycle.join(" -> ")}`
    });
  }

  // §5 文言整合性: 順序依存の文言があるのに依存未宣言
  const orderingFromCodes = new Set(
    allEdges.filter((edge) => ORDERING_TYPES.includes(edge.type)).map((edge) => edge.from)
  );
  for (const question of activeQuestions) {
    if (hasOrderDependentWording(question) && !orderingFromCodes.has(normalizeCode(question.question_code))) {
      findings.push({
        level: "warning",
        code: "wording_dependency_undeclared",
        message: `「前の質問」「上記」等の順序依存の文言がありますが依存関係が未宣言です。依存登録するかランダム化対象から外してください: ${question.question_code}`,
        question_code: question.question_code
      });
    }
  }

  const errorCount = findings.filter((finding) => finding.level === "error").length;
  const warningCount = findings.filter((finding) => finding.level === "warning").length;

  return {
    ok: errorCount === 0,
    errorCount,
    warningCount,
    dependencies: allEdges,
    findings
  };
}
