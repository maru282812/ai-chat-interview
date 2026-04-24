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
import { userProfileRepository } from "../repositories/userProfileRepository";
import type {
  MaritalStatus,
  Project,
  ProjectAssignment,
  ProjectAssignmentStatus,
  Rank,
  Respondent,
  Session,
  UserProfile
} from "../types/domain";
import { lineMessagingService } from "./lineMessagingService";
import { buildProjectStartUrl } from "./liffService";
import { buildProjectStartFlex } from "../templates/flex";

export interface AssignmentRuleFilter {
  rank_code?: string | null;
  total_points_min?: number | null;
  total_points_max?: number | null;
  has_participated?: boolean | null;
  last_participated_before?: string | null;
  unanswered_project_id?: string | null;
  // 基本情報条件
  age_min?: number | null;
  age_max?: number | null;
  prefectures?: string[] | null;
  occupations?: string[] | null;
  industries?: string[] | null;
  marital_statuses?: MaritalStatus[] | null;
  has_children?: boolean | null;
  household_compositions?: string[] | null;
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
  target_assignment_deadline: string | null;
  target_completed: boolean;
  // 基本情報
  profile: UserProfile | null;
  age: number | null;
}

export interface ProjectAssignmentListItem {
  assignment: ProjectAssignmentRecord;
  isExpired: boolean;
  canSend: boolean;
  isUnanswered: boolean;
}

export interface ProjectDeliveryStats {
  targetCount: number;
  unansweredCount: number;
  completedCount: number;
  expiredCount: number;
  completionRate: number;
}

export interface ProjectDeliveryOverview {
  project: Project;
  candidates: DeliveryCandidate[];
  assignments: ProjectAssignmentListItem[];
  unansweredAssignments: ProjectAssignmentListItem[];
  ranks: Rank[];
  projects: Project[];
  stats: ProjectDeliveryStats;
}

export interface AssignmentContext {
  assignment: ProjectAssignment;
  respondent: Respondent & { current_rank?: Rank | null };
}

interface GroupedRespondent {
  key: string;
  respondents: (Respondent & { current_rank?: Rank | null })[];
}

const ACTIVE_ASSIGNMENT_STATUSES = new Set<ProjectAssignmentStatus>([
  "assigned",
  "sent",
  "opened",
  "started"
]);

const TERMINAL_ASSIGNMENT_STATUSES = new Set<ProjectAssignmentStatus>([
  "completed",
  "expired",
  "cancelled"
]);

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
    case "assigned":
      return 3;
    case "pending":
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

function formatDeadline(deadline: string | null): string | null {
  if (!deadline) {
    return null;
  }

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(deadline));
}

function buildAssignmentPushText(project: Project, deadline: string | null): string {
  const lines = [`新しいインタビュー案件「${project.name}」を配信しました。`];
  if (deadline) {
    lines.push(`回答期限: ${formatDeadline(deadline)}`);
  }
  lines.push("参加するには「案件一覧」と送信してください。");
  return lines.join("\n");
}

function buildAssignmentLinePushText(project: Project, deadline: string | null): string {
  const lines = [
    `新しいインタビュー案件「${project.name}」を配信しました。`,
    "このままLINEトークで回答できます。"
  ];
  if (deadline) {
    lines.push(`回答期限: ${formatDeadline(deadline)}`);
  }
  lines.push("開始するには「はじめる」と送信してください。");
  return lines.join("\n");
}

function buildReminderPushText(deadline: string | null): string {
  const lines = ["まだ回答が完了していません。期限までにご回答ください。"];
  if (deadline) {
    lines.push(`回答期限: ${formatDeadline(deadline)}`);
  }
  lines.push("続きから再開するには「再開」と送信してください。");
  return lines.join("\n");
}

