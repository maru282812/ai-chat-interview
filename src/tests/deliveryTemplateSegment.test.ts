import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveSegmentConfigPlan } from "../services/projectDeliveryService";
import { findUnsupportedSegmentFields } from "../controllers/adminController";

/**
 * 配信テンプレ（delivery_templates）の segment_config の解釈。
 *
 * このカラムは 042 で作られて以来ずっと「設定はできるが誰も読まない」状態で、
 * 絞ったつもりの条件が黙って無視され、通知可ユーザー全員に配信されていた。
 * 解釈できない設定を「絞らない」に倒さないこと（fail-closed）をここで固定する。
 */

// ------------------------------------------------------------------
// 絞らないケース
// ------------------------------------------------------------------

test("segment_config が未設定なら絞らない（従来どおり全通知可ユーザー）", () => {
  assert.deepEqual(resolveSegmentConfigPlan(null), { kind: "all" });
  assert.deepEqual(resolveSegmentConfigPlan(undefined), { kind: "all" });
});

test("空オブジェクトは絞らない扱い", () => {
  assert.deepEqual(resolveSegmentConfigPlan({}), { kind: "all" });
});

test('type:"all" は明示的に絞らない', () => {
  assert.deepEqual(resolveSegmentConfigPlan({ type: "all" }), { kind: "all" });
});

// ------------------------------------------------------------------
// 絞るケース
// ------------------------------------------------------------------

test('type:"attribute" は指定セグメントで絞る', () => {
  const plan = resolveSegmentConfigPlan({
    type: "attribute",
    segment_id: "10000000-0000-0000-0000-000000000010",
  });
  assert.deepEqual(plan, {
    kind: "segment",
    segmentId: "10000000-0000-0000-0000-000000000010",
  });
});

// ------------------------------------------------------------------
// 解釈できない設定は止める（黙って全員配信しない）
// ------------------------------------------------------------------

test('未対応の type（rank など）は配信させない', () => {
  // 044 のデモデータに実在する形式。評価器が rank を解釈できないため、
  // 絞れないまま送ると「シルバー以上向け」のつもりが全員配信になる。
  assert.throws(
    () =>
      resolveSegmentConfigPlan(
        { type: "rank", rank_codes: ["silver", "gold"] },
        "[デモ] 週末まとめ配信",
      ),
    /未対応|配信を中止/,
  );
});

test("未知の type は配信させない", () => {
  assert.throws(
    () => resolveSegmentConfigPlan({ type: "future_type" }),
    /未対応|配信を中止/,
  );
});

test('type:"attribute" なのに segment_id が無ければ配信させない', () => {
  assert.throws(
    () => resolveSegmentConfigPlan({ type: "attribute" }),
    /segment_id|配信を中止/,
  );
});

test('segment_id が空文字なら配信させない', () => {
  assert.throws(
    () => resolveSegmentConfigPlan({ type: "attribute", segment_id: "" }),
    /segment_id|配信を中止/,
  );
});

test("エラーメッセージにテンプレ名が入る（どの設定を直せばよいか分かる）", () => {
  assert.throws(
    () => resolveSegmentConfigPlan({ type: "rank" }, "[デモ] 週末まとめ配信"),
    /\[デモ\] 週末まとめ配信/,
  );
});

// ------------------------------------------------------------------
// 「条件なし」セグメントの意味
// ------------------------------------------------------------------

test("条件が空のセグメントでも未対応項目としては扱わない（配信を止めない）", () => {
  // 実データの「[デモ] 条件なし全体配信」は conditions:[] を持つ。
  // 条件ゼロは「絞り込みなし＝全員」であって設定ミスではないので、
  // ここで未対応項目として弾くと全体配信のつもりの設定が配信不能になる。
  assert.deepEqual(findUnsupportedSegmentFields({ operator: "AND", conditions: [] }), []);
  assert.deepEqual(findUnsupportedSegmentFields({ operator: "AND", groups: [] }), []);
});
