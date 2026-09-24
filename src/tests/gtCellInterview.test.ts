/**
 * GT集計表とセル抽出の突合ロジックのテスト
 *
 * このテストが守っているのは「表のセルの人数と、そこから抽出される人数が一致する」こと。
 * 顧客は「492人」というセルを見てインタビューを実施するので、抽出が480人だと信用が失われる。
 *
 * 確認項目:
 * 1. 単一選択が value / label のどちらで保存されていても同じ選択肢に寄る
 * 2. 複数選択のカンマ連結が分解される（1人が複数選択肢に計上される）
 * 3. %の分母は n（有効回答数）であり、選択肢件数の合計ではない
 * 4. 選択肢に無い値（自由記述・古い値）は捨てられる
 * 5. value にカンマを含む選択肢は完全一致で拾える（連結分解で壊さない）
 * 6. normalized_answer があればそれを優先し、カンマ分解しない
 * 7. 小N抑制: n < SMALL_N_THRESHOLD の行は % を出さない（件数は出す）
 * 8. 選択肢を持たない設問（自由記述）には % を出さない
 * 9. GT表のセルの件数と、同じ条件での抽出判定が一致する（最重要）
 */

import assert from "node:assert/strict";
import test from "node:test";
import {
  answerSelectedOption,
  buildOptionIndex,
  countAnsweredAny,
  countByOption,
  selectedOptionValues
} from "../lib/answerOptionMatch";
import { SMALL_N_THRESHOLD, buildGtQuestionTable } from "../lib/gtTable";
import type { Answer, Question, QuestionOption } from "../types/domain";


/** 添字アクセスの undefined を潰すヘルパー（strict モードのテスト用）。 */
function must<T>(value: T | undefined | null, label: string): T {
  assert.ok(value !== undefined && value !== null, `${label} が存在しません`);
  return value;
}

const OPTIONS: QuestionOption[] = [
  { value: "a", label: "大きなスクリーン" },
  { value: "b", label: "好きな俳優" },
  { value: "c", label: "一人で思いっきり" }
];

function makeQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q-1",
    project_id: "p-1",
    question_code: "Q1",
    question_text: "映画館の楽しみは？",
    question_type: "multi_choice",
    sort_order: 1,
    question_config: { options: OPTIONS },
    ...overrides
  } as Question;
}

function makeAnswer(overrides: Partial<Answer> = {}): Answer {
  return {
    id: `a-${Math.random()}`,
    session_id: "s-1",
    question_id: "q-1",
    answer_text: "",
    answer_role: "primary",
    normalized_answer: null,
    created_at: "2026-09-24T00:00:00.000Z",
    ...overrides
  } as Answer;
}

test("value でも label でも同じ選択肢に寄る", () => {
  const index = buildOptionIndex(OPTIONS);

  const byValue = selectedOptionValues(makeAnswer({ answer_text: "a" }), index);
  const byLabel = selectedOptionValues(makeAnswer({ answer_text: "大きなスクリーン" }), index);

  assert.deepEqual([...byValue], ["a"]);
  assert.deepEqual([...byLabel], ["a"]);
});

test("複数選択のカンマ連結が分解される", () => {
  const index = buildOptionIndex(OPTIONS);
  const selected = selectedOptionValues(makeAnswer({ answer_text: "a,c" }), index);

  assert.deepEqual([...selected].sort(), ["a", "c"]);
});

test("カンマ連結にラベルが混ざっても分解される", () => {
  const index = buildOptionIndex(OPTIONS);
  const selected = selectedOptionValues(
    makeAnswer({ answer_text: "大きなスクリーン, 一人で思いっきり" }),
    index
  );

  assert.deepEqual([...selected].sort(), ["a", "c"]);
});

test("選択肢に無い値は捨てる（自由記述や古い値で件数を汚さない）", () => {
  const index = buildOptionIndex(OPTIONS);
  const selected = selectedOptionValues(makeAnswer({ answer_text: "a,存在しない選択肢" }), index);

  assert.deepEqual([...selected], ["a"]);
});

