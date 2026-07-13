import type { Question, QuestionOption } from "../types/domain";
import {
  DEFAULT_MISSING_CODES,
  type ResponseState,
  type VariableDefinition
} from "./codebook";
import {
  type CellValue,
  type ExportAnswerGroup,
  type ExportRespondent,
  type ExportRow,
  determineResponseState,
  finalAnswerText,
  getNumericValue,
  getSelected,
  probeQuestionText,
  probeReason
} from "./statExport";

/**
 * rawdataExport.ts
 *
 * Freeasy水準のロウデータ出力（純関数）。docs/plan-rawdata-export.md 準拠。
 * 既存の respondents_wide / answers_long / codebook は凍結契約のため一切触らず、
 * ここで新しい列体系（Freeasy式命名）を別ファイルとして生成する。
 *
 * 列命名:
 *  - メタ: MID / START / END / TIME / TIME_SEC / STA / SURVEY_VERSION / IS_TEST / CHANNEL
 *  - SA:  q{n}（コード=選択肢の1始まり位置 / label時はラベル）
 *  - MA:  q{n}c{k}（0/1 フラグ・k=選択肢位置）
 *  - 自由記述・その他: q{n}t1
 *  - マトリクス: q{n}s{j}（single行）/ q{n}s{j}c{k}（multi/mixed行）
 *  - 設問別回答時刻: q{n}_datetime
 *  - AI深掘り（独自）: q{n}_final_answer_text / q{n}_probe_count / q{n}_probe_reason / q{n}_probe_answers
 *  - 属性（末尾）: SEX / AGE / AGE_BAND / PRE / REGION / JOB / BUS / MAR / INC / CHI / RANK
 *
 * q番号は変数の master_order 昇順で 1 から採番する（スナップショット確定後に安定）。
 * 列の意味は buildRawdataLayoutRows の対応表（rawdata-layout.csv）で必ず引ける。
 */

// ============================================================
// 型
// ============================================================

export interface RawdataProfileInput {
  gender: string | null;
  birth_date: string | null;
  prefecture: string | null;
  occupation: string | null;
  industry: string | null;
  marital_status: string | null;
  has_children: boolean | null;
  /** 世帯年収コード（migration 078・INCOME_CODES が正）。 */
  household_income?: string | null;
}

/** ExportRespondent に属性を付けた拡張（wide/long は profile を読まないため凍結契約に影響しない）。 */
export interface RawdataRespondent extends ExportRespondent {
  profile?: RawdataProfileInput | null;
  /** 回答環境（sessions.user_agent / ip_address・migration 078・LIFF セッションのみ）。 */
  user_agent?: string | null;
  ip_address?: string | null;
  /** 出力時点の現在ランク（user_ranks が正準・回答完了時点ではない）。RANK 列の元。 */
  rank_code?: string | null;
  rank_name?: string | null;
  /** 回答した調査票スナップショットの版数（sessions.snapshot_id 由来・migration 068）。 */
  snapshot_version?: number | null;
}

export type RawdataMode = "code" | "label";

/** ロウデータ出力の既定ステータス。未完了の裁定は集計アプリ側で行うため既定で含める。 */
export const DEFAULT_RAWDATA_STATUSES = ["completed", "partial", "abandoned"];

export interface RawdataOptions {
  /** コード出力 / 回答値（ラベル）出力。既定 code。 */
  mode?: RawdataMode;
  /** 含める response_status。既定 DEFAULT_RAWDATA_STATUSES（画面の件数パネルで手動選択）。 */
  statuses?: string[];
  /** AI深掘り統合列を含める。既定 true。 */
  includeProbe?: boolean;
  /** テスト回答を除外。既定 true。 */
  excludeTest?: boolean;
  /** UserAgent / IPAddress を含める（不正検出用）。既定 false（個人情報の最小化）。 */
  includePii?: boolean;
}

type ColumnKind =
  | "sa"
  | "ma_flag"
  | "free_text"
  | "numeric"
  | "matrix_sa"
  | "matrix_flag"
  | "raw_json"
  | "datetime"
  | "probe_final_text"
  | "probe_count"
  | "probe_reason"
  | "probe_answers";

interface ColumnSpec {
  name: string;
  kind: ColumnKind;
  /** 選択肢（1始まり位置）。ma_flag / matrix_flag / sa のコード表に使う。 */
  optionIndex?: number;
  option?: { value: string; label: string };
  /** マトリクス行（1始まり）。 */
  rowIndex?: number;
  rowLabel?: string;
}

export interface QAssignment {
  qNumber: number;
  variable: VariableDefinition;
  question: Question | null;
  columns: ColumnSpec[];
}

// ============================================================
// 採番と列仕様
// ============================================================

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function normalizeOption(raw: unknown, index: number): { value: string; label: string } {
  if (typeof raw === "string") {
    return { value: String(index + 1), label: raw };
  }
  const record = asRecord(raw);
  const label = typeof record.label === "string" ? record.label : String(record.value ?? index + 1);
  const value = typeof record.value === "string" ? record.value : String(index + 1);
  return { value, label };
}

