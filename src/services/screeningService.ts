import { logger } from "../lib/logger";
import { projectAssignmentRepository } from "../repositories/projectAssignmentRepository";
import { projectRepository } from "../repositories/projectRepository";
import type { ScreeningPassAction, ScreeningResult } from "../types/domain";
import { lineMessagingService } from "./lineMessagingService";

const DEFAULT_PASS_MESSAGE = "スクリーニングを通過しました。次のステップへお進みください。";
const DEFAULT_FAIL_MESSAGE = "今回はご参加いただけませんでした。またの機会にご協力をお願いします。";

export interface ScreeningResultOutput {
  result: ScreeningResult;
  pass_action: ScreeningPassAction;
  message_sent: boolean;
}

export const screeningService = {
  /**
   * スクリーニング結果を記録し、通過/非通過に応じたメッセージを送信する。
   * 非通過者には必ず終了案内を送信する。
   * 通過者の pass_action に応じて次工程を返す。
   */
  async recordResult(input: {
    assignmentId: string;
    result: ScreeningResult;
    lineUserId: string;
  }): Promise<ScreeningResultOutput> {
    const assignment = await projectAssignmentRepository.getById(input.assignmentId);
    const project = await projectRepository.getById(assignment.project_id);
    const config = project.screening_config ?? {};

    const passAction: ScreeningPassAction = config.pass_action ?? "survey";

    // スクリーニング結果を保存
    await projectAssignmentRepository.update(input.assignmentId, {
      screening_result: input.result,
      screening_result_at: new Date().toISOString()
    } as Parameters<typeof projectAssignmentRepository.update>[1]);

    let messageSent = false;

    if (input.result === "failed") {
      const failMessage = config.fail_message?.trim() || DEFAULT_FAIL_MESSAGE;
      try {
        await lineMessagingService.push(input.lineUserId, [
          { type: "text", text: failMessage }
        ]);
        messageSent = true;
      } catch (error) {
        logger.error("Failed to send screening fail message", {
          assignmentId: input.assignmentId,
          error: error instanceof Error ? error.message : String(error)
        });
      }
    } else {
      // 通過者: pass_action が manual_hold の場合はメッセージ送信のみ
      if (passAction === "manual_hold") {
        const passMessage = config.pass_message?.trim() || DEFAULT_PASS_MESSAGE;
        try {
          await lineMessagingService.push(input.lineUserId, [
            { type: "text", text: passMessage }
          ]);
          messageSent = true;
        } catch (error) {
          logger.error("Failed to send screening pass message", {
            assignmentId: input.assignmentId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      } else {
        // survey / interview: pass メッセージ送信後、呼び出し元が次工程を起動する
        const passMessage = config.pass_message?.trim() || DEFAULT_PASS_MESSAGE;
        try {
          await lineMessagingService.push(input.lineUserId, [
            { type: "text", text: passMessage }
          ]);
          messageSent = true;
        } catch (error) {
          logger.error("Failed to send screening pass message", {
            assignmentId: input.assignmentId,
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }

    return { result: input.result, pass_action: passAction, message_sent: messageSent };
  },

  /**
   * プロジェクトのスクリーニング設定を更新する。
   */
  async updateScreeningConfig(
    projectId: string,
    config: {
      pass_message?: string | null;
      fail_message?: string | null;
      pass_action?: ScreeningPassAction;
    }
  ): Promise<void> {
    await projectRepository.update(projectId, { screening_config: config });
  }
};
