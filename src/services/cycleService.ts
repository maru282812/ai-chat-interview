/**
 * cycleService.ts
 *
 * 繰り返しアンケート（サイクル）の解決担当 (Migration 093)。
 *
 * 責務:
 *   - 回答に入る案件が「どのサイクルの何周目か」を解決する
 *   - A（起点）の完了で次の周を開始し、前の周を閉じる
 *   - A の回答（来店頻度）から離脱判定日を確定する
 *
 * 責務外:
 *   - C の実送付（cycleFollowupService が行う）
 *   - assignment の生成そのもの（呼び出し元の get-or-create が行う）
 *
 * 設計上の約束:
 *   - **サイクルに属さない案件では絶対に副作用を出さない。**
 *     cycle_group_steps に無い案件は resolveCycleForEntry が null を返し、
 *     呼び出し元は cycle_id=null で従来どおり動く（大多数の案件がこれ）。
 *   - 判定の失敗で回答導線を止めない。サイクル解決に失敗したら
 *     cycle_id=null にフォールバックして回答自体は通す。
 */

import {
  canStartNewCycle,
  computeExpectedReturnAt,
  DEFAULT_RESTART_COOLDOWN_DAYS,
} from "../lib/cycleRules";
import { logger } from "../lib/logger";
import { cycleGroupRepository, surveyCycleRepository } from "../repositories/cycleRepository";
import type { CycleGroup, CycleGroupStep, SurveyCycle } from "../types/domain";

export interface CycleResolution {
  cycle: SurveyCycle;
  group: CycleGroup;
  step: CycleGroupStep;
  /** この解決で新しい周が始まったか（ポイント付与やログの判断材料）。 */
  startedNew: boolean;
}

