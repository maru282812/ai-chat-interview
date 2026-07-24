import type { Request, Response } from "express";
import { env } from "../config/env";
import { STORAGE_BUCKET, storagePaths } from "../config/storage";
import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";
import { getProjectResearchSettings } from "../lib/projectResearch";
import { normalizeQuestionMeta } from "../lib/questionMetadata";
import { findExclusionViolation } from "../lib/optionExclusion";
import { isQuestionVisible } from "../lib/questionEngine";
import {
  answerValueForContext,
  buildAnswerContext,
  computeNextView,
  resolveOrderedRenderSet,
  resumeView,
  selectPhaseQuestions,
} from "../services/surveyFlowService";
import { resolveAnswerPresentation } from "../lib/answerPresentation";
import { jstDateString } from "../lib/dailyQueue";
import { resolveDailyQuestionViews } from "../lib/dailyAnswerUi";
import { generatePairwisePairs, isNewAnswerType, validateNewTypeAnswer } from "../lib/answerTypes";
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
import { surveyOrderingService } from "../services/surveyOrderingService";
import { conceptService } from "../services/conceptService";
import { experienceService } from "../services/experienceService";
import type { Gender, MaritalStatus, RantTag } from "../types/domain";
import type { AnswerContext } from "../types/questionSchema";
import { runPostCompleteProcess } from "../services/postCompleteService";
import { rantTagRepository } from "../repositories/rantTagRepository";
import { postRepository } from "../repositories/postRepository";
import { dailySurveyService } from "../services/dailySurveyService";
import { storeEntryService } from "../services/storeEntryService";
import { applicationService, isRecruitClosed } from "../services/applicationService";
import { projectApplicationRepository } from "../repositories/projectApplicationRepository";
import { dailySurveyRepository } from "../repositories/dailySurveyRepository";
import { poolQuestionRepository } from "../repositories/poolQuestionRepository";
import { poolQuestionService } from "../services/poolQuestionService";
import { userStreakService } from "../services/userStreakService";
import { userBadgeService } from "../services/userBadgeService";
import { userPointService } from "../services/userPointService";
import { pointStatusService } from "../services/pointStatusService";
import { computeRankProgress } from "../lib/pointStatus";
import { buildDailyAnswerNoticeMessages } from "../lib/dailyAnswerNotice";
import { lineMessagingService } from "../services/lineMessagingService";
import { pointExchangeRepository } from "../repositories/pointExchangeRepository";
import { pointExchangeService, ExchangeError, EXCHANGE_UNIT_POINTS } from "../services/pointExchangeService";

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

/**
 * 書込み系エンドポイント（回答送信 / 完了 / 画像アップロード / スクリーニング判定）の所有者検証。
 * verifyIdentity と同じ規則で LIFF ID token を検証し assignment.user_id と一致させる。
 * これが無いと session_id / assignment_id(UUID) を知る第三者が他人の回答を書き換え・完了できる（IDOR）。
 * supabase は service_role 接続で RLS が効かないため、この照合がアプリ層の唯一の砦。
 *
 * - LIFF未構成/開発skip経路（liffAuthAvailable=false）では検証を省略し従来どおり回答継続を妨げない。
 * - assignment.user_id 未設定は本番のみ 403、非本番は許容（verifyIdentity と同挙動）。
 * - トークンは Authorization: Bearer <id_token> または body.id_token を受理。tmtest: seam も透過。
 */
async function verifyAssignmentOwnerOrThrow(req: Request, assignmentId: string): Promise<void> {
  const liffConfig = getSurveyLiffConfig();
  if (!liffConfig.liffAuthAvailable) {
    return;
  }
  if (!assignmentId) {
    throw new HttpError(400, "assignment_id が必要です。");
  }
  const header = req.headers.authorization;
  const bearer = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  const token = bearer || stringValue((req.body as { id_token?: unknown })?.id_token).trim();
  if (!token) {
    // トークン未送信の扱いを survey ページの認証ゲート(authRequired)と一致させる。
    // ・authRequired=true（LIFF_AUTH_REQUIRED=true）: ページは必ず ID トークンを取得して
    //   添付するので、欠如は異常＝401（クライアントは再ログインで回復できる）。
    // ・authRequired=false（skip 運用）: ページは LIFF 認証をスキップしトークンを取得も
    //   送信もしない設計。ここで一律 401 にすると liffAuthAvailable=true（LIFF設定済）の
    //   環境で /survey/answer・/complete が常に 401 になり「完了処理が失敗しました」が
    //   必ず出る（回答は非ブロッキングで握り潰され、完了だけ露出）。ページと同じ基準で
    //   認証を要求せず所有者検証をスキップし、回答完了を妨げない。
    if (liffConfig.authRequired) {
      throw new HttpError(401, "認証情報を確認できませんでした。LINEから開き直してください。");
    }
    return;
  }
  // トークンがあれば authRequired の値に関わらず検証し、本人以外の回答/完了を遮断する（IDOR 防止）。
  const verified = await liffAuthService.verifyIdToken(token, { path: req.path });
  const assignment = await projectAssignmentRepository.getById(assignmentId);
  if (!assignment.user_id) {
    if (env.NODE_ENV === "production") {
      logger.warn("verifyOwner.noLineUserId.blocked", { assignmentId, path: req.path });
      throw new HttpError(403, "本人確認に失敗しました。LINEアプリ内から開き直してください。");
    }
    return;
  }
  if (assignment.user_id !== verified.userId) {
    logger.warn("verifyOwner.mismatch", { assignmentId, path: req.path });
    throw new HttpError(403, "本人確認に失敗しました。LINEアプリ内から開き直してください。");
  }
}

/**
 * 書込み系APIで受け取った session_id が、その assignment のものかを突合する。
 *
 * 所有者検証（verifyAssignmentOwnerOrThrow）が見るのは body の assignment_id だけなので、
 * それ単体では「自分の assignment_id ＋ 他人の session_id」という組み合わせを止められず、
 * 正当なトークンを持つ利用者が他人のセッションへ回答を書き込めてしまう。
 * supabase は service_role 接続で RLS も効かない（DB 層の二段目が無い）ため、
 * ここで respondent と project の一致をアプリ層の責任として検証する。
 */
