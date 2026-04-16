import type { Request, Response } from "express";
import { env } from "../config/env";
import { HttpError } from "../lib/http";
import { userProfileRepository, type UserProfileUpsertInput } from "../repositories/userProfileRepository";
import { projectRepository } from "../repositories/projectRepository";
import { analysisService } from "../services/analysisService";
import { liffAuthService } from "../services/liffAuthService";
import { liffService } from "../services/liffService";
import { personalityService } from "../services/personalityService";
import { postService } from "../services/postService";
import { respondentService } from "../services/respondentService";
import type { MaritalStatus } from "../types/domain";

type SupportedPostEntryKey = "rant" | "diary";

const TOKYO_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function todayInTokyo(): string {
  return TOKYO_DATE_FORMATTER.format(new Date());
}

function bearerToken(req: Request): string {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    throw new HttpError(401, "認証情報を確認できませんでした。LINEから開き直してください。");
  }
  return header.slice("Bearer ".length).trim();
}

function stringValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return String(value[0] ?? "");
  }
  return "";
}

function resolveMenuActionKey(value: unknown, fallback: string): string {
  const normalized = stringValue(value).trim();
  return normalized || fallback;
}

function parsePostType(value: unknown): "rant" | "diary" {
  const text = stringValue(value).trim();
  if (text === "rant" || text === "diary") {
    return text;
  }
  throw new HttpError(400, "投稿タイプが不正です。画面を開き直して再度お試しください。");
}