/** マトリクス行（matrix_rows は型未定義のため config 直読み・無ければ options を行として扱う）。 */
function matrixRows(question: Question | null): { value: string; label: string }[] {
  const config = asRecord(question?.question_config);
  const rows = Array.isArray(config.matrix_rows) ? config.matrix_rows : (question?.question_config?.options ?? []);
  return rows.map((row: unknown, index: number) => normalizeOption(row, index));
}

function matrixCols(question: Question | null): { value: string; label: string }[] {
  const cols: (QuestionOption | string)[] = question?.question_config?.matrix_cols ?? [];
  return cols.map((col, index) => normalizeOption(col, index));
}

const MATRIX_TYPES = new Set(["matrix_single", "matrix_multi", "matrix_mixed"]);

function hasFreeTextOption(variable: VariableDefinition, question: Question | null): boolean {
  if (variable.free_text_policy !== "not_applicable") {
    return true;
  }
  return (question?.question_config?.options ?? []).some((option) => option.allow_free_text);
}

function buildColumns(qNumber: number, variable: VariableDefinition, question: Question | null, includeProbe: boolean): ColumnSpec[] {
  const q = `q${qNumber}`;
  const columns: ColumnSpec[] = [];

  if (MATRIX_TYPES.has(variable.question_type) && matrixCols(question).length > 0) {
    const rows = matrixRows(question);
    const cols = matrixCols(question);
    const isSingle = variable.question_type === "matrix_single";
    rows.forEach((row, rowIdx) => {
      if (isSingle) {
        columns.push({ name: `${q}s${rowIdx + 1}`, kind: "matrix_sa", rowIndex: rowIdx + 1, rowLabel: row.label });
      } else {
        cols.forEach((col, colIdx) => {
          columns.push({
            name: `${q}s${rowIdx + 1}c${colIdx + 1}`,
            kind: "matrix_flag",
            rowIndex: rowIdx + 1,
            rowLabel: row.label,
            optionIndex: colIdx + 1,
            option: col
          });
        });
      }
    });
  } else if (variable.data_type === "categorical_multi") {
    variable.allowed_values.forEach((option, index) => {
      columns.push({
        name: `${q}c${index + 1}`,
        kind: "ma_flag",
        optionIndex: index + 1,
        option: { value: option.option_code, label: option.label }
      });
    });
    columns.push({ name: `${q}t1`, kind: "free_text" });
  } else if (variable.data_type === "categorical" || variable.data_type === "boolean") {
    columns.push({ name: q, kind: "sa" });
    if (hasFreeTextOption(variable, question)) {
      columns.push({ name: `${q}t1`, kind: "free_text" });
    }
  } else if (variable.data_type === "integer" || variable.data_type === "decimal") {
    columns.push({ name: q, kind: "numeric" });
  } else if (variable.data_type === "text") {
    columns.push({ name: `${q}t1`, kind: "free_text" });
  } else {
    // json（マトリクス設定不備・image_upload 等）は生値1列
    columns.push({ name: q, kind: "raw_json" });
  }

  columns.push({ name: `${q}_datetime`, kind: "datetime" });

  if (includeProbe && variable.ai_probe_enabled) {
    columns.push({ name: `${q}_final_answer_text`, kind: "probe_final_text" });
    columns.push({ name: `${q}_probe_count`, kind: "probe_count" });
    columns.push({ name: `${q}_probe_reason`, kind: "probe_reason" });
    columns.push({ name: `${q}_probe_answers`, kind: "probe_answers" });
  }

  return columns;
}

/** master_order 昇順で q1..qN を採番し、各設問の列仕様を確定する。 */
export function assignQNumbers(
  variables: VariableDefinition[],
  questions: Question[],
  options: { includeProbe?: boolean } = {}
): QAssignment[] {
  const includeProbe = options.includeProbe ?? true;
  const questionById = new Map(questions.map((question) => [question.id, question]));
  return [...variables]
    .sort((left, right) => left.master_order - right.master_order)
    .map((variable, index) => {
      const question = questionById.get(variable.question_id) ?? null;
      return {
        qNumber: index + 1,
        variable,
        question,
        columns: buildColumns(index + 1, variable, question, includeProbe)
      };
    });
}

// ============================================================
// 値の展開
// ============================================================

function sentinel(state: ResponseState, textColumn: boolean): CellValue {
  if (state === "answered") {
    return null;
  }
  return textColumn ? "" : DEFAULT_MISSING_CODES[state as Exclude<ResponseState, "answered">].code;
}

