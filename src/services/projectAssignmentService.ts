import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";
import {
  projectAssignmentRepository,
  type ProjectAssignmentRecord
} from "../repositories/projectAssignmentRepository";
import { projectRepository } from "../repositories/projectRepository";
import { rankRepository } from "../repositories/rankRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { lineMessagingService } from "./lineMessagingService";
import type {
  Project,
  ProjectAssignment,
  ProjectAssignmentStatus,
  Rank,
  Respondent,
  Session
} from "../types/domain";

export interface AssignmentRuleFilter {
  rank_code?: string | null;
  total_points_min?: number | null;
  total_points_max?: number | null;
  has_participated?: boolean | null;
  last_participated_before?: string | null;
  unanswered_project_id?: string | null;
}

export interface DeliveryCandidate {
  key: string;
  source_respondent_id: string;
  target_respondent_id: string | null;
  line_user_id: string | null;
  display_name: string | null;
  has_line_user_id: boolean;
  total_points: number;
  rank_name: string | null;
  rank_code: string | null;
  last_participated_at: string | null;
  status: string;
  has_past_participation: boolean;
  completed_project_ids: string[];
  target_assignment_status: ProjectAssignmentStatus | null;
  target_assignment_due_at: string | null;
  target_completed: boolean;
}

export interface ProjectAssignmentListItem {
  assignment: ProjectAssignmentRecord;
  isExpired: boolean;
  canSend: boolean;
}

export interface ProjectDeliveryOverview {
  project: Project;
  candidates: DeliveryCandidate[];
  assignments: ProjectAssignmentListItem[];
  ranks: Rank[];
  projects: Project[];
}

interface AssignmentContext {
  assignment: ProjectAssignment;
  respondent: Respondent & { current_rank?: Rank | null };
}

interface GroupedRespondent {
  key: string;
  respondents: (Respondent & { current_rank?: Rank | null })[];
}

const ACTIVE_ASSIGNMENT_STATUSES = new Set<ProjectAssignmentStatus>(
  projectAssignmentRepository.activeStatuses
);

function hasLineUserId(lineUserId: string | null | undefined): boolean {
  return typeof lineUserId === "string" && lineUserId.trim().length > 0;
}

function assignmentPriority(status: ProjectAssignmentStatus): number {
  switch (status) {
    case "started":
      return 0;
    case "opened":
      return 1;
    case "sent":
      return 2;
    case "pending":
      return 3;
    case "assigned":
      return 4;
    case "completed":
      return 5;
    case "expired":
      return 6;
    case "cancelled":
      return 7;
  }
}

function maxIsoDate(...values: (string | null | undefined)[]): string | null {
  const filtered = values.filter((value): value is string => Boolean(value));
  return filtered.sort((left, right) => right.localeCompare(left))[0] ?? null;
}

