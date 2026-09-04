/**
 * 部屋・隠し部屋の純関数テスト（DB不要）
 *
 * 確認項目:
 * 1. 部屋: category 自動グルーピング・0件部屋は生成されない・隠しカテゴリ除外・クリア判定
 * 2. 状態機械: 4つの開き方（クリア数/日時/先着/ランダム）と awaiting/settled への遷移
 * 3. 山分け: **必ず 2,000pt キャップ**（少人数で上限超えしない・D-16）・0人で0
 * 4. 抽選: 1人1口・決定的（同じ seed で同じ当選者＝settle 再実行でブレない・D-17）
 * 5. バリデーション: モード別必須・額の上限
 */

import assert from "node:assert/strict";
import test from "node:test";
import { PER_PERSON_CAP } from "../lib/missionInvite";
import {
  buildRoomViews,
  countClearedRooms,
  resolveHiddenRoomState,
  pickRandomOpensAt,
  splitPerPerson,
  pickRaffleWinners,
  validateHiddenRoom,
  type HiddenRoomDef,
  type HiddenRoomContext,
} from "../lib/missionRooms";

// ---- 部屋 ----

const PROJECTS = [
  { id: "p1", category: "たべもの" },
  { id: "p2", category: "たべもの" },
  { id: "p3", category: "くらし" },
  { id: "p4", category: null },      // category 無し→部屋にしない
  { id: "p5", category: "  " },      // 空白のみ→部屋にしない
  { id: "p6", category: "ひみつ" },  // 隠し部屋カテゴリ
];

test("部屋: categoryで束ね、未設定は部屋にせず、隠しカテゴリは除外する", () => {
  const rooms = buildRoomViews(PROJECTS, new Set(["p1"]), "ひみつ");
  assert.deepEqual(rooms.map((r) => r.category).sort(), ["くらし", "たべもの"]);
  const tabemono = rooms.find((r) => r.category === "たべもの")!;
  assert.equal(tabemono.total, 2);
  assert.equal(tabemono.answered, 1);
  assert.equal(tabemono.remaining, 1);
  assert.equal(tabemono.cleared, false);
});

test("部屋: 全案件回答でクリア・クリア済みは後ろに並ぶ", () => {
  const rooms = buildRoomViews(PROJECTS, new Set(["p1", "p2"]), "ひみつ");
  assert.equal(rooms.find((r) => r.category === "たべもの")!.cleared, true);
  assert.equal(rooms[rooms.length - 1]!.category, "たべもの"); // クリア済みが末尾
  assert.equal(countClearedRooms(rooms), 1);
});

// ---- 隠し部屋の状態機械 ----

const BASE_DEF: HiddenRoomDef = {
  open_mode: "rooms_cleared",
  rooms_needed: 2,
  opens_at: null,
  closes_at: null,
  first_n: null,
  award_mode: "split",
  pot_points: 50000,
  flat_points: null,
  prize_points: null,
  winners_count: null,
  settled_at: null,
};

const BASE_CTX: HiddenRoomContext = {
  now: new Date("2026-09-10T00:00:00Z"),
  missionStartsAt: "2026-09-01T00:00:00Z",
  missionEndsAt: "2026-09-30T00:00:00Z",
  clearedRooms: 0,
  entryCount: 0,
  hasEntered: false,
};

test("rooms_cleared: クリア数が足りるまで locked", () => {
  assert.equal(resolveHiddenRoomState(BASE_DEF, { ...BASE_CTX, clearedRooms: 1 }), "locked");
  assert.equal(resolveHiddenRoomState(BASE_DEF, { ...BASE_CTX, clearedRooms: 2 }), "open");
});

test("schedule/random: opens_at 前は locked・後は open・closes_at 超えは awaiting", () => {
  const def: HiddenRoomDef = {
    ...BASE_DEF, open_mode: "schedule",
    opens_at: "2026-09-12T11:00:00Z", closes_at: "2026-09-14T11:00:00Z",
  };
  assert.equal(resolveHiddenRoomState(def, BASE_CTX), "locked");
  assert.equal(resolveHiddenRoomState(def, { ...BASE_CTX, now: new Date("2026-09-13T00:00:00Z") }), "open");
  assert.equal(resolveHiddenRoomState(def, { ...BASE_CTX, now: new Date("2026-09-15T00:00:00Z") }), "awaiting");
});