/** マトリクス回答のパース（answer_text に {行index: 列index|[列index...]} のJSON文字列）。 */
function parseMatrixAnswer(answer: string): Record<string, number | number[]> | null {
  try {
    const parsed = JSON.parse(answer);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, number | number[]>;
    }
  } catch {
    // 旧形式・自由入力等でパース不能な場合は欠損扱い（answers_long で原文参照可能）
  }
  return null;
}

function saValue(group: ExportAnswerGroup, variable: VariableDefinition, mode: RawdataMode): CellValue {
  const primary = group.primaryAnswer;
  if (!primary) {
    return null;
  }
  const selected = getSelected(primary, variable);
  const code = selected.codes[0];
  if (code === undefined) {
    return mode === "label" ? primary.answer_text : "";
  }
  const index = variable.allowed_values.findIndex((option) => option.option_code === code);
  if (index < 0) {
    return mode === "label" ? code : "";
  }
  return mode === "label" ? variable.allowed_values[index]!.label : index + 1;
}

function writeQuestionCells(
  row: ExportRow,
  assignment: QAssignment,
  group: ExportAnswerGroup,
  state: ResponseState,
  mode: RawdataMode
): void {
  const { variable } = assignment;
  const primary = group.primaryAnswer;
  const selected = primary && state === "answered" ? getSelected(primary, variable) : { codes: [], otherText: null };
  const matrix = primary && state === "answered" ? parseMatrixAnswer(primary.answer_text) : null;
  const cols = matrixCols(assignment.question);

  for (const column of assignment.columns) {
    switch (column.kind) {
      case "sa":
        row[column.name] = state === "answered" ? saValue(group, variable, mode) : sentinel(state, false);
        break;
      case "ma_flag": {
        if (state !== "answered") {
          row[column.name] = sentinel(state, false);
          break;
        }
        const optionCode = variable.allowed_values[column.optionIndex! - 1]?.option_code;
        row[column.name] = optionCode !== undefined && selected.codes.includes(optionCode) ? 1 : 0;
        break;
      }
      case "free_text": {
        if (state !== "answered") {
          row[column.name] = "";
          break;
        }
        if (variable.data_type === "text") {
          row[column.name] = primary?.answer_text ?? "";
        } else {
          row[column.name] = selected.otherText ?? primary?.free_text_answer ?? "";
        }
        break;
      }
      case "numeric":
        row[column.name] = state === "answered" && primary ? getNumericValue(primary) : sentinel(state, false);
        break;
      case "matrix_sa": {
        if (state !== "answered" || !matrix) {
          row[column.name] = sentinel(state === "answered" ? "no_answer" : state, false);
          break;
        }
        const value = matrix[String(column.rowIndex! - 1)];
        const colIdx = Array.isArray(value) ? value[0] : value;
        if (colIdx === undefined || colIdx === null || Number.isNaN(Number(colIdx))) {
          row[column.name] = "";
        } else {
          const idx = Number(colIdx);
          row[column.name] = mode === "label" ? (cols[idx]?.label ?? String(idx + 1)) : idx + 1;
        }
        break;
      }
      case "matrix_flag": {
        if (state !== "answered" || !matrix) {
          row[column.name] = sentinel(state === "answered" ? "no_answer" : state, false);
          break;
        }
        const value = matrix[String(column.rowIndex! - 1)];
        const selectedCols = Array.isArray(value) ? value.map(Number) : value === undefined || value === null ? [] : [Number(value)];
        row[column.name] = selectedCols.includes(column.optionIndex! - 1) ? 1 : 0;
        break;
      }
      case "raw_json":
        row[column.name] = state === "answered" ? (primary?.answer_text ?? "") : "";
        break;
      case "datetime":
        row[column.name] = primary?.created_at ?? "";
        break;
      case "probe_final_text":
        row[column.name] = finalAnswerText(group);
        break;
      case "probe_count":
        row[column.name] = group.probeAnswers.length;
        break;
      case "probe_reason":
        row[column.name] = probeReason(group);
        break;
      case "probe_answers":
        row[column.name] = JSON.stringify(
          group.probeAnswers.map((probe) => ({ question: probeQuestionText(probe), answer: probe.answer_text }))
        );
        break;
    }
  }
}

// ============================================================
// 属性列（SEX / AGE / PRE / JOB / BUS / MAR / CHI）
// ============================================================

export const SEX_CODES: Record<string, { code: number; label: string }> = {
  male: { code: 1, label: "男性" },
  female: { code: 2, label: "女性" },
  other: { code: 3, label: "その他" },
  prefer_not_to_say: { code: 9, label: "回答しない" }
};

export const MARITAL_CODES: Record<string, { code: number; label: string }> = {
  single: { code: 1, label: "未婚" },
  married: { code: 2, label: "既婚" },
  divorced: { code: 3, label: "離別" },
  widowed: { code: 4, label: "死別" }
};

