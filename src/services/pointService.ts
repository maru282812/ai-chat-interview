import { isDemoProject } from "../lib/demoProject";
import { pointTransactionRepository } from "../repositories/pointTransactionRepository";
import { projectRepository } from "../repositories/projectRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import { testOperatorRepository } from "../repositories/testOperatorRepository";
import { rewardRuleRepository } from "../repositories/rewardRuleRepository";
import { QUALITY_NEUTRAL, type AnswerQualitySignals, type QualityWeightedResult } from "../lib/qualityScore";
import { qualityScoringService } from "./qualityScoringService";
import type { PointTransaction, PointTransactionType, Respondent } from "../types/domain";

interface AwardResult {
  transactions: PointTransaction[];
  totalAwarded: number;
  updatedRespondent: Respondent;
  /** 案件完了ポイントに適用した品質の内訳（明細への記録・完了画面の表示に使う）。 */
  quality: QualityWeightedResult;
}

interface PlannedAward {
  type: PointTransactionType;
  points: number;
  reason: string;
}

export const pointService = {
  async awardCompletionPoints(input: {
    respondent: Respondent;
    sessionId: string;
    projectId: string;
    projectRewardPoints: number;
    lineUserId: string;
    /** 品質判定のシグナル（回答内容・所要時間）。未指定なら判定材料なし＝満額。 */
    qualitySignals?: AnswerQualitySignals;
  }): Promise<AwardResult> {
    // デモ案件 (Migration 120) は必ず 0pt。完了経路（フォーム/チャット/会員化時の保留付与）が
    // すべてここを通るので、呼び出し側の付け忘れや案件のポイント設定ミスがあっても付与されない。
    // 明細を作らない＝保留付与（awardDeferredCompletionsForMember）からも「未付与」に見えるが、
    // そちらも毎回ここで 0 になるので二重にも漏れにもならない。
    const project = await projectRepository.getById(input.projectId);
    if (isDemoProject(project)) {
      return {
        transactions: [],
        totalAwarded: 0,
        updatedRespondent: input.respondent,
        quality: { points: 0, basePoints: 0, factor: QUALITY_NEUTRAL, reasons: [], isFullAmount: false },
      };
    }

    // テスト運営者（migration 119）の回答は何度でもやり直せるため、付与すると無限に増える。
    // 完了ステータスだけ進めて 0pt で返す（全完了経路がここを通るので、判定はここに集約する）。
    // 判定中に印を付けておき、エクスポート等の集計からもこの回答を外す。
    if (input.respondent.is_test || (await testOperatorRepository.isTestOperator(input.lineUserId))) {
      if (!input.respondent.is_test) await respondentRepository.markTest(input.respondent.id);
      const updatedRespondent = await respondentRepository.update(input.respondent.id, { status: "completed" });
      return {
        transactions: [],
        totalAwarded: 0,
        updatedRespondent: { ...updatedRespondent, is_test: true },
        quality: {
          points: 0,
          basePoints: input.projectRewardPoints,
          factor: QUALITY_NEUTRAL,
          reasons: [],
          isFullAmount: false
        }
      };
    }

    const rules = await rewardRuleRepository.listActive(input.projectId);
    const previousCompletedCount = await respondentRepository.countCompletedByLineUser(input.lineUserId);
    const continuityRule = rules.find((rule) => rule.rule_code === "continuity_completion_bonus");
    const firstRule = rules.find((rule) => rule.rule_code === "first_completion_bonus");
    const projectBonusRule = rules.find((rule) => rule.rule_code === "project_completion_bonus");

    // 品質係数は「案件完了ポイント」本体にだけ掛ける。
    // 初回/継続ボーナスは回答の質ではなく行動（続けたこと）への対価なので対象外にする。
    // 絶対キャップ（maxPenaltyPoints）があるので、高単価案件でも罰ゲーム化しない。
    const completionAward = await qualityScoringService.resolveAward({
      basePoints: input.projectRewardPoints,
      lineUserId: input.lineUserId,
      signals: input.qualitySignals ?? {},
    });

    const planned: PlannedAward[] = [
      {
        type: "project_completion",
        points: completionAward.points,
        reason: "案件完了ポイント"
      }
    ];

    if (previousCompletedCount === 0 && firstRule) {
      planned.push({
        type: "first_bonus",
        points: firstRule.points,
        reason: firstRule.rule_name
      });
    }

    if (previousCompletedCount > 0 && continuityRule) {
      planned.push({
        type: "continuity_bonus",
        points: continuityRule.points,
        reason: continuityRule.rule_name
      });
    }

    if (projectBonusRule) {
      planned.push({
        type: "project_bonus",
        points: projectBonusRule.points,
        reason: projectBonusRule.rule_name
      });
    }

    const transactions: PointTransaction[] = [];
    for (const item of planned) {
      const transaction = await pointTransactionRepository.create({
        respondent_id: input.respondent.id,
        session_id: input.sessionId,
        project_id: input.projectId,
        transaction_type: item.type,
        points: item.points,
        reason: item.reason
      });
      transactions.push(transaction);
    }

    const totalAwarded = planned.reduce((sum, item) => sum + item.points, 0);
    const updatedRespondent = await respondentRepository.update(input.respondent.id, {
      total_points: input.respondent.total_points + totalAwarded,
      status: "completed"
    });

    return {
      transactions,
      totalAwarded,
      updatedRespondent,
      quality: completionAward
    };
  },

  async manualAdjust(input: {
    respondentId: string;
    sessionId?: string | null;
    projectId?: string | null;
    points: number;
    reason: string;
  }): Promise<PointTransaction> {
    const respondent = await respondentRepository.getById(input.respondentId);
    const transaction = await pointTransactionRepository.create({
      respondent_id: input.respondentId,
      session_id: input.sessionId ?? null,
      project_id: input.projectId ?? null,
      transaction_type: "manual_adjustment",
      points: input.points,
      reason: input.reason
    });

    await respondentRepository.update(input.respondentId, {
      total_points: respondent.total_points + input.points
    });

    return transaction;
  }
};
