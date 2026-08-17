import { projectAssignmentRepository } from "../repositories/projectAssignmentRepository";
import { projectRepository } from "../repositories/projectRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import { cycleService } from "./cycleService";

export interface StoreEntryResolution {
  assignmentId: string;
  projectId: string;
  /** 所属サイクル (Migration 093)。サイクル案件でなければ null。 */
  cycleId: string | null;
}

/**
 * 店舗専用アンケートの流入解決サービス。
 *
 * 店舗QR / 専用URL (`/liff/store?entry_code=abc`) からの流入を受け、
 * entry_code に紐づく private_store 案件を解決し、回答に必要な
 * respondent / project_assignment を冪等に確保する。
 *
 * デイリーアンケートの「URL直アクセスで配信レコードを自動生成」する
 * パターンを projects 側に移植したもの。管理者プッシュ無しでセルフ回答に入れる。
 */
export const storeEntryService = {
  /**
   * entry_code から案件を解決し、assignment を確保して識別子を返す。
   * 案件が見つからない（未知コード / public 案件 / 非公開）場合は null。
   */
  async resolveEntry(
    entryCode: string,
    lineUserId: string,
    displayName?: string | null
  ): Promise<StoreEntryResolution | null> {
    const code = entryCode.trim();
    if (!code || !lineUserId) {
      return null;
    }

    const project = await projectRepository.getStoreProjectByEntryCode(code);
    if (!project) {
      return null;
    }

    // respondent を冪等に確保（同一 LINE ユーザー×案件で1件）
    const respondent =
      (await respondentRepository.getByLineUserAndProject(lineUserId, project.id)) ??
      (await respondentRepository.create({
        line_user_id: lineUserId,
        display_name: displayName ?? null,
        project_id: project.id,
        status: "invited"
      }));

    // 繰り返しアンケート（Migration 093）なら所属サイクルを解決する。
    // サイクル定義に属さない案件では null が返り、以降は従来どおりの挙動になる。
    const resolution = await cycleService.resolveCycleSafely(project.id, lineUserId);
    const cycleId = resolution?.cycle.id ?? null;

    // assignment を冪等に確保。
    // サイクル案件では「同じ周の中でだけ」再利用する（周が変われば新しい行になる）。
    const assignment =
      (await projectAssignmentRepository.getByProjectRespondentAndCycle(
        project.id,
        respondent.id,
        cycleId
      )) ??
      (await projectAssignmentRepository.create({
        user_id: lineUserId,
        project_id: project.id,
        respondent_id: respondent.id,
        assignment_type: "manual",
        status: "opened",
        delivery_channel: "liff",
        cycle_id: cycleId
      }));

    return { assignmentId: assignment.id, projectId: project.id, cycleId };
  }
};