/** 世帯年収（migration 078）。プロフィール入力（mypage.ejs）・parseIncome と対応。 */
export const INCOME_CODES: Record<string, { code: number; label: string }> = {
  under_200: { code: 1, label: "200万円未満" },
  "200_400": { code: 2, label: "200〜400万円未満" },
  "400_600": { code: 3, label: "400〜600万円未満" },
  "600_800": { code: 4, label: "600〜800万円未満" },
  "800_1000": { code: 5, label: "800〜1,000万円未満" },
  "1000_1500": { code: 6, label: "1,000〜1,500万円未満" },
  "1500_2000": { code: 7, label: "1,500〜2,000万円未満" },
  over_2000: { code: 8, label: "2,000万円以上" },
  unknown: { code: 98, label: "わからない" },
  no_answer: { code: 99, label: "答えたくない" }
};

/** JIS X 0401 都道府県コード。 */
export const PREFECTURE_CODES: Record<string, number> = {
  北海道: 1, 青森県: 2, 岩手県: 3, 宮城県: 4, 秋田県: 5, 山形県: 6, 福島県: 7,
  茨城県: 8, 栃木県: 9, 群馬県: 10, 埼玉県: 11, 千葉県: 12, 東京都: 13, 神奈川県: 14,
  新潟県: 15, 富山県: 16, 石川県: 17, 福井県: 18, 山梨県: 19, 長野県: 20, 岐阜県: 21,
  静岡県: 22, 愛知県: 23, 三重県: 24, 滋賀県: 25, 京都府: 26, 大阪府: 27, 兵庫県: 28,
  奈良県: 29, 和歌山県: 30, 鳥取県: 31, 島根県: 32, 岡山県: 33, 広島県: 34, 山口県: 35,
  徳島県: 36, 香川県: 37, 愛媛県: 38, 高知県: 39, 福岡県: 40, 佐賀県: 41, 長崎県: 42,
  熊本県: 43, 大分県: 44, 宮崎県: 45, 鹿児島県: 46, 沖縄県: 47
};

/**
 * 職業コード。プロフィール入力（mypage.ejs / profile-check.ejs）の選択肢が正。
 * コード表は追記のみ・番号の再利用禁止（既存出力の意味が変わるため）。未定義ラベルは 99。
 */
export const JOB_CODES: Record<string, number> = {
  "会社員（正社員）": 1,
  "会社員（契約・派遣）": 2,
  公務員: 3,
  "自営業・フリーランス": 4,
  "パート・アルバイト": 5,
  学生: 6,
  "専業主婦・主夫": 7,
  無職: 8,
  その他: 9
};

/** 業種コード。JOB_CODES と同じ運用（追記のみ・再利用禁止・未定義は 99）。 */
export const BUS_CODES: Record<string, number> = {
  "IT・通信": 1,
  製造: 2,
  "金融・保険": 3,
  "医療・福祉": 4,
  教育: 5,
  "小売・流通": 6,
  "外食・フード": 7,
  "建設・不動産": 8,
  "メディア・広告": 9,
  "公共・行政": 10,
  その他: 11
};

/** コード表に無いラベル（旧データ・表記ゆれ）。原文が要るときは mode=label で出す。 */
const UNDEFINED_CODE = 99;

/** 8地方区分（ペルソナハブ規約・沖縄は九州に含む）。都道府県→地方。 */
export const REGION_BY_PREFECTURE: Record<string, string> = {
  北海道: "北海道",
  青森県: "東北", 岩手県: "東北", 宮城県: "東北", 秋田県: "東北", 山形県: "東北", 福島県: "東北",
  茨城県: "関東", 栃木県: "関東", 群馬県: "関東", 埼玉県: "関東", 千葉県: "関東", 東京都: "関東", 神奈川県: "関東",
  新潟県: "中部", 富山県: "中部", 石川県: "中部", 福井県: "中部", 山梨県: "中部", 長野県: "中部",
  岐阜県: "中部", 静岡県: "中部", 愛知県: "中部",
  三重県: "近畿", 滋賀県: "近畿", 京都府: "近畿", 大阪府: "近畿", 兵庫県: "近畿", 奈良県: "近畿", 和歌山県: "近畿",
  鳥取県: "中国", 島根県: "中国", 岡山県: "中国", 広島県: "中国", 山口県: "中国",
  徳島県: "四国", 香川県: "四国", 愛媛県: "四国", 高知県: "四国",
  福岡県: "九州", 佐賀県: "九州", 長崎県: "九州", 熊本県: "九州", 大分県: "九州", 宮崎県: "九州",
  鹿児島県: "九州", 沖縄県: "九州"
};

/** 年代（ハブ規約: floor(age/10)*10・18〜19歳は 10 が下限）。 */
export function ageBand(age: number | null): number | null {
  if (age === null || age < 0) {
    return null;
  }
  return Math.min(90, Math.floor(age / 10) * 10);
}

