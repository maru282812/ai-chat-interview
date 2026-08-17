/**
 * cycleFollowupService.ts
 *
 * 離脱検証アンケート（C）の自動送付担当 (Migration 093)。
 *
 * 送るのは「A で答えた来店頻度の期間を過ぎても、再来店（A の再回答）が無い人」だけ。
 * 次の A が来た時点で cycleService が returned_at を立てて周を閉じるので、
 * 戻ってきた人はここに残らない ＝ 送付対象から自動的に外れる。
 *
 * 責務外:
 *   - 離脱判定日の算出（cycleService.applyEntryFrequency が A 完了時に確定済み）
 *   - 周の開始・終了（cycleService）
 *
 * 冪等性:
 *   送付前に followup_sent_at を立ててから push する（クレーム方式）。
 *   毎分 cron なので、送信中に次の実行が重なっても二重送信しない。
 *   push に失敗した場合も再送しない（LINE 側で届いている可能性があるため、
 *   二重送信より未送信を選ぶ）。失敗はログに残して運用で拾う。
 */

import { env } from "../config/env";
import { logger } from "../lib/logger";
import { cycleGroupRepository, surveyCycleRepository } from "../repositories/cycleRepository";
import { projectRepository } from "../repositories/projectRepository";
import type { CycleGroup, SurveyCycle } from "../types/domain";
import { lineMessagingService } from "./lineMessagingService";

export interface CycleFollowupResult {
  checked: number;
  sent: number;
  failed: number;
  skipped: number;
}

/** 1回の実行で処理する上限。毎分実行なので小さめに抑え、関数のタイムアウトを避ける。 */
const BATCH_LIMIT = 50;

