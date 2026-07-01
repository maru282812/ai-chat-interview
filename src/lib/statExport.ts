import { createHash } from "node:crypto";
import type { Answer, AnswerExtraction, Project, Question } from "../types/domain";
import {
  DEFAULT_MISSING_CODES,
  type CodebookOption,
  type ResponseState,
  type VariableDefinition,
  deriveCodebook
} from "./codebook";

/**
 * statExport.ts
 *
 * 外部統計ソフト投入用のエクスポート生成（純関数）。改修指示の以下に対応:
 *  §2  出力順は送付時マスター順（既定 sort_order, §12）
 *  §8  AI深掘りは元設問への補助回答。比較単位は常に question_code
 *  §9  一次回答+深掘りを統合した値（<code>_final_answer_text 等）
 *  §10 深掘りバイアス確認用メタデータ
 *  §11 respondents_wide / answers_long / codebook / questionnaire_snapshot / randomization_log
 *  §15 多重選択の one-hot ワイド展開 + その他自由記述
 *  §19 出力主キーは擬似匿名 respondent_key（直接識別子を含めない）
 *  §20 欠損値センチネル
 *  §21 CSV物理仕様（UTF-8 BOM / RFC4180 / CRLF）
 *
 * DBへ書き込まない。リポジトリにも依存しない。statExportService が値を流し込む。
 */

export type CellValue = string | number | boolean | null;
export type ExportRow = Record<string, CellValue>;

export interface ExportAnswerGroup {
  question: Question;
  primaryAnswer: Answer | null;
  extraction: AnswerExtraction | null;
  probeAnswers: Answer[];
}

export interface ExportRespondent {
  /** 擬似匿名キー（§19）。直接識別子は含めない。 */
  respondent_key: string;
  session_id: string;
  /** completed / partial / abandoned / not_started 等 */
  response_status: string;
  is_test: boolean;
  channel: string | null;
  started_at: string | null;
  completed_at: string | null;
  total_duration_sec: number | null;
  groups: ExportAnswerGroup[];
  /**
   * 回答者ごとの実表示順 question_id -> display_position（1始まり）。
   * ランダム化ランタイム未実装時は未指定でよい（マスター順にフォールバック）。
   */
  displayOrder?: Map<string, number>;
  /** ランダム化シード（再現性, §22）。未実装時は null。 */
  randomizationSeed?: string | null;
}

export interface WideOptions {
  /** テスト回答(is_test)を既定で除外する（§17）。false で全件。 */
  excludeTest?: boolean;
}

// ============================================================
// §21 CSV物理仕様
// ============================================================

function escapeRfc4180(value: CellValue, delimiter: string): string {
  const raw = value === null || value === undefined ? "" : typeof value === "boolean" ? (value ? "1" : "0") : String(value);
  const mustQuote = raw.includes(delimiter) || raw.includes("\"") || raw.includes("\n") || raw.includes("\r");
  const escaped = raw.replaceAll("\"", "\"\"");
  return mustQuote ? `"${escaped}"` : escaped;
}

function collectHeaders(rows: ExportRow[]): string[] {
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!seen.has(key)) {
        seen.add(key);
        headers.push(key);
      }
    }
  }
  return headers;
}

/** RFC4180 準拠・CRLF 改行・任意で UTF-8 BOM 付き CSV を生成する（§21）。 */
export function toCsvRfc4180(
  rows: ExportRow[],
  options: { bom?: boolean; delimiter?: string } = {}
): string {
  const delimiter = options.delimiter ?? ",";
  const bom = options.bom ?? true;
  const headers = collectHeaders(rows);
  if (headers.length === 0) {
    return bom ? "﻿" : "";
  }
  const lines = [headers.map((header) => escapeRfc4180(header, delimiter)).join(delimiter)];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeRfc4180(row[header] ?? null, delimiter)).join(delimiter));
  }
  return `${bom ? "﻿" : ""}${lines.join("\r\n")}`;
}

// ============================================================
// 値の解釈
// ============================================================

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function matchOptionCode(allowed: CodebookOption[], token: string): string | null {
  const trimmed = token.trim();
  if (!trimmed) {
    return null;
  }
  const lower = trimmed.toLowerCase();
  const found = allowed.find(
    (option) => option.value.toLowerCase() === lower || option.label.toLowerCase() === lower
  );
  return found ? found.option_code : null;
}

