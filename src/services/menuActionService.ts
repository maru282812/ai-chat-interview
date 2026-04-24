import { projectAssignmentRepository } from "../repositories/projectAssignmentRepository";
import { projectRepository } from "../repositories/projectRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { assignmentService } from "./assignmentService";
import { rankService } from "./rankService";
import { respondentService } from "./respondentService";
import type {
  LineMessage,
  Project,
  ProjectAssignment,
  ProjectAssignmentStatus,
  Respondent,
  Session
} from "../types/domain";

type MenuCommand = "project_list" | "resume" | "points" | "rank";

export type MenuActionResolution =
  | { handled: false }
  | { handled: true; behavior: "reply"; messages: LineMessage[] }
  | {
      handled: true;
      behavior: "start";
      respondentId: string;
      projectId: string;
      assignmentId: string | null;
      leadMessage?: string | null;
    }
  | {
      handled: true;
      behavior: "resume";
      session: Session;
      assignmentId: string | null;
      leadMessage?: string | null;
    }
  | {
      handled: true;
      behavior: "liff_redirect";
      assignmentId: string;
      projectId: string;
      projectName: string;
    };

interface ProjectContext {
  project: Project;
  respondent: Respondent & { current_rank?: unknown | null };
  assignment: ProjectAssignment;
  sessions: Session[];
}

interface PendingSelection {
  assignmentIds: string[];
  expiresAt: number;
}

const PENDING_SELECTION_TTL_MS = 10 * 60 * 1000;

const pendingSelections = new Map<string, PendingSelection>();

const ACTIVE_ASSIGNMENT_PRIORITY: Record<ProjectAssignmentStatus, number> = {
  started: 0,
  opened: 1,
  sent: 2,
  assigned: 3,
  pending: 4,
  completed: 5,
  expired: 6,
  cancelled: 7
};

function buildTextMessage(text: string): LineMessage {
  return { type: "text", text };
}

function normalizeText(text: string): string {
  return text.trim();
}

function detectMenuCommand(text: string): MenuCommand | null {
  switch (normalizeText(text)) {
    case "案件一覧":
      return "project_list";
    case "再開":
      return "resume";
    case "ポイント確認":
      return "points";
    case "ランク確認":
      return "rank";
    default:
      return null;
  }
}

function isNumericSelection(text: string): boolean {
  return /^\d+$/.test(normalizeText(text));
}

function setPendingSelection(lineUserId: string, assignmentIds: string[]): void {
  pendingSelections.set(lineUserId, {
    assignmentIds,
    expiresAt: Date.now() + PENDING_SELECTION_TTL_MS
  });
}

function consumePendingSelection(lineUserId: string): PendingSelection | null {
  const current = pendingSelections.get(lineUserId) ?? null;
  if (!current) {
    return null;
  }

  if (current.expiresAt <= Date.now()) {
    pendingSelections.delete(lineUserId);
    return null;
  }

  return current;
}

function clearPendingSelection(lineUserId: string): void {
  pendingSelections.delete(lineUserId);
}

function selectActiveSession(sessions: Session[]): Session | null {
  return (
    sessions.find((session) => session.status === "active" || session.status === "pending") ?? null
  );
}

function formatAssignmentDeadline(deadline: string | null | undefined): string {
  if (!deadline) {
    return "-";
  }

  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric"
  }).format(new Date(deadline));
}

function formatAssignmentProgress(context: ProjectContext): string {
  const activeSession = selectActiveSession(context.sessions);
  if (activeSession) {
    return "進行中";
  }

  return context.assignment.status === "started" ? "進行中" : "未開始";
}

