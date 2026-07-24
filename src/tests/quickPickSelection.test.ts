/**
 * quickPickSelection.test.ts
 *
 * 「すきま時間に」枠（案Q2）の抽出規則。DBは触らない純関数だけを見る。
 *
 * この枠の価値は「短いと分かっているものだけを差し出す」ことなので、
 * NULL・0・境界値の扱いをここで固定する（緩めると信頼を損なう方向に壊れる）。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  QUICK_PICK_MAX_MINUTES,
  isQuickPick,
  selectQuickPicks,
} from "../lib/quickPickSelection";

const p = (estimated_minutes: number | null | undefined, reward_points = 100, id = "x") => ({
  id,
  estimated_minutes,
  reward_points,
});

test("所要時間が未設定(null/undefined)の案件は入れない（最重要規則）", () => {
  assert.equal(isQuickPick(p(null)), false);
  assert.equal(isQuickPick(p(undefined)), false);
  assert.equal(isQuickPick({}), false);
});

test("5分以内は入る。境界の5分ちょうどを含む", () => {
  assert.equal(isQuickPick(p(1)), true);
  assert.equal(isQuickPick(p(3)), true);
  assert.equal(isQuickPick(p(QUICK_PICK_MAX_MINUTES)), true);
});

test("6分以上は入らない", () => {
  assert.equal(isQuickPick(p(QUICK_PICK_MAX_MINUTES + 1)), false);
  assert.equal(isQuickPick(p(10)), false);
  assert.equal(isQuickPick(p(60)), false);
});

test("0分・負値・非数は入れない（データ不良を枠に通さない）", () => {
  assert.equal(isQuickPick(p(0)), false);
  assert.equal(isQuickPick(p(-3)), false);
  assert.equal(isQuickPick({ estimated_minutes: Number.NaN }), false);
  assert.equal(isQuickPick({ estimated_minutes: "3" as unknown as number }), false);
});

test("短い順に並ぶ。同着なら報酬が高い順", () => {
  const picked = selectQuickPicks([
    p(5, 200, "five"),
    p(3, 100, "three-low"),
    p(3, 300, "three-high"),
    p(1, 50, "one"),
  ]);
  assert.deepEqual(
    picked.map((x) => x.id),
    ["one", "three-high", "three-low", "five"],
  );
});

test("未設定と長時間が混ざった一覧から、短いものだけを取り出す", () => {
  const picked = selectQuickPicks([
    p(30, 1200, "long"),
    p(null, 800, "unset"),
    p(3, 120, "quick"),
    p(undefined, 500, "unset2"),
    p(5, 200, "quick2"),
  ]);
  assert.deepEqual(
    picked.map((x) => x.id),
    ["quick", "quick2"],
  );
});

test("該当なしなら空配列（呼び出し側はこれで帯ごと非表示にする）", () => {
  assert.deepEqual(selectQuickPicks([p(30), p(null), p(60)]), []);
  assert.deepEqual(selectQuickPicks([]), []);
});

test("配列以外を渡しても落ちない", () => {
  assert.deepEqual(selectQuickPicks(null as unknown as never[]), []);
  assert.deepEqual(selectQuickPicks(undefined as unknown as never[]), []);
});

test("件数上限で切り詰める（すきま時間に「選ぶ作業」をさせない）", () => {
  const many = Array.from({ length: 20 }, (_, i) => p(3, 100, `q${i}`));
  assert.equal(selectQuickPicks(many).length, 8);
  assert.equal(selectQuickPicks(many, 3).length, 3);
  assert.equal(selectQuickPicks(many, 0).length, 0);
});