test("value にカンマを含む選択肢は完全一致で拾える", () => {
  // 入力側でカンマは禁止するが、既存データに残っていても壊れないことを保証する。
  const options: QuestionOption[] = [{ value: "x,y", label: "カンマ入り" }];
  const index = buildOptionIndex(options);

  const selected = selectedOptionValues(makeAnswer({ answer_text: "x,y" }), index);
  assert.deepEqual([...selected], ["x,y"]);
});

test("normalized_answer があれば優先し、カンマ分解しない", () => {
  const index = buildOptionIndex(OPTIONS);
  const selected = selectedOptionValues(
    makeAnswer({
      answer_text: "無視されるべき値",
      normalized_answer: { labels: ["大きなスクリーン", "好きな俳優"] }
    }),
    index
  );

  assert.deepEqual([...selected].sort(), ["a", "b"]);
});

test("%の分母は n であり、選択肢件数の合計ではない", () => {
  const question = makeQuestion();
  // 2人。1人目は2つ選び、2人目は1つ選ぶ → 件数合計3 だが n は 2。
  const answers = [
    makeAnswer({ answer_text: "a,b" }),
    makeAnswer({ answer_text: "a" })
  ];

  const n = countAnsweredAny(answers, OPTIONS);
  assert.equal(n, 2);

  const counts = countByOption(answers, OPTIONS);
  assert.equal(counts.get("a"), 2);
  assert.equal(counts.get("b"), 1);
  assert.equal(counts.get("c"), 0);

  // 合計は 3。分母に使うと 66.7% + 33.3% = 100% になってしまい、
  // 「a を選んだ人が全体の何%か」を表さなくなる。
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  assert.equal(total, 3);

  const table = buildGtQuestionTable(question, [
    { answer: must(answers[0], "answers[0]"), profile: null, answeredAt: null },
    { answer: must(answers[1], "answers[1]"), profile: null, answeredAt: null }
  ]);

  const row = must(table.rows[0], "総数行");
  assert.equal(row.n, 2);
  // n<10 なので小N抑制が効く。抑制を確認する別テストで % の値を検証する。
  assert.equal(row.suppressed, true);
});

test("小N抑制: n が閾値未満なら % を出さないが件数は出す", () => {
  const question = makeQuestion();
  const answers = Array.from({ length: SMALL_N_THRESHOLD - 1 }, () =>
    makeAnswer({ answer_text: "a" })
  );

  const table = buildGtQuestionTable(
    question,
    answers.map((answer) => ({ answer, profile: null, answeredAt: null }))
  );

  const row = must(table.rows[0], "総数行");
  const cell = must(row.cells[0], "セル");
  assert.equal(row.n, SMALL_N_THRESHOLD - 1);
  assert.equal(row.suppressed, true);
  assert.equal(cell.count, SMALL_N_THRESHOLD - 1, "件数は出す");
  assert.equal(cell.percent, null, "% はマスクする");
});

test("閾値以上なら % を出す（分母は n）", () => {
  const question = makeQuestion();
  // 10人。うち4人が a、10人全員が c を選ぶ。
  const answers = [
    ...Array.from({ length: 4 }, () => makeAnswer({ answer_text: "a,c" })),
    ...Array.from({ length: 6 }, () => makeAnswer({ answer_text: "c" }))
  ];

  const table = buildGtQuestionTable(
    question,
    answers.map((answer) => ({ answer, profile: null, answeredAt: null }))
  );

  const row = must(table.rows[0], "総数行");
  const cellA = must(row.cells[0], "セルa");
  const cellC = must(row.cells[2], "セルc");
  assert.equal(row.n, 10);
  assert.equal(row.suppressed, false);
  assert.equal(cellA.count, 4);
  assert.equal(cellA.percent, 40, "4/10 = 40%");
  assert.equal(cellC.count, 10);
  assert.equal(cellC.percent, 100, "10/10 = 100%");
});

