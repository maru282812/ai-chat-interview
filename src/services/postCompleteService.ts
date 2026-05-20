import { logger } from "../lib/logger";
import { rankService } from "./rankService";
import { pointService } from "./pointService";
import { lineMessagingService } from "./lineMessagingService";
import type { Session, Respondent, Project, LineTextMessage } from "../types/domain";

interface PostCompleteParams {
  assignmentId: string;
  session: Session | null;
  respondent: Respondent;
  project: Project;
  lineUserId: string | null;
}

/**
 * アンケート完了後の非同期後処理。
 * LIFF へのレスポンス返却後に呼び出す。
 * ポイント付与失敗時でも LINE 完了通知は必ず送信する。
 */
export async function runPostCompleteProcess({
  assignmentId,
  session,
  respondent,
  project,
  lineUserId,
}: PostCompleteParams): Promise<void> {
  let awardResult: Awaited<ReturnType<typeof pointService.awardCompletionPoints>> | null = null;
  let rankResult: Awaited<ReturnType<typeof rankService.syncRespondentRank>> | null = null;

  if (session && lineUserId) {
    try {
      awardResult = await pointService.awardCompletionPoints({
        respondent,
        sessionId: session.id,
        projectId: project.id,
        projectRewardPoints: project.reward_points,
        lineUserId,
      });

      rankResult = await rankService.syncRespondentRank(
        awardResult.updatedRespondent,
        "session_completed",
      );
    } catch (err) {
      logger.error("postComplete.award.failed", {
        assignmentId,
        respondentId: respondent.id,
        error: String(err),
      });
    }
  }

  if (!lineUserId) return;

  logger.info("postComplete.sendLine", { assignmentId, lineUserId });

  try {
    const messages: LineTextMessage[] = [];

    if (awardResult) {
      const [currentRank, nextRank] = await Promise.all([
        rankResult?.newRank
          ? Promise.resolve(rankResult.newRank)
          : rankService.resolveRank(awardResult.updatedRespondent.total_points),
        rankService.getNextRank(awardResult.updatedRespondent.total_points),
      ]);

      const lines = [
        `獲得ポイント: ${awardResult.totalAwarded}pt`,
        `累計ポイント: ${awardResult.updatedRespondent.total_points}pt`,
        `現在ランク: ${currentRank?.rank_name ?? "Bronze"}`,
        nextRank
          ? `次ランクまで: ${nextRank.min_points - awardResult.updatedRespondent.total_points}pt`
          : "次ランク: 最上位ランクです",
      ];
      if (rankResult?.changed && currentRank) {
        lines.push(`ランクアップ: ${currentRank.rank_name}`);
      }

      messages.push({ type: "text", text: lines.join("\n") });
    }

    messages.push({
      type: "text",
      text: "インタビューが完了しました。ご協力ありがとうございました。",
    });

    await lineMessagingService.push(lineUserId, messages);
  } catch (err) {
    logger.error("postComplete.sendLine.failed", {
      assignmentId,
      lineUserId,
      error: String(err),
    });
  }
}
