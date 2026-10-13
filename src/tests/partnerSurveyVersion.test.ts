import assert from "node:assert/strict";
import test from "node:test";

import type { PartnerQuestionView } from "../lib/partnerQuestions";
import { computeSurveyVersion } from "../lib/partnerSurveyVersion";

/**
 * partnerSurveyVersion.test.ts
 *
 * 楽観ロックの版計算。ここが壊れると「競合を検知できない」（＝運営の変更が
 * 黙って消える）か「常に競合する」（＝店舗が保存できない）のどちらかになる。
 * 特に **固定設問を無視すること** と **並び替えを検知すること** を守る。
 */

function q(over: Partial<PartnerQuestionView> = {}): PartnerQuestionView {
  return {
    question_code: "pq1",
    question_text: "満足度を教えてください",
    question_type: "single_choice",
    answer_options: [
      { value: "5", label: "満足" },
      { value: "1", label: "不満" }
    ],
    matrix_cols: null,
    min: null,
    max: null,
    unit: null,
    sort_order: 10,
    is_required: true,
    is_fixed: false,
    question_text_image: null,
    carry_forward: null,
    ...over
  };
}

test("同じ内容なら同じ版になる（安定している）", () => {
  assert.equal(computeSurveyVersion([q()]), computeSurveyVersion([q()]));
});

test("設問文が変わると版が変わる", () => {
  assert.notEqual(
    computeSurveyVersion([q()]),
    computeSurveyVersion([q({ question_text: "本日の満足度は？" })])
  );
});

test("選択肢の label だけ変わっても版が変わる", () => {
  assert.notEqual(
    computeSurveyVersion([q()]),
    computeSurveyVersion([
      q({
        answer_options: [
          { value: "5", label: "とても満足" },
          { value: "1", label: "不満" }
        ]
      })
    ])
  );
});

test("必須フラグの変更を検知する", () => {
  assert.notEqual(computeSurveyVersion([q()]), computeSurveyVersion([q({ is_required: false })]));
});

test("設問の追加・削除を検知する", () => {
  const one = computeSurveyVersion([q()]);
  const two = computeSurveyVersion([q(), q({ question_code: "pq2", question_text: "ご意見" })]);
  assert.notEqual(one, two);
});

test("並び替えを検知する（sort_order の実値ではなく並び順で見る）", () => {
  const a = q({ question_code: "pq1", question_text: "A", sort_order: 10 });
  const b = q({ question_code: "pq2", question_text: "B", sort_order: 11 });
  const forward = computeSurveyVersion([a, b]);
  // 入れ替え。sort_order も入れ替わる（サーバーが振り直すのと同じ状況）
  const swapped = computeSurveyVersion([
    { ...b, sort_order: 10 },
    { ...a, sort_order: 11 }
  ]);
  assert.notEqual(forward, swapped);
});

test("配列の順序が違っても sort_order が同じ並びなら同じ版（入力順に依存しない）", () => {
  const a = q({ question_code: "pq1", question_text: "A", sort_order: 10 });
  const b = q({ question_code: "pq2", question_text: "B", sort_order: 11 });
  assert.equal(computeSurveyVersion([a, b]), computeSurveyVersion([b, a]));
});

test("固定設問（性年代）は版に影響しない", () => {
  const fixed = q({
    question_code: "__partner_gender__",
    question_text: "あなたの性別を教えてください。",
    sort_order: 1,
    is_fixed: true
  });
  // サーバーが毎回再構築する固定設問を含めると、誰も編集していないのに
  // 版が変わって競合し続けてしまう
  assert.equal(computeSurveyVersion([q()]), computeSurveyVersion([fixed, q()]));
});

test("question_code の振り直しは版に影響しない", () => {
  // 保存のたびに pq1,pq2... が振り直されるので、これを版に混ぜてはいけない
  assert.equal(
    computeSurveyVersion([q({ question_code: "pq1" })]),
    computeSurveyVersion([q({ question_code: "pq7" })])
  );
});

test("前後の空白・改行コードの揺れは版に影響しない", () => {
  assert.equal(
    computeSurveyVersion([q({ question_text: "満足度を教えてください" })]),
    computeSurveyVersion([q({ question_text: "  満足度を教えてください\r\n  " })])
  );
});

test("answer_options の null と [] は同じ版になる", () => {
  assert.equal(
    computeSurveyVersion([q({ question_type: "free_text", answer_options: null })]),
    computeSurveyVersion([q({ question_type: "free_text", answer_options: [] })])
  );
});

test("版は sha256: 前置きの16進64文字", () => {
  assert.match(computeSurveyVersion([q()]), /^sha256:[0-9a-f]{64}$/);
});

// ------------------------------------------------------------------
// 日付・時刻・期間（migration 118）
// ------------------------------------------------------------------

test("既存（日時系でない）設問の版は migration 118 の前後で1バイトも変わらない", () => {
  // 下の値は datetime_config 対応を入れる前のコードで計算した版。
  // ここが変わると、運用中の店舗アンケートが一斉に「誰も編集していないのに 409」になる。
  assert.equal(
    computeSurveyVersion([q()]),
    "sha256:db05effedcc68c786122211c8579c2a2bbfaf0a607270e851dde1634be1ced3b"
  );
  const num = q({
    question_code: "pq2",
    question_type: "numeric",
    question_text: "年齢",
    answer_options: null,
    min: 10,
    max: 99,
    unit: "歳",
    sort_order: 11
  });
  const ft = q({
    question_code: "pq3",
    question_type: "free_text",
    question_text: "ご意見",
    answer_options: null,
    sort_order: 12,
    is_required: false
  });
  assert.equal(
    computeSurveyVersion([q(), num, ft]),
    "sha256:7e12d57682273054217aa28b5312ffdbae9efb7f203c7e1114f4ca13ea20cbe2"
  );
});

test("日時系以外に datetime_config が紛れても版は変わらない", () => {
  assert.equal(
    computeSurveyVersion([q()]),
    computeSurveyVersion([q({ datetime_config: { date_max_offset: 0 } })])
  );
});

test("日時系は datetime_config の変更を検知し、空と未設定は同じ版", () => {
  const d = (cfg?: PartnerQuestionView["datetime_config"]) =>
    q({ question_type: "date", question_text: "来店日", answer_options: null, datetime_config: cfg });
  assert.equal(computeSurveyVersion([d()]), computeSurveyVersion([d({})]));
  assert.notEqual(computeSurveyVersion([d()]), computeSurveyVersion([d({ date_max_offset: 0 })]));
  assert.notEqual(
    computeSurveyVersion([d({ date_max_offset: 0 })]),
    computeSurveyVersion([d({ date_max_offset: 0, date_min_offset: -30 })])
  );
  // キーの並び順は版に影響しない
  assert.equal(
    computeSurveyVersion([d({ date_min_offset: -30, date_max_offset: 0 })]),
    computeSurveyVersion([d({ date_max_offset: 0, date_min_offset: -30 })])
  );
});
