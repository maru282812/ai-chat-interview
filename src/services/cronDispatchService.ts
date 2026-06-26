import { supabase } from "../config/supabase";
import { logger } from "../lib/logger";
import { notificationSchedulerService } from "./notificationSchedulerService";
import { projectDeliveryService } from "./projectDeliveryService";
import { deliveryTemplateRepository } from "../repositories/deliveryTemplateRepository";
import type {
  DailyScheduleConfig,
  WeeklyScheduleConfig,
  IntervalScheduleConfig,
} from "../repositories/deliveryTemplateRepository";

// 発火予定時刻からこの分数以内なら実行する（cron の遅延・取りこぼし対策）。
// Vercel Cron を毎分実行する前提なので 5 分の窓があれば十分。
const CATCH_UP_WINDOW_MIN = 5;

export interface CronJobOutcome {
  job_key: string;
  ran: boolean;
  reason: string;
  detail?: unknown;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 実 UTC 時刻を「JST の壁時計値」として読める Date に変換する（getUTC* で JST 値が取れる）。 */
function toJst(d: Date): Date {
  return new Date(d.getTime() + JST_OFFSET_MS);
}

function jstDateKey(jst: Date): string {
  return `${jst.getUTCFullYear()}-${jst.getUTCMonth()}-${jst.getUTCDate()}`;
}

function minutesOfDay(jst: Date): number {
  return jst.getUTCHours() * 60 + jst.getUTCMinutes();
}

function parseHhmm(value: string): { hour: number; minute: number } {
  const parts = value.split(":");
  return {
    hour: parseInt(parts[0] ?? "0", 10),
    minute: parseInt(parts[1] ?? "0", 10),
  };
}

class CronDispatchService {
  private async lastFired(jobKey: string): Promise<Date | null> {
    const { data, error } = await supabase
      .from("cron_dispatch_runs")
      .select("fired_at")
      .eq("job_key", jobKey)
      .order("fired_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      logger.warn("cronDispatch: lastFired query failed", { jobKey, error: error.message });
      return null;
    }
    return data ? new Date((data as { fired_at: string }).fired_at) : null;
  }

  /**
   * 発火履歴を記録する。記録できた場合のみ true。
   * 記録に失敗した（テーブル未作成・DB障害など）状態でジョブを実行すると
   * 重複防止が効かず多重送信になるため、呼び出し側は false のとき実行しないこと。
   */
  private async recordRun(jobKey: string): Promise<boolean> {
    const { error } = await supabase.from("cron_dispatch_runs").insert({ job_key: jobKey });
    if (error) {
      logger.error("cronDispatch: recordRun failed, skipping job to avoid duplicate sends", {
        jobKey,
        error: error.message,
      });
      return false;
    }
    return true;
  }

  /** 日次（HH:MM JST）: 発火窓内で、かつ JST 当日に未実行なら true。 */
  private dueDaily(jstNowDate: Date, hour: number, minute: number, last: Date | null): boolean {
    const scheduled = hour * 60 + minute;
    const cur = minutesOfDay(jstNowDate);
    const inWindow = cur >= scheduled && cur < scheduled + CATCH_UP_WINDOW_MIN;
    if (!inWindow) return false;
    if (last && jstDateKey(toJst(last)) === jstDateKey(jstNowDate)) return false; // 当日実行済み
    return true;
  }

  /** interval（N 分おき）: 前回発火から interval_minutes 以上経過していれば true。 */
  private dueInterval(intervalMinutes: number, last: Date | null): boolean {
    if (!last) return true;
    const elapsedMin = (Date.now() - last.getTime()) / 60000;
    return elapsedMin >= intervalMinutes;
  }

