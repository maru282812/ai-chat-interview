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

import { env } from "../config/env";
import {
  canStartNewCycle,
  computeExpectedReturnAt,
  DEFAULT_RESTART_COOLDOWN_DAYS,
} from "../lib/cycleRules";
import { logger } from "../lib/logger";
import { cycleGroupRepository, surveyCycleRepository } from "../repositories/cycleRepository";
import { projectAssignmentRepository } from "../repositories/projectAssignmentRepository";
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

    // B（followup）だけは「案内を送ったのに、まだ答えられていない周」を優先する。
    //
    // B の案内が届いた後に A をもう一度回答すると周が切り替わる。
    // 開いている周に入れてしまうと、送った覚えのない新しい周に B の回答が付き、
    // どの A に対する B かが分からなくなる（＝離脱分析の横串が切れる）。
    // 送った周が既に閉じていても、そちらへ紐づけるのが正しい。
    //
    // 「まだ答えられていない」の判定は呼び出し側が持つ（assignment の有無）ため、
    // ここでは候補を返すだけにし、既に回答済みなら通常の合流へ落とす。
    if (step.step_role === "followup") {
      const sent = await surveyCycleRepository.findLatestFollowupBSent(group.id, lineUserId);
      // 送った周が「開いている周」と違うときだけ差し替えを検討する。
      if (sent && (!open || sent.id !== open.id)) {
        const answered = await projectAssignmentRepository.existsCompletedForCycle(
          projectId,
          sent.id
        );
        if (!answered) {
          logger.info("cycle.followupBJoinedSentCycle", {
            cycleId: sent.id,
            cycleNo: sent.cycle_no,
            openCycleNo: open?.cycle_no ?? null,
          });
          return { cycle: sent, group, step, startedNew: false };
        }
      }
    }

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

    // 検証用アカウントはクールダウンを免除する（CYCLE_TEST_LINE_USER_IDS）。
    // 本番の実機で25日待たずに通し確認できるようにするための seam。
    // 免除するのはクールダウンだけで、認証・所有者検証は一切変えない。
    const isTester = isCycleTestUser(lineUserId);

    const allowNew =
      isTester ||
      canStartNewCycle({
        lastCycleStartedAt: latest ? new Date(latest.started_at) : null,
        now,
        cooldownDays: cooldown,
      });

    if (isTester && latest) {
      logger.info("cycle.cooldownBypassedForTester", { lineUserId, cycleNo: latest.cycle_no });
    }

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
      // ⚠ 閉じると C の対象から外れるのは意図どおり。**B は道連れにしない。**
      // B の抽出条件から closed_at を外したので（listFollowupBDue）、
      // ここで閉じても未送信の B は送られる。
      // B は「その周の A に答えた事実」への返礼であって、次の来店とは無関係。
      const pendingB = Boolean(latest.followup_b_scheduled_at) && !latest.followup_b_sent_at;

      await surveyCycleRepository.update(latest.id, {
        returned_at: now.toISOString(),
        closed_at: now.toISOString(),
        // 期限内の再来店なら returned、期限を過ぎていたなら「戻ってきた」扱いも returned。
        // いずれにせよ C を送る必要は無くなる。
        close_reason: "returned",
      });
      logger.info("cycle.closedByReturn", { cycleId: latest.id, lineUserId, pendingB });
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
      // 管理画面で編集した対応表（Migration 095）。未設定なら既定表。
      daysTable: group.frequency_days_json,
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
    /** 明示指定が無ければ cycle_groups.frequency_question_code（既定 Q11）を使う。 */
    frequencyQuestionCode?: string;
    answeredAt?: Date;
  }): Promise<void> {
    try {
      let code = params.frequencyQuestionCode;
      if (!code) {
        // どの設問を頻度として読むかはグループ設定が持つ（Migration 095）。
        const cycle = await surveyCycleRepository.getById(params.cycleId);
        const group = cycle ? await cycleGroupRepository.getById(cycle.cycle_group_id) : null;
        code = group?.frequency_question_code || "Q11";
      }
      const normalized = code.toLowerCase();

      const question = params.questions.find((q) => q.question_code?.toLowerCase() === normalized);
      if (!question) {
        // 頻度設問が無い案件（業種テンプレの構成差・設問コードの付け替え）でも
        // ここで return してはいけない。B の送信予約は頻度と無関係なのに、
        // 巻き添えで立たなくなり「A に答えても B が永久に来ない」事故になる。
        // 頻度 null で先へ進めば C だけが対象外になる（判定できないものは判定しない）。
        logger.warn("cycle.frequencyQuestionMissing", {
          cycleId: params.cycleId,
          code: normalized,
        });
      }

      const answer = question
        ? params.answers.find(
            (a) => a.question_id === question.id && (a.answer_role ?? "primary") === "primary"
          )
        : undefined;

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

/**
 * 検証用アカウントか（CYCLE_TEST_LINE_USER_IDS のカンマ区切り）。
 * 未設定なら常に false ＝ 通常運用では何も変わらない。
 */
export function isCycleTestUser(lineUserId: string): boolean {
  const raw = env.CYCLE_TEST_LINE_USER_IDS;
  if (!raw || !lineUserId) return false;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(lineUserId);
}
