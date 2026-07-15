import { supabase } from "../config/supabase";
import {
  buildDailyPostbackData,
  resolveChatAnswerable,
  truncateButtonLabel
} from "../lib/dailyChatAnswer";
import {
  type DailySlot,
  decideSlotDelivery,
  jstDateString,
  jstEndOfDayIso,
  queuePositions
} from "../lib/dailyQueue";
import { HttpError } from "../lib/http";
import { qualityWeightedPoints } from "../lib/qualityScore";
import { buildDailyQuestionFlex } from "../templates/flex";
import { throwIfError } from "../repositories/baseRepository";
import {
  dailySurveyRepository,
  type DailySurvey,
  type DailySurveyQuestion,
  type DailySurveyWithQuestionCount,
  type DailySurveyWithStats
} from "../repositories/dailySurveyRepository";
import { notificationTemplateRepository } from "../repositories/notificationTemplateRepository";
import { lineMessagingService } from "./lineMessagingService";
import { userPointService } from "./userPointService";
import { userRankService } from "./userRankService";
import { userStreakService } from "./userStreakService";
import { userBadgeService } from "./userBadgeService";
import { logger } from "../lib/logger";

interface DeliveryResult {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
}

export interface SlotRunResult extends DeliveryResult {
  slot: DailySlot;
  survey_id: string | null;
  survey_title: string | null;
  source: "scheduled" | "queue" | null;
  reason: string;
}

