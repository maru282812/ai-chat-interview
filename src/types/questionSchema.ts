/**
 * questionSchema.ts
 * 質問定義基盤の型定義 (Phase 1)
 *
 * 責務分離:
 *   Question           … 質問定義そのもの
 *   DisplayTagsParsed  … タグ表示制御（tagParser が生成）
 *   VisibilityCondition… 設問表示条件（<pipe> の表示用途）
 *   QuestionBranchRule … 進行遷移分岐（既存 domain.ts 側）
 *   QuestionPageGroup  … survey_page モード用ページ
 */

import type { UUID } from "./domain";

// ------------------------------------------------------------------
// Display Mode
// ------------------------------------------------------------------

/** プロジェクト単位の表示モード */
export type DisplayMode = "survey_page" | "survey_question" | "interview_chat";

// ------------------------------------------------------------------
// QuestionType (拡張版)
// ------------------------------------------------------------------

export type QuestionTypeV2 =
  // ---- 既存（後方互換）----
  | "text"
  | "single_select"
  | "multi_select"
  | "yes_no"
  | "scale"
  // ---- 選択系 ----
  | "single_choice"
  | "multi_choice"
  // ---- マトリクス系 ----
  | "matrix_single"
  | "matrix_multi"
  | "matrix_mixed"
  // ---- テキスト系 ----
  | "free_text_short"
  | "free_text_long"
  // ---- 数値 ----
  | "numeric"
  // ---- 画像 ----
  | "image_upload"
  // ---- 隠し項目 ----
  | "hidden_single"
  | "hidden_multi"
  // ---- 画像付きテキスト ----
  | "text_with_image"
  // ---- SD法 ----
  | "sd";

/** マトリクス系かどうか */
export const MATRIX_TYPES: QuestionTypeV2[] = [
  "matrix_single",
  "matrix_multi",
  "matrix_mixed",
];

/** テキスト入力系かどうか */
export const TEXT_INPUT_TYPES: QuestionTypeV2[] = [
  "text",
  "free_text_short",
  "free_text_long",
  "numeric",
];

/** 選択肢を持つ型かどうか */
export const CHOICE_TYPES: QuestionTypeV2[] = [
  "single_select",
  "multi_select",
  "single_choice",
  "multi_choice",
  "yes_no",
  "hidden_single",
  "hidden_multi",
  "text_with_image",
  "sd",
];

export type AnswerOutputType =
  | "text"
  | "number"
  | "boolean"
  | "array"
  | "object"
  | "none";

// ------------------------------------------------------------------
// Tags: 内部構造化表現 (DisplayTagsParsed)
// ------------------------------------------------------------------

/** len= タグの比較演算子付き数値制約 */
export interface LengthRule {
  operator: ">=" | "<=" | "=" | ">" | "<";
  value: number;
}

/** img= タグのデータ */
export interface ImageTagData {
  file: string;
  textPosition?: "top" | "bottom" | "left" | "right" | "none";
}

/** type() タグの入力種別 */
export interface NumericInputType {
  year?: boolean;   // <type(year)>
  jyear?: boolean;  // <type(jyear)>  和暦
  month?: boolean;  // <type(month)>
  day?: boolean;    // <type(day)>
}

/**
 * マトリクス列ごとの設定 (<sa> <ma> <fs=n> <fl=cols,rows>)
 * 列の順番で配列に格納する
 */
export interface MatrixColSetting {
  type: "sa" | "ma" | "free_short" | "free_long";
  label?: string;
  freeSize?: number;   // fs=n
  freeCols?: number;   // fl=cols,rows の cols
  freeRows?: number;   // fl=cols,rows の rows
}

/**
 * <pipe 条件式>
 * 表示制御（設問/選択肢の表示 or 非表示）または進行分岐に使われる
 * 責務: ここでは表示制御用の pipe のみ保存（進行分岐は branch_rule へ）
 */
export interface PipingCondition {
  /** 生の条件式文字列: "( q1=1 and q2=1 ) or q3=2" */
  expression: string;
  /**
   * Phase 2: パース済み AST
   * 現時点では null のままでよい
   */
  parsedAst?: PipingConditionNode | null;
}

/** Phase 2 用 AST ノード（現在は any で拡張予定） */
export type PipingConditionNode =
  | { type: "and"; left: PipingConditionNode; right: PipingConditionNode }
  | { type: "or"; left: PipingConditionNode; right: PipingConditionNode }
  | { type: "not"; operand: PipingConditionNode }
  | { type: "comparison"; questionCode: string; operator: string; value: string | number };

/**
 * <ans q●●>
 * 指定設問の回答を設問文やコメントに差し込む
 */
export interface AnswerInsertion {
  /** 参照元の質問コード: "q1" */
  source: string;
  /** 差し込み先 */
  target:
    | "question_text"
    | "comment_top"
    | "comment_bottom"
    | "choice_label";
  /** target=choice_label のとき: 何番目の選択肢か (0-indexed) */
  choiceIndex?: number;
}