function buildAssignmentPushText(project: Project, dueAt: string | null): string {
  const lines = [`新しいインタビュー案件「${project.name}」を配信しました。`];
  if (dueAt) {
    const due = new Date(dueAt).toLocaleString("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
    lines.push(`回答期限: ${due}`);
  }
  lines.push("開始するには「start」または「はじめる」と送信してください。");
  return lines.join("\n");
}

function appendDeliveryLog(
  current: Record<string, unknown>[] | null,
  nextEntry: Record<string, unknown>
): Record<string, unknown>[] {
  return [...(current ?? []), nextEntry].slice(-20);
}

function candidateSort(left: DeliveryCandidate, right: DeliveryCandidate): number {
  if (left.has_line_user_id !== right.has_line_user_id) {
    return left.has_line_user_id ? -1 : 1;
  }

  if (left.target_completed !== right.target_completed) {
    return left.target_completed ? 1 : -1;
  }

  const lastParticipationCompare = (right.last_participated_at ?? "").localeCompare(
    left.last_participated_at ?? ""
  );
  if (lastParticipationCompare !== 0) {
    return lastParticipationCompare;
  }

  return right.total_points - left.total_points;
}

function ruleMatches(candidate: DeliveryCandidate, filter: AssignmentRuleFilter): boolean {
  if (!candidate.has_line_user_id) {
    return false;
  }

  if (filter.rank_code && candidate.rank_code !== filter.rank_code) {
    return false;
  }

  if (
    typeof filter.total_points_min === "number" &&
    candidate.total_points < filter.total_points_min
  ) {
    return false;
  }

  if (
    typeof filter.total_points_max === "number" &&
    candidate.total_points > filter.total_points_max
  ) {
    return false;
  }

  if (
    typeof filter.has_participated === "boolean" &&
    candidate.has_past_participation !== filter.has_participated
  ) {
    return false;
  }

  if (filter.last_participated_before) {
    if (!candidate.last_participated_at) {
      return false;
    }
    if (candidate.last_participated_at >= filter.last_participated_before) {
      return false;
    }
  }

  if (
    filter.unanswered_project_id &&
    candidate.completed_project_ids.includes(filter.unanswered_project_id)
  ) {
    return false;
  }

  return true;
}

function groupRespondents(
  respondents: (Respondent & { current_rank?: Rank | null })[]
): GroupedRespondent[] {
  const groups = new Map<string, GroupedRespondent>();

  for (const respondent of respondents) {
    const key = hasLineUserId(respondent.line_user_id)
      ? respondent.line_user_id
      : `respondent:${respondent.id}`;
    const existing = groups.get(key);
    if (existing) {
      existing.respondents.push(respondent);
      continue;
    }
    groups.set(key, {
      key,
      respondents: [respondent]
    });
  }

  return [...groups.values()];
}

function selectPointLeader(group: GroupedRespondent): Respondent & { current_rank?: Rank | null } {
  return [...group.respondents].sort((left, right) => {
    if (right.total_points !== left.total_points) {
      return right.total_points - left.total_points;
    }
    return right.updated_at.localeCompare(left.updated_at);
  })[0] as Respondent & { current_rank?: Rank | null };
}

function selectLatestRespondent(group: GroupedRespondent): Respondent & { current_rank?: Rank | null } {
  return [...group.respondents].sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0] as
    | (Respondent & { current_rank?: Rank | null });
}

async function listSessionsByRespondentMap(
  respondents: (Respondent & { current_rank?: Rank | null })[]
): Promise<Map<string, Session[]>> {
  const sessions = await sessionRepository.listAll();
  const respondentIds = new Set(respondents.map((item) => item.id));
  const sessionsByRespondent = new Map<string, Session[]>();

  for (const session of sessions) {
    if (!respondentIds.has(session.respondent_id)) {
      continue;
    }
    const list = sessionsByRespondent.get(session.respondent_id) ?? [];
    list.push(session);
    sessionsByRespondent.set(session.respondent_id, list);
  }

  return sessionsByRespondent;
}

async function ensureTargetRespondent(
  projectId: string,
  sourceRespondentId: string
): Promise<Respondent & { current_rank?: Rank | null }> {
  const source = await respondentRepository.getById(sourceRespondentId);

  if (source.project_id === projectId) {
    return source;
  }

  if (!hasLineUserId(source.line_user_id)) {
    throw new HttpError(400, "LINE user id がない回答者は別案件へ割り当てできません");
  }

  const existing = await respondentRepository.getByLineUserAndProject(source.line_user_id, projectId);
  if (existing) {
    const patch: Partial<
      Pick<Respondent, "display_name" | "total_points" | "current_rank_id">
    > = {};
    if (source.display_name && existing.display_name !== source.display_name) {
      patch.display_name = source.display_name;
    }
    if (source.total_points > existing.total_points) {
      patch.total_points = source.total_points;
    }
    if (source.current_rank_id && source.current_rank_id !== existing.current_rank_id) {
      patch.current_rank_id = source.current_rank_id;
    }
    if (Object.keys(patch).length > 0) {
      return respondentRepository.update(existing.id, patch);
    }
    return existing;
  }

  return respondentRepository.create({
    line_user_id: source.line_user_id,
    display_name: source.display_name ?? null,
    project_id: projectId,
    status: "invited",
    total_points: source.total_points,
    current_rank_id: source.current_rank_id
  });
}

async function persistAssignmentDeliveryResult(
  assignment: ProjectAssignment,
  input: {
    status?: ProjectAssignmentStatus;
    sentAt?: string | null;
    error?: string | null;
    deliveryEvent: Record<string, unknown>;
  }
): Promise<ProjectAssignment> {
  return projectAssignmentRepository.update(assignment.id, {
    status: input.status ?? assignment.status,
    sent_at: input.sentAt ?? assignment.sent_at,
    last_delivery_error: input.error ?? null,
    delivery_log: appendDeliveryLog(assignment.delivery_log, input.deliveryEvent)
  });
}

