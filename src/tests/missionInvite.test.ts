/**
 * 招待・ペア判定ルールのテスト（純関数・DB不要）
 *
 * 確認項目:
 * 1. 自己招待・使用済み・期限切れ・取消・既存会員が正しく弾かれる
 * 2. 招待上限（10件）で発行が止まる
 * 3. 答え合わせの結果に**相手の選択コードが一切含まれない**（D-10・最重要）
 * 4. 一致→不一致の順に並ぶ
 * 5. 両者全問回答の判定が片側だけでは成立しない
 * 6. 招待偏重（自作自演の典型）の検出と、少数での誤検知回避
 * 7. 報酬定数が上限キャップ 2,000pt を超えない
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  PER_PERSON_CAP,
  INVITE_REWARDS,
  MAX_INVITES_PER_USER,
  validateInviteAcceptance,
  canIssueInvite,
  computePairMatches,
  orderForReveal,
  isPairComplete,
  isInviteHeavy,
  idempotencyKeys,
  type InviteForAcceptance,
} from "../lib/missionInvite";

const future = new Date(Date.now() + 7 * 86400_000).toISOString();
const past = new Date(Date.now() - 86400_000).toISOString();

function invite(overrides: Partial<InviteForAcceptance> = {}): InviteForAcceptance {
  return { inviter_id: "U_inviter", invitee_id: null, status: "issued", expires_at: future, ...overrides };
}

test("自己招待は弾く", () => {
  assert.equal(validateInviteAcceptance(invite(), "U_inviter", false), "self_invite");
});

test("使用済み（invitee_id あり / status 進行済み）は弾く", () => {
  assert.equal(validateInviteAcceptance(invite({ invitee_id: "U_x", status: "registered" }), "U_new", false), "already_used");
  assert.equal(validateInviteAcceptance(invite({ status: "answered" }), "U_new", false), "already_used");
});

test("期限切れ・取消は弾く", () => {
  assert.equal(validateInviteAcceptance(invite({ expires_at: past }), "U_new", false), "expired");
  assert.equal(validateInviteAcceptance(invite({ status: "revoked" }), "U_new", false), "revoked");
});

test("既存会員は already_member（報酬なし・ペアは呼び出し側で成立させる）", () => {
  assert.equal(validateInviteAcceptance(invite(), "U_member", true), "already_member");
});

test("有効な招待＋新規なら null（受諾できる）", () => {
  assert.equal(validateInviteAcceptance(invite(), "U_new", false), null);
});

test("招待上限: 9件なら発行可・10件で停止", () => {
  assert.equal(canIssueInvite(MAX_INVITES_PER_USER - 1), true);
  assert.equal(canIssueInvite(MAX_INVITES_PER_USER), false);
});

test("答え合わせ: 結果オブジェクトに相手の選択コードが存在しない（D-10）", () => {
  const results = computePairMatches(
    ["q1", "q2"],
    [
      { line_user_id: "me", question_id: "q1", choice_code: "morning" },
      { line_user_id: "you", question_id: "q1", choice_code: "morning" },
      { line_user_id: "me", question_id: "q2", choice_code: "plan" },
      { line_user_id: "you", question_id: "q2", choice_code: "free" },
    ],
    "me",
    "you"
  );
  assert.deepEqual(results, [
    { questionId: "q1", matched: true, myChoice: "morning" },
    { questionId: "q2", matched: false, myChoice: "plan" },
  ]);
  // 構造ごと検証: どのキーにも相手の値が乗っていない
  for (const r of results) {
    assert.deepEqual(Object.keys(r).sort(), ["matched", "myChoice", "questionId"]);
  }
  // 不一致設問で相手のコード "free" がシリアライズに現れない
  assert.equal(JSON.stringify(results).includes("free"), false);
});

test("答え合わせ: 一致→不一致の順に並ぶ", () => {
  const ordered = orderForReveal([
    { questionId: "q1", matched: false, myChoice: "a" },
    { questionId: "q2", matched: true, myChoice: "b" },
    { questionId: "q3", matched: true, myChoice: "c" },
  ]);
  assert.deepEqual(ordered.map((r) => r.questionId), ["q2", "q3", "q1"]);
});

test("完了判定: 片側だけ全問でも未完了・両者全問で完了", () => {
  const qs = ["q1", "q2"];
  const half = [
    { line_user_id: "a", question_id: "q1", choice_code: "x" },
    { line_user_id: "a", question_id: "q2", choice_code: "x" },
    { line_user_id: "b", question_id: "q1", choice_code: "x" },
  ];
  assert.equal(isPairComplete(qs, half, "a", "b"), false);
  assert.equal(
    isPairComplete(qs, [...half, { line_user_id: "b", question_id: "q2", choice_code: "y" }], "a", "b"),
    true
  );
});

test("招待偏重: 回答4/招待9は要確認・招待2件では判定しない", () => {
  assert.equal(isInviteHeavy(4, 9), true);
  assert.equal(isInviteHeavy(21, 0), false);
  assert.equal(isInviteHeavy(0, 2), false); // 少数は誤検知を避ける
});

test("報酬は上限キャップ 2,000pt を超えない（D-19）", () => {
  const total =
    INVITE_REWARDS.inviteeOnRegister +
    INVITE_REWARDS.inviterOnRegister +
    INVITE_REWARDS.inviterOnPairComplete;
  assert.equal(total, 300); // A7: 総原資 300pt/件
  for (const v of Object.values(INVITE_REWARDS)) {
    assert.ok(v <= PER_PERSON_CAP);
  }
});

test("冪等キーは invite/pair の ID で一意になる", () => {
  assert.notEqual(idempotencyKeys.inviteeRegister("i1"), idempotencyKeys.inviterRegister("i1"));
  assert.notEqual(idempotencyKeys.inviterPairComplete("p1"), idempotencyKeys.inviterPairComplete("p2"));
});