function assertSessionMatchesAssignment(
  session: { id: string; respondent_id: string; project_id: string },
  assignment: { id: string; respondent_id: string; project_id: string },
  ctx: { path: string }
): void {
  if (
    session.respondent_id !== assignment.respondent_id ||
    session.project_id !== assignment.project_id
  ) {
    logger.warn("session.assignmentMismatch", {
      path: ctx.path,
      sessionId: session.id,
      assignmentId: assignment.id,
      sessionRespondentId: session.respondent_id,
      assignmentRespondentId: assignment.respondent_id,
      sessionProjectId: session.project_id,
      assignmentProjectId: assignment.project_id,
    });
    throw new HttpError(
      403,
      "この回答は現在のアンケートに紐づいていません。LINEから開き直してください。"
    );
  }
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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** uuid 型カラムへ直接渡る id の形式検証。形式不正は DB に渡す前に存在しない扱い（404）にする。 */
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
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
        aiReply = await aiService
          .generateRantCounselorReply(content, tagLabels, { project, sessionId: null })
          .catch(() => null);
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
      // 体験設定（Phase 0）。案件に紐付かないページなので全体既定を解決した値。
      experience: await experienceService.getGlobal(),
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
        exchangeRequestUrl: "/liff/exchange-requests",
        consentStatusUrl: "/liff/consent-statuses",
        consentPageUrl: "/liff/consent",
        documentBaseUrl: "/liff/documents",
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

    const [profile, respondents, ranks, streakRow, earnedAwards, badgeDefs, pointBalance] = await Promise.all([
      userProfileRepository.getByLineUserId(lineUserId),
      respondentRepository.listByLineUserId(lineUserId),
      rankRepository.list(),
      userStreakService.getStreak(lineUserId).catch(() => null),
      userBadgeService.listEarned(lineUserId).catch(() => []),
      userBadgeService.listAllDefinitions().catch(() => []),
      userPointService.getBalance(lineUserId).catch(() => null),
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

    // 「現在のポイント」は正準の user_points 残高を表示する。
    // respondents.total_points はレガシー（旧集計）。user_points 行が無い/0 の旧データは
    // 従来どおり respondent 合計へフォールバックし、既存挙動を壊さない。
    const respondentPoints = primaryRespondent?.total_points ?? 0;
    const totalPoints = (pointBalance?.available_points ?? 0) || respondentPoints;
    const rankPoints = (pointBalance?.lifetime_points ?? 0) || respondentPoints;
    // ランク表示は正準（累計ポイント × ranks しきい値）に統一する。
    // 以前は respondents.current_rank（レガシー集計）で、旅路バー（pointStatusService）と
    // ズレる余地があった。段位（tier）もここで導出して整合させる。
    const rankProgress = computeRankProgress(rankPoints, ranks);
    const currentRank = rankProgress.currentRank;
    const nextRank = rankProgress.nextRank;

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
        rank_name: currentRank?.rank_name ?? "ブロンズ",
        rank_code: currentRank?.rank_code ?? "bronze",
        badge_label: currentRank?.badge_label ?? null,
        tier: rankProgress.tier,
        completed_count: completedCount,
        next_rank_min_points: nextRank?.min_points ?? null,
        next_rank_name: nextRank?.rank_name ?? null,
        next_rank_code: nextRank?.rank_code ?? null,
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
    let liffStateEntryCode: string | undefined;
    const liffState = stringValue(req.query["liff.state"] ?? "");
    if (liffState) {
      try {
        const params = new URLSearchParams(liffState.startsWith("?") ? liffState.slice(1) : liffState);
        liffStateAssignmentId = params.get("assignment_id") ?? undefined;
        liffStateEntryCode = params.get("entry_code") ?? undefined;
      } catch {
        // parse failure → fall through
      }
    }
    const assignmentId = stringValue(req.params.assignmentId ?? liffStateAssignmentId ?? req.query.assignment_id ?? "");

    // 店舗QR（https://liff.line.me/{id}?entry_code=xxx）は SURVEY LIFF の endpoint に
    // liff.state で着地する。entry_code のみの流入は店舗入口へ引き継ぐ。
    // NOTE: liff.state をリダイレクト先に残すと SDK の二次リダイレクトで endpoint へ
    // 戻されループするため、entry_code だけを取り出して捨てる。
    const entryCode = stringValue(req.query.entry_code ?? liffStateEntryCode ?? "").trim();
    if (!assignmentId && entryCode) {
      res.redirect(302, `/liff/store?entry_code=${encodeURIComponent(entryCode)}`);
      return;
    }
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
    if (!isUuid(assignmentId)) throw new HttpError(404, "アンケートが見つかりません。");

    // テスト到達用 seam（非本番限定）: 503「LIFF設定不足」分岐を env 改変なしで再現する。
    // ヘッダ x-test-auth-required:1 または ?__test_auth_required=1 のときのみ有効。本番では無視。
    const forceAuthConfigMissing =
      env.NODE_ENV !== "production" &&
      (req.get("x-test-auth-required") === "1" || req.query.__test_auth_required === "1");
    const liffConfig = getSurveyLiffConfig({ forceAuthConfigMissing });

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

    // project とアクティブセッションは両方 assignment のみに依存するため並行取得する
    // （getActiveByRespondent の project_id は assignment.project_id と同一値）。
    const [project, sessionForCheckInitial] = await Promise.all([
      projectRepository.getById(assignment.project_id),
      sessionRepository.getActiveByRespondent(assignment.respondent_id, assignment.project_id),
    ]);
    let sessionForCheck = sessionForCheckInitial;

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
        // 体験設定（Phase 0）。サーバー権威で解決済みの値だけを渡す。
        experience: await experienceService.resolveForProjectConfig(project.experience_config),
      });
      return;
    }

    // プロフィール確認: user_id が判明しており、かつ今セッションでまだ確認していない場合はプロフィール確認画面へ誘導する。
    // ただし店舗専用アンケート（private_store）は「非会員のまま基本情報なしで即回答」が設計なので
    // 回答前の基本情報入力・利用規約同意ゲートはかけない。基本情報と同意は完了後の
    // 「Hibiに参加する（会員登録）」CTA に進んだ希望者だけが会員化フローで入力する。
    const isStoreSurveyEntry = project.visibility_type === "private_store";

    // profile-check の「この内容で回答を開始する」からの遷移（mypage_confirm_session）。
    // 確認完了の書込みを別POST（confirm-mypage）で待たせず遷移URLに同乗させ、ここで
    // レンダリング前に書き込む＝タップ後のサーバー往復を1回削減する。
    // 権限面は既存 POST /liff/session/confirm-mypage（session_id のみで書込み可）と同等以上
    // （assignment_id と一致する session_id の両方が必要）。session が一致しない・既に確認済みの
    // 場合は無視され、従来どおり下のゲートで profile-check へ誘導される（安全側に退化）。
    const confirmSessionId = stringValue(req.query.mypage_confirm_session).trim();
    if (
      !isStoreSurveyEntry &&
      assignment.user_id &&
      sessionForCheck &&
      confirmSessionId &&
      confirmSessionId === sessionForCheck.id &&
      !sessionForCheck.state_json?.mypage_confirmed_at
    ) {
      const confirmedState = {
        ...sessionForCheck.state_json,
        mypage_confirmed_at: new Date().toISOString(),
      };
      await sessionRepository.update(sessionForCheck.id, { state_json: confirmedState });
      sessionForCheck = { ...sessionForCheck, state_json: confirmedState };
      logger.info("[surveyPage] mypage confirmed inline", { assignmentId, sessionId: sessionForCheck.id });
    }

    if (!isStoreSurveyEntry && assignment.user_id && !sessionForCheck?.state_json?.mypage_confirmed_at) {
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
          // 回答環境の記録（不正検出・ロウデータ UserAgent/IPAddress 列・migration 078）
          user_agent: (req.headers["user-agent"] ?? "").toString().slice(0, 300) || null,
          ip_address: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress || null,
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
        // 体験設定（Phase 0）。サーバー権威で解決済みの値だけを渡す。
        experience: await experienceService.resolveForProjectConfig(project.experience_config),
      });
      return;
    }

    const [questions, pageGroups] = await Promise.all([
      questionRepository.listByProject(project.id),
      questionPageGroupRepository.listByProject(project.id),
    ]);

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
        // 回答環境の記録（不正検出・ロウデータ UserAgent/IPAddress 列・migration 078）
        user_agent: (req.headers["user-agent"] ?? "").toString().slice(0, 300) || null,
        ip_address: (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket?.remoteAddress || null,
      });
    }

    // L1 コンセプト・ローテーション: 初回に提示順を確定して保存（rotation 有効時のみ・additive）。
    try {
      const rotationMode = project.concept_rotation_mode ?? "off";
      if (rotationMode !== "off" && !session.concept_order_json) {
        const respondents = await respondentRepository.listByProject(project.id);
        const ordered = [...respondents].sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
        const respondentIndex = Math.max(0, ordered.findIndex(r => r.id === assignment.respondent_id));
        const order = await conceptService.resolveOrder({ projectId: project.id, respondentIndex, mode: rotationMode });
        if (order.length > 1) {
          await sessionRepository.update(session.id, { concept_order_json: order });
          session = { ...session, concept_order_json: order };
        }
      }
    } catch (err) {
      logger.warn("[surveyPage] concept order assign skipped", { assignmentId, error: String(err) });
    }

    // スクリーニング質問の有無でレンダリング対象を切り替える（フロー系エンドポイントと同一ロジックを共有）
    const phaseSelection = selectPhaseQuestions(questions, {
      screeningEnabled: project.screening_config?.enabled === true,
      screeningJudged: !!session.state_json?.screening_result,
    });
    let renderQuestions: typeof questions = phaseSelection.questions;
    const surveyPhase: "screening" | "main" = phaseSelection.phase;

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

    // §3 ブロック(ページ)ランダム化: メイン設問フェーズのみ、回答者ごとの表示順を確定して反映する。
    // ランダム化未設定なら従来どおり（変更なし）。失敗しても回答継続を妨げない。
    let orderedPageGroups = pageGroups;
    if (surveyPhase === "main") {
      try {
        const reordered = await surveyOrderingService.resolveOrder({
          session,
          project,
          questions: renderQuestions,
          pageGroups,
        });
        renderQuestions = reordered.questions;
        orderedPageGroups = reordered.pageGroups;
      } catch (err) {
        logger.warn("[surveyPage] ordering skipped", { assignmentId, error: String(err) });
      }
    }

    // 回答UIプリセット（migration 075）を各設問に同梱してクライアントへ渡す。
    // 表示パターンはサーバー権威で解決する（クライアントは presentation.pattern を見て描画するだけ）。
    // 初回レンダリング時点の選択肢数で解決するため、carry-forward で選択肢が絞られる設問の
    // 件数依存フォールバック（carousel>8 等）は基底件数での近似となる（描画に致命的な差はない）。
    const answerUiPreset = project.answer_ui_preset ?? "standard";
    const questionsForClient = renderQuestions.map((q) => ({
      ...q,
      presentation: resolveAnswerPresentation(
        {
          question_type: q.question_type,
          question_text: q.question_text,
          question_config: q.question_config,
        },
        answerUiPreset,
      ),
    }));

    const DEFAULT_FAIL_MSG = "今回はご参加いただけませんでした。またの機会にご協力をお願いします。";
    const renderData = {
      title: project.user_display_title || project.name,
      project,
      projectData: {
        id: project.id,
        name: project.user_display_title || project.name,
        display_mode: project.display_mode ?? "survey_question",
      },
      questions: questionsForClient,
      answerUiPreset,
      pageGroups: orderedPageGroups,
      sessionId: session.id,
      assignmentId: assignment.id,
      displayMode: project.display_mode ?? "survey_question",
      surveyPhase,
      screeningFailMessage: project.screening_config?.fail_message?.trim() || DEFAULT_FAIL_MSG,
      liffId: liffConfig.liffId,
      liffAuthAvailable: liffConfig.liffAuthAvailable,
      authRequired: liffConfig.authRequired,
      skipAllowed: liffConfig.skipAllowed,
      // 店舗専用アンケート完了後に「Hibi会員になって参加同意する」CTA を出すための判定（希望者のみ誘導）
      isStoreSurvey: project.visibility_type === "private_store",
      // 体験設定（Phase 0）: プロジェクト上書き > 全体既定 > コード既定をサーバーで解決済み。
      // クライアントは window.EXPERIENCE を読むだけ（再解決しない）。
      experience: await experienceService.resolveForProjectConfig(project.experience_config),
      projectsUrl: "/liff/projects",
      // 店舗回答者をグローバル必須書類の同意フローへ通し、正式な Hibi 会員に昇格させる導線。
      // 既に同意済みなら consent ページが即マイページへリダイレクトする（冪等）。
      memberJoinUrl: "/liff/consent?mode=initial&redirect=/liff/mypage",
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

    // 所有者検証（IDOR 防止）と独立リード（session・既存回答）を並行実行する。
    // Promise.all だと「認証エラーより先に session 404 が漏れる」レースが起きるため、
    // allSettled で全結果を受けてから認証エラーを最優先で投げる（既存のエラー応答順を保存）。
    const assignmentIdInput = stringValue(req.body.assignment_id).trim();
    const [ownerResult, sessionResult, priorAnswersResult, assignmentResult] = await Promise.allSettled([
      verifyAssignmentOwnerOrThrow(req, assignmentIdInput),
      sessionRepository.getById(sessionId),
      answerRepository.listBySession(sessionId),
      assignmentIdInput ? projectAssignmentRepository.getById(assignmentIdInput) : Promise.resolve(null),
    ]);
    if (ownerResult.status === "rejected") throw ownerResult.reason;
    if (sessionResult.status === "rejected") throw sessionResult.reason;
    if (priorAnswersResult.status === "rejected") throw priorAnswersResult.reason;
    if (assignmentResult.status === "rejected") throw assignmentResult.reason;
    const session = sessionResult.value;
    const priorAnswers = priorAnswersResult.value;
    // session と assignment の突合（他人セッションへの書込み防止）。
    // assignment_id が無いのは liffAuthAvailable=false の構成だけで、その場合は突合材料が無いので飛ばす。
    if (assignmentResult.value) {
      assertSessionMatchesAssignment(session, assignmentResult.value, { path: req.path });
    }
    console.log("ASSIGNMENT_STATE", { session_id: session.id, project_id: session.project_id, status: session.status });

    // 進行制御の唯一の正はサーバー（plan §Phase1）。案件全設問と既存回答を読み、
    // ①この設問がそもそも表示条件を満たすか（可視性ゲート）②回答後に出す次設問、をサーバーで決める。
    // project / pageGroups は「次設問解決」で使う読み取り専用データ。従来は書込み後に直列取得
    // していたが、内容は同一なのでここで questions と並行に取得する（バリデーション失敗時は
    // 読み損になるだけで無害）。
    const [questions, project, pageGroups] = await Promise.all([
      questionRepository.listByProject(session.project_id),
      projectRepository.getById(session.project_id),
      questionPageGroupRepository.listByProject(session.project_id),
    ]);
    const question = questions.find((q) => q.question_code === questionCode)
      ?? (await questionRepository.getByProjectAndCode(session.project_id, questionCode));
    if (!question) {
      res.status(404).json({ ok: false, error: `質問コードが見つかりません: ${questionCode}` });
      return;
    }

    // 排他制御 (multi_choice): フロント制御を直叩きで回避した不正な組み合わせをサーバ側で拒否する。
    if (question.question_type === "multi_choice" && Array.isArray(answerValue)) {
      const options = question.question_config?.options ?? [];
      const violation = findExclusionViolation(answerValue.map((v) => String(v)), options);
      if (violation) {
        res.status(400).json({
          ok: false,
          error: `同時に選択できない選択肢が含まれています（「${violation[0]}」と「${violation[1]}」）。`,
        });
        return;
      }
    }

    // 新設問形式（migration 075）のサーバー権威バリデーション。
    // クライアントは answer_value に JSON 文字列で構造化回答を送る（保存形式は matrix と同じ慣例）。
    if (isNewAnswerType(question.question_type)) {
      let parsed: unknown;
      try {
        parsed = typeof answerValue === "string" ? JSON.parse(answerValue) : answerValue;
      } catch {
        res.status(400).json({ ok: false, error: "回答データの形式が不正です。" });
        return;
      }
      const expectedRounds =
        question.question_type === "pairwise"
          ? generatePairwisePairs(
              (question.question_config?.options ?? []).map((o) => String(o.value)),
              question.question_config?.pairwise?.rounds,
              question.question_code,
            ).pairs.length
          : undefined;
      const result = validateNewTypeAnswer(question.question_type, question.question_config ?? null, parsed, {
        expectedRounds,
      });
      if (!result.ok) {
        res.status(400).json({ ok: false, error: result.error });
        return;
      }
    }

    // 可視性ゲート: 既存回答から組んだ ctx でこの設問が visibility_conditions を満たさないなら拒否（§3-2）。
    // 条件が無い設問（大多数）は isQuestionVisible=true で常に通過する。
    const priorCtx = buildAnswerContext(questions, priorAnswers);
    if (!isQuestionVisible(question, priorCtx)) {
      logger.warn("submitSurveyAnswer.hiddenQuestionBlocked", { sessionId, questionCode });
      res.status(409).json({
        ok: false,
        error: "この設問は現在の回答条件では表示対象外です。画面を開き直してください。",
      });
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

    // 同一設問への再回答は上書き（重複行を作らない）
    await answerRepository.upsertPrimary({
      session_id: sessionId,
      question_id: question.id,
      answer_text: answerText,
      free_text_answer: freeTextRaw,
      normalized_answer: normalizedAnswer ?? undefined,
    });

    await sessionRepository.update(sessionId, { current_question_id: question.id });

    // 次設問をサーバーで解決して返す（Phase2 でクライアントはこれを描画する。現行クライアントは無視して従来動作）。
    // NOTE: クライアントは配列をカンマ結合した文字列で送るため、型ベースで array/scalar を復元する。
    const ctxValue = answerValueForContext(question.question_type, answerText);
    const nextCtx: AnswerContext = {
      answers: { ...priorCtx.answers, [questionCode.toLowerCase()]: ctxValue },
    };
    const branchPayload: Record<string, unknown> = { ...(normalizedAnswer ?? {}) };
    if (Array.isArray(ctxValue)) {
      if (branchPayload.values === undefined) branchPayload.values = ctxValue;
    } else if (branchPayload.value === undefined) {
      branchPayload.value = ctxValue;
    }

    // 次設問はクライアントと同一の集合・順序（フェーズ絞り込み＋ランダム化）で解決する。
    // project / pageGroups は冒頭で並行取得済み。
    const renderSet = await resolveOrderedRenderSet({
      session,
      project,
      questions,
      pageGroups,
      screeningEnabled: project.screening_config?.enabled === true,
      screeningJudged: Boolean(session.state_json?.screening_result),
    });
    const next = computeNextView({
      questions: renderSet.questions,
      ctx: nextCtx,
      fromQuestion: question,
      normalizedAnswer: branchPayload,
      answerUiPreset: project.answer_ui_preset ?? "standard",
    });

    res.json({ ok: true, next });
  },

  /**
   * 初回ロード・再開用: 未回答かつ可視な最初の設問の解決済みビューを返す（Phase2 クライアントが消費）。
   * 送付済み回答から ctx を再構築し、クライアントと同一集合・順序で resumeView する。読み取り専用。
   */
  async getSurveyNext(req: Request, res: Response): Promise<void> {
    const assignmentId = stringValue(req.params.assignmentId).trim();
    const sessionId = stringValue(req.query.session_id).trim();
    if (!sessionId) {
      res.status(400).json({ ok: false, error: "session_id は必須です。" });
      return;
    }
    // 所有者検証と独立リードを並行実行（submitSurveyAnswer と同じ理由で認証エラーを最優先で投げる）
    const [ownerResult, sessionResult, answersResult] = await Promise.allSettled([
      verifyAssignmentOwnerOrThrow(req, assignmentId),
      sessionRepository.getById(sessionId),
      answerRepository.listBySession(sessionId),
    ]);
    if (ownerResult.status === "rejected") throw ownerResult.reason;
    if (sessionResult.status === "rejected") throw sessionResult.reason;
    if (answersResult.status === "rejected") throw answersResult.reason;
    const session = sessionResult.value;
    const answers = answersResult.value;

    const [project, questions, pageGroups] = await Promise.all([
      projectRepository.getById(session.project_id),
      questionRepository.listByProject(session.project_id),
      questionPageGroupRepository.listByProject(session.project_id),
    ]);

    const ctx = buildAnswerContext(questions, answers);
    const renderSet = await resolveOrderedRenderSet({
      session,
      project,
      questions,
      pageGroups,
      screeningEnabled: project.screening_config?.enabled === true,
      screeningJudged: Boolean(session.state_json?.screening_result),
    });

    const byId = new Map(questions.map((q) => [q.id, q] as const));
    const answeredCodes = new Set<string>();
    for (const a of answers) {
      if (a.answer_role && a.answer_role !== "primary") continue;
      const q = byId.get(a.question_id);
      if (q) answeredCodes.add(q.question_code);
    }

    const next = resumeView(renderSet.questions, ctx, answeredCodes, project.answer_ui_preset ?? "standard");
    res.json({ ok: true, next });
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

    // 所有者検証（IDOR 防止）: 画像は本人の assignment にのみ紐付けられる
    await verifyAssignmentOwnerOrThrow(req, assignmentId);

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

    // 他人のセッション配下に画像を置けないよう、session と assignment を突合する
    // （storagePath は session_id から組み立てられるため、突合が無いと他人の領域に書ける）。
    assertSessionMatchesAssignment(session, assignment, { path: req.path });

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
    if (!isUuid(assignmentId)) throw new HttpError(404, "アンケートが見つかりません。");

    // 所有者検証（IDOR 防止）: 完了確定・ポイント付与は本人のみ発火できる
    await verifyAssignmentOwnerOrThrow(req, assignmentId);

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
      // 見つからない場合は従来どおりアクティブ検索へフォールバックする（完了は止めない）。
      try {
        session = await sessionRepository.getById(sessionIdFromBody);
      } catch {
        logger.warn("completeSurveyByAssignment.session.notFound", { assignmentId, sessionIdFromBody });
        session = null;
      }
      // ただし「見つかったが他人のセッション」は別物。黙ってアクティブ検索へ流すと
      // 取り違えが無言で成功扱いになるため、突合して不一致は 403 で止める。
      if (session) {
        assertSessionMatchesAssignment(session, assignment, { path: req.path });
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

    if (!session) {
      logger.warn("completeSurveyByAssignment.noSession", {
        assignmentId,
        respondentId: respondent.id,
      });
    }

    // ポイント付与＋LINE完了通知は「レスポンスを返す前に」確実に実行する。
    // Vercel 等のサーバーレスではレスポンス後の非同期処理が関数の凍結で
    // 打ち切られうるため、fire-and-forget にしない。runPostCompleteProcess は
    // べき等（同一 session に project_completion があれば二重付与しない）なので
    // await しても安全。通知失敗などで throw しても、assignment は既に完了済みなので
    // ok を返しつつログに残す。
    try {
      await runPostCompleteProcess({
        assignmentId,
        session,
        respondent,
        project,
        lineUserId: assignment.user_id,
      });
    } catch (err: unknown) {
      logger.error("completeSurveyByAssignment.postComplete.failed", {
        assignmentId,
        error: String(err),
      });
    }

    // キャンペーン完了カウントも配信上限判定に効くため await（非致命・失敗は無視）
    await incrementCampaignCount(assignmentId, "completed_count").catch(() => {});

    res.json({ ok: true, alreadyCompleted: false });
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

    const [balance, histories, exchanges] = await Promise.all([
      userPointService.getBalance(lineUserId),
      userPointService.getHistory(lineUserId, 50),
      pointExchangeRepository.listByUser(lineUserId, 20),
    ]);

    res.json({
      ok: true,
      balance: {
        total_points:     balance.total_points,
        available_points: balance.available_points,
        pending_points:   balance.pending_points,
        lifetime_points:  balance.lifetime_points,
      },
      histories: histories.map(h => ({
        id:           h.id,
        type:         h.transaction_type,
        points:       h.points,
        reason:       h.reason,
        reference_type: h.reference_type,
        created_at:   h.created_at,
      })),
      exchanges: exchanges.map(e => ({
        id:              e.id,
        requested_points: e.requested_points,
        gift_amount_jpy:  e.gift_amount_jpy,
        status:           e.status,
        gift_url:         e.status === "fulfilled" ? e.gift_url : null,
        notification_sent: e.notification_sent,
        requested_at:    e.requested_at,
        approved_at:     e.approved_at,
        fulfilled_at:    e.fulfilled_at,
        rejected_at:     e.rejected_at,
        canceled_at:     e.canceled_at,
        failed_reason:   e.status === "rejected" ? e.failed_reason : null,
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

    // 世帯年収（migration 078）。許容値は lib/rawdataExport.ts の INCOME_CODES が正。
    function parseIncome(v: unknown): string | null {
      const s = stringValue(v).trim();
      const allowed = [
        "under_200", "200_400", "400_600", "600_800", "800_1000",
        "1000_1500", "1500_2000", "over_2000", "unknown", "no_answer"
      ];
      return allowed.includes(s) ? s : null;
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
      household_composition: parseStringArray(body.household_composition),
      household_income: parseIncome(body.household_income)
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
    if (!isUuid(assignmentId)) throw new HttpError(404, "アンケートが見つかりません。");

    // 所有者検証（IDOR 防止）: スクリーニング判定は本人のみ実行できる
    await verifyAssignmentOwnerOrThrow(req, assignmentId);

    const [assignment, session] = await Promise.all([
      projectAssignmentRepository.getById(assignmentId),
      sessionRepository.getById(sessionId)
    ]);

    // 他人セッションの判定結果を書き換えられないよう、session と assignment を突合する。
    assertSessionMatchesAssignment(session, assignment, { path: req.path });

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
      // 体験設定（Phase 0）。デイリーは案件に紐付かないので全体既定を解決した値。
      experience: await experienceService.getGlobal(),
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

    // 表示パターンはサーバー権威で解決する（案件アンケートと同じ原則・Phase 3）。
    // クライアントは presentation.pattern を見て共通レンダラで描くだけ。
    res.json({
      ok: true,
      alreadyAnswered: false,
      survey,
      questions: resolveDailyQuestionViews(questions, survey.answer_ui_preset),
      delivery: finalDelivery,
    });
  },

  /**
   * 「今日の1問」。案件一覧の最上部にカードを出すために使う（docs/plan-daily-survey-queue.md Phase 2）。
   *
   * 返すのは「今日その枠で配信中（status=active かつ scheduled_date=今日）」かつ
   * 「このユーザーがまだ回答していない」もの（0〜2件）。どれを見せるかはサーバーが決め、
   * クライアントから survey_id を指定して未配信のものを開くことはできない。
   */
  async getTodayDailySurveys(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;
    const today = jstDateString();

    const surveys = await dailySurveyRepository.listActiveOnDate(today);
    if (surveys.length === 0) {
      res.json({ ok: true, items: [] });
      return;
    }

    const { supabase } = await import("../config/supabase");
    const items: unknown[] = [];

    for (const survey of surveys) {
      const { data: deliveryRow } = await supabase
        .from("daily_survey_deliveries")
        .select("id, status")
        .eq("survey_id", survey.id)
        .eq("line_user_id", lineUserId)
        .maybeSingle();

      const delivery = deliveryRow as { id: string; status: string } | null;
      if (delivery?.status === "answered") continue; // 回答済みは出さない

      const questions = await dailySurveyService.listQuestions(survey.id);
      if (questions.length === 0) continue; // 設問が無いものは出さない

      // サイトから来た人には配信レコードが無いので、ここで作る（LINE から来た人は既にある）。
      // user_profiles が未作成のユーザー（FK 違反）などで失敗しても、案件一覧の表示は
      // 止めない。カードを出さないだけにする。
      let finalDelivery = delivery;
      try {
        if (!finalDelivery) {
          finalDelivery = await dailySurveyRepository.upsertDelivery({
            survey_id: survey.id,
            line_user_id: lineUserId,
            status: "opened",
          });
        } else if (finalDelivery.status === "sent" || finalDelivery.status === "pending") {
          await dailySurveyRepository.markDeliveryStatus(finalDelivery.id, "opened");
        }
      } catch (e) {
        logger.warn("dailyToday.delivery.skip", {
          surveyId: survey.id,
          lineUserId,
          error: String(e),
        });
        continue;
      }

      items.push({
        survey: {
          id: survey.id,
          title: survey.title,
          description: survey.description,
          slot: survey.slot,
          reward_type: survey.reward_type,
          reward_points: survey.reward_points,
          reward_min_points: survey.reward_min_points,
          reward_max_points: survey.reward_max_points,
          answer_ui_preset: survey.answer_ui_preset,
        },
        // 表示パターンはサーバー権威で解決して返す（Phase 3）。
        questions: resolveDailyQuestionViews(questions, survey.answer_ui_preset),
        delivery: { id: finalDelivery.id },
        answerUrl: `/liff/daily-survey/${survey.id}/answer`,
      });
    }

    res.json({ ok: true, items });
  },

  async submitDailySurveyAnswer(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const surveyId = stringValue(req.params.surveyId).trim();
    const body = req.body as Record<string, unknown>;

    if (!surveyId) throw new HttpError(400, "surveyId は必須です。");
    if (!isUuid(surveyId)) throw new HttpError(404, "アンケートが見つかりません。");

    const deliveryId = stringValue(body.deliveryId).trim();
    const rawAnswers = Array.isArray(body.answers) ? body.answers : [];

    if (!deliveryId) throw new HttpError(400, "deliveryId は必須です。");
    if (rawAnswers.length === 0) throw new HttpError(400, "回答が含まれていません。");

    // deliveryId が本人・当該アンケートのものであることを確認する。
    // これが無いと、他人の配信レコード ID を渡して回答済みにしたり
    // ポイント付与の参照先を書き換えたりできてしまう。
    const { supabase } = await import("../config/supabase");
    const { data: ownedRow } = await supabase
      .from("daily_survey_deliveries")
      .select("id")
      .eq("id", deliveryId)
      .eq("survey_id", surveyId)
      .eq("line_user_id", verifiedUser.userId)
      .maybeSingle();
    if (!ownedRow) throw new HttpError(403, "この回答を受け付けられません。");

    const answers = rawAnswers as Array<{ questionId: string; answerValue: unknown }>;

    const result = await dailySurveyService.recordAnswer({
      lineUserId: verifiedUser.userId,
      surveyId,
      deliveryId,
      answers,
    });

    const [streakRow, pointStatus] = await Promise.all([
      userStreakService.getStreak(verifiedUser.userId),
      pointStatusService.getStatus(verifiedUser.userId),
    ]);

    // LINE 側にも「ポイントが付いた」を残す。LIFF で回答するとトークに何も出ないため、
    // 付与されたのかユーザーから見えない状態だった。
    // 通知が失敗しても回答とポイントは確定済みなので、回答自体は成功として返す。
    const notice = buildDailyAnswerNoticeMessages({
      pointsAwarded: result.pointsAwarded,
      streakBonusAwarded: result.streakBonusAwarded,
      currentStreak: streakRow.current_streak,
      rankChanged: result.rankChanged,
      newRankName: result.newRankName,
      availablePoints: pointStatus.available_points,
      nextRankName: pointStatus.next_rank_name,
      pointsToNext: pointStatus.points_to_next,
    });
    try {
      await lineMessagingService.push(verifiedUser.userId, notice);
    } catch (err) {
      logger.warn("daily.answer.notice_push_failed", {
        surveyId,
        deliveryId,
        lineUserId: verifiedUser.userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    res.json({
      ok: true,
      ...result,
      currentStreak: streakRow.current_streak,
      pointStatus,
    });
  },

  // ── ついでスワイプ（設問プール）────────────────────────────────
  // 案件一覧に埋め込む低ステークス2択。信頼スコア（整合性判定）の素材集め。
  // docs/spec-pool-swipe-questions.md。認証・日付・ポイントの流儀はデイリーと同じ。

  /**
   * 今この人に出すプール設問（最大 POOL_DAILY_CAP 件）。サーバーが選定する。
   * topic_tag / client_id は返さない（回答者に判定利用・出所を悟らせない）。
   */
  async getTodayPoolQuestions(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const items = await poolQuestionService.getTodayForUser(verifiedUser.userId);
    res.json({ ok: true, items });
  },

  async submitPoolQuestionAnswer(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const questionId = stringValue(req.params.questionId).trim();
    const body = req.body as Record<string, unknown>;

    if (!questionId || !isUuid(questionId)) throw new HttpError(404, "設問が見つかりません。");

    const exposureId = stringValue(body.exposureId).trim();
    if (!exposureId || !isUuid(exposureId)) throw new HttpError(400, "exposureId が不正です。");
    if (body.answerValue === undefined || body.answerValue === null) {
      throw new HttpError(400, "回答が含まれていません。");
    }
    const answerMs =
      typeof body.answerMs === "number" && Number.isFinite(body.answerMs)
        ? Math.min(600000, Math.max(0, Math.round(body.answerMs)))
        : null;

    // 所有者検証（400/403/409 の順で厳格に）。他人の exposureId で
    // ポイント参照先をすり替える攻撃を遮断する（deliveryId 検証の前例踏襲）。
    const exposure = await poolQuestionRepository.getExposureById(exposureId);
    if (!exposure || exposure.question_id !== questionId || exposure.line_user_id !== verifiedUser.userId) {
      throw new HttpError(403, "この回答を受け付けられません。");
    }
    if (exposure.status !== "served") {
      throw new HttpError(409, "この設問はすでに回答またはスキップ済みです。");
    }

    const question = await poolQuestionRepository.getById(questionId);
    const { pointsAwarded } = await poolQuestionService.recordAnswer({
      lineUserId: verifiedUser.userId,
      question,
      exposureId,
      answerValue: body.answerValue,
      answerMs,
    });

    const pointStatus = await pointStatusService.getStatus(verifiedUser.userId);
    res.json({ ok: true, pointsAwarded, pointStatus });
  },

  async skipPoolQuestion(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const questionId = stringValue(req.params.questionId).trim();
    const body = req.body as Record<string, unknown>;

    if (!questionId || !isUuid(questionId)) throw new HttpError(404, "設問が見つかりません。");
    const exposureId = stringValue(body.exposureId).trim();
    if (!exposureId || !isUuid(exposureId)) throw new HttpError(400, "exposureId が不正です。");

    const exposure = await poolQuestionRepository.getExposureById(exposureId);
    if (!exposure || exposure.question_id !== questionId || exposure.line_user_id !== verifiedUser.userId) {
      throw new HttpError(403, "この操作を受け付けられません。");
    }
    if (exposure.status !== "served") {
      throw new HttpError(409, "この設問はすでに回答またはスキップ済みです。");
    }

    await poolQuestionService.skip(exposureId);
    res.json({ ok: true });
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
    if (!isUuid(projectId)) throw new HttpError(404, "案件が見つかりません。");
    res.render("liff/project-detail", {
      title: "案件詳細",
      initialData: {
        liffId,
        projectId,
        dataUrl: `/liff/projects/${projectId}/data`,
        favoriteUrl: `/liff/projects/${projectId}/favorite`,
        applyUrl: `/liff/projects/${projectId}/apply`,
        withdrawUrl: `/liff/projects/${projectId}/withdraw`,
        consentCheckUrl: "/liff/consent-check",
        consentPageUrl: "/liff/consent",
        surveyBaseUrl: "/liff/survey",
        projectsUrl: "/liff/projects",
        savedProjectsUrl: "/liff/answer", // 保存は「回答する」タブに合流（旧URLは302で生存）
        interactionsUrl: "/liff/interactions",
        mypageUrl: "/liff/mypage",
      }
    });
  },

  // ---- 店舗専用アンケート流入（B案: 専用URL / QR） ----

  /**
   * 店舗QR / 専用URL の着地点。`?entry_code=abc` を受け、LIFF 認証後に
   * resolve API を叩いて専用アンケートの assignment を確保し、survey へ遷移する。
   */
  async storeEntryPage(req: Request, res: Response): Promise<void> {
    const liffId = env.LINE_LIFF_ID_SURVEY ?? env.LINE_LIFF_ID ?? "";

    // entry_code は query / liff.state(LIFF SDK のエンコード済みクエリ) の双方から拾う
    let liffStateEntryCode: string | undefined;
    const liffState = stringValue(req.query["liff.state"] ?? "");
    if (liffState) {
      try {
        const params = new URLSearchParams(liffState.startsWith("?") ? liffState.slice(1) : liffState);
        liffStateEntryCode = params.get("entry_code") ?? undefined;
      } catch {
        // parse failure → fall through
      }
    }
    const entryCode = stringValue(req.query.entry_code ?? liffStateEntryCode ?? "").trim();

    res.render("liff/store-entry", {
      title: "お店のアンケート",
      initialData: {
        liffId,
        entryCode,
        resolveUrl: "/liff/store/resolve",
        surveyBaseUrl: "/liff/survey",
      },
    });
  },

  /**
   * entry_code から専用アンケートの assignment を解決して返す。
   * 見つからない（未知コード / 公開案件 / 非公開）場合は 404。
   */
  async resolveStoreEntry(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const entryCode = stringValue(req.body.entry_code).trim();

    if (!entryCode) {
      throw new HttpError(400, "店舗コードが指定されていません。");
    }

    const resolution = await storeEntryService.resolveEntry(
      entryCode,
      verifiedUser.userId,
      verifiedUser.displayName ?? null
    );

    if (!resolution) {
      throw new HttpError(404, "このお店のアンケートが見つかりませんでした。");
    }

    res.json({ ok: true, assignment_id: resolution.assignmentId, project_id: resolution.projectId });
  },

  async projectsPage(_req: Request, res: Response): Promise<void> {
    const liffId = process.env.LINE_LIFF_ID_MYPAGE || process.env.LINE_LIFF_ID || null;
    res.render("liff/projects", {
      title: "案件を探す",
      // 体験設定（Phase 0）。一覧は案件に紐付かないので全体既定を解決した値。
      experience: await experienceService.getGlobal(),
      initialData: {
        liffId,
        projectsDataUrl: "/liff/projects-data",
        projectDetailBaseUrl: "/liff/projects",
        dailyTodayUrl: "/liff/daily-surveys-today",
        poolQuestionsTodayUrl: "/liff/pool-questions-today",
        savedProjectsUrl: "/liff/answer", // 保存は「回答する」タブに合流（旧URLは302で生存）
        interactionsUrl: "/liff/interactions",
        mypageUrl: "/liff/mypage",
      }
    });
  },

  async getProjectsData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;
    const category = stringValue(req.query.category).trim() || null;

    // ポイント/ランクは一覧の表示をブロックしない（取れなければカードを出さないだけ）。
    const [projects, favoritedIds, appliedMap, monthly, pointStatus] = await Promise.all([
      projectRepository.listDiscoverable(),
      projectFavoriteRepository.getFavoritedProjectIds(lineUserId),
      projectApplicationRepository.getAppliedProjectIds(lineUserId),
      applicationService.getMonthlySummary(lineUserId),
      pointStatusService.getStatus(lineUserId).catch((err) => {
        logger.warn("projects.point_status.failed", { lineUserId, error: String(err) });
        return null;
      }),
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
      tags: p.tags ?? [],
      apply_mode: p.apply_mode ?? "manual",
      recruit_deadline: p.recruit_deadline ?? null,
      interview_format: p.interview_format ?? null,
      application_status: appliedMap.get(p.id) ?? null,
    }));

    res.json({ ok: true, projects: items, monthly_applications: monthly, point_status: pointStatus });
  },

  async getProjectDetailData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;
    const projectId = stringValue(req.params.id).trim();

    if (!projectId) throw new HttpError(400, "案件IDが指定されていません。");
    if (!isUuid(projectId)) throw new HttpError(404, "案件が見つかりません。");

    const [project, isSaved, myApplication] = await Promise.all([
      projectRepository.getDiscoverableById(projectId),
      projectFavoriteRepository.isFavorited(lineUserId, projectId),
      projectApplicationRepository.findByProjectAndUser(projectId, lineUserId),
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
        tags: project.tags ?? [],
        ng_conditions: project.ng_conditions ?? null,
        apply_mode: project.apply_mode ?? "manual",
        recruit_deadline: project.recruit_deadline ?? null,
        interview_format: project.interview_format ?? null,
        recruit_closed: isRecruitClosed(project),
      },
      is_saved: isSaved,
      my_assignment: myAssignment,
      my_application: myApplication
        ? { id: myApplication.id, status: myApplication.status, assignment_id: myApplication.assignment_id }
        : null,
      completed_count: completedCount ?? 0,
    });
  },

  /**
   * 案件への応募。応募＝assignment発行のリクエストであり、発行判断はサーバー側。
   * auto案件: respondent/assignment を冪等確保して即回答URLを返す。
   * manual案件: applied で選考待ち。
   */
  async applyToProject(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;
    const projectId = stringValue(req.params.id).trim();
    if (!projectId) throw new HttpError(400, "案件IDが指定されていません。");
    if (!isUuid(projectId)) throw new HttpError(404, "案件が見つかりません。");

    const result = await applicationService.apply(projectId, lineUserId, verifiedUser.displayName ?? null);

    if (!result.ok) {
      const map: Record<string, { status: number; message: string }> = {
        not_found: { status: 404, message: "この案件は現在応募できません。" },
        closed: { status: 409, message: "募集期限を過ぎています。" },
        full: { status: 409, message: "募集人数に達したため応募を締め切りました。" },
        duplicate: { status: 409, message: "この案件にはすでに応募済みです。" },
      };
      const e = map[result.reason] ?? { status: 400, message: "応募できませんでした。" };
      res.status(e.status).json({ ok: false, reason: result.reason, error: e.message });
      return;
    }

    if (result.mode === "auto") {
      res.json({
        ok: true,
        mode: "auto",
        application_status: "accepted",
        assignment_id: result.assignmentId,
        survey_url: `/liff/survey/${encodeURIComponent(result.assignmentId)}`,
      });
      return;
    }

    res.json({ ok: true, mode: "manual", application_status: "applied" });
  },

  /** 応募取り消し（選考中のみ） */
  async withdrawApplication(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const projectId = stringValue(req.params.id).trim();
    if (!projectId || !isUuid(projectId)) throw new HttpError(404, "案件が見つかりません。");

    const result = await applicationService.withdraw(projectId, verifiedUser.userId);
    if (!result.ok) {
      res.status(409).json({ ok: false, error: "取り消せる応募がありません（選考中のみ取り消せます）。" });
      return;
    }
    res.json({ ok: true });
  },

  async toggleProjectFavorite(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;
    const projectId = stringValue(req.params.id).trim();
    if (!projectId) throw new HttpError(400, "案件IDが指定されていません。");
    if (!isUuid(projectId)) throw new HttpError(404, "案件が見つかりません。");

    const result = await projectFavoriteRepository.toggle(lineUserId, projectId);
    res.json({ ok: true, saved: result.saved });
  },

  // ---- 回答する（いま回答できるもの＋保存＋結果待ち） ----

  /**
   * 「回答する」タブ。回答者が"いま手を動かせるもの"を1画面に集める。
   * 中断中(started) → 当選未回答(assigned/sent/opened) → 保存 → 結果待ち → 終了 の順で出す。
   * データは既存の2エンドポイント（interactions-data / saved-projects-data）を
   * クライアントで束ねるだけで、新しい取得APIは作らない。
   */
  async answerPage(_req: Request, res: Response): Promise<void> {
    const liffId = process.env.LINE_LIFF_ID_MYPAGE || process.env.LINE_LIFF_ID || null;
    res.render("liff/answer", {
      title: "回答する",
      initialData: {
        liffId,
        interactionsDataUrl: "/liff/interactions-data",
        savedDataUrl: "/liff/saved-projects-data",
        surveyBaseUrl: "/liff/survey",
        projectDetailBaseUrl: "/liff/projects",
        projectsUrl: "/liff/projects",
        mypageUrl: "/liff/mypage",
        dailyTodayUrl: "/liff/daily-surveys-today",
        poolQuestionsTodayUrl: "/liff/pool-questions-today",
      }
    });
  },

  // ---- 保存した案件（旧ページ）----

  /**
   * 旧「保存」タブ。保存は「回答する」タブに合流したので、ここは恒久リダイレクトにする。
   * ⚠ ルート自体は消さないこと: LINE で配信済みのメッセージに
   *   /liff/saved-projects へのリンクが残っており、消すとその導線が死ぬ。
   */
  async savedProjectsPage(_req: Request, res: Response): Promise<void> {
    res.redirect(302, "/liff/answer");
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
        is_active: p ? p.status === "published" : false,
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
        savedProjectsUrl: "/liff/answer", // 保存は「回答する」タブに合流（旧URLは302で生存）
        mypageUrl: "/liff/mypage",
      }
    });
  },

  async getInteractionsData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;

    const [respondents, myApplications] = await Promise.all([
      respondentRepository.listByLineUserId(lineUserId),
      projectApplicationRepository.listByUser(lineUserId),
    ]);
    if (respondents.length === 0 && myApplications.length === 0) {
      res.json({ ok: true, applications: [], pending: [], in_progress: [], completed: [] });
      return;
    }

    const { supabase } = await import("../config/supabase");
    const respondentIds = respondents.map(r => r.id);

    const { data: assignments } = respondentIds.length > 0
      ? await supabase
          .from("project_assignments")
          .select("id, project_id, respondent_id, status, assigned_at, started_at, completed_at, expired_at, deadline")
          .in("respondent_id", respondentIds)
          .order("assigned_at", { ascending: false })
          .limit(100)
      : { data: [] };

    const projectIds = [...new Set([
      ...((assignments ?? []) as { project_id: string }[]).map(a => a.project_id),
      ...myApplications.map(a => a.project_id),
    ])];
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

    // 応募中/落選（assignment未発行の応募）。当選済み（accepted）は assignment 側の pending に出る。
    const applications = myApplications
      .filter(a => a.status === "applied" || a.status === "rejected")
      .map(a => {
        const p = projectMap[a.project_id] as Record<string, unknown> | undefined;
        return {
          application_id: a.id,
          project_id: a.project_id,
          title: p ? String(p.user_display_title || p.name || "") : "不明",
          reward_points: p?.reward_points ?? null,
          estimated_minutes: p?.estimated_minutes ?? null,
          status: a.status,
          applied_at: a.applied_at,
          decided_at: a.decided_at,
        };
      });

    res.json({ ok: true, applications, pending, in_progress: inProgress, completed: done });
  },

  // ============================================================
  // 書類・同意管理
  // ============================================================

  async consentPage(req: Request, res: Response): Promise<void> {
    // 同意画面はマイページ導線の一部。他のLIFFページと同様に MYPAGE をフォールバックの
    // 先頭に置く（LINE_LIFF_ID は未設定運用のため、これが無いと liffId が空になり
    // クライアントで「LIFF IDが設定されていません」になる）。
    const liffId = env.LINE_LIFF_ID_MYPAGE ?? env.LINE_LIFF_ID ?? "";
    const mode = (req.query.mode as string) || "initial";
    const projectId = (req.query.project_id as string) || "";
    // オープンリダイレクト防止: 内部 LIFF パスのみ許可（外部URL・スキーム付きは既定値に倒す）
    const rawRedirect = (req.query.redirect as string) || "";
    const redirectTo = /^\/liff\/[A-Za-z0-9/_\-?=&.%]*$/.test(rawRedirect)
      ? rawRedirect
      : "/liff/mypage";
    res.render("liff/consent", {
      title: mode === "update" ? "規約の更新" : "ご利用前の確認",
      liffId,
      mode,
      projectId,
      redirectTo,
    });
  },

  // グローバルまたは案件別の未同意書類を返す API
  async getConsentCheck(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const { consentService } = await import("../services/consentService");
    const projectId = typeof req.query.project_id === "string" ? req.query.project_id : null;

    const pending = projectId
      ? await consentService.getPendingProjectConsents(verifiedUser.userId, projectId)
      : await consentService.getPendingGlobalConsents(verifiedUser.userId);

    const items = pending.map(p => ({
      documentId: p.document.id,
      versionId: p.versionId,
      versionNo: p.versionNo,
      title: p.document.title,
      content: p.content,
      isRequired: p.isRequired,
    }));

    res.json({ ok: true, pending: items, count: items.length });
  },

  // 同意を一括送信する API
  async submitConsents(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const { consentService } = await import("../services/consentService");
    const body = req.body as { items?: Array<{ documentId: string; versionId: string; projectId?: string | null }> };

    if (!Array.isArray(body.items) || body.items.length === 0) {
      throw new HttpError(400, "同意アイテムが指定されていません");
    }

    const ipAddress = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim()
      || req.socket?.remoteAddress
      || null;
    const userAgent = req.headers["user-agent"] ?? null;

    await consentService.recordBatchConsents(
      verifiedUser.userId,
      body.items,
      { source: "liff", ipAddress, userAgent }
    );

    // 会員化（グローバル必須書類にすべて同意）が成立したら、会員化前に完了して
    // 保留されていたアンケート完了ポイントをまとめて付与する。
    // サーバーレスでレスポンス後の処理が打ち切られないよう、レスポンス前に await する。
    // ポイント付与はべき等（付与済みは二重付与しない）なので await して安全。
    try {
      const pending = await consentService.getPendingGlobalConsents(verifiedUser.userId);
      if (pending.length === 0) {
        // 未同意の必須書類が残っていなければ＝会員化成立
        const { awardDeferredCompletionsForMember } = await import("../services/postCompleteService");
        await awardDeferredCompletionsForMember(verifiedUser.userId);
      }
    } catch (err) {
      logger.warn("submitConsents.awardDeferred.failed", {
        lineUserId: verifiedUser.userId,
        error: String(err),
      });
    }

    res.json({ ok: true, recorded: body.items.length });
  },

  // マイページ用: 同意状況サマリー取得
  async getConsentStatuses(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const { consentService } = await import("../services/consentService");

    const statuses = await consentService.getUserConsentStatuses(verifiedUser.userId);
    const result = statuses.map(s => ({
      documentId: s.document.id,
      title: s.document.title,
      documentType: s.document.document_type,
      consented: s.consented,
      consentedAt: s.consentedAt,
      consentedVersionNo: s.consentedVersionNo,
      isLatestVersion: s.isLatestVersion,
      currentVersionNo: s.document.current_version
        ? (s.document.current_version as { version_no?: string }).version_no ?? null
        : null,
    }));

    const hasUnsigned = result.some(r => !r.consented || !r.isLatestVersion);
    res.json({ ok: true, statuses: result, has_unsigned: hasUnsigned });
  },

  // 特定書類の本文を取得（マイページ「利用規約を読む」用）
  async getDocumentContent(req: Request, res: Response): Promise<void> {
    const { documentRepository } = await import("../repositories/documentRepository");
    const docId = stringValue(req.params.documentId ?? "").trim();
    const versionId = typeof req.query.version_id === "string" ? req.query.version_id : null;

    if (!isUuid(docId)) throw new HttpError(404, "書類が見つかりません");

    const doc = await documentRepository.getById(docId);
    if (!doc || !doc.is_active) throw new HttpError(404, "書類が見つかりません");

    let version = doc.current_version ?? null;
    if (versionId) {
      const v = await documentRepository.getVersion(versionId);
      if (v && v.document_id === docId) version = v;
    }

    if (!version) throw new HttpError(404, "バージョンが見つかりません");

    res.json({
      ok: true,
      document: { id: doc.id, title: doc.title, document_type: doc.document_type },
      version: {
        id: version.id,
        version_no: version.version_no,
        content: version.content,
        effective_from: version.effective_from,
        change_reason: version.change_reason,
      },
    });
  },

  // ─── ポイント交換申請 ─────────────────────────────────────────────

  async requestExchange(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;

    const body = req.body as Record<string, unknown>;
    const requestedPoints = Number(body.requested_points);

    if (!Number.isInteger(requestedPoints) || requestedPoints <= 0) {
      res.status(400).json({ ok: false, error: "requested_points が不正です" });
      return;
    }
    if (requestedPoints % EXCHANGE_UNIT_POINTS !== 0) {
      res.status(400).json({
        ok: false,
        error: `交換ポイントは ${EXCHANGE_UNIT_POINTS}pt の倍数で指定してください`,
      });
      return;
    }

    try {
      const request = await pointExchangeService.requestExchange(lineUserId, requestedPoints);
      res.status(201).json({
        ok: true,
        exchange: {
          id:              request.id,
          requested_points: request.requested_points,
          gift_amount_jpy:  request.gift_amount_jpy,
          status:           request.status,
          requested_at:    request.requested_at,
        },
      });
    } catch (err) {
      if (err instanceof ExchangeError) {
        res.status(400).json({ ok: false, error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  },

  async cancelExchange(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;
    const requestId = String(req.params.id ?? "");

    if (!requestId) {
      res.status(400).json({ ok: false, error: "id が必要です" });
      return;
    }
    if (!isUuid(requestId)) throw new HttpError(404, "交換申請が見つかりません。");

    try {
      const canceled = await pointExchangeService.cancelExchange(requestId, lineUserId);
      res.json({
        ok: true,
        exchange: {
          id:         canceled.id,
          status:     canceled.status,
          canceled_at: canceled.canceled_at,
        },
      });
    } catch (err) {
      if (err instanceof ExchangeError) {
        const status = err.code === "REQUEST_NOT_FOUND" ? 404 : 400;
        res.status(status).json({ ok: false, error: err.message, code: err.code });
        return;
      }
      throw err;
    }
  },
};
