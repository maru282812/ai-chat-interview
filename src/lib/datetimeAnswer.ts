/**
 * datetimeAnswer.ts
 *
 * 日付・時刻・期間の回答形式（migration 118）のサーバー権威ロジック。
 * 契約は docs/plan-datetime-answer-types.md（ACI と hibi-site で共有）。
 *
 *   date      … YYYY-MM-DD
 *   time      … HH:MM（24時間制）
 *   datetime  … YYYY-MM-DDTHH:MM
 *   period    … 開始/終了（ISO 8601 区間表記）。各端は config.period_unit の形式
 *
 * すべて JST・タイムゾーン表記なし。ゼロ埋め必須（文字列の辞書順＝時系列順を保つ）。
 * DB アクセス・HTTP は行わない純関数のみ。
 */

import type { QuestionConfig, QuestionType } from "../types/domain";

export const DATETIME_TYPES = ["date", "time", "datetime", "period"] as const;
export type DatetimeType = (typeof DATETIME_TYPES)[number];

export function isDatetimeType(t: string | null | undefined): t is DatetimeType {
  return (DATETIME_TYPES as readonly string[]).includes(String(t ?? ""));
}

export const TIME_STEP_CHOICES = [5, 10, 15, 30, 60] as const;
export const PERIOD_UNITS = ["date", "time", "datetime"] as const;
export type PeriodUnit = (typeof PERIOD_UNITS)[number];

/** config の日時系キー（すべて任意）。questions.config 直下と partner の datetime_config で同じ形。 */
export interface DatetimeConfig {
  date_min_offset?: number | null;
  date_max_offset?: number | null;
  time_step_minutes?: number;
  time_min?: string;
  time_max?: string;
  period_unit?: PeriodUnit;
}

export const DATETIME_CONFIG_KEYS = [
  "date_min_offset",
  "date_max_offset",
  "time_step_minutes",
  "time_min",
  "time_max",
  "period_unit",
] as const;