/** 回答から選択コード群と未マッチ（その他自由記述）を取り出す。 */
function getSelected(
  answer: Answer,
  variable: VariableDefinition
): { codes: string[]; otherText: string | null } {
  const normalized = asRecord(answer.normalized_answer);
  const tokens: string[] = [];

  if (Array.isArray(normalized.values)) {
    tokens.push(...normalized.values.map((value) => String(value)));
  } else if (Array.isArray(normalized.labels)) {
    tokens.push(...normalized.labels.map((value) => String(value)));
  } else if (normalized.value !== undefined && normalized.value !== null) {
    tokens.push(String(normalized.value));
  } else if (typeof normalized.label === "string" && normalized.label.trim()) {
    tokens.push(normalized.label.trim());
  } else if (answer.answer_text.trim()) {
    // フォールバック: 区切り文字で分割して照合
    tokens.push(...answer.answer_text.split(/[|,、\/]/).map((part) => part.trim()).filter(Boolean));
  }

  const codes: string[] = [];
  const unmatched: string[] = [];
  for (const token of tokens) {
    const code = matchOptionCode(variable.allowed_values, token);
    if (code) {
      codes.push(code);
    } else if (token) {
      unmatched.push(token);
    }
  }

  return {
    codes: Array.from(new Set(codes)),
    otherText: unmatched.length > 0 ? unmatched.join(" | ") : null
  };
}

