import cron, { type ScheduledTask } from "node-cron";
import { supabase } from "../config/supabase";
import { dailySurveyService } from "./dailySurveyService";
import { lineMessagingService } from "./lineMessagingService";
import { notificationTemplateRepository } from "../repositories/notificationTemplateRepository";
import { logger } from "../lib/logger";
import { env } from "../config/env";

export interface SchedulerSettings {
  id: string;
  morning_enabled: boolean;
  morning_time: string;
  evening_enabled: boolean;
  evening_time: string;
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
    return this._runDeliveryJobs("morning");
  }

  async runDailyEvening(): Promise<SchedulerRunResult> {
    return this._runDeliveryJobs("evening");
  }

  private async _runDeliveryJobs(jobName: string): Promise<SchedulerRunResult> {
    const result: SchedulerRunResult = {
      job: jobName,
      surveys_processed: 0,
      total: 0,
      sent: 0,
      failed: 0,
      skipped: 0,
      ran_at: new Date().toISOString()
    };

    const { data: surveys, error } = await supabase
      .from("daily_surveys")
      .select("id")
      .eq("status", "active");

    if (error) {
      logger.error(`Scheduler ${jobName}: failed to fetch surveys`, { error });
      return result;
    }

    for (const survey of surveys ?? []) {
      try {
        const deliveryResult = await dailySurveyService.deliver(survey.id, {
          liffBaseUrl: env.APP_BASE_URL
        });
        result.surveys_processed++;
        result.total += deliveryResult.total;
        result.sent += deliveryResult.sent;
        result.failed += deliveryResult.failed;
        result.skipped += deliveryResult.skipped;
      } catch (e) {
        logger.error(`Scheduler ${jobName}: deliver failed`, {
          surveyId: survey.id,
          error: String(e)
        });
        result.failed++;
      }
    }

    logger.info(`Scheduler ${jobName}: done`, result);
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

    if (this.tasks.length === 0) {
      logger.info("Scheduler: no jobs enabled, scheduler is idle");
    }
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
