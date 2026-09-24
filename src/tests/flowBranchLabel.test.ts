/**
 * flowBranchLabel.test.ts
 *
 * フロー設計画面（flowCanvas.js）の分岐ポートに、選択肢ラベルが出ることの回帰テスト。
 *
 * 背景:
 *   分岐ノードの出力ポートは 14px の緑丸だけで、どの選択肢の出口かが図から読めなかった。
 *   手掛かりは hover の title 属性のみで、その中身も getBranchLabel が返す "=1" のような
 *   条件の生値だった（question_config.options を引いていなかった）。結果として
 *   「選択肢が出ないから線が引けない」状態になっていた。
 *
 *   branch.when の値は保存経路によって「選択肢の value（label と同じ文字列）」のことも
 *   「1始まりの選択肢番号」のこともあるため、value 一致 → 番号 の順に解決する。
 *
 * flowCanvas.js はブラウザ用の IIFE で export を持たないため、対象関数のソースだけを
 * 取り出して vm で評価する（answerUiFreeText.test.ts と同じ方式）。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const FLOW_CANVAS = path.join(process.cwd(), "src/public/flowCanvas.js");

/** flowCanvas.js から分岐ラベル解決まわりの関数を取り出して評価する。 */
function loadBranchLabelFns(): {
  getBranchLabel: (branch: unknown, q: unknown) => string;
  resolveOptionLabel: (q: unknown, value: unknown) => string;
  getBranchChoiceOptions: (q: unknown) => Array<{ cond: string; altCond: string; label: string }>;
  condMatchesChoice: (cond: string, choice: unknown) => boolean;
  branchCondToString: (b: unknown) => string;
} {
  const src = fs.readFileSync(FLOW_CANVAS, "utf8");
  const names = [
    "resolveOptionLabel", "truncLabel", "getBranchChoiceOptions",
    "condMatchesChoice", "branchCondToString", "getBranchLabel",
  ];
  const sandbox: Record<string, unknown> = {};
  vm.createContext(sandbox);

  for (const name of names) {
    // 関数宣言を先頭から波括弧の対応で切り出す（正規表現だけでは本体の } を取り違えるため）
    const start = src.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `flowCanvas.js に ${name} が見つかりません`);
    let depth = 0;
    let end = -1;
    for (let i = src.indexOf("{", start); i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") {
        depth--;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    assert.ok(end > start, `${name} の本体を切り出せませんでした`);
    vm.runInContext(`${src.slice(start, end)}; this.${name} = ${name};`, sandbox);
  }

  return sandbox as never;
}

const { getBranchLabel, resolveOptionLabel, getBranchChoiceOptions, condMatchesChoice, branchCondToString } =
  loadBranchLabelFns();

const SALON_Q = {
  question_config: {
    options: [
      { value: "この美容室", label: "この美容室" },
      { value: "別の美容室", label: "別の美容室" },
      { value: "利用していない", label: "利用していない" },
    ],
  },
};

test("equals: 選択肢の value 一致でラベルを返す（条件の生値を出さない）", () => {
  const label = getBranchLabel({ when: { equals: "別の美容室" } }, SALON_Q);
  assert.equal(label, "別の美容室");
  assert.ok(!label.startsWith("="), "条件の生値 '=' 形式が残っています");
});

test("equals: 1始まりの選択肢番号でもラベルへ解決する（旧データの equals:1 形式）", () => {
  assert.equal(getBranchLabel({ when: { equals: 1 } }, SALON_Q), "この美容室");
  assert.equal(getBranchLabel({ when: { equals: "3" } }, SALON_Q), "利用していない");
});

test("any_of: 複数の選択肢ラベルを並べて返す", () => {
  assert.equal(
    getBranchLabel({ when: { any_of: ["この美容室", "別の美容室"] } }, SALON_Q),
    "この美容室 / 別の美容室",
  );
});

