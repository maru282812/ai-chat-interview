import { lineMenuActionRepository } from "../repositories/lineMenuActionRepository";
import { projectAssignmentRepository } from "../repositories/projectAssignmentRepository";
import { projectRepository } from "../repositories/projectRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { buildMypageFlex } from "../templates/flex";
import { assignmentService } from "./assignmentService";
import { liffService } from "./liffService";
import { personalityService } from "./personalityService";
import { rankService } from "./rankService";
import { respondentService } from "./respondentService";
import type {
  LineMenuAction,
  LineMessage,
  Project,
  ProjectAssignment,
  ProjectAssignmentStatus,
  Respondent,
  Session
} from "../types/domain";

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

interface PendingPostCapture {
  type: "rant" | "diary";
  menuActionKey: string;
  postedOn: string | null;
  expiresAt: number;
}

const PENDING_SELECTION_TTL_MS = 10 * 60 * 1000;
const PENDING_POST_CAPTURE_TTL_MS = 10 * 60 * 1000;
const pendingSelections = new Map<string, PendingSelection>();
const pendingPostCaptures = new Map<string, PendingPostCapture>();

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

function buildLiffOpenText(input: { url: string; prompt?: string | null }): string {
  const lines = [`LIFFで入力できます: ${input.url}`];
  if (input.prompt) {
    lines.push(input.prompt);
    lines.push("開けない場合は、このままトークに送っても受け付けます。");
  }
  return lines.join("\n");
}

function normalizeText(text: string): string {
  return text.trim().toLowerCase();
}

const TOKYO_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function todayInTokyo(): string {
  return TOKYO_DATE_FORMATTER.format(new Date());
}

function canUseResolvedLiffLaunch(
  launch: Awaited<ReturnType<typeof liffService.resolveMenuActionLaunch>> | null
): launch is NonNullable<Awaited<ReturnType<typeof liffService.resolveMenuActionLaunch>>> {
  return Boolean(launch && (!launch.requiresLiffAuth || launch.liffId));
}

function buildResolvedLiffOpenText(input: { url: string; prompt?: string | null }): string {
  const lines = [`LIFFを開く: ${input.url}`];
  if (input.prompt) {
    lines.push(input.prompt);
  }
  lines.push("LIFFが開けない場合は、このままLINEトークに送ってください。");
  return lines.join("\n");
}

function buildPostModeFallbackText(action: LineMenuAction): string {
  if (typeof action.action_payload?.prompt === "string" && action.action_payload.prompt.trim()) {
    return `${action.action_payload.prompt}\nLIFFが使えないため、今回はLINEトークでそのまま受け付けます。`;
  }

  return "LIFFが使えないため、今回はLINEトークでそのまま受け付けます。";
}

