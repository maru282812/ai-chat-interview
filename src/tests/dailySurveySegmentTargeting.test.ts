import assert from "node:assert/strict";
import { test } from "node:test";
import { intersectDeliveryTargets } from "../lib/dailyQueue";
import { findUnsupportedSegmentFields } from "../controllers/adminController";

/**
 * デイリーアンケートのセグメント絞り込み。
 *
 * 修正前の resolveTargetUsers は target_segment_id を読んでいながら分岐の中身が
 * 母集団クエリと同一で、「特定セグメント向け」のつもりのデイリーアンケートが
 * 通知可ユーザー全員への一斉配信になっていた（cron 経由だと気づく前に飛ぶ）。
 *
 * ここでは配信対象の確定ロジックと、絞れない条件を検出するガードを固定する。
 */

const NOTIFIABLE = ["U_alice", "U_bob", "U_carol"];

// ------------------------------------------------------------------
// 配信対象の確定
// ------------------------------------------------------------------

test("セグメント未指定なら通知可ユーザー全員が対象", () => {
  assert.deepEqual(intersectDeliveryTargets(NOTIFIABLE, null), NOTIFIABLE);
});

test("セグメント指定時は一致した人だけに絞られる（全員配信にならない）", () => {
  const ids = intersectDeliveryTargets(NOTIFIABLE, new Set(["U_bob"]));
  assert.deepEqual(ids, ["U_bob"]);
});

test("セグメントに一致しても通知不可の人は対象外（母集団の条件が優先）", () => {
  // 評価器は notification_ok / is_notification_stopped を見ないので、
  // 母集団に居ない U_dave はここで必ず落ちる必要がある。
  const ids = intersectDeliveryTargets(NOTIFIABLE, new Set(["U_bob", "U_dave"]));
  assert.deepEqual(ids, ["U_bob"]);
});

test("一致者ゼロなら誰にも配信しない（空集合が全員配信に化けない）", () => {
  assert.deepEqual(intersectDeliveryTargets(NOTIFIABLE, new Set()), []);
});

test("母集団が空なら誰にも配信しない", () => {
  assert.deepEqual(intersectDeliveryTargets([], new Set(["U_bob"])), []);
});

test("元の母集団を破壊しない", () => {
  const src = [...NOTIFIABLE];
  intersectDeliveryTargets(src, new Set(["U_bob"]));
  assert.deepEqual(src, NOTIFIABLE);
});

// ------------------------------------------------------------------
// 絞れない条件のガード（fail-closed）
// ------------------------------------------------------------------

test("対応済みの条件だけなら未対応項目は検出されない", () => {
  const unsupported = findUnsupportedSegmentFields({
    operator: "AND",
    groups: [
      {
        operator: "AND",
        conditions: [
          { field: "gender", op: "eq", value: "female" },
          { field: "total_points", op: "gte", value: 100 },
        ],
      },
    ],
  });
  assert.deepEqual(unsupported, []);
});

test("評価器が解釈できない項目は検出される（黙って無視して全員配信しないため）", () => {
  const unsupported = findUnsupportedSegmentFields({
    operator: "AND",
    groups: [
      {
        operator: "AND",
        conditions: [
          { field: "gender", op: "eq", value: "female" },
          { field: "favorite_color", op: "eq", value: "blue" },
        ],
      },
    ],
  });
  assert.deepEqual(unsupported, ["favorite_color"]);
});
