import { env } from "../config/env";
import { logger } from "../lib/logger";
import {
  evaluateAudienceRule,
  lineMenuActionRepository,
  type MenuAudienceContext
} from "../repositories/lineMenuActionRepository";
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

interface PendingPostCapture {
  type: "rant" | "diary";
  menuActionKey: string;
  postedOn: string | null;
  expiresAt: number;
}

type MenuActionFinalDecision =
  | "NO_RESPONDENT"
  | "NO_ASSIGNMENTS"
  | "NO_CONTEXTS"
  | "ACTION_FILTERED_BY_AUDIENCE_RULE"
  | "ACTION_TEXT_NOT_MATCHED"
  | "PROJECT_LIST_EXECUTED"
  | "LINE_REPLY_FAILED"
  | "UNKNOWN";

type ProjectContextSourceType = "user_id経由" | "respondent_id経由" | "user_id経由+respondent_id経由";

interface ProjectContextBuildDiagnostics {
  respondentCount: number;
  respondentIds: string[];
  assignmentsByUserIdCount: number;
  assignmentsByRespondentIdCount: number;
  mergedAssignmentsCount: number;
  contextReason: "NO_RESPONDENT" | "NO_ASSIGNMENTS" | "NO_CONTEXTS" | null;
}

interface ProjectContextCandidate {
  assignment: ProjectAssignment;
  sourceType: ProjectContextSourceType;
}

interface ProjectContextBuildResult {
  contexts: ProjectContext[];
  diagnostics: ProjectContextBuildDiagnostics;
  candidates: ProjectContextCandidate[];
  sourceTypeByAssignmentId: Map<string, ProjectContextSourceType>;
}

interface ActionEvaluation {
  action: LineMenuAction;
  menu_key: string;
  label: string;
  aliases: string[];
  matchedAlias: string | null;
  matchType: "normalize_exact" | "partial" | "none";
  require_active_assignments: boolean | null;
  hasAvailableContexts: boolean;
  filteredOutReason:
    | null
    | "文字列不一致"
    | "audience_rule.require_active_assignments により除外"
    | "status / enabled 条件で除外"
    | "context不足";
  audienceRuleReason: string | null;
  isActive: boolean;
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

function buildMenuResolvedLiffOpenText(input: { url: string; prompt?: string | null }): string {
  const lines = [`LIFFを開く: ${input.url}`];
  if (input.prompt) {
    lines.push(input.prompt);
  }
  lines.push("LIFFが開けない場合は、このままLINEトークに送ってください。");
  return lines.join("\n");
}

function buildMenuPostModeFallbackText(action: LineMenuAction): string {
  if (typeof action.action_payload?.prompt === "string" && action.action_payload.prompt.trim()) {
    return `${action.action_payload.prompt}\nLIFFが使えないため、今回はLINEトークでそのまま受け付けます。`;
  }

  return "LIFFが使えないため、今回はLINEトークでそのまま受け付けます。";
}

function stripMenuActionInvisibleCharacters(text: string): string {
  return text.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "");
}

function normalizeMenuActionText(text: string): string {
  return stripMenuActionInvisibleCharacters(text)
    .normalize("NFKC")
    .replace(/[\s\u3000]+/g, "")
    .trim()
    .toLowerCase();
}

function buildMenuActionTextDetails(text: string) {
  const withoutInvisible = stripMenuActionInvisibleCharacters(text);
  return {
    originalText: text,
    trimmedText: text.trim(),
    withoutInvisible,
    normalizedText: normalizeMenuActionText(text)
  };
}

function buildNormalizedActionAliases(action: LineMenuAction): string[] {
  const rawAliases = Array.isArray(action.action_payload?.aliases)
    ? action.action_payload.aliases.map((alias) => String(alias))
    : [];
  const values = [action.menu_key, action.label, ...rawAliases].map((value) =>
    normalizeMenuActionText(value)
  );
  return [...new Set(values.filter(Boolean))];
}

function logMenuActionFinalDecision(
  finalDecision: MenuActionFinalDecision,
  meta: Record<string, unknown>
): void {
  logger.info("menu_action.resolve_text.final", {
    finalDecision,
    ...meta
  });
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
  return buildNormalizedActionAliases(action);
}

