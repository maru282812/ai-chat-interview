import { jstDateString } from "../lib/dailyQueue";
import { resolveDailyQuestionViews } from "../lib/dailyAnswerUi";
import { logger } from "../lib/logger";
import { selectPoolQuestions } from "../lib/poolQuestionSelection";
import {
  poolQuestionRepository,
  type PoolQuestion,
  type PoolQuestionExposure,
} from "../repositories/poolQuestionRepository";
import { userPointService } from "./userPointService";
import { userRankService } from "./userRankService";

/**
 * ついでスワイプ（設問プール）のサービス層。
 * 選定純関数（poolQuestionSelection）を呼び、exposure を作り、回答を記録し、ポイントを付ける。
 * 処理順は dailySurveyService.recordAnswer を踏襲（副作用はレスポンス前にすべて await）。
 * docs/spec-pool-swipe-questions.md。
 */

/** 回答者に返す1件（topic_tag / client_id は絶対に含めない＝真値性の生命線）。 */
export interface PoolQuestionTodayItem {
  question: {
    id: string;
    question_text: string;
    question_type: PoolQuestion["question_type"];
    choices: Array<{ value: string; label: string }>;
    presentation: unknown;
    reward_points: number;
  };
  exposureId: string;
}

/** プール設問を resolveDailyQuestionViews が食える DailySurveyQuestion 形へ詰め替える。 */
function toDailyShape(q: PoolQuestion) {
  return {
    id: q.id,
    survey_id: "",
    question_text: q.question_text,
    question_type: q.question_type,
    answer_options: Array.isArray(q.answer_options) ? q.answer_options : [],
    attribute_key: q.attribute_key,
    sort_order: 0,
    is_active: true,
    created_at: q.created_at,
  };
}

export const poolQuestionService = {
  /**
   * 今この人に出す設問（最大 POOL_DAILY_CAP 件）を決めて返す。
   * exposure の作成に失敗した設問は黙って落とす（案件一覧を止めない）。
   */
  async getTodayForUser(lineUserId: string): Promise<PoolQuestionTodayItem[]> {
    const today = jstDateString();

    const [candidates, exposures, answerRows] = await Promise.all([
      poolQuestionRepository.listActiveCandidates(),
      poolQuestionRepository.listUserExposures(lineUserId),
      poolQuestionRepository.listUserAnswerDates(lineUserId),
    ]);
    if (candidates.length === 0) return [];

    const selection = selectPoolQuestions({
      candidates: candidates.map((c) => ({
        id: c.id,
        status: c.status,
        priority: c.priority,
        created_at: c.created_at,
        starts_at: c.starts_at,
        ends_at: c.ends_at,
        reask_after_days: c.reask_after_days,
      })),
      exposures: exposures.map((e) => ({
        question_id: e.question_id,
        exposure_date: e.exposure_date,
        status: e.status,
        position: e.position,
      })),
      answers: answerRows.map((a) => ({
        question_id: a.question_id,
        answered_date: jstDateString(new Date(a.answered_at)),
      })),
      today,
    });
    if (selection.length === 0) return [];

    const byId = new Map(candidates.map((c) => [c.id, c]));
    // 今日の served exposure（再掲）の id を引くための索引。
    const servedTodayExposure = new Map<string, PoolQuestionExposure>();
    for (const e of exposures) {
      if (e.exposure_date === today && e.status === "served") servedTodayExposure.set(e.question_id, e);
    }

    const items: PoolQuestionTodayItem[] = [];
    for (const sel of selection) {
      const question = byId.get(sel.questionId);
      if (!question) continue;

      let exposureId: string;
      if (sel.isNew) {
        try {
          const created = await poolQuestionRepository.createExposure({
            question_id: sel.questionId,
            line_user_id: lineUserId,
            exposure_date: today,
            position: sel.position,
          });
          exposureId = created.id;
        } catch (e) {
          // exposure 作成失敗（FK 違反・unique 競合など）は黙って落とす。
          logger.warn("poolQuestion.exposure.skip", {
            questionId: sel.questionId,
            lineUserId,
            error: String(e),
          });
          continue;
        }
      } else {
        const existing = servedTodayExposure.get(sel.questionId);
        if (!existing) continue;
        exposureId = existing.id;
      }

      const [view] = resolveDailyQuestionViews([toDailyShape(question)], "casual");
      if (!view) continue;

      items.push({
        question: {
          id: view.id,
          question_text: view.question_text,
          question_type: question.question_type,
          choices: view.choices,
          presentation: view.presentation,
          reward_points: question.reward_points,
        },
        exposureId,
      });
    }

    return items;
  },

  /**
   * 回答を記録してポイントを付ける。所有者検証（exposure が本人・当該設問・served）は
   * 呼び出し側（controller）で済ませてから渡すこと。処理順はレスポンス前に全 await。
   */
  async recordAnswer(input: {
    lineUserId: string;
    question: PoolQuestion;
    exposureId: string;
    answerValue: unknown;
    answerMs: number | null;
  }): Promise<{ pointsAwarded: number }> {
    const { lineUserId, question, exposureId, answerValue, answerMs } = input;

    // 1. 回答を保存（topic_tag / client_id は設問からスナップショットして焼き付ける）
    await poolQuestionRepository.insertAnswer({
      exposure_id: exposureId,
      question_id: question.id,
      line_user_id: lineUserId,
      answer_value: answerValue,
      answer_ms: answerMs,
      topic_tag: question.topic_tag,
      client_id: question.client_id,
    });

    // 2. exposure を answered に更新
    await poolQuestionRepository.markExposureStatus(exposureId, "answered", new Date().toISOString());

    // 3. ポイント付与（reward_points > 0 のときだけ・正準経路）
    let pointsAwarded = 0;
    if (question.reward_points > 0) {
      await userPointService.ensureRow(lineUserId);
      await userPointService.awardPoints({
        lineUserId,
        transactionType: "pool_question",
        points: question.reward_points,
        reason: "ついでスワイプ回答",
        referenceType: "pool_question_answer",
        referenceId: exposureId,
      });
      pointsAwarded = question.reward_points;
    }

    // 4. ランク同期（ストリークは更新しない＝連続日数はデイリーの領分）
    await userRankService.syncRank(lineUserId);

    return { pointsAwarded };
  },

  /** スキップ。exposure を skipped にするだけ（減点・ポイントなし）。 */
  async skip(exposureId: string): Promise<void> {
    await poolQuestionRepository.markExposureStatus(exposureId, "skipped");
  },
};
