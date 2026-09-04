/**
 * 深掘りプロンプトへ渡す回答文面のラベル解決テスト
 *
 * 確認項目:
 * 1. 単一選択は value → label に変換される（内部値を AI に見せない）
 * 2. 複数選択はカンマ結合のまま各要素がラベル化される
 * 3. 自由記述・数値など選択肢以外は素通し
 * 4. 選択肢に無い値が混じる場合は変換しない（部分変換で回答を壊さない）
 * 5. 変換規則は LINE webhook 経路（questionFlowServiceV2）と揃う
 */

import assert from "node:assert/strict";
import test from "node:test";
import { toDisplayAnswerForPrompt } from "../lib/answerLabel";
import type { Question } from "../types/domain";

function makeQuestion(overrides: Partial<Question>): Question {
  return {
    id: "q-id",
    project_id: "p-id",
    question_code: "Q1",
    question_text: "設問",
    question_type: "single_choice",
    sort_order: 1,
    question_config: {},
    ...overrides
  } as Question;
}

const choiceQuestion = makeQuestion({
  question_type: "single_choice",
  question_config: {
    options: [
      { label: "はい（→Q4へ飛ぶはず）", value: "yes" },
      { label: "いいえ（→Q2へ進むはず）", value: "no" }
    ]
  }
});

test("AL-1: 単一選択は value がラベルに変換される", () => {
  assert.equal(toDisplayAnswerForPrompt("yes", choiceQuestion), "はい（→Q4へ飛ぶはず）");
  assert.equal(toDisplayAnswerForPrompt("no", choiceQuestion), "いいえ（→Q2へ進むはず）");
});

test("AL-2: 複数選択は各要素がラベル化されカンマ結合で返る", () => {
  const multi = makeQuestion({
    question_type: "multi_choice",
    question_config: {
      options: [
        { label: "コンビニ", value: "cvs" },
        { label: "スーパー", value: "super" },
        { label: "ドラッグストア", value: "drug" }
      ]
    }
  });
  assert.equal(toDisplayAnswerForPrompt("cvs,drug", multi), "コンビニ, ドラッグストア");
  // 読点区切りでも同じ結果（保存経路によって区切り文字が揺れるため）
  assert.equal(toDisplayAnswerForPrompt("cvs、super", multi), "コンビニ, スーパー");
});

test("AL-3: 自由記述・数値は素通し（変換対象外）", () => {
  const text = makeQuestion({ question_type: "text", question_config: {} });
  assert.equal(toDisplayAnswerForPrompt("駅前で買うことが多いです", text), "駅前で買うことが多いです");

  const numeric = makeQuestion({ question_type: "numeric", question_config: {} });
  assert.equal(toDisplayAnswerForPrompt("3", numeric), "3");
});

test("AL-4: 選択肢に無い値が混じる場合は変換せず元の文字列を返す", () => {
  // 「その他」の自由記述などを部分的にラベル化すると回答が読めなくなるため、
  // 1つでも引けなければ丸ごと素通しする。
  assert.equal(toDisplayAnswerForPrompt("yes,その他の自由記述", choiceQuestion), "yes,その他の自由記述");
  assert.equal(toDisplayAnswerForPrompt("unknown_value", choiceQuestion), "unknown_value");
});

test("AL-5: 既にラベルが渡された場合もラベルのまま返る（経路差の吸収）", () => {
  // interview_chat 経路はクライアントが既に label を送るため、二重変換で壊れないこと。
  assert.equal(toDisplayAnswerForPrompt("はい（→Q4へ飛ぶはず）", choiceQuestion), "はい（→Q4へ飛ぶはず）");
});

test("AL-6: 空文字・選択肢未定義・question なしは素通し", () => {
  assert.equal(toDisplayAnswerForPrompt("", choiceQuestion), "");
  assert.equal(toDisplayAnswerForPrompt("yes", null), "yes");
  const noOptions = makeQuestion({ question_type: "single_choice", question_config: {} });
  assert.equal(toDisplayAnswerForPrompt("yes", noOptions), "yes");
});

test("AL-7: 変換規則が LINE webhook 経路（single=label / multi=label結合）と一致する", () => {
  // questionFlowServiceV2.parseAnswer は single で option.label、
  // multi で labels を ", " 結合する。同じ入力で同じ文面になること。
  const multi = makeQuestion({
    question_type: "multi_choice",
    question_config: {
      options: [
        { label: "朝", value: "morning" },
        { label: "夜", value: "night" }
      ]
    }
  });
  assert.equal(toDisplayAnswerForPrompt("morning,night", multi), "朝, 夜");
});