/** 回答時点（completed_at 優先）での満年齢。 */
export function computeAge(birthDate: string | null, atDate: string | null): number | null {
  if (!birthDate) {
    return null;
  }
  const birth = new Date(birthDate);
  const at = atDate ? new Date(atDate) : new Date();
  if (Number.isNaN(birth.getTime()) || Number.isNaN(at.getTime())) {
    return null;
  }
  let age = at.getFullYear() - birth.getFullYear();
  const beforeBirthday =
    at.getMonth() < birth.getMonth() || (at.getMonth() === birth.getMonth() && at.getDate() < birth.getDate());
  if (beforeBirthday) {
    age -= 1;
  }
  return age >= 0 && age <= 150 ? age : null;
}

function writeAttributeCells(row: ExportRow, respondent: RawdataRespondent, mode: RawdataMode): void {
  const profile = respondent.profile ?? null;

  const sex = profile?.gender ? SEX_CODES[profile.gender] : undefined;
  row.SEX = sex ? (mode === "label" ? sex.label : sex.code) : "";

  const age = computeAge(profile?.birth_date ?? null, respondent.completed_at ?? respondent.started_at);
  row.AGE = age ?? "";
  row.AGE_BAND = ageBand(age) ?? "";

  const prefecture = profile?.prefecture ?? "";
  const prefectureCode = PREFECTURE_CODES[prefecture];
  row.PRE = prefecture ? (mode === "label" || prefectureCode === undefined ? prefecture : prefectureCode) : "";
  row.REGION = REGION_BY_PREFECTURE[prefecture] ?? "";

  const occupation = profile?.occupation ?? "";
  row.JOB = occupation ? (mode === "label" ? occupation : (JOB_CODES[occupation] ?? UNDEFINED_CODE)) : "";
  const industry = profile?.industry ?? "";
  row.BUS = industry ? (mode === "label" ? industry : (BUS_CODES[industry] ?? UNDEFINED_CODE)) : "";

  const marital = profile?.marital_status ? MARITAL_CODES[profile.marital_status] : undefined;
  row.MAR = marital ? (mode === "label" ? marital.label : marital.code) : "";

  const income = profile?.household_income ? INCOME_CODES[profile.household_income] : undefined;
  row.INC = income ? (mode === "label" ? income.label : income.code) : "";

  row.CHI =
    profile?.has_children === true ? (mode === "label" ? "あり" : 1)
    : profile?.has_children === false ? (mode === "label" ? "なし" : 2)
    : "";

  // ランク（出力時点の現在ランク・回答完了時点ではない。layout に明記）
  row.RANK = (mode === "label" ? respondent.rank_name : respondent.rank_code) ?? "";
}

// ============================================================
// メタ列と本体
// ============================================================

export const STA_CODES: Record<string, string> = {
  completed: "COMP",
  partial: "PARTIAL",
  abandoned: "ABANDON",
  not_started: "NOTSTART"
};

/** 最終回答時刻（AI深掘り回答も含む）。未完了行の所要時間の終端に使う。 */
function lastAnswerAt(respondent: RawdataRespondent): string | null {
  let latest: string | null = null;
  for (const group of respondent.groups) {
    const times = [group.primaryAnswer?.created_at, ...group.probeAnswers.map((probe) => probe.created_at)];
    for (const time of times) {
      if (time && (latest === null || time > latest)) {
        latest = time;
      }
    }
  }
  return latest;
}

/**
 * 所要時間（整数秒）。完了は started_at→completed_at、未完了は started_at→最終回答時刻。
 * 凍結契約の total_duration_sec（wide 側・完了者のみ）とは別計算で、未完了行にも値が入る。
 */
function elapsedSeconds(respondent: RawdataRespondent): number | null {
  const end = respondent.completed_at ?? lastAnswerAt(respondent);
  if (!respondent.started_at || !end) {
    return null;
  }
  const start = Date.parse(respondent.started_at);
  const finish = Date.parse(end);
  return Number.isFinite(start) && Number.isFinite(finish) ? Math.max(0, Math.round((finish - start) / 1000)) : null;
}

