import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatDatetimeAnswerLabel,
  isDatetimeType,
  isSameIsoDatetimeShape,
  jstTodayDayNumber,
  dayNumberToDate,
  parseDateToDayNumber,
  resolveDatetimeConfig,
  sanitizeDatetimeConfig,
  validateDatetimeAnswer,
} from "../lib/datetimeAnswer";

// 2026-10-14 10:00 JST（= 01:00 UTC）
const NOW = new Date("2026-10-14T01:00:00Z");

test("isDatetimeType", () => {
  for (const t of ["date", "time", "datetime", "period"]) assert.equal(isDatetimeType(t), true);
  assert.equal(isDatetimeType("numeric"), false);
  assert.equal(isDatetimeType(null), false);
});

test("JST の今日: UTC 15:00 以降は翌日になる", () => {
  assert.equal(dayNumberToDate(jstTodayDayNumber(new Date("2026-10-13T14:59:00Z"))), "2026-10-13");
  assert.equal(dayNumberToDate(jstTodayDayNumber(new Date("2026-10-13T15:00:00Z"))), "2026-10-14");
});

test("date: 形式と実在日付", () => {
  assert.deepEqual(validateDatetimeAnswer("date", null, "2026-10-13", NOW), {
    ok: true,
    value: "2026-10-13",
    normalized: { value: "2026-10-13" },
  });
  assert.equal(validateDatetimeAnswer("date", null, "2026-02-30", NOW).ok, false);
  assert.equal(validateDatetimeAnswer("date", null, "2026-13-01", NOW).ok, false);
  assert.equal(validateDatetimeAnswer("date", null, "2026-1-5", NOW).ok, false); // ゼロ埋め必須
  assert.equal(validateDatetimeAnswer("date", null, "2028-02-29", NOW).ok, true); // 閏年
  assert.equal(validateDatetimeAnswer("date", null, "2027-02-29", NOW).ok, false);
  assert.equal(validateDatetimeAnswer("date", null, 20261013, NOW).ok, false);
  assert.equal(validateDatetimeAnswer("date", null, "", NOW).ok, false);
});

test("date: offset 範囲（±1日の許容）", () => {
  const pastOnly = { date_max_offset: 0 };
  assert.equal(validateDatetimeAnswer("date", pastOnly, "2026-10-14", NOW).ok, true);
  assert.equal(validateDatetimeAnswer("date", pastOnly, "2026-10-15", NOW).ok, true); // 許容
  assert.equal(validateDatetimeAnswer("date", pastOnly, "2026-10-16", NOW).ok, false);
  const futureOnly = { date_min_offset: 0 };
  assert.equal(validateDatetimeAnswer("date", futureOnly, "2026-10-13", NOW).ok, true); // 許容
  assert.equal(validateDatetimeAnswer("date", futureOnly, "2026-10-12", NOW).ok, false);
  const window = { date_min_offset: -7, date_max_offset: 7 };
  assert.equal(validateDatetimeAnswer("date", window, "2026-10-06", NOW).ok, true);
  assert.equal(validateDatetimeAnswer("date", window, "2026-10-05", NOW).ok, false);
  assert.equal(validateDatetimeAnswer("date", window, "2026-10-23", NOW).ok, false);
});

test("time: 形式・範囲・刻み", () => {
  assert.deepEqual(validateDatetimeAnswer("time", null, "14:30", NOW), {
    ok: true,
    value: "14:30",
    normalized: { value: "14:30" },
  });
  assert.equal(validateDatetimeAnswer("time", null, "14:31", NOW).ok, false); // 既定15分刻み
  assert.equal(validateDatetimeAnswer("time", null, "24:00", NOW).ok, false); // 単独の時刻に 24:00 は無い
  assert.equal(validateDatetimeAnswer("time", null, "9:00", NOW).ok, false);
  assert.equal(validateDatetimeAnswer("time", null, "23:60", NOW).ok, false);
  const cfg = { time_min: "09:00", time_max: "18:00", time_step_minutes: 30 };
  assert.equal(validateDatetimeAnswer("time", cfg, "08:30", NOW).ok, false);
  assert.equal(validateDatetimeAnswer("time", cfg, "18:00", NOW).ok, true);
  assert.equal(validateDatetimeAnswer("time", cfg, "18:30", NOW).ok, false);
  assert.equal(validateDatetimeAnswer("time", cfg, "10:15", NOW).ok, false);
  assert.equal(validateDatetimeAnswer("time", { time_step_minutes: 5 }, "10:05", NOW).ok, true);
});

