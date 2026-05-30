import { supabase } from "../config/supabase";
import { throwIfError } from "../repositories/baseRepository";
import {
  dailySurveyRepository,
  type DailySurvey,
  type DailySurveyQuestion,
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

  async activate(id: string): Promise<void> {
    return dailySurveyRepository.updateStatus(id, "active");
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

    let lineUserIds: string[] = options.targetLineUserIds ?? [];

    if (lineUserIds.length === 0) {
      lineUserIds = await this.resolveTargetUsers(survey);
    }

    const template = survey.notification_template_id
      ? await notificationTemplateRepository.getById(survey.notification_template_id)
      : await notificationTemplateRepository.getDefault("daily_survey");

    if (!template) {
      throw new Error("通知テンプレートが見つかりません");
    }

    const result: DeliveryResult = { total: lineUserIds.length, sent: 0, failed: 0, skipped: 0 };
    const liffUrl = options.liffBaseUrl
      ? `${options.liffBaseUrl}?survey_id=${surveyId}`
      : `https://liff.line.me/${process.env.LINE_LIFF_ID_SURVEY ?? ""}?survey_id=${surveyId}`;

    const pointLabel =
      survey.reward_type === "fixed"
        ? String(survey.reward_points)
        : `${survey.reward_min_points}〜${survey.reward_max_points}`;

    for (const lineUserId of lineUserIds) {
      const sentAt = new Date().toISOString();
      const renderedBody = notificationTemplateRepository.renderBody(template, {
        point: pointLabel,
        surveyUrl: liffUrl,
        surveyTitle: survey.title,
        streakDays: "",
        daysToBonus: "",
        bonusPoint: "",
        expireDate: survey.expires_at
          ? new Date(survey.expires_at).toLocaleDateString("ja-JP")
          : ""
      });

      try {
        if (!options.testMode) {
          await dailySurveyRepository.upsertDelivery({
            survey_id: surveyId,
            line_user_id: lineUserId,
            status: "pending"
          });
        }

        await lineMessagingService.push(lineUserId, [{ type: "text", text: renderedBody }]);

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
            template_id: template.id,
            category: "daily_survey",
            rendered_title: template.title_text ?? null,
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
              template_id: template.id,
              category: "daily_survey",
              rendered_title: template.title_text ?? null,
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

    if (!options.testMode && survey.status === "draft") {
      await dailySurveyRepository.updateStatus(surveyId, "active");
    }

    return result;
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
    const pointsAwarded =
      survey.reward_type === "random"
        ? Math.floor(Math.random() * (survey.reward_max_points - survey.reward_min_points + 1)) +
          survey.reward_min_points
        : survey.reward_points;

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
