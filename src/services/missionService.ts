import { HttpError } from "../lib/http";
import {
  buildStageViews,
  remainingForStage,
  stagesToAward,
  validateStages,
  type MissionStageDef,
  type StageView,
} from "../lib/missionStage";
import { resolveMissionTheme, type MissionTheme } from "../lib/missionThemes";
import { buildRoomViews, countClearedRooms, type RoomView } from "../lib/missionRooms";
import { missionRepository, type Mission } from "../repositories/missionRepository";
import { missionInviteRepository } from "../repositories/missionInviteRepository";
import { projectRepository } from "../repositories/projectRepository";
import { missionHiddenRoomService, type HiddenRoomView } from "./missionHiddenRoomService";
import { userPointService } from "./userPointService";

/**
 * ミッション Phase 2: ステージ判定と付与。
 *
 * 判定はサーバー権威（R-4）。ページ読み込み時に台帳を数え、達成済み未受領の段を
 * その場で付与する（達成瞬間のフックを全回答経路に足すより、読み時評価のほうが
 * 数え漏れ・二重付与の面で安全。付与の遅延は「ページを開いたとき」まで）。
 */

export interface MissionPageData {
  mission: Pick<Mission, "id" | "name" | "scope" | "ends_at">;
  theme: MissionTheme;
  answers: number;
  invites: number;
  stages: StageView[];
  /** 現在段への残り（goal gradient 用）。全段達成なら null */
  remaining: { answersLeft: number; invitesLeft: number } | null;
  /** このリクエストで新たに付与された段（演出のトリガー） */
  newlyAwarded: number[];
  /** 案件指定型のゲージ。max_respondents 未設定なら null（分母を捏造しない・D-14） */
  gauge: { current: number; target: number; deadline: string | null } | null;
  /** 部屋（category別）。0件の部屋は含まれない。隠し部屋のカテゴリは除外済み */
  rooms: RoomView[];
  /** 隠し部屋。未設定なら null */
  hiddenRoom: HiddenRoomView | null;
}

