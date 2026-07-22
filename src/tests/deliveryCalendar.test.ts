/**
 * deliveryCalendar.test.ts
 *
 * 配信カレンダー（/admin/delivery-calendar）の予定計算純関数を検証する。
 * JST 変換の境界（深夜跨ぎ・weekly の曜日計算）が主対象。DB には触らない。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isoToJstParts,
  nextDailyRunJstFromTime,
  nextRunJst,
  scheduleLabel,
  templateOccurrences
} from "../lib/deliveryCalendar";

// 2026-07-22 12:00 JST（= 03:00 UTC）
const NOW = new Date("2026-07-22T03:00:00Z");

test("scheduleLabel: daily / weekly / interval を人間向けラベルにする", () => {
  assert.equal(
    scheduleLabel({ schedule_type: "daily", schedule_config: { hour: 8, minute: 0 } }),
    "毎日 08:00"
  );
  assert.equal(
    scheduleLabel({ schedule_type: "weekly", schedule_config: { weekday: 1, hour: 9, minute: 30 } }),
    "毎週月 09:30"
  );
  assert.equal(
    scheduleLabel({ schedule_type: "interval", schedule_config: { interval_minutes: 60 } }),
    "60分ごと"
  );
});

test("templateOccurrences: daily は範囲の毎日、weekly は該当曜日のみ", () => {
  const daily = templateOccurrences(
    { schedule_type: "daily", schedule_config: { hour: 7, minute: 30 } },
    "2026-07-01",
    "2026-07-03"
  );
  assert.deepEqual(daily, [
    { date: "2026-07-01", time: "07:30" },
    { date: "2026-07-02", time: "07:30" },
    { date: "2026-07-03", time: "07:30" }
  ]);

  // 2026-07-01 は水曜。月曜(weekday=1)は 7/6, 7/13, 7/20, 7/27
  const weekly = templateOccurrences(
    { schedule_type: "weekly", schedule_config: { weekday: 1, hour: 9, minute: 0 } },
    "2026-07-01",
    "2026-07-31"
  );
  assert.deepEqual(
    weekly.map((o) => o.date),
    ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27"]
  );

  const interval = templateOccurrences(
    { schedule_type: "interval", schedule_config: { interval_minutes: 30 } },
    "2026-07-01",
    "2026-07-31"
  );
  assert.deepEqual(interval, []);
});

test("nextRunJst: daily は当日時刻を過ぎたら翌日", () => {
  // NOW = 7/22 12:00 JST
  assert.equal(
    nextRunJst({ schedule_type: "daily", schedule_config: { hour: 18, minute: 0 } }, NOW),
    "2026-07-22 18:00"
  );
  assert.equal(
    nextRunJst({ schedule_type: "daily", schedule_config: { hour: 7, minute: 30 } }, NOW),
    "2026-07-23 07:30"
  );
  assert.equal(
    nextRunJst({ schedule_type: "interval", schedule_config: { interval_minutes: 15 } }, NOW),
    null
  );
});

test("nextRunJst: weekly は次の該当曜日（当日は時刻未到達なら当日）", () => {
  // 2026-07-22 は水曜(weekday=3)
  assert.equal(
    nextRunJst({ schedule_type: "weekly", schedule_config: { weekday: 3, hour: 18, minute: 0 } }, NOW),
    "2026-07-22 18:00"
  );
  // 当日の時刻を過ぎている → 1週間後
  assert.equal(
    nextRunJst({ schedule_type: "weekly", schedule_config: { weekday: 3, hour: 9, minute: 0 } }, NOW),
    "2026-07-29 09:00"
  );
  // 月曜 → 来週月曜
  assert.equal(
    nextRunJst({ schedule_type: "weekly", schedule_config: { weekday: 1, hour: 9, minute: 0 } }, NOW),
    "2026-07-27 09:00"
  );
});

test("nextRunJst: JST の日付跨ぎ（UTC では前日でも JST の今日として扱う）", () => {
  // 2026-07-22 00:30 JST = 2026-07-21 15:30 UTC
  const midnight = new Date("2026-07-21T15:30:00Z");
  assert.equal(
    nextRunJst({ schedule_type: "daily", schedule_config: { hour: 7, minute: 30 } }, midnight),
    "2026-07-22 07:30"
  );
});

test("nextDailyRunJstFromTime: scheduler-settings の HH:MM 文字列を解釈する", () => {
  assert.equal(nextDailyRunJstFromTime("18:00", NOW), "2026-07-22 18:00");
  assert.equal(nextDailyRunJstFromTime("07:30", NOW), "2026-07-23 07:30");
  assert.equal(nextDailyRunJstFromTime("25:00", NOW), null);
  assert.equal(nextDailyRunJstFromTime("ふしぎ", NOW), null);
});

test("isoToJstParts: UTC の ISO 日時を JST の日付キーと時刻に分解する", () => {
  assert.deepEqual(isoToJstParts("2026-07-21T15:30:00Z"), {
    date: "2026-07-22",
    time: "00:30"
  });
  assert.equal(isoToJstParts("not-a-date"), null);
});