function isNumericSelection(text: string): boolean {
  return /^\d+$/.test(text.trim());
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

function setPendingPostCapture(lineUserId: string, capture: Omit<PendingPostCapture, "expiresAt">): void {
  pendingPostCaptures.set(lineUserId, {
    ...capture,
    expiresAt: Date.now() + PENDING_POST_CAPTURE_TTL_MS
  });
}

function consumePendingPostCapture(lineUserId: string): PendingPostCapture | null {
  const current = pendingPostCaptures.get(lineUserId) ?? null;
  if (!current) {
    return null;
  }

  if (current.expiresAt <= Date.now()) {
    pendingPostCaptures.delete(lineUserId);
    return null;
  }

  pendingPostCaptures.delete(lineUserId);
  return current;
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

function actionAliases(action: LineMenuAction): string[] {
  const aliases = Array.isArray(action.action_payload?.aliases)
    ? action.action_payload.aliases.map((alias) => String(alias).trim().toLowerCase())
    : [];
  return [normalizeText(action.menu_key), normalizeText(action.label), ...aliases].filter(Boolean);
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
  text: string;
}): Promise<MenuActionResolution> {
  const pending = consumePendingSelection(input.lineUserId);
  if (!pending || !isNumericSelection(input.text)) {
    return { handled: false };
  }

  const selectedIndex = Number(input.text.trim()) - 1;
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

  const activeSession = selectActiveSession(selectedContext.sessions);
  const assignment =
    (await assignmentService.markAssignmentOpened(selectedContext.assignment.id)) ??
    selectedContext.assignment;

  if (activeSession?.current_question_id) {
    return {
      handled: true,
      behavior: "resume",
      session: activeSession,
      assignmentId: assignment.id,
      leadMessage: `「${selectedContext.project.name}」を再開します。`
    };
  }

  return {
    handled: true,
    behavior: "start",
    respondentId: selectedContext.respondent.id,
    projectId: selectedContext.project.id,
    assignmentId: assignment.id,
    leadMessage: `「${selectedContext.project.name}」を開始します。`
  };
}

async function resolveProjectListAction(lineUserId: string): Promise<MenuActionResolution> {
  const availableContexts = await listAvailableProjectContexts(lineUserId);
  if (availableContexts.length === 0) {
    clearPendingSelection(lineUserId);
    return {
      handled: true,
      behavior: "reply",
      messages: [buildTextMessage("現在参加可能な案件はありません。")]
    };
  }

  setPendingSelection(
    lineUserId,
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

async function resolveResumeAction(input: { lineUserId: string }): Promise<MenuActionResolution> {
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

async function resolveMyPageAction(lineUserId: string): Promise<MenuActionResolution> {
  clearPendingSelection(lineUserId);
  const primaryRespondent = await respondentService.getPrimaryRespondent(lineUserId);
  const totalPoints = primaryRespondent?.total_points ?? 0;
  const [currentRank, nextRank] = await Promise.all([
    rankService.resolveRank(totalPoints),
    rankService.getNextRank(totalPoints)
  ]);

  return {
    handled: true,
    behavior: "reply",
    messages: [
      buildMypageFlex({
        rankName: currentRank?.rank_name ?? "Bronze",
        badgeLabel: currentRank?.badge_label ?? "",
        totalPoints,
        nextRank,
        pointsToNext: nextRank ? nextRank.min_points - totalPoints : null,
        hasActiveSession: false
      })
    ]
  };
}

async function resolveDynamicAction(
  action: LineMenuAction,
  input: { lineUserId: string }
): Promise<MenuActionResolution> {
  if (action.action_type === "show_personality") {
    const [preview, launch] = await Promise.all([
      personalityService.getPreview(input.lineUserId),
      liffService.resolveMenuActionLaunch(action, {
        defaultEntryKey: "personality"
      })
    ]);

    const lines = [preview.text];
    if (canUseResolvedLiffLaunch(launch)) {
      lines.push(`詳しく見る: ${launch.url}`);
    }

    return {
      handled: true,
      behavior: "reply",
      messages: [buildTextMessage(lines.join("\n\n"))]
    };
  }

  if (action.action_type === "open_post_mode") {
    if (action.action_payload?.postType === "rant" || action.action_payload?.postType === "diary") {
      const postedOn = action.action_payload.postType === "diary" ? todayInTokyo() : null;

      setPendingPostCapture(input.lineUserId, {
        type: action.action_payload.postType,
        menuActionKey: action.menu_key,
        postedOn
      });

      const launch = await liffService.resolveMenuActionLaunch(action, {
        defaultEntryKey: action.action_payload.postType,
        params: {
          menuActionKey: action.menu_key,
          postedOn
        }
      });

      if (canUseResolvedLiffLaunch(launch)) {
        return {
          handled: true,
          behavior: "reply",
          messages: [
            buildTextMessage(
              buildResolvedLiffOpenText({
                url: launch.url,
                prompt:
                  typeof action.action_payload?.prompt === "string"
                    ? action.action_payload.prompt
                    : null
              })
            )
          ]
        };
      }

      return {
        handled: true,
        behavior: "reply",
        messages: [buildTextMessage(buildPostModeFallbackText(action))]
      };
    }
  }

  if (action.action_type === "open_liff") {
    const launch = await liffService.resolveMenuActionLaunch(action, {
      defaultEntryKey:
        typeof action.action_payload?.entryKey === "string" ? action.action_payload.entryKey : null,
      params: {
        menuActionKey: action.menu_key,
        postedOn: action.action_payload?.postType === "diary" ? todayInTokyo() : null
      }
    });

    if (canUseResolvedLiffLaunch(launch)) {
      return {
        handled: true,
        behavior: "reply",
        messages: [buildTextMessage(`LIFFを開く: ${launch.url}`)]
      };
    }

    return {
      handled: true,
      behavior: "reply",
      messages: [buildTextMessage("LIFF導線が利用できないため、今回はLINEトークで続けてください。")]
    };

    return {
      handled: true,
      behavior: "reply",
      messages: [
        buildTextMessage(launch ? `LIFFを開く: ${launch?.url ?? ""}` : "LIFF導線はまだ設定されていません。")
      ]
    };
  }

  switch (action.action_type as LineMenuAction["action_type"]) {
    case "start_project_list":
      return resolveProjectListAction(input.lineUserId);
    case "resume_project":
      return resolveResumeAction(input);
    case "show_mypage":
      return resolveMyPageAction(input.lineUserId);
    case "show_personality":
      return {
        handled: true,
        behavior: "reply",
        messages: [buildTextMessage("性格診断は次の実装フェーズで有効化します。")]
      };
    case "open_post_mode":
      if (action.action_payload?.postType === "rant" || action.action_payload?.postType === "diary") {
        setPendingPostCapture(input.lineUserId, {
          type: action.action_payload.postType,
          menuActionKey: action.menu_key,
          postedOn: action.action_payload.postType === "diary" ? todayInTokyo() : null
        });
      }
      return {
        handled: true,
        behavior: "reply",
        messages: [
          buildTextMessage(
            typeof action.action_payload?.prompt === "string"
              ? action.action_payload.prompt
              : "投稿受付は次の実装フェーズで有効化します。"
          )
        ]
      };
    case "open_liff":
      return {
        handled: true,
        behavior: "reply",
        messages: [
          buildTextMessage(
            action.liff_path
              ? `LIFF: ${action.liff_path}`
              : "LIFF導線は次の実装フェーズで有効化します。"
          )
        ]
      };
  }
}

export const menuActionServiceDb = {
  async resolveTextAction(input: {
    lineUserId: string;
    displayName?: string | null;
    text: string;
  }): Promise<MenuActionResolution> {
    if (isNumericSelection(input.text)) {
      const selection = await resolveSelectionAction({
        lineUserId: input.lineUserId,
        text: input.text
      });
      if (selection.handled) {
        return selection;
      }
    }

    const primaryRespondent = await respondentService.getPrimaryRespondent(input.lineUserId);
    const actionableContexts = await listAvailableProjectContexts(input.lineUserId);
    const activeActions = await lineMenuActionRepository.listActiveByAudience({
      userId: input.lineUserId,
      currentRank: primaryRespondent?.current_rank?.rank_code ?? null,
      totalPoints: primaryRespondent?.total_points ?? 0,
      hasActiveAssignments: actionableContexts.length > 0,
      featureFlags: []
    });

    const normalized = normalizeText(input.text);
    const matchedAction =
      activeActions.find((action) => actionAliases(action).includes(normalized)) ?? null;

    if (!matchedAction) {
      return { handled: false };
    }

    return resolveDynamicAction(matchedAction, { lineUserId: input.lineUserId });
  },

  consumePendingPostCapture(lineUserId: string) {
    return consumePendingPostCapture(lineUserId);
  }
};
