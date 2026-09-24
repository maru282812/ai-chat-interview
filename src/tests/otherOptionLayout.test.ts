/**
 * otherOptionLayout.test.ts
 *
 * 「その他」等の自由記述つき選択肢が、カード枠からはみ出さない形で描かれることの回帰テスト。
 *
 * 背景（実機で発覚）:
 *   選択肢カード .choice-item / .chip-item は flex-direction:row（横並び）。
 *   そこへ width:100% の記述欄をラベルと同じ行に入れていたため、
 *     - 入力欄がカードの右枠を飛び出す
 *     - 押し潰されたラベルが1文字ずつ折り返される（「そ / の / 他」）
 *   という崩れが出ていた。日本語は文字間どこでも改行できるため、
 *   flex の min-width:auto と相まって最小幅まで縮む。
 *
 *   修正は「記述欄つきの選択肢だけ縦積みにする」。判定は allow_free_text 一本
 *   （ラベル文字列は見ない＝「その他」以外の自由記述にも効かせる）。
 *
 * 判定は CSS の計算結果ではなくマークアップの契約で行う。
 * 実際の見た目は実機（モバイル実ブラウザ）で確認する。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const SURVEY = path.join(process.cwd(), "src/views/liff/survey.ejs");
const PARTIAL = path.join(process.cwd(), "src/views/partials/answer-ui.ejs");

const surveySrc = fs.readFileSync(SURVEY, "utf8");
const partialSrc = fs.readFileSync(PARTIAL, "utf8");

/** answer-ui.ejs の <script> から AnswerUI を組み立てる（answerUiFreeText.test.ts と同じ手口）。 */
function loadAnswerUi(): any {
  const m = partialSrc.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "answer-ui.ejs から <script> を取り出せませんでした");
  const sandbox: any = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(m?.[1] ?? "", sandbox);
  return sandbox.window.AnswerUI;
}

const AnswerUI = loadAnswerUi();
const OTHER = { value: "other", label: "その他", allow_free_text: true };
const PLAIN = { value: "finish", label: "仕上がり" };

// ---- survey.ejs: 標準のリスト選択肢（実機で崩れていた本体） ----

test("survey.ejs: 自由記述つき選択肢に has-freetext が付く", () => {
  // choiceListItem は survey.ejs 内の関数なので、マークアップ生成式を直接確認する。
  assert.match(
    surveySrc,
    /class="choice-item\$\{c\.imageUrl \? ' has-img' : ''\}\$\{c\.allow_free_text \? ' has-freetext' : ''\}"/,
    "allow_free_text の選択肢に has-freetext が付くこと"
  );
});

test("survey.ejs: has-freetext が入力欄を次の行へ送る CSS を持つ", () => {
  assert.match(
    surveySrc,
    /\.choice-item\.has-freetext\s*\{[^}]*flex-wrap:\s*wrap/,
    ".choice-item.has-freetext は折り返しを許すこと"
  );
  assert.match(
    surveySrc,
    /\.choice-item\.has-freetext \.other-text-input\s*\{[^}]*flex:\s*1 0 100%/,
    "記述欄が一行を独占すること（ラベルと同じ行に入ると両方潰れる）"
  );
});

test("survey.ejs: ラベルが1文字ずつ潰れないよう min-width:0 を持つ", () => {
  assert.match(
    surveySrc,
    /\.choice-label\s*\{[^}]*min-width:\s*0/,
    "flex の min-width:auto のままだと日本語ラベルが最小幅まで縮む"
  );
});

test("survey.ejs: リスト選択肢の記述欄に inline width:100% を残さない", () => {
  // 横並びの親では gap/padding 分あふれるため、幅は CSS(max-width:100%) に任せる。
  const listItem = surveySrc.match(/function choiceListItem\(inputEl, c\) \{[\s\S]*?\n    \}/);
  assert.ok(listItem, "choiceListItem を取り出せませんでした");
  assert.doesNotMatch(listItem?.[0] ?? "", /width:100%/);
});

// ---- answer-ui.ejs: chip_select（ピル型チップ） ----

test("chip_select: 自由記述つきチップは行を独占する縦積みカードになる", () => {
  const html: string = AnswerUI.build(
    { question_code: "Q9", question_text: "設問", question_config: {} },
    [PLAIN, OTHER],
    "chip_select"
  );
  assert.ok(html, "HTML が生成されませんでした");

  // 記述欄つきのチップにだけ has-freetext が付く。
  assert.match(html, /class="card-item chip-item has-freetext"/);
  const plainChip = html.match(/class="card-item chip-item"/g) ?? [];
  assert.equal(plainChip.length, 1, "通常チップは has-freetext を持たないこと");
});

test("chip_select: has-freetext がピルを縦積みへ切り替える CSS を持つ", () => {
  assert.match(
    partialSrc,
    /\.answer-chips \.chip-item\.has-freetext\s*\{[^}]*flex-direction:\s*column/,
    "ピルのままだと記述欄が横に入り、はみ出す"
  );
  assert.match(
    partialSrc,
    /\.answer-chips \.chip-item\.has-freetext\s*\{[^}]*flex:\s*1 0 100%/,
    "1行を独占すること"
  );
});

test("answer-ui.ejs: 記述欄は親カードからはみ出さない基底 CSS を持つ", () => {
  assert.match(
    partialSrc,
    /\.other-text-input\s*\{[^}]*max-width:\s*100%/,
    "max-width が無いと横並びの親であふれる"
  );
});

test("answer-ui.ejs: 生成された記述欄に inline width:100% が付かない", () => {
  // 横並びの親では gap/padding 分あふれるため、幅は CSS(max-width:100%) に任せる。
  const html: string = AnswerUI.build(
    { question_code: "Q9", question_text: "設問", question_config: {} },
    [PLAIN, OTHER],
    "chip_select"
  );
  const input = html.match(/<input type="text" class="other-text-input[^>]*>/);
  assert.ok(input, "記述欄が描かれていません");
  assert.doesNotMatch(input?.[0] ?? "", /width:\s*100%/);
});