  /**
   * 「今が発火時刻のジョブ」だけを実行する。Vercel Cron から毎分呼ばれる想定。
   */
  async dispatch(): Promise<CronJobOutcome[]> {
    const jstNowDate = toJst(new Date());
    const outcomes: CronJobOutcome[] = [];

    // --- デイリーアンケートのスケジューラ設定（morning / evening / reminder）---
    try {
      const settings = await notificationSchedulerService.getSettings();

      const dailyJobs: Array<{
        key: string;
        enabled: boolean;
        time: string;
        run: () => Promise<unknown>;
      }> = [
        {
          key: "survey_morning",
          enabled: settings.morning_enabled,
          time: settings.morning_time,
          run: () => notificationSchedulerService.runDailyMorning(),
        },
        {
          key: "survey_evening",
          enabled: settings.evening_enabled,
          time: settings.evening_time,
          run: () => notificationSchedulerService.runDailyEvening(),
        },
        {
          key: "survey_reminder",
          enabled: settings.reminder_enabled,
          time: settings.reminder_time,
          run: () => notificationSchedulerService.runUnansweredReminder(),
        },
      ];

      for (const job of dailyJobs) {
        if (!job.enabled) {
          outcomes.push({ job_key: job.key, ran: false, reason: "disabled" });
          continue;
        }
        const { hour, minute } = parseHhmm(job.time);
        const last = await this.lastFired(job.key);
        if (!this.dueDaily(jstNowDate, hour, minute, last)) {
          outcomes.push({ job_key: job.key, ran: false, reason: "not-due" });
          continue;
        }
        const claimed = await this.recordRun(job.key); // 実行前に記録（取れなければ発火しない）
        if (!claimed) {
          outcomes.push({ job_key: job.key, ran: false, reason: "record-failed" });
          continue;
        }
        try {
          const detail = await job.run();
          outcomes.push({ job_key: job.key, ran: true, reason: "fired", detail });
        } catch (e) {
          logger.error("cronDispatch: daily job failed", { jobKey: job.key, error: String(e) });
          outcomes.push({ job_key: job.key, ran: true, reason: "error", detail: String(e) });
        }
      }
    } catch (e) {
      logger.warn("cronDispatch: scheduler settings unavailable, skipping daily jobs", {
        error: String(e),
      });
    }

    // --- 配信テンプレート（delivery_templates）---
    try {
      const templates = await deliveryTemplateRepository.listEnabled();
      for (const template of templates) {
        const jobKey = `template:${template.id}`;
        const last = await this.lastFired(jobKey);
        let due = false;

        if (template.schedule_type === "daily") {
          const cfg = template.schedule_config as DailyScheduleConfig;
          due = this.dueDaily(jstNowDate, cfg.hour, cfg.minute, last);
        } else if (template.schedule_type === "weekly") {
          const cfg = template.schedule_config as WeeklyScheduleConfig;
          // getUTCDay() は jstNowDate に対して JST の曜日（0=日）を返す
          due =
            jstNowDate.getUTCDay() === cfg.weekday &&
            this.dueDaily(jstNowDate, cfg.hour, cfg.minute, last);
        } else if (template.schedule_type === "interval") {
          const cfg = template.schedule_config as IntervalScheduleConfig;
          due = this.dueInterval(cfg.interval_minutes, last);
        }

        if (!due) {
          outcomes.push({ job_key: jobKey, ran: false, reason: "not-due" });
          continue;
        }

        const claimed = await this.recordRun(jobKey); // 実行前に記録（取れなければ発火しない）
        if (!claimed) {
          outcomes.push({ job_key: jobKey, ran: false, reason: "record-failed" });
          continue;
        }
        try {
          const detail = await projectDeliveryService.runTemplate(template.id);
          outcomes.push({ job_key: jobKey, ran: true, reason: "fired", detail });
        } catch (e) {
          logger.error("cronDispatch: delivery template failed", {
            templateId: template.id,
            error: String(e),
          });
          outcomes.push({ job_key: jobKey, ran: true, reason: "error", detail: String(e) });
        }
      }
    } catch (e) {
      logger.warn("cronDispatch: delivery templates unavailable", { error: String(e) });
    }

    return outcomes;
  }
}

export const cronDispatchService = new CronDispatchService();
