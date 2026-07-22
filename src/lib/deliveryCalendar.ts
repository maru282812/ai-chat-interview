/**
 * 配信カレンダー（/admin/delivery-calendar）用の純関数群。
 *
 * delivery_templates の schedule_config（JST の壁時計値）から
 * 「月内のどの日に発火するか」「次回はいつか」を計算する。
 * cron 実行そのものは cronDispatchService / notificationSchedulerService が担い、
 * ここは表示専用の予定計算だけを行う（DB アクセスなし）。
 */

import type {
  DailyScheduleConfig,
  DeliveryScheduleType,
  IntervalScheduleConfig,
  WeeklyScheduleConfig
} from "../repositories/deliveryTemplateRepository";

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAY_LABELS = ["日", "月", "火", "水", "木", "金", "土"] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export interface ScheduleLike {
  schedule_type: DeliveryScheduleType;
  schedule_config: DailyScheduleConfig | WeeklyScheduleConfig | IntervalScheduleConfig;
}

/** 「毎日 08:00」「毎週月 09:30」「60分ごと」のような人間向けラベル。 */
export function scheduleLabel(template: ScheduleLike): string {
  const config = template.schedule_config as unknown as Record<string, unknown>;
  if (template.schedule_type === "daily") {
    return `毎日 ${pad(Number(config.hour) || 0)}:${pad(Number(config.minute) || 0)}`;
  }
  if (template.schedule_type === "weekly") {
    const weekday = WEEKDAY_LABELS[Number(config.weekday) || 0] ?? "?";
    return `毎週${weekday} ${pad(Number(config.hour) || 0)}:${pad(Number(config.minute) || 0)}`;
  }
  return `${Number(config.interval_minutes) || 0}分ごと`;
}

/** YYYY-MM-DD（JST 日付キー）の曜日（0=日）。 */
function weekdayOf(dateString: string): number {
  return new Date(`${dateString}T00:00:00Z`).getUTCDay();
}

function addDaysTo(dateString: string, days: number): string {
  const at = new Date(`${dateString}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

/**
 * fromDate..toDate（両端含む・YYYY-MM-DD）でテンプレートが発火する日付と時刻(JST)。
 * interval 型は特定時刻を持たないため空配列（一覧側で「N分ごと」と示す）。
 */
export function templateOccurrences(
  template: ScheduleLike,
  fromDate: string,
  toDate: string
): Array<{ date: string; time: string }> {
  if (template.schedule_type === "interval") return [];
  const config = template.schedule_config as DailyScheduleConfig & Partial<WeeklyScheduleConfig>;
  const time = `${pad(Number(config.hour) || 0)}:${pad(Number(config.minute) || 0)}`;

  const occurrences: Array<{ date: string; time: string }> = [];
  // 月表示の範囲想定（最長でも31日＋前後）なので62日で打ち切る
  let date = fromDate;
  for (let i = 0; i < 62 && date <= toDate; i++) {
    if (template.schedule_type === "daily" || weekdayOf(date) === Number(config.weekday ?? -1)) {
      occurrences.push({ date, time });
    }
    date = addDaysTo(date, 1);
  }
  return occurrences;
}

/** 実時刻 now から見た JST の壁時計 Date（getUTC* で JST 値が取れる）。 */
function jstClock(now: Date): Date {
  return new Date(now.getTime() + JST_OFFSET_MS);
}

/**
 * 次回実行予定を JST の `YYYY-MM-DD HH:MM` で返す。interval 型・不正値は null。
 * 「今日ぶんの時刻をまだ過ぎていなければ今日、過ぎていれば次の該当日」。
 */
export function nextRunJst(template: ScheduleLike, now: Date = new Date()): string | null {
  if (template.schedule_type === "interval") return null;
  const config = template.schedule_config as DailyScheduleConfig & Partial<WeeklyScheduleConfig>;
  const hour = Number(config.hour) || 0;
  const minute = Number(config.minute) || 0;

  const clock = jstClock(now);
  const todayJst = clock.toISOString().slice(0, 10);
  const nowMinutes = clock.getUTCHours() * 60 + clock.getUTCMinutes();
  const runMinutes = hour * 60 + minute;

  let date = todayJst;
  if (template.schedule_type === "daily") {
    if (runMinutes <= nowMinutes) date = addDaysTo(todayJst, 1);
  } else {
    const targetWeekday = Number(config.weekday) || 0;
    let ahead = (targetWeekday - weekdayOf(todayJst) + 7) % 7;
    if (ahead === 0 && runMinutes <= nowMinutes) ahead = 7;
    date = addDaysTo(todayJst, ahead);
  }
  return `${date} ${pad(hour)}:${pad(minute)}`;
}

/**
 * scheduler-settings の `HH:MM` 文字列（JST）から次回実行予定を計算する。
 * 形式が不正なら null。
 */
export function nextDailyRunJstFromTime(hhmm: string, now: Date = new Date()): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return nextRunJst(
    { schedule_type: "daily", schedule_config: { hour, minute } },
    now
  );
}

/** ISO 日時（UTC）を JST 日付キーと `HH:MM` に分解する。カレンダー配置用。 */
export function isoToJstParts(iso: string): { date: string; time: string } | null {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return null;
  const clock = jstClock(at);
  return {
    date: clock.toISOString().slice(0, 10),
    time: `${pad(clock.getUTCHours())}:${pad(clock.getUTCMinutes())}`
  };
}