async function buildProjectContexts(lineUserId: string): Promise<ProjectContext[]> {
  await assignmentService.expireOverdueAssignments();

  const respondents = await respondentService.listByLineUserId(lineUserId);
  if (respondents.length === 0) {
    return [];
  }

  const respondentIds = respondents.map((respondent) => respondent.id);
  const [assignments, sessions, projects] = await Promise.all([
    projectAssignmentRepository.listActionableByUserId(lineUserId),
    sessionRepository.listByRespondentIds(respondentIds),
    projectRepository.list()
  ]);

  const respondentById = new Map(respondents.map((respondent) => [respondent.id, respondent] as const));
  const projectById = new Map(projects.map((project) => [project.id, project] as const));
  const sessionsByRespondentId = new Map<string, Session[]>();

  for (const session of sessions) {
    const list = sessionsByRespondentId.get(session.respondent_id) ?? [];
    list.push(session);
    sessionsByRespondentId.set(session.respondent_id, list);
  }

  return assignments
    .map((assignment): ProjectContext | null => {
      const respondent = respondentById.get(assignment.respondent_id) ?? null;
      const project = projectById.get(assignment.project_id) ?? null;
      if (!respondent || !project) {
        return null;
      }

      return {
        project,
        respondent,
        assignment,
        sessions: sessionsByRespondentId.get(respondent.id) ?? []
      };
    })
    .filter((context): context is ProjectContext => Boolean(context))
    .sort((left, right) => {
      const priorityDelta =
        ACTIVE_ASSIGNMENT_PRIORITY[left.assignment.status] -
        ACTIVE_ASSIGNMENT_PRIORITY[right.assignment.status];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return right.assignment.updated_at.localeCompare(left.assignment.updated_at);
    });
}

async function listAvailableProjectContexts(lineUserId: string): Promise<ProjectContext[]> {
  return buildProjectContexts(lineUserId);
}

async function resolveSelectionAction(input: {
  lineUserId: string;
  displayName?: string | null;
  text: string;
}): Promise<MenuActionResolution> {
  const pending = consumePendingSelection(input.lineUserId);
  if (!pending || !isNumericSelection(input.text)) {
    return { handled: false };
  }

  const selectedIndex = Number(normalizeText(input.text)) - 1;
  const selectedAssignmentId = pending.assignmentIds[selectedIndex] ?? null;
  if (!selectedAssignmentId) {
    return {
      handled: true,
      behavior: "reply",
      messages: [
        buildTextMessage("該当する案件番号が見つかりません。案件一覧をもう一度送信してください。")
      ]
    };
  }

  const availableContexts = await listAvailableProjectContexts(input.lineUserId);
  const selectedContext =
    availableContexts.find((context) => context.assignment.id === selectedAssignmentId) ?? null;
  clearPendingSelection(input.lineUserId);

  if (!selectedContext) {
    return {
      handled: true,
      behavior: "reply",
      messages: [
        buildTextMessage("選択した案件は現在開始できません。案件一覧をもう一度送信してください。")
      ]
    };
  }

  const assignment =
    (await assignmentService.markAssignmentOpened(selectedContext.assignment.id)) ??
    selectedContext.assignment;

  return {
    handled: true,
    behavior: "liff_redirect",
    assignmentId: assignment.id,
    projectId: selectedContext.project.id,
    projectName: selectedContext.project.name
  };
}

async function resolveResumeAction(input: {
  lineUserId: string;
  displayName?: string | null;
}): Promise<MenuActionResolution> {
  clearPendingSelection(input.lineUserId);
  await assignmentService.expireOverdueAssignments();

  const respondents = await respondentService.listByLineUserId(input.lineUserId);
  if (respondents.length === 0) {
    return {
      handled: true,
      behavior: "reply",
      messages: [buildTextMessage("再開できる案件はありません")]
    };
  }

  const respondentIds = respondents.map((respondent) => respondent.id);
  const projectsById = new Map(
    (await projectRepository.list()).map((project) => [project.id, project] as const)
  );
  const [assignments, sessions] = await Promise.all([
    projectAssignmentRepository.listByRespondentIds(respondentIds),
    sessionRepository.listByRespondentIds(respondentIds)
  ]);

  const activeSession = [...sessions]
    .filter((session) => session.status === "active" || session.status === "pending")
    .sort((left, right) => right.last_activity_at.localeCompare(left.last_activity_at))[0];
  if (activeSession?.current_question_id) {
    const assignment =
      assignments.find(
        (item) =>
          item.respondent_id === activeSession.respondent_id &&
          item.project_id === activeSession.project_id
      ) ?? null;
    if (assignment) {
      await assignmentService.markAssignmentOpened(assignment.id);
    }
    const projectName = projectsById.get(activeSession.project_id)?.name ?? "案件";
    return {
      handled: true,
      behavior: "resume",
      session: activeSession,
      assignmentId: assignment?.id ?? null,
      leadMessage: `「${projectName}」を再開します。`
    };
  }

  const assignmentCandidates = assignments
    .filter((assignment) => projectAssignmentRepository.activeStatuses.includes(assignment.status))
    .sort((left, right) => {
      const priorityDelta =
        ACTIVE_ASSIGNMENT_PRIORITY[left.status] - ACTIVE_ASSIGNMENT_PRIORITY[right.status];
      if (priorityDelta !== 0) {
        return priorityDelta;
      }
      return right.updated_at.localeCompare(left.updated_at);
    });

  const targetAssignment = assignmentCandidates[0] ?? null;
  if (!targetAssignment) {
    return {
      handled: true,
      behavior: "reply",
      messages: [buildTextMessage("再開できる案件はありません")]
    };
  }

  const respondent =
    respondents.find((item) => item.id === targetAssignment.respondent_id) ?? null;
  if (!respondent) {
    return {
      handled: true,
      behavior: "reply",
      messages: [buildTextMessage("再開できる案件はありません")]
    };
  }

  const reusableAssignment =
    (await assignmentService.markAssignmentOpened(targetAssignment.id)) ?? targetAssignment;

  const projectName = projectsById.get(targetAssignment.project_id)?.name ?? "案件";
  return {
    handled: true,
    behavior: "start",
    respondentId: respondent.id,
    projectId: targetAssignment.project_id,
    assignmentId: reusableAssignment.id,
    leadMessage: `「${projectName}」を再開します。`
  };
}

