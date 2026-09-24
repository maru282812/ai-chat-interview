/**
 * missionRooms.ts — 部屋（category別）と隠し部屋の純関数（Migration 099）
 * 仕様: docs/spec-mission-phase23-rooms-hidden.md
 *
 * DB を触らないロジックだけをここに集める（missionInvite.ts / missionStage.ts と同じ思想）。
 * 特に隠し部屋はポイント（現金同等物）が動くうえ景表法の設計条件をコードで強制する場所なので、
 * 実DBなしでテストできる状態を保つ。
 *
 * 法的設計条件（requirements/legal-premium-act.md / D-16 / D-17 / D-19）:
 *   - 全報酬 1人あたり上限 2,000pt（PER_PERSON_CAP）
 *   - 抽選は 1人1口・等確率。「回答が多いほど当たりやすい」の配管を作らない
 *   - ランダムは「いつ出るか」だけ。中身（額）は全員同じ・ハズレなし
 *   - ポイントを消費して参加する形は存在してはならない（賭博罪）
 */

import crypto from "node:crypto";
import { PER_PERSON_CAP } from "./missionInvite";

// ------------------------------------------------------------------
// 部屋（category 別グルーピング）
// ------------------------------------------------------------------

export interface RoomProjectInput {
  id: string;
  category: string | null;
}

export interface RoomView {
  category: string;
  /** 部屋の案件数 */
  total: number;
  /** 自分が回答完了した数 */
  answered: number;
  remaining: number;
  cleared: boolean;
}

/**
 * discoverable 案件を category で部屋に束ねる。
 * - category 未設定の案件は部屋にしない（「その他」部屋を捏造しない）
 * - 0件の部屋はそもそも生成されない（空部屋を見せると過疎に見える）
 * - excludeCategory は隠し部屋のカテゴリ（通常部屋として見せたら隠しにならない）
 * 並び: 未クリア（残りが少ない順＝あと少しが先頭）→ クリア済み。
 */
export function buildRoomViews(
  projects: readonly RoomProjectInput[],
  completedProjectIds: ReadonlySet<string>,
  excludeCategory?: string | null
): RoomView[] {
  const byCategory = new Map<string, { total: number; answered: number }>();
  for (const p of projects) {
    const cat = (p.category ?? "").trim();
    if (!cat || cat === excludeCategory) continue;
    const room = byCategory.get(cat) ?? { total: 0, answered: 0 };
    room.total += 1;
    if (completedProjectIds.has(p.id)) room.answered += 1;
    byCategory.set(cat, room);
  }
  const rooms = [...byCategory.entries()].map(([category, r]) => ({
    category,
    total: r.total,
    answered: r.answered,
    remaining: r.total - r.answered,
    cleared: r.total > 0 && r.answered >= r.total,
  }));
  return rooms.sort((a, b) => {
    if (a.cleared !== b.cleared) return a.cleared ? 1 : -1;
    if (a.remaining !== b.remaining) return a.remaining - b.remaining;
    return a.category.localeCompare(b.category, "ja");
  });
}

export function countClearedRooms(rooms: readonly RoomView[]): number {
  return rooms.filter((r) => r.cleared).length;
}

// ------------------------------------------------------------------
// 隠し部屋の状態機械
// ------------------------------------------------------------------

export type HiddenOpenMode = "rooms_cleared" | "schedule" | "first_n" | "random";
export type HiddenAwardMode = "split" | "flat" | "raffle";

export interface HiddenRoomDef {
  open_mode: HiddenOpenMode;
  /** rooms_cleared: 必要クリア部屋数 */
  rooms_needed: number | null;
  /** schedule / random: 開く時刻（random は保存時に乱数確定済み） */
  opens_at: string | null;
  closes_at: string | null;
  /** first_n: 入室できる人数 */
  first_n: number | null;
  award_mode: HiddenAwardMode;
  pot_points: number | null;
  flat_points: number | null;
  prize_points: number | null;
  winners_count: number | null;
  settled_at: string | null;
}

export type HiddenRoomState =
  /** まだ開いていない（開き方のヒントを出す） */
  | "locked"
  /** 先着枠が埋まった（自分は入れない） */
  | "full"
  /** 開いている（入室・回答できる） */
  | "open"
  /** ミッション終了・結果待ち（split / raffle） */
  | "awaiting"
  /** 結果確定済み */
  | "settled";

export interface HiddenRoomContext {
  now: Date;
  missionStartsAt: string;
  missionEndsAt: string;
  /** 自分のクリア部屋数（rooms_cleared 用） */
  clearedRooms: number;
  /** 入室者数（first_n 用） */
  entryCount: number;
  hasEntered: boolean;
}

/**
 * 隠し部屋のいまの状態。判定はサーバー権威（R-4）——この結果を入室APIでも再評価する。
 */
