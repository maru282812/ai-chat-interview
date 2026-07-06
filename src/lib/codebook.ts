import type { Question, QuestionConfig, QuestionOption, QuestionType } from "../types/domain";

/**
 * codebook.ts
 *
 * 統計・外部集計ソフト投入のための「変数定義（コードブック）」を設問から導出する純関数群。
 * 改修指示 §7（クリーニング用メタデータ）/ §20（欠損値センチネルと値ラベル）に対応。
 *
 * - DBマイグレーション不要。既存の question_type / question_config から既定値を導出する。
 * - 管理者による上書きは question_config.meta.cleaning（任意）から読み取る。
 * - ここでは「列の意味」だけを定義する。実値の展開は statExport.ts が行う。
 */

/** 統計上のデータ型 */
export type CodebookDataType =
  | "text"
  | "integer"
  | "decimal"
  | "boolean"
  | "categorical"
  | "categorical_multi"
  | "datetime"
  | "json";

/** 尺度水準 (measure type) */
export type CodebookMeasureType = "nominal" | "ordinal" | "scale" | "text";

/** 多重選択のエンコード方式 (§15) */
export type MultiSelectEncoding = "one_hot" | "delimited" | "count" | "none";

/** 集計方針 */
export type AggregationPolicy =
  | "frequency"
  | "multiple_response"
  | "mean_distribution"
  | "qualitative"
  | "matrix"
  | "none";

/** 自由記述の扱い */
export type FreeTextPolicy = "not_applicable" | "verbatim" | "verbatim_then_code";

/**
 * 回答状態 (§7)。実回答に対する「非実質回答」区分。
 * answered 以外は欠損コードに対応する。
 */
export type ResponseState =
  | "answered"
  | "no_answer" // 無回答
  | "dont_know" // 不明
  | "refused" // 回答拒否
  | "not_applicable" // 対象外
  | "screened_out" // スクリーニング落ち
  | "hidden_by_branch" // 分岐により非表示
  | "not_reached"; // システム上未到達

export interface MissingValueCode {
  state: Exclude<ResponseState, "answered">;
  /** 統計ソフト取込用センチネル値（数値型変数に使う） */
  code: string;
  /** 値ラベル */
  label: string;
}

/**
 * 欠損値センチネルの既定対応表 (§20)。
 * SPSS 等が欠損として扱える数値コードを既定で割り当てる。設定で上書き可能にする想定。
 */
export const DEFAULT_MISSING_CODES: Record<Exclude<ResponseState, "answered">, MissingValueCode> = {
  no_answer: { state: "no_answer", code: ".", label: "無回答" },
  dont_know: { state: "dont_know", code: "99", label: "不明" },
  refused: { state: "refused", code: "98", label: "回答拒否" },
  not_applicable: { state: "not_applicable", code: "97", label: "対象外" },
  screened_out: { state: "screened_out", code: "96", label: "スクリーニング落ち" },
  hidden_by_branch: { state: "hidden_by_branch", code: "95", label: "分岐により非表示" },
  not_reached: { state: "not_reached", code: "94", label: "システム上未到達" }
};

/** テキスト型変数のシステム欠損マーカー（数値センチネルが無意味なため空欄を使う） */
export const TEXT_MISSING_MARKER = "";

export interface CodebookOption {
  /** 安定コード (§15)。label を変えても不変。既定は option.value。 */
  option_code: string;
  value: string;
  label: string;
  /** 順序尺度の場合の順位（scale/sd など）。なければ null。 */
  ordinal: number | null;
}

/** 管理者による上書き（question_config.meta.cleaning） */
export interface CleaningOverride {
  variable_name?: string;
  data_type?: CodebookDataType;
  measure_type?: CodebookMeasureType;
  multi_select_encoding?: MultiSelectEncoding;
  free_text_policy?: FreeTextPolicy;
  aggregation_policy?: AggregationPolicy;
  missing_value_policy?: string;
  cleaning_note?: string;
}

export interface VariableDefinition {
  question_id: string;
  question_code: string;
  /** 統計ソフト向け変数名（識別子として安全化済み） */
  variable_name: string;
  question_text: string;
  question_type: QuestionType;
  question_role: string;
  /** 送付時マスター順の基準（§2）。既定は sort_order。 */
  master_order: number;
  /** ブロック（§3）。現状は page_group_id を初期ブロック候補として扱う（§12）。 */
  block_code: string | null;
  data_type: CodebookDataType;
  measure_type: CodebookMeasureType;
  allowed_values: CodebookOption[];
  multi_select_encoding: MultiSelectEncoding;
  free_text_policy: FreeTextPolicy;
  aggregation_policy: AggregationPolicy;
  missing_value_policy: string;
  missing_codes: MissingValueCode[];
  /** 数値・尺度設問の範囲 */
  scale_min: number | null;
  scale_max: number | null;
  is_required: boolean;
  ai_probe_enabled: boolean;
  cleaning_note: string;
  /** 共通指標コード（横断集計キー）。未設定は空文字（§土台①）。 */
  metric_code: string;
  /** 指標の集計方向。未設定は空文字。 */
  metric_direction: string;
}

const CATEGORICAL_SINGLE: QuestionType[] = ["single_choice", "single_select", "hidden_single", "yes_no"];
const CATEGORICAL_MULTI: QuestionType[] = ["multi_choice", "multi_select", "hidden_multi"];
const NUMERIC_TYPES: QuestionType[] = ["numeric", "scale", "sd"];
const TEXT_TYPES: QuestionType[] = ["text", "free_text_short", "free_text_long", "text_with_image"];
const MATRIX_TYPES: QuestionType[] = ["matrix_single", "matrix_multi", "matrix_mixed"];