export const cycleService = {
  /**
   * 案件に入るユーザーのサイクルを解決する。
   *
   * - サイクル定義に属さない案件 → null（従来どおり）
   * - entry(A) → クールダウンを満たせば新しい周を開始、満たさなければ開いている周に合流
   * - それ以外(B/C) → 開いている周に合流。無ければ null
   *   （順序は強制しない。Bだけ単独で来た事実も記録できるようにする）
   */
  async resolveCycleForEntry(
    projectId: string,
    lineUserId: string,
    now: Date = new Date()
  ): Promise<CycleResolution | null> {
    if (!lineUserId) return null;

    const found = await cycleGroupRepository.findByProjectId(projectId);
    if (!found || !found.group.is_enabled) return null;

    const { group, step } = found;

    if (step.step_role === "entry") {
      return this.startOrJoinEntryCycle(group, step, lineUserId, now);
    }

    // B / C は既に開いている周に合流するだけ。周を新設しない。
    const open = await surveyCycleRepository.findOpen(group.id, lineUserId);
    if (!open) return null;
    return { cycle: open, group, step, startedNew: false };
  },

  /**
   * A（起点）に入ったときの周の決定。
   *
   * クールダウン（既定25日）内の再訪は新しい周を作らない。
   * QR 連打によるポイント二重取りと、離脱率の分母の水増しを防ぐため。
   */
  async startOrJoinEntryCycle(
    group: CycleGroup,
    step: CycleGroupStep,
    lineUserId: string,
    now: Date
  ): Promise<CycleResolution> {
    const latest = await surveyCycleRepository.findLatest(group.id, lineUserId);
    const cooldown = group.restart_cooldown_days ?? DEFAULT_RESTART_COOLDOWN_DAYS;

    const allowNew = canStartNewCycle({
      lastCycleStartedAt: latest ? new Date(latest.started_at) : null,
      now,
      cooldownDays: cooldown,
    });

    // クールダウン内で、まだ開いている周があるならそこへ合流（新設しない）。
    if (!allowNew && latest && !latest.closed_at) {
      logger.info("cycle.joinWithinCooldown", {
        cycleId: latest.id,
        lineUserId,
        cooldownDays: cooldown,
      });
      return { cycle: latest, group, step, startedNew: false };
    }

    // 新しい周を開始する。前の周が開いたままなら「再来店で確定」として閉じる。
    if (latest && !latest.closed_at) {
      await surveyCycleRepository.update(latest.id, {
        returned_at: now.toISOString(),
        closed_at: now.toISOString(),
        // 期限内の再来店なら returned、期限を過ぎていたなら「戻ってきた」扱いも returned。
        // いずれにせよ C を送る必要は無くなる。
        close_reason: "returned",
      });
      logger.info("cycle.closedByReturn", { cycleId: latest.id, lineUserId });
    }

    const created = await surveyCycleRepository.create({
      cycle_group_id: group.id,
      line_user_id: lineUserId,
      cycle_no: (latest?.cycle_no ?? 0) + 1,
      started_at: now.toISOString(),
    });
    logger.info("cycle.started", {
      cycleId: created.id,
      cycleNo: created.cycle_no,
      lineUserId,
    });

    return { cycle: created, group, step, startedNew: true };
  },

  /**
   * A の回答から離脱判定日を確定する。A の完了時に呼ぶ。
   *
   * 頻度が引けない（未知コード・未回答）場合は expected_return_at を立てない
   * ＝ そのサイクルは C の送付対象にならない。誤った離脱率を出すより
   * 「判定できない」を明示する方を選ぶ。
   */
  async applyEntryFrequency(
    cycleId: string,
    frequencyCode: string | null,
    answeredAt: Date = new Date()
  ): Promise<SurveyCycle | null> {
    const cycle = await surveyCycleRepository.getById(cycleId);
    if (!cycle) return null;

    const group = await cycleGroupRepository.getById(cycle.cycle_group_id);
    if (!group) return null;

    const expected = computeExpectedReturnAt({
      answeredAt,
      frequencyCode,
      graceDays: group.grace_days,
      undecidedDays: group.undecided_days,
    });

    if (!expected) {
      logger.warn("cycle.frequencyUnresolved", { cycleId, frequencyCode });
    }

    // B（来店後アンケート）の送信予約 (Migration 094)。既定は2時間後。
    // 0以下ならプッシュしない＝店頭QRからの回答だけを受ける運用にできる。
    const delayMinutes = group.followup_b_delay_minutes ?? 0;
    const scheduledB =
      delayMinutes > 0 ? new Date(answeredAt.getTime() + delayMinutes * 60_000) : null;

    return surveyCycleRepository.update(cycleId, {
      frequency_code: frequencyCode ?? null,
      expected_return_at: expected ? expected.toISOString() : null,
      followup_b_scheduled_at: scheduledB ? scheduledB.toISOString() : null,
    });
  },

  /**
   * A（起点）の完了時に、回答から来店頻度を拾って離脱判定日を確定する。
   *
   * 頻度設問は `cycle_groups` ではなく設問コードで特定する（既定 Q11）。
   * 案件ごとに設問構成が変わりうるので、コードは呼び出し側から渡せるようにしてある。
   *
   * 例外を投げない: 完了処理の途中で呼ぶため、ここで落ちると回答が完了できなくなる。
   */
  async captureEntryFrequency(params: {
    cycleId: string;
    answers: { question_id: string; answer_text: string; answer_role?: string | null }[];
    questions: { id: string; question_code: string }[];
    frequencyQuestionCode?: string;
    answeredAt?: Date;
  }): Promise<void> {
    const code = (params.frequencyQuestionCode ?? "Q11").toLowerCase();
    try {
      const question = params.questions.find((q) => q.question_code?.toLowerCase() === code);
      if (!question) {
        logger.warn("cycle.frequencyQuestionMissing", { cycleId: params.cycleId, code });
        return;
      }

      const answer = params.answers.find(
        (a) => a.question_id === question.id && (a.answer_role ?? "primary") === "primary"
      );

      await this.applyEntryFrequency(
        params.cycleId,
        answer?.answer_text?.trim() || null,
        params.answeredAt ?? new Date()
      );
    } catch (error) {
      logger.warn("cycle.captureFrequencyFailed", {
        cycleId: params.cycleId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  },

  /**
   * 例外を投げないラッパー。回答導線から呼ぶときはこちらを使う。
   * サイクル解決に失敗しても回答自体は通す（cycle_id=null で従来どおり）。
   */
  async resolveCycleSafely(
    projectId: string,
    lineUserId: string,
    now: Date = new Date()
  ): Promise<CycleResolution | null> {
    try {
      return await this.resolveCycleForEntry(projectId, lineUserId, now);
    } catch (error) {
      logger.warn("cycle.resolveFailed", {
        projectId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  },
};