/** 既定値を埋めた解決済み config。 */
export interface ResolvedDatetimeConfig {
  dateMinOffset: number | null;
  dateMaxOffset: number | null;
  stepMinutes: number;
  /** 分（0..1440） */
  timeMin: number;
  /** 分（0..1440） */
  timeMax: number;
  periodUnit: PeriodUnit;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^(\d{2}):(\d{2})$/;
const DATETIME_RE = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/;

const DAY_MS = 24 * 60 * 60 * 1000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS_JA = ["日", "月", "火", "水", "木", "金", "土"];

// ------------------------------------------------------------------
// 基本パーサ
// ------------------------------------------------------------------

/** "HH:MM" → 分。allow24=true のときだけ "24:00"（=1440）を許す。不正は null。 */
export function parseTimeToMinutes(s: string, allow24 = false): number | null {
  const m = TIME_RE.exec(s);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (min > 59) return null;
  if (h === 24 && min === 0) return allow24 ? 1440 : null;
  if (h > 23) return null;
  return h * 60 + min;
}

export function minutesToTime(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" が実在する日付なら UTC 基準の日番号（1970-01-01=0）。不正は null。 */
export function parseDateToDayNumber(s: string): number | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = Date.UTC(y, mo - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.round(t / DAY_MS);
}

export function dayNumberToDate(n: number): string {
  const d = new Date(n * DAY_MS);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** now（既定=現在時刻）の JST 日付の日番号。 */
export function jstTodayDayNumber(now: Date = new Date()): number {
  return Math.floor((now.getTime() + JST_OFFSET_MS) / DAY_MS);
}

// ------------------------------------------------------------------
// config
// ------------------------------------------------------------------

function intOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isInteger(n) ? n : null;
}

/** questions.config（または partner の datetime_config）から既定値込みで読む。不正値は既定に落とす。 */
export function resolveDatetimeConfig(cfg: Partial<DatetimeConfig> | QuestionConfig | null | undefined): ResolvedDatetimeConfig {
  const c = (cfg ?? {}) as Record<string, unknown>;
  const step = intOrNull(c.time_step_minutes);
  const tMin = typeof c.time_min === "string" ? parseTimeToMinutes(c.time_min, false) : null;
  const tMax = typeof c.time_max === "string" ? parseTimeToMinutes(c.time_max, true) : null;
  const unit = typeof c.period_unit === "string" && (PERIOD_UNITS as readonly string[]).includes(c.period_unit)
    ? (c.period_unit as PeriodUnit)
    : "date";
  let timeMin = tMin ?? 0;
  let timeMax = tMax ?? 1440;
  if (timeMax <= timeMin) {
    timeMin = 0;
    timeMax = 1440;
  }
  return {
    dateMinOffset: intOrNull(c.date_min_offset),
    dateMaxOffset: intOrNull(c.date_max_offset),
    stepMinutes: step !== null && (TIME_STEP_CHOICES as readonly number[]).includes(step) ? step : 15,
    timeMin,
    timeMax,
    periodUnit: unit,
  };
}

/**
 * 管理画面・partner API から来た値を、保存してよい日時系 config に正規化する。
 * 返り値は「指定があったキーだけ」を持つ（未指定キーは既定扱いなので保存しない）。
 * 不正値は errors に積む（呼び出し側が 400 にするか捨てるかを決める）。
 */
export function sanitizeDatetimeConfig(
  type: string,
  raw: Record<string, unknown> | null | undefined,
): { config: DatetimeConfig; errors: string[] } {
  const out: DatetimeConfig = {};
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return { config: out, errors };
  const unit: PeriodUnit | null =
    type === "period"
      ? typeof raw.period_unit === "string" && (PERIOD_UNITS as readonly string[]).includes(raw.period_unit)
        ? (raw.period_unit as PeriodUnit)
        : "date"
      : null;
  const usesDate = type === "date" || type === "datetime" || (type === "period" && unit !== "time");
  const usesTime = type === "time" || type === "datetime" || (type === "period" && unit !== "date");

  if (type === "period") {
    if (raw.period_unit !== undefined && raw.period_unit !== null && raw.period_unit !== "" && raw.period_unit !== unit) {
      errors.push("period_unit は date / time / datetime のいずれかです。");
    }
    out.period_unit = unit ?? "date";
  }
  if (usesDate) {
    for (const key of ["date_min_offset", "date_max_offset"] as const) {
      const v = raw[key];
      if (v === undefined || v === null || v === "") continue;
      const n = intOrNull(v);
      if (n === null || Math.abs(n) > 3660) errors.push(`${key} は整数（日数）で指定してください。`);
      else out[key] = n;
    }
    if (
      typeof out.date_min_offset === "number" &&
      typeof out.date_max_offset === "number" &&
      out.date_min_offset > out.date_max_offset
    ) {
      errors.push("date_min_offset は date_max_offset 以下にしてください。");
    }
  }
  if (usesTime) {
    const step = raw.time_step_minutes;
    if (step !== undefined && step !== null && step !== "") {
      const n = intOrNull(step);
      if (n === null || !(TIME_STEP_CHOICES as readonly number[]).includes(n)) {
        errors.push("time_step_minutes は 5 / 10 / 15 / 30 / 60 のいずれかです。");
      } else out.time_step_minutes = n;
    }
    let minM: number | null = null;
    let maxM: number | null = null;
    if (typeof raw.time_min === "string" && raw.time_min !== "") {
      minM = parseTimeToMinutes(raw.time_min, false);
      if (minM === null) errors.push("time_min は HH:MM（00:00〜23:59）で指定してください。");
      else out.time_min = raw.time_min;
    }
    if (typeof raw.time_max === "string" && raw.time_max !== "") {
      maxM = parseTimeToMinutes(raw.time_max, true);
      if (maxM === null) errors.push("time_max は HH:MM（00:00〜24:00）で指定してください。");
      else out.time_max = raw.time_max;
    }
    if ((minM ?? 0) >= (maxM ?? 1440)) errors.push("time_min は time_max より前にしてください。");
  }
  return { config: out, errors };
}

// ------------------------------------------------------------------
// 回答の検証
// ------------------------------------------------------------------

export type DatetimeValidation =
  | { ok: true; value: string; normalized: Record<string, unknown> }
  | { ok: false; error: string };

const fail = (error: string): DatetimeValidation => ({ ok: false, error });

/** 日付境界（端末時計・回答中の日付またぎ）のずれを吸収する許容日数。 */
const OFFSET_TOLERANCE_DAYS = 1;

function checkDate(s: string, rc: ResolvedDatetimeConfig, today: number): string | null {
  const n = parseDateToDayNumber(s);
  if (n === null) return "日付の形式が正しくないか、存在しない日付です。";
  if (rc.dateMinOffset !== null && n < today + rc.dateMinOffset - OFFSET_TOLERANCE_DAYS) {
    return "選べる期間より前の日付です。";
  }
  if (rc.dateMaxOffset !== null && n > today + rc.dateMaxOffset + OFFSET_TOLERANCE_DAYS) {
    return "選べる期間より後の日付です。";
  }
  return null;
}

/** 時刻が範囲内かつ刻みに一致するか。端点（time_min / time_max）そのものは刻み外でも許す。 */
function checkTime(s: string, rc: ResolvedDatetimeConfig, allow24: boolean): string | null {
  const m = parseTimeToMinutes(s, allow24);
  if (m === null) return "時刻の形式が正しくありません。";
  if (m < rc.timeMin || m > rc.timeMax) return "選べる時間帯の外の時刻です。";
  if (m !== rc.timeMin && m !== rc.timeMax && m % rc.stepMinutes !== 0) {
    return `時刻は${rc.stepMinutes}分刻みで選んでください。`;
  }
  return null;
}

function checkDatetime(s: string, rc: ResolvedDatetimeConfig, today: number, allow24: boolean): string | null {
  const m = DATETIME_RE.exec(s);
  if (!m) return "日時の形式が正しくありません。";
  return checkDate(m[1]!, rc, today) ?? checkTime(m[2]!, rc, allow24);
}

/**
 * 回答文字列を検証し、保存する answer_text と normalized_answer を返す。
 * @param now 検証時刻（テスト用。既定=現在）
 */
export function validateDatetimeAnswer(
  type: DatetimeType,
  config: QuestionConfig | Partial<DatetimeConfig> | null | undefined,
  rawValue: unknown,
  now: Date = new Date(),
): DatetimeValidation {
  if (typeof rawValue !== "string") return fail("回答の形式が正しくありません。");
  const value = rawValue.trim();
  if (!value) return fail("回答が空です。");
  const rc = resolveDatetimeConfig(config);
  const today = jstTodayDayNumber(now);

  if (type === "date") {
    const err = checkDate(value, rc, today);
    return err ? fail(err) : { ok: true, value, normalized: { value } };
  }
  if (type === "time") {
    const err = checkTime(value, rc, false);
    return err ? fail(err) : { ok: true, value, normalized: { value } };
  }
  if (type === "datetime") {
    const err = checkDatetime(value, rc, today, false);
    return err ? fail(err) : { ok: true, value, normalized: { value } };
  }
  // period
  const parts = value.split("/");
  if (parts.length !== 2) return fail("期間は「開始/終了」の形式で送ってください。");
  const [start, end] = parts as [string, string];
  const unit = rc.periodUnit;
  let err: string | null;
  if (unit === "date") err = checkDate(start, rc, today) ?? checkDate(end, rc, today);
  else if (unit === "time") err = checkTime(start, rc, false) ?? checkTime(end, rc, true);
  else err = checkDatetime(start, rc, today, false) ?? checkDatetime(end, rc, today, true);
  if (err) return fail(err);
  // ゼロ埋め固定長なので辞書順＝時系列順。同値は可。
  if (start > end) return fail("終了は開始と同じか、それより後にしてください。");
  return { ok: true, value, normalized: { start, end, unit } };
}

// ------------------------------------------------------------------
// 表示ラベル
// ------------------------------------------------------------------

function dateParts(s: string): { y: number; m: number; d: number; w: string } | null {
  const n = parseDateToDayNumber(s);
  if (n === null) return null;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  return { y, m, d, w: WEEKDAYS_JA[new Date(n * DAY_MS).getUTCDay()]! };
}

/** 2026-10-13 → 2026年10月13日(火)。withYear=false で年を省く。 */
export function formatDateLabel(s: string, withYear = true): string {
  const p = dateParts(s);
  if (!p) return s;
  return `${withYear ? `${p.y}年` : ""}${p.m}月${p.d}日(${p.w})`;
}

function formatDatetimeLabelOne(s: string, withYear = true): string {
  const m = DATETIME_RE.exec(s);
  if (!m) return s;
  return `${formatDateLabel(m[1]!, withYear)} ${m[2]}`;
}

/**
 * answer_text を回答者・店舗向けの表示ラベルにする。形式に合わない値はそのまま返す（壊さない）。
 *   date      2026年10月13日(火)
 *   time      14:30
 *   datetime  2026年10月13日(火) 14:30
 *   period    10月1日(水)〜10月3日(金) / 13:00〜15:30 / 10月1日(水) 13:00〜15:30
 *             （年は開始と終了が同じ年なら省く。年をまたぐときは両端に付ける）
 */
export function formatDatetimeAnswerLabel(
  type: string,
  answerText: string | null | undefined,
  config?: QuestionConfig | Partial<DatetimeConfig> | null,
): string {
  const text = String(answerText ?? "").trim();
  if (!text || !isDatetimeType(type)) return text;
  if (type === "date") return formatDateLabel(text);
  if (type === "time") return text;
  if (type === "datetime") return formatDatetimeLabelOne(text);
  const parts = text.split("/");
  if (parts.length !== 2) return text;
  const [start, end] = parts as [string, string];
  const unit = inferPeriodUnit(start) ?? resolveDatetimeConfig(config).periodUnit;
  if (unit === "time") return `${start}〜${end}`;
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  if (unit === "date") {
    if (!DATE_RE.test(start) || !DATE_RE.test(end)) return text;
    return `${formatDateLabel(start, !sameYear)}〜${formatDateLabel(end, !sameYear)}`;
  }
  const ms = DATETIME_RE.exec(start);
  const me = DATETIME_RE.exec(end);
  if (!ms || !me) return text;
  if (ms[1] === me[1]) return `${formatDateLabel(ms[1]!, false)} ${ms[2]}〜${me[2]}`;
  return `${formatDatetimeLabelOne(start, !sameYear)}〜${formatDatetimeLabelOne(end, !sameYear)}`;
}

/** 値そのものの形から period の単位を推定する（config が手元に無い経路用）。 */
function inferPeriodUnit(s: string): PeriodUnit | null {
  if (DATETIME_RE.test(s)) return "datetime";
  if (DATE_RE.test(s)) return "date";
  if (TIME_RE.test(s)) return "time";
  return null;
}

// ------------------------------------------------------------------
// 分岐条件の比較用
// ------------------------------------------------------------------

const ISO_SHAPES: RegExp[] = [/^\d{4}-\d{2}-\d{2}$/, /^\d{2}:\d{2}$/, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/];

/**
 * 両辺が同じ日時形式（YYYY-MM-DD / HH:MM / YYYY-MM-DDTHH:MM）なら true。
 * このとき文字列比較が時系列比較になる（parseFloat だと "2026-10-13" が 2026 になり年しか比べない）。
 */
export function isSameIsoDatetimeShape(a: string, b: string): boolean {
  return ISO_SHAPES.some((re) => re.test(a) && re.test(b));
}

/** codebook 等で使う形式の説明。 */
export function datetimeFormatNote(type: QuestionType | string, config?: QuestionConfig | null): string {
  switch (type) {
    case "date":
      return "形式: YYYY-MM-DD（JST）";
    case "time":
      return "形式: HH:MM（24時間制・JST）";
    case "datetime":
      return "形式: YYYY-MM-DDTHH:MM（JST）";
    case "period": {
      const unit = resolveDatetimeConfig(config).periodUnit;
      const one = unit === "date" ? "YYYY-MM-DD" : unit === "time" ? "HH:MM" : "YYYY-MM-DDTHH:MM";
      return `形式: 開始/終了（${one}/${one}・JST）`;
    }
    default:
      return "";
  }
}
