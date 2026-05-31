import type { Request, Response } from "express";
import { env } from "../config/env";
import { STORAGE_BUCKET, storagePaths } from "../config/storage";
import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";
import { getProjectResearchSettings } from "../lib/projectResearch";
import { normalizeQuestionMeta } from "../lib/questionMetadata";
import { userProfileRepository, type UserProfileUpsertInput } from "../repositories/userProfileRepository";
import { projectRepository } from "../repositories/projectRepository";
import { projectFavoriteRepository } from "../repositories/projectFavoriteRepository";
import { rankRepository } from "../repositories/rankRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import { pointTransactionRepository } from "../repositories/pointTransactionRepository";
import { questionRepository } from "../repositories/questionRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { answerRepository } from "../repositories/answerRepository";
import { projectAssignmentRepository } from "../repositories/projectAssignmentRepository";
import { questionPageGroupRepository } from "../repositories/questionPageGroupRepository";
import { aiService } from "../services/aiService";
import { analysisService } from "../services/analysisService";
import { liffAuthService } from "../services/liffAuthService";
import { liffService, getSurveyLiffConfig } from "../services/liffService";
import { personalityService } from "../services/personalityService";
import { postService } from "../services/postService";
import { respondentService } from "../services/respondentService";
import { screeningService } from "../services/screeningService";
import type { Gender, MaritalStatus, RantTag } from "../types/domain";
import { runPostCompleteProcess } from "../services/postCompleteService";
import { rantTagRepository } from "../repositories/rantTagRepository";
import { postRepository } from "../repositories/postRepository";
import { dailySurveyService } from "../services/dailySurveyService";
import { dailySurveyRepository } from "../repositories/dailySurveyRepository";
import { userStreakService } from "../services/userStreakService";
import { userBadgeService } from "../services/userBadgeService";

type SupportedPostEntryKey = "rant" | "diary";

const TOKYO_DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

interface EmotionTagRow { id: string; code: string; label: string; emoji: string }
interface OneLinePromptRow { id: string; text: string }
interface DiaryTopicRow { id: string; text: string }

interface PostMasterData {
  emotionTags: EmotionTagRow[];
  oneLinePrompts: OneLinePromptRow[];
  diaryTopic: DiaryTopicRow | null;
  rantTags: RantTag[];
}

async function loadPostMasterData(type: "diary" | "rant"): Promise<PostMasterData> {
  const { supabase } = await import("../config/supabase");

  const [emotionResult, oneLineResult, rantTags] = await Promise.all([
    supabase
      .from("emotion_tag_master")
      .select("id, code, label, emoji")
      .eq("is_active", true)
      .order("display_order"),
    supabase
      .from("one_line_prompt_master")
      .select("id, text")
      .eq("is_active", true)
      .order("display_order"),
    type === "rant"
      ? rantTagRepository.listWithCounts().catch((): RantTag[] => [])
      : Promise.resolve([] as RantTag[])
  ]);

  let diaryTopic: DiaryTopicRow | null = null;
  if (type === "diary") {
    const { data: topics } = await supabase
      .from("diary_topic_master")
      .select("id, text")
      .eq("is_active", true)
      .order("display_order");
    if (topics && topics.length > 0) {
      const idx = Math.floor(Date.now() / (1000 * 60 * 60 * 24)) % topics.length;
      diaryTopic = topics[idx] as DiaryTopicRow;
    }
  }

  return {
    emotionTags: (emotionResult.data ?? []) as EmotionTagRow[],
    oneLinePrompts: (oneLineResult.data ?? []) as OneLinePromptRow[],
    diaryTopic,
    rantTags
  };
}

function parseEmotionTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string");
      }
    } catch {
      return value.split(",").map((s) => s.trim()).filter(Boolean);
    }
  }
  return [];
}

function parseMoodScore(value: unknown): number | null {
  const n = parseInt(String(value ?? ""), 10);
  return n >= 1 && n <= 5 ? n : null;
}

function calculateStreak(datesSet: Set<string>, today: string): number {
  if (datesSet.has(today)) {
    let streak = 0;
    const d = new Date(today + "T12:00:00Z");
    while (datesSet.has(d.toISOString().slice(0, 10))) {
      streak++;
      d.setDate(d.getDate() - 1);
    }
    return streak;
  }
  const yesterday = new Date(today + "T12:00:00Z");
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().slice(0, 10);
  if (!datesSet.has(yesterdayStr)) return 0;
  let streak = 0;
  const d = new Date(yesterdayStr + "T12:00:00Z");
  while (datesSet.has(d.toISOString().slice(0, 10))) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function todayInTokyo(): string {
  return TOKYO_DATE_FORMATTER.format(new Date());
}

function bearerToken(req: Request): string {
  const header = req.headers.authorization;
  logger.info("auth.bearerToken", {
    path: req.path,
    method: req.method,
    hasAuthHeader: !!header,
    authMethod: header?.startsWith("Bearer ") ? "bearer" : header ? "other" : "none",
  });
  if (!header?.startsWith("Bearer ")) {
    logger.warn("auth.bearerToken.missing", {
      path: req.path,
      reason: header ? "auth header present but not Bearer" : "no auth header",
    });
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
  const [entry, masterData] = await Promise.all([
    liffService.getPage(input.entryKey),
    loadPostMasterData(input.entryKey).catch((): PostMasterData => ({
      emotionTags: [],
      oneLinePrompts: [],
      diaryTopic: null,
      rantTags: []
    }))
  ]);

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
      calendarUrl: "/liff/diary-calendar",
      personalityDataUrl: "/liff/personality-data",
      menuActionKey,
      postedOn,
      emotionTags: masterData.emotionTags,
      oneLinePrompts: masterData.oneLinePrompts,
      diaryTopic: masterData.diaryTopic,
      rantTags: masterData.rantTags,
      fallbackMessage:
        "LIFFが使えない場合は、この画面を閉じてLINEトークにそのまま送信してください。既存のテキスト入力フローに戻れます。"
    }
  });
}