/** 変数名を統計ソフトが受け付ける識別子へ安全化する。 */
export function sanitizeVariableName(code: string): string {
  const cleaned = (code ?? "")
    .trim()
    .replace(/^_+|_+$/g, "") // 前後のアンダースコア（__free_comment__ など）を除去
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_");
  const safe = cleaned || "var";
  // 先頭が数字の場合は識別子として無効なので接頭辞を付ける
  return /^[0-9]/.test(safe) ? `q_${safe}` : safe;
}

function getCleaningOverride(config: QuestionConfig | null): CleaningOverride {
  const meta = config?.meta as Record<string, unknown> | undefined;
  const cleaning = meta?.cleaning;
  return cleaning && typeof cleaning === "object" ? (cleaning as CleaningOverride) : {};
}

function buildOptions(config: QuestionConfig | null, ordered: boolean): CodebookOption[] {
  const options: QuestionOption[] = config?.options ?? [];
  return options.map((option, index) => ({
    option_code: option.value,
    value: option.value,
    label: option.label ?? option.value,
    ordinal: ordered ? index + 1 : null
  }));
}

function defaultDataType(type: QuestionType): CodebookDataType {
  if (type === "yes_no") {
    return "boolean";
  }
  if (CATEGORICAL_SINGLE.includes(type)) {
    return "categorical";
  }
  if (CATEGORICAL_MULTI.includes(type)) {
    return "categorical_multi";
  }
  if (NUMERIC_TYPES.includes(type)) {
    return "integer";
  }
  if (TEXT_TYPES.includes(type)) {
    return "text";
  }
  if (MATRIX_TYPES.includes(type)) {
    return "json";
  }
  if (type === "image_upload") {
    return "json";
  }
  return "text";
}

function defaultMeasureType(type: QuestionType, hasScaleLabels: boolean): CodebookMeasureType {
  if (type === "scale" || type === "sd") {
    return "ordinal";
  }
  if (type === "numeric") {
    return "scale";
  }
  if (TEXT_TYPES.includes(type)) {
    return "text";
  }
  if (hasScaleLabels && CATEGORICAL_SINGLE.includes(type)) {
    return "ordinal";
  }
  return "nominal";
}

function defaultAggregation(dataType: CodebookDataType, type: QuestionType): AggregationPolicy {
  if (MATRIX_TYPES.includes(type)) {
    return "matrix";
  }
  switch (dataType) {
    case "categorical":
    case "boolean":
      return "frequency";
    case "categorical_multi":
      return "multiple_response";
    case "integer":
    case "decimal":
      return "mean_distribution";
    case "text":
      return "qualitative";
    default:
      return "none";
  }
}

function defaultFreeTextPolicy(type: QuestionType): FreeTextPolicy {
  return TEXT_TYPES.includes(type) ? "verbatim_then_code" : "not_applicable";
}

/**
 * 1設問から統計用の変数定義を導出する。
 * 既定値は question_type / question_config から導出し、meta.cleaning があれば上書きする。
 */
export function deriveVariableDefinition(question: Question): VariableDefinition {
  const config = question.question_config;
  const override = getCleaningOverride(config);
  const type = question.question_type;
  const isOrdered = type === "scale" || type === "sd";
  const scaleLabels = config?.scaleLabels ?? null;
  const hasScaleLabels = Boolean(scaleLabels && Object.keys(scaleLabels).length > 0);

  const dataType = override.data_type ?? defaultDataType(type);
  const measureType = override.measure_type ?? defaultMeasureType(type, hasScaleLabels);

  const multiSelectEncoding: MultiSelectEncoding =
    override.multi_select_encoding ?? (dataType === "categorical_multi" ? "one_hot" : "none");

  const scaleMin = config?.scaleMin ?? config?.min ?? null;
  const scaleMax = config?.scaleMax ?? config?.max ?? null;

  return {
    question_id: question.id,
    question_code: question.question_code,
    variable_name: override.variable_name
      ? sanitizeVariableName(override.variable_name)
      : sanitizeVariableName(question.question_code),
    question_text: question.question_text,
    question_type: type,
    question_role: question.question_role,
    master_order: question.sort_order,
    block_code: question.page_group_id ?? null,
    data_type: dataType,
    measure_type: measureType,
    allowed_values: buildOptions(config, isOrdered),
    multi_select_encoding: multiSelectEncoding,
    free_text_policy: override.free_text_policy ?? defaultFreeTextPolicy(type),
    aggregation_policy: override.aggregation_policy ?? defaultAggregation(dataType, type),
    missing_value_policy: override.missing_value_policy ?? "standard_sentinels",
    missing_codes: Object.values(DEFAULT_MISSING_CODES),
    scale_min: typeof scaleMin === "number" ? scaleMin : null,
    scale_max: typeof scaleMax === "number" ? scaleMax : null,
    is_required: question.is_required,
    ai_probe_enabled: question.ai_probe_enabled,
    cleaning_note: override.cleaning_note ?? "",
    metric_code: config?.meta?.metric_code ?? "",
    metric_direction: config?.meta?.metric_direction ?? ""
  };
}

/** プロジェクトの全設問から変数定義をマスター順で導出する。 */
export function deriveCodebook(questions: Question[]): VariableDefinition[] {
  return [...questions]
    .sort((left, right) => left.sort_order - right.sort_order)
    .map((question) => deriveVariableDefinition(question));
}
