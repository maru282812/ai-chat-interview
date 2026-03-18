import { pointTransactionRepository } from "../repositories/pointTransactionRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import { rewardRuleRepository } from "../repositories/rewardRuleRepository";
import type { PointTransaction, PointTransactionType, Respondent } from "../types/domain";

interface AwardResult {
  transactions: PointTransaction[];
  totalAwarded: number;
  updatedRespondent: Respondent;
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
  }): Promise<AwardResult> {
    const rules = await rewardRuleRepository.listActive(input.projectId);
    const previousCompletedCount = await respondentRepository.countCompletedByLineUser(input.lineUserId);
    const continuityRule = rules.find((rule) => rule.rule_code === "continuity_completion_bonus");
    const firstRule = rules.find((rule) => rule.rule_code === "first_completion_bonus");
    const projectBonusRule = rules.find((rule) => rule.rule_code === "project_completion_bonus");

    const planned: PlannedAward[] = [
      {
        type: "project_completion",
        points: input.projectRewardPoints,
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
      updatedRespondent
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