export const missionService = {
  /** いまの横断型ミッション。無ければ null（ページは「開催中の企画はありません」）。 */
  async getActiveMission(): Promise<Mission | null> {
    return missionRepository.getActivePlatformMission();
  },

  /**
   * ミッションページのデータ一式。達成済み未受領の段はここで付与する。
   * 冪等性: mission_stage_awards の UNIQUE（recordAward が false なら払わない）
   *         ＋ awardPoints の idempotency_key の二重。
   */
  async getPageData(missionId: string, lineUserId: string): Promise<MissionPageData> {
    const mission = await missionRepository.getById(missionId);
    if (!mission || !mission.is_active) throw new HttpError(404, "この企画は見つかりません。");

    const [stageRows, awardedNos, answers, invites] = await Promise.all([
      missionRepository.listStages(mission.id),
      missionRepository.listAwardedStageNos(mission.id, lineUserId),
      missionRepository.countAnswers(lineUserId, mission.starts_at, mission.ends_at),
      missionRepository.countInvites(lineUserId, mission.starts_at, mission.ends_at),
    ]);
    const stages: MissionStageDef[] = stageRows;

    // 達成済み未受領の段を付与（期間中のみ。終了後は閲覧だけ）
    const newlyAwarded: number[] = [];
    const now = Date.now();
    const inPeriod = now >= Date.parse(mission.starts_at) && now <= Date.parse(mission.ends_at);
    if (inPeriod) {
      for (const stage of stagesToAward(stages, answers, invites, awardedNos)) {
        const recorded = await missionRepository.recordAward(mission.id, stage.stage_no, lineUserId);
        if (!recorded) continue; // 同時リクエストが先に記録済み
        await userPointService.awardPoints({
          lineUserId,
          transactionType: "campaign_bonus",
          points: stage.reward_points,
          reason: `${mission.name} ステージ${stage.stage_no}達成`,
          referenceType: "campaign",
          referenceId: mission.id,
          idempotencyKey: `campaign:${mission.id}:${lineUserId}:stage${stage.stage_no}`,
        });
        newlyAwarded.push(stage.stage_no);
        awardedNos.push(stage.stage_no);
      }
    }

    const views = buildStageViews(stages, answers, invites, awardedNos);
    const current = views.find((v) => v.state === "current");
    const currentDef = current ? stages.find((s) => s.stage_no === current.stageNo) : undefined;

    // 案件指定型のゲージ（実データがある案件だけ・D-14）
    let gauge: MissionPageData["gauge"] = null;
    if (mission.scope === "project" && mission.project_id) {
      const project = await projectRepository.getById(mission.project_id);
      const target = (project as { max_respondents?: number | null } | null)?.max_respondents ?? null;
      if (target && target > 0) {
        const currentCount = await missionRepository.countProjectCompleted(mission.project_id);
        const deadline = (project as { recruit_deadline?: string | null } | null)?.recruit_deadline ?? null;
        gauge = { current: Math.min(currentCount, target), target, deadline };
      }
    }

    // 部屋（category別）と隠し部屋（Phase 2残＋Phase 3）
    const { rooms, hiddenRoom } = await this.getRoomsAndHiddenRoom(mission, lineUserId);

    return {
      mission: { id: mission.id, name: mission.name, scope: mission.scope, ends_at: mission.ends_at },
      theme: resolveMissionTheme(mission.theme_key),
      answers,
      invites,
      stages: views,
      remaining: currentDef ? remainingForStage(currentDef, answers, invites) : null,
      newlyAwarded,
      gauge,
      rooms,
      hiddenRoom,
    };
  },

  /**
   * 部屋 = discoverable 案件を category で自動グルーピング（部屋テーブルは無い）。
   * 隠し部屋のカテゴリは通常部屋の一覧から除外する（先に見えたら隠しにならない）。
   */
  async getRoomsAndHiddenRoom(
    mission: Mission,
    lineUserId: string
  ): Promise<{ rooms: RoomView[]; hiddenRoom: HiddenRoomView | null }> {
    const hidden = await missionHiddenRoomService.getForMission(mission.id);
    const [projects, completedIds] = await Promise.all([
      projectRepository.listDiscoverable(),
      missionRepository.listCompletedProjectIds(lineUserId),
    ]);
    const rooms = buildRoomViews(
      projects.map((p) => ({
        id: p.id,
        category: ((p as unknown as Record<string, unknown>).category as string | null) ?? null,
      })),
      completedIds,
      hidden?.category ?? null
    );
    const hiddenRoom = hidden
      ? await missionHiddenRoomService.buildView(mission, countClearedRooms(rooms), lineUserId)
      : null;
    return { rooms, hiddenRoom };
  },

  /** 隠し部屋への入室（サーバー権威で open を再評価）。 */
  async enterHiddenRoom(missionId: string, lineUserId: string): Promise<{ category: string }> {
    const mission = await missionRepository.getById(missionId);
    if (!mission || !mission.is_active) throw new HttpError(404, "この企画は見つかりません。");
    const { rooms } = await this.getRoomsAndHiddenRoom(mission, lineUserId);
    return missionHiddenRoomService.enter(mission, countClearedRooms(rooms), lineUserId);
  },

  /** 招待セクション用: 自分の発行済み招待の一覧（リンク再表示・状態確認）。 */
  async listMyInvites(lineUserId: string) {
    const invites = await missionInviteRepository.listRecent(200);
    return invites
      .filter((i) => i.inviter_id === lineUserId)
      .map((i) => ({ id: i.id, token: i.token, status: i.status, created_at: i.created_at }));
  },

  // ---- 管理 ----

  async listForAdmin(): Promise<Array<Mission & { stageCount: number }>> {
    const missions = await missionRepository.list();
    const result: Array<Mission & { stageCount: number }> = [];
    for (const m of missions) {
      const stages = await missionRepository.listStages(m.id);
      result.push({ ...m, stageCount: stages.length });
    }
    return result;
  },

  async getForAdmin(id: string) {
    const mission = await missionRepository.getById(id);
    if (!mission) throw new HttpError(404, "ミッションが見つかりません。");
    const stages = await missionRepository.listStages(id);
    return { mission, stages };
  },

  async saveMission(input: {
    id: string | null;
    name: string;
    scope: "platform" | "project";
    project_id: string | null;
    theme_key: string;
    starts_at: string;
    ends_at: string;
    is_active: boolean;
    stages: MissionStageDef[];
  }): Promise<{ id: string; errors: string[] }> {
    const errors = validateStages(input.stages);
    if (input.scope === "project" && !input.project_id) {
      errors.push("案件指定型は対象案件が必須です。");
    }
    if (errors.length > 0) return { id: input.id ?? "", errors };

    const base = {
      name: input.name,
      scope: input.scope,
      project_id: input.scope === "project" ? input.project_id : null,
      theme_key: input.theme_key,
      starts_at: input.starts_at,
      ends_at: input.ends_at,
      is_active: input.is_active,
    };
    const mission = input.id
      ? await missionRepository.update(input.id, base)
      : await missionRepository.create(base);
    await missionRepository.replaceStages(
      mission.id,
      input.stages.map((s) => ({
        stage_no: s.stage_no,
        need_answers: s.need_answers,
        need_invites: s.need_invites,
        reward_points: s.reward_points,
        is_masked: s.is_masked,
      }))
    );
    return { id: mission.id, errors: [] };
  },
};