export function resolveHiddenRoomState(def: HiddenRoomDef, ctx: HiddenRoomContext): HiddenRoomState {
  if (def.settled_at) return "settled";
  const now = ctx.now.getTime();
  if (now > Date.parse(ctx.missionEndsAt)) {
    // flat は読み時付与で完結しているので結果待ちがない
    return def.award_mode === "flat" ? "settled" : "awaiting";
  }
  switch (def.open_mode) {
    case "rooms_cleared":
      return ctx.clearedRooms >= (def.rooms_needed ?? 1) ? "open" : "locked";
    case "schedule":
    case "random": {
      if (!def.opens_at || now < Date.parse(def.opens_at)) return "locked";
      const closes = def.closes_at ? Date.parse(def.closes_at) : Date.parse(ctx.missionEndsAt);
      return now <= closes ? "open" : "awaiting";
    }
    case "first_n": {
      if (ctx.hasEntered) return "open";
      return ctx.entryCount < (def.first_n ?? 0) ? "open" : "full";
    }
  }
}

/**
 * random モードの「いつ出るか」を保存時に確定する。
 * 開いている時間が最低 minOpenMs 残る範囲で一様乱数。期間が短ければ即開く。
 * ⚠ 乱数はここ（サーバー・保存時）だけ。以後は opens_at 固定＝全員に同じ時刻・同じ中身。
 */
export function pickRandomOpensAt(
  startsAt: string,
  endsAt: string,
  now: Date,
  random: () => number = Math.random,
  minOpenMs: number = 24 * 60 * 60 * 1000
): string {
  const from = Math.max(Date.parse(startsAt), now.getTime());
  const to = Date.parse(endsAt) - minOpenMs;
  if (to <= from) return new Date(from).toISOString();
  return new Date(from + Math.floor(random() * (to - from))).toISOString();
}

// ------------------------------------------------------------------
// 山分け・抽選（キャップは構造で強制）
// ------------------------------------------------------------------

/**
 * 山分けの1人あたり。**必ず PER_PERSON_CAP でキャップ**（D-16。
 * 「少人数ほど有利」は上限を制御できない、が景表法調査の結論）。
 */
export function splitPerPerson(potPoints: number, participantCount: number): number {
  if (participantCount <= 0 || potPoints <= 0) return 0;
  return Math.min(PER_PERSON_CAP, Math.floor(potPoints / participantCount));
}

/**
 * 抽選の当選者選出。1人1口・等確率（D-17）。
 * seed から決定的に選ぶ＝settle バッチが途中で落ちて再実行されても当選者がブレない
 * （ブレると冪等キーが別人に付与して二重原資になる）。
 * sha256(seed:userId) を並べ替えキーにする＝seed を知らない限り予測不能・全員等確率。
 */
export function pickRaffleWinners(
  userIds: readonly string[],
  winnersCount: number,
  seed: string
): string[] {
  if (winnersCount <= 0) return [];
  const unique = [...new Set(userIds)];
  return unique
    .map((id) => ({
      id,
      key: crypto.createHash("sha256").update(`${seed}:${id}`).digest("hex"),
    }))
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .slice(0, winnersCount)
    .map((w) => w.id);
}

// ------------------------------------------------------------------
// 管理画面のバリデーション
// ------------------------------------------------------------------

/** 隠し部屋設定の検証。額の上限は DB CHECK と二重（stages の validateStages と同じ流儀）。 */
export function validateHiddenRoom(def: {
  category: string;
  open_mode: HiddenOpenMode;
  rooms_needed: number | null;
  opens_at: string | null;
  first_n: number | null;
  award_mode: HiddenAwardMode;
  pot_points: number | null;
  flat_points: number | null;
  prize_points: number | null;
  winners_count: number | null;
}): string[] {
  const errors: string[] = [];
  if (!def.category.trim()) errors.push("隠し部屋: カテゴリは必須です。");

  if (def.open_mode === "rooms_cleared" && !(def.rooms_needed && def.rooms_needed >= 1)) {
    errors.push("隠し部屋: 必要クリア部屋数は1以上にしてください。");
  }
  if (def.open_mode === "schedule" && !def.opens_at) {
    errors.push("隠し部屋: 開く日時を指定してください。");
  }
  if (def.open_mode === "first_n" && !(def.first_n && def.first_n >= 1)) {
    errors.push("隠し部屋: 先着人数は1以上にしてください。");
  }

  if (def.award_mode === "split") {
    if (!(def.pot_points && def.pot_points > 0)) errors.push("隠し部屋: 山分けの原資ptは1以上にしてください。");
  } else if (def.award_mode === "flat") {
    if (!(def.flat_points && def.flat_points > 0)) errors.push("隠し部屋: 一律付与ptは1以上にしてください。");
    if ((def.flat_points ?? 0) > PER_PERSON_CAP) {
      errors.push(`隠し部屋: 一律付与は上限 ${PER_PERSON_CAP}pt までです（景表法対応）。`);
    }
  } else if (def.award_mode === "raffle") {
    if (!(def.prize_points && def.prize_points > 0)) errors.push("隠し部屋: 当選ptは1以上にしてください。");
    if ((def.prize_points ?? 0) > PER_PERSON_CAP) {
      errors.push(`隠し部屋: 当選ptは上限 ${PER_PERSON_CAP}pt までです（景表法対応）。`);
    }
    if (!(def.winners_count && def.winners_count >= 1)) {
      errors.push("隠し部屋: 当選人数は1以上にしてください。");
    }
  }
  return errors;
}

/** settle バッチの冪等キー（awardPoints 用）。 */
export const hiddenRoomIdempotencyKey = (roomId: string, userId: string): string =>
  `hidden:${roomId}:${userId}`;
