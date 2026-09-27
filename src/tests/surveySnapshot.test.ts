/**
 * surveySnapshot（締切＝集計の区切り）のユニットテスト。
 *
 * ここで守りたいこと:
 *   1. 締切後に完了した回答は**集計に入らない**（納品した数字が後から動かない）
 *   2. 回収中（closedAt が null）は従来どおり全件数える
 *   3. 締切時刻や completed_at が壊れていても**集計を空にしない**（fail-safe）
 *   4. 「次回ぶん」の件数が正しく数えられる
 *
 * 純関数のみ・ネットワーク無し。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { countPostCloseSessions, selectCountedSessions } from "../lib/surveySnapshot";
import type { Session, SessionStatus } from "../types/domain";

const CLOSED_AT = "2026-09-20T10:00:00.000Z";

/** テスト用の最小 Session を作る。 */
function s(
  id: string,
  status: SessionStatus,
  completedAt: string | null
): Session {
  return {
    id,
    respondent_id: `r-${id}`,
    project_id: "p1",
    current_question_id: null,
    current_phase: "completed",
    status,
    summary: null,
    state_json: null,
    started_at: "2026-09-19T00:00:00.000Z",
    completed_at: completedAt,
    last_activity_at: completedAt ?? "2026-09-19T00:00:00.000Z"
  };
}

test("締切前に完了したものだけを数える（締切後は入らない）", () => {
  const sessions = [
    s("before", "completed", "2026-09-20T09:59:00.000Z"),
    s("after", "completed", "2026-09-20T10:00:01.000Z")
  ];

  const counted = selectCountedSessions(sessions, CLOSED_AT);
  assert.deepEqual(
    counted.map((x) => x.id),
    ["before"],
    "締切後の回答が混ざると、納品した数字が後から動く"
  );
});

test("締切ちょうどの回答は含める（境界は締切時刻まで）", () => {
  const sessions = [s("exact", "completed", CLOSED_AT)];
  assert.equal(selectCountedSessions(sessions, CLOSED_AT).length, 1);
});

test("回答途中（active）のセッションは締切前でも数えない", () => {
  const sessions = [
    s("done", "completed", "2026-09-19T00:00:00.000Z"),
    s("wip", "active", null)
  ];
  assert.deepEqual(
    selectCountedSessions(sessions, CLOSED_AT).map((x) => x.id),
    ["done"]
  );
});

test("回収中（closedAt が null）は完了ぶんを全件数える", () => {
  const sessions = [
    s("a", "completed", "2026-09-19T00:00:00.000Z"),
    s("b", "completed", "2026-09-30T00:00:00.000Z")
  ];
  assert.equal(selectCountedSessions(sessions, null).length, 2);
});

test("completed_at が無い完了セッションは残す（消すと過去の数字が減る）", () => {
  const sessions = [s("legacy", "completed", null)];
  assert.equal(
    selectCountedSessions(sessions, CLOSED_AT).length,
    1,
    "時刻を記録していなかった時代のデータを落とすと納品済みの件数が動く"
  );
});

test("締切時刻が壊れていても集計を空にしない", () => {
  const sessions = [s("a", "completed", "2026-09-19T00:00:00.000Z")];
  assert.equal(
    selectCountedSessions(sessions, "not-a-date").length,
    1,
    "ここで空を返すと納品物が丸ごと消える"
  );
});

test("締切後の件数（次回ぶん）を数える", () => {
  const sessions = [
    s("before", "completed", "2026-09-19T00:00:00.000Z"),
    s("after1", "completed", "2026-09-21T00:00:00.000Z"),
    s("after2", "completed", "2026-09-22T00:00:00.000Z"),
    s("wip", "active", null)
  ];
  assert.equal(countPostCloseSessions(sessions, CLOSED_AT), 2);
});

test("回収中は「次回ぶん」という概念が無いので 0", () => {
  const sessions = [s("a", "completed", "2026-09-19T00:00:00.000Z")];
  assert.equal(countPostCloseSessions(sessions, null), 0);
});
