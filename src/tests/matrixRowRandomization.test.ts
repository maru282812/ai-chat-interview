/**
 * matrixRowRandomization.test.ts
 *
 * マトリクスの行ランダム化（surveyOrderingService.applyOptionRandomization）。
 *
 * 回答は {行index: 列index} で保存される（survey.ejs の mq_<code>_<ri>）。
 * 行を並べ替えたまま位置を index にすると、回答者ごとに行の意味がズレて集計が壊れる。
 * 並べ替えた行には必ず row_index（元の位置）が付き、クライアントはそれを保存キーに使う。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { surveyOrderingService } from "../services/surveyOrderingService";
import type { Project, Question, Session } from "../types/domain";

const rows = ["parking", "homepage", "payment", "cleanliness", "smell"].map((v) => ({ value: v, label: v }));

function matrixQuestion(overrides: Partial<Question> = {}): Question {
  return {
    id: "q-11",
    project_id: "p-1",
    question_code: "Q11",
    question_text: "印象",
    question_type: "matrix_single",
    is_required: true,
    sort_order: 1,
    question_config: {
      matrix_rows: rows,
      matrix_cols: [{ value: "good", label: "良い" }, { value: "bad", label: "悪い" }],
      option_randomization: {
        enabled: true,
        randomize_groups: true,
        groups: [
          { label: "1", values: ["parking"] },
          { label: "2", values: ["homepage"] },
          { label: "3", values: ["payment"] },
          { label: "5", values: ["cleanliness", "smell"] },
        ],
      },
    },
    ...overrides,
  } as Question;
}

const project = { id: "p-1", randomize_question_order: false } as Project;

async function resolve(question: Question, sessionId: string) {
  const session = { id: sessionId, display_order_json: null } as unknown as Session;
  const out = await surveyOrderingService.resolveOrder({ session, project, questions: [question], pageGroups: [] });
  return out.questions[0]!;
}

test("行がランダム化され、各行に元の位置 row_index が付く", async () => {
  let varied = false;
  for (const sid of ["s1", "s2", "s3", "s4", "s5", "s6"]) {
    const q = await resolve(matrixQuestion(), sid);
    const out = q.question_config!.matrix_rows!;
    assert.equal(out.length, rows.length);
    for (const row of out) {
      const original = rows.findIndex((r) => r.value === row.value);
      assert.equal(row.row_index, original, `${sid}: ${row.value} の row_index が元の位置でない`);
    }
    // 5.1 / 5.2 は隣り合う
    const ci = out.findIndex((r) => r.value === "cleanliness");
    const si = out.findIndex((r) => r.value === "smell");
    assert.equal(Math.abs(ci - si), 1, `${sid}: 同じ群が分断された`);
    if (out[0]!.value !== "parking") varied = true;
  }
  assert.ok(varied, "行が一度もシャッフルされていない");
});

test("同じセッションなら何度解決しても同じ並び（決定的）", async () => {
  const a = await resolve(matrixQuestion(), "same");
  const b = await resolve(matrixQuestion(), "same");
  assert.deepEqual(
    a.question_config!.matrix_rows!.map((r) => r.value),
    b.question_config!.matrix_rows!.map((r) => r.value),
  );
});

test("行が options に入っているマトリクスでも同じく row_index が付く（survey.ejs は matrix_rows || options）", async () => {
  const q = await resolve(
    matrixQuestion({ question_config: { ...matrixQuestion().question_config, matrix_rows: undefined, options: rows } }),
    "s-opts",
  );
  const out = q.question_config!.options!;
  assert.equal(out.length, rows.length);
  for (const row of out) assert.equal(row.row_index, rows.findIndex((r) => r.value === row.value));
  assert.equal(q.question_config!.matrix_rows, undefined);
});

test("ランダム化が無効なら行はそのまま・row_index も付かない（後方互換）", async () => {
  const q = await resolve(
    matrixQuestion({ question_config: { matrix_rows: rows, matrix_cols: [], option_randomization: { enabled: false } } }),
    "s-off",
  );
  const out = q.question_config!.matrix_rows!;
  assert.deepEqual(out.map((r) => r.value), rows.map((r) => r.value));
  assert.ok(out.every((r) => r.row_index === undefined));
});

test("通常の選択肢（multi_choice）は従来どおり options を並べ替え、row_index は付かない", async () => {
  const q = await resolve(
    matrixQuestion({
      question_type: "multi_choice",
      question_config: {
        options: rows,
        option_randomization: { enabled: true, anchored_values: ["smell"] },
      },
    }),
    "s-mc",
  );
  const out = q.question_config!.options!;
  assert.equal(out[out.length - 1]!.value, "smell", "アンカーは元の位置（末尾）");
  assert.ok(out.every((r) => r.row_index === undefined));
});
