import { env } from "../config/env";
import { liffEntrypointRepository } from "../repositories/liffEntrypointRepository";
import type { LineMenuAction, LiffEntrypoint } from "../types/domain";

interface ResolveLaunchInput {
  liffPath?: string | null;
  defaultEntryKey?: string | null;
  params?: Record<string, string | null | undefined>;
}

export interface ResolvedLiffLaunch {
  entryKey: string | null;
  title: string;
  path: string;
  url: string;
  liffId: string | null;
  requiresLiffAuth: boolean;
  settings: Record<string, unknown> | null;
}

type ManagedLiffEntryKey = "rant" | "diary" | "personality" | "mypage" | "survey";

const fallbackEntrypoints: Record<ManagedLiffEntryKey, LiffEntrypoint> = {
  rant: {
    id: "fallback-rant",
    entry_key: "rant",
    title: "本音・悩み",
    path: "/liff/rant",
    entry_type: "rant",
    settings_json: {},
    is_active: true,
    created_at: "",
    updated_at: ""
  },
  diary: {
    id: "fallback-diary",
    entry_key: "diary",
    title: "今日の気持ち",
    path: "/liff/diary",
    entry_type: "diary",
    settings_json: {},
    is_active: true,
    created_at: "",
    updated_at: ""
  },
  personality: {
    id: "fallback-personality",
    entry_key: "personality",
    title: "性格診断",
    path: "/liff/personality",
    entry_type: "personality",
    settings_json: {},
    is_active: true,
    created_at: "",
    updated_at: ""
  },
  mypage: {
    id: "fallback-mypage",
    entry_key: "mypage",
    title: "マイページ",
    path: "/liff/mypage",
    entry_type: "mypage",
    settings_json: {},
    is_active: true,
    created_at: "",
    updated_at: ""
  },
  survey: {
    id: "fallback-survey",
    entry_key: "survey",
    title: "アンケート",
    path: "/liff/survey",
    entry_type: "survey_support",
    settings_json: {},
    is_active: true,
    created_at: "",
    updated_at: ""
  }
};

const canonicalTitles: Partial<Record<ManagedLiffEntryKey, string>> = {
  rant: "本音・悩み投稿",
  diary: "今日の気持ち・日記",
  personality: "性格診断",
  mypage: "マイページ",
  survey: "アンケート"
};

function trimToNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function inferEntryKeyFromPath(path: string): string | null {
  const match = /^\/liff\/([^/?#]+)/.exec(path);
  return match?.[1]?.trim() ?? null;
}

function getLiffId(entry: LiffEntrypoint | null): string | null {
  const entryKey = entry?.entry_key ?? null;
  if (entryKey === "rant" && env.LINE_LIFF_ID_RANT) {
    return env.LINE_LIFF_ID_RANT;
  }
  if (entryKey === "diary" && env.LINE_LIFF_ID_DIARY) {
    return env.LINE_LIFF_ID_DIARY;
  }
  if (entryKey === "personality" && env.LINE_LIFF_ID_PERSONALITY) {
    return env.LINE_LIFF_ID_PERSONALITY;
  }
  if (entryKey === "survey" && env.LINE_LIFF_ID_SURVEY) {
    return env.LINE_LIFF_ID_SURVEY;
  }
  if (entryKey === "mypage" && env.LINE_LIFF_ID_MYPAGE) {
    return env.LINE_LIFF_ID_MYPAGE;
  }

  const configured = entry?.settings_json?.liffId;
  if (typeof configured === "string" && configured.trim()) {
    return configured.trim();
  }

  return env.LINE_LIFF_ID ?? null;
}

/**
 * survey / mypage 用の LIFF ID が設定されているか確認する。
 * 未設定でも動作はするが、LIFF 認証（ID token 取得）ができないため本人確認不可になる。
 */
export function getSurveyLiffId(): string | null {
  return env.LINE_LIFF_ID_SURVEY ?? env.LINE_LIFF_ID ?? null;
}

export function getMypageLiffId(): string | null {
  return env.LINE_LIFF_ID_MYPAGE ?? env.LINE_LIFF_ID ?? null;
}

/**
 * 案件選択後の LIFF 開始 URL を生成する。
 * LINE_LIFF_ID_SURVEY が設定されていれば LIFF URL、未設定なら絶対 URL を返す。
 * survey ページは ?assignment_id= クエリパラムにも対応済み。
 */
export function buildProjectStartUrl(assignmentId: string): {
  url: string;
  hasLiffId: boolean;
} {
  const liffId = getSurveyLiffId();
  if (liffId) {
    return {
      url: buildLiffUrl(liffId, { assignment_id: assignmentId }),
      hasLiffId: true
    };
  }
  return {
    url: buildAbsoluteUrl(`/liff/survey/${assignmentId}`),
    hasLiffId: false
  };
}

/**
 * survey の LIFF 設定状態を返す。
 * LINE Developers 側で以下が必要:
 *   - LINE_LIFF_CHANNEL_ID: LIFF チャネル ID
 *   - LINE_LIFF_ID_SURVEY: survey 専用 LIFF App ID
 * どちらかが未設定の場合、liffAuthAvailable = false になる。
 */
export function getSurveyLiffConfig(): {
  liffId: string | null;
  liffAuthAvailable: boolean;
  missingEnvVars: string[];
} {
  const missing: string[] = [];
  if (!env.LINE_LIFF_CHANNEL_ID) missing.push("LINE_LIFF_CHANNEL_ID");
  if (!env.LINE_LIFF_ID_SURVEY && !env.LINE_LIFF_ID) missing.push("LINE_LIFF_ID_SURVEY");
  return {
    liffId: getSurveyLiffId(),
    liffAuthAvailable: missing.length === 0,
    missingEnvVars: missing,
  };
}

function buildAbsoluteUrl(path: string, params?: Record<string, string | null | undefined>): string {
  const url = new URL(path, env.APP_BASE_URL);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function buildLiffUrl(liffId: string, params?: Record<string, string | null | undefined>): string {
  const url = new URL(`https://liff.line.me/${liffId}`);
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function buildLaunchUrl(input: {
  path: string;
  liffId: string | null;
  requiresLiffAuth: boolean;
  params?: Record<string, string | null | undefined>;
}): string {
  if (input.requiresLiffAuth && input.liffId) {
    return buildLiffUrl(input.liffId, input.params);
  }
  return buildAbsoluteUrl(input.path, input.params);
}

async function resolveEntrypoint(entryKey: string): Promise<LiffEntrypoint | null> {
  return (
    (await liffEntrypointRepository.getByEntryKey(entryKey)) ??
    fallbackEntrypoints[entryKey as ManagedLiffEntryKey] ??
    null
  );
}

function buildManagedLaunch(
  entry: LiffEntrypoint,
  params?: Record<string, string | null | undefined>
): ResolvedLiffLaunch {
  const liffId = getLiffId(entry);
  return {
    entryKey: entry.entry_key,
    title: canonicalTitles[entry.entry_key as ManagedLiffEntryKey] ?? entry.title,
    path: entry.path,
    url: buildLaunchUrl({
      path: entry.path,
      liffId,
      requiresLiffAuth: true,
      params
    }),
    liffId,
    requiresLiffAuth: true,
    settings: entry.settings_json ?? null
  };
}

export const liffService = {
  async getPage(entryKey: string): Promise<ResolvedLiffLaunch | null> {
    const entry = await resolveEntrypoint(entryKey);
    if (!entry) {
      return null;
    }

    return buildManagedLaunch(entry);
  },

  async resolveLaunch(input: ResolveLaunchInput): Promise<ResolvedLiffLaunch | null> {
    const rawPath = trimToNull(input.liffPath);

    if (rawPath?.startsWith("http://") || rawPath?.startsWith("https://")) {
      const url = new URL(rawPath);
      for (const [key, value] of Object.entries(input.params ?? {})) {
        if (value) {
          url.searchParams.set(key, value);
        }
      }

      const inferredEntryKey = inferEntryKeyFromPath(url.pathname);
      const inferredEntry = inferredEntryKey ? await resolveEntrypoint(inferredEntryKey) : null;
      const liffId = getLiffId(inferredEntry);
      const requiresLiffAuth = url.pathname.startsWith("/liff/");
      return {
        entryKey: inferredEntry?.entry_key ?? inferredEntryKey,
        title:
          (inferredEntry?.entry_key
            ? canonicalTitles[inferredEntry.entry_key as ManagedLiffEntryKey]
            : null) ??
          inferredEntry?.title ??
          "LIFF",
        path: url.pathname,
        url: requiresLiffAuth
          ? buildLaunchUrl({
              path: url.pathname,
              liffId,
              requiresLiffAuth,
              params: Object.fromEntries(url.searchParams.entries())
            })
          : url.toString(),
        liffId,
        requiresLiffAuth,
        settings: inferredEntry?.settings_json ?? null
      };
    }

    if (rawPath?.startsWith("/")) {
      const inferredEntryKey = inferEntryKeyFromPath(rawPath);
      const inferredEntry = inferredEntryKey ? await resolveEntrypoint(inferredEntryKey) : null;
      const liffId = getLiffId(inferredEntry);
      const requiresLiffAuth = rawPath.startsWith("/liff/");
      return {
        entryKey: inferredEntry?.entry_key ?? inferredEntryKey,
        title:
          (inferredEntry?.entry_key
            ? canonicalTitles[inferredEntry.entry_key as ManagedLiffEntryKey]
            : null) ??
          inferredEntry?.title ??
          "LIFF",
        path: rawPath,
        url: buildLaunchUrl({
          path: rawPath,
          liffId,
          requiresLiffAuth,
          params: input.params
        }),
        liffId,
        requiresLiffAuth,
        settings: inferredEntry?.settings_json ?? null
      };
    }

    if (rawPath) {
      const directEntry = await resolveEntrypoint(rawPath);
      if (directEntry) {
        return buildManagedLaunch(directEntry, input.params);
      }
    }

    const fallbackEntryKey = trimToNull(input.defaultEntryKey);
    if (!fallbackEntryKey) {
      return null;
    }

    const fallbackEntry = await resolveEntrypoint(fallbackEntryKey);
    if (!fallbackEntry) {
      return null;
    }

    return buildManagedLaunch(fallbackEntry, input.params);
  },

  async resolveMenuActionLaunch(
    action: LineMenuAction,
    input?: {
      defaultEntryKey?: string | null;
      params?: Record<string, string | null | undefined>;
    }
  ): Promise<ResolvedLiffLaunch | null> {
    return this.resolveLaunch({
      liffPath: action.liff_path,
      defaultEntryKey: input?.defaultEntryKey ?? null,
      params: input?.params
    });
  }
};
