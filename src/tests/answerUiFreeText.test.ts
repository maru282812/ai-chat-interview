/**
 * answerUiFreeText.test.ts
 *
 * 「その他」等の自由記述つき選択肢を、スワイプ/スライド系のパターンで描かせないことの回帰テスト。
 *
 * 背景:
 *   sort_swipe は選択肢を1枚ずつカードにして左右に振り分けさせるが、「その他（　）」の
 *   カードを◯に倒しても記述欄が出ず、回答者が具体的な内容を書けないまま値だけが入っていた。
 *   カードを倒す/スライダーを動かすジェスチャーには「文字を入力する」余地が無いため、
 *   設問全体の指示がスワイプでも自由記述つき選択肢だけはタップ+入力欄で受ける。
 *
 * 判定は allow_free_text 一本（ラベル文字列は見ない）。「その他」以外の自由記述にも効かせるため。
 *
 * ここでは答え合わせを HTML 文字列で行う。実挙動（振り分け結果とその他記述の合流・
 * 記述前に次へ進まないこと）は実ブラウザで確認済み。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const PARTIAL = path.join(process.cwd(), "src/views/partials/answer-ui.ejs");

/** answer-ui.ejs の <script> 部分だけを取り出し、AnswerUI を組み立てて返す。 */
function loadAnswerUi(): any {
  const src = fs.readFileSync(PARTIAL, "utf8");
  const m = src.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, "answer-ui.ejs から <script> を取り出せませんでした");
  const sandbox: any = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(m?.[1] ?? "", sandbox);
  assert.ok(sandbox.window.AnswerUI, "AnswerUI が定義されていません");
  return sandbox.window.AnswerUI;
}

const AnswerUI = loadAnswerUi();
const Q = { question_code: "Q1", question_text: "設問", question_config: {} };
const OTHER = { value: "other", label: "その他", allow_free_text: true };
const plain = (n: number) =>
  Array.from({ length: n }, (_v, i) => ({ value: `v${i}`, label: `選択肢${i}` }));

/** 描かれたパターンを HTML のルートクラスから判定する。 */
function kindOf(html: string | null): string {
  assert.ok(html, "HTML が生成されませんでした");
  const h = html!;
  if (h.includes("answer-swipe")) return "swipe_card";
  if (h.includes("answer-splitswipe")) return "split_swipe";
  if (h.includes("answer-bigslider")) return "big_slider";
  if (h.includes("answer-sortswipe")) return "sort_swipe";
  if (h.includes("answer-carousel")) return "carousel";
  if (h.includes("answer-tapcards")) return "tap_cards";
  if (h.includes("answer-split")) return "big_split";
  return "unknown";
}

test("swipe_card: 自由記述つき選択肢を含むならタップ系へ降格する", () => {
  const html = AnswerUI.build(Q, [{ value: "yes", label: "はい" }, OTHER], "swipe_card");
  assert.equal(kindOf(html), "tap_cards");
  assert.ok(html.includes("other-text-input"), "自由記述欄が出ていません");
});

test("split_swipe: 自由記述つき選択肢を含むならタップ系へ降格する", () => {
  const html = AnswerUI.build(Q, [{ value: "yes", label: "はい" }, OTHER], "split_swipe");
  assert.equal(kindOf(html), "tap_cards");
  assert.ok(html.includes("other-text-input"), "自由記述欄が出ていません");
});

test("big_slider: 自由記述つき選択肢を含むならタップ系へ降格する（順序尺度に「その他」は混ぜない）", () => {
  const html = AnswerUI.build(Q, [...plain(4), OTHER], "big_slider");
  assert.equal(kindOf(html), "tap_cards");
  assert.ok(html.includes("other-text-input"), "自由記述欄が出ていません");
});

test("sort_swipe: 自由記述つき選択肢はデッキから外し、下のタップ+入力欄で受ける", () => {
  const html = AnswerUI.build(Q, [...plain(3), OTHER], "sort_swipe");
  assert.equal(kindOf(html), "sort_swipe");
  // デッキのカードは3枚（その他は入らない）
  assert.equal((html.match(/class="sort-card"/g) ?? []).length, 3);
  assert.ok(!/<span class="sort-title">その他</.test(html), "その他がデッキに入っています");
  // その他は専用の行＋入力欄として出る
  assert.ok(html.includes("answer-freetext-rows"), "その他の行が出ていません");
  assert.ok(html.includes("other-text-input"), "自由記述欄が出ていません");
});

test("sort_swipe: 自由記述が無ければ従来どおり（その他の行を作らない）", () => {
  const html = AnswerUI.build(Q, plain(3), "sort_swipe");
  assert.equal(kindOf(html), "sort_swipe");
  assert.equal((html.match(/class="sort-card"/g) ?? []).length, 3);
  assert.ok(!html.includes("answer-freetext-rows"), "不要な自由記述行が出ています");
});

test("スワイプ系（自由記述なし）は降格しない＝今回の変更が通常経路を壊していない", () => {
  assert.equal(kindOf(AnswerUI.build(Q, plain(2), "swipe_card")), "swipe_card");
  assert.equal(kindOf(AnswerUI.build(Q, plain(2), "split_swipe")), "split_swipe");
  assert.equal(kindOf(AnswerUI.build(Q, plain(5), "big_slider")), "big_slider");
});

test("carousel は従来どおりカード内に入力欄を持つ（タップCTA確定なので降格不要）", () => {
  const html = AnswerUI.build(Q, [...plain(3), OTHER], "carousel");
  assert.equal(kindOf(html), "carousel");
  assert.ok(html.includes("carousel-other"), "カード内の自由記述欄が出ていません");
});

test("判定は allow_free_text 一本＝ラベルが「その他」でも記述無効なら降格しない", () => {
  const labeledButNoFreeText = { value: "other", label: "その他" };
  const html = AnswerUI.build(Q, [{ value: "yes", label: "はい" }, labeledButNoFreeText], "swipe_card");
  assert.equal(kindOf(html), "swipe_card");
});
