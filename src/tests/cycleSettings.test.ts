/**
 * cycleSettings.test.ts
 *
 * 「C をいつ送るか」の設定の DB 化（Migration 095）。
 *
 * 設定が「設問」「コード」「cycle_groups」の3か所に散っていたのを1か所に集めた。
 * ここで守りたいのは2点:
 *   1. 管理画面で対応表を変えたら、その値で判定日が決まること
 *   2. 設問の選択肢と対応表がズレたとき「気づける」こと
 *      （ズレると誰にもCが送られないのに、エラーは出ない）
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeExpectedReturnAt,
  diffFrequencyMapping,
  resolveFrequencyDays,
  VISIT_FREQUENCY_DAYS,
} from "../lib/cycleRules";

const BASE = new Date("2026-08-01T00:00:00.000Z");
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

// ------------------------------------------------------------------
// 対応表の上書き
// ------------------------------------------------------------------

test("対応表を渡すとその日数が使われる（デプロイ不要で変更できる）", () => {
  assert.equal(resolveFrequencyDays("about_2m", 60, { about_2m: 75 }), 75);
});

test("対応表が未設定（null/空）なら既定表にフォールバックする", () => {
  assert.equal(resolveFrequencyDays("about_2m", 60, null), VISIT_FREQUENCY_DAYS.about_2m);
  assert.equal(resolveFrequencyDays("about_2m", 60, {}), VISIT_FREQUENCY_DAYS.about_2m);
});

test("対応表に無いコードは null（＝C送付対象外）", () => {
  // 既定表には about_1m があるが、上書き表に無ければ「無い」が優先される。
  assert.equal(resolveFrequencyDays("about_1m", 60, { about_2m: 75 }), null);
});

test("不正な値（0・負数・数値でない）は未設定と同じ扱い", () => {
  assert.equal(resolveFrequencyDays("x", 60, { x: 0 }), null);
  assert.equal(resolveFrequencyDays("x", 60, { x: -5 }), null);
  assert.equal(resolveFrequencyDays("x", 60, { x: Number.NaN }), null);
  assert.equal(
    resolveFrequencyDays("x", 60, { x: "60" } as unknown as Record<string, number>),
    null
  );
});

test("undecided は対応表ではなく undecided_days で決まる", () => {
  assert.equal(resolveFrequencyDays("undecided", 90, { undecided: 5 }), 90);
});

test("判定日の計算に対応表が効く", () => {
  const got = computeExpectedReturnAt({
    answeredAt: BASE,
    frequencyCode: "about_2m",
    graceDays: 7,
    daysTable: { about_2m: 75 },
  });
  assert.equal(got?.toISOString(), addDays(BASE, 82).toISOString(), "75 + 猶予7 = 82日後");
});

// ------------------------------------------------------------------
// 設問の選択肢と対応表のズレ検出（silent failure の防止）
// ------------------------------------------------------------------

test("選択肢と対応表が一致していれば ok", () => {
  const diff = diffFrequencyMapping(["about_1m", "about_2m"], { about_1m: 30, about_2m: 60 });
  assert.equal(diff.ok, true);
  assert.deepEqual(diff.missingInTable, []);
});

test("対応表に無い選択肢を検出する（これを選んだ人にCが送られない）", () => {
  const diff = diffFrequencyMapping(["about_1m", "about_5y"], { about_1m: 30 });
  assert.equal(diff.ok, false);
  assert.deepEqual(diff.missingInTable, ["about_5y"]);
});

test("undecided は突き合わせ対象から外す（undecided_days で扱うため）", () => {
  const diff = diffFrequencyMapping(["about_1m", "undecided"], { about_1m: 30 });
  assert.equal(diff.ok, true, "undecided が missing 扱いされてはいけない");
});

test("使われていない対応表の行も分かる（軽微だが掃除の手がかり）", () => {
  const diff = diffFrequencyMapping(["about_1m"], { about_1m: 30, about_9m: 270 });
  assert.equal(diff.ok, true, "余分な設定は重大ではない");
  assert.deepEqual(diff.unusedInTable, ["about_9m"]);
});

test("対応表が未設定なら既定表と突き合わせる", () => {
  // 既定表に無い選択肢だけが missing になる
  const diff = diffFrequencyMapping(["about_2m", "about_5y"], null);
  assert.deepEqual(diff.missingInTable, ["about_5y"]);
});

test("日数が0の行は「設定済み」と見なさない", () => {
  const diff = diffFrequencyMapping(["about_2m"], { about_2m: 0 });
  assert.equal(diff.ok, false, "0日は有効な設定ではない");
});

test("美容室A-Q11の実際の選択肢が既定表と整合している", () => {
  // seedSalonSurveyProjects.mjs の A-Q11 と同じ並び。
  const actual = [
    "within_3w",
    "about_1m",
    "about_1_5m",
    "about_2m",
    "about_3m",
    "over_4m",
    "undecided",
  ];
  const diff = diffFrequencyMapping(actual, null);
  assert.equal(diff.ok, true, "現行の設問構成で判定不能者が出てはいけない");
  assert.deepEqual(diff.unusedInTable, [], "既定表に余りが無いこと");
});
