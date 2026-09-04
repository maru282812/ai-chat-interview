import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";
import {
  pickRandomOpensAt,
  pickRaffleWinners,
  resolveHiddenRoomState,
  splitPerPerson,
  validateHiddenRoom,
  hiddenRoomIdempotencyKey,
  type HiddenAwardMode,
  type HiddenOpenMode,
  type HiddenRoomState,
} from "../lib/missionRooms";
import {
  missionHiddenRoomRepository,
  type HiddenRoomRow,
} from "../repositories/missionHiddenRoomRepository";
import type { Mission } from "../repositories/missionRepository";
import { userPointService } from "./userPointService";
import { lineMessagingService } from "./lineMessagingService";

/**
 * ミッション Phase 3: 隠し部屋（山分け・一律・抽選）。
 * 仕様: docs/spec-mission-phase23-rooms-hidden.md
 *
 * 法的設計条件はここと純関数で強制する:
 *   - 1人あたり min(2000, …) キャップ（splitPerPerson / DB CHECK の二重）
 *   - 抽選は 1人1口・等確率・seed 決定的（settle 再実行で当選者がブレない）
 *   - random は「いつ出るか」だけ（opens_at をクライアントに返さない）
 *   - 参加＝入室＋回答のみ。ポイント消費の配管は存在しない（賭博罪）
 */

async function notify(userId: string, text: string): Promise<void> {
  try {
    await lineMessagingService.push(userId, [{ type: "text", text }]);
  } catch (error) {
    logger.warn("hiddenRoom: LINE通知に失敗（付与は成立済み）", { userId, error: String(error) });
  }
}

const AWARD_REASON: Record<HiddenAwardMode, string> = {
  split: "隠し部屋（山分け）",
  flat: "隠し部屋",
  raffle: "隠し部屋（抽選）",
};

/** 画面に返す形。locked 中は額もカテゴリも返さない（??? はサーバー権威・stages と同じ思想）。 */
export interface HiddenRoomView {
  state: HiddenRoomState;
  awardMode: HiddenAwardMode;
  /** open 以降のみ（locked 中に部屋の中身を明かさない） */
  category: string | null;
  potPoints: number | null;
  flatPoints: number | null;
  prizePoints: number | null;
  winnersCount: number | null;
  hasEntered: boolean;
  /** 入室済みかつ部屋の案件を回答完了した（=山分け・抽選の参加資格あり） */
  qualified: boolean;
  /** settled 後の自分の受取額（未受取・落選は null） */
  myAwardPoints: number | null;
  /** このリクエストで flat が新規付与された（演出トリガー） */
  awardedNow: boolean;
  /** locked のヒント。random の opens_at は**絶対に含めない** */
  hint: {
    mode: HiddenOpenMode;
    roomsNeeded: number | null;
    roomsCleared: number;
    /** schedule のみ。random では null */
    opensAt: string | null;
    firstN: number | null;
  };
}

async function isQualified(room: HiddenRoomRow, lineUserId: string): Promise<boolean> {
  const entry = await missionHiddenRoomRepository.getEntry(room.id, lineUserId);
  if (!entry) return false;
  const projectIds = await missionHiddenRoomRepository.listProjectIdsByCategory(room.category);
  return missionHiddenRoomRepository.hasCompletedInProjects(lineUserId, projectIds, entry.entered_at);
}

