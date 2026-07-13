import cron, { type ScheduledTask } from "node-cron";
import { supabase } from "../config/supabase";
import type { DailySlot } from "../lib/dailyQueue";
import { dailySurveyService } from "./dailySurveyService";
import { lineMessagingService } from "./lineMessagingService";
import { notificationTemplateRepository } from "../repositories/notificationTemplateRepository";
import { deliveryTemplateRepository } from "../repositories/deliveryTemplateRepository";
import type { DeliveryTemplate, DailyScheduleConfig, WeeklyScheduleConfig, IntervalScheduleConfig } from "../repositories/deliveryTemplateRepository";
import { projectDeliveryService } from "./projectDeliveryService";
import { logger } from "../lib/logger";
import { env } from "../config/env";

export interface SchedulerSettings {
  id: string;
  morning_enabled: boolean;
  morning_time: string;
  evening_enabled: boolean;
  evening_time: string;
  /** 夜枠をキューから自動補充するか。false（既定）なら夜は日付固定分だけ＝1日1件。 */
  evening_autofill_enabled: boolean;
  reminder_enabled: boolean;
  reminder_time: string;
  updated_at: string;
}

export interface SchedulerRunResult {
  job: string;
  surveys_processed: number;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  ran_at: string;
  /** 配信したアンケート名（何も配信しなかったときは null）。 */
  survey_title?: string | null;
  /** 配信しなかった理由（queue-empty / autofill-disabled / already-completed / paused）。 */
  reason?: string;
}

function timeToUtcCronExpr(hhmm: string): string {
  const parts = hhmm.split(":");
  const h = parseInt(parts[0] ?? "8", 10);
  const m = parseInt(parts[1] ?? "0", 10);
  // JST = UTC+9 なので UTC時刻に変換
  const utcH = (h - 9 + 24) % 24;
  return `${m} ${utcH} * * *`;
}

class NotificationSchedulerService {
  private tasks: ScheduledTask[] = [];

  async getSettings(): Promise<SchedulerSettings> {
    const { data, error } = await supabase
      .from("notification_scheduler_settings")
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return data as SchedulerSettings;
  }

  async updateSettings(
    updates: Partial<Omit<SchedulerSettings, "id" | "updated_at">>
  ): Promise<SchedulerSettings> {
    const current = await this.getSettings();
    const { data, error } = await supabase
      .from("notification_scheduler_settings")
      .update({ ...updates, updated_at: new Date().toISOString() })
      .eq("id", current.id)
      .select()
      .single();
    if (error) throw new Error(error.message);
    await this.restartScheduler();
    return data as SchedulerSettings;
  }

  async runDailyMorning(): Promise<SchedulerRunResult> {
    return this._runSlot("morning");
  }

  async runDailyEvening(): Promise<SchedulerRunResult> {
    return this._runSlot("evening");
  }

  /**
   * その枠で配信すべき「1 件」を配信する（migration 079）。
   *
   * 以前は status='active' のアンケートを全部・全ユーザーに毎回 push していたため、
   * active が残っている限り毎朝毎晩・回答済みの人にも送り続けていた。
   * 現在は「日付固定 > キュー先頭」で 1 件だけ選び、どちらも無ければ何も送らない。
   */
  private async _runSlot(slot: DailySlot): Promise<SchedulerRunResult> {
    const result: SchedulerRunResult = {
      job: slot,
      surveys_processed: 0,
      total: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      ran_at: new Date().toISOString(),
      survey_title: null,
      reason: ""
    };

    let eveningAutofillEnabled = false;
    try {
      eveningAutofillEnabled = (await this.getSettings()).evening_autofill_enabled;
    } catch (e) {
      logger.warn(`Scheduler ${slot}: settings unavailable, evening autofill treated as off`, {
        error: String(e)
      });
    }

    try {
      const run = await dailySurveyService.runSlot(slot, {
        eveningAutofillEnabled,
        liffBaseUrl: env.APP_BASE_URL
      });
      result.surveys_processed = run.survey_id ? 1 : 0;
      result.total = run.total;
      result.sent = run.sent;
      result.failed = run.failed;
      result.skipped = run.skipped;
      result.survey_title = run.survey_title;
      result.reason = run.reason;
    } catch (e) {
      logger.error(`Scheduler ${slot}: slot run failed`, { error: String(e) });
      result.failed++;
      result.reason = "error";
    }

    logger.info(`Scheduler ${slot}: done`, result);
    return result;
  }