export const cycleFollowupService = {
  /**
   * 送付期限を過ぎたサイクルに C を送る。cron から毎分呼ばれる。
   */
  async runFollowupDispatch(now: Date = new Date()): Promise<CycleFollowupResult> {
    const result: CycleFollowupResult = { checked: 0, sent: 0, failed: 0, skipped: 0 };

    const due = await surveyCycleRepository.listFollowupDue(now.toISOString(), BATCH_LIMIT);
    result.checked = due.length;
    if (due.length === 0) return result;

    // グループ設定は使い回すのでキャッシュする（同じ店舗の人が固まって出るため）。
    const groupCache = new Map<string, CycleGroup | null>();
    const getGroup = async (id: string): Promise<CycleGroup | null> => {
      if (!groupCache.has(id)) groupCache.set(id, await cycleGroupRepository.getById(id));
      return groupCache.get(id) ?? null;
    };

    for (const cycle of due) {
      const group = await getGroup(cycle.cycle_group_id);

      // 離脱検証案件が未設定なら送りようがない（A→B だけの構成）。
      if (!group || !group.is_enabled || !group.followup_project_id) {
        result.skipped++;
        continue;
      }

      const claimed = await this.claim(cycle, now);
      if (!claimed) {
        result.skipped++;
        continue;
      }

      try {
        await this.sendFollowup(cycle, group);
        result.sent++;
      } catch (error) {
        // 送信失敗でも followup_sent_at は戻さない（二重送信を避ける）。
        result.failed++;
        logger.error("cycleFollowup.pushFailed", {
          cycleId: cycle.id,
          lineUserId: cycle.line_user_id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (result.sent > 0 || result.failed > 0) {
      logger.info("cycleFollowup.dispatched", { ...result });
    }
    return result;
  },

  /**
   * 送付権を確保する。先に followup_sent_at を立てることで
   * 毎分 cron の実行が重なっても二重送信にならないようにする。
   */
  async claim(cycle: SurveyCycle, now: Date): Promise<boolean> {
    try {
      await surveyCycleRepository.update(cycle.id, { followup_sent_at: now.toISOString() });
      return true;
    } catch (error) {
      logger.warn("cycleFollowup.claimFailed", {
        cycleId: cycle.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  },

  /** C の案内を LINE で送る。entry_code 付きの LIFF URL を渡してそのまま回答に入れる。 */
  async sendFollowup(cycle: SurveyCycle, group: CycleGroup): Promise<void> {
    const project = await projectRepository.getById(group.followup_project_id as string);
    const title = project.user_display_title || project.name;
    const url = this.entryUrl(project);

    const text = `【${title}】\n\nその後、いかがお過ごしでしょうか。\nよろしければ最近のご様子をお聞かせください。\n\n${url}`;

    await lineMessagingService.push(cycle.line_user_id, [{ type: "text", text }]);
    logger.info("cycleFollowup.sent", {
      cycleId: cycle.id,
      cycleNo: cycle.cycle_no,
      projectId: project.id,
    });
  },

  /**
   * 店舗アンケートは entry_code 経由で assignment を確保する導線に合わせる
   * （/liff/store が respondent / assignment / サイクルを解決する）。
   */
  entryUrl(project: { id: string; entry_code?: string | null }): string {
    return project.entry_code
      ? `${env.APP_BASE_URL}/liff/store?entry_code=${encodeURIComponent(project.entry_code)}`
      : `${env.APP_BASE_URL}/liff/projects/${project.id}`;
  },

  // ------------------------------------------------------------------
  // B（来店後アンケート）の遅延送信 — Migration 094
  // ------------------------------------------------------------------

  /**
   * A 完了から所定時間（既定2時間）が経った人に B を送る。cron から毎分呼ばれる。
   *
   * QR からその場で B に回答した人にも送られる点に注意。
   * 既に回答済みなら assignment が completed なので、開いても
   * 「回答済み」画面が出るだけで二重回答にはならない。
   */
  async runFollowupBDispatch(now: Date = new Date()): Promise<CycleFollowupResult> {
    const result: CycleFollowupResult = { checked: 0, sent: 0, failed: 0, skipped: 0 };

    const due = await surveyCycleRepository.listFollowupBDue(now.toISOString(), BATCH_LIMIT);
    result.checked = due.length;
    if (due.length === 0) return result;

    const groupCache = new Map<string, CycleGroup | null>();
    const getGroup = async (id: string): Promise<CycleGroup | null> => {
      if (!groupCache.has(id)) groupCache.set(id, await cycleGroupRepository.getById(id));
      return groupCache.get(id) ?? null;
    };

    // B の案件はステップ定義から引く（followup ロール）。
    const stepCache = new Map<string, string | null>();
    const getBProjectId = async (groupId: string): Promise<string | null> => {
      if (!stepCache.has(groupId)) {
        const steps = await cycleGroupRepository.listSteps(groupId);
        stepCache.set(groupId, steps.find((s) => s.step_role === "followup")?.project_id ?? null);
      }
      return stepCache.get(groupId) ?? null;
    };

    for (const cycle of due) {
      const group = await getGroup(cycle.cycle_group_id);
      if (!group || !group.is_enabled) {
        result.skipped++;
        continue;
      }

      const projectId = await getBProjectId(group.id);
      if (!projectId) {
        result.skipped++;
        continue;
      }

      // 送信権を先に確保して二重送信を防ぐ（C と同じクレーム方式）。
      try {
        await surveyCycleRepository.update(cycle.id, { followup_b_sent_at: now.toISOString() });
      } catch (error) {
        result.skipped++;
        logger.warn("cycleFollowupB.claimFailed", {
          cycleId: cycle.id,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      try {
        const project = await projectRepository.getById(projectId);
        const title = project.user_display_title || project.name;
        const text = `【${title}】\n\n本日はご来店ありがとうございました。\n仕上がりのご感想を1〜2分でお聞かせください。\n\n${this.entryUrl(project)}`;

        await lineMessagingService.push(cycle.line_user_id, [{ type: "text", text }]);
        result.sent++;
        logger.info("cycleFollowupB.sent", { cycleId: cycle.id, projectId });
      } catch (error) {
        result.failed++;
        logger.error("cycleFollowupB.pushFailed", {
          cycleId: cycle.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (result.sent > 0 || result.failed > 0) {
      logger.info("cycleFollowupB.dispatched", { ...result });
    }
    return result;
  },
};