async function buildProjectContexts(lineUserId: string): Promise<ProjectContext[]> {
  await assignmentService.expireOverdueAssignments();

  const respondents = await respondentService.listByLineUserId(lineUserId);
  if (respondents.length === 0) {
    logger.info("menu_action.build_contexts.no_respondents", { lineUserId });
    return [];
  }

  const respondentIds = respondents.map((respondent) => respondent.id);

  // listActionableByUserId は user_id カラムで絞り込む。
  // user_id が未設定のアサインメントを拾えない場合があるため、
  // respondent_id ベースでも取得してマージする。
  const [assignmentsByUserId, assignmentsByRespondentId, sessions, projects] = await Promise.all([
    projectAssignmentRepository.listActionableByUserId(lineUserId),
    projectAssignmentRepository.listActiveByRespondentIds(respondentIds),
    sessionRepository.listByRespondentIds(respondentIds),
    projectRepository.list()
  ]);

  // 重複排除してマージ
  const assignmentMap = new Map<string, ProjectAssignment>();
  for (const a of [...assignmentsByRespondentId, ...assignmentsByUserId]) {
    assignmentMap.set(a.id, a);
  }
  const assignments = [...assignmentMap.values()];

  logger.info("menu_action.build_contexts.fetched", {
    lineUserId,
    respondentCount: respondents.length,
    respondentIds,
    assignmentsByUserIdCount: assignmentsByUserId.length,
    assignmentsByRespondentIdCount: assignmentsByRespondentId.length,
    mergedAssignmentCount: assignments.length,
    assignments: assignments.map((a) => ({
      id: a.id,
      status: a.status,
      project_id: a.project_id,
      respondent_id: a.respondent_id,
      user_id: (a as unknown as Record<string, unknown>)["user_id"] ?? null
    })),
    projectCount: projects.length
  });

  const respondentById = new Map(respondents.map((respondent) => [respondent.id, respondent] as const));
  const projectById = new Map(projects.map((project) => [project.id, project] as const));
  const sessionsByRespondentId = new Map<string, Session[]>();

  for (const session of sessions) {
    const list = sessionsByRespondentId.get(session.respondent_id) ?? [];
    list.push(session);
    sessionsByRespondentId.set(session.respondent_id, list);
  }

  const contexts = assignments
    .map((assignment): ProjectContext | null => {
      const respondent = respondentById.get(assignment.respondent_id) ?? null;
      const project = projectById.get(assignment.project_id) ?? null;
      if (!respondent || !project) {
        logger.warn("menu_action.build_contexts.join_miss", {
          assignmentId: assignment.id,
          respondentId: assignment.respondent_id,
          projectId: assignment.project_id,
          hasRespondent: Boolean(respondent),
          hasProject: Boolean(project)
        });
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

  logger.info("menu_action.build_contexts.result", {
    lineUserId,
    contextCount: contexts.length,
    contexts: contexts.map((c) => ({
      projectId: c.project.id,
      projectName: c.project.name,
      assignmentId: c.assignment.id,
      assignmentStatus: c.assignment.status,
      respondentId: c.respondent.id
    }))
  });

  return contexts;
}

async function buildProjectContextsDetailed(lineUserId: string): Promise<ProjectContextBuildResult> {
  await assignmentService.expireOverdueAssignments();

  const respondents = await respondentService.listByLineUserId(lineUserId);
  const respondentIds = respondents.map((respondent) => respondent.id);

  if (respondents.length === 0) {
    logger.info("menu_action.build_contexts.fetched", {
      lineUserId,
      respondentCount: 0,
      respondentIds: [],
      assignmentsByUserIdCount: 0,
      assignmentsByRespondentIdCount: 0,
      mergedAssignmentsCount: 0,
      dedupeKey: "assignment.id",
      assignments: []
    });
    logger.info("menu_action.build_contexts.result", {
      lineUserId,
      contextCount: 0,
      contexts: [],
      contextReason: "NO_RESPONDENT"
    });

    return {
      contexts: [],
      diagnostics: {
        respondentCount: 0,
        respondentIds: [],
        assignmentsByUserIdCount: 0,
        assignmentsByRespondentIdCount: 0,
        mergedAssignmentsCount: 0,
        contextReason: "NO_RESPONDENT"
      },
      candidates: [],
      sourceTypeByAssignmentId: new Map<string, ProjectContextSourceType>()
    };
  }

  const [assignmentsByUserId, assignmentsByRespondentId, sessions, projects] = await Promise.all([
    projectAssignmentRepository.listActionableByUserId(lineUserId),
    projectAssignmentRepository.listActiveByRespondentIds(respondentIds),
    sessionRepository.listByRespondentIds(respondentIds),
    projectRepository.list()
  ]);

  const userIdAssignmentIds = new Set(assignmentsByUserId.map((assignment) => assignment.id));
  const respondentIdAssignmentIds = new Set(
    assignmentsByRespondentId.map((assignment) => assignment.id)
  );
  const assignmentMap = new Map<string, ProjectAssignment>();

  for (const assignment of [...assignmentsByRespondentId, ...assignmentsByUserId]) {
    assignmentMap.set(assignment.id, assignment);
  }

  const candidates = [...assignmentMap.values()].map((assignment) => {
    const hasUserSource = userIdAssignmentIds.has(assignment.id);
    const hasRespondentSource = respondentIdAssignmentIds.has(assignment.id);
    const sourceType: ProjectContextSourceType =
      hasUserSource && hasRespondentSource
        ? "user_id経由+respondent_id経由"
        : hasUserSource
          ? "user_id経由"
          : "respondent_id経由";
    return { assignment, sourceType };
  });

  logger.info("menu_action.build_contexts.fetched", {
    lineUserId,
    respondentCount: respondents.length,
    respondentIds,
    assignmentsByUserIdCount: assignmentsByUserId.length,
    assignmentsByRespondentIdCount: assignmentsByRespondentId.length,
    mergedAssignmentsCount: candidates.length,
    dedupeKey: "assignment.id",
    assignments: candidates.map(({ assignment }) => ({
      id: assignment.id,
      project_id: assignment.project_id,
      respondent_id: assignment.respondent_id,
      user_id: assignment.user_id ?? null,
      status: assignment.status
    }))
  });

  const respondentById = new Map(
    respondents.map((respondent) => [respondent.id, respondent] as const)
  );
  const projectById = new Map(projects.map((project) => [project.id, project] as const));
  const sessionsByRespondentId = new Map<string, Session[]>();

  for (const session of sessions) {
    const list = sessionsByRespondentId.get(session.respondent_id) ?? [];
    list.push(session);
    sessionsByRespondentId.set(session.respondent_id, list);
  }

  const sourceTypeByAssignmentId = new Map(
    candidates.map(({ assignment, sourceType }) => [assignment.id, sourceType] as const)
  );

  const contexts = candidates
    .map(({ assignment }): ProjectContext | null => {
      const respondent = respondentById.get(assignment.respondent_id) ?? null;
      const project = projectById.get(assignment.project_id) ?? null;

      if (!respondent || !project) {
        logger.warn("menu_action.build_contexts.join_miss", {
          lineUserId,
          assignmentId: assignment.id,
          respondentId: assignment.respondent_id,
          projectId: assignment.project_id,
          hasRespondent: Boolean(respondent),
          hasProject: Boolean(project),
          sourceType: sourceTypeByAssignmentId.get(assignment.id) ?? null
        });
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

  const contextReason: ProjectContextBuildDiagnostics["contextReason"] =
    candidates.length === 0 ? "NO_ASSIGNMENTS" : contexts.length === 0 ? "NO_CONTEXTS" : null;

  logger.info("menu_action.build_contexts.result", {
    lineUserId,
    contextCount: contexts.length,
    contextReason,
    contexts: contexts.map((context) => ({
      projectId: context.project.id,
      projectTitle: context.project.name,
      assignmentId: context.assignment.id,
      sourceType: sourceTypeByAssignmentId.get(context.assignment.id) ?? null
    }))
  });

  return {
    contexts,
    diagnostics: {
      respondentCount: respondents.length,
      respondentIds,
      assignmentsByUserIdCount: assignmentsByUserId.length,
      assignmentsByRespondentIdCount: assignmentsByRespondentId.length,
      mergedAssignmentsCount: candidates.length,
      contextReason
    },
    candidates,
    sourceTypeByAssignmentId
  };
}

async function listAvailableProjectContexts(lineUserId: string): Promise<ProjectContext[]> {
  const result = await buildProjectContextsDetailed(lineUserId);
  return result.contexts;
}

async function resolveSelectionAction(input: {
  lineUserId: string;
  text: string;
}): Promise<MenuActionResolution> {
  if (!isNumericSelection(input.text)) {
    return { handled: false };
  }

  const pending = consumePendingSelection(input.lineUserId);
  const selectedIndex = Number(input.text.trim()) - 1;
  let availableContexts: ProjectContext[] | null = null;
  let candidateAssignmentIds = pending?.assignmentIds ?? null;
  const isFallback = candidateAssignmentIds === null;

  if (!candidateAssignmentIds) {
    availableContexts = await listAvailableProjectContexts(input.lineUserId);
    const hasActiveSession = availableContexts.some((context) =>
      Boolean(selectActiveSession(context.sessions)?.current_question_id)
    );

    if (hasActiveSession || availableContexts.length === 0) {
      return { handled: false };
    }

    candidateAssignmentIds = availableContexts.map((context) => context.assignment.id);
  }

  const selectedAssignmentId = candidateAssignmentIds[selectedIndex] ?? null;

  if (isFallback) {
    logger.warn("menu_action.pending_selection_missing", {
      lineUserId: input.lineUserId,
      selectionText: input.text.trim(),
      availableContextCount: candidateAssignmentIds.length,
      recovered: selectedAssignmentId !== null
    });
  }
  if (!selectedAssignmentId) {
    return {
      handled: true,
      behavior: "reply",
      messages: [
        buildTextMessage("該当する案件番号が見つかりません。案件一覧をもう一度送信してください。")
      ]
    };
  }

  availableContexts ??= await listAvailableProjectContexts(input.lineUserId);
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

  if (assignment.delivery_channel === "line") {
    const activeSession = selectActiveSession(selectedContext.sessions);
    if (activeSession?.current_question_id) {
      return {
        handled: true,
        behavior: "resume",
        session: activeSession,
        assignmentId: assignment.id
      };
    }
    return {
      handled: true,
      behavior: "start",
      respondentId: selectedContext.respondent.id,
      projectId: selectedContext.project.id,
      assignmentId: assignment.id
    };
  }

  return {
    handled: true,
    behavior: "liff_redirect",
    assignmentId: assignment.id,
    projectId: selectedContext.project.id,
    projectName: selectedContext.project.name
  };
}

async function resolveProjectListAction(lineUserId: string): Promise<MenuActionResolution> {
  logger.info("menu_action.project_list.start", { lineUserId });

  try {
    const availableContexts = await listAvailableProjectContexts(lineUserId);

    logger.info("menu_action.project_list.contexts", {
      lineUserId,
      availableContextsLength: availableContexts.length,
      contexts: availableContexts.map((c) => ({
        projectId: c.project.id,
        projectName: c.project.name,
        assignmentId: c.assignment.id,
        assignmentStatus: c.assignment.status,
        respondentId: c.respondent.id
      }))
    });

    if (availableContexts.length === 0) {
      clearPendingSelection(lineUserId);
      return {
        handled: true,
        behavior: "reply",
        messages: [buildTextMessage("現在参加可能な案件はありません。")]
      };
    }

    const assignmentIds = availableContexts.map((context) => context.assignment.id);
    setPendingSelection(lineUserId, assignmentIds);

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

    const replyText = lines.join("\n");
    logger.info("menu_action.project_list.reply", {
      lineUserId,
      savedAssignmentIds: assignmentIds,
      replyText
    });

    return {
      handled: true,
      behavior: "reply",
      messages: [buildTextMessage(replyText)]
    };
  } catch (error) {
    logger.error("menu_action.project_list.error", {
      lineUserId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
}

async function resolveProjectListActionWithDiagnostics(
  lineUserId: string
): Promise<MenuActionResolution> {
  logger.info("menu_action.project_list.start", { lineUserId });

  try {
    const buildResult = await buildProjectContextsDetailed(lineUserId);
    const availableContexts = buildResult.contexts;

    logger.info("menu_action.project_list.contexts", {
      lineUserId,
      availableContextsCount: availableContexts.length,
      contexts: availableContexts.map((context) => ({
        projectId: context.project.id,
        projectTitle: context.project.name,
        assignmentId: context.assignment.id,
        sourceType: buildResult.sourceTypeByAssignmentId.get(context.assignment.id) ?? null,
        status: context.assignment.status
      }))
    });

    if (availableContexts.length === 0) {
      clearPendingSelection(lineUserId);
      logMenuActionFinalDecision(buildResult.diagnostics.contextReason ?? "NO_CONTEXTS", {
        lineUserId,
        availableContextsCount: 0
      });

      return {
        handled: true,
        behavior: "reply",
        messages: [buildTextMessage("現在参加可能な案件はありません。")]
      };
    }

    const assignmentIds = availableContexts.map((context) => context.assignment.id);
    setPendingSelection(lineUserId, assignmentIds);

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

    const replyText = lines.join("\n");
    logger.info("menu_action.project_list.reply_payload", {
      lineUserId,
      savedAssignmentIds: assignmentIds,
      replyText
    });

    logMenuActionFinalDecision("PROJECT_LIST_EXECUTED", {
      lineUserId,
      availableContextsCount: availableContexts.length,
      savedAssignmentIds: assignmentIds
    });

    return {
      handled: true,
      behavior: "reply",
      messages: [buildTextMessage(replyText)]
    };
  } catch (error) {
    logger.error("menu_action.project_list.error", {
      lineUserId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
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
              buildMenuResolvedLiffOpenText({
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
        messages: [buildTextMessage(buildMenuPostModeFallbackText(action))]
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
  }

  switch (action.action_type as LineMenuAction["action_type"]) {
    case "start_project_list":
      return resolveProjectListActionWithDiagnostics(input.lineUserId);
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

function buildMenuAudienceContext(input: {
  lineUserId: string;
  primaryRespondent: Awaited<ReturnType<typeof respondentService.getPrimaryRespondent>>;
  availableContextsCount: number;
}): MenuAudienceContext {
  return {
    userId: input.lineUserId,
    currentRank: input.primaryRespondent?.current_rank?.rank_code ?? null,
    totalPoints: input.primaryRespondent?.total_points ?? 0,
    hasActiveAssignments: input.availableContextsCount > 0,
    featureFlags: []
  };
}

function buildActionEvaluations(input: {
  actions: LineMenuAction[];
  normalizedText: string;
  audienceContext: MenuAudienceContext;
}): ActionEvaluation[] {
  return input.actions.map((action) => {
    const aliases = buildNormalizedActionAliases(action);
    const exactMatchAlias = aliases.find((alias) => alias === input.normalizedText) ?? null;
    const partialMatchAlias =
      exactMatchAlias ??
      aliases.find(
        (alias) =>
          Boolean(input.normalizedText) &&
          alias !== input.normalizedText &&
          (alias.includes(input.normalizedText) || input.normalizedText.includes(alias))
      ) ??
      null;
    const audienceEvaluation = evaluateAudienceRule(action.audience_rule, input.audienceContext);

    let filteredOutReason: ActionEvaluation["filteredOutReason"] = null;
    if (!action.is_active) {
      filteredOutReason = "status / enabled 条件で除外";
    } else if (!exactMatchAlias) {
      filteredOutReason = "文字列不一致";
    } else if (!audienceEvaluation.passed) {
      filteredOutReason =
        audienceEvaluation.reason === "require_active_assignments"
          ? "audience_rule.require_active_assignments により除外"
          : "context不足";
    }

    return {
      action,
      menu_key: action.menu_key,
      label: action.label,
      aliases,
      matchedAlias: exactMatchAlias ?? partialMatchAlias,
      matchType: exactMatchAlias ? "normalize_exact" : partialMatchAlias ? "partial" : "none",
      require_active_assignments: action.audience_rule?.require_active_assignments ?? null,
      hasAvailableContexts: input.audienceContext.hasActiveAssignments ?? false,
      filteredOutReason,
      audienceRuleReason: audienceEvaluation.reason,
      isActive: action.is_active
    };
  });
}

function determineUnmatchedReason(
  evaluations: ActionEvaluation[]
): {
  unmatchedReason:
    | "文字列不一致"
    | "audience_rule.require_active_assignments により除外"
    | "status / enabled 条件で除外"
    | "context不足";
  finalDecision: MenuActionFinalDecision;
} {
  const exactMatches = evaluations.filter((evaluation) => evaluation.matchType === "normalize_exact");
  if (exactMatches.length === 0) {
    return {
      unmatchedReason: "文字列不一致",
      finalDecision: "ACTION_TEXT_NOT_MATCHED"
    };
  }

  const activeExactMatches = exactMatches.filter((evaluation) => evaluation.isActive);
  if (activeExactMatches.length === 0) {
    return {
      unmatchedReason: "status / enabled 条件で除外",
      finalDecision: "UNKNOWN"
    };
  }

  if (
    activeExactMatches.some(
      (evaluation) =>
        evaluation.filteredOutReason === "audience_rule.require_active_assignments により除外"
    )
  ) {
    return {
      unmatchedReason: "audience_rule.require_active_assignments により除外",
      finalDecision: "ACTION_FILTERED_BY_AUDIENCE_RULE"
    };
  }

  return {
    unmatchedReason: "context不足",
    finalDecision: "UNKNOWN"
  };
}

export const menuActionServiceDb = {
  async resolveTextAction(input: {
    lineUserId: string;
    displayName?: string | null;
    text: string;
  }): Promise<MenuActionResolution> {
    const textDetails = buildMenuActionTextDetails(input.text);
    const normalized = textDetails.normalizedText;

    logger.info("menu_action.resolve_text.start", {
      lineUserId: input.lineUserId,
      ...textDetails
    });

    try {
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
      const contextBuild = await buildProjectContextsDetailed(input.lineUserId);
      const audienceContext = buildMenuAudienceContext({
        lineUserId: input.lineUserId,
        primaryRespondent,
        availableContextsCount: contextBuild.contexts.length
      });
      const allActions = await lineMenuActionRepository.listAll();
      const evaluations = buildActionEvaluations({
        actions: allActions,
        normalizedText: normalized,
        audienceContext
      });

      logger.info("menu_action.resolve_text.context", {
        lineUserId: input.lineUserId,
        normalizedText: normalized,
        hasPrimaryRespondent: Boolean(primaryRespondent),
        currentRank: audienceContext.currentRank ?? null,
        totalPoints: audienceContext.totalPoints ?? 0,
        hasAvailableContexts: audienceContext.hasActiveAssignments ?? false,
        contextReason: contextBuild.diagnostics.contextReason
      });

      logger.info("menu_action.resolve_text.active_actions", {
        lineUserId: input.lineUserId,
        normalizedText: normalized,
        actions: evaluations.map((evaluation) => ({
          menu_key: evaluation.menu_key,
          label: evaluation.label,
          aliases: evaluation.aliases,
          matchedAlias: evaluation.matchedAlias,
          matchType: evaluation.matchType,
          require_active_assignments: evaluation.require_active_assignments,
          hasAvailableContexts: evaluation.hasAvailableContexts,
          filteredOutReason: evaluation.filteredOutReason
        }))
      });

      const matchedEvaluation =
        evaluations.find(
          (evaluation) => evaluation.matchType === "normalize_exact" && !evaluation.filteredOutReason
        ) ?? null;

      if (!matchedEvaluation) {
        const unmatched = determineUnmatchedReason(evaluations);

        logger.warn("menu_action.resolve_text.unmatched", {
          lineUserId: input.lineUserId,
          normalizedText: normalized,
          unmatchedReason: unmatched.unmatchedReason,
          contextReason: contextBuild.diagnostics.contextReason
        });

        if (
          env.MENU_ACTION_DEBUG_FORCE_PROJECT_LIST &&
          normalized === normalizeMenuActionText("案件一覧")
        ) {
          logger.warn("menu_action.resolve_text.debug_force_project_list", {
            lineUserId: input.lineUserId,
            normalizedText: normalized
          });
          // TODO: Remove this debug bypass after the menu action matching issue is fully resolved.
          return resolveProjectListActionWithDiagnostics(input.lineUserId);
        }

        logMenuActionFinalDecision(unmatched.finalDecision, {
          lineUserId: input.lineUserId,
          normalizedText: normalized,
          unmatchedReason: unmatched.unmatchedReason,
          contextReason: contextBuild.diagnostics.contextReason
        });

        return { handled: false };
      }

      logger.info("menu_action.resolve_text.match", {
        lineUserId: input.lineUserId,
        normalizedText: normalized,
        matchedMenuKey: matchedEvaluation.action.menu_key,
        matchedActionType: matchedEvaluation.action.action_type,
        matchedAlias: matchedEvaluation.matchedAlias,
        matchType: matchedEvaluation.matchType
      });

      if (matchedEvaluation.action.action_type === "start_project_list") {
        return resolveProjectListActionWithDiagnostics(input.lineUserId);
      }

      return resolveDynamicAction(matchedEvaluation.action, { lineUserId: input.lineUserId });
    } catch (error) {
      logMenuActionFinalDecision("UNKNOWN", {
        lineUserId: input.lineUserId,
        normalizedText: normalized
      });
      logger.error("menu_action.resolve_text.error", {
        lineUserId: input.lineUserId,
        text: input.text,
        normalizedText: normalized,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      throw error;
    }
  },

  consumePendingPostCapture(lineUserId: string) {
    return consumePendingPostCapture(lineUserId);
  }
};