function getNumericValue(answer: Answer): number | null {
  const normalized = asRecord(answer.normalized_answer);
  if (typeof normalized.value === "number" && Number.isFinite(normalized.value)) {
    return normalized.value;
  }
  const match = answer.answer_text.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

/** §7: 回答状態の判定（answered or 欠損区分）。 */
function determineResponseState(
  group: ExportAnswerGroup,
  respondent: ExportRespondent
): ResponseState {
  if (group.primaryAnswer) {
    const explicit = asRecord(group.primaryAnswer.normalized_answer).response_state;
    if (typeof explicit === "string" && explicit in DEFAULT_MISSING_CODES) {
      return explicit as ResponseState;
    }
    return "answered";
  }
  // 回答が無い: 完了セッションなら無回答、それ以外は未到達とみなす
  return respondent.response_status === "completed" ? "no_answer" : "not_reached";
}

function missingSentinel(state: ResponseState, variable: VariableDefinition): CellValue {
  if (state === "answered") {
    return null;
  }
  const code = DEFAULT_MISSING_CODES[state as Exclude<ResponseState, "answered">];
  // テキスト型は数値センチネルが無意味なので空欄
  return variable.data_type === "text" ? "" : code.code;
}

function probeQuestionText(probe: Answer): string {
  const normalized = asRecord(probe.normalized_answer);
  const candidate = normalized.probe_question ?? normalized.question_text ?? normalized.prompt;
  return typeof candidate === "string" ? candidate : "";
}

function probeReason(group: ExportAnswerGroup): string {
  for (const source of [group.primaryAnswer, ...group.probeAnswers]) {
    const reason = asRecord(source?.normalized_answer).probe_reason;
    if (typeof reason === "string" && reason.trim()) {
      return reason.trim();
    }
  }
  return "";
}

function finalAnswerText(group: ExportAnswerGroup): string {
  const parts: string[] = [];
  if (group.primaryAnswer?.answer_text.trim()) {
    parts.push(group.primaryAnswer.answer_text.trim());
  }
  for (const probe of group.probeAnswers) {
    if (probe.answer_text.trim()) {
      parts.push(probe.answer_text.trim());
    }
  }
  return parts.join(" / ");
}

function cleanedValue(group: ExportAnswerGroup, variable: VariableDefinition): CellValue {
  const extraction = group.extraction?.extracted_json;
  if (extraction?.summary) {
    const summaryValues = Object.values(extraction.summary)
      .flatMap((value) => (Array.isArray(value) ? value : [value]))
      .filter((value) => value !== null && value !== undefined && value !== "")
      .map((value) => (typeof value === "object" ? JSON.stringify(value) : String(value)));
    if (summaryValues.length > 0) {
      return summaryValues.join(" | ");
    }
  }
  if (!group.primaryAnswer) {
    return "";
  }
  if (variable.data_type === "integer" || variable.data_type === "decimal") {
    return getNumericValue(group.primaryAnswer);
  }
  const selected = getSelected(group.primaryAnswer, variable);
  if (selected.codes.length > 0) {
    return selected.codes.join(" | ");
  }
  return group.primaryAnswer.answer_text;
}

// ============================================================
// §11 respondents_wide.csv
// ============================================================

function writePrimaryCell(row: ExportRow, variable: VariableDefinition, group: ExportAnswerGroup, state: ResponseState): void {
  const name = variable.variable_name;
  const primary = group.primaryAnswer;

  if (variable.data_type === "categorical_multi" && variable.multi_select_encoding === "one_hot") {
    const selected = primary && state === "answered" ? getSelected(primary, variable) : { codes: [], otherText: null };
    for (const option of variable.allowed_values) {
      row[`${name}_${option.option_code}`] = state === "answered" ? (selected.codes.includes(option.option_code) ? 1 : 0) : missingSentinel(state, variable);
    }
    row[`${name}_other_text`] = selected.otherText ?? (state === "answered" ? "" : missingSentinel(state, variable));
    return;
  }

  if (state !== "answered" || !primary) {
    row[name] = missingSentinel(state, variable);
    return;
  }

  if (variable.data_type === "integer" || variable.data_type === "decimal") {
    row[name] = getNumericValue(primary);
    return;
  }
  if (variable.data_type === "categorical" || variable.data_type === "boolean") {
    const selected = getSelected(primary, variable);
    row[name] = selected.codes[0] ?? selected.otherText ?? primary.answer_text;
    return;
  }
  // text / json その他
  row[name] = primary.answer_text;
}

/** §9 統合値の列を書き込む（ai_probe_enabled の設問のみ・wide肥大化を抑制）。 */
function writeProbeIntegratedCells(row: ExportRow, variable: VariableDefinition, group: ExportAnswerGroup): void {
  if (!variable.ai_probe_enabled) {
    return;
  }
  const code = variable.variable_name;
  const probeQuestions = group.probeAnswers.map((probe) => probeQuestionText(probe)).filter(Boolean);
  const probeAnswers = group.probeAnswers.map((probe) => probe.answer_text);

  row[`${code}_final_answer_text`] = finalAnswerText(group);
  row[`${code}_cleaned_value`] = cleanedValue(group, variable);
  row[`${code}_extracted_json`] = group.extraction?.extracted_json ? JSON.stringify(group.extraction.extracted_json) : "";
  row[`${code}_probe_triggered`] = group.probeAnswers.length > 0;
  row[`${code}_probe_count`] = group.probeAnswers.length;
  row[`${code}_probe_reason`] = probeReason(group);
  row[`${code}_probe_questions_json`] = JSON.stringify(probeQuestions);
  row[`${code}_probe_answers_json`] = JSON.stringify(probeAnswers);
}

/** §11 respondents_wide: 1回答者1行・列は送付時マスター順。 */
export function buildWideRows(
  variables: VariableDefinition[],
  respondents: ExportRespondent[],
  options: WideOptions = {}
): ExportRow[] {
  const excludeTest = options.excludeTest ?? true;
  const ordered = [...variables].sort((left, right) => left.master_order - right.master_order);

  return respondents
    .filter((respondent) => (excludeTest ? !respondent.is_test : true))
    .map((respondent) => {
      const row: ExportRow = {
        respondent_key: respondent.respondent_key,
        response_status: respondent.response_status,
        is_test: respondent.is_test,
        channel: respondent.channel,
        started_at: respondent.started_at,
        completed_at: respondent.completed_at,
        total_duration_sec: respondent.total_duration_sec
      };
      const groupByQuestionId = new Map(respondent.groups.map((group) => [group.question.id, group]));

      for (const variable of ordered) {
        const group =
          groupByQuestionId.get(variable.question_id) ??
          ({ question: { id: variable.question_id } as Question, primaryAnswer: null, extraction: null, probeAnswers: [] } satisfies ExportAnswerGroup);
        const state = determineResponseState(group, respondent);
        writePrimaryCell(row, variable, group, state);
        writeProbeIntegratedCells(row, variable, group);
      }
      return row;
    });
}

// ============================================================
// §11 answers_long.csv
// ============================================================

/** §11 answers_long: 1回答1行。primary / ai_probe・実表示順・parent_answer_id を含む。 */
export function buildLongRows(variables: VariableDefinition[], respondents: ExportRespondent[]): ExportRow[] {
  const variableByQuestionId = new Map(variables.map((variable) => [variable.question_id, variable]));
  const rows: ExportRow[] = [];

  for (const respondent of respondents) {
    for (const group of respondent.groups) {
      const variable = variableByQuestionId.get(group.question.id);
      const masterOrder = variable?.master_order ?? group.question.sort_order;
      const displayPosition = respondent.displayOrder?.get(group.question.id) ?? masterOrder;
      const state = determineResponseState(group, respondent);

      if (group.primaryAnswer) {
        rows.push({
          respondent_key: respondent.respondent_key,
          session_id: respondent.session_id,
          question_code: group.question.question_code,
          variable_name: variable?.variable_name ?? group.question.question_code,
          block_code: variable?.block_code ?? null,
          master_order: masterOrder,
          display_position: displayPosition,
          answer_role: "primary",
          parent_answer_id: null,
          concept_code: group.primaryAnswer.concept_code ?? "",
          response_state: state,
          answer_text: group.primaryAnswer.answer_text,
          normalized_answer_json: group.primaryAnswer.normalized_answer ? JSON.stringify(group.primaryAnswer.normalized_answer) : "",
          extracted_json: group.extraction?.extracted_json ? JSON.stringify(group.extraction.extracted_json) : "",
          answered_at: group.primaryAnswer.created_at,
          is_test: respondent.is_test,
          probe_reason: "",
          probe_question_text: ""
        });
      }

      group.probeAnswers.forEach((probe, index) => {
        rows.push({
          respondent_key: respondent.respondent_key,
          session_id: respondent.session_id,
          question_code: group.question.question_code,
          variable_name: variable?.variable_name ?? group.question.question_code,
          block_code: variable?.block_code ?? null,
          master_order: masterOrder,
          display_position: displayPosition,
          answer_role: "ai_probe",
          parent_answer_id: probe.parent_answer_id ?? group.primaryAnswer?.id ?? null,
          concept_code: probe.concept_code ?? group.primaryAnswer?.concept_code ?? "",
          response_state: "answered",
          answer_text: probe.answer_text,
          normalized_answer_json: probe.normalized_answer ? JSON.stringify(probe.normalized_answer) : "",
          extracted_json: "",
          answered_at: probe.created_at,
          is_test: respondent.is_test,
          // §10 深掘りバイアス確認用メタデータ
          probe_index: index + 1,
          probe_reason: probeReason(group),
          probe_question_text: probeQuestionText(probe),
          probe_model: String(asRecord(probe.normalized_answer).probe_model ?? ""),
          probe_prompt_version: String(asRecord(probe.normalized_answer).probe_prompt_version ?? ""),
          probe_completion_score: (asRecord(probe.normalized_answer).probe_completion_score as CellValue) ?? "",
          probe_confidence: (asRecord(probe.normalized_answer).probe_confidence as CellValue) ?? ""
        });
      });
    }
  }
  return rows;
}

// ============================================================
// §11 codebook.csv
// ============================================================

/** §11 codebook: 設問・変数名・型・選択肢・欠損値・クリーニングルール・集計方針。 */
export function buildCodebookRows(variables: VariableDefinition[]): ExportRow[] {
  return variables.map((variable) => ({
    master_order: variable.master_order,
    question_code: variable.question_code,
    variable_name: variable.variable_name,
    question_text: variable.question_text,
    question_role: variable.question_role,
    block_code: variable.block_code,
    data_type: variable.data_type,
    measure_type: variable.measure_type,
    is_required: variable.is_required,
    scale_min: variable.scale_min,
    scale_max: variable.scale_max,
    multi_select_encoding: variable.multi_select_encoding,
    free_text_policy: variable.free_text_policy,
    aggregation_policy: variable.aggregation_policy,
    missing_value_policy: variable.missing_value_policy,
    allowed_values_json: JSON.stringify(variable.allowed_values),
    missing_codes_json: JSON.stringify(variable.missing_codes),
    ai_probe_enabled: variable.ai_probe_enabled,
    cleaning_note: variable.cleaning_note
  }));
}

// ============================================================
// §11 questionnaire_snapshot.json
// ============================================================

/**
 * §1/§11 調査票スナップショットの「安定な定義」を構築する。
 * ハッシュ計算・永続化に使うため、生成時刻など揮発値は含めない。
 * codebook（変数定義）を内包し、エクスポートは凍結後もこの定義を基準にできる。
 */
export function buildSnapshotDefinition(project: Project, questions: Question[]): Record<string, unknown> {
  const variables = deriveCodebook(questions);
  const variableByQuestionId = new Map(variables.map((variable) => [variable.question_id, variable]));
  const ordered = [...questions].sort((left, right) => left.sort_order - right.sort_order);

  return {
    snapshot_kind: "questionnaire",
    codebook: variables,
    project: {
      id: project.id,
      name: project.name,
      research_mode: project.research_mode,
      display_mode: project.display_mode
    },
    questions: ordered.map((question) => {
      const variable = variableByQuestionId.get(question.id);
      return {
        question_code: question.question_code,
        question_text: question.question_text,
        question_type: question.question_type,
        question_role: question.question_role,
        master_order: question.sort_order,
        block_code: question.page_group_id ?? null,
        is_required: question.is_required,
        options: (question.question_config?.options ?? []).map((option) => ({
          value: option.value,
          label: option.label
        })),
        branch_rule: question.branch_rule ?? null,
        visibility_conditions: question.visibility_conditions ?? null,
        randomization: null, // §3 ランダム化ランタイムは後続フェーズ
        variable_name: variable?.variable_name ?? question.question_code,
        cleaning: variable
          ? {
              data_type: variable.data_type,
              measure_type: variable.measure_type,
              multi_select_encoding: variable.multi_select_encoding,
              free_text_policy: variable.free_text_policy,
              aggregation_policy: variable.aggregation_policy
            }
          : null,
        ai_probe: {
          enabled: question.ai_probe_enabled,
          max_probe_count: question.max_probe_count ?? null
        }
      };
    })
  };
}

/** キーをソートした決定的JSON文字列（ハッシュ用）。 */
function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`).join(",")}}`;
}

