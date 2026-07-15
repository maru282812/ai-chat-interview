/**
 * poolQuestionSelection.test.ts
 *
 * ついでスワイプ（設問プール）の出題選定純関数のテスト。
 * docs/spec-pool-swipe-questions.md の選定ルール（上限・除外・冪等再掲・reask・スキップcooldown）を検証する。
 * DB は触らない純関数なので、履歴を直接組み立てて振る舞いだけを見る。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  POOL_DAILY_CAP,
  POOL_SKIP_COOLDOWN_DAYS,
  type PoolAnswerRecord,
  type PoolExposureRecord,
  type PoolQuestionCandidate,
  selectPoolQuestions,
} from "../lib/poolQuestionSelection";

const TODAY = "2026-07-15";

function cand(over: Partial<PoolQuestionCandidate> & { id: string }): PoolQuestionCandidate {
  return {
    status: "active",
    priority: 0,
    created_at: "2026-01-01T00:00:00.000Z",
    starts_at: null,
    ends_at: null,
    reask_after_days: null,
    ...over,
  };
}

function run(input: {
  candidates: PoolQuestionCandidate[];
  exposures?: PoolExposureRecord[];
  answers?: PoolAnswerRecord[];
  today?: string;
  now?: Date;
}) {
  return selectPoolQuestions({
    candidates: input.candidates,
    exposures: input.exposures ?? [],
    answers: input.answers ?? [],
    today: input.today ?? TODAY,
    now: input.now ?? new Date(`${input.today ?? TODAY}T03:00:00.000Z`),
  });
}

test("上限: 履歴なしなら priority DESC / created_at ASC で CAP 件、position は 0 から", () => {
  const candidates = [
    cand({ id: "a", priority: 1, created_at: "2026-01-02T00:00:00Z" }),
    cand({ id: "b", priority: 5, created_at: "2026-01-03T00:00:00Z" }),
    cand({ id: "c", priority: 5, created_at: "2026-01-01T00:00:00Z" }),
    cand({ id: "d", priority: 0, created_at: "2026-01-04T00:00:00Z" }),
    cand({ id: "e", priority: 0, created_at: "2026-01-05T00:00:00Z" }),
  ];
  const out = run({ candidates });
  assert.equal(out.length, POOL_DAILY_CAP);
  // priority 5 の c(created 01-01) → b(01-03) → priority 1 の a
  assert.deepEqual(out.map((o) => o.questionId), ["c", "b", "a"]);
  assert.deepEqual(out.map((o) => o.position), [0, 1, 2]);
  assert.ok(out.every((o) => o.isNew));
});

test("冪等再掲: 今日 served の exposure は同じ順で再掲され、残枠だけ新規補充", () => {
  const candidates = [
    cand({ id: "a" }),
    cand({ id: "served1" }),
    cand({ id: "served2" }),
  ];
  const exposures: PoolExposureRecord[] = [
    { question_id: "served1", exposure_date: TODAY, status: "served", position: 0 },
    { question_id: "served2", exposure_date: TODAY, status: "served", position: 1 },
  ];
  const out = run({ candidates, exposures });
  // 再掲2件（isNew=false・既存 position）＋新規1件（position=2）
  assert.deepEqual(out.map((o) => o.questionId), ["served1", "served2", "a"]);
  assert.deepEqual(out.map((o) => o.isNew), [false, false, true]);
  assert.deepEqual(out.map((o) => o.position), [0, 1, 2]);
});

test("上限: 今日すでに CAP 件の exposure があれば新規補充しない（answered もカウント）", () => {
  const candidates = [cand({ id: "a" }), cand({ id: "b" })];
  const exposures: PoolExposureRecord[] = [
    { question_id: "x", exposure_date: TODAY, status: "answered", position: 0 },
    { question_id: "y", exposure_date: TODAY, status: "skipped", position: 1 },
    { question_id: "z", exposure_date: TODAY, status: "answered", position: 2 },
  ];
  const out = run({ candidates, exposures });
  assert.equal(out.length, 0);
});

test("除外: 今日 answered/skipped の設問は再出題しない", () => {
  const candidates = [cand({ id: "a" }), cand({ id: "b" })];
  const exposures: PoolExposureRecord[] = [
    { question_id: "a", exposure_date: TODAY, status: "answered", position: 0 },
  ];
  const out = run({ candidates, exposures });
  assert.deepEqual(out.map((o) => o.questionId), ["b"]);
});

test("除外: 回答済みで reask_after_days=null なら再出題しない", () => {
  const candidates = [cand({ id: "a", reask_after_days: null }), cand({ id: "b" })];
  const answers: PoolAnswerRecord[] = [{ question_id: "a", answered_date: "2026-07-01" }];
  const out = run({ candidates, answers });
  assert.deepEqual(out.map((o) => o.questionId), ["b"]);
});

test("reask: 経過日数 >= reask_after_days なら再出題、未経過なら除外", () => {
  const due = cand({ id: "due", reask_after_days: 3 });
  const notDue = cand({ id: "notDue", reask_after_days: 3 });
  const answers: PoolAnswerRecord[] = [
    { question_id: "due", answered_date: "2026-07-11" }, // 4日前 >= 3 → 再出題
    { question_id: "notDue", answered_date: "2026-07-14" }, // 1日前 < 3 → 除外
  ];
  const out = run({ candidates: [due, notDue], answers });
  assert.deepEqual(out.map((o) => o.questionId), ["due"]);
});

test("スキップcooldown: COOLDOWN 日以内のスキップは除外、境界日で復活", () => {
  const recent = cand({ id: "recent" });
  const old = cand({ id: "old" });
  const withinDate = "2026-07-05"; // 10日前 < 14 → 除外
  const boundaryDate = "2026-07-01"; // 14日前 = COOLDOWN → 復活
  assert.equal(POOL_SKIP_COOLDOWN_DAYS, 14);
  const exposures: PoolExposureRecord[] = [
    { question_id: "recent", exposure_date: withinDate, status: "skipped", position: 0 },
    { question_id: "old", exposure_date: boundaryDate, status: "skipped", position: 0 },
  ];
  const out = run({ candidates: [recent, old], exposures });
  assert.deepEqual(out.map((o) => o.questionId), ["old"]);
});

test("除外: active 以外・掲載期間外は候補にしない", () => {
  const now = new Date(`${TODAY}T03:00:00.000Z`);
  const candidates = [
    cand({ id: "draft", status: "draft" }),
    cand({ id: "paused", status: "paused" }),
    cand({ id: "future", starts_at: "2026-08-01T00:00:00Z" }),
    cand({ id: "expired", ends_at: "2026-07-01T00:00:00Z" }),
    cand({ id: "ok" }),
    cand({ id: "okWindow", starts_at: "2026-07-01T00:00:00Z", ends_at: "2026-12-31T00:00:00Z" }),
  ];
  const out = run({ candidates, now });
  assert.deepEqual(out.map((o) => o.questionId).sort(), ["ok", "okWindow"]);
});

test("冪等 + reask 混在: 今日 served を維持しつつ、reask 経過した過去回答も新規に含む", () => {
  const candidates = [
    cand({ id: "s", }),
    cand({ id: "reask", reask_after_days: 2 }),
    cand({ id: "blocked", reask_after_days: 10 }),
  ];
  const exposures: PoolExposureRecord[] = [
    { question_id: "s", exposure_date: TODAY, status: "served", position: 0 },
  ];
  const answers: PoolAnswerRecord[] = [
    { question_id: "reask", answered_date: "2026-07-10" }, // 5日前 >= 2 → 再出題
    { question_id: "blocked", answered_date: "2026-07-10" }, // 5日前 < 10 → 除外
  ];
  const out = run({ candidates, exposures, answers });
  assert.deepEqual(out.map((o) => o.questionId), ["s", "reask"]);
  assert.deepEqual(out.map((o) => o.isNew), [false, true]);
  assert.deepEqual(out.map((o) => o.position), [0, 1]);
});
