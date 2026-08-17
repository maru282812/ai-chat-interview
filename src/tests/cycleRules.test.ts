/**
 * cycleRules.test.ts
 *
 * 繰り返しアンケート（サイクル）の判定ルール（Migration 093）。
 *
 * 離脱率は「日付の計算」が本体で、間違えてもエラーにならず
 * 静かに歪んだ数字が出るだけなので、境界を厚めに固定する。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addDays,
  canStartNewCycle,
  computeExpectedReturnAt,
  DEFAULT_RESTART_COOLDOWN_DAYS,
  isFollowupDue,
  resolveFrequencyDays,
  VISIT_FREQUENCY_DAYS,
} from "../lib/cycleRules";

const AT = (iso: string) => new Date(iso);
const BASE = AT("2026-08-01T00:00:00.000Z");

// ------------------------------------------------------------------
// 頻度コード → 日数
// ------------------------------------------------------------------

test("A-Q11 の全選択肢が日数に解決できる", () => {
  // 設問側の選択肢（seedSalonSurveyProjects.mjs）と対応が取れていること。
  assert.deepEqual(Object.keys(VISIT_FREQUENCY_DAYS).sort(), [
    "about_1_5m",
    "about_1m",
    "about_2m",
    "about_3m",
    "over_4m",
    "within_3w",
  ]);
  assert.equal(resolveFrequencyDays("within_3w"), 21);
  assert.equal(resolveFrequencyDays("about_1m"), 30);
  assert.equal(resolveFrequencyDays("about_1_5m"), 45);
  assert.equal(resolveFrequencyDays("about_2m"), 60);
  assert.equal(resolveFrequencyDays("about_3m"), 90);
  assert.equal(resolveFrequencyDays("over_4m"), 120);
});

test("undecided は既定60日（cycle_groups で上書きできる）", () => {
  assert.equal(resolveFrequencyDays("undecided"), 60);
  assert.equal(resolveFrequencyDays("undecided", 90), 90);
});

test("未知コード・空は null（既定値に丸めない）", () => {
  // 選択肢が変わったのに気づかないまま誤った離脱率が出るのを避ける。
  assert.equal(resolveFrequencyDays("about_5y"), null);
  assert.equal(resolveFrequencyDays(""), null);
  assert.equal(resolveFrequencyDays("   "), null);
  assert.equal(resolveFrequencyDays(null), null);
  assert.equal(resolveFrequencyDays(undefined), null);
});

// ------------------------------------------------------------------
// 離脱判定日
// ------------------------------------------------------------------

test("expected_return_at = 回答日 + 頻度日数 + 猶予", () => {
  const got = computeExpectedReturnAt({
    answeredAt: BASE,
    frequencyCode: "about_2m",
    graceDays: 7,
  });
  // 60 + 7 = 67日後
  assert.equal(got?.toISOString(), addDays(BASE, 67).toISOString());
});

test("猶予を0にすると頻度日数ちょうど", () => {
  const got = computeExpectedReturnAt({
    answeredAt: BASE,
    frequencyCode: "about_1m",
    graceDays: 0,
  });
  assert.equal(got?.toISOString(), addDays(BASE, 30).toISOString());
});

test("頻度が引けないサイクルは判定日を持たない（＝C送付対象外）", () => {
  assert.equal(
    computeExpectedReturnAt({ answeredAt: BASE, frequencyCode: null }),
    null
  );
  assert.equal(
    computeExpectedReturnAt({ answeredAt: BASE, frequencyCode: "unknown_code" }),
    null
  );
});

// ------------------------------------------------------------------
// 新サイクル開始のクールダウン（ポイント二重取り防止）
// ------------------------------------------------------------------

test("初回は常に新サイクルを開始できる", () => {
  assert.equal(canStartNewCycle({ lastCycleStartedAt: null, now: BASE }), true);
});

test("クールダウン既定は25日", () => {
  assert.equal(DEFAULT_RESTART_COOLDOWN_DAYS, 25);
});

test("25日ちょうどで開始できる（境界を含む）", () => {
  assert.equal(
    canStartNewCycle({ lastCycleStartedAt: BASE, now: addDays(BASE, 25) }),
    true
  );
});

test("24日目はまだ開始できない＝QR連打でポイントを二重取りできない", () => {
  assert.equal(
    canStartNewCycle({ lastCycleStartedAt: BASE, now: addDays(BASE, 24) }),
    false
  );
  // 同日連打が最も現実的な攻撃経路。
  assert.equal(
    canStartNewCycle({ lastCycleStartedAt: BASE, now: addDays(BASE, 0) }),
    false
  );
});

test("クールダウン日数はグループ設定で変えられる", () => {
  assert.equal(
    canStartNewCycle({ lastCycleStartedAt: BASE, now: addDays(BASE, 10), cooldownDays: 7 }),
    true
  );
  assert.equal(
    canStartNewCycle({ lastCycleStartedAt: BASE, now: addDays(BASE, 10), cooldownDays: 30 }),
    false
  );
});

// ------------------------------------------------------------------
// C（離脱検証）の送付対象判定
// ------------------------------------------------------------------

const openCycle = (over: Partial<Parameters<typeof isFollowupDue>[0]> = {}) => ({
  expected_return_at: addDays(BASE, 60).toISOString(),
  followup_sent_at: null,
  returned_at: null,
  closed_at: null,
  ...over,
});

test("期限を過ぎて再来店が無ければ送付対象", () => {
  assert.equal(isFollowupDue(openCycle(), addDays(BASE, 61)), true);
});

test("期限ちょうどは送付対象（境界を含む）", () => {
  assert.equal(isFollowupDue(openCycle(), addDays(BASE, 60)), true);
});

test("期限前は送付しない", () => {
  assert.equal(isFollowupDue(openCycle(), addDays(BASE, 59)), false);
});

test("再来店済みなら送らない（離脱していないことが確定している）", () => {
  const returned = openCycle({ returned_at: addDays(BASE, 30).toISOString() });
  assert.equal(isFollowupDue(returned, addDays(BASE, 90)), false);
});

test("送付済みなら二度送らない（冪等）", () => {
  const sent = openCycle({ followup_sent_at: addDays(BASE, 61).toISOString() });
  assert.equal(isFollowupDue(sent, addDays(BASE, 90)), false);
});

test("クローズ済みなら送らない", () => {
  const closed = openCycle({ closed_at: addDays(BASE, 61).toISOString() });
  assert.equal(isFollowupDue(closed, addDays(BASE, 90)), false);
});

test("判定日が無いサイクルは永久に送付対象にならない", () => {
  const noDate = openCycle({ expected_return_at: null });
  assert.equal(isFollowupDue(noDate, addDays(BASE, 3650)), false);
});