export const dailySurveyService = {
  async list(): Promise<DailySurveyWithStats[]> {
    return dailySurveyRepository.list();
  },

  async getById(id: string): Promise<DailySurvey> {
    return dailySurveyRepository.getById(id);
  },

  async create(input: {
    title: string;
    description?: string | null;
    reward_type: "fixed" | "random";
    reward_points: number;
    reward_min_points: number;
    reward_max_points: number;
    target_segment_id?: string | null;
    scheduled_at?: string | null;
    expires_at?: string | null;
    notification_template_id?: string | null;
    answer_ui_preset?: DailySurvey["answer_ui_preset"];
  }): Promise<DailySurvey> {
    return dailySurveyRepository.create({
      ...input,
      status: "draft"
    });
  },

  async update(id: string, input: Parameters<typeof dailySurveyRepository.update>[1]): Promise<DailySurvey> {
    return dailySurveyRepository.update(id, input);
  },

  async delete(id: string): Promise<void> {
    return dailySurveyRepository.delete(id);
  },

  /**
   * 手動で「配信開始」にする。日付と回答期限を必ず埋める（期限が無いと active が居座り、
   * 完了に落ちないまま残ってしまう）。
   */
  async activate(id: string): Promise<void> {
    const survey = await dailySurveyRepository.getById(id);
    await this.activateForToday(survey);
  },

  async pause(id: string): Promise<void> {
    return dailySurveyRepository.updateStatus(id, "paused");
  },

  async complete(id: string): Promise<void> {
    return dailySurveyRepository.updateStatus(id, "completed");
  },

  async listQuestions(surveyId: string): Promise<DailySurveyQuestion[]> {
    return dailySurveyRepository.listQuestions(surveyId);
  },

  async createQuestion(input: {
    survey_id: string;
    question_text: string;
    question_type: DailySurveyQuestion["question_type"];
    answer_options: Array<{ label: string; value: string }>;
    attribute_key?: string | null;
    sort_order?: number;
  }): Promise<DailySurveyQuestion> {
    return dailySurveyRepository.createQuestion(input);
  },

  async updateQuestion(
    questionId: string,
    input: {
      question_text?: string;
      question_type?: DailySurveyQuestion["question_type"];
      answer_options?: Array<{ label: string; value: string }>;
      attribute_key?: string | null;
      sort_order?: number;
    }
  ): Promise<DailySurveyQuestion> {
    return dailySurveyRepository.updateQuestion(questionId, input);
  },

  async deleteQuestion(questionId: string): Promise<void> {
    return dailySurveyRepository.deleteQuestion(questionId);
  },

  async deliver(
    surveyId: string,
    options: {
      targetLineUserIds?: string[];
      testMode?: boolean;
      liffBaseUrl?: string;
    } = {}
  ): Promise<DeliveryResult> {
    const survey = await dailySurveyRepository.getById(surveyId);

    // 設問が無いアンケートを配信しても、回答者側は何も表示できない
    // （サイトの「今日の1問」も設問0件はスキップする）。押す前に止める。
    const questions = await dailySurveyRepository.listQuestions(surveyId);
    if (questions.length === 0) {
      throw new HttpError(
        400,
        "設問が1問もありません。設問を追加してから配信してください。"
      );
    }

    let lineUserIds: string[] = options.targetLineUserIds ?? [];
    let skipped = 0;

    if (lineUserIds.length === 0) {
      // 宛先を明示していない一斉配信では、すでに delivery レコードを持つユーザー
      // （＝送信済み or 回答済み）を必ず除外する。cron のキャッチアップ再実行や
      // 手動の再配信で同じ人に何度も push しないための最後の砦。
      const all = await this.resolveTargetUsers(survey);
      const alreadyDelivered = await dailySurveyRepository.listDeliveredUserIds(surveyId);
      lineUserIds = all.filter((id) => !alreadyDelivered.has(id));
      skipped = all.length - lineUserIds.length;
    }

    // 通知テンプレートは「リンク通知にフォールバックするとき」の本文にしか使わない。
    // 未登録でも配信を止めない（既定テンプレートが無い環境で配信できなくなるため）。
    const template = survey.notification_template_id
      ? await notificationTemplateRepository.getById(survey.notification_template_id)
      : await notificationTemplateRepository.getDefault("daily_survey");

    const result: DeliveryResult = { total: lineUserIds.length, sent: 0, failed: 0, skipped };
    const liffUrl = options.liffBaseUrl
      ? `${options.liffBaseUrl}?survey_id=${surveyId}`
      : `https://liff.line.me/${process.env.LINE_LIFF_ID_SURVEY ?? ""}?survey_id=${surveyId}`;

    const pointLabel =
      survey.reward_type === "fixed"
        ? String(survey.reward_points)
        : `${survey.reward_min_points}〜${survey.reward_max_points}`;

    // 選択肢1問だけの設問は、トークを開いた瞬間に選んで終われるよう Flex のボタンで送る。
    // 対象外（自由記述・複数設問など）は従来どおりテキスト＋LIFFリンクにフォールバックする。
    const chatAnswerable = resolveChatAnswerable(questions);
    const chatMessage = chatAnswerable
      ? buildDailyQuestionFlex({
          questionText: chatAnswerable.question.question_text,
          rewardLabel: `+${pointLabel}pt`,
          options: chatAnswerable.options.map((option, index) => ({
            label: truncateButtonLabel(option.label),
            data: buildDailyPostbackData({
              surveyId,
              questionId: chatAnswerable.question.id,
              optionIndex: index
            })
          }))
        })
      : null;

    // フォールバック本文。テンプレート未登録でも配信できるようにしておく。
    const fallbackBody = [
      `【今日のアンケート】${survey.title}`,
      `回答すると ${pointLabel}pt もらえます。`,
      liffUrl
    ].join("\n");

    for (const lineUserId of lineUserIds) {
      const sentAt = new Date().toISOString();
      const renderedBody = template
        ? notificationTemplateRepository.renderBody(template, {
            point: pointLabel,
            surveyUrl: liffUrl,
            surveyTitle: survey.title,
            streakDays: "",
            daysToBonus: "",
            bonusPoint: "",
            expireDate: survey.expires_at
              ? new Date(survey.expires_at).toLocaleDateString("ja-JP")
              : ""
          })
        : fallbackBody;

      try {
        if (!options.testMode) {
          await dailySurveyRepository.upsertDelivery({
            survey_id: surveyId,
            line_user_id: lineUserId,
            status: "pending"
          });
        }

        await lineMessagingService.push(lineUserId, [
          chatMessage ?? { type: "text", text: renderedBody }
        ]);

        if (!options.testMode) {
          const { data } = await supabase
            .from("daily_survey_deliveries")
            .select("id")
            .eq("survey_id", surveyId)
            .eq("line_user_id", lineUserId)
            .single();
          if (data) {
            await dailySurveyRepository.markDeliveryStatus(
              (data as { id: string }).id,
              "sent",
              { sent_at: sentAt }
            );
          }

          await supabase.from("notification_logs").insert({
            line_user_id: lineUserId,
            template_id: template?.id ?? null,
            category: "daily_survey",
            rendered_title: template?.title_text ?? null,
            rendered_body: renderedBody,
            variables_used: {
              survey_id: surveyId,
              survey_title: survey.title,
              point: pointLabel
            },
            status: "sent",
            sent_at: sentAt
          });
        }

        result.sent++;
      } catch (err) {
        logger.error(`daily survey delivery failed: survey=${surveyId} user=${lineUserId} err=${String(err)}`);

        if (!options.testMode) {
          try {
            await supabase.from("notification_logs").insert({
              line_user_id: lineUserId,
              template_id: template?.id ?? null,
              category: "daily_survey",
              rendered_title: template?.title_text ?? null,
              rendered_body: renderedBody,
              variables_used: {
                survey_id: surveyId,
                survey_title: survey.title,
                point: pointLabel
              },
              status: "failed",
              error_message: String(err),
              sent_at: sentAt
            });
          } catch { /* log insert failure is non-critical */ }
        }

        result.failed++;
      }
    }

    // 宛先を明示した送信（管理画面のテスト送信）では状態を動かさない。
    // ここで active にすると、キュー待ちのアンケートがテスト送信だけでキューから抜けてしまう。
    const isTargetedSend = (options.targetLineUserIds?.length ?? 0) > 0;
    if (!options.testMode && !isTargetedSend && survey.status !== "active") {
      await this.activateForToday(survey);
    }

    return result;
  },

  // ── キュー / スロット配信（migration 079・docs/plan-daily-survey-queue.md）──

  /**
   * 配信中にする。日付が未設定なら「今日」を、回答期限が未設定なら「その日の終わり（JST）」を入れる。
   * 期限を入れておかないと active が居座り、翌日以降も配信対象として残ってしまう。
   */
  async activateForToday(survey: DailySurvey): Promise<void> {
    const today = survey.scheduled_date ?? jstDateString();
    const expiresAt = survey.expires_at ?? jstEndOfDayIso(today);
    await dailySurveyRepository.update(survey.id, {
      status: "active",
      scheduled_date: today,
      expires_at: expiresAt,
      queue_position: null
    });
  },

  /**
   * その枠（朝/夜）で配信すべき 1 件を決めて配信する。cron から呼ばれる。
   *
   * 日付固定 > キュー先頭 の順で選び、どちらも無ければ何もしない。
   * 夜枠はスケジューラ設定の evening_autofill_enabled が true のときだけキューから補充する。
   */
  async runSlot(
    slot: DailySlot,
    options: { eveningAutofillEnabled: boolean; liffBaseUrl?: string }
  ): Promise<SlotRunResult> {
    const today = jstDateString();
    const base: SlotRunResult = {
      slot,
      survey_id: null,
      survey_title: null,
      source: null,
      reason: "",
      total: 0,
      sent: 0,
      failed: 0,
      skipped: 0
    };

    // 期限切れの active を落としてから判定する（居座った active の再配信を止める）。
    const swept = await dailySurveyRepository.completeExpired(new Date().toISOString());
    if (swept > 0) logger.info(`daily survey: completed ${swept} expired survey(s)`);

    const occupant = await dailySurveyRepository.getByDateSlot(today, slot);
    const queue = occupant ? [] : await dailySurveyRepository.listQueued();

    const decision = decideSlotDelivery({
      slot,
      occupant: occupant ? { id: occupant.id, status: occupant.status } : null,
      queueHeadId: queue[0]?.id ?? null,
      eveningAutofillEnabled: options.eveningAutofillEnabled
    });

    if (decision.action === "noop") {
      return { ...base, reason: decision.reason };
    }

    const survey = occupant ?? (queue[0] as DailySurvey);

    // 設問0件のものを配信すると回答者側に何も出せない。active にも倒さず、その枠は見送る
    // （ここで throw すると枠ごと cron が落ちる。キューの先頭を直せば翌枠から流れる）。
    const questions = await dailySurveyRepository.listQuestions(survey.id);
    if (questions.length === 0) {
      logger.warn("daily survey: skipped slot (survey has no questions)", {
        slot,
        surveyId: survey.id,
        surveyTitle: survey.title
      });
      return { ...base, survey_id: survey.id, survey_title: survey.title, reason: "no_questions" };
    }

    const expiresAt = survey.expires_at ?? jstEndOfDayIso(today);
    await dailySurveyRepository.markActive(survey.id, today, slot, expiresAt);

    const delivery = await this.deliver(survey.id, { liffBaseUrl: options.liffBaseUrl });

    return {
      ...base,
      survey_id: survey.id,
      survey_title: survey.title,
      source: decision.source,
      reason: "delivered",
      ...delivery
    };
  },

  /** キューの末尾に積む。 */
  async enqueue(id: string): Promise<void> {
    const position = await dailySurveyRepository.nextQueuePosition();
    await dailySurveyRepository.enqueue(id, position);
  },

  /** キューの並びを保存する。 */
  async reorderQueue(orderedIds: string[]): Promise<void> {
    await dailySurveyRepository.saveQueueOrder(queuePositions(orderedIds));
  },

  /** 日付×枠に固定する。回答期限が未設定ならその日の終わりを入れる。 */
  async assignToSlot(id: string, date: string, slot: DailySlot): Promise<void> {
    const survey = await dailySurveyRepository.getById(id);
    const expiresAt = survey.expires_at ?? jstEndOfDayIso(date);
    await dailySurveyRepository.assignToSlot(id, date, slot, expiresAt);
  },

  /** カレンダー表示に必要な一式を返す。 */
  async getPlanningData(fromDate: string, toDate: string): Promise<{
    queued: DailySurveyWithQuestionCount[];
    scheduled: DailySurveyWithQuestionCount[];
    unplanned: DailySurveyWithQuestionCount[];
  }> {
    const [queued, scheduled, unplanned] = await Promise.all([
      dailySurveyRepository.listQueued(),
      dailySurveyRepository.listScheduledBetween(fromDate, toDate),
      dailySurveyRepository.listUnplanned()
    ]);
    return { queued, scheduled, unplanned };
  },

  async recordAnswer(input: {
    lineUserId: string;
    surveyId: string;
    deliveryId: string;
    answers: Array<{ questionId: string; answerValue: unknown }>;
  }): Promise<{
    pointsAwarded: number;
    streakBonusAwarded: number;
    rankChanged: boolean;
    newRankName: string | null;
    newBadges: string[];
  }> {
    const survey = await dailySurveyRepository.getById(input.surveyId);

    // 1. 設問回答を保存
    for (const ans of input.answers) {
      await supabase.from("daily_survey_answers").upsert(
        {
          delivery_id:  input.deliveryId,
          survey_id:    input.surveyId,
          question_id:  ans.questionId,
          line_user_id: input.lineUserId,
          answer_value: ans.answerValue,
          answered_at:  new Date().toISOString()
        },
        { onConflict: "delivery_id,question_id" }
      );
    }

    // 2. 配信ステータスを answered に更新
    await supabase
      .from("daily_survey_deliveries")
      .update({ status: "answered", answered_at: new Date().toISOString() })
      .eq("id", input.deliveryId);

    // 3. 通常ポイント付与（ランダムの場合は範囲内でランダム）
    const basePoints =
      survey.reward_type === "random"
        ? Math.floor(Math.random() * (survey.reward_max_points - survey.reward_min_points + 1)) +
          survey.reward_min_points
        : survey.reward_points;
    // 「有効回答 × 品質」の受け皿を必ず通す。品質判定の本設計はここ（qualityScore.ts）に入れる。
    // 現状は係数 1.0（仮）＝ basePoints と一致するので挙動は変わらない。
    const pointsAwarded = qualityWeightedPoints(basePoints, { answers: input.answers });

    await userPointService.ensureRow(input.lineUserId);
    await userPointService.awardPoints({
      lineUserId:       input.lineUserId,
      transactionType:  "daily_survey",
      points:           pointsAwarded,
      reason:           `デイリーアンケート回答：${survey.title}`,
      referenceType:    "daily_survey_answer",
      referenceId:      input.deliveryId
    });

    // 配信レコードにポイントを記録
    await supabase
      .from("daily_survey_deliveries")
      .update({ points_awarded: pointsAwarded })
      .eq("id", input.deliveryId);

    // 4. ストリーク更新
    let streakBonusAwarded = 0;
    const streakResult = await userStreakService.recordAnswer(input.lineUserId);
    if (streakResult.bonusEarned && streakResult.bonusMilestone) {
      const bonusPt = userStreakService.streakBonusPoints(streakResult.bonusMilestone);
      if (bonusPt > 0) {
        await userPointService.awardPoints({
          lineUserId:      input.lineUserId,
          transactionType: "streak_bonus",
          points:          bonusPt,
          reason:          `${streakResult.bonusMilestone}日連続回答ボーナス`,
          referenceType:   "manual"
        });
        streakBonusAwarded = bonusPt;
      }
    }

    // 5. ランク同期
    const rankResult = await userRankService.syncRank(input.lineUserId);

    // 6. バッジチェック
    const badgeResult = await userBadgeService.checkAndAward(input.lineUserId);

    return {
      pointsAwarded,
      streakBonusAwarded,
      rankChanged:  rankResult.changed,
      newRankName:  rankResult.newRank?.rank_name ?? null,
      newBadges:    badgeResult.newlyAwarded.map((a) => a.badge_code)
    };
  },

  async resolveTargetUsers(survey: DailySurvey): Promise<string[]> {
    if (survey.target_segment_id) {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("line_user_id")
        .eq("is_blocked", false)
        .eq("notification_ok", true);
      throwIfError(error);
      return ((data ?? []) as Array<{ line_user_id: string }>).map((r) => r.line_user_id);
    }

    const { data, error } = await supabase
      .from("user_profiles")
      .select("line_user_id")
      .eq("is_blocked", false)
      .eq("notification_ok", true);
    throwIfError(error);
    return ((data ?? []) as Array<{ line_user_id: string }>).map((r) => r.line_user_id);
  }
};