async function incrementCampaignCount(
  assignmentId: string,
  field: "opened_count" | "started_count" | "completed_count"
): Promise<void> {
  const { supabase } = await import("../config/supabase");
  const { data: maps } = await supabase
    .from("campaign_assignment_map")
    .select("campaign_id")
    .eq("assignment_id", assignmentId);
  for (const row of (maps ?? []) as { campaign_id: string }[]) {
    // 現在値を取得して +1 更新
    const { data: camp } = await supabase
      .from("delivery_campaigns")
      .select(field)
      .eq("id", row.campaign_id)
      .single();
    if (camp) {
      const current = (camp as Record<string, number>)[field] ?? 0;
      await supabase
        .from("delivery_campaigns")
        .update({ [field]: current + 1 })
        .eq("id", row.campaign_id);
    }
  }
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

    const emotionTags = parseEmotionTags(req.body.emotion_tags);
    const rantTagCodes = parseEmotionTags(req.body.rant_tag_codes);
    const moodScore = parseMoodScore(req.body.mood_score);
    const goodThing = stringValue(req.body.good_thing).trim() || null;
    const badThing = stringValue(req.body.bad_thing).trim() || null;
    const selectedPromptId = stringValue(req.body.selected_prompt_id).trim() || null;
    const selectedOneLineId = stringValue(req.body.selected_one_line_id).trim() || null;

    const hasStructuredData = emotionTags.length > 0 || rantTagCodes.length > 0 || !!selectedOneLineId || moodScore !== null;
    if (!content && !hasStructuredData) {
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
      emotionTags,
      moodScore,
      goodThing,
      badThing,
      selectedPromptId,
      selectedOneLineId,
      metadata: {
        captured_from: "liff",
        liff_entry_key: type
      }
    });

    void analysisService.analyzePost(post.id);

    let aiReply: string | null = null;
    if (type === "rant") {
      let tagLabels: string[] = [];
      if (rantTagCodes.length > 0) {
        const matchedTags = await rantTagRepository.findByCodes(rantTagCodes).catch(() => []);
        tagLabels = matchedTags.map((t) => t.label);
        void rantTagRepository.savePostTags(
          post.id,
          matchedTags.map((t) => t.id)
        );
      }
      if (content) {
        aiReply = await aiService.generateRantCounselorReply(content, tagLabels).catch(() => null);
        if (aiReply) {
          void postRepository.saveRantReply(post.id, aiReply);
        }
      }
    }

    res.status(201).json({
      ok: true,
      postId: post.id,
      posted_on: post.posted_on,
      aiReply
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

    const mode = stringValue(req.query.mode).trim() || "auto";
    const next = stringValue(req.query.next).trim() || null;
    const sessionId = stringValue(req.query.session_id).trim() || null;

    res.render("liff/mypage", {
      title: entry.title,
      entry,
      initialData: {
        appBaseUrl: env.APP_BASE_URL,
        liffId: entry.liffId,
        mode,
        next,
        sessionId,
        profileUrl: "/liff/mypage-data",
        updateUrl: "/liff/mypage-data",
        confirmMypageUrl: "/liff/session/confirm-mypage",
        historyUrl: "/liff/history-data",
        pointsUrl: "/liff/points-data",
        consentUrl: "/liff/consent-data",
        interactionsUrl: "/liff/interactions",
      }
    });
  },

  /**
   * GET /liff/profile/check
   * 回答開始前のプロフィール確認専用ページ。
   * マイページ機能（ポイント・履歴・ランク）は表示せず、
   * プロフィール確認 → 保存 → 案件へ直接遷移する導線に特化する。
   */
  async profileCheckPage(req: Request, res: Response): Promise<void> {
    // profile-check は常に survey フローからサーバーリダイレクトで到達する。
    // survey LIFF コンテキスト内で別の LIFF ID（mypage）を liff.init() すると
    // LINE SDK が "Invalid LIFF ID" を返すため、survey LIFF ID を使う。
    const liffConfig = getSurveyLiffConfig();

    const rawNext = stringValue(req.query.next);
    const decodedNext = rawNext.trim() || null;
    const sessionId = stringValue(req.query.session_id).trim() || null;

    let assignmentId: string | null = null;
    if (decodedNext) {
      try {
        const parsed = new URL(decodedNext, "http://localhost");
        assignmentId = parsed.searchParams.get("assignment_id");
      } catch {
        // ignore
      }
    }

    logger.info("profile.check.start", {
      rawNext,
      decodedNext,
      assignmentId,
      sessionId,
      liffIdEnv: "LINE_LIFF_ID_SURVEY",
      liffIdSet: Boolean(liffConfig.liffId),
    });

    res.render("liff/profile-check", {
      title: "プロフィール確認",
      initialData: {
        liffId: liffConfig.liffId,
        liffIdEnv: "LINE_LIFF_ID_SURVEY",
        next: decodedNext,
        sessionId,
        profileUrl: "/liff/profile-check-data",
        updateUrl: "/liff/mypage-data",
        confirmMypageUrl: "/liff/session/confirm-mypage",
        isDev: env.NODE_ENV !== "production",
        allowAuthSkip: liffConfig.skipAllowed,
        appBaseUrl: env.APP_BASE_URL,
        liffChannelIdLast4: env.LINE_LIFF_CHANNEL_ID?.slice(-4) ?? null,
      }
    });
  },

  /**
   * GET /liff/profile-check-data
   * プロフィール確認画面専用の軽量プロフィール取得エンドポイント。
   * マイページデータ（ランク・取引履歴等）は返さず、profile のみ返す。
   */
  async getProfileCheckData(req: Request, res: Response): Promise<void> {
    // Step 1: LIFF 認証
    let lineUserId: string;
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith("Bearer ")) {
        logger.warn("profile.check.auth.noToken", { path: req.path });
        res.status(401).json({
          ok: false,
          code: "NO_TOKEN",
          message: "認証情報がありません。LINEアプリ内から開き直してください。",
        });
        return;
      }
      const token = authHeader.slice("Bearer ".length).trim();
      const verifiedUser = await liffAuthService.verifyIdToken(token, {
        path: req.path,
        userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
        referer: typeof req.headers.referer === "string" ? req.headers.referer : undefined,
      });
      lineUserId = verifiedUser.userId;
    } catch (err) {
      const errCode = err instanceof HttpError ? err.message : "LIFF_AUTH_FAILED";
      const status = err instanceof HttpError ? err.statusCode : 401;
      logger.error("profile.check.auth.failed", { errorCode: errCode, status });

      const codeMap: Record<string, { code: string; message: string }> = {
        TOKEN_EXPIRED:      { code: "TOKEN_EXPIRED",      message: "認証情報の有効期限が切れました。LINEから開き直してください。" },
        INVALID_LIFF_CONFIG:{ code: "INVALID_LIFF_CONFIG", message: "LIFF設定に問題があります。運営にお問い合わせください。" },
        NO_ID_TOKEN:        { code: "NO_ID_TOKEN",         message: "認証情報がありません。LINEアプリ内から開き直してください。" },
      };
      const mapped = codeMap[errCode] ?? { code: "AUTH_FAILED", message: "LINE認証に失敗しました。LINEアプリ内から開き直してください。" };

      res.status(status).json({ ok: false, ...mapped });
      return;
    }

    logger.info("profile.check.auth", { lineUserId, hasSession: true });

    // Step 2: プロフィール取得
    try {
      const profile = await userProfileRepository.getByLineUserId(lineUserId);
      logger.info("profile.check.profile", {
        exists: !!profile,
        profileCompleted: profile?.profile_completed ?? false,
      });
      res.json({ ok: true, user_id: lineUserId, profile: profile ?? null });
    } catch (err) {
      logger.error("profile.check.failed", { error: String(err), lineUserId });
      res.status(500).json({
        ok: false,
        code: "DB_ERROR",
        message: "プロフィール情報の取得に失敗しました。しばらくしてから再度お試しください。",
      });
    }
  },

  async getMypageData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;

    const [profile, respondents, ranks, streakRow, earnedAwards, badgeDefs] = await Promise.all([
      userProfileRepository.getByLineUserId(lineUserId),
      respondentRepository.listByLineUserId(lineUserId),
      rankRepository.list(),
      userStreakService.getStreak(lineUserId).catch(() => null),
      userBadgeService.listEarned(lineUserId).catch(() => []),
      userBadgeService.listAllDefinitions().catch(() => []),
    ]);
    const badgeDefMap = new Map(badgeDefs.map(d => [d.badge_code, d]));
    const awardedBadges = earnedAwards.map(a => ({
      badge_code: a.badge_code,
      awarded_at: a.awarded_at,
      badge_name: badgeDefMap.get(a.badge_code)?.badge_name ?? a.badge_code,
      badge_icon: badgeDefMap.get(a.badge_code)?.icon_emoji ?? "🏅",
    }));

    type RespondentRow = { id: string; total_points: number; status: string; current_rank: { rank_name?: string; rank_code?: string; badge_label?: string | null; min_points?: number } | null };
    const typedRespondents = respondents as unknown as RespondentRow[];
    const primaryRespondent = typedRespondents.sort((a, b) => b.total_points - a.total_points)[0] ?? null;
    const completedCount = typedRespondents.filter(r => r.status === "completed").length;

    const totalPoints = primaryRespondent?.total_points ?? 0;
    const currentRank = primaryRespondent?.current_rank ?? null;
    const nextRank = ranks.find(r => r.min_points > totalPoints && r.min_points > (currentRank?.min_points ?? -1)) ?? null;

    const recentTransactions = primaryRespondent
      ? (await pointTransactionRepository.listByRespondent(primaryRespondent.id)).slice(0, 5)
      : [];

    void userProfileRepository.updateLastLogin(lineUserId).catch(() => {});

    res.json({
      ok: true,
      user_id: lineUserId,
      display_name: verifiedUser.displayName,
      profile: profile ?? null,
      stats: {
        total_points: totalPoints,
        rank_name: currentRank?.rank_name ?? "Bronze",
        rank_code: currentRank?.rank_code ?? "bronze",
        badge_label: currentRank?.badge_label ?? null,
        completed_count: completedCount,
        next_rank_min_points: nextRank?.min_points ?? null,
        next_rank_name: nextRank?.rank_name ?? null,
        current_streak: streakRow?.current_streak ?? 0,
        longest_streak: streakRow?.longest_streak ?? 0,
      },
      awarded_badges: awardedBadges,
      recent_transactions: recentTransactions,
    });
  },

  // ------------------------------------------------------------------
  // Survey: アンケート/インタビュー表示
  // ------------------------------------------------------------------

  async surveyPage(req: Request, res: Response): Promise<void> {
    // liff.state は LIFF SDK がリダイレクト時に付与するエンコード済みクエリ文字列。
    // 例: ?liff.state=%3Fassignment_id%3Dxxx → assignment_id=xxx を展開して取得する。
    let liffStateAssignmentId: string | undefined;
    const liffState = stringValue(req.query["liff.state"] ?? "");
    if (liffState) {
      try {
        const params = new URLSearchParams(liffState.startsWith("?") ? liffState.slice(1) : liffState);
        liffStateAssignmentId = params.get("assignment_id") ?? undefined;
      } catch {
        // parse failure → fall through
      }
    }
    const assignmentId = stringValue(req.params.assignmentId ?? liffStateAssignmentId ?? req.query.assignment_id ?? "");
    if (!assignmentId) {
      // 利用者向けに分かりやすいメッセージを返す
      res.status(400).render("liff/survey", {
        title: "アンケート",
        errorMessage: "このURLは無効です。LINEから届いたリンクを開き直してください。",
        project: null,
        projectData: null,
        questions: [],
        pageGroups: [],
        sessionId: null,
        assignmentId: null,
        displayMode: "survey_question",
        liffId: null,
        liffAuthAvailable: false,
        authRequired: false,
      });
      return;
    }

    const liffConfig = getSurveyLiffConfig();

    logger.info("survey.page.liffConfig", {
      assignmentId,
      liffAuthAvailable: liffConfig.liffAuthAvailable,
      authRequired: liffConfig.authRequired,
      skipAllowed: liffConfig.skipAllowed,
      missingEnvVars: liffConfig.missingEnvVars,
    });

    // 本番モード（LIFF_AUTH_REQUIRED=true）でLIFF設定が不足している場合はエラー画面を返す
    if (liffConfig.authRequired && !liffConfig.liffAuthAvailable) {
      logger.warn("survey.page.liffConfigMissing", {
        assignmentId,
        missingEnvVars: liffConfig.missingEnvVars,
      });
      res.status(503).render("liff/survey", {
        title: "アンケート",
        errorMessage: "アンケート画面の設定が完了していません。管理者にお問い合わせください。",
        project: null,
        projectData: null,
        questions: [],
        pageGroups: [],
        sessionId: null,
        assignmentId: null,
        displayMode: "survey_question",
        liffId: null,
        liffAuthAvailable: false,
        authRequired: true,
        skipAllowed: false,
      });
      return;
    }

    const assignment = await projectAssignmentRepository.getById(assignmentId);

    const project = await projectRepository.getById(assignment.project_id);

    // アクティブなセッションを先に取得してフロー分岐に利用する
    let sessionForCheck = await sessionRepository.getActiveByRespondent(assignment.respondent_id, project.id);

    // スクリーニング対象外（fall）: 既に fail 判定済みの場合は対象外画面を返す
    if (sessionForCheck?.state_json?.screening_result === "fail") {
      logger.info("[surveyPage] branch=screeningFailed", { assignmentId });
      const DEFAULT_FAIL_MESSAGE = "今回はご参加いただけませんでした。またの機会にご協力をお願いします。";
      res.render("liff/survey", {
        title: project.user_display_title || project.name,
        screeningFailed: true,
        screeningFailMessage: project.screening_config?.fail_message?.trim() || DEFAULT_FAIL_MESSAGE,
        errorMessage: null,
        project: null,
        projectData: null,
        questions: [],
        pageGroups: [],
        sessionId: sessionForCheck.id,
        assignmentId: assignment.id,
        displayMode: project.display_mode ?? "survey_question",
        liffId: liffConfig.liffId,
        liffAuthAvailable: liffConfig.liffAuthAvailable,
        authRequired: false,
        skipAllowed: true,
      });
      return;
    }

    // プロフィール確認: user_id が判明しており、かつ今セッションでまだ確認していない場合はプロフィール確認画面へ誘導する
    if (assignment.user_id && !sessionForCheck?.state_json?.mypage_confirmed_at) {
      logger.info("[surveyPage] branch=profileCheckRedirect", { assignmentId });
      // session_id が空のまま渡すと confirm-mypage が 400 になり無限リダイレクトになるため、
      // セッションが未作成の場合はここで先行作成する
      if (!sessionForCheck) {
        const firstQuestion = (await questionRepository.listByProject(project.id)).find(q => !q.is_hidden) ?? null;
        sessionForCheck = await sessionRepository.create({
          respondent_id: assignment.respondent_id,
          project_id: project.id,
          current_question_id: firstQuestion?.id ?? null,
          current_phase: "question",
          status: "active",
        });
      }
      const currentUrl = `/liff/survey?assignment_id=${encodeURIComponent(assignmentId)}`;
      res.redirect(
        `/liff/profile/check?next=${encodeURIComponent(currentUrl)}&session_id=${encodeURIComponent(sessionForCheck.id)}`
      );
      return;
    }

    // 二重回答防止: 既に完了済みの場合は完了済み画面を返す
    if (assignment.status === "completed") {
      logger.info("[surveyPage] branch=alreadyCompleted", { assignmentId });
      res.render("liff/survey", {
        title: project.user_display_title || project.name,
        alreadyCompleted: true,
        errorMessage: null,
        project: null,
        projectData: null,
        questions: [],
        pageGroups: [],
        sessionId: null,
        assignmentId: assignment.id,
        displayMode: project.display_mode ?? "survey_question",
        liffId: liffConfig.liffId,
        liffAuthAvailable: liffConfig.liffAuthAvailable,
        authRequired: false,
        skipAllowed: true,
      });
      return;
    }

    const questions = await questionRepository.listByProject(project.id);
    const pageGroups = await questionPageGroupRepository.listByProject(project.id);

    // アクティブなセッションを探す、なければ作成（上で既に取得済みの場合は再利用）
    let session = sessionForCheck;
    if (!session) {
      const firstQuestion = questions.find(q => !q.is_hidden) ?? null;
      session = await sessionRepository.create({
        respondent_id: assignment.respondent_id,
        project_id: project.id,
        current_question_id: firstQuestion?.id ?? null,
        current_phase: "question",
        status: "active",
      });
    }

    // スクリーニング質問の有無でレンダリング対象を切り替える
    const allVisible = questions.filter(q => !q.is_hidden);
    const screeningQuestions = allVisible.filter(q => q.question_role === "screening");
    const screeningConfigEnabled = project.screening_config?.enabled === true;
    const hasScreeningQuestions = screeningQuestions.length > 0 && screeningConfigEnabled;
    const screeningJudged = !!session.state_json?.screening_result;

    let renderQuestions: typeof questions;
    let surveyPhase: "screening" | "main";
    if (hasScreeningQuestions && !screeningJudged) {
      // スクリーニング未判定: スクリーニング設問のみ表示
      renderQuestions = screeningQuestions;
      surveyPhase = "screening";
    } else {
      // スクリーニング不要 or 通過済み: メイン設問（非スクリーニング）のみ表示
      renderQuestions = allVisible.filter(q => q.question_role !== "screening");
      surveyPhase = "main";
    }

    // アサインメントを started に更新
    if (
      assignment.status === "sent" ||
      assignment.status === "opened" ||
      assignment.status === "assigned"
    ) {
      await projectAssignmentRepository.update(assignment.id, {
        status: "started",
        started_at: new Date().toISOString(),
      });
      // キャンペーン開封・開始カウントアップ（非同期・エラーは無視）
      void incrementCampaignCount(assignment.id, "started_count").catch(() => {});
    }

    const DEFAULT_FAIL_MSG = "今回はご参加いただけませんでした。またの機会にご協力をお願いします。";
    const renderData = {
      title: project.user_display_title || project.name,
      project,
      projectData: {
        id: project.id,
        name: project.user_display_title || project.name,
        display_mode: project.display_mode ?? "survey_question",
      },
      questions: renderQuestions,
      pageGroups,
      sessionId: session.id,
      assignmentId: assignment.id,
      displayMode: project.display_mode ?? "survey_question",
      surveyPhase,
      screeningFailMessage: project.screening_config?.fail_message?.trim() || DEFAULT_FAIL_MSG,
      liffId: liffConfig.liffId,
      liffAuthAvailable: liffConfig.liffAuthAvailable,
      authRequired: liffConfig.authRequired,
      skipAllowed: liffConfig.skipAllowed,
    };

    logger.info("[surveyPage] before render survey.ejs", {
      assignmentId,
      questionsCount: renderData.questions.length,
      displayMode: renderData.displayMode,
      sessionId: renderData.sessionId,
    });

    res.render("liff/survey", renderData, (err, html) => {
      if (err) {
        logger.error("[surveyPage] render error", { assignmentId, error: String(err) });
        return res.status(500).send("survey render error: " + err.message);
      }
      logger.info("[surveyPage] rendered html length=" + html.length, { assignmentId });
      return res.send(html);
    });
  },

  /**
   * POST /liff/survey/verify-identity
   * LIFF ID token を受け取り、assignmentId の所有者と一致するか検証する。
   * 一致した場合は { ok: true } を返し、LIFF 側はそのまま回答を続行できる。
   * 不一致・未設定・エラーの場合はそれぞれ適切なステータスコードとメッセージを返す。
   */
  async verifyIdentity(req: Request, res: Response): Promise<void> {
    const liffConfig = getSurveyLiffConfig();
    const assignmentId = stringValue(req.body.assignment_id).trim();

    logger.info("verifyIdentity.start", { assignmentId });

    if (!liffConfig.liffAuthAvailable) {
      logger.warn("verifyIdentity.liffNotConfigured", {
        assignmentId,
        missingEnvVars: liffConfig.missingEnvVars,
        authRequired: liffConfig.authRequired,
      });
      // 本番モード（authRequired=true）では設定不足でも 503 を返し、クライアント側でブロックさせる
      res.status(503).json({
        ok: false,
        code: "LIFF_NOT_CONFIGURED",
        message: "アンケート画面の設定が完了していません。管理者にお問い合わせください。",
        skipAllowed: liffConfig.skipAllowed,
      });
      return;
    }

    const idToken = stringValue(req.body.id_token).trim();

    if (!idToken) {
      res.status(400).json({ ok: false, code: "MISSING_ID_TOKEN", message: "id_token が必要です。" });
      return;
    }
    if (!assignmentId) {
      res.status(400).json({ ok: false, code: "MISSING_ASSIGNMENT_ID", message: "assignment_id が必要です。" });
      return;
    }

    let verifiedUser: Awaited<ReturnType<typeof liffAuthService.verifyIdToken>>;
    try {
      verifiedUser = await liffAuthService.verifyIdToken(idToken);
    } catch (err) {
      logger.warn("verifyIdentity.tokenVerificationFailed", {
        assignmentId,
        error: String(err),
      });
      throw err;
    }

    // assignment の LINE User ID と照合
    const assignment = await projectAssignmentRepository.getById(assignmentId);

    // assignment に LINE User ID が未設定の場合
    if (!assignment.user_id) {
      if (env.NODE_ENV === "production") {
        logger.warn("verifyIdentity.noLineUserId.blocked", {
          assignmentId,
          respondentId: assignment.respondent_id,
        });
        res.status(403).json({
          ok: false,
          code: "IDENTITY_MISMATCH",
          message: "本人確認に失敗しました。LINEアプリ内から開き直してください。",
        });
        return;
      }
      logger.warn("verifyIdentity.noLineUserId.devSkip", {
        assignmentId,
        respondentId: assignment.respondent_id,
        verifiedUserId: verifiedUser.userId,
      });
      res.json({ ok: true, userId: verifiedUser.userId });
      return;
    }

    if (assignment.user_id !== verifiedUser.userId) {
      logger.warn("verifyIdentity.mismatch", {
        assignmentId,
        respondentId: assignment.respondent_id,
        reason: "LINE user ID does not match assignment.user_id",
      });
      res.status(403).json({
        ok: false,
        code: "IDENTITY_MISMATCH",
        message: "本人確認に失敗しました。LINEアプリ内から開き直してください。",
      });
      return;
    }

    logger.info("verifyIdentity.success", {
      assignmentId,
      respondentId: assignment.respondent_id,
    });

    res.json({ ok: true, userId: verifiedUser.userId });
  },

  async submitSurveyAnswer(req: Request, res: Response): Promise<void> {
    const sessionId = stringValue(req.body.session_id).trim();
    const questionCode = stringValue(req.body.question_code).trim();
    const answerValue = req.body.answer_value;
    const freeTextRaw = stringValue(req.body.free_text_answer).trim() || null;
    const normalizedAnswerRaw = req.body.normalized_answer;

    console.log("RECEIVED_ANSWER", { sessionId, questionCode, answerValue, freeTextRaw });

    if (!sessionId || !questionCode) {
      res.status(400).json({ ok: false, error: "session_id と question_code は必須です。" });
      return;
    }

    const session = await sessionRepository.getById(sessionId);
    console.log("ASSIGNMENT_STATE", { session_id: session.id, project_id: session.project_id, status: session.status });

    const question = await questionRepository.getByProjectAndCode(session.project_id, questionCode);
    if (!question) {
      res.status(404).json({ ok: false, error: `質問コードが見つかりません: ${questionCode}` });
      return;
    }

    const answerText = Array.isArray(answerValue)
      ? answerValue.join(",")
      : String(answerValue ?? "");

    const normalizedAnswer =
      normalizedAnswerRaw !== null &&
      normalizedAnswerRaw !== undefined &&
      typeof normalizedAnswerRaw === "object"
        ? (normalizedAnswerRaw as Record<string, unknown>)
        : null;

    await answerRepository.create({
      session_id: sessionId,
      question_id: question.id,
      answer_text: answerText,
      free_text_answer: freeTextRaw,
      answer_role: "primary",
      normalized_answer: normalizedAnswer ?? undefined,
    });

    await sessionRepository.update(sessionId, { current_question_id: question.id });

    res.json({ ok: true });
  },

  async uploadRespondentImage(req: Request, res: Response): Promise<void> {
    const body = req.body as {
      session_id?: unknown;
      assignment_id?: unknown;
      data?: unknown;
      filename?: unknown;
      mimeType?: unknown;
    };

    const sessionId = stringValue(body.session_id).trim();
    const assignmentId = stringValue(body.assignment_id).trim();
    const base64Data = typeof body.data === "string" ? body.data : null;
    const filename = typeof body.filename === "string"
      ? body.filename.replace(/[^a-zA-Z0-9._-]/g, "_")
      : "upload";
    const mimeType = typeof body.mimeType === "string" ? body.mimeType : "image/jpeg";

    if (!sessionId || !assignmentId) {
      res.status(400).json({ ok: false, error: "session_id と assignment_id は必須です。" });
      return;
    }
    if (!base64Data) {
      res.status(400).json({ ok: false, error: "data (base64) は必須です。" });
      return;
    }
    if (!["image/png", "image/jpeg", "image/jpg", "image/webp", "image/heic"].includes(mimeType)) {
      res.status(400).json({ ok: false, error: "サポートされていない画像形式です。" });
      return;
    }

    const session = await sessionRepository.getById(sessionId);
    if (!session) {
      res.status(403).json({ ok: false, error: "セッションが見つかりません。" });
      return;
    }
    const assignment = await projectAssignmentRepository.getById(assignmentId);
    if (!assignment || assignment.id !== assignmentId) {
      res.status(403).json({ ok: false, error: "割り当て情報が正しくありません。" });
      return;
    }

    const buffer = Buffer.from(base64Data, "base64");
    const maxSizeMb = 10;
    if (buffer.byteLength > maxSizeMb * 1024 * 1024) {
      res.status(400).json({ ok: false, error: `画像サイズは${maxSizeMb}MB以下にしてください。` });
      return;
    }

    const { supabase } = await import("../config/supabase");
    const ext = mimeType === "image/heic" ? "heic" : mimeType.split("/")[1] ?? "jpg";
    const storagePath = storagePaths.respondent(sessionId, `${Date.now()}-${filename}.${ext}`);

    const { error: uploadError } = await supabase.storage
      .from(STORAGE_BUCKET)
      .upload(storagePath, buffer, { contentType: mimeType, upsert: false });

    if (uploadError) {
      console.error("Storage upload error", uploadError);
      res.status(500).json({ ok: false, error: `アップロードに失敗しました: ${uploadError.message}` });
      return;
    }

    const { data: urlData } = supabase.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(storagePath);

    res.json({ ok: true, url: urlData.publicUrl, path: storagePath });
  },

  async completeSurvey(req: Request, res: Response): Promise<void> {
    const sessionId = stringValue(req.body.session_id).trim();
    const assignmentId = stringValue(req.body.assignment_id).trim();

    if (sessionId) {
      await sessionRepository.update(sessionId, {
        status: "completed",
        current_phase: "completed",
        completed_at: new Date().toISOString(),
      });
    }
    if (assignmentId) {
      await projectAssignmentRepository.update(assignmentId, {
        status: "completed",
        completed_at: new Date().toISOString(),
      });
    }

    res.json({ ok: true });
  },

  /**
   * POST /liff/survey/:assignmentId/complete
   * サーバー側で完了を確定する。べき等性あり・ポイント付与・LINE通知を行う。
   */
  async completeSurveyByAssignment(req: Request, res: Response): Promise<void> {
    const assignmentId = stringValue(req.params.assignmentId).trim();
    const sessionIdFromBody = stringValue(req.body.session_id).trim() || null;

    if (!assignmentId) {
      res.status(400).json({ ok: false, error: "assignment_id は必須です。" });
      return;
    }

    const assignment = await projectAssignmentRepository.getById(assignmentId);

    // べき等性: 既に完了済みの場合は処理をスキップして成功を返す
    if (assignment.status === "completed") {
      res.json({ ok: true, alreadyCompleted: true });
      return;
    }

    const now = new Date().toISOString();

    const [project, respondent] = await Promise.all([
      projectRepository.getById(assignment.project_id),
      respondentRepository.getById(assignment.respondent_id),
    ]);

    // セッションを取得（body 指定 → アクティブ検索 の優先順）
    let session = null as import("../types/domain").Session | null;
    if (sessionIdFromBody) {
      try {
        session = await sessionRepository.getById(sessionIdFromBody);
      } catch {
        logger.warn("completeSurveyByAssignment.session.notFound", { assignmentId, sessionIdFromBody });
      }
    }
    if (!session) {
      session = await sessionRepository.getActiveByRespondent(assignment.respondent_id, assignment.project_id);
    }

    // セッションを完了状態へ更新
    if (session && session.status !== "completed") {
      session = await sessionRepository.update(session.id, {
        status: "completed",
        current_phase: "completed",
        completed_at: now,
        state_json: {
          ...session.state_json,
          phase: "completed",
          pendingQuestionId: null,
          pendingProbeQuestion: null,
          pendingProbeSourceQuestionId: null,
          pendingProbeSourceAnswerId: null,
          pendingProbeReason: null,
          pendingProbeType: null,
          pendingProbeMissingSlots: [],
          pendingFreeComment: false,
          freeCommentPromptShown: false,
          freeCommentProbeAsked: false,
          pendingFreeCommentPrompt: null,
          pendingFreeCommentSourceAnswerId: null,
          pendingFreeCommentSourceText: null,
          pendingFreeCommentReason: null,
          pendingFreeCommentProbeType: null,
          pendingFreeCommentMissingSlots: [],
        },
      });
    }

    // アサインメントを完了状態へ更新
    await projectAssignmentRepository.update(assignmentId, {
      status: "completed",
      completed_at: now,
    });

    // キャンペーン完了カウントアップ（非同期・エラーは無視）
    void incrementCampaignCount(assignmentId, "completed_count").catch(() => {});

    // DB更新完了後すぐにレスポンスを返し、重い後処理は非同期で実行する
    res.json({ ok: true, alreadyCompleted: false });

    if (!session) {
      logger.warn("completeSurveyByAssignment.noSession", {
        assignmentId,
        respondentId: respondent.id,
      });
    }

    void runPostCompleteProcess({
      assignmentId,
      session,
      respondent,
      project,
      lineUserId: assignment.user_id,
    }).catch((err: unknown) => {
      logger.error("completeSurveyByAssignment.postComplete.unhandled", {
        assignmentId,
        error: String(err),
      });
    });
  },

  async chatMessage(req: Request, res: Response): Promise<void> {
    const sessionId = stringValue(req.body.session_id).trim();
    const message = stringValue(req.body.message).trim();

    if (!sessionId || !message) {
      res.json({ probe_question: null });
      return;
    }

    const session = await sessionRepository.getById(sessionId);
    if (!session || session.status !== "active") {
      res.json({ probe_question: null });
      return;
    }

    const currentQuestionId = session.current_question_id;
    if (!currentQuestionId) {
      res.json({ probe_question: null });
      return;
    }

    const question = await questionRepository.getById(currentQuestionId);
    const project = await projectRepository.getById(session.project_id);
    const settings = getProjectResearchSettings(project);

    if (!settings.probe_policy.enabled) {
      res.json({ probe_question: null });
      return;
    }

    // survey_interview: ai_probe_enabled === true が必須。interview: false でなければOK
    const rawAiProbeAllowed = project.research_mode === "interview"
      ? question.ai_probe_enabled !== false
      : question.ai_probe_enabled === true;

    if (!rawAiProbeAllowed) {
      res.json({ probe_question: null });
      return;
    }

    const contextType = question.question_role === "free_comment" ? "free_comment" : project.research_mode;
    const meta = normalizeQuestionMeta(question, contextType, { projectAiState: project.ai_state_json });
    const probeCountPerQuestion = session.state_json?.aiProbeCountPerQuestion ?? {};
    const currentProbeCountForAnswer = probeCountPerQuestion[currentQuestionId] ?? 0;
    const currentProbeCountForSession = session.state_json?.aiProbeCount ?? 0;

    const maxProbesPerAnswer = Math.min(
      env.MAX_AI_PROBES_PER_ANSWER,
      settings.probe_policy.max_probes_per_answer,
      meta.probe_config.max_probes
    );
    const maxProbesPerSession = Math.min(
      env.MAX_AI_PROBES_PER_SESSION,
      settings.probe_policy.max_probes_per_session
    );

    logger.info("PROBE_CHECK_LIFF", {
      sessionId,
      questionId: question.id,
      questionCode: question.question_code,
      questionType: question.question_type,
      ai_probe_enabled: question.ai_probe_enabled,
      answerText: message,
      currentProbeCountForAnswer,
      currentProbeCountForSession,
      maxProbesPerAnswer,
      maxProbesPerSession,
      probePolicyEnabled: settings.probe_policy.enabled,
      maxProbesFromMeta: meta.probe_config.max_probes
    });

    if (currentProbeCountForAnswer >= maxProbesPerAnswer || currentProbeCountForSession >= maxProbesPerSession) {
      res.json({ probe_question: null });
      return;
    }

    try {
      const analysis = await aiService.analyzeAnswer({
        sessionId: session.id,
        project,
        question,
        nextQuestion: null,
        answer: message,
        existingSlots: {},
        maxProbes: maxProbesPerAnswer,
        aiProbeEnabled: true,
        currentProbeCount: currentProbeCountForAnswer
      });

      logger.info("PROBE_CHECK_LIFF_RESULT", {
        sessionId,
        questionCode: question.question_code,
        analysisAction: analysis.action,
        probeType: analysis.probe_type,
        suggestedProbeQuestion: analysis.question,
        reason: analysis.reason
      });

      if (analysis.action === "probe" && analysis.question) {
        await sessionRepository.update(session.id, {
          current_phase: "ai_probe",
          state_json: {
            ...session.state_json,
            aiProbeCount: currentProbeCountForSession + 1,
            aiProbeCountCurrentAnswer: currentProbeCountForAnswer + 1,
            aiProbeCountPerQuestion: {
              ...probeCountPerQuestion,
              [currentQuestionId]: currentProbeCountForAnswer + 1
            }
          }
        });
        res.json({ probe_question: analysis.question });
        return;
      }
    } catch (err) {
      logger.warn("chatMessage.probe.failed", { sessionId, error: String(err) });
    }

    res.json({ probe_question: null });
  },

  async getHistoryData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;

    const respondents = await respondentRepository.listByLineUserId(lineUserId);
    if (respondents.length === 0) {
      res.json({ ok: true, history: [] });
      return;
    }

    const { supabase } = await import("../config/supabase");
    const respondentIds = respondents.map(r => r.id);

    const { data: assignments } = await supabase
      .from("project_assignments")
      .select("id, project_id, status, completed_at, started_at, assigned_at")
      .in("respondent_id", respondentIds)
      .order("assigned_at", { ascending: false })
      .limit(50);

    const projectIds = [...new Set(((assignments ?? []) as { project_id: string }[]).map(a => a.project_id))];
    const { data: projects } = projectIds.length > 0
      ? await supabase.from("projects").select("id, name, user_display_title, reward_points").in("id", projectIds)
      : { data: [] };

    const projectMap = Object.fromEntries(
      ((projects ?? []) as { id: string; name: string; user_display_title: string | null; reward_points: number | null }[])
        .map(p => [p.id, p])
    );

    const history = ((assignments ?? []) as {
      id: string; project_id: string; status: string;
      completed_at: string | null; started_at: string | null; assigned_at: string | null;
    }[]).map(a => {
      const proj = projectMap[a.project_id];
      return {
        assignment_id: a.id,
        project_id: a.project_id,
        project_name: proj ? (proj.user_display_title?.trim() || proj.name) : "不明",
        reward_points: proj?.reward_points ?? null,
        status: a.status,
        completed_at: a.completed_at,
        assigned_at: a.assigned_at,
      };
    });

    res.json({ ok: true, history });
  },

  async getPointsData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;

    const respondents = await respondentRepository.listByLineUserId(lineUserId);
    const primary = respondents.sort((a, b) => b.total_points - a.total_points)[0] ?? null;

    if (!primary) {
      res.json({ ok: true, total_points: 0, transactions: [] });
      return;
    }

    const transactions = await pointTransactionRepository.listByRespondent(primary.id);

    res.json({
      ok: true,
      total_points: primary.total_points,
      transactions: transactions.map(t => ({
        id: t.id,
        type: t.transaction_type,
        points: t.points,
        reason: t.reason,
        created_at: t.created_at,
      })),
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

    function parseGender(v: unknown): Gender | null {
      const s = stringValue(v).trim();
      if (s === "male" || s === "female" || s === "other" || s === "prefer_not_to_say") {
        return s;
      }
      return null;
    }

    const input: UserProfileUpsertInput = {
      nickname: stringValue(body.nickname).trim() || null,
      birth_date: parseDate(body.birth_date),
      gender: parseGender(body.gender),
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

    // 必須項目が全て揃っていれば profile_completed を自動で true にする
    const requiredFields = [profile.nickname, profile.birth_date, profile.gender, profile.prefecture, profile.occupation, profile.industry];
    if (!profile.profile_completed && requiredFields.every(f => f !== null && f !== "")) {
      await userProfileRepository.markProfileCompleted(verifiedUser.userId);
      res.json({ ok: true, profile: { ...profile, profile_completed: true }, profile_just_completed: true });
      return;
    }

    res.json({ ok: true, profile, profile_just_completed: false });
  },

  async getProfileStatus(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const profile = await userProfileRepository.getByLineUserId(verifiedUser.userId);
    res.json({
      ok: true,
      profile_completed: profile?.profile_completed ?? false,
    });
  },

  // ============================================================
  // Phase 2-D: 同意管理
  // ============================================================

  async getConsentData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const { supabase } = await import("../config/supabase");

    const { data } = await supabase
      .from("user_consent")
      .select("consent_type, consented, version, consented_at")
      .eq("line_user_id", verifiedUser.userId);

    const consentMap: Record<string, { consented: boolean; consented_at: string }> = {};
    for (const row of (data ?? []) as { consent_type: string; consented: boolean; consented_at: string }[]) {
      consentMap[row.consent_type] = { consented: row.consented, consented_at: row.consented_at };
    }

    res.json({ ok: true, consents: consentMap });
  },

  async updateConsentData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const body = req.body as Record<string, unknown>;
    const consentType = stringValue(body.consent_type).trim();
    const consented = body.consented === true || body.consented === "true";

    const OPTIONAL_TYPES = ["ai_analysis", "company_data_share", "ai_learning"];
    if (!OPTIONAL_TYPES.includes(consentType)) {
      throw new HttpError(400, "この同意設定は変更できません");
    }

    const { supabase } = await import("../config/supabase");
    await supabase.from("user_consent").upsert(
      {
        line_user_id: verifiedUser.userId,
        consent_type: consentType,
        consented,
        consented_at: new Date().toISOString(),
      },
      { onConflict: "line_user_id,consent_type" }
    );

    res.json({ ok: true, consent_type: consentType, consented });
  },

  async contactPage(_req: Request, res: Response): Promise<void> {
    const liffId = env.LINE_LIFF_ID_CONTACT ?? env.LINE_LIFF_ID ?? "";
    res.render("liff/contact", {
      title: "お問い合わせ",
      initialData: {
        liffId,
        submitUrl: "/liff/contact",
      },
    });
  },

  async getDiaryCalendar(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const { supabase } = await import("../config/supabase");

    const since = new Date();
    since.setDate(since.getDate() - 90);

    const { data } = await supabase
      .from("user_posts")
      .select("posted_on, created_at, mood_score, emotion_tags")
      .eq("user_id", verifiedUser.userId)
      .eq("type", "diary")
      .gte("created_at", since.toISOString())
      .order("created_at", { ascending: false })
      .limit(300);

    type PostRow = { posted_on: string | null; created_at: string; mood_score: number | null; emotion_tags: string[] | null };
    const posts = (data ?? []) as PostRow[];

    const byDate = new Map<string, { mood_score: number | null; emotion_tags: string[] }>();
    for (const post of posts) {
      const date = post.posted_on ?? post.created_at.slice(0, 10);
      if (!byDate.has(date)) {
        byDate.set(date, {
          mood_score: post.mood_score ?? null,
          emotion_tags: Array.isArray(post.emotion_tags) ? post.emotion_tags : []
        });
      }
    }

    const today = todayInTokyo();
    const datesSet = new Set(byDate.keys());
    const streak = calculateStreak(datesSet, today);

    const entries = Array.from(byDate.entries())
      .map(([date, d]) => ({ date, mood_score: d.mood_score, emotion_tags: d.emotion_tags }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const moodTrend: { date: string; mood_score: number | null }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today + "T12:00:00Z");
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      moodTrend.push({ date: dateStr, mood_score: byDate.get(dateStr)?.mood_score ?? null });
    }

    res.json({
      ok: true,
      entries,
      stats: {
        total_entries: byDate.size,
        streak,
        last_entry_date: entries[0]?.date ?? null
      },
      mood_trend: moodTrend
    });
  },

  /**
   * POST /liff/session/confirm-mypage
   * マイページ確認完了をセッションに記録する。
   * 呼び出し元: mypage.ejs の「確認完了」ボタン
   */
  async confirmMypage(req: Request, res: Response): Promise<void> {
    const sessionId = stringValue(req.body.session_id).trim();
    if (!sessionId) {
      res.status(400).json({ ok: false, error: "session_id は必須です。" });
      return;
    }
    const session = await sessionRepository.getById(sessionId);
    await sessionRepository.update(session.id, {
      state_json: {
        ...session.state_json,
        mypage_confirmed_at: new Date().toISOString()
      }
    });
    res.json({ ok: true });
  },

  /**
   * POST /liff/survey/:assignmentId/judge-screening
   * スクリーニング回答を収集してプロフィール+回答で合否を判定し、
   * セッションに結果を保存して返す。
   */
  async judgeScreening(req: Request, res: Response): Promise<void> {
    const assignmentId = stringValue(req.params.assignmentId).trim();
    const sessionId = stringValue(req.body.session_id).trim();

    if (!assignmentId || !sessionId) {
      res.status(400).json({ ok: false, error: "assignment_id と session_id は必須です。" });
      return;
    }

    const [assignment, session] = await Promise.all([
      projectAssignmentRepository.getById(assignmentId),
      sessionRepository.getById(sessionId)
    ]);

    // べき等性: 既に判定済みの場合はそのまま結果を返す
    if (session.state_json?.screening_result) {
      res.json({
        ok: true,
        judgement: session.state_json.screening_result,
        already_judged: true
      });
      return;
    }

    // スクリーニング設問と回答を取得
    const { supabase } = await import("../config/supabase");
    const allQuestions = await questionRepository.listByProject(assignment.project_id);
    const screeningQs = allQuestions.filter(q => q.is_screening_question || q.question_role === "screening");
    const screeningQIds = screeningQs.map(q => q.id);

    const answerMap: Record<string, string> = {};
    if (screeningQIds.length > 0) {
      const { data: answers } = await supabase
        .from("answers")
        .select("question_id, answer_text")
        .eq("session_id", sessionId)
        .in("question_id", screeningQIds);

      for (const a of (answers ?? []) as { question_id: string; answer_text: string }[]) {
        const q = screeningQs.find(sq => sq.id === a.question_id);
        if (q) answerMap[q.question_code] = a.answer_text;
      }
    }

    const { judgement, failed_conditions } = await screeningService.judgeScreening({
      projectId: assignment.project_id,
      lineUserId: assignment.user_id ?? null,
      screeningQuestions: screeningQs,
      screeningAnswers: answerMap
    });

    const now = new Date().toISOString();
    await sessionRepository.update(sessionId, {
      state_json: {
        ...session.state_json,
        screening_result: judgement,
        screening_failed_conditions: failed_conditions,
        screening_judged_at: now
      }
    });

    // 永続的な判定結果を project_assignments にも保存する（管理画面・集計用）
    await projectAssignmentRepository.update(assignmentId, {
      screening_result: judgement === "pass" ? "passed" : "failed",
      screening_result_at: now,
    });

    logger.info("[judgeScreening] completed", {
      assignmentId,
      sessionId,
      judgement,
      failedCount: failed_conditions.length
    });

    res.json({ ok: true, judgement, failed_conditions, already_judged: false });
  },

  // ============================================================
  // デイリーアンケート LIFF
  // ============================================================

  async dailySurveyPage(req: Request, res: Response): Promise<void> {
    const liffId = env.LINE_LIFF_ID_SURVEY ?? env.LINE_LIFF_ID ?? "";
    const surveyId = stringValue(req.query.survey_id).trim();
    res.render("liff/daily-survey", {
      title: "デイリーアンケート",
      initialData: {
        liffId,
        surveyId,
        answerUrl: `/liff/daily-survey/${encodeURIComponent(surveyId)}/answer`,
      },
    });
  },

  async getDailySurveyData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const surveyId = stringValue(req.query.survey_id).trim();
    if (!surveyId) throw new HttpError(400, "survey_id は必須です。");

    const [survey, questions] = await Promise.all([
      dailySurveyService.getById(surveyId),
      dailySurveyService.listQuestions(surveyId),
    ]);

    if (survey.status !== "active") {
      throw new HttpError(404, "このアンケートは現在受け付けていません。");
    }

    const { supabase } = await import("../config/supabase");

    // 既存の配信レコードを取得（LINEから開いた場合は存在する）
    const { data: deliveryRow } = await supabase
      .from("daily_survey_deliveries")
      .select("*")
      .eq("survey_id", surveyId)
      .eq("line_user_id", verifiedUser.userId)
      .maybeSingle();

    type DeliveryRow = { id: string; status: string } | null;
    const delivery = deliveryRow as DeliveryRow;

    if (delivery?.status === "answered") {
      res.json({ ok: true, alreadyAnswered: true });
      return;
    }

    // 配信レコードがなければ（直接URL訪問）作成する
    let finalDelivery = delivery;
    if (!finalDelivery) {
      const created = await dailySurveyRepository.upsertDelivery({
        survey_id: surveyId,
        line_user_id: verifiedUser.userId,
        status: "opened",
      });
      finalDelivery = created;
    } else if (finalDelivery.status === "sent" || finalDelivery.status === "pending") {
      await dailySurveyRepository.markDeliveryStatus(finalDelivery.id, "opened");
    }

    res.json({
      ok: true,
      alreadyAnswered: false,
      survey,
      questions,
      delivery: finalDelivery,
    });
  },

  async submitDailySurveyAnswer(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const surveyId = stringValue(req.params.surveyId).trim();
    const body = req.body as Record<string, unknown>;

    if (!surveyId) throw new HttpError(400, "surveyId は必須です。");

    const deliveryId = stringValue(body.deliveryId).trim();
    const rawAnswers = Array.isArray(body.answers) ? body.answers : [];

    if (!deliveryId) throw new HttpError(400, "deliveryId は必須です。");
    if (rawAnswers.length === 0) throw new HttpError(400, "回答が含まれていません。");

    const answers = rawAnswers as Array<{ questionId: string; answerValue: unknown }>;

    const result = await dailySurveyService.recordAnswer({
      lineUserId: verifiedUser.userId,
      surveyId,
      deliveryId,
      answers,
    });

    const streakRow = await userStreakService.getStreak(verifiedUser.userId);

    res.json({
      ok: true,
      ...result,
      currentStreak: streakRow.current_streak,
    });
  },

  async submitContact(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const body = req.body as Record<string, unknown>;

    const name = stringValue(body.name).trim();
    const email = stringValue(body.email).trim();
    const category = stringValue(body.category).trim();
    const message = stringValue(body.message).trim();

    const VALID_CATEGORIES = ["service", "project", "bug", "points", "other"];
    if (!name) throw new HttpError(400, "名前は必須です。");
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "メールアドレスが正しくありません。");
    if (!VALID_CATEGORIES.includes(category)) throw new HttpError(400, "問い合わせ種別が正しくありません。");
    if (!message) throw new HttpError(400, "問い合わせ内容は必須です。");

    const { supabase } = await import("../config/supabase");

    // respondent を取得（user_id 解決用、失敗しても続行）
    let userId: string | null = null;
    try {
      const { data: respondent } = await supabase
        .from("respondents")
        .select("id")
        .eq("line_user_id", verifiedUser.userId)
        .maybeSingle();
      userId = (respondent as { id: string } | null)?.id ?? null;
    } catch {
      // user_id 未解決でも問い合わせは保存する
    }

    const CATEGORY_LABELS: Record<string, string> = {
      service: "サービスについて",
      project: "案件について",
      bug: "不具合報告",
      points: "ポイントについて",
      other: "その他",
    };

    await supabase.from("contact_messages").insert({
      user_id: userId,
      line_user_id: verifiedUser.userId,
      name,
      email,
      category,
      message,
      status: "NEW",
    });

    if (env.RESEND_API_KEY && env.ADMIN_NOTIFICATION_EMAIL) {
      try {
        const { Resend } = await import("resend");
        const resend = new Resend(env.RESEND_API_KEY);
        await resend.emails.send({
          from: "noreply@resend.dev",
          to: env.ADMIN_NOTIFICATION_EMAIL,
          subject: `【お問い合わせ】${CATEGORY_LABELS[category] ?? category}`,
          text: [
            `名前: ${name}`,
            `メールアドレス: ${email}`,
            `LINE User ID: ${verifiedUser.userId}`,
            `種別: ${CATEGORY_LABELS[category] ?? category}`,
            ``,
            `問い合わせ内容:`,
            message,
          ].join("\n"),
        });
      } catch (err) {
        logger.error("お問い合わせメール送信失敗", { err });
      }
    }

    res.json({ ok: true });
  },

  // ---- 案件一覧 ----

  async projectDetailPage(req: Request, res: Response): Promise<void> {
    const liffId = process.env.LINE_LIFF_ID_MYPAGE || process.env.LINE_LIFF_ID || null;
    const projectId = stringValue(req.params.id).trim();
    if (!projectId) throw new HttpError(400, "案件IDが指定されていません。");
    res.render("liff/project-detail", {
      title: "案件詳細",
      initialData: {
        liffId,
        projectId,
        dataUrl: `/liff/projects/${projectId}/data`,
        favoriteUrl: `/liff/projects/${projectId}/favorite`,
        surveyBaseUrl: "/liff/survey",
        projectsUrl: "/liff/projects",
        savedProjectsUrl: "/liff/saved-projects",
        interactionsUrl: "/liff/interactions",
        mypageUrl: "/liff/mypage",
      }
    });
  },

  async projectsPage(_req: Request, res: Response): Promise<void> {
    const liffId = process.env.LINE_LIFF_ID_MYPAGE || process.env.LINE_LIFF_ID || null;
    res.render("liff/projects", {
      title: "案件を探す",
      initialData: {
        liffId,
        projectsDataUrl: "/liff/projects-data",
        projectDetailBaseUrl: "/liff/projects",
        savedProjectsUrl: "/liff/saved-projects",
        interactionsUrl: "/liff/interactions",
        mypageUrl: "/liff/mypage",
      }
    });
  },

  async getProjectsData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;
    const category = stringValue(req.query.category).trim() || null;

    const [projects, favoritedIds] = await Promise.all([
      projectRepository.listDiscoverable(),
      projectFavoriteRepository.getFavoritedProjectIds(lineUserId),
    ]);

    const filtered = category ? projects.filter(p => (p as unknown as Record<string, unknown>).category === category) : projects;

    const items = filtered.map(p => ({
      id: p.id,
      title: (p as unknown as Record<string, unknown>).user_display_title || p.name,
      category: (p as unknown as Record<string, unknown>).category ?? null,
      reward_points: p.reward_points,
      estimated_minutes: (p as unknown as Record<string, unknown>).estimated_minutes ?? null,
      max_respondents: (p as unknown as Record<string, unknown>).max_respondents ?? null,
      thumbnail_url: (p as unknown as Record<string, unknown>).display_thumbnail_url ?? null,
      created_at: p.created_at,
      is_saved: favoritedIds.has(p.id),
    }));

    res.json({ ok: true, projects: items });
  },

  async getProjectDetailData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;
    const projectId = stringValue(req.params.id).trim();

    if (!projectId) throw new HttpError(400, "案件IDが指定されていません。");

    const [project, isSaved] = await Promise.all([
      projectRepository.getDiscoverableById(projectId),
      projectFavoriteRepository.isFavorited(lineUserId, projectId),
    ]);

    if (!project) throw new HttpError(404, "案件が見つかりませんでした。");

    const { supabase } = await import("../config/supabase");
    const respondents = await respondentRepository.listByLineUserId(lineUserId);
    let myAssignment: { id: string; status: string } | null = null;
    if (respondents.length > 0) {
      const respondentIds = respondents.map(r => r.id);
      const { data } = await supabase
        .from("project_assignments")
        .select("id, status")
        .eq("project_id", projectId)
        .in("respondent_id", respondentIds)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      myAssignment = data as { id: string; status: string } | null;
    }

    const { data: completedCount } = await supabase
      .from("project_assignments")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "completed");

    res.json({
      ok: true,
      project: {
        id: project.id,
        title: (project as unknown as Record<string, unknown>).user_display_title || project.name,
        category: (project as unknown as Record<string, unknown>).category ?? null,
        reward_points: project.reward_points,
        estimated_minutes: (project as unknown as Record<string, unknown>).estimated_minutes ?? null,
        max_respondents: (project as unknown as Record<string, unknown>).max_respondents ?? null,
        thumbnail_url: (project as unknown as Record<string, unknown>).display_thumbnail_url ?? null,
        objective: project.objective ?? null,
        created_at: project.created_at,
      },
      is_saved: isSaved,
      my_assignment: myAssignment,
      completed_count: completedCount ?? 0,
    });
  },

  async toggleProjectFavorite(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;
    const projectId = stringValue(req.params.id).trim();
    if (!projectId) throw new HttpError(400, "案件IDが指定されていません。");

    const result = await projectFavoriteRepository.toggle(lineUserId, projectId);
    res.json({ ok: true, saved: result.saved });
  },

  // ---- 保存した案件 ----

  async savedProjectsPage(_req: Request, res: Response): Promise<void> {
    const liffId = process.env.LINE_LIFF_ID_MYPAGE || process.env.LINE_LIFF_ID || null;
    res.render("liff/saved-projects", {
      title: "保存した案件",
      initialData: {
        liffId,
        savedDataUrl: "/liff/saved-projects-data",
        projectDetailBaseUrl: "/liff/projects",
        projectsUrl: "/liff/projects",
        interactionsUrl: "/liff/interactions",
        mypageUrl: "/liff/mypage",
      }
    });
  },

  async getSavedProjectsData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;

    const favorites = await projectFavoriteRepository.listByUser(lineUserId);
    if (favorites.length === 0) {
      res.json({ ok: true, projects: [] });
      return;
    }

    const { supabase } = await import("../config/supabase");
    const projectIds = favorites.map(f => f.project_id);
    const { data: projects } = await supabase
      .from("projects")
      .select("id, name, user_display_title, category, display_thumbnail_url, estimated_minutes, reward_points, status")
      .in("id", projectIds);

    const projectMap = Object.fromEntries(
      ((projects ?? []) as { id: string; [key: string]: unknown }[]).map(p => [p.id, p])
    );

    const items = favorites.map(f => {
      const p = projectMap[f.project_id] as Record<string, unknown> | undefined;
      return {
        id: f.project_id,
        title: p ? (String(p.user_display_title || p.name || "")) : "（削除済み）",
        category: p?.category ?? null,
        reward_points: p?.reward_points ?? null,
        estimated_minutes: p?.estimated_minutes ?? null,
        thumbnail_url: p?.display_thumbnail_url ?? null,
        is_active: p ? p.status === "active" : false,
        saved_at: f.created_at,
      };
    });

    res.json({ ok: true, projects: items });
  },

  // ---- やりとり ----

  async interactionsPage(_req: Request, res: Response): Promise<void> {
    const liffId = process.env.LINE_LIFF_ID_MYPAGE || process.env.LINE_LIFF_ID || null;
    res.render("liff/interactions", {
      title: "やりとり",
      initialData: {
        liffId,
        interactionsDataUrl: "/liff/interactions-data",
        surveyBaseUrl: "/liff/survey",
        projectsUrl: "/liff/projects",
        savedProjectsUrl: "/liff/saved-projects",
        mypageUrl: "/liff/mypage",
      }
    });
  },

  async getInteractionsData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;

    const respondents = await respondentRepository.listByLineUserId(lineUserId);
    if (respondents.length === 0) {
      res.json({ ok: true, pending: [], in_progress: [], completed: [] });
      return;
    }

    const { supabase } = await import("../config/supabase");
    const respondentIds = respondents.map(r => r.id);

    const { data: assignments } = await supabase
      .from("project_assignments")
      .select("id, project_id, respondent_id, status, assigned_at, started_at, completed_at, expired_at, deadline")
      .in("respondent_id", respondentIds)
      .order("assigned_at", { ascending: false })
      .limit(100);

    const projectIds = [...new Set(((assignments ?? []) as { project_id: string }[]).map(a => a.project_id))];
    const { data: projects } = projectIds.length > 0
      ? await supabase.from("projects").select("id, name, user_display_title, reward_points, estimated_minutes").in("id", projectIds)
      : { data: [] };

    const projectMap = Object.fromEntries(
      ((projects ?? []) as { id: string; [key: string]: unknown }[]).map(p => [p.id, p])
    );

    type AssignmentRow = { id: string; project_id: string; status: string; assigned_at: string | null; started_at: string | null; completed_at: string | null; expired_at: string | null; deadline: string | null };

    function toItem(a: AssignmentRow) {
      const p = projectMap[a.project_id] as Record<string, unknown> | undefined;
      return {
        assignment_id: a.id,
        project_id: a.project_id,
        title: p ? String(p.user_display_title || p.name || "") : "不明",
        reward_points: p?.reward_points ?? null,
        estimated_minutes: p?.estimated_minutes ?? null,
        status: a.status,
        assigned_at: a.assigned_at,
        started_at: a.started_at,
        completed_at: a.completed_at,
        deadline: a.deadline,
      };
    }

    const all = ((assignments ?? []) as AssignmentRow[]).map(toItem);
    const pending    = all.filter(a => ["assigned", "sent", "opened"].includes(a.status));
    const inProgress = all.filter(a => a.status === "started");
    const done       = all.filter(a => ["completed", "expired", "cancelled"].includes(a.status));

    res.json({ ok: true, pending, in_progress: inProgress, completed: done });
  },
};