test("選択肢を持たない設問には % を出さない（自由記述を比率で語らせない）", () => {
  const question = makeQuestion({
    question_type: "free_text_long",
    question_config: {}
  });

  const answers = Array.from({ length: 20 }, () =>
    makeAnswer({ answer_text: "自由記述の回答" })
  );

  const table = buildGtQuestionTable(
    question,
    answers.map((answer) => ({ answer, profile: null, answeredAt: null }))
  );

  assert.equal(table.ratio_allowed, false);
  assert.ok(table.notice, "理由を注記として返す");
  assert.equal(table.options.length, 0);
  // 選択肢が無いので行は立つが列が無い（比率の出しようがない）。
  for (const row of table.rows) {
    for (const cell of row.cells) {
      assert.equal(cell.percent, null);
    }
  }
});

test("GT表のセルの件数と、抽出の判定が一致する（最重要）", () => {
  const question = makeQuestion();

  // 表記の揺れを全部混ぜる。ここが一致しないと顧客に見せた人数で配信できない。
  const answers = [
    ...Array.from({ length: 5 }, () => makeAnswer({ answer_text: "c" })),
    ...Array.from({ length: 3 }, () => makeAnswer({ answer_text: "a,c" })),
    ...Array.from({ length: 2 }, () => makeAnswer({ answer_text: "一人で思いっきり" })),
    ...Array.from({ length: 2 }, () =>
      makeAnswer({ answer_text: "", normalized_answer: { values: ["c"] } })
    ),
    // c を選んでいない人（母集団に入ってはいけない）
    ...Array.from({ length: 4 }, () => makeAnswer({ answer_text: "b" }))
  ];

  const table = buildGtQuestionTable(
    question,
    answers.map((answer) => ({ answer, profile: null, answeredAt: null }))
  );

  const cIndex = table.options.findIndex((option) => option.value === "c");
  const cellCount = must(must(table.rows[0], "総数行").cells[cIndex], "セルc").count;

  // 抽出側（cellInterviewService が使うのと同じ判定）で数える。
  const index = buildOptionIndex(OPTIONS);
  const extracted = answers.filter((answer) => answerSelectedOption(answer, index, "c")).length;

  assert.equal(cellCount, 12, "5 + 3 + 2 + 2 = 12");
  assert.equal(extracted, cellCount, "表のセルと抽出人数は必ず一致する");
});

test("属性ブレークの行が立ち、総数行と併存する", () => {
  const question = makeQuestion();

  const male = { line_user_id: "u1", gender: "male", birth_date: null } as never;
  const female = { line_user_id: "u2", gender: "female", birth_date: null } as never;

  const table = buildGtQuestionTable(
    question,
    [
      { answer: makeAnswer({ answer_text: "a" }), profile: male, answeredAt: null },
      { answer: makeAnswer({ answer_text: "a" }), profile: female, answeredAt: null }
    ],
    ["total", "sex"]
  );

  const total = table.rows.find((row) => row.axis === "total");
  const sexRows = table.rows.filter((row) => row.axis === "sex");

  assert.ok(total, "総数行がある");
  assert.equal(total?.n, 2);
  assert.equal(sexRows.length, 2, "男性・女性の2行");
  // 属性行の n の合計は総数と一致する（プロフィール未登録がいない場合）
  assert.equal(
    sexRows.reduce((sum, row) => sum + row.n, 0),
    total?.n
  );
});

test("プロフィール未登録は属性ブレークの行に計上されない（総数には残る）", () => {
  const question = makeQuestion();

  const table = buildGtQuestionTable(
    question,
    [
      { answer: makeAnswer({ answer_text: "a" }), profile: null, answeredAt: null },
      {
        answer: makeAnswer({ answer_text: "a" }),
        profile: { line_user_id: "u1", gender: "male", birth_date: null } as never,
        answeredAt: null
      }
    ],
    ["total", "sex"]
  );

  const total = table.rows.find((row) => row.axis === "total");
  const sexRows = table.rows.filter((row) => row.axis === "sex");

  assert.equal(total?.n, 2, "総数は2人");
  assert.equal(
    sexRows.reduce((sum, row) => sum + row.n, 0),
    1,
    "属性が分かる1人だけが性別行に立つ"
  );
});
