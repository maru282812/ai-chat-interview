/**
 * cycleFunnel.test.ts
 *
 * 離脱率の集計（Migration 093）。
 *
 * ここが狂うと「離脱率が下がった」と誤読して施策判断を間違えるので、
 * 特に「分母に何を入れるか」を厳しく固定する。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  classifyCycle,
  formatChurnRate,
  summarizeByCycleNo,
  summarizeCycles,
  type CycleFunnelInput,
} from "../lib/cycleFunnel";

const NOW = new Date("2026-08-01T00:00:00.000Z");
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

const cyc = (over: Partial<CycleFunnelInput> = {}): CycleFunnelInput => ({
  id: "c",
  cycle_no: 1,
  expected_return_at: addDays(NOW, -1).toISOString(),
  returned_at: null,
  followup_sent_at: null,
  closed_at: null,
  close_reason: null,
  ...over,
});

// ------------------------------------------------------------------
// 1周の判定
// ------------------------------------------------------------------

test("再来店した周は returned", () => {
  assert.equal(classifyCycle(cyc({ returned_at: NOW.toISOString() }), NOW), "returned");
});

test("期限を過ぎて再来店が無ければ churned", () => {
  assert.equal(classifyCycle(cyc(), NOW), "churned");
});

test("期限前はまだ判定できない（pending）", () => {
  assert.equal(classifyCycle(cyc({ expected_return_at: addDays(NOW, 5).toISOString() }), NOW), "pending");
});

test("頻度が取れず期限が無い周は unknown", () => {
  assert.equal(classifyCycle(cyc({ expected_return_at: null }), NOW), "unknown");
});

test("期限を過ぎていても再来店が優先される（順序が逆転しない）", () => {
  const late = cyc({
    expected_return_at: addDays(NOW, -30).toISOString(),
    returned_at: addDays(NOW, -1).toISOString(),
  });
  assert.equal(classifyCycle(late, NOW), "returned");
});

test("C を送ったかどうかは判定に影響しない（C は判定材料ではない）", () => {
  const sent = cyc({ followup_sent_at: NOW.toISOString() });
  const notSent = cyc({ followup_sent_at: null });
  assert.equal(classifyCycle(sent, NOW), classifyCycle(notSent, NOW));
});

// ------------------------------------------------------------------
// 集計（分母の定義）
// ------------------------------------------------------------------

test("離脱率の分母は「判定が確定した周」だけ", () => {
  const summary = summarizeCycles(
    [
      cyc({ returned_at: NOW.toISOString() }),                          // returned
      cyc(),                                                            // churned
      cyc({ expected_return_at: addDays(NOW, 10).toISOString() }),      // pending（分母外）
      cyc({ expected_return_at: null }),                                // unknown（分母外）
    ],
    NOW
  );

  assert.equal(summary.returned, 1);
  assert.equal(summary.churned, 1);
  assert.equal(summary.pending, 1);
  assert.equal(summary.unknown, 1);
  assert.equal(summary.decided, 2, "pending / unknown を分母に入れてはいけない");
  assert.equal(summary.churnRate, 0.5);
});

test("未確定ばかりのとき離脱率は null（0%と区別する）", () => {
  const summary = summarizeCycles(
    [cyc({ expected_return_at: addDays(NOW, 10).toISOString() }), cyc({ expected_return_at: null })],
    NOW
  );
  assert.equal(summary.decided, 0);
  assert.equal(summary.churnRate, null, "データが無いことを 0% と偽ってはいけない");
});

test("全員離脱なら100%、全員再来店なら0%", () => {
  assert.equal(summarizeCycles([cyc(), cyc()], NOW).churnRate, 1);
  assert.equal(
    summarizeCycles([cyc({ returned_at: NOW.toISOString() })], NOW).churnRate,
    0
  );
});

test("空配列でも壊れない", () => {
  const summary = summarizeCycles([], NOW);
  assert.equal(summary.decided, 0);
  assert.equal(summary.churnRate, null);
});

// ------------------------------------------------------------------
// 周回別
// ------------------------------------------------------------------

test("周回ごとに離脱率を出し、cycle_no 昇順で返す", () => {
  const rows = summarizeByCycleNo(
    [
      cyc({ cycle_no: 2, returned_at: NOW.toISOString() }),
      cyc({ cycle_no: 1 }),
      cyc({ cycle_no: 1, returned_at: NOW.toISOString() }),
      cyc({ cycle_no: 2, returned_at: NOW.toISOString() }),
    ],
    NOW
  );

  assert.deepEqual(rows.map((r) => r.cycleNo), [1, 2]);
  assert.equal(rows[0]?.summary.churnRate, 0.5, "1周目は 1/2 が離脱");
  assert.equal(rows[1]?.summary.churnRate, 0, "2周目は定着している");
});

// ------------------------------------------------------------------
// 表示
// ------------------------------------------------------------------

test("表示は小数1桁、分母0は — と出す", () => {
  assert.equal(formatChurnRate(0.5), "50.0%");
  assert.equal(formatChurnRate(0.333), "33.3%");
  assert.equal(formatChurnRate(0), "0.0%");
  assert.equal(formatChurnRate(null), "—");
});
