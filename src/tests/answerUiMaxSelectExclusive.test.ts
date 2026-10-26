/**
 * answerUiMaxSelectExclusive.test.ts
 *
 * 選択数上限（max_select）に達したあとでも、排他の選択肢（特になし 等）は選べることの回帰テスト。
 * 以前は上限チェックが排他解除より先に走り、3つ選んだ後に「特になし」を押すと
 * 「選べるのは3つまでです」で取り消されていた（2026-10-20 かすみがうら市水族館の検証で発覚）。
 * 実ブラウザでの挙動は別途確認する。ここでは判定の分岐だけを固定する。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

function loadAnswerUi(): any {
  const src = fs.readFileSync(path.join(process.cwd(), "src/views/partials/answer-ui.ejs"), "utf8");
  const m = src.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m);
  const sandbox: any = { window: {}, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(m![1]!, sandbox);
  return sandbox.window.AnswerUI;
}
const AnswerUI = loadAnswerUi();

/** 上限 max の入れ物に、checkedCount 個が ON の状態を作る最小のスタブ。 */
function setup(max: number, checkedCount: number, exclusive: boolean) {
  const holder = { getAttribute: () => String(max), nextElementSibling: { classList: { contains: () => true }, style: {} as any } };
  const changed: any = {
    checked: true,
    type: "checkbox",
    getAttribute: (name: string) => (name === "data-exclusive" && exclusive ? "1" : null),
    closest: (sel: string) => (sel === "[data-max-select]" ? holder : null),
  };
  const root = { querySelectorAll: () => Array.from({ length: checkedCount }, () => ({})) };
  return { root, changed };
}

test("上限を超える通常の選択肢は取り消す", () => {
  const { root, changed } = setup(3, 4, false);
  assert.equal(AnswerUI.enforceMaxSelect(root, changed, "Q9"), true);
  assert.equal(changed.checked, false);
});

test("排他の選択肢は上限に達していても取り消さない", () => {
  const { root, changed } = setup(3, 4, true);
  assert.equal(AnswerUI.enforceMaxSelect(root, changed, "Q9"), false);
  assert.equal(changed.checked, true);
});