function formatDuration(totalSeconds: number | null): string {
  if (totalSeconds === null) {
    return "";
  }
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${minutes}:${seconds}`;
}

/** ロウデータ本体（1回答者=1行・Freeasy式命名）。 */
export function buildRawdataRows(
  assignments: QAssignment[],
  respondents: RawdataRespondent[],
  options: RawdataOptions = {}
): ExportRow[] {
  const mode = options.mode ?? "code";
  const statuses = new Set(
    options.statuses && options.statuses.length > 0 ? options.statuses : DEFAULT_RAWDATA_STATUSES
  );
  const excludeTest = options.excludeTest ?? true;
  const includePii = options.includePii ?? false;

  return respondents
    .filter((respondent) => (excludeTest ? !respondent.is_test : true))
    .filter((respondent) => statuses.has(respondent.response_status))
    .map((respondent) => {
      const row: ExportRow = {
        MID: respondent.respondent_key,
        START: respondent.started_at,
        END: respondent.completed_at,
        TIME: formatDuration(respondent.total_duration_sec),
        TIME_SEC: elapsedSeconds(respondent) ?? "",
        STA: STA_CODES[respondent.response_status] ?? respondent.response_status.toUpperCase(),
        SURVEY_VERSION: respondent.snapshot_version ?? "",
        IS_TEST: respondent.is_test ? 1 : 0,
        CHANNEL: respondent.channel ?? ""
      };
      const groupByQuestionId = new Map(respondent.groups.map((group) => [group.question.id, group]));

      for (const assignment of assignments) {
        const group =
          groupByQuestionId.get(assignment.variable.question_id) ??
          ({
            question: { id: assignment.variable.question_id } as Question,
            primaryAnswer: null,
            extraction: null,
            probeAnswers: []
          } satisfies ExportAnswerGroup);
        const state = determineResponseState(group, respondent);
        writeQuestionCells(row, assignment, group, state, mode);
      }

      // 回答環境（不正検出・LIFF セッションのみ記録・migration 078）。個人情報のため既定は出力しない。
      if (includePii) {
        row.UserAgent = respondent.user_agent ?? "";
        row.IPAddress = respondent.ip_address ?? "";
      }

      writeAttributeCells(row, respondent, mode);
      return row;
    });
}

// ============================================================
// レイアウトデータ（rawdata-layout.csv）
// ============================================================

const COLUMN_ROLE_LABELS: Record<ColumnKind, string> = {
  sa: "単一選択（コード=選択肢位置1始まり）",
  ma_flag: "複数選択フラグ（1=選択/0=非選択）",
  free_text: "自由記述・その他テキスト",
  numeric: "数値",
  matrix_sa: "マトリクス単一選択（コード=列位置1始まり）",
  matrix_flag: "マトリクス複数選択フラグ（1=選択/0=非選択）",
  raw_json: "生値（構造化回答）",
  datetime: "設問回答時刻",
  probe_final_text: "AI深掘り統合テキスト（一次回答+深掘り）",
  probe_count: "AI深掘り回数",
  probe_reason: "AI深掘り発火理由",
  probe_answers: "AI深掘りQ&A（JSON）"
};

/** 設問列に付く突合キー（ハブ actuals の (question_id, question_version, segment_key) 用）。 */
interface LayoutKeys {
  questionId?: string;
  questionVersion?: number | "";
  traitKey?: string;
}

function layoutRow(
  columnName: string,
  qNumber: number | "",
  questionCode: string,
  questionText: string,
  role: string,
  code: CellValue,
  label: string,
  note: string,
  keys: LayoutKeys = {}
): ExportRow {
  return {
    column_name: columnName,
    q_number: qNumber,
    question_code: questionCode,
    question_text: questionText,
    column_role: role,
    code,
    label,
    note,
    question_id: keys.questionId ?? "",
    question_version: keys.questionVersion ?? "",
    trait_key: keys.traitKey ?? ""
  };
}

export interface RawdataLayoutOptions {
  /** UserAgent / IPAddress の定義行を含める（rawdata.csv 側と揃える）。既定 false。 */
  includePii?: boolean;
  /** 有効スナップショットの版数。設問列の question_version に入る。 */
  questionVersion?: number | null;
  /** ランクのコード表（rank_code → 表示名）。 */
  ranks?: { rank_code: string; rank_name: string }[];
}

/** 列名⇔q番号⇔question_code⇔ラベル/コードの対応表。全列の意味をここで引ける。 */
export function buildRawdataLayoutRows(assignments: QAssignment[], options: RawdataLayoutOptions = {}): ExportRow[] {
  const rows: ExportRow[] = [];
  const includePii = options.includePii ?? false;
  const questionVersion = options.questionVersion ?? "";
  const missingNote = Object.values(DEFAULT_MISSING_CODES)
    .map((missing) => `${missing.code}=${missing.label}`)
    .join(" / ");

  // メタ列
  rows.push(layoutRow("MID", "", "", "", "回答者キー（擬似匿名・直接識別子ではない）", "", "", ""));
  rows.push(layoutRow("START", "", "", "", "回答開始日時", "", "", ""));
  rows.push(layoutRow("END", "", "", "", "回答完了日時", "", "", "未完了は空欄"));
  rows.push(layoutRow("TIME", "", "", "", "所要時間（時:分:秒）", "", "", "未完了は空欄"));
  rows.push(
    layoutRow("TIME_SEC", "", "", "", "所要時間（整数秒）", "", "", "完了=開始→完了 / 未完了=開始→最終回答時刻。回答ゼロは空欄")
  );
  for (const [status, code] of Object.entries(STA_CODES)) {
    rows.push(
      layoutRow(
        "STA", "", "", "", "回答ステータス", code, status,
        status === "not_started" ? "セッションが無いため実データには出現しない" : ""
      )
    );
  }
  rows.push(
    layoutRow("SURVEY_VERSION", "", "", "", "回答した調査票スナップショットの版数", "", "", "questionnaire_snapshot.json と突合。未確定は空欄")
  );
  rows.push(layoutRow("IS_TEST", "", "", "", "テスト回答フラグ", "1/0", "", ""));
  rows.push(layoutRow("CHANNEL", "", "", "", "流入経路", "", "", ""));

  // 設問列
  for (const assignment of assignments) {
    const { variable, qNumber } = assignment;
    // ハブ突合キー。trait_key は metric_code が実体（未設定は空欄＝ハブ辞書に未登録）。
    const keys: LayoutKeys = {
      questionId: variable.question_id,
      questionVersion,
      traitKey: variable.metric_code
    };
    for (const column of assignment.columns) {
      const role = COLUMN_ROLE_LABELS[column.kind];
      if (column.kind === "sa") {
        // 単一選択はコード表を選択肢ぶん展開
        variable.allowed_values.forEach((option, index) => {
          rows.push(
            layoutRow(column.name, qNumber, variable.question_code, variable.question_text, role, index + 1, option.label, `欠損: ${missingNote}`, keys)
          );
        });
        if (variable.allowed_values.length === 0) {
          rows.push(layoutRow(column.name, qNumber, variable.question_code, variable.question_text, role, "", "", `欠損: ${missingNote}`, keys));
        }
      } else if (column.kind === "matrix_sa") {
        const cols = matrixCols(assignment.question);
        cols.forEach((col, index) => {
          rows.push(
            layoutRow(
              column.name,
              qNumber,
              variable.question_code,
              variable.question_text,
              `${role}｜行: ${column.rowLabel ?? ""}`,
              index + 1,
              col.label,
              `欠損: ${missingNote}`,
              keys
            )
          );
        });
      } else if (column.kind === "ma_flag" || column.kind === "matrix_flag") {
        rows.push(
          layoutRow(
            column.name,
            qNumber,
            variable.question_code,
            variable.question_text,
            column.kind === "matrix_flag" ? `${role}｜行: ${column.rowLabel ?? ""}` : role,
            column.optionIndex ?? "",
            column.option?.label ?? "",
            `欠損: ${missingNote}`,
            keys
          )
        );
      } else {
        rows.push(layoutRow(column.name, qNumber, variable.question_code, variable.question_text, role, "", "", "", keys));
      }
    }
  }

  // 回答環境（既定では rawdata.csv に出力しないため layout にも出さない）
  if (includePii) {
    rows.push(layoutRow("UserAgent", "", "", "", "回答環境ブラウザ（LIFFセッションのみ・不正検出用）", "", "", "LINEチャット経由は空欄"));
    rows.push(layoutRow("IPAddress", "", "", "", "回答元IPアドレス（LIFFセッションのみ・不正検出用）", "", "", "LINEチャット経由は空欄"));
  }

  // 属性列
  for (const [key, entry] of Object.entries(SEX_CODES)) {
    rows.push(layoutRow("SEX", "", "", "", "性別（プロフィール）", entry.code, `${entry.label}（${key}）`, ""));
  }
  rows.push(layoutRow("AGE", "", "", "", "年齢（回答時点の満年齢）", "", "", "生年月日未登録は空欄"));
  rows.push(layoutRow("AGE_BAND", "", "", "", "年代（floor(age/10)*10・上限90）", "10-90", "", "18〜19歳は10。生年月日未登録は空欄"));
  rows.push(layoutRow("PRE", "", "", "", "都道府県（JIS X 0401 コード）", "1-47", "", "コード未定義の値は原文のまま出力"));
  for (const region of [...new Set(Object.values(REGION_BY_PREFECTURE))]) {
    rows.push(layoutRow("REGION", "", "", "", "地方（8区分・都道府県から導出）", region, region, "沖縄県は九州に含む。都道府県未登録は空欄"));
  }
  for (const [label, code] of Object.entries(JOB_CODES)) {
    rows.push(layoutRow("JOB", "", "", "", "職業（プロフィール）", code, label, `コード未定義のラベルは ${UNDEFINED_CODE}`));
  }
  for (const [label, code] of Object.entries(BUS_CODES)) {
    rows.push(layoutRow("BUS", "", "", "", "業種（プロフィール）", code, label, `コード未定義のラベルは ${UNDEFINED_CODE}`));
  }
  for (const [key, entry] of Object.entries(MARITAL_CODES)) {
    rows.push(layoutRow("MAR", "", "", "", "未既婚（プロフィール）", entry.code, `${entry.label}（${key}）`, ""));
  }
  for (const [key, entry] of Object.entries(INCOME_CODES)) {
    rows.push(layoutRow("INC", "", "", "", "世帯年収（プロフィール）", entry.code, `${entry.label}（${key}）`, "未登録は空欄"));
  }
  rows.push(layoutRow("CHI", "", "", "", "子供の有無（プロフィール）", "1=あり / 2=なし", "", "未登録は空欄"));

  const rankNote = "出力時点の現在ランク（回答完了時点ではない）。再出力で値が変わりうる";
  if (options.ranks && options.ranks.length > 0) {
    for (const rank of options.ranks) {
      rows.push(layoutRow("RANK", "", "", "", "会員ランク（user_ranks）", rank.rank_code, rank.rank_name, rankNote));
    }
  } else {
    rows.push(layoutRow("RANK", "", "", "", "会員ランク（user_ranks）", "", "", rankNote));
  }

  return rows;
}

// ============================================================
// 管理画面向け: 設問→ロウデータ列の対応（設問一覧/編集画面の表示用）
// ============================================================

const DATA_COLUMN_KINDS = new Set<ColumnKind>([
  "sa", "ma_flag", "free_text", "numeric", "matrix_sa", "matrix_flag", "raw_json"
]);

export interface RawdataColumnDetail {
  name: string;
  /** その列が何か（選択肢ラベル・マトリクス行×列 等） */
  label: string;
}

export interface RawdataColumnInfo {
  q_number: number;
  /** 圧縮表記（例: "q2c1〜q2c4・q2t1"） */
  summary: string;
  /** 列ごとの対応（編集画面の逆引き用） */
  columns: RawdataColumnDetail[];
}

function columnDetailLabel(column: ColumnSpec): string {
  switch (column.kind) {
    case "sa":
      return "単一選択（コード=選択肢位置）";
    case "ma_flag":
      return column.option?.label ?? "";
    case "free_text":
      return "自由記述・その他";
    case "numeric":
      return "数値";
    case "matrix_sa":
      return `行: ${column.rowLabel ?? ""}`;
    case "matrix_flag":
      return `${column.rowLabel ?? ""} × ${column.option?.label ?? ""}`;
    case "raw_json":
      return "生値";
    default:
      return "";
  }
}

/** データ列名を圧縮表記にする（連続するフラグ列は "q2c1〜q2c4" に畳む）。 */
function summarizeColumnNames(columns: ColumnSpec[]): string {
  const parts: string[] = [];
  let run: string[] = [];
  let runKind: ColumnKind | null = null;

  const flush = () => {
    if (run.length === 0) {
      return;
    }
    if (run.length <= 2) {
      parts.push(...run);
    } else {
      parts.push(`${run[0]}〜${run[run.length - 1]}`);
    }
    run = [];
    runKind = null;
  };

  for (const column of columns) {
    const collapsible = column.kind === "ma_flag" || column.kind === "matrix_flag" || column.kind === "matrix_sa";
    if (collapsible && column.kind === runKind) {
      run.push(column.name);
      continue;
    }
    flush();
    if (collapsible) {
      run = [column.name];
      runKind = column.kind;
    } else {
      parts.push(column.name);
    }
  }
  flush();
  return parts.join("・");
}

/** question_id → q番号・列サマリ・列対応表。設問一覧/編集画面が使う。 */
export function buildRawdataColumnIndex(assignments: QAssignment[]): Map<string, RawdataColumnInfo> {
  const index = new Map<string, RawdataColumnInfo>();
  for (const assignment of assignments) {
    const dataColumns = assignment.columns.filter((column) => DATA_COLUMN_KINDS.has(column.kind));
    index.set(assignment.variable.question_id, {
      q_number: assignment.qNumber,
      summary: summarizeColumnNames(dataColumns),
      columns: dataColumns.map((column) => ({ name: column.name, label: columnDetailLabel(column) }))
    });
  }
  return index;
}

// ============================================================
// ステータス別件数（出力画面の件数パネル用）
// ============================================================

export interface StatusCount {
  status: string;
  sta_code: string;
  count: number;
  test_count: number;
}

/** response_status 別の件数（テスト回答は別掲）。フィルタ前の全回答者を渡すこと。 */
export function buildStatusCounts(respondents: RawdataRespondent[]): StatusCount[] {
  const counts = new Map<string, { count: number; test: number }>();
  for (const respondent of respondents) {
    const entry = counts.get(respondent.response_status) ?? { count: 0, test: 0 };
    if (respondent.is_test) {
      entry.test += 1;
    } else {
      entry.count += 1;
    }
    counts.set(respondent.response_status, entry);
  }
  const order = ["completed", "partial", "abandoned", "not_started"];
  return [...counts.entries()]
    .sort((left, right) => {
      const li = order.indexOf(left[0]);
      const ri = order.indexOf(right[0]);
      return (li < 0 ? order.length : li) - (ri < 0 ? order.length : ri);
    })
    .map(([status, entry]) => ({
      status,
      sta_code: STA_CODES[status] ?? status.toUpperCase(),
      count: entry.count,
      test_count: entry.test
    }));
}