function parsePostedOn(value: unknown): string | null {
  const text = stringValue(value).trim();
  if (!text) {
    return null;
  }

  const parsed = new Date(`${text}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "日付の形式が正しくありません。");
  }

  return parsed.toISOString().slice(0, 10);
}

async function renderPostPage(
  res: Response,
  input: { entryKey: SupportedPostEntryKey; menuActionKey?: string | null; postedOn?: string | null }
): Promise<void> {
  const entry = await liffService.getPage(input.entryKey);
  if (!entry) {
    throw new HttpError(404, "LIFF entrypoint not found");
  }

  const menuActionKey = resolveMenuActionKey(
    input.menuActionKey,
    input.entryKey === "rant" ? "rant" : "diary"
  );
  const postedOn = input.postedOn ?? null;

  res.render(`liff/${input.entryKey}`, {
    title: entry.title,
    entry,
    menuActionKey,
    postedOn,
    initialData: {
      appBaseUrl: env.APP_BASE_URL,
      entryKey: input.entryKey,
      liffId: entry.liffId,
      submitUrl: "/liff/posts",
      personalityDataUrl: "/liff/personality-data",
      menuActionKey,
      postedOn,
      fallbackMessage:
        "LIFFが使えない場合は、この画面を閉じてLINEトークにそのまま送信してください。既存のテキスト入力フローに戻れます。"
    }
  });
}

export const liffController = {
  async rantPage(req: Request, res: Response): Promise<void> {
    await renderPostPage(res, {
      entryKey: "rant",
      menuActionKey: resolveMenuActionKey(req.query.menuActionKey, "rant")
    });
  },

  async diaryPage(req: Request, res: Response): Promise<void> {
    await renderPostPage(res, {
      entryKey: "diary",
      menuActionKey: resolveMenuActionKey(req.query.menuActionKey, "diary"),
      postedOn: stringValue(req.query.postedOn) || todayInTokyo()
    });
  },

  async personalityPage(req: Request, res: Response): Promise<void> {
    const entry = await liffService.getPage("personality");
    if (!entry) {
      throw new HttpError(404, "LIFF entrypoint not found");
    }

    const menuActionKey = resolveMenuActionKey(req.query.menuActionKey, "personality");

    res.render("liff/personality", {
      title: entry.title,
      entry,
      menuActionKey,
      initialData: {
        appBaseUrl: env.APP_BASE_URL,
        entryKey: "personality",
        liffId: entry.liffId,
        personalityDataUrl: "/liff/personality-data",
        menuActionKey,
        fallbackMessage:
          "LIFFが使えない場合はLINEトークのメニューから再度開くか、そのまま会話を続けてください。"
      }
    });
  },

  async createPost(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const type = parsePostType(req.body.type);
    const content = stringValue(req.body.content).trim();
    const menuActionKey = stringValue(req.body.menu_action_key).trim() || null;
    const postedOn = type === "diary" ? parsePostedOn(req.body.posted_on) ?? todayInTokyo() : null;

    if (!content) {
      throw new HttpError(400, "投稿内容を入力してください。");
    }

    const respondent =
      (await respondentService.getPrimaryRespondent(verifiedUser.userId)) ??
      (await respondentService.ensureRespondent(verifiedUser.userId, verifiedUser.displayName));
    const project = respondent ? await projectRepository.getById(respondent.project_id) : null;

    const post = await postService.createStandalonePost({
      userId: verifiedUser.userId,
      respondentId: respondent?.id ?? null,
      projectId: project?.id ?? null,
      sessionId: null,
      type,
      content,
      sourceMode: project?.research_mode ?? null,
      sourceChannel: "liff",
      menuActionKey,
      postedOn,
      metadata: {
        captured_from: "liff",
        liff_entry_key: type
      }
    });

    void analysisService.analyzePost(post.id);

    res.status(201).json({
      ok: true,
      postId: post.id,
      posted_on: post.posted_on
    });
  },

  async personalityData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const result = await personalityService.getOrBuild(verifiedUser.userId);

    res.json({
      ok: true,
      user_id: verifiedUser.userId,
      ...result
    });
  },

  async mypagePage(req: Request, res: Response): Promise<void> {
    const entry = await liffService.getPage("mypage");
    if (!entry) {
      throw new HttpError(404, "LIFF entrypoint not found");
    }

    res.render("liff/mypage", {
      title: entry.title,
      entry,
      initialData: {
        appBaseUrl: env.APP_BASE_URL,
        liffId: entry.liffId,
        profileUrl: "/liff/mypage-data",
        updateUrl: "/liff/mypage-data"
      }
    });
  },

  async getMypageData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const profile = await userProfileRepository.getByLineUserId(verifiedUser.userId);

    res.json({
      ok: true,
      user_id: verifiedUser.userId,
      display_name: verifiedUser.displayName,
      profile: profile ?? null
    });
  },

  async updateMypageData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const body = req.body as Record<string, unknown>;

    function parseDate(v: unknown): string | null {
      const s = stringValue(v).trim();
      if (!s) return null;
      const d = new Date(s);
      return Number.isNaN(d.getTime()) ? null : s;
    }

    function parseBool(v: unknown): boolean | null {
      if (v === true || v === "true") return true;
      if (v === false || v === "false") return false;
      return null;
    }

    function parseIntArray(v: unknown): number[] {
      if (!Array.isArray(v)) return [];
      return v.map(Number).filter((n) => Number.isFinite(n));
    }

    function parseStringArray(v: unknown): string[] {
      if (!Array.isArray(v)) return [];
      return v.map(String).filter(Boolean);
    }

    function parseMaritalStatus(v: unknown): MaritalStatus | null {
      const s = stringValue(v).trim();
      if (s === "single" || s === "married" || s === "divorced" || s === "widowed") {
        return s;
      }
      return null;
    }

    const input: UserProfileUpsertInput = {
      nickname: stringValue(body.nickname).trim() || null,
      birth_date: parseDate(body.birth_date),
      prefecture: stringValue(body.prefecture).trim() || null,
      address_detail: stringValue(body.address_detail).trim() || null,
      address_declined: body.address_declined === true || body.address_declined === "true",
      occupation: stringValue(body.occupation).trim() || null,
      occupation_updated_at: body.occupation !== undefined ? new Date().toISOString() : undefined,
      industry: stringValue(body.industry).trim() || null,
      marital_status: parseMaritalStatus(body.marital_status),
      has_children: parseBool(body.has_children),
      children_ages: parseIntArray(body.children_ages),
      household_composition: parseStringArray(body.household_composition)
    };

    const profile = await userProfileRepository.upsert(verifiedUser.userId, input);

    res.json({ ok: true, profile });
  }
};
