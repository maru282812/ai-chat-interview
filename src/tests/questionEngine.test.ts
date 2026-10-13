import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyCarryForward,
  evaluatePipeExpression,
  resolveQuestionView,
} from "../lib/questionEngine";
import type { QuestionOption } from "../types/domain";
import type { AnswerContext } from "../types/questionSchema";

const opt = (value: string, label = value): QuestionOption => ({ value, label });

const ctxOf = (answers: AnswerContext["answers"]): AnswerContext => ({ answers });

// 最小の設問オブジェクト（resolveQuestionView は Pick で受ける）
function q(overrides: Partial<Parameters<typeof resolveQuestionView>[0]>) {
  return {
    question_code: "q2",
    question_text: "",
    comment_top: null,
    comment_bottom: null,
    visibility_conditions: null,
    display_tags_parsed: null,
    question_config: null,
    ...overrides,
  } as Parameters<typeof resolveQuestionView>[0];
}

// ------------------------------------------------------------------
// applyCarryForward
// ------------------------------------------------------------------

test("carry-forward selected: 前問で選んだ value だけを並び順を保って残す", () => {
  const options = [opt("A"), opt("B"), opt("C"), opt("D")];
  const ctx = ctxOf({ q1: ["C", "D"] });
  const result = applyCarryForward(options, { fromQuestion: "q1", mode: "selected" }, ctx);
  assert.deepEqual(result.map((o) => o.value), ["C", "D"]);
});

test("carry-forward unselected: 選ばれなかったものだけ残す", () => {
  const options = [opt("A"), opt("B"), opt("C"), opt("D")];
  const ctx = ctxOf({ q1: ["C", "D"] });
  const result = applyCarryForward(options, { fromQuestion: "q1", mode: "unselected" }, ctx);
  assert.deepEqual(result.map((o) => o.value), ["A", "B"]);
});

test("carry-forward: 参照元が JSON 文字列でも配列として解釈する", () => {
  const options = [opt("A"), opt("B"), opt("C")];
  const ctx = ctxOf({ q1: '["A","C"]' });
  const result = applyCarryForward(options, { fromQuestion: "q1", mode: "selected" }, ctx);
  assert.deepEqual(result.map((o) => o.value), ["A", "C"]);
});

test("carry-forward: 参照元未回答なら selected=空 / unselected=全件", () => {
  const options = [opt("A"), opt("B")];
  const ctx = ctxOf({});
  assert.deepEqual(applyCarryForward(options, { fromQuestion: "q1", mode: "selected" }, ctx), []);
  assert.deepEqual(
    applyCarryForward(options, { fromQuestion: "q1", mode: "unselected" }, ctx).map((o) => o.value),
    ["A", "B"]
  );
});

test("carry-forward: source 未指定なら素通し", () => {
  const options = [opt("A"), opt("B")];
  assert.deepEqual(applyCarryForward(options, undefined, ctxOf({})), options);
});

// ------------------------------------------------------------------
// resolveQuestionView
// ------------------------------------------------------------------

test("resolveQuestionView: visibility_conditions で不可視を返す", () => {
  const view = resolveQuestionView(
    q({ visibility_conditions: [{ type: "pipe_expression", expression: "q1=2" }] }),
    ctxOf({ q1: "1" })
  );
  assert.equal(view.visible, false);
});

test("resolveQuestionView: <ans> を設問文と選択肢ラベルへ差し込む", () => {
  const view = resolveQuestionView(
    q({
      question_text: "<ans q1> と答えたあなたへ",
      display_tags_parsed: {
        answerInsertions: [{ source: "q1", target: "question_text" }],
      },
      question_config: { options: [opt("x", "答え: <ans q1>")] } as never,
    }),
    ctxOf({ q1: "はい" })
  );
  assert.equal(view.questionText, "はい と答えたあなたへ");
  assert.equal(view.options[0]?.label, "答え: はい");
});

test("resolveQuestionView: <disable> で選択肢を除外する", () => {
  const view = resolveQuestionView(
    q({
      question_config: { options: [opt("A"), opt("B"), opt("C")] } as never,
      display_tags_parsed: {
        disableRules: [{ targetChoice: "B", condition: "q1=1" }],
      },
    }),
    ctxOf({ q1: "1" })
  );
  assert.deepEqual(view.options.map((o) => o.value), ["A", "C"]);
});

test("resolveQuestionView: carry-forward → disable の順で適用される", () => {
  const view = resolveQuestionView(
    q({
      question_config: { options: [opt("A"), opt("B"), opt("C"), opt("D")] } as never,
      display_tags_parsed: {
        optionSource: { fromQuestion: "q1", mode: "selected" },
        disableRules: [{ targetChoice: "C", condition: "q1 includes C" }],
      },
    }),
    ctxOf({ q1: ["C", "D"] })
  );
  // 持ち越しで C,D → disable で C 除外 → D のみ
  assert.deepEqual(view.options.map((o) => o.value), ["D"]);
});

// ------------------------------------------------------------------
// 日付・時刻の比較（migration 118）: 同じ ISO 形式どうしは文字列比較
// ------------------------------------------------------------------

test("evaluatePipeExpression: 日付は年だけでなく月日まで比べる", () => {
  const ctx = ctxOf({ q1: "2026-10-13" });
  // parseFloat だと 2026 > 2026 = false になっていた
  assert.equal(evaluatePipeExpression("q1>2026-10-01", ctx).visible, true);
  assert.equal(evaluatePipeExpression("q1<2026-10-01", ctx).visible, false);
  assert.equal(evaluatePipeExpression("q1>=2026-10-13", ctx).visible, true);
  assert.equal(evaluatePipeExpression("q1<=2026-10-12", ctx).visible, false);
  assert.equal(evaluatePipeExpression("q1=2026-10-13", ctx).visible, true);
});

test("evaluatePipeExpression: 時刻・日時の比較", () => {
  assert.equal(evaluatePipeExpression("q1>=18:00", ctxOf({ q1: "18:30" })).visible, true);
  // parseFloat だと 9 < 18 で true になる。文字列比較なら "09:30" < "18:00"
  assert.equal(evaluatePipeExpression("q1<18:00", ctxOf({ q1: "09:30" })).visible, true);
  assert.equal(evaluatePipeExpression("q1>18:00", ctxOf({ q1: "09:30" })).visible, false);
  assert.equal(
    evaluatePipeExpression("q1>2026-10-13T12:00", ctxOf({ q1: "2026-10-13T14:30" })).visible,
    true,
  );
});

test("evaluatePipeExpression: 数値の比較は従来どおり数値で", () => {
  assert.equal(evaluatePipeExpression("q1>9", ctxOf({ q1: "10" })).visible, true);
  assert.equal(evaluatePipeExpression("q1<=3", ctxOf({ q1: "3" })).visible, true);
});