  async runUnansweredReminder(): Promise<SchedulerRunResult> {
    const result: SchedulerRunResult = {
      job: "reminder",
      surveys_processed: 0,
      total: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      ran_at: new Date().toISOString()
    };

    // JST 当日の範囲を UTC で計算
    const now = new Date();
    const jstOffset = 9 * 60 * 60 * 1000;
    const jstNow = new Date(now.getTime() + jstOffset);
    const jstDayStart = new Date(
      Date.UTC(jstNow.getUTCFullYear(), jstNow.getUTCMonth(), jstNow.getUTCDate()) - jstOffset
    );
    const jstDayEnd = new Date(jstDayStart.getTime() + 24 * 60 * 60 * 1000);

    const { data: deliveries, error } = await supabase
      .from("daily_survey_deliveries")
      .select("id, survey_id, line_user_id")
      .eq("status", "sent")
      .gte("sent_at", jstDayStart.toISOString())
      .lt("sent_at", jstDayEnd.toISOString());

    if (error) {
      logger.error("Scheduler reminder: failed to fetch deliveries", { error });
      return result;
    }

    if (!deliveries || deliveries.length === 0) {
      logger.info("Scheduler reminder: no unanswered deliveries today");
      return result;
    }

    const template = await notificationTemplateRepository.getDefault("unanswered_reminder");
    if (!template) {
      logger.warn("Scheduler reminder: no default template for unanswered_reminder");
      return result;
    }

    result.total = deliveries.length;

    for (const delivery of deliveries) {
      try {
        const liffUrl = `https://liff.line.me/${process.env.LINE_LIFF_ID_SURVEY ?? ""}?survey_id=${delivery.survey_id}`;
        const body = notificationTemplateRepository.renderBody(template, {
          surveyUrl: liffUrl
        });
        await lineMessagingService.push(delivery.line_user_id, [{ type: "text", text: body }]);
        result.sent++;
      } catch (e) {
        logger.error("Scheduler reminder: push failed", {
          deliveryId: delivery.id,
          error: String(e)
        });
        result.failed++;
      }
    }

    logger.info("Scheduler reminder: done", result);
    return result;
  }

  async startScheduler(): Promise<void> {
    this.stopScheduler();

    let settings: SchedulerSettings;
    try {
      settings = await this.getSettings();
    } catch (e) {
      logger.warn("Scheduler: could not load settings, skipping", { error: String(e) });
      return;
    }

    if (settings.morning_enabled) {
      const expr = timeToUtcCronExpr(settings.morning_time);
      const task = cron.schedule(expr, async () => {
        logger.info("Scheduler: running morning delivery");
        await this.runDailyMorning().catch((e) =>
          logger.error("Scheduler morning error", { error: String(e) })
        );
      });
      this.tasks.push(task);
      logger.info(`Scheduler: morning job registered at ${settings.morning_time} JST (cron: ${expr})`);
    }

    if (settings.evening_enabled) {
      const expr = timeToUtcCronExpr(settings.evening_time);
      const task = cron.schedule(expr, async () => {
        logger.info("Scheduler: running evening delivery");
        await this.runDailyEvening().catch((e) =>
          logger.error("Scheduler evening error", { error: String(e) })
        );
      });
      this.tasks.push(task);
      logger.info(`Scheduler: evening job registered at ${settings.evening_time} JST (cron: ${expr})`);
    }

    if (settings.reminder_enabled) {
      const expr = timeToUtcCronExpr(settings.reminder_time);
      const task = cron.schedule(expr, async () => {
        logger.info("Scheduler: running unanswered reminder");
        await this.runUnansweredReminder().catch((e) =>
          logger.error("Scheduler reminder error", { error: String(e) })
        );
      });
      this.tasks.push(task);
      logger.info(`Scheduler: reminder job registered at ${settings.reminder_time} JST (cron: ${expr})`);
    }

    // 配信テンプレートのスケジュールを登録
    await this._registerDeliveryTemplateJobs();

    if (this.tasks.length === 0) {
      logger.info("Scheduler: no jobs enabled, scheduler is idle");
    }
  }

  private async _registerDeliveryTemplateJobs(): Promise<void> {
    let templates: DeliveryTemplate[];
    try {
      templates = await deliveryTemplateRepository.listEnabled();
    } catch (e) {
      logger.warn("Scheduler: could not load delivery templates", { error: String(e) });
      return;
    }

    for (const template of templates) {
      const expr = this._buildCronExpr(template);
      if (!expr) {
        logger.warn(`Scheduler: unsupported schedule_type for template ${template.id}`, {
          schedule_type: template.schedule_type,
        });
        continue;
      }

      const task = cron.schedule(expr, async () => {
        logger.info(`Scheduler: running delivery template "${template.name}"`);
        await projectDeliveryService.runTemplate(template.id).catch((e) =>
          logger.error("Scheduler delivery template error", {
            templateId: template.id,
            error: String(e),
          })
        );
      });
      this.tasks.push(task);
      logger.info(`Scheduler: delivery template "${template.name}" registered (cron: ${expr})`);
    }
  }

  private _buildCronExpr(template: DeliveryTemplate): string | null {
    const cfg = template.schedule_config;
    if (template.schedule_type === "daily") {
      const { hour, minute } = cfg as DailyScheduleConfig;
      // JST → UTC
      const utcHour = (hour - 9 + 24) % 24;
      return `${minute} ${utcHour} * * *`;
    }
    if (template.schedule_type === "weekly") {
      const { weekday, hour, minute } = cfg as WeeklyScheduleConfig;
      const utcHour = (hour - 9 + 24) % 24;
      // 深夜を跨ぐ場合の weekday 補正
      const utcWeekday = hour < 9 ? (weekday - 1 + 7) % 7 : weekday;
      return `${minute} ${utcHour} * * ${utcWeekday}`;
    }
    if (template.schedule_type === "interval") {
      const { interval_minutes } = cfg as IntervalScheduleConfig;
      if (interval_minutes < 60) {
        return `*/${interval_minutes} * * * *`;
      }
      const hours = Math.floor(interval_minutes / 60);
      return `0 */${hours} * * *`;
    }
    return null;
  }

  stopScheduler(): void {
    for (const task of this.tasks) {
      task.stop();
    }
    this.tasks = [];
  }

  async restartScheduler(): Promise<void> {
    this.stopScheduler();
    await this.startScheduler();
  }

  get activeJobCount(): number {
    return this.tasks.length;
  }
}

export const notificationSchedulerService = new NotificationSchedulerService();