test("first_n: 枠が埋まると full・入室済みなら open のまま", () => {
  const def: HiddenRoomDef = { ...BASE_DEF, open_mode: "first_n", first_n: 100 };
  assert.equal(resolveHiddenRoomState(def, { ...BASE_CTX, entryCount: 99 }), "open");
  assert.equal(resolveHiddenRoomState(def, { ...BASE_CTX, entryCount: 100 }), "full");
  assert.equal(resolveHiddenRoomState(def, { ...BASE_CTX, entryCount: 100, hasEntered: true }), "open");
});

test("終了後: split/raffle は awaiting・flat は settled・settled_at 済みは settled", () => {
  const after = { ...BASE_CTX, now: new Date("2026-10-01T00:00:00Z") };
  assert.equal(resolveHiddenRoomState(BASE_DEF, after), "awaiting");
  assert.equal(
    resolveHiddenRoomState({ ...BASE_DEF, award_mode: "flat", flat_points: 500 }, after),
    "settled"
  );
  assert.equal(
    resolveHiddenRoomState({ ...BASE_DEF, settled_at: "2026-10-01T01:00:00Z" }, after),
    "settled"
  );
});

test("random: 開く時刻は期間内・期間が短ければ即時", () => {
  const opensAt = pickRandomOpensAt(
    "2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z",
    new Date("2026-09-05T00:00:00Z"), () => 0.5
  );
  const t = Date.parse(opensAt);
  assert.ok(t >= Date.parse("2026-09-05T00:00:00Z"));
  assert.ok(t <= Date.parse("2026-09-29T00:00:00Z")); // 最低24hは開く
  // 期間が24h未満→ now 即時
  const tight = pickRandomOpensAt(
    "2026-09-01T00:00:00Z", "2026-09-05T10:00:00Z", new Date("2026-09-05T00:00:00Z")
  );
  assert.equal(tight, new Date("2026-09-05T00:00:00Z").toISOString());
});

// ---- 山分け ----

test("山分け: 必ず2,000ptキャップ（10人で50,000ptでも5,000にならない）", () => {
  assert.equal(splitPerPerson(50000, 10), PER_PERSON_CAP); // 生の割り算は5,000
  assert.equal(splitPerPerson(50000, 100), 500);
  assert.equal(splitPerPerson(50000, 33), Math.floor(50000 / 33));
});

test("山分け: 0人・0原資は0（ゼロ除算しない）", () => {
  assert.equal(splitPerPerson(50000, 0), 0);
  assert.equal(splitPerPerson(0, 10), 0);
});

// ---- 抽選 ----

test("抽選: 同じseedなら同じ当選者（settle再実行でブレない）・人数上限・重複ID排除", () => {
  const users = ["u1", "u2", "u3", "u4", "u5", "u2"];
  const a = pickRaffleWinners(users, 2, "room-1");
  const b = pickRaffleWinners(users, 2, "room-1");
  assert.deepEqual(a, b);
  assert.equal(a.length, 2);
  assert.equal(new Set(a).size, 2);
  // seed が違えば（高確率で）並びが変わることの確認は決定性テストに留める
  assert.deepEqual(pickRaffleWinners(users, 10, "room-1").length, 5); // 母数まで
  assert.deepEqual(pickRaffleWinners(users, 0, "room-1"), []);
});

// ---- バリデーション ----

test("バリデーション: モード別必須と額の上限", () => {
  const ok = validateHiddenRoom({
    category: "ひみつ", open_mode: "rooms_cleared", rooms_needed: 2,
    opens_at: null, first_n: null,
    award_mode: "split", pot_points: 50000, flat_points: null, prize_points: null, winners_count: null,
  });
  assert.deepEqual(ok, []);

  assert.ok(validateHiddenRoom({
    category: "", open_mode: "schedule", rooms_needed: null, opens_at: null, first_n: null,
    award_mode: "flat", pot_points: null, flat_points: 2001, prize_points: null, winners_count: null,
  }).length >= 3); // カテゴリ必須・opens_at必須・flat上限超え

  assert.ok(validateHiddenRoom({
    category: "ひみつ", open_mode: "first_n", rooms_needed: null, opens_at: null, first_n: 0,
    award_mode: "raffle", pot_points: null, flat_points: null, prize_points: 3000, winners_count: 0,
  }).length >= 3); // 先着1以上・当選pt上限・当選人数1以上
});