/** スナップショット定義の内容ハッシュ（同一内容なら版を増やさず再利用するため）。 */
export function snapshotHash(definition: Record<string, unknown>): string {
  return createHash("sha1").update(canonicalStringify(definition)).digest("hex");
}

/** 永続スナップショットの定義から codebook(変数定義) を取り出す。形式不正なら null。 */
export function codebookFromSnapshot(definition: unknown): VariableDefinition[] | null {
  const codebook = asRecord(definition).codebook;
  return Array.isArray(codebook) ? (codebook as VariableDefinition[]) : null;
}

// ============================================================
// §11 randomization_log.csv
// ============================================================

/** §11 randomization_log: 回答者ごとの実表示順・ブロック順・ランダム化結果。 */
export function buildRandomizationLogRows(variables: VariableDefinition[], respondents: ExportRespondent[]): ExportRow[] {
  const ordered = [...variables].sort((left, right) => left.master_order - right.master_order);
  const rows: ExportRow[] = [];

  for (const respondent of respondents) {
    for (const variable of ordered) {
      const displayPosition = respondent.displayOrder?.get(variable.question_id) ?? variable.master_order;
      rows.push({
        respondent_key: respondent.respondent_key,
        question_code: variable.question_code,
        block_code: variable.block_code,
        master_order: variable.master_order,
        display_position: displayPosition,
        is_randomized: respondent.displayOrder ? displayPosition !== variable.master_order : false,
        randomization_seed: respondent.randomizationSeed ?? null
      });
    }
  }
  return rows;
}
