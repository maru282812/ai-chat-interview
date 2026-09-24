/**
 * ステージ判定ルールのテスト（純関数・DB不要）
 *
 * 確認項目:
 * 1. 条件は 回答数 OR 招待数（どちらかで上がる＝身内ゼロでも詰まない・D-13）
 * 2. 飛び級達成でも未受領の全段が払われる
 * 3. マスクされた未達段の報酬額が**レスポンス構造に存在しない**（??? の実効性）
 * 4. current は未達の最下段1つだけ（Von Restorff）
 * 5. バリデーション: 上限2,000pt・1段目マスク不可・条件の単調増加
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  isStageMet,
  stagesToAward,
  buildStageViews,
  remainingForStage,
  validateStages,
  type MissionStageDef,
} from "../lib/missionStage";

const STAGES: MissionStageDef[] = [
  { stage_no: 1, need_answers: 3, need_invites: 1, reward_points: 150, is_masked: false },
  { stage_no: 2, need_answers: 10, need_invites: 3, reward_points: 300, is_masked: true },
  { stage_no: 3, need_answers: 20, need_invites: 5, reward_points: 550, is_masked: true },
];

test("OR条件: 回答3で達成・招待1でも達成", () => {
  assert.equal(isStageMet(STAGES[0]!, 3, 0), true);
  assert.equal(isStageMet(STAGES[0]!, 0, 1), true);
  assert.equal(isStageMet(STAGES[0]!, 2, 0), false);
});

test("飛び級: 回答12なら段1と段2をまとめて払う（段3は未達）", () => {
  const award = stagesToAward(STAGES, 12, 0, []);
  assert.deepEqual(award.map((s) => s.stage_no), [1, 2]);
});

test("受領済みの段は二度払わない", () => {
  const award = stagesToAward(STAGES, 12, 0, [1]);
  assert.deepEqual(award.map((s) => s.stage_no), [2]);
});

test("マスクされた未達段の額は null＝レスポンスに存在しない", () => {
  const views = buildStageViews(STAGES, 4, 0, [1]);
  assert.equal(views[0]!.rewardPoints, 150);        // done は開示
  assert.equal(views[1]!.rewardPoints, null);       // current だがマスク → ???
  assert.equal(views[2]!.rewardPoints, null);       // locked かつマスク → ???
  assert.equal(JSON.stringify(views).includes("300"), false);
  assert.equal(JSON.stringify(views).includes("550"), false);
});

test("current は未達の最下段1つだけ", () => {
  const views = buildStageViews(STAGES, 4, 0, [1]);
  assert.deepEqual(views.map((v) => v.state), ["done", "current", "locked"]);
});

test("残り: 回答7なら段2まで あと3回 / あと3人", () => {
  assert.deepEqual(remainingForStage(STAGES[1]!, 7, 0), { answersLeft: 3, invitesLeft: 3 });
});

test("バリデーション: 2,001pt は上限超過で弾く", () => {
  const errs = validateStages([
    { stage_no: 1, need_answers: 1, need_invites: 1, reward_points: 2001, is_masked: false },
  ]);
  assert.ok(errs.some((e) => e.includes("2000")));
});

test("バリデーション: 1段目のマスクは不可", () => {
  const errs = validateStages([
    { stage_no: 1, need_answers: 1, need_invites: 1, reward_points: 100, is_masked: true },
  ]);
  assert.ok(errs.some((e) => e.includes("1段目")));
});

test("バリデーション: 条件が前段以下なら弾く", () => {
  const errs = validateStages([
    { stage_no: 1, need_answers: 5, need_invites: 2, reward_points: 100, is_masked: false },
    { stage_no: 2, need_answers: 5, need_invites: 3, reward_points: 200, is_masked: false },
  ]);
  assert.ok(errs.some((e) => e.includes("段2")));
});

test("バリデーション: 正しい定義はエラーなし", () => {
  assert.deepEqual(validateStages(STAGES), []);
});