export const menuActionService = {
  async resolveTextAction(input: {
    lineUserId: string;
    displayName?: string | null;
    text: string;
  }): Promise<MenuActionResolution> {
    const command = detectMenuCommand(input.text);

    if (!command && isNumericSelection(input.text)) {
      return resolveSelectionAction(input);
    }

    if (!command) {
      return { handled: false };
    }

    switch (command) {
      case "project_list": {
        const availableContexts = await listAvailableProjectContexts(input.lineUserId);
        if (availableContexts.length === 0) {
          clearPendingSelection(input.lineUserId);
          return {
            handled: true,
            behavior: "reply",
            messages: [buildTextMessage("現在参加可能な案件はありません。")]
          };
        }

        setPendingSelection(
          input.lineUserId,
          availableContexts.map((context) => context.assignment.id)
        );

        await Promise.all(
          availableContexts.map((context) => assignmentService.markAssignmentOpened(context.assignment.id))
        );

        const lines = ["参加可能な案件", ""];
        for (const [index, context] of availableContexts.entries()) {
          lines.push(
            `${index + 1}. ${context.project.name}（${context.project.reward_points}pt / 期限: ${formatAssignmentDeadline(
              context.assignment.deadline ?? context.assignment.due_at
            )} / ${formatAssignmentProgress(context)}）`
          );
        }
        lines.push("");
        lines.push("番号を送信してください");

        return {
          handled: true,
          behavior: "reply",
          messages: [buildTextMessage(lines.join("\n"))]
        };
      }
      case "resume":
        return resolveResumeAction(input);
      case "points": {
        clearPendingSelection(input.lineUserId);
        const primaryRespondent = await respondentService.getPrimaryRespondent(input.lineUserId);
        const totalPoints = primaryRespondent?.total_points ?? 0;
        return {
          handled: true,
          behavior: "reply",
          messages: [buildTextMessage(`現在の累計ポイントは ${totalPoints}pt です。`)]
        };
      }
      case "rank": {
        clearPendingSelection(input.lineUserId);
        const primaryRespondent = await respondentService.getPrimaryRespondent(input.lineUserId);
        const totalPoints = primaryRespondent?.total_points ?? 0;
        const [currentRank, nextRank] = await Promise.all([
          rankService.resolveRank(totalPoints),
          rankService.getNextRank(totalPoints)
        ]);
        const lines = [`現在のランクは ${currentRank?.rank_name ?? "Bronze"} です。`];
        if (nextRank) {
          lines.push(`次のランクまであと ${nextRank.min_points - totalPoints}pt です。`);
        } else {
          lines.push("現在のランクが最高ランクです。");
        }

        return {
          handled: true,
          behavior: "reply",
          messages: [buildTextMessage(lines.join("\n"))]
        };
      }
    }
  }
};
