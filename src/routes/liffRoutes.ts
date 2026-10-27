import { Router } from "express";
import { liffController } from "../controllers/liffController";
import { missionController } from "../controllers/missionController";
import { asyncHandler } from "../lib/http";
import { parseLiffStateQuery } from "../lib/liffState";
import { logger } from "../lib/logger";
import { liffAuthService } from "../services/liffAuthService";
import { recordBehaviorEvents } from "../services/liffBehaviorService";

export const liffRoutes = Router();

// クライアント側の体感時間ビーコン（計測フェーズ専用・DB書込みなし・認証不要）。
// モバイルの LINE 内ブラウザは DevTools が使えないため、SDKダウンロード＋liff.init など
// サーバーログに映らないクライアント側ウォーターフォールを sendBeacon で回収して
// Vercel ログに出す。挙動には一切影響しない。数値の目星が付いたら撤去してよい。
liffRoutes.post("/perf-beacon", (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 10) / 10 : undefined);
  logger.info("perf.liff.client", {
    page: typeof b.page === "string" ? b.page.slice(0, 80) : undefined,
    sdkReadyMs: num(b.sdkReadyMs), // ページ読込開始→LIFF SDK 実行可能まで（CDN DL 相当）
    initMs: num(b.initMs), //         liff.init() の所要（LINE 往復含む）
    authTotalMs: num(b.authTotalMs), // 認証完了まで（sdkReady+init+ログイン判定）
    dataMs: num(b.dataMs), //          データ fetch 往復
    renderMs: num(b.renderMs), //      DOM 描画
    totalMs: num(b.totalMs), //        ページ読込開始→初期表示完了
    inClient: typeof b.inClient === "boolean" ? b.inClient : undefined,
  });
  res.status(204).end();
});

// LINE ログイン往復の計測ビーコン（liff-auth.ejs の _authBeacon・DB書込みなし・認証不要）。
// スマホの通常ブラウザで LINE Login から戻ってもログイン済みにならない事象の原因を
// 実データで特定するため、往復の状態（試行回数・code/state の有無・OAuth エラー・
// ストレージ可否・UA 等）をサーバーログに出す。何があっても 204 を返す。
liffRoutes.post("/auth-beacon", (req, res) => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : undefined);
  const bool = (v: unknown) => (typeof v === "boolean" ? v : undefined);
  logger.info("liff.auth.client", {
    event: str(b.event, 40),
    page: str(b.page, 80),
    attempt: typeof b.attempt === "number" && Number.isFinite(b.attempt) ? b.attempt : undefined,
    handoff: bool(b.handoff),
    hasCode: bool(b.hasCode),
    hasState: bool(b.hasState),
    oauthError: str(b.oauthError, 60),
    oauthErrorDescription: str(b.oauthErrorDescription, 200),
    isInClient: bool(b.isInClient),
    isLoggedIn: bool(b.isLoggedIn),
    os: str(b.os, 20),
    sessionStorageOk: bool(b.sessionStorageOk),
    cookieEnabled: bool(b.cookieEnabled),
    referrerHost: str(b.referrerHost, 80),
    hasOpenUrl: bool(b.hasOpenUrl),
    ua: str(b.ua, 200),
  });
  res.status(204).end();
});

