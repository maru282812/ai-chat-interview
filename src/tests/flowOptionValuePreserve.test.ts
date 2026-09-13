/**
 * flowOptionValuePreserve.test.ts
 *
 * フロー設計画面の保存が、選択肢の value（識別子）を壊さないことの回帰テスト。
 *
 * 背景（実際に起きた事故）:
 *   seed は Q5 に {value:"yes", label:"はい（この店／別の店）"} を入れ、
 *   Q6 の表示条件を "q5=yes" と書いていた。ところがフロー設計画面は
 *   ラベル配列しか送らず、サーバーが {label, value: label} で作り直していたため、
 *   一度保存しただけで value が "はい（この店／別の店）" に化けた。
 *   実行時の判定は文字列比較なので "q5=yes" は二度と一致せず、
 *   Q5-Q7 の分岐と出し分けが本番で全滅した（画面にはエラーも出ない）。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { mergeOptionLabelsPreservingValues } from "../controllers/adminController";

const SALON_Q5 = [
  { value: "yes", label: "はい（この店／別の店）" },
  { value: "no", label: "いいえ" },
];

test("ラベルだけ送られても既存の value を保つ（条件が指す識別子を壊さない）", () => {
  const merged = mergeOptionLabelsPreservingValues(
    ["はい（この店／別の店）", "いいえ"],
    SALON_Q5,
  );
  assert.deepEqual(merged, [
    { label: "はい（この店／別の店）", value: "yes" },
    { label: "いいえ", value: "no" },
  ]);
});

test("選択肢の並べ替えでも、ラベル一致で value が付いてくる", () => {
  const merged = mergeOptionLabelsPreservingValues(["いいえ", "はい（この店／別の店）"], SALON_Q5);
  assert.deepEqual(merged, [
    { label: "いいえ", value: "no" },
    { label: "はい（この店／別の店）", value: "yes" },
  ]);
});

test("ラベルの誤字修正は、同じ位置の選択肢として value を保つ", () => {
  const merged = mergeOptionLabelsPreservingValues(["はい（この店・別の店）", "いいえ"], SALON_Q5);
  assert.equal(merged[0]?.value, "yes", "誤字修正で value が変わってはいけない");
  assert.equal(merged[0]?.label, "はい（この店・別の店）");
  assert.equal(merged[1]?.value, "no");
});

test("新規追加された選択肢にはラベル由来の value を与える", () => {
  const merged = mergeOptionLabelsPreservingValues(
    ["はい（この店／別の店）", "いいえ", "おぼえていない"],
    SALON_Q5,
  );
  assert.deepEqual(merged.map((o) => o.value), ["yes", "no", "おぼえていない"]);
});

test("選択肢を削除しても残りの value は保たれる", () => {
  const merged = mergeOptionLabelsPreservingValues(["いいえ"], SALON_Q5);
  assert.deepEqual(merged, [{ label: "いいえ", value: "no" }]);
});

test("value が重複しない（同じ value を2つの選択肢に割り当てない）", () => {
  const prev = [
    { value: "same", label: "A" },
    { value: "same", label: "B" }, // 壊れた既存データを想定
  ];
  const merged = mergeOptionLabelsPreservingValues(["A", "B"], prev);
  assert.equal(new Set(merged.map((o) => o.value)).size, 2, "value が重複しています");
});

test("既存が空（新規設問）ならラベルがそのまま value になる", () => {
  const merged = mergeOptionLabelsPreservingValues(["はい", "いいえ"], []);
  assert.deepEqual(merged, [
    { label: "はい", value: "はい" },
    { label: "いいえ", value: "いいえ" },
  ]);
});

test("空文字・空白だけのラベルは落とす", () => {
  const merged = mergeOptionLabelsPreservingValues(["はい（この店／別の店）", "  ", ""], SALON_Q5);
  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.value, "yes");
});

/**
 * 上のテストは純関数を直接呼ぶので、apiUpdateQuestionFlow が
 * 「その関数を使うのをやめて自前でラベルから value を作り直す」形に戻されても気付けない。
 * 事故はまさにその形だったので、呼び出し側も固定する。
 */
test("フロー保存APIは選択肢を自前で作り直さず、value 保持関数を通す", () => {
  const src = fs.readFileSync(
    path.join(process.cwd(), "src/controllers/adminController.ts"),
    "utf8",
  );
  const start = src.indexOf("apiUpdateQuestionFlow");
  assert.ok(start >= 0, "apiUpdateQuestionFlow が見つかりません");
  // 関数の中身をざっくり切り出す（次のトップレベル定義まで）
  const body = src.slice(start, start + 8000);

  assert.ok(
    body.includes("mergeOptionLabelsPreservingValues"),
    "apiUpdateQuestionFlow が mergeOptionLabelsPreservingValues を通していません",
  );
  // ラベルをそのまま value にする書き方が復活していないこと
  assert.ok(
    !/\.map\(\(label\) => \(\{ label: label\.trim\(\), value: label\.trim\(\) \}\)\)/.test(body),
    "選択肢の value をラベルから作り直すコードが復活しています（表示条件・分岐が壊れます）",
  );
});