/**
 * <disable 条件>
 * マトリクス系の選択肢/行 を条件によって非表示にする
 */
export interface DisableRule {
  /** 非表示にする選択肢の value */
  targetChoice: string;
  /** 条件式: "q1=1" など */
  condition: string;
}

/**
 * DisplayTagsParsed
 * タグの構造化表現（canonical）
 * raw 文字列は互換用。アプリ内部ではこちらを優先する。
 */
export interface DisplayTagsParsed {
  // ---- 入力サイズ・基本制御 ----
  inputSize?: number;          // <size=n>
  noRepeat?: boolean;          // <norep>
  fixedChoice?: boolean;       // <fix>
  lineBreak?: boolean;         // <br>
  mustInput?: boolean;         // <must>
  exampleInput?: boolean;      // <ex>

  // ---- 入力値制約 ----
  numericOnly?: boolean;              // <n>
  numericDecimalPlaces?: number;      // <n,3> の小数桁数
  alphaNumericOnly?: boolean;         // <al>
  lengthRule?: LengthRule;            // <len=...>
  minValue?: number;                  // <min=n>
  maxValue?: number;                  // <max=n>
  inputCode?: number;                 // <code=n>

  // ---- 入力種別 ----
  inputType?: NumericInputType;       // <type(year)> など

  // ---- テキストエリア寸法 ----
  rows?: number;                      // <rows=n>
  cols?: number;                      // <cols=n>

  // ---- 画像 ----
  image?: ImageTagData;               // <img=file textPosition=...>

  // ---- マトリクス列設定 ----
  matrixColSettings?: MatrixColSetting[];  // <sa> <ma> <fs=n> <fl=c,r>
  beforeText?: string;                // <bf=text>
  afterText?: string;                 // <af=text>

  // ---- 制御タグ ----
  pipingConditions?: PipingCondition[];    // <pipe 条件>  ※表示制御用のみ
  answerInsertions?: AnswerInsertion[];    // <ans q●●>
  disableRules?: DisableRule[];            // <disable 条件>
}

// ------------------------------------------------------------------
// 表示条件 (VisibilityCondition)
// 設問単位の表示可否制御
// ------------------------------------------------------------------

export interface VisibilityCondition {
  type: "pipe_expression";
  /** 条件式が true → 表示 / false → 非表示 */
  expression: string;
  /** Phase 2: パース済み AST */
  parsedAst?: PipingConditionNode | null;
}

// ------------------------------------------------------------------
// Tag Validation
// ------------------------------------------------------------------

export type TagValidationSeverity = "error" | "warning";

export interface TagValidationError {
  code: string;
  message: string;
  severity: TagValidationSeverity;
  tagName?: string;
  detail?: string;
}

export interface TagParserResult {
  parsed: DisplayTagsParsed;
  errors: TagValidationError[];
  warnings: TagValidationError[];
  /** parsed から再生成した raw 文字列（フォーム → raw の確認用） */
  rawGenerated: string;
}

// ------------------------------------------------------------------
// QuestionPageGroup (survey_page モード用)
// ------------------------------------------------------------------

export interface QuestionPageGroup {
  id: UUID;
  project_id: UUID;
  page_number: number;
  title: string | null;
  description: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

// ------------------------------------------------------------------
// 拡張 Question フィールド（domain.ts の Question に追加する分）
// ------------------------------------------------------------------

/**
 * QuestionV2Fields
 * domain.ts の Question に追加される新フィールド
 * 移行期間中は既存 Question と intersection して使う
 */
export interface QuestionV2Fields {
  comment_top: string | null;
  comment_bottom: string | null;
  answer_output_type: AnswerOutputType | null;
  display_tags_raw: string | null;
  display_tags_parsed: DisplayTagsParsed | null;
  visibility_conditions: VisibilityCondition[] | null;
  page_group_id: UUID | null;
}

// ------------------------------------------------------------------
// LIFF レンダリングエンジン用 コンテキスト型
// ------------------------------------------------------------------

/** 現在の回答収集状態 */
export interface AnswerContext {
  /** question_code → 回答値 */
  answers: Record<string, string | string[] | number | null>;
}

/** pipe 条件式の評価結果 */
export interface PipeEvalResult {
  visible: boolean;
  reason?: string;
}

/** ページ単位でグループ化した質問リスト */
export interface QuestionPage {
  pageGroup: QuestionPageGroup | null;
  questions: Array<{
    question_code: string;
    question_text: string;
    question_type: QuestionTypeV2;
    is_required: boolean;
    display_tags_parsed: DisplayTagsParsed | null;
    visibility_conditions: VisibilityCondition[] | null;
    [key: string]: unknown;
  }>;
}