// 行動計測ビーコン（migration 086 / liff_behavior_events）。
// 目的は「ボトムナビに保存タブが要るか」「探す画面で案件一覧まで到達しているか」を
// 感覚でなく実データで決めること。リリース前に仕込み、リリース後の実データで判断する。
//
// 設計上の約束:
//  - 認証は任意。id_token があれば本人に紐づけ、無くても匿名イベントとして受ける
//    （計測のためにログインを強制しない。認証失敗でイベントを捨てない）。
//  - 何があっても 204 を返す。計測がユーザー体験を壊さないことを最優先する。
//  - sendBeacon から複数イベントをまとめて受ける想定。
//  - 壊れた JSON でも 204。パース失敗は app.ts の express.json() 内で throw されるため
//    ここでは捕まえられない。app.ts 側で本ルートのパースエラーだけを握りつぶしている。
liffRoutes.post("/behavior-beacon", async (req, res) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;

    // 本人紐づけは best-effort。トークンが無い・失効していてもイベント自体は残す
    // （匿名でも「一覧到達率」「ナビのタップ比率」は判断材料として成立するため）。
    let lineUserId: string | null = null;
    const authHeader = req.headers.authorization;
    const rawToken = typeof authHeader === "string" && authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";
    if (rawToken) {
      try {
        const user = await liffAuthService.verifyIdToken(rawToken, { path: req.path });
        lineUserId = user.userId;
      } catch {
        /* noop: 認証できなくても匿名イベントとして記録する */
      }
    }

    await recordBehaviorEvents(body.events, lineUserId);
  } catch (err) {
    // 計測の失敗はユーザーに見せない。気付けるようにログにだけ残す。
    logger.warn("liff.behavior.beacon_failed", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
  res.status(204).end();
});

// サイトの玄関。LIFF endpoint を {APP_BASE_URL}/liff に設定すると、
// リッチメニュー等の https://liff.line.me/{id}/projects 形式のディープリンクが
// そのまま各ページに解決される。無印(パス無し)で開かれたら「探す」へ送る。
liffRoutes.get("/", (req, res) => {
  // 店舗QR（liff.line.me/{id}?entry_code=xxx）の着地。endpoint が /liff の LIFF 構成でも
  // 店舗入口へ解決できるよう、query / liff.state から entry_code を拾って引き継ぐ。
  // liff.state をリダイレクト先に残すと SDK の二次リダイレクトで endpoint へ戻され
  // ループするため、entry_code だけを取り出して捨てる。
  // liff.state は "?entry_code=x"（QR）と "/store?entry_code=x"（「LINEで開く」の恒久リンク）の
  // 両形式で来るため、"?" 以降をクエリとして読む。
  const liffStateParams = parseLiffStateQuery(req.query["liff.state"]);
  // 「LINEで開く」経由の目印（liff-auth.ejs の HANDOFF_PARAM）は着地先へ引き継ぐ
  const handoffSuffix = liffStateParams.get("liff_handoff") === "1" || req.query.liff_handoff === "1" ? "&liff_handoff=1" : "";
  const entryCode = (() => {
    const direct = typeof req.query.entry_code === "string" ? req.query.entry_code.trim() : "";
    if (direct) return direct;
    return (liffStateParams.get("entry_code") ?? "").trim();
  })();
  if (entryCode) {
    res.redirect(302, `/liff/store?entry_code=${encodeURIComponent(entryCode)}${handoffSuffix}`);
    return;
  }

  // 案件配信の「回答を開始する」（liff.line.me/{id}?assignment_id=xxx）の着地。
  // endpoint が /liff の LIFF 構成では liff.state 内に assignment_id が入るため、
  // ここで拾わないと下の「探す」リダイレクトで assignment_id が捨てられ回答画面に到達できない。
  // entry_code 同様、liff.state はループ防止のため引き継がず assignment_id だけ取り出す。
  const assignmentId = (() => {
    const direct = typeof req.query.assignment_id === "string" ? req.query.assignment_id.trim() : "";
    if (direct) return direct;
    return (liffStateParams.get("assignment_id") ?? "").trim();
  })();
  if (assignmentId) {
    res.redirect(302, `/liff/survey?assignment_id=${encodeURIComponent(assignmentId)}${handoffSuffix}`);
    return;
  }

  const qs = req.originalUrl.includes("?") ? req.originalUrl.slice(req.originalUrl.indexOf("?")) : "";
  res.redirect(302, `/liff/projects${qs}`);
});

