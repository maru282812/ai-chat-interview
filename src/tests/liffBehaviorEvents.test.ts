/**
 * liffBehaviorEvents.test.ts
 *
 * LIFF 行動計測ビーコンの入力検証（migration 086 / POST /liff/behavior-beacon）。
 * DB は触らず normalizeBehaviorEvents の純粋な変換だけを見る。
 *
 * この検証の要点は「壊れた入力で落ちないこと」。計測は認証なしで受けるため、
 * 想定外の形が来ても例外を投げず、使える分だけ拾って残りは捨てる必要がある。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { LiffBehaviorEventInput } from "../repositories/liffBehaviorEventRepository";
import { normalizeBehaviorEvents } from "../services/liffBehaviorService";

const USER = "U0000000000000000000000000000001";

/** 添字アクセスの undefined を潰しつつ、件数不足をその場で失敗にする。 */
function at(events: LiffBehaviorEventInput[], index: number): LiffBehaviorEventInput {
  const found = events[index];
  assert.ok(found, `events[${index}] が存在しない（実際の件数: ${events.length}）`);
  return found;
}

test("正常系: 既知のイベント種別は line_user_id を付けて通る", () => {
  const events = normalizeBehaviorEvents(
    [{ event_type: "list_reach", page: "projects", target: "project_list", value_num: 820, session_key: "abc123" }],
    USER,
  );
  assert.equal(events.length, 1);
  assert.equal(at(events, 0).event_type, "list_reach");
  assert.equal(at(events, 0).page, "projects");
  assert.equal(at(events, 0).target, "project_list");
  assert.equal(at(events, 0).value_num, 820);
  assert.equal(at(events, 0).session_key, "abc123");
  assert.equal(at(events, 0).line_user_id, USER);
});

test("未ログインでも匿名イベントとして通る（計測のためにログインを強制しない）", () => {
  const events = normalizeBehaviorEvents([{ event_type: "page_view", page: "projects" }], null);
  assert.equal(events.length, 1);
  assert.equal(at(events, 0).line_user_id, null);
});

test("未知のイベント種別は捨てる（CHECK制約違反でinsert全体を失敗させないため）", () => {
  const events = normalizeBehaviorEvents(
    [
      { event_type: "nav_tap", page: "projects", target: "saved" },
      { event_type: "drop_table", page: "projects" },
      { event_type: "", page: "projects" },
    ],
    USER,
  );
  assert.equal(events.length, 1);
  assert.equal(at(events, 0).event_type, "nav_tap");
});

test("page が無い要素は捨てるが、同じ配列の正常な要素は残る", () => {
  const events = normalizeBehaviorEvents(
    [
      { event_type: "page_view" },
      { event_type: "page_view", page: "   " },
      { event_type: "page_view", page: "mypage" },
    ],
    USER,
  );
  assert.equal(events.length, 1);
  assert.equal(at(events, 0).page, "mypage");
});

test("配列以外・null・空配列は空を返す（例外を投げない）", () => {
  assert.deepEqual(normalizeBehaviorEvents(null, USER), []);
  assert.deepEqual(normalizeBehaviorEvents(undefined, USER), []);
  assert.deepEqual(normalizeBehaviorEvents("events", USER), []);
  assert.deepEqual(normalizeBehaviorEvents({ event_type: "page_view" }, USER), []);
  assert.deepEqual(normalizeBehaviorEvents([], USER), []);
  assert.deepEqual(normalizeBehaviorEvents([null, undefined, 42, "x"], USER), []);
});

test("1リクエストの件数は20件で頭打ち（ログ肥大と悪用の防止）", () => {
  const raw = Array.from({ length: 50 }, () => ({ event_type: "page_view", page: "projects" }));
  assert.equal(normalizeBehaviorEvents(raw, USER).length, 20);
});

test("長すぎる文字列は切り詰める", () => {
  const events = normalizeBehaviorEvents(
    [{ event_type: "card_tap", page: "p".repeat(200), target: "t".repeat(500), session_key: "s".repeat(200) }],
    USER,
  );
  assert.equal(at(events, 0).page.length, 40);
  assert.equal(at(events, 0).target?.length, 120);
  assert.equal(at(events, 0).session_key?.length, 40);
});

test("value_num は非数・負値・非現実的な巨大値を捨てて null にする", () => {
  const cases: Array<[unknown, number | null]> = [
    ["820", null],
    [Number.NaN, null],
    [Number.POSITIVE_INFINITY, null],
    [-1, null],
    [10_000_001, null],
    [0, 0],
    [820.6, 821],
  ];
  for (const [input, expected] of cases) {
    const events = normalizeBehaviorEvents([{ event_type: "list_reach", page: "projects", value_num: input }], USER);
    assert.equal(at(events, 0).value_num, expected, `value_num=${String(input)}`);
  }
});

test("save_toggle は 1=保存 / 0=解除 を value_num で区別できる", () => {
  const events = normalizeBehaviorEvents(
    [
      { event_type: "save_toggle", page: "projects", target: "proj-1", value_num: 1 },
      { event_type: "save_toggle", page: "projects", target: "proj-1", value_num: 0 },
    ],
    USER,
  );
  assert.equal(events.length, 2);
  assert.equal(at(events, 0).value_num, 1);
  assert.equal(at(events, 1).value_num, 0);
});