test("選択肢に当たらない値はそのまま返す（自由記述・数値条件を壊さない）", () => {
  assert.equal(getBranchLabel({ when: { equals: "未知の値" } }, SALON_Q), "未知の値");
  assert.equal(getBranchLabel({ when: { gte: 5 } }, SALON_Q), "≥5");
  assert.equal(getBranchLabel({ when: { lte: 2 } }, SALON_Q), "≤2");
});

test("選択肢を持たない設問でも落ちず、値をそのまま返す", () => {
  const freeText = { question_config: {} };
  assert.equal(getBranchLabel({ when: { equals: "はい" } }, freeText), "はい");
  assert.equal(resolveOptionLabel(freeText, "はい"), "はい");
  assert.equal(resolveOptionLabel(undefined, "はい"), "はい");
});

test("value と label が違う選択肢は label を出す", () => {
  const q = { question_config: { options: [{ value: "opt_a", label: "とても満足" }] } };
  assert.equal(getBranchLabel({ when: { equals: "opt_a" } }, q), "とても満足");
});

test("条件セレクトの選択肢は equals: 形式の value と表示ラベルを返す", () => {
  const choices = getBranchChoiceOptions(SALON_Q);
  assert.equal(choices.length, 3);
  // vm サンドボックス由来のオブジェクトは prototype が別 realm のため deepStrictEqual が通らない。
  // 比較したいのは中身なのでフィールドを個別に見る。
  assert.equal(choices[1]?.cond, "equals:別の美容室");
  assert.equal(choices[1]?.label, "別の美容室");
});

test("branchCondToString は collectRpData が解釈できる文字列に戻す", () => {
  assert.equal(branchCondToString({ when: { equals: "はい" } }), "equals:はい");
  assert.equal(branchCondToString({ when: { any_of: ["a", "b"] } }), "any_of:a,b");
  assert.equal(branchCondToString({ when: { gte: 3 } }), "gte:3");
  assert.equal(branchCondToString({}), "");
});

test("条件セレクトの value は branchCondToString と往復できる（選択の既定が外れない）", () => {
  // 保存済み branch を編集画面で開いたとき、セレクトが正しく selected になる前提
  const branch = { when: { equals: "別の美容室" } };
  const condStr = branchCondToString(branch);
  const choices = getBranchChoiceOptions(SALON_Q);
  assert.ok(choices.some((c) => c.cond === condStr), "保存済み条件に一致するセレクト項目がありません");
});

/**
 * 本番データ（美容室C Q5-Q7）は条件が 1始まりの選択肢番号で入っている。
 * 条件セレクトがこれを「選択肢外」に落とすと、再保存時に番号がラベル文字列へ
 * 書き換わり、保存し直しただけで分岐条件が黙って変わってしまう。
 */
test("保存済みの equals:<番号> 形式も、その選択肢に一致と判定する", () => {
  const choices = getBranchChoiceOptions(SALON_Q);
  assert.ok(condMatchesChoice("equals:1", choices[0]), "equals:1 が1件目の選択肢に一致しません");
  assert.ok(condMatchesChoice("equals:2", choices[1]), "equals:2 が2件目の選択肢に一致しません");
  // value 表記でも一致する
  assert.ok(condMatchesChoice("equals:別の美容室", choices[1]));
  // 別の選択肢には一致しない
  assert.equal(condMatchesChoice("equals:1", choices[1]), false);
  assert.equal(condMatchesChoice("", choices[0]), false);
});

test("番号表記と value 表記は同じ選択肢を指し、重複生成されない", () => {
  const choices = getBranchChoiceOptions(SALON_Q);
  const alreadySaved = ["equals:1"];
  const dup = choices.filter((c) => alreadySaved.some((v) => condMatchesChoice(v, c)));
  assert.equal(dup.length, 1, "equals:1 が一致する選択肢は1件だけのはず");
  assert.equal(dup[0]?.label, "この美容室");
});
