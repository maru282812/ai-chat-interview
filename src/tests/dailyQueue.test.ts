import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  decideSlotDelivery,
  jstDateString,
  jstEndOfDayIso,
  previewQueueAssignments,
  queuePositions,
  slotKey,
  type SlotDecisionInput,
} from "../lib/dailyQueue";

function input(overrides: Partial<SlotDecisionInput> = {}): SlotDecisionInput {
  return {
    slot: "morning",
    occupant: null,
    queueHeadId: null,
    eveningAutofillEnabled: false,
    ...overrides,
  };
}

// ------------------------------------------------------------------
// スロット配信の判定
// ------------------------------------------------------------------

test("朝枠: キュー先頭を自動補充する（何もしなければ1日1件）", () => {
  const d = decideSlotDelivery(input({ slot: "morning", queueHeadId: "s1" }));
  assert.deepEqual(d, { action: "deliver", surveyId: "s1", source: "queue" });
});

test("朝枠: キューが空なら何も配信しない", () => {
  const d = decideSlotDelivery(input({ slot: "morning", queueHeadId: null }));
  assert.deepEqual(d, { action: "noop", reason: "queue-empty" });
});

test("夜枠: autofill が無効ならキューがあっても配信しない", () => {
  const d = decideSlotDelivery(
    input({ slot: "evening", queueHeadId: "s1", eveningAutofillEnabled: false }),
  );
  assert.deepEqual(d, { action: "noop", reason: "autofill-disabled" });
});

test("夜枠: autofill が有効ならキュー先頭を配信する（1日2件）", () => {
  const d = decideSlotDelivery(
    input({ slot: "evening", queueHeadId: "s2", eveningAutofillEnabled: true }),
  );
  assert.deepEqual(d, { action: "deliver", surveyId: "s2", source: "queue" });
});

test("日付固定はキューより優先される", () => {
  const d = decideSlotDelivery(
    input({ occupant: { id: "fixed", status: "scheduled" }, queueHeadId: "s1" }),
  );
  assert.deepEqual(d, { action: "deliver", surveyId: "fixed", source: "scheduled" });
});

test("夜枠に日付固定があれば autofill 無効でも配信する", () => {
  const d = decideSlotDelivery(
    input({
      slot: "evening",
      occupant: { id: "fixed", status: "scheduled" },
      eveningAutofillEnabled: false,
    }),
  );
  assert.deepEqual(d, { action: "deliver", surveyId: "fixed", source: "scheduled" });
});

test("当日の active はキャッチアップ再実行のため deliver を返す（未送信者だけに届く）", () => {
  const d = decideSlotDelivery(input({ occupant: { id: "s1", status: "active" } }));
  assert.deepEqual(d, { action: "deliver", surveyId: "s1", source: "scheduled" });
});

test("completed / paused の枠は何もしない（毎日の再配信を止める）", () => {
  assert.deepEqual(decideSlotDelivery(input({ occupant: { id: "s1", status: "completed" } })), {
    action: "noop",
    reason: "already-completed",
  });
  assert.deepEqual(decideSlotDelivery(input({ occupant: { id: "s1", status: "paused" } })), {
    action: "noop",
    reason: "paused",
  });
});

// ------------------------------------------------------------------
// カレンダーの予測
// ------------------------------------------------------------------

test("予測: 朝だけなら 1 日 1 件ずつキューを消費する", () => {
  const p = previewQueueAssignments({
    startDate: "2026-07-14",
    days: 3,
    queueIds: ["a", "b", "c"],
    occupiedSlots: new Set(),
    eveningAutofillEnabled: false,
  });
  assert.equal(p.get(slotKey("2026-07-14", "morning")), "a");
  assert.equal(p.get(slotKey("2026-07-15", "morning")), "b");
  assert.equal(p.get(slotKey("2026-07-16", "morning")), "c");
  assert.equal(p.has(slotKey("2026-07-14", "evening")), false);
});

test("予測: autofill 有効なら朝→夜の順に 1 日 2 件消費する", () => {
  const p = previewQueueAssignments({
    startDate: "2026-07-14",
    days: 3,
    queueIds: ["a", "b", "c"],
    occupiedSlots: new Set(),
    eveningAutofillEnabled: true,
  });
  assert.equal(p.get(slotKey("2026-07-14", "morning")), "a");
  assert.equal(p.get(slotKey("2026-07-14", "evening")), "b");
  assert.equal(p.get(slotKey("2026-07-15", "morning")), "c");
  assert.equal(p.size, 3);
});

test("予測: 日付固定済みの枠は飛ばす（キューを消費しない）", () => {
  const p = previewQueueAssignments({
    startDate: "2026-07-14",
    days: 3,
    queueIds: ["a", "b"],
    occupiedSlots: new Set([slotKey("2026-07-14", "morning")]),
    eveningAutofillEnabled: false,
  });
  assert.equal(p.has(slotKey("2026-07-14", "morning")), false);
  assert.equal(p.get(slotKey("2026-07-15", "morning")), "a");
  assert.equal(p.get(slotKey("2026-07-16", "morning")), "b");
});

test("予測: キューが空なら何も入らない", () => {
  const p = previewQueueAssignments({
    startDate: "2026-07-14",
    days: 30,
    queueIds: [],
    occupiedSlots: new Set(),
    eveningAutofillEnabled: true,
  });
  assert.equal(p.size, 0);
});

// ------------------------------------------------------------------
// 日付ヘルパ / キュー順序
// ------------------------------------------------------------------

test("jstDateString: UTC 15:00 は JST の翌日", () => {
  assert.equal(jstDateString(new Date("2026-07-14T15:00:00Z")), "2026-07-15");
  assert.equal(jstDateString(new Date("2026-07-14T14:59:00Z")), "2026-07-14");
});

test("jstEndOfDayIso: JST 23:59:59.999 は UTC 14:59:59.999", () => {
  assert.equal(jstEndOfDayIso("2026-07-14"), "2026-07-14T14:59:59.999Z");
});

test("addDays: 月をまたぐ", () => {
  assert.equal(addDays("2026-07-31", 1), "2026-08-01");
  assert.equal(addDays("2026-08-01", -1), "2026-07-31");
});

test("queuePositions: 10 刻みで振る", () => {
  assert.deepEqual(queuePositions(["a", "b", "c"]), [
    { id: "a", queue_position: 10 },
    { id: "b", queue_position: 20 },
    { id: "c", queue_position: 30 },
  ]);
});