liffRoutes.get("/rant", asyncHandler(liffController.rantPage));
liffRoutes.get("/diary", asyncHandler(liffController.diaryPage));
liffRoutes.get("/personality", asyncHandler(liffController.personalityPage));
liffRoutes.get("/mypage", asyncHandler(liffController.mypagePage));
liffRoutes.get("/profile/check", asyncHandler(liffController.profileCheckPage));
liffRoutes.get("/profile-check-data", asyncHandler(liffController.getProfileCheckData));

liffRoutes.post("/posts", asyncHandler(liffController.createPost));
liffRoutes.get("/personality-data", asyncHandler(liffController.personalityData));
liffRoutes.get("/profile-status", asyncHandler(liffController.getProfileStatus));
liffRoutes.get("/mypage-data", asyncHandler(liffController.getMypageData));
liffRoutes.post("/mypage-data", asyncHandler(liffController.updateMypageData));
liffRoutes.get("/history-data", asyncHandler(liffController.getHistoryData));
liffRoutes.get("/points-data", asyncHandler(liffController.getPointsData));
liffRoutes.get("/diary-calendar", asyncHandler(liffController.getDiaryCalendar));

// マイページ確認完了記録
liffRoutes.post("/session/confirm-mypage", asyncHandler(liffController.confirmMypage));

// Survey / Interview (新スキーマ対応)
// NOTE: /survey/answer, /survey/complete, /survey/verify-identity は
//       /survey/:assignmentId よりも先に定義しないとルーティングが衝突する
liffRoutes.post("/chat", asyncHandler(liffController.chatMessage));
liffRoutes.post("/survey/answer", asyncHandler(liffController.submitSurveyAnswer));
liffRoutes.post("/survey/complete", asyncHandler(liffController.completeSurvey));
liffRoutes.post("/survey/upload-image", asyncHandler(liffController.uploadRespondentImage));
// LIFF ID token による本人確認エンドポイント
// LINE Developers 側の LINE_LIFF_CHANNEL_ID + LINE_LIFF_ID_SURVEY 設定後に有効になる
liffRoutes.post("/survey/verify-identity", asyncHandler(liffController.verifyIdentity));
// 回答完了確定API: サーバー側で完了判定・ポイント付与・LINE通知を行う
liffRoutes.post("/survey/:assignmentId/complete", asyncHandler(liffController.completeSurveyByAssignment));
// テスト運営者（migration 119）の回答し直し。運営者かどうかはハンドラ側で必ず検証する。
liffRoutes.post("/survey/:assignmentId/retest", asyncHandler(liffController.retestSurvey));
// スクリーニング判定API
liffRoutes.post("/survey/:assignmentId/judge-screening", asyncHandler(liffController.judgeScreening));
// サーバー権威の次設問解決API（初回・再開用。Phase2 クライアントが消費）
liffRoutes.get("/survey/:assignmentId/next", asyncHandler(liffController.getSurveyNext));
liffRoutes.get("/survey/:assignmentId", asyncHandler(liffController.surveyPage));
liffRoutes.get("/survey", asyncHandler(liffController.surveyPage));

liffRoutes.get("/contact", asyncHandler(liffController.contactPage));
liffRoutes.post("/contact", asyncHandler(liffController.submitContact));

// デイリーアンケート
liffRoutes.get("/daily-survey", asyncHandler(liffController.dailySurveyPage));
liffRoutes.get("/daily-survey-data", asyncHandler(liffController.getDailySurveyData));
// 案件一覧の最上部に出す「今日の1問」。どれを出すかはサーバーが決める。
liffRoutes.get("/daily-surveys-today", asyncHandler(liffController.getTodayDailySurveys));
liffRoutes.post("/daily-survey/:surveyId/answer", asyncHandler(liffController.submitDailySurveyAnswer));

// ついでスワイプ（設問プール）。案件一覧に埋め込む低ステークス2択。
liffRoutes.get("/pool-questions-today", asyncHandler(liffController.getTodayPoolQuestions));
liffRoutes.post("/pool-questions/:questionId/answer", asyncHandler(liffController.submitPoolQuestionAnswer));
liffRoutes.post("/pool-questions/:questionId/skip", asyncHandler(liffController.skipPoolQuestion));

