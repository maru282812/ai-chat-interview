/**
 * dailySurveyChatService.ts
 *
 * LINE のトーク内に出したデイリーの選択肢ボタン（postback）を受けて、回答を確定する。
 *
 * 認可の考え方: 回答者は「署名検証済み webhook の source.userId」で決める。
 * postback の data には delivery_id を入れていないので、他人の配信レコードを指定して
 * 回答済みにすることはできない。data で来た survey / question / 選択肢の位置は、
 * すべて DB の実物と突き合わせてから使う。
 */

import { supabase } from "../config/supabase";
import { buildDailyAnswerNoticeMessages } from "../lib/dailyAnswerNotice";
import { parseDailyPostbackData } from "../lib/dailyChatAnswer";
import { logger } from "../lib/logger";
import { dailySurveyRepository } from "../repositories/dailySurveyRepository";
import { dailySurveyService } from "./dailySurveyService";
import { lineMessagingService } from "./lineMessagingService";
import { pointStatusService } from "./pointStatusService";
import { userStreakService } from "./userStreakService";
import type { LineMessage } from "../types/domain";

/** デイリー回答以外の postback は false を返す（他機能が postback を使い始めたときの余地）。 */
export const dailySurveyChatService = {
  async handlePostback(input: {
    lineUserId: string;
    replyToken: string;
    data: string;
  }): Promise<boolean> {
    const parsed = parseDailyPostbackData(input.data);
    if (!parsed) return false;

    const messages = await this.answer({
      lineUserId: input.lineUserId,
      surveyId: parsed.surveyId,
      questionId: parsed.questionId,
      optionIndex: parsed.optionIndex
    });

    await lineMessagingService.reply(input.replyToken, messages);
    return true;
  },

  /** 回答を確定して、トークに返す文面を組み立てる。 */
  async answer(input: {
    lineUserId: string;
    surveyId: string;
    questionId: string;
    optionIndex: number;
  }): Promise<LineMessage[]> {
    const survey = await dailySurveyRepository.getById(input.surveyId).catch(() => null);
    if (!survey) {
      return [{ type: "text", text: "このアンケートは見つかりませんでした。" }];
    }

    const expired = survey.expires_at ? new Date(survey.expires_at).getTime() < Date.now() : false;
    if (survey.status !== "active" || expired) {
      return [{ type: "text", text: "このアンケートは受付を終了しました。またの回答をお待ちしています。" }];
    }

    const questions = await dailySurveyRepository.listQuestions(input.surveyId);
    const question = questions.find((q) => q.id === input.questionId);
    if (!question) {
      return [{ type: "text", text: "この設問は受け付けられません。" }];
    }

    const option = (question.answer_options ?? [])[input.optionIndex];
    if (!option) {
      return [{ type: "text", text: "この選択肢は受け付けられません。" }];
    }

    // 配信レコードがあることが「この人に配った」の証明。無ければ対象外として弾く。
    const { data: deliveryRow } = await supabase
      .from("daily_survey_deliveries")
      .select("id, status")
      .eq("survey_id", input.surveyId)
      .eq("line_user_id", input.lineUserId)
      .maybeSingle();

    const delivery = deliveryRow as { id: string; status: string } | null;
    if (!delivery) {
      logger.warn("daily.postback.no_delivery", {
        surveyId: input.surveyId,
        lineUserId: input.lineUserId
      });
      return [{ type: "text", text: "このアンケートの配信対象ではありませんでした。" }];
    }

    // 二重タップ対策。answered への遷移を1回だけに絞ってからポイントを付ける
    // （先に付けてしまうと、素早く2回押されたときに二重付与になる）。
    const { data: claimed } = await supabase
      .from("daily_survey_deliveries")
      .update({ status: "answered", answered_at: new Date().toISOString() })
      .eq("id", delivery.id)
      .neq("status", "answered")
      .select("id");

    if (!claimed || claimed.length === 0) {
      return [{ type: "text", text: "この設問にはすでに回答済みです。また明日お待ちしています。" }];
    }

    try {
      const result = await dailySurveyService.recordAnswer({
        lineUserId: input.lineUserId,
        surveyId: input.surveyId,
        deliveryId: delivery.id,
        answers: [{ questionId: question.id, answerValue: option.value }]
      });

      const [streak, pointStatus] = await Promise.all([
        userStreakService.getStreak(input.lineUserId),
        pointStatusService.getStatus(input.lineUserId)
      ]);

      // 文面は LIFF 回答時の push と共通（経路によって見え方が変わらないようにする）。
      return buildDailyAnswerNoticeMessages({
        pointsAwarded: result.pointsAwarded,
        streakBonusAwarded: result.streakBonusAwarded,
        currentStreak: streak.current_streak,
        rankChanged: result.rankChanged,
        newRankName: result.newRankName,
        availablePoints: pointStatus.available_points,
        nextRankName: pointStatus.next_rank_name,
        pointsToNext: pointStatus.points_to_next
      });
    } catch (error) {
      // ここまで来ると配信は answered に倒れている。ポイントが付いていない可能性があるので
      // 握りつぶさずログに残す（運用で手動付与できるように survey / user を必ず出す）。
      logger.error("daily.postback.record_failed", {
        surveyId: input.surveyId,
        deliveryId: delivery.id,
        lineUserId: input.lineUserId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return [{ type: "text", text: "回答は受け付けましたが、ポイント付与に失敗しました。サポートまでご連絡ください。" }];
    }
  }
};