function buildLineReminderPushText(deadline: string | null): string {
  const lines = ["まだ回答が完了していません。期限までにご回答ください。"];
  if (deadline) {
    lines.push(`回答期限: ${formatDeadline(deadline)}`);
  }
  lines.push("続きから回答するには「再開」または「はじめる」と送信してください。");
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

function calcAge(birthDate: string | null): number | null {
  if (!birthDate) {
    return null;
  }
  const today = new Date();
  const birth = new Date(birthDate);
  let age = today.getFullYear() - birth.getFullYear();
  const monthDelta = today.getMonth() - birth.getMonth();
  if (monthDelta < 0 || (monthDelta === 0 && today.getDate() < birth.getDate())) {
    age -= 1;
  }
  return age;
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

  // 基本情報条件
  if (typeof filter.age_min === "number") {
    if (candidate.age === null || candidate.age < filter.age_min) {
      return false;
    }
  }

  if (typeof filter.age_max === "number") {
    if (candidate.age === null || candidate.age > filter.age_max) {
      return false;
    }
  }

  if (filter.prefectures && filter.prefectures.length > 0) {
    const prefecture = candidate.profile?.prefecture ?? null;
    if (!prefecture || !filter.prefectures.includes(prefecture)) {
      return false;
    }
  }

  if (filter.occupations && filter.occupations.length > 0) {
    const occupation = candidate.profile?.occupation ?? null;
    if (!occupation || !filter.occupations.includes(occupation)) {
      return false;
    }
  }

  if (filter.industries && filter.industries.length > 0) {
    const industry = candidate.profile?.industry ?? null;
    if (!industry || !filter.industries.includes(industry)) {
      return false;
    }
  }

  if (filter.marital_statuses && filter.marital_statuses.length > 0) {
    const maritalStatus = candidate.profile?.marital_status ?? null;
    if (!maritalStatus || !filter.marital_statuses.includes(maritalStatus)) {
      return false;
    }
  }

  if (typeof filter.has_children === "boolean") {
    const hasChildren = candidate.profile?.has_children ?? null;
    if (hasChildren === null || hasChildren !== filter.has_children) {
      return false;
    }
  }

  if (filter.household_compositions && filter.household_compositions.length > 0) {
    const composition = candidate.profile?.household_composition ?? [];
    const hasOverlap = filter.household_compositions.some((item) => composition.includes(item));
    if (!hasOverlap) {
      return false;
    }
  }

  return true;
}

function isUnansweredStatus(status: ProjectAssignmentStatus): boolean {
  return ACTIVE_ASSIGNMENT_STATUSES.has(status);
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

function buildStats(items: ProjectAssignmentListItem[]): ProjectDeliveryStats {
  const targetCount = items.length;
  const unansweredCount = items.filter((item) => item.isUnanswered).length;
  const completedCount = items.filter((item) => item.assignment.status === "completed").length;
  const expiredCount = items.filter((item) => item.assignment.status === "expired").length;

  return {
    targetCount,
    unansweredCount,
    completedCount,
    expiredCount,
    completionRate: targetCount === 0 ? 0 : Math.round((completedCount / targetCount) * 1000) / 10
  };
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
    reminderSentAt?: string | null;
    error?: string | null;
    deliveryEvent: Record<string, unknown>;
  }
): Promise<ProjectAssignment> {
  return projectAssignmentRepository.update(assignment.id, {
    status: input.status ?? assignment.status,
    sent_at: input.sentAt ?? assignment.sent_at,
    reminder_sent_at: input.reminderSentAt ?? assignment.reminder_sent_at,
    last_delivery_error: input.error ?? null,
    delivery_log: appendDeliveryLog(assignment.delivery_log, input.deliveryEvent)
  });
}

export const assignmentService = {
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

    const lineUserIds = [
      ...new Set(
        respondents
          .map((item) => item.line_user_id)
          .filter((id): id is string => Boolean(id))
      )
    ];
    const profiles = await userProfileRepository.listByLineUserIds(lineUserIds);
    const profileByLineUserId = new Map(profiles.map((p) => [p.line_user_id, p]));

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

        const profile = hasLineUserId(pointLeader.line_user_id)
          ? profileByLineUserId.get(pointLeader.line_user_id) ?? null
          : null;
        const age = calcAge(profile?.birth_date ?? null);

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
          target_assignment_deadline: targetAssignment?.deadline ?? targetAssignment?.due_at ?? null,
          target_completed:
            targetSessions.some((session) => session.status === "completed") ||
            targetAssignment?.status === "completed",
          profile,
          age
        };
      })
      .sort(candidateSort);

    const assignmentItems = assignments.map((assignment) => {
      const effectiveDeadline = assignment.deadline ?? assignment.due_at ?? null;
      const isExpired =
        assignment.status === "expired" ||
        (Boolean(effectiveDeadline) &&
          !TERMINAL_ASSIGNMENT_STATUSES.has(assignment.status) &&
          String(effectiveDeadline) < new Date().toISOString());

      return {
        assignment: {
          ...assignment,
          deadline: effectiveDeadline
        },
        isExpired,
        canSend: hasLineUserId(assignment.respondent?.line_user_id),
        isUnanswered: isUnansweredStatus(assignment.status)
      };
    });

    return {
      project,
      candidates,
      assignments: assignmentItems,
      unansweredAssignments: assignmentItems.filter((item) => item.isUnanswered),
      ranks,
      projects,
      stats: buildStats(assignmentItems)
    };
  },

  async assignManual(input: {
    projectId: string;
    sourceRespondentIds: string[];
    deadline: string | null;
    assignmentType?: "manual" | "rule_based";
    filterSnapshot?: Record<string, unknown> | null;
    deliveryChannel?: "liff" | "line";
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
      const nowIso = new Date().toISOString();

      const deliveryChannel = input.deliveryChannel ?? "liff";

      let assignment =
        (await projectAssignmentRepository.getByProjectAndRespondent(
          input.projectId,
          targetRespondent.id
        )) ??
        (await projectAssignmentRepository.create({
          user_id: targetRespondent.line_user_id,
          project_id: input.projectId,
          respondent_id: targetRespondent.id,
          assignment_type: input.assignmentType ?? "manual",
          status: "assigned",
          delivery_channel: deliveryChannel,
          assigned_at: nowIso,
          deadline: input.deadline,
          filter_snapshot: input.filterSnapshot ?? null
        }));

      const shouldResetLifecycle = TERMINAL_ASSIGNMENT_STATUSES.has(assignment.status);
      assignment = await projectAssignmentRepository.update(assignment.id, {
        user_id: targetRespondent.line_user_id,
        assignment_type: input.assignmentType ?? "manual",
        delivery_channel: deliveryChannel,
        filter_snapshot: input.filterSnapshot ?? null,
        deadline: input.deadline,
        last_delivery_error: null,
        ...(shouldResetLifecycle
          ? {
              status: "assigned",
              assigned_at: nowIso,
              sent_at: null,
              opened_at: null,
              started_at: null,
              completed_at: null,
              expired_at: null,
              reminder_sent_at: null
            }
          : {})
      });

      if (!hasLineUserId(targetRespondent.line_user_id)) {
        await persistAssignmentDeliveryResult(assignment, {
          error: "LINE user id is missing",
          deliveryEvent: {
            at: nowIso,
            result: "failure",
            type: "push_skipped",
            assignment_type: input.assignmentType ?? "manual",
            error: "LINE user id is missing"
          }
        });
        failedCount += 1;
        continue;
      }

      try {
        if (deliveryChannel === "line") {
          await lineMessagingService.push(targetRespondent.line_user_id, [
            {
              type: "text",
              text: buildAssignmentLinePushText(project, input.deadline)
            }
          ]);
        } else {
          const { url } = buildProjectStartUrl(assignment.id);
          await lineMessagingService.push(targetRespondent.line_user_id, [
            buildProjectStartFlex({ projectName: project.name, url })
          ]);
        }

        await persistAssignmentDeliveryResult(assignment, {
          status: assignment.status === "assigned" ? "sent" : assignment.status,
          sentAt: nowIso,
          deliveryEvent: {
            at: nowIso,
            result: "success",
            type: deliveryChannel === "line" ? "invite_push_line" : "invite_push_liff",
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
            at: nowIso,
            result: "failure",
            type: deliveryChannel === "line" ? "invite_push_line" : "invite_push_liff",
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
    deadline: string | null;
  }): Promise<{ matchedCount: number; sentCount: number; failedCount: number }> {
    const overview = await this.getProjectDeliveryOverview(input.projectId);
    const targets = overview.candidates.filter((candidate) => ruleMatches(candidate, input.rule));
    const result = await this.assignManual({
      projectId: input.projectId,
      sourceRespondentIds: targets.map((candidate) => candidate.source_respondent_id),
      deadline: input.deadline,
      assignmentType: "rule_based",
      filterSnapshot: input.rule as Record<string, unknown>
    });

    return {
      matchedCount: targets.length,
      sentCount: result.sentCount,
      failedCount: result.failedCount
    };
  },

  async sendReminders(projectId: string): Promise<{ remindedCount: number; failedCount: number }> {
    const overview = await this.getProjectDeliveryOverview(projectId);
    let remindedCount = 0;
    let failedCount = 0;

    for (const item of overview.unansweredAssignments) {
      const lineUserId = item.assignment.respondent?.line_user_id ?? item.assignment.user_id;
      const reminderAt = new Date().toISOString();

      if (!hasLineUserId(lineUserId)) {
        failedCount += 1;
        await persistAssignmentDeliveryResult(item.assignment, {
          error: "LINE user id is missing",
          deliveryEvent: {
            at: reminderAt,
            result: "failure",
            type: "reminder_push",
            error: "LINE user id is missing"
          }
        });
        continue;
      }

      const isLiff = item.assignment.delivery_channel !== "line";
      try {
        if (isLiff) {
          const { url } = buildProjectStartUrl(item.assignment.id);
          await lineMessagingService.push(lineUserId, [
            buildProjectStartFlex({ projectName: overview.project.name, url })
          ]);
        } else {
          await lineMessagingService.push(lineUserId, [
            {
              type: "text",
              text: buildLineReminderPushText(item.assignment.deadline)
            }
          ]);
        }
        await persistAssignmentDeliveryResult(item.assignment, {
          reminderSentAt: reminderAt,
          deliveryEvent: {
            at: reminderAt,
            result: "success",
            type: isLiff ? "reminder_push_liff" : "reminder_push_line"
          }
        });
        remindedCount += 1;
      } catch (error) {
        logger.error("Failed to send assignment reminder", {
          assignmentId: item.assignment.id,
          projectId,
          error: error instanceof Error ? error.message : String(error)
        });
        await persistAssignmentDeliveryResult(item.assignment, {
          error: error instanceof Error ? error.message : String(error),
          deliveryEvent: {
            at: reminderAt,
            result: "failure",
            type: isLiff ? "reminder_push_liff" : "reminder_push_line",
            error: error instanceof Error ? error.message : String(error)
          }
        });
        failedCount += 1;
      }
    }

    return { remindedCount, failedCount };
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
    const assignments = await projectAssignmentRepository.listActiveByUserId(lineUserId);
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

    return {
      assignment: {
        ...assignment,
        deadline: assignment.deadline ?? assignment.due_at ?? null
      },
      respondent: resolvedRespondent
    };
  },

  async markAssignmentOpened(assignmentId: string): Promise<ProjectAssignment | null> {
    const assignment = await projectAssignmentRepository.getById(assignmentId);
    if (!ACTIVE_ASSIGNMENT_STATUSES.has(assignment.status)) {
      return assignment;
    }

    if (assignment.status === "opened" || assignment.status === "started") {
      return assignment;
    }

    return projectAssignmentRepository.update(assignment.id, {
      status: "opened",
      opened_at: assignment.opened_at ?? new Date().toISOString()
    });
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

    if (TERMINAL_ASSIGNMENT_STATUSES.has(assignment.status)) {
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
      user_id: item.assignment.user_id,
      respondent_id: item.assignment.respondent_id,
      display_name: item.assignment.respondent?.display_name ?? null,
      line_user_id: item.assignment.respondent?.line_user_id ?? null,
      status: item.assignment.status,
      assignment_type: item.assignment.assignment_type,
      assigned_at: item.assignment.assigned_at,
      deadline: item.assignment.deadline,
      sent_at: item.assignment.sent_at,
      opened_at: item.assignment.opened_at,
      started_at: item.assignment.started_at,
      completed_at: item.assignment.completed_at,
      expired_at: item.assignment.expired_at,
      reminder_sent_at: item.assignment.reminder_sent_at,
      expired: item.isExpired,
      last_delivery_error: item.assignment.last_delivery_error
    }));
  },

  async exportUnanswered(projectId: string): Promise<Record<string, string | number | boolean | null>[]> {
    const overview = await this.getProjectDeliveryOverview(projectId);
    return overview.unansweredAssignments.map((item) => ({
      project_id: overview.project.id,
      project_name: overview.project.name,
      user_id: item.assignment.user_id,
      respondent_id: item.assignment.respondent_id,
      display_name: item.assignment.respondent?.display_name ?? null,
      line_user_id: item.assignment.respondent?.line_user_id ?? null,
      status: item.assignment.status,
      assigned_at: item.assignment.assigned_at,
      deadline: item.assignment.deadline,
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
        user_id: item.assignment.user_id,
        respondent_id: item.assignment.respondent_id,
        display_name: item.assignment.respondent?.display_name ?? null,
        line_user_id: item.assignment.respondent?.line_user_id ?? null,
        status: item.assignment.status,
        assigned_at: item.assignment.assigned_at,
        deadline: item.assignment.deadline,
        sent_at: item.assignment.sent_at,
        started_at: item.assignment.started_at,
        completed_at: item.assignment.completed_at,
        expired_at: item.assignment.expired_at,
        last_delivery_error: item.assignment.last_delivery_error
      }));
  }
};