// 店舗専用アンケート流入（専用URL / QR）
liffRoutes.get("/store", asyncHandler(liffController.storeEntryPage));
liffRoutes.post("/store/resolve", asyncHandler(liffController.resolveStoreEntry));

// 案件一覧・詳細・保存・やりとり
// NOTE: /projects/:id の静的セグメントより先に定義
liffRoutes.get("/projects", asyncHandler(liffController.projectsPage));
liffRoutes.get("/projects-data", asyncHandler(liffController.getProjectsData));
liffRoutes.get("/projects/:id/data", asyncHandler(liffController.getProjectDetailData));
liffRoutes.post("/projects/:id/favorite", asyncHandler(liffController.toggleProjectFavorite));
liffRoutes.post("/projects/:id/apply", asyncHandler(liffController.applyToProject));
liffRoutes.post("/projects/:id/withdraw", asyncHandler(liffController.withdrawApplication));
liffRoutes.get("/projects/:id", asyncHandler(liffController.projectDetailPage));
// 「回答する」タブ。いま回答できるもの・保存・結果待ちを1画面に集める。
liffRoutes.get("/answer", asyncHandler(liffController.answerPage));
// 旧「保存」タブ。/answer へ 302。⚠ 配信済みLINEメッセージのリンクが生きているため消さない。
liffRoutes.get("/saved-projects", asyncHandler(liffController.savedProjectsPage));
liffRoutes.get("/saved-projects-data", asyncHandler(liffController.getSavedProjectsData));
liffRoutes.get("/interactions", asyncHandler(liffController.interactionsPage));
liffRoutes.get("/interactions-data", asyncHandler(liffController.getInteractionsData));

// ポイント交換申請
liffRoutes.post("/exchange-requests",             asyncHandler(liffController.requestExchange));
liffRoutes.post("/exchange-requests/:id/cancel",  asyncHandler(liffController.cancelExchange));

// 書類・同意管理
liffRoutes.get("/consent",                asyncHandler(liffController.consentPage));
liffRoutes.get("/consent-check",          asyncHandler(liffController.getConsentCheck));
liffRoutes.post("/consent-submit",        asyncHandler(liffController.submitConsents));
liffRoutes.get("/consent-statuses",       asyncHandler(liffController.getConsentStatuses));
liffRoutes.get("/documents/:documentId",  asyncHandler(liffController.getDocumentContent));

// ミッション Phase 1: 招待とペア（docs/spec-mission-phase1-invite-pair.md）
liffRoutes.get("/invite/:token",              asyncHandler(missionController.invitePage));      // 未ログイン可
liffRoutes.post("/invite/:token/accept",      asyncHandler(missionController.acceptInvite));
liffRoutes.post("/invites",                   asyncHandler(missionController.issueInvite));
liffRoutes.get("/pair/:pairId/answer",        asyncHandler(missionController.pairAnswerPage));
liffRoutes.get("/pair/:pairId/data",          asyncHandler(missionController.getPairData));
liffRoutes.post("/pair/:pairId/answer",       asyncHandler(missionController.submitPairAnswer));
liffRoutes.get("/pair/:pairId/result",        asyncHandler(missionController.pairResultPage));
liffRoutes.get("/pair/:pairId/result-data",   asyncHandler(missionController.getPairResult));

// ミッション Phase 2: ステージ（docs/plan-mission-phases.md）
liffRoutes.get("/mission",                    asyncHandler(missionController.missionPage));
liffRoutes.get("/mission/:missionId/data",    asyncHandler(missionController.getMissionData));

// ミッション Phase 3: 隠し部屋（docs/spec-mission-phase23-rooms-hidden.md）
liffRoutes.post("/mission/:missionId/hidden-room/enter", asyncHandler(missionController.enterHiddenRoom));
