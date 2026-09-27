/**
 * 設問の差し替えで `question_config.meta` が消えないことのテスト。
 *
 * ## 背景（実際に起きていた事故）
 * パートナーAPI の設問更新は `question_config` を全置換する。`meta` は
 * パートナーAPI が扱わない領域（hibi は送ってこない）なので、引き継がないと
 * **運営が管理画面で入れた店舗開示の設定が、店舗の自動保存1回で消える**。
 * 店舗のダッシュボードから集計が消え、申し送りも出なくなっていた。
 *
 * ## fail-closed の方向
 * 引き継ぎは「設問文が一致するときだけ」。位置だけで引き継ぐと、設問を入れ替えた
 * ときに**別の設問へ開示設定が移り、告知していない回答が店舗に出る**（規約違反）。
 * 迷ったら引き継がない側に倒す。
 *
 * 純関数のみ・ネットワーク無し。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { carryOverQuestionMeta } from "../lib/partnerQuestions";

const META = { share_with_store: { enabled: true, mode: "verbatim", notice: "告知文" } };

function prev(text: string, meta: unknown = META) {
  return { question_text: text, question_config: { meta } };
}

test("★設問文が同じなら meta を引き継ぐ（自動保存で消さない）", () => {
  assert.deepEqual(carryOverQuestionMeta(prev("今日の施術について"), "今日の施術について"), META);
});

test("★設問文が変わったら引き継がない（別の設問に開示設定を移さない）", () => {
  assert.equal(carryOverQuestionMeta(prev("今日の施術について"), "まったく別の設問"), undefined);
});

test("既存の設問が無ければ引き継がない（新規追加）", () => {
  assert.equal(carryOverQuestionMeta(undefined, "新しい設問"), undefined);
});

test("meta を持たない既存設問からは何も引き継がない", () => {
  assert.equal(carryOverQuestionMeta({ question_text: "Q", question_config: {} }, "Q"), undefined);
  assert.equal(carryOverQuestionMeta({ question_text: "Q", question_config: null }, "Q"), undefined);
});

test("meta は中身を解釈せずそのまま渡す（開示以外の設定も落とさない）", () => {
  const other = { something_else: { a: 1 }, share_with_store: { enabled: false } };
  assert.deepEqual(carryOverQuestionMeta(prev("Q", other), "Q"), other);
});
