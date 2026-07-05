import { projectApplicationRepository } from "../repositories/projectApplicationRepository";
import { projectAssignmentRepository } from "../repositories/projectAssignmentRepository";
import { projectRepository } from "../repositories/projectRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import type { Project, ProjectApplication } from "../types/domain";

/** 応募失敗の理由（画面はこれをそのまま文言に変換する） */
export type ApplyFailureReason = "not_found" | "closed" | "full" | "duplicate";

export type ApplyResult =
  | { ok: false; reason: ApplyFailureReason }
  /** manual案件: 選考待ち */
  | { ok: true; mode: "manual"; application: ProjectApplication }
  /** auto案件: assignment発行済み・そのまま回答へ */
  | { ok: true; mode: "auto"; application: ProjectApplication; assignmentId: string };

export function isRecruitClosed(project: Project, now: Date = new Date()): boolean {
  const deadline = project.recruit_deadline;
  if (!deadline) return false;
  return new Date(deadline).getTime() < now.getTime();
}

/**
 * 案件応募サービス（docs/plan-site-implementation.md Phase 2）。
 *
 * 応募＝assignment発行のリクエスト。発行判断は常にサーバー側:
 * - apply_mode='auto'  : storeEntryService と同じ冪等パターンで respondent/assignment を確保し即回答へ
 * - apply_mode='manual': applied で止め、管理者の当選操作で assignment を発行
 *
 * 公開検証は getDiscoverableById（published × visibility_type='public'）を必ず通す
 * ＝ private_store 案件や非公開案件は応募APIからも見えない（誤表示遮断）。
 */
export const applicationService = {
  async apply(projectId: string, lineUserId: string, displayName?: string | null): Promise<ApplyResult> {
    const project = await projectRepository.getDiscoverableById(projectId);
    if (!project) return { ok: false, reason: "not_found" };

    if (isRecruitClosed(project)) return { ok: false, reason: "closed" };

    const maxRespondents = (project as unknown as { max_respondents?: number | null }).max_respondents ?? null;
    if (maxRespondents != null && maxRespondents > 0) {
      const active = await projectApplicationRepository.countActiveByProject(projectId);
      if (active >= maxRespondents) return { ok: false, reason: "full" };
    }

    const existing = await projectApplicationRepository.findByProjectAndUser(projectId, lineUserId);
    if (existing) return { ok: false, reason: "duplicate" };

    const applyMode = project.apply_mode ?? "manual";

    if (applyMode === "auto") {
      // respondent / assignment を冪等に確保（storeEntryService のパターン）
      const respondent =
        (await respondentRepository.getByLineUserAndProject(lineUserId, projectId)) ??
        (await respondentRepository.create({
          line_user_id: lineUserId,
          display_name: displayName ?? null,
          project_id: projectId,
          status: "invited",
        }));

      const assignment =
        (await projectAssignmentRepository.getByProjectAndRespondent(projectId, respondent.id)) ??
        (await projectAssignmentRepository.create({
          user_id: lineUserId,
          project_id: projectId,
          respondent_id: respondent.id,
          assignment_type: "manual",
          status: "opened",
          delivery_channel: "liff",
        }));

      const application = await projectApplicationRepository.create({
        project_id: projectId,
        line_user_id: lineUserId,
        respondent_id: respondent.id,
        status: "accepted",
        assignment_id: assignment.id,
      });

      return { ok: true, mode: "auto", application, assignmentId: assignment.id };
    }

    const application = await projectApplicationRepository.create({
      project_id: projectId,
      line_user_id: lineUserId,
      status: "applied",
    });
    return { ok: true, mode: "manual", application };
  },

  /** 応募取り消し。選考中（applied）のときだけ可能。 */
  async withdraw(projectId: string, lineUserId: string): Promise<{ ok: boolean }> {
    const existing = await projectApplicationRepository.findByProjectAndUser(projectId, lineUserId);
    if (!existing || existing.status !== "applied") return { ok: false };
    await projectApplicationRepository.update(existing.id, {
      status: "withdrawn",
      decided_at: new Date().toISOString(),
    });
    return { ok: true };
  },

  /** 当月応募状況（n/10件表示） */
  async getMonthlySummary(lineUserId: string): Promise<{ count: number; recommended: number }> {
    const count = await projectApplicationRepository.countMonthlyByUser(lineUserId);
    return { count, recommended: 10 };
  },

  /**
   * 当選（管理者操作）。respondent/assignment を冪等確保して application を accepted にする。
   * applied 以外（取り消し済み等）は失敗を返す。通知の送信は呼び出し側（admin）の責務。
   */
  async accept(applicationId: string): Promise<
    | { ok: false; reason: "not_found" | "invalid_status" }
    | { ok: true; application: ProjectApplication; assignmentId: string; project: Project }
  > {
    const application = await projectApplicationRepository.getById(applicationId);
    if (!application) return { ok: false, reason: "not_found" };
    if (application.status !== "applied") return { ok: false, reason: "invalid_status" };

    // 当選時点で非公開化されていても、応募済みユーザーの当選は許可する（getByIdで直接取得）
    let project: Project;
    try {
      project = await projectRepository.getById(application.project_id);
    } catch {
      return { ok: false, reason: "not_found" };
    }

    const respondent =
      (await respondentRepository.getByLineUserAndProject(application.line_user_id, application.project_id)) ??
      (await respondentRepository.create({
        line_user_id: application.line_user_id,
        display_name: null,
        project_id: application.project_id,
        status: "invited",
      }));

    const assignment =
      (await projectAssignmentRepository.getByProjectAndRespondent(application.project_id, respondent.id)) ??
      (await projectAssignmentRepository.create({
        user_id: application.line_user_id,
        project_id: application.project_id,
        respondent_id: respondent.id,
        assignment_type: "manual",
        status: "assigned",
        delivery_channel: "liff",
      }));

    const updated = await projectApplicationRepository.update(applicationId, {
      status: "accepted",
      respondent_id: respondent.id,
      assignment_id: assignment.id,
      decided_at: new Date().toISOString(),
    });

    return { ok: true, application: updated, assignmentId: assignment.id, project };
  },

  /** 落選（管理者操作）。applied のみ rejected にできる。 */
  async reject(applicationId: string, note?: string | null): Promise<
    | { ok: false; reason: "not_found" | "invalid_status" }
    | { ok: true; application: ProjectApplication }
  > {
    const application = await projectApplicationRepository.getById(applicationId);
    if (!application) return { ok: false, reason: "not_found" };
    if (application.status !== "applied") return { ok: false, reason: "invalid_status" };

    const updated = await projectApplicationRepository.update(applicationId, {
      status: "rejected",
      note: note ?? null,
      decided_at: new Date().toISOString(),
    });
    return { ok: true, application: updated };
  },
};