export const projectAssignmentService = {
  async expireOverdueAssignments(projectId?: string): Promise<void> {
    await projectAssignmentRepository.expireOverdueAssignments(new Date().toISOString(), projectId);
  },

  async getProjectDeliveryOverview(projectId: string): Promise<ProjectDeliveryOverview> {
    await this.expireOverdueAssignments(projectId);

    const [project, assignments, respondents, ranks, projects] = await Promise.all([
      projectRepository.getById(projectId),
      projectAssignmentRepository.listByProject(projectId),
      respondentRepository.list(),
      rankRepository.list(),
      projectRepository.list()
    ]);

    const sessionsByRespondent = await listSessionsByRespondentMap(respondents);
    const assignmentsByRespondent = new Map(assignments.map((item) => [item.respondent_id, item]));

    const candidates = groupRespondents(respondents)
      .map((group): DeliveryCandidate => {
        const latestRespondent = selectLatestRespondent(group);
        const pointLeader = selectPointLeader(group);
        const targetRespondent =
          group.respondents.find((item) => item.project_id === projectId) ?? null;
        const targetSessions = targetRespondent
          ? sessionsByRespondent.get(targetRespondent.id) ?? []
          : [];
        const targetAssignment = targetRespondent
          ? assignmentsByRespondent.get(targetRespondent.id) ?? null
          : null;

        const completedProjectIds = new Set<string>();
        for (const respondent of group.respondents) {
          const sessions = sessionsByRespondent.get(respondent.id) ?? [];
          if (sessions.some((session) => session.status === "completed")) {
            completedProjectIds.add(respondent.project_id);
          }
        }
        for (const assignment of assignments) {
          if (
            assignment.status === "completed" &&
            group.respondents.some((respondent) => respondent.id === assignment.respondent_id)
          ) {
            completedProjectIds.add(assignment.project_id);
          }
        }

        const lastParticipatedAt =
          group.respondents
            .map((respondent) => {
              const sessions = sessionsByRespondent.get(respondent.id) ?? [];
              return sessions
                .map((session) =>
                  maxIsoDate(session.completed_at, session.last_activity_at, session.started_at)
                )
                .filter((value): value is string => Boolean(value))
                .sort((left, right) => right.localeCompare(left))[0] ?? null;
            })
            .filter((value): value is string => Boolean(value))
            .sort((left, right) => right.localeCompare(left))[0] ?? null;

        return {
          key: group.key,
          source_respondent_id: targetRespondent?.id ?? pointLeader.id,
          target_respondent_id: targetRespondent?.id ?? null,
          line_user_id: hasLineUserId(pointLeader.line_user_id) ? pointLeader.line_user_id : null,
          display_name: latestRespondent.display_name ?? pointLeader.display_name ?? null,
          has_line_user_id: hasLineUserId(pointLeader.line_user_id),
          total_points: pointLeader.total_points,
          rank_name: pointLeader.current_rank?.rank_name ?? null,
          rank_code: pointLeader.current_rank?.rank_code ?? null,
          last_participated_at: lastParticipatedAt,
          status: targetRespondent?.status ?? latestRespondent.status,
          has_past_participation: Boolean(lastParticipatedAt),
          completed_project_ids: [...completedProjectIds],
          target_assignment_status: targetAssignment?.status ?? null,
          target_assignment_due_at: targetAssignment?.due_at ?? null,
          target_completed:
            targetSessions.some((session) => session.status === "completed") ||
            targetAssignment?.status === "completed"
        };
      })
      .sort(candidateSort);

    return {
      project,
      candidates,
      assignments: assignments.map((assignment) => ({
        assignment,
        isExpired:
          assignment.status === "expired" ||
          (Boolean(assignment.due_at) &&
            assignment.status !== "completed" &&
            assignment.status !== "cancelled" &&
            String(assignment.due_at) < new Date().toISOString()),
        canSend: hasLineUserId(assignment.respondent?.line_user_id)
      })),
      ranks,
      projects
    };
  },

  async assignManual(input: {
    projectId: string;
    sourceRespondentIds: string[];
    dueAt: string | null;
    assignmentType?: "manual" | "rule_based";
    filterSnapshot?: Record<string, unknown> | null;
  }): Promise<{ sentCount: number; failedCount: number }> {
    const uniqueIds = [...new Set(input.sourceRespondentIds.filter(Boolean))];
    if (uniqueIds.length === 0) {
      return { sentCount: 0, failedCount: 0 };
    }

    const project = await projectRepository.getById(input.projectId);
    let sentCount = 0;
    let failedCount = 0;

    for (const sourceRespondentId of uniqueIds) {
      const targetRespondent = await ensureTargetRespondent(input.projectId, sourceRespondentId);
      let assignment =
        (await projectAssignmentRepository.getByProjectAndRespondent(
          input.projectId,
          targetRespondent.id
        )) ??
        (await projectAssignmentRepository.create({
          project_id: input.projectId,
          respondent_id: targetRespondent.id,
          assignment_type: input.assignmentType ?? "manual",
          status: "pending",
          due_at: input.dueAt,
          filter_snapshot: input.filterSnapshot ?? null
        }));

      const shouldResetLifecycle =
        assignment.status === "completed" ||
        assignment.status === "expired" ||
        assignment.status === "cancelled";

      assignment = await projectAssignmentRepository.update(assignment.id, {
        assignment_type: input.assignmentType ?? "manual",
        due_at: input.dueAt,
        filter_snapshot: input.filterSnapshot ?? null,
        last_delivery_error: null,
        status: shouldResetLifecycle ? "pending" : assignment.status,
        sent_at: shouldResetLifecycle ? null : assignment.sent_at,
        opened_at: shouldResetLifecycle ? null : assignment.opened_at,
        started_at: shouldResetLifecycle ? null : assignment.started_at,
        completed_at: shouldResetLifecycle ? null : assignment.completed_at
      });

      if (!hasLineUserId(targetRespondent.line_user_id)) {
        await persistAssignmentDeliveryResult(assignment, {
          error: "LINE user id is missing",
          deliveryEvent: {
            at: new Date().toISOString(),
            result: "failure",
            type: "push_skipped",
            assignment_type: input.assignmentType ?? "manual",
            error: "LINE user id is missing"
          }
        });
        failedCount += 1;
        continue;
      }

      const deliveryAt = new Date().toISOString();
      try {
        await lineMessagingService.push(targetRespondent.line_user_id, [
          {
            type: "text",
            text: buildAssignmentPushText(project, input.dueAt)
          }
        ]);

        await persistAssignmentDeliveryResult(assignment, {
          status:
            assignment.status === "pending" || assignment.status === "assigned"
              ? "sent"
              : assignment.status,
          sentAt: deliveryAt,
          deliveryEvent: {
            at: deliveryAt,
            result: "success",
            type: "push",
            assignment_type: input.assignmentType ?? "manual"
          }
        });
        sentCount += 1;
      } catch (error) {
        logger.error("Failed to deliver assignment", {
          projectId: input.projectId,
          respondentId: targetRespondent.id,
          error: error instanceof Error ? error.message : String(error)
        });
        await persistAssignmentDeliveryResult(assignment, {
          error: error instanceof Error ? error.message : String(error),
          deliveryEvent: {
            at: deliveryAt,
            result: "failure",
            type: "push",
            assignment_type: input.assignmentType ?? "manual",
            error: error instanceof Error ? error.message : String(error)
          }
        });
        failedCount += 1;
      }
    }

    return { sentCount, failedCount };
  },

  async assignByRules(input: {
    projectId: string;
    rule: AssignmentRuleFilter;
    dueAt: string | null;
  }): Promise<{ matchedCount: number; sentCount: number; failedCount: number }> {
    const overview = await this.getProjectDeliveryOverview(input.projectId);
    const targets = overview.candidates.filter((candidate) => ruleMatches(candidate, input.rule));
    const result = await this.assignManual({
      projectId: input.projectId,
      sourceRespondentIds: targets.map((candidate) => candidate.source_respondent_id),
      dueAt: input.dueAt,
      assignmentType: "rule_based",
      filterSnapshot: input.rule as Record<string, unknown>
    });

    return {
      matchedCount: targets.length,
      sentCount: result.sentCount,
      failedCount: result.failedCount
    };
  },

  async resolveConversationContext(
    lineUserId: string,
    displayName?: string | null
  ): Promise<AssignmentContext | null> {
    await this.expireOverdueAssignments();

    const respondents = await respondentRepository.listByLineUserId(lineUserId);
    if (respondents.length === 0) {
      return null;
    }

    const respondentMap = new Map(respondents.map((item) => [item.id, item]));
    const assignments = await projectAssignmentRepository.listActiveByRespondentIds(
      respondents.map((item) => item.id)
    );
    if (assignments.length === 0) {
      return null;
    }

    const assignment = [...assignments].sort((left, right) => {
      const priorityDelta = assignmentPriority(left.status) - assignmentPriority(right.status);
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return right.updated_at.localeCompare(left.updated_at);
    })[0] as ProjectAssignment;

    const respondent = respondentMap.get(assignment.respondent_id);
    if (!respondent) {
      return null;
    }

    let resolvedRespondent = respondent;
    if (displayName && respondent.display_name !== displayName) {
      resolvedRespondent = await respondentRepository.update(respondent.id, {
        display_name: displayName
      });
    }

    let resolvedAssignment = assignment;
    if (
      assignment.status === "pending" ||
      assignment.status === "assigned" ||
      assignment.status === "sent"
    ) {
      resolvedAssignment = await projectAssignmentRepository.update(assignment.id, {
        status: "opened",
        opened_at: assignment.opened_at ?? new Date().toISOString()
      });
    }

    return {
      assignment: resolvedAssignment,
      respondent: resolvedRespondent
    };
  },

  async markAssignmentStarted(assignmentId: string): Promise<void> {
    const assignment = await projectAssignmentRepository.getById(assignmentId);
    if (!ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status)) {
      return;
    }

    await projectAssignmentRepository.update(assignment.id, {
      status: "started",
      opened_at: assignment.opened_at ?? new Date().toISOString(),
      started_at: assignment.started_at ?? new Date().toISOString()
    });
  },

  async completeAssignmentForRespondentProject(
    respondentId: string,
    projectId: string
  ): Promise<void> {
    const assignment = await projectAssignmentRepository.getByProjectAndRespondent(projectId, respondentId);
    if (!assignment) {
      return;
    }

    if (
      assignment.status === "completed" ||
      assignment.status === "cancelled" ||
      assignment.status === "expired"
    ) {
      return;
    }

    await projectAssignmentRepository.update(assignment.id, {
      status: "completed",
      completed_at: assignment.completed_at ?? new Date().toISOString()
    });
  },

  async exportAssignments(projectId: string): Promise<Record<string, string | number | boolean | null>[]> {
    const overview = await this.getProjectDeliveryOverview(projectId);
    return overview.assignments.map((item) => ({
      project_id: overview.project.id,
      project_name: overview.project.name,
      respondent_id: item.assignment.respondent_id,
      display_name: item.assignment.respondent?.display_name ?? null,
      line_user_id: item.assignment.respondent?.line_user_id ?? null,
      status: item.assignment.status,
      assignment_type: item.assignment.assignment_type,
      due_at: item.assignment.due_at ?? null,
      sent_at: item.assignment.sent_at,
      opened_at: item.assignment.opened_at,
      started_at: item.assignment.started_at,
      completed_at: item.assignment.completed_at,
      reminder_sent_at: item.assignment.reminder_sent_at,
      expired: item.isExpired,
      last_delivery_error: item.assignment.last_delivery_error
    }));
  },

  async exportUnanswered(projectId: string): Promise<Record<string, string | number | boolean | null>[]> {
    const overview = await this.getProjectDeliveryOverview(projectId);
    return overview.assignments
      .filter(
        (item) =>
          item.assignment.status !== "completed" &&
          item.assignment.status !== "cancelled" &&
          item.assignment.status !== "expired"
      )
      .map((item) => ({
        project_id: overview.project.id,
        project_name: overview.project.name,
        respondent_id: item.assignment.respondent_id,
        display_name: item.assignment.respondent?.display_name ?? null,
        line_user_id: item.assignment.respondent?.line_user_id ?? null,
        status: item.assignment.status,
        due_at: item.assignment.due_at ?? null,
        sent_at: item.assignment.sent_at,
        started_at: item.assignment.started_at,
        completed_at: item.assignment.completed_at
      }));
  },

  async exportExpired(projectId: string): Promise<Record<string, string | number | boolean | null>[]> {
    const overview = await this.getProjectDeliveryOverview(projectId);
    return overview.assignments
      .filter((item) => item.isExpired)
      .map((item) => ({
        project_id: overview.project.id,
        project_name: overview.project.name,
        respondent_id: item.assignment.respondent_id,
        display_name: item.assignment.respondent?.display_name ?? null,
        line_user_id: item.assignment.respondent?.line_user_id ?? null,
        status: item.assignment.status,
        due_at: item.assignment.due_at ?? null,
        sent_at: item.assignment.sent_at,
        started_at: item.assignment.started_at,
        completed_at: item.assignment.completed_at,
        last_delivery_error: item.assignment.last_delivery_error
      }));
  }
};