test("datetime: 日付と時刻の両方を検査", () => {
  assert.deepEqual(validateDatetimeAnswer("datetime", null, "2026-10-13T14:30", NOW), {
    ok: true,
    value: "2026-10-13T14:30",
    normalized: { value: "2026-10-13T14:30" },
  });
  assert.equal(validateDatetimeAnswer("datetime", null, "2026-10-13 14:30", NOW).ok, false);
  assert.equal(validateDatetimeAnswer("datetime", null, "2026-02-30T14:30", NOW).ok, false);
  assert.equal(validateDatetimeAnswer("datetime", { date_max_offset: 0 }, "2026-10-20T10:00", NOW).ok, false);
  assert.equal(validateDatetimeAnswer("datetime", null, "2026-10-13T14:31", NOW).ok, false);
});

test("period(date): 開始≦終了・同値可", () => {
  assert.deepEqual(validateDatetimeAnswer("period", null, "2026-10-01/2026-10-03", NOW), {
    ok: true,
    value: "2026-10-01/2026-10-03",
    normalized: { start: "2026-10-01", end: "2026-10-03", unit: "date" },
  });
  assert.equal(validateDatetimeAnswer("period", null, "2026-10-03/2026-10-03", NOW).ok, true);
  assert.equal(validateDatetimeAnswer("period", null, "2026-10-04/2026-10-03", NOW).ok, false);
  assert.equal(validateDatetimeAnswer("period", null, "2026-10-01", NOW).ok, false);
  assert.equal(validateDatetimeAnswer("period", null, "2026-10-01/2026-10-02/2026-10-03", NOW).ok, false);
});

test("period(time): 終了端だけ 24:00 可", () => {
  const cfg = { period_unit: "time" as const };
  assert.deepEqual(validateDatetimeAnswer("period", cfg, "13:00/15:30", NOW), {
    ok: true,
    value: "13:00/15:30",
    normalized: { start: "13:00", end: "15:30", unit: "time" },
  });
  assert.equal(validateDatetimeAnswer("period", cfg, "22:00/24:00", NOW).ok, true);
  assert.equal(validateDatetimeAnswer("period", cfg, "24:00/24:00", NOW).ok, false);
  assert.equal(validateDatetimeAnswer("period", cfg, "22:00/02:00", NOW).ok, false); // 日付またぎは対象外
  assert.equal(validateDatetimeAnswer("period", cfg, "2026-10-01/2026-10-03", NOW).ok, false);
});

test("period(datetime)", () => {
  const cfg = { period_unit: "datetime" as const };
  const r = validateDatetimeAnswer("period", cfg, "2026-10-01T13:00/2026-10-02T09:00", NOW);
  assert.equal(r.ok, true);
  if (r.ok) assert.deepEqual(r.normalized, { start: "2026-10-01T13:00", end: "2026-10-02T09:00", unit: "datetime" });
  assert.equal(validateDatetimeAnswer("period", cfg, "2026-10-02T13:00/2026-10-02T09:00", NOW).ok, false);
});

test("resolveDatetimeConfig: 既定値と不正値の扱い", () => {
  assert.deepEqual(resolveDatetimeConfig(null), {
    dateMinOffset: null,
    dateMaxOffset: null,
    stepMinutes: 15,
    timeMin: 0,
    timeMax: 1440,
    periodUnit: "date",
  });
  const r = resolveDatetimeConfig({ time_step_minutes: 7, time_min: "25:00", period_unit: "x" as never });
  assert.equal(r.stepMinutes, 15);
  assert.equal(r.timeMin, 0);
  assert.equal(r.periodUnit, "date");
});

