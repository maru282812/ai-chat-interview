import type { Request, Response } from "express";
import { env } from "../config/env";
import { HttpError } from "../lib/http";
import { liffAuthService } from "../services/liffAuthService";
import { missionInviteService } from "../services/missionInviteService";
import { respondentService } from "../services/respondentService";
import { buildAbsoluteInviteUrl } from "../services/liffService";
import { missionService } from "../services/missionService";
import { missionHiddenRoomService } from "../services/missionHiddenRoomService";
import { MISSION_THEMES, resolveMissionTheme } from "../lib/missionThemes";
import type { HiddenAwardMode, HiddenOpenMode } from "../lib/missionRooms";

/**
 * ミッション Phase 1（招待・ペア）のコントローラ。
 * 仕様: docs/spec-mission-phase1-invite-pair.md
 *
 * liffController と別ファイルにしている理由: 既存 3,000 行のコントローラに
 * 足すと差分が追えなくなる。認証・エラーの流儀は liffController に合わせる。
 */

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function bearerToken(req: Request): string {
  const header = req.headers.authorization ?? "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

export const missionController = {
  /** 招待ランディング。**未ログインで閲覧可**（新規獲得の生命線）。 */
  async invitePage(req: Request, res: Response): Promise<void> {
    const token = stringValue(req.params.token).trim();
    const view = await missionInviteService.getLandingView(token);
    res.render("liff/invite", {
      title: "招待",
      initialData: {
        liffId: env.LINE_LIFF_ID_SURVEY ?? env.LINE_LIFF_ID ?? "",
        token,
        landing: view,
      },
    });
  },

  /** 招待の受諾（登録の検知）。LIFF 認証必須。 */
  async acceptInvite(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const token = stringValue(req.params.token).trim();
    if (!token) throw new HttpError(400, "招待トークンがありません。");

    const result = await missionInviteService.acceptInvite({
      token,
      userId: verifiedUser.userId,
      displayName: verifiedUser.displayName ?? null,
      ua: stringValue(req.headers["user-agent"]) || null,
      ip: stringValue(req.headers["x-forwarded-for"]).split(",")[0]?.trim() || null,
    });
    res.json({ ok: true, pairId: result.pairId });
  },

  /** 自分の招待リンクを発行する（マイページ等から）。 */
  async issueInvite(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    // 会員のみ（未登録ユーザーに発行させない）
    const me = await respondentService.getPrimaryRespondent(verifiedUser.userId);
    if (!me) throw new HttpError(403, "招待リンクの発行には会員登録が必要です。");
    const invite = await missionInviteService.issueInvite(verifiedUser.userId);
    res.json({ ok: true, url: buildAbsoluteInviteUrl(invite.token) });
  },

  /** ペア回答ページ。 */
  async pairAnswerPage(req: Request, res: Response): Promise<void> {
    res.render("liff/pair-answer", {
      title: "ペアアンケート",
      initialData: {
        liffId: env.LINE_LIFF_ID_SURVEY ?? env.LINE_LIFF_ID ?? "",
        pairId: stringValue(req.params.pairId).trim(),
      },
    });
  },

  /** ペア回答データ。当事者のみ。相手は「答えたかどうか」まで。 */
  async getPairData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const data = await missionInviteService.getPairData(
      stringValue(req.params.pairId).trim(),
      verifiedUser.userId
    );
    res.json(data);
  },

  /** ペア回答の送信。 */
  async submitPairAnswer(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const result = await missionInviteService.submitAnswer({
      pairId: stringValue(req.params.pairId).trim(),
      userId: verifiedUser.userId,
      questionId: stringValue(req.body.question_id).trim(),
      choiceCode: stringValue(req.body.choice_code).trim(),
    });
    res.json({ ok: true, ...result });
  },

  /** 答え合わせページ。 */
  async pairResultPage(req: Request, res: Response): Promise<void> {
    res.render("liff/pair-result", {
      title: "答え合わせ",
      initialData: {
        liffId: env.LINE_LIFF_ID_SURVEY ?? env.LINE_LIFF_ID ?? "",
        pairId: stringValue(req.params.pairId).trim(),
      },
    });
  },

  /**
   * 答え合わせデータ。両者完了時のみ 200・未完了は 409。
   * ⚠ レスポンスに相手の選択肢は含まれない（service 層の純関数が構造で保証・D-10）。
   */
  async getPairResult(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const data = await missionInviteService.getResult(
      stringValue(req.params.pairId).trim(),
      verifiedUser.userId
    );
    res.json(data);
  },

  /** ミッションページ。テーマ（色・情景・文言）はサーバーで解決して埋め込む。 */
  async missionPage(_req: Request, res: Response): Promise<void> {
    const mission = await missionService.getActiveMission();
    if (!mission) {
      res.render("liff/mission", {
        title: "ミッション",
        theme: null,
        initialData: { liffId: env.LINE_LIFF_ID_SURVEY ?? env.LINE_LIFF_ID ?? "", missionId: null },
      });
      return;
    }
    res.render("liff/mission", {
      title: mission.name,
      theme: resolveMissionTheme(mission.theme_key),
      initialData: {
        liffId: env.LINE_LIFF_ID_SURVEY ?? env.LINE_LIFF_ID ?? "",
        missionId: mission.id,
      },
    });
  },

  /** ミッションデータ（進捗・段・付与）。読み時評価＝ここで達成分を付与する。 */
  async getMissionData(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const data = await missionService.getPageData(
      stringValue(req.params.missionId).trim(),
      verifiedUser.userId
    );
    res.json(data);
  },

  /** 隠し部屋への入室。開いているかはサーバーが再評価する（R-4）。 */
  async enterHiddenRoom(req: Request, res: Response): Promise<void> {
    const verifiedUser = await liffAuthService.verifyIdToken(bearerToken(req));
    const result = await missionService.enterHiddenRoom(
      stringValue(req.params.missionId).trim(),
      verifiedUser.userId
    );
    res.json({ ok: true, category: result.category });
  },

  // ---- 管理: ミッション ----

  async adminMissionsPage(_req: Request, res: Response): Promise<void> {
    const missions = await missionService.listForAdmin();
    res.render("admin/mission/index", { title: "ミッション", missions, themes: MISSION_THEMES });
  },

  async adminMissionFormPage(req: Request, res: Response): Promise<void> {
    const id = stringValue(req.params.id).trim();
    if (id === "new") {
      res.render("admin/mission/form", {
        title: "ミッション作成", mode: "create",
        mission: null, stages: [], hiddenRoom: null, themes: MISSION_THEMES, errors: [],
      });
      return;
    }
    const { mission, stages } = await missionService.getForAdmin(id);
    const hiddenRoom = await missionHiddenRoomService.getForMission(id);
    res.render("admin/mission/form", {
      title: "ミッション編集", mode: "edit",
      mission, stages, hiddenRoom, themes: MISSION_THEMES, errors: [],
    });
  },

  async adminMissionSave(req: Request, res: Response): Promise<void> {
    const body = req.body as Record<string, unknown>;
    const stages: Array<{ stage_no: number; need_answers: number; need_invites: number; reward_points: number; is_masked: boolean }> = [];
    for (let i = 1; i <= 5; i++) {
      const na = Number(stringValue(body[`stage${i}_answers`]));
      const ni = Number(stringValue(body[`stage${i}_invites`]));
      const rp = Number(stringValue(body[`stage${i}_points`]));
      if (!na && !ni && !rp) continue;
      stages.push({
        stage_no: i,
        need_answers: na || 0,
        need_invites: ni || 0,
        reward_points: rp || 0,
        is_masked: stringValue(body[`stage${i}_masked`]) === "1",
      });
    }
    const startsAtIso = new Date(stringValue(body.starts_at)).toISOString();
    const endsAtIso = new Date(stringValue(body.ends_at)).toISOString();
    const result = await missionService.saveMission({
      id: stringValue(body.id).trim() || null,
      name: stringValue(body.name).trim(),
      scope: stringValue(body.scope) === "project" ? "project" : "platform",
      project_id: stringValue(body.project_id).trim() || null,
      theme_key: stringValue(body.theme_key).trim() || "forest",
      starts_at: startsAtIso,
      ends_at: endsAtIso,
      is_active: stringValue(body.is_active) === "1",
      stages,
    });

    // 隠し部屋（Phase 3）。ミッション本体が保存できたときだけ触る
    const errors = [...result.errors];
    if (result.errors.length === 0 && result.id) {
      const num = (key: string): number | null => {
        const n = Number(stringValue(body[key]));
        return Number.isFinite(n) && n > 0 ? n : null;
      };
      const openModeRaw = stringValue(body.hidden_open_mode);
      const awardModeRaw = stringValue(body.hidden_award_mode);
      const hiddenErrors = await missionHiddenRoomService.saveForMission({
        missionId: result.id,
        missionStartsAt: startsAtIso,
        missionEndsAt: endsAtIso,
        enabled: stringValue(body.hidden_enabled) === "1",
        category: stringValue(body.hidden_category).trim(),
        open_mode: (["rooms_cleared", "schedule", "first_n", "random"].includes(openModeRaw)
          ? openModeRaw
          : "rooms_cleared") as HiddenOpenMode,
        rooms_needed: num("hidden_rooms_needed"),
        opens_at: stringValue(body.hidden_opens_at).trim()
          ? new Date(stringValue(body.hidden_opens_at)).toISOString()
          : null,
        closes_at: stringValue(body.hidden_closes_at).trim()
          ? new Date(stringValue(body.hidden_closes_at)).toISOString()
          : null,
        first_n: num("hidden_first_n"),
        award_mode: (["split", "flat", "raffle"].includes(awardModeRaw)
          ? awardModeRaw
          : "split") as HiddenAwardMode,
        pot_points: num("hidden_pot_points"),
        flat_points: num("hidden_flat_points"),
        prize_points: num("hidden_prize_points"),
        winners_count: num("hidden_winners_count"),
      });
      errors.push(...hiddenErrors);
    }

    if (errors.length > 0) {
      const { mission, stages: savedStages } = result.id
        ? await missionService.getForAdmin(result.id)
        : { mission: null, stages: [] };
      const hiddenRoom = result.id ? await missionHiddenRoomService.getForMission(result.id) : null;
      res.status(400).render("admin/mission/form", {
        title: "ミッション編集", mode: result.id ? "edit" : "create",
        mission, stages: savedStages, hiddenRoom, themes: MISSION_THEMES, errors,
      });
      return;
    }
    res.redirect("/admin/mission");
  },

  /** 管理: 招待実績一覧（招待偏重フラグつき）。 */
  async adminInvitesPage(_req: Request, res: Response): Promise<void> {
    const invites = await missionInviteService.listForAdmin();
    res.render("admin/mission/invites", { title: "招待実績", invites });
  },

  /** 管理: 招待の取消。 */
  async adminRevokeInvite(req: Request, res: Response): Promise<void> {
    await missionInviteService.revokeInvite(stringValue(req.params.id).trim());
    res.redirect("/admin/mission/invites");
  },
};