export const missionHiddenRoomService = {
  /**
   * ミッションページ用のビュー。flat の資格成立はここで検出して即付与する
   * （ステージと同じ読み時評価。冪等は awards UNIQUE ＋ idempotency_key の二重）。
   */
  async buildView(
    mission: Mission,
    clearedRooms: number,
    lineUserId: string
  ): Promise<HiddenRoomView | null> {
    const room = await missionHiddenRoomRepository.getByMissionId(mission.id);
    if (!room) return null;

    const [entry, entryCount, existingAward] = await Promise.all([
      missionHiddenRoomRepository.getEntry(room.id, lineUserId),
      missionHiddenRoomRepository.countEntries(room.id),
      missionHiddenRoomRepository.getAward(room.id, lineUserId),
    ]);

    const state = resolveHiddenRoomState(room, {
      now: new Date(),
      missionStartsAt: mission.starts_at,
      missionEndsAt: mission.ends_at,
      clearedRooms,
      entryCount,
      hasEntered: Boolean(entry),
    });

    let qualified = false;
    let awardedNow = false;
    let myAwardPoints = existingAward?.points ?? null;

    if (entry && (state === "open" || state === "awaiting" || state === "settled")) {
      qualified = await isQualified(room, lineUserId);
    }

    // flat: 資格成立で即付与（期間内のみ）
    if (
      room.award_mode === "flat" &&
      state === "open" &&
      qualified &&
      !existingAward &&
      room.flat_points
    ) {
      const recorded = await missionHiddenRoomRepository.recordAward(
        room.id, lineUserId, room.flat_points, "flat"
      );
      if (recorded) {
        await userPointService.awardPoints({
          lineUserId,
          transactionType: "campaign_bonus",
          points: room.flat_points,
          reason: `${mission.name} ${AWARD_REASON.flat}`,
          referenceType: "campaign",
          referenceId: mission.id,
          idempotencyKey: hiddenRoomIdempotencyKey(room.id, lineUserId),
        });
        myAwardPoints = room.flat_points;
        awardedNow = true;
      }
    }

    const revealed = state === "open" || state === "awaiting" || state === "settled";
    return {
      state,
      awardMode: room.award_mode,
      category: revealed ? room.category : null,
      potPoints: revealed ? room.pot_points : null,
      flatPoints: revealed ? room.flat_points : null,
      prizePoints: revealed ? room.prize_points : null,
      winnersCount: revealed ? room.winners_count : null,
      hasEntered: Boolean(entry),
      qualified,
      myAwardPoints,
      awardedNow,
      hint: {
        mode: room.open_mode,
        roomsNeeded: room.rooms_needed,
        roomsCleared: clearedRooms,
        opensAt: room.open_mode === "schedule" ? room.opens_at : null,
        firstN: room.first_n,
      },
    };
  },

  /**
   * 入室。開いているかをサーバーで再評価してから記録する（R-4）。
   * 先着Nの境界は entries の UNIQUE＋COUNT で守る（同時入室で N+1 人目が滑り込む
   * 余地は COUNT の読みタイミング分だけ残るが、報酬は資格判定で締まるので実害は限定的）。
   */
  async enter(
    mission: Mission,
    clearedRooms: number,
    lineUserId: string
  ): Promise<{ category: string }> {
    const room = await missionHiddenRoomRepository.getByMissionId(mission.id);
    if (!room) throw new HttpError(404, "隠し部屋はありません。");

    const [entry, entryCount] = await Promise.all([
      missionHiddenRoomRepository.getEntry(room.id, lineUserId),
      missionHiddenRoomRepository.countEntries(room.id),
    ]);
    const state = resolveHiddenRoomState(room, {
      now: new Date(),
      missionStartsAt: mission.starts_at,
      missionEndsAt: mission.ends_at,
      clearedRooms,
      entryCount,
      hasEntered: Boolean(entry),
    });
    if (state === "full") throw new HttpError(409, "この部屋は満員になりました。");
    if (state !== "open") throw new HttpError(409, "この部屋はまだ開いていません。");

    await missionHiddenRoomRepository.addEntry(room.id, lineUserId);
    return { category: room.category };
  },

  /**
   * settle バッチ（cron から毎分呼ばれる）。終了済み・未確定の split / raffle を確定する。
   * 冪等: awards UNIQUE → awardPoints idempotency_key の二重。抽選は seed=部屋ID の
   * 決定的選出なので、途中クラッシュ→再実行でも当選者が変わらない。
   * 全付与が終わってから settled_at を立てる（途中で落ちたら次の分で再実行される）。
   */
  async runSettleDispatch(): Promise<{ settled: number; awarded: number }> {
    const rooms = await missionHiddenRoomRepository.listUnsettledEnded(new Date().toISOString());
    let settled = 0;
    let awarded = 0;

    for (const room of rooms) {
      const missionName = room.missions.name;
      const entries = await missionHiddenRoomRepository.listEntries(room.id);
      const projectIds = await missionHiddenRoomRepository.listProjectIdsByCategory(room.category);

      // 資格 = 入室後に部屋の案件を回答完了（仕事の報酬の枠に載せる）
      const qualifiedIds: string[] = [];
      for (const e of entries) {
        const ok = await missionHiddenRoomRepository.hasCompletedInProjects(
          e.line_user_id, projectIds, e.entered_at
        );
        if (ok) qualifiedIds.push(e.line_user_id);
      }

      let payouts: Array<{ userId: string; points: number }> = [];
      if (room.award_mode === "split" && room.pot_points) {
        const per = splitPerPerson(room.pot_points, qualifiedIds.length);
        if (per > 0) payouts = qualifiedIds.map((userId) => ({ userId, points: per }));
      } else if (room.award_mode === "raffle" && room.prize_points && room.winners_count) {
        payouts = pickRaffleWinners(qualifiedIds, room.winners_count, room.id).map((userId) => ({
          userId,
          points: room.prize_points as number,
        }));
      }

      for (const p of payouts) {
        const recorded = await missionHiddenRoomRepository.recordAward(
          room.id, p.userId, p.points, room.award_mode
        );
        if (!recorded) continue; // 前回の実行で付与済み
        await userPointService.awardPoints({
          lineUserId: p.userId,
          transactionType: "campaign_bonus",
          points: p.points,
          reason: `${missionName} ${AWARD_REASON[room.award_mode]}`,
          referenceType: "campaign",
          referenceId: room.mission_id,
          idempotencyKey: hiddenRoomIdempotencyKey(room.id, p.userId),
        });
        awarded += 1;
        await notify(
          p.userId,
          `「${missionName}」の隠し部屋の結果が出ました！ ${p.points}pt を受け取りました。`
        );
      }

      await missionHiddenRoomRepository.markSettled(room.id);
      settled += 1;
      logger.info("hiddenRoom: settled", {
        roomId: room.id, mode: room.award_mode,
        entries: entries.length, qualified: qualifiedIds.length, payouts: payouts.length,
      });
    }
    return { settled, awarded };
  },

  // ---- 管理 ----

  /**
   * 管理画面の保存。random の「いつ出るか」はここで乱数確定する。
   * すでに random で opens_at が決まっている場合は**振り直さない**
   * （保存のたびに変わると「全員に同じ時刻」が守れない）。
   */
  async saveForMission(input: {
    missionId: string;
    missionStartsAt: string;
    missionEndsAt: string;
    enabled: boolean;
    category: string;
    open_mode: HiddenOpenMode;
    rooms_needed: number | null;
    opens_at: string | null;
    closes_at: string | null;
    first_n: number | null;
    award_mode: HiddenAwardMode;
    pot_points: number | null;
    flat_points: number | null;
    prize_points: number | null;
    winners_count: number | null;
  }): Promise<string[]> {
    if (!input.enabled) {
      await missionHiddenRoomRepository.deactivateForMission(input.missionId);
      return [];
    }
    const errors = validateHiddenRoom(input);
    if (errors.length > 0) return errors;

    let opensAt = input.opens_at;
    if (input.open_mode === "random") {
      const existing = await missionHiddenRoomRepository.getByMissionId(input.missionId);
      opensAt =
        existing?.open_mode === "random" && existing.opens_at
          ? existing.opens_at
          : pickRandomOpensAt(input.missionStartsAt, input.missionEndsAt, new Date());
    }

    await missionHiddenRoomRepository.upsertForMission({
      mission_id: input.missionId,
      category: input.category.trim(),
      open_mode: input.open_mode,
      rooms_needed: input.open_mode === "rooms_cleared" ? input.rooms_needed : null,
      opens_at: input.open_mode === "schedule" || input.open_mode === "random" ? opensAt : null,
      closes_at: input.open_mode === "schedule" ? input.closes_at : null,
      first_n: input.open_mode === "first_n" ? input.first_n : null,
      award_mode: input.award_mode,
      pot_points: input.award_mode === "split" ? input.pot_points : null,
      flat_points: input.award_mode === "flat" ? input.flat_points : null,
      prize_points: input.award_mode === "raffle" ? input.prize_points : null,
      winners_count: input.award_mode === "raffle" ? input.winners_count : null,
    });
    return [];
  },

  /** 管理画面の表示用。 */
  async getForMission(missionId: string): Promise<HiddenRoomRow | null> {
    return missionHiddenRoomRepository.getByMissionId(missionId);
  },
};