test("sanitizeDatetimeConfig: 型ごとに関係するキーだけ残す", () => {
  const raw = {
    date_min_offset: "-7",
    date_max_offset: "0",
    time_step_minutes: "30",
    time_min: "09:00",
    time_max: "18:00",
    period_unit: "time",
  };
  assert.deepEqual(sanitizeDatetimeConfig("date", raw), {
    config: { date_min_offset: -7, date_max_offset: 0 },
    errors: [],
  });
  assert.deepEqual(sanitizeDatetimeConfig("time", raw), {
    config: { time_step_minutes: 30, time_min: "09:00", time_max: "18:00" },
    errors: [],
  });
  assert.deepEqual(sanitizeDatetimeConfig("period", raw).config, {
    period_unit: "time",
    time_step_minutes: 30,
    time_min: "09:00",
    time_max: "18:00",
  });
  assert.ok(sanitizeDatetimeConfig("time", { time_step_minutes: 7 }).errors.length > 0);
  assert.ok(sanitizeDatetimeConfig("date", { date_min_offset: 3, date_max_offset: 1 }).errors.length > 0);
  assert.ok(sanitizeDatetimeConfig("time", { time_min: "18:00", time_max: "09:00" }).errors.length > 0);
});

test("表示ラベル", () => {
  assert.equal(formatDatetimeAnswerLabel("date", "2026-10-13"), "2026年10月13日(火)");
  assert.equal(formatDatetimeAnswerLabel("time", "14:30"), "14:30");
  assert.equal(formatDatetimeAnswerLabel("datetime", "2026-10-13T14:30"), "2026年10月13日(火) 14:30");
  assert.equal(formatDatetimeAnswerLabel("period", "2026-10-01/2026-10-03"), "10月1日(木)〜10月3日(土)");
  assert.equal(formatDatetimeAnswerLabel("period", "13:00/15:30"), "13:00〜15:30");
  assert.equal(
    formatDatetimeAnswerLabel("period", "2026-12-31/2027-01-02"),
    "2026年12月31日(木)〜2027年1月2日(土)",
  );
  assert.equal(
    formatDatetimeAnswerLabel("period", "2026-10-01T13:00/2026-10-01T15:30"),
    "10月1日(木) 13:00〜15:30",
  );
  // 形式外の値は壊さずそのまま
  assert.equal(formatDatetimeAnswerLabel("date", "そのうち"), "そのうち");
  assert.equal(formatDatetimeAnswerLabel("numeric", "3"), "3");
});

test("isSameIsoDatetimeShape", () => {
  assert.equal(isSameIsoDatetimeShape("2026-10-13", "2026-01-01"), true);
  assert.equal(isSameIsoDatetimeShape("09:00", "12:30"), true);
  assert.equal(isSameIsoDatetimeShape("2026-10-13T09:00", "2026-10-13T12:30"), true);
  assert.equal(isSameIsoDatetimeShape("2026-10-13", "09:00"), false);
  assert.equal(isSameIsoDatetimeShape("3", "5"), false);
});

test("parseDateToDayNumber: 1970-01-01 = 0", () => {
  assert.equal(parseDateToDayNumber("1970-01-01"), 0);
  assert.equal(parseDateToDayNumber("1970-01-02"), 1);
});

test("codebook: 日時系は data_type=datetime・集計 none・形式を cleaning_note に明記", async () => {
  const { deriveVariableDefinition } = await import("../lib/codebook");
  const base = {
    id: "q", project_id: "p", question_code: "Q1", question_text: "来店日", comment_top: null, comment_bottom: null,
    question_role: "main", is_required: true, sort_order: 1, page_group_id: null, ai_probe_enabled: false,
  };
  const date = deriveVariableDefinition({ ...base, question_type: "date", question_config: null } as never);
  assert.equal(date.data_type, "datetime");
  assert.equal(date.aggregation_policy, "none");
  assert.match(date.cleaning_note, /YYYY-MM-DD/);
  const period = deriveVariableDefinition({ ...base, question_type: "period", question_config: { period_unit: "time" } } as never);
  assert.equal(period.data_type, "datetime");
  assert.match(period.cleaning_note, /HH:MM\/HH:MM/);
});
