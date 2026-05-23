import type { Request, Response } from "express";
import { env } from "../config/env";
import { STORAGE_BUCKET, storagePaths } from "../config/storage";
import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";
import { getProjectResearchSettings } from "../lib/projectResearch";
import { normalizeQuestionMeta } from "../lib/questionMetadata";
import { userProfileRepository, type UserProfileUpsertInput } from "../repositories/userProfileRepository";
import { projectRepository } from "../repositories/projectRepository";
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
import type { Gender, MaritalStatus, RantTag } from "../types/domain";
import { runPostCompleteProcess } from "../services/postCompleteService";
import { rantTagRepository } from "../repositories/rantTagRepository";
import { postRepository } from "../repositories/postRepository";

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

    res.render("liff/mypage", {
      title: entry.title,
      entry,
      initialData: {
        appBaseUrl: env.APP_BASE_URL,
        liffId: entry.liffId,
        mode,
        next,
        profileUrl: "/liff/mypage-data",
        updateUrl: "/liff/mypage-data",
        historyUrl: "/liff/history-data",
        pointsUrl: "/liff/points-data",
        consentUrl: "/liff/consent-data",
      }
    });
  },

  async getMypageData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const lineUserId = verifiedUser.userId;

    const [profile, respondents, ranks] = await Promise.all([
      userProfileRepository.getByLineUserId(lineUserId),
      respondentRepository.listByLineUserId(lineUserId),
      rankRepository.list(),
    ]);

    // ポイント合計が最大の respondent を primary とする
    const primaryRespondent = respondents.sort((a, b) => b.total_points - a.total_points)[0] ?? null;
    const completedCount = respondents.filter(r => r.status === "completed").length;

    const totalPoints = primaryRespondent?.total_points ?? 0;
    const currentRank = primaryRespondent?.current_rank ?? null;
    const nextRank = ranks.find(r => r.min_points > totalPoints && r.min_points > (currentRank?.min_points ?? -1)) ?? null;

    const recentTransactions = primaryRespondent
      ? (await pointTransactionRepository.listByRespondent(primaryRespondent.id)).slice(0, 5)
      : [];

    // last_login_at を非同期で更新（レスポンスをブロックしない）
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
      },
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

    // プロフィール未完了チェック: user_id が判明している場合のみ
    if (assignment.user_id) {
      const userProfile = await userProfileRepository.getByLineUserId(assignment.user_id);
      if (!userProfile?.profile_completed) {
        const mypageEntry = await liffService.getPage("mypage");
        res.render("liff/survey", {
          title: project.name,
          profileIncomplete: true,
          mypageLiffId: mypageEntry?.liffId ?? null,
          errorMessage: null,
          alreadyCompleted: false,
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
    }

    // 二重回答防止: 既に完了済みの場合は完了済み画面を返す
    if (assignment.status === "completed") {
      res.render("liff/survey", {
        title: project.name,
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

    // アクティブなセッションを探す、なければ作成
    let session = await sessionRepository.getActiveByRespondent(assignment.respondent_id, project.id);
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

    res.render("liff/survey", {
      title: project.name,
      project,
      projectData: {
        id: project.id,
        name: project.name,
        display_mode: project.display_mode ?? "survey_question",
      },
      questions: questions.filter(q => !q.is_hidden),
      pageGroups,
      sessionId: session.id,
      assignmentId: assignment.id,
      displayMode: project.display_mode ?? "survey_question",
      // LIFF 設定情報（survey.ejs で使用）
      liffId: liffConfig.liffId,
      liffAuthAvailable: liffConfig.liffAuthAvailable,
      authRequired: liffConfig.liffAuthAvailable,
      skipAllowed: liffConfig.skipAllowed,
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
      ? await supabase.from("projects").select("id, name, reward_points").in("id", projectIds)
      : { data: [] };

    const projectMap = Object.fromEntries(
      ((projects ?? []) as { id: string; name: string; reward_points: number | null }[])
        .map(p => [p.id, p])
    );

    const history = ((assignments ?? []) as {
      id: string; project_id: string; status: string;
      completed_at: string | null; started_at: string | null; assigned_at: string | null;
    }[]).map(a => ({
      assignment_id: a.id,
      project_id: a.project_id,
      project_name: projectMap[a.project_id]?.name ?? "不明",
      reward_points: projectMap[a.project_id]?.reward_points ?? null,
      status: a.status,
      completed_at: a.completed_at,
      assigned_at: a.assigned_at,
    }));

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
};
