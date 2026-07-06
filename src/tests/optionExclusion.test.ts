import assert from "node:assert/strict";
import { test } from "node:test";
import { conflicts, findExclusionViolation } from "../lib/optionExclusion";
import type { QuestionOption } from "../types/domain";

const opt = (label: string, extra: Partial<QuestionOption> = {}): QuestionOption => ({
  label,
  value: label,
  ...extra,
});

test("全排他(exclusive)は他の全選択肢と衝突する", () => {
  const none = opt("特になし", { exclusive: true });
  const a = opt("A");
  const b = opt("B");
  assert.equal(conflicts(none, a), true);
  assert.equal(conflicts(none, b), true);
  assert.equal(conflicts(a, b), false);
  // 自分自身とは衝突しない
  assert.equal(conflicts(none, none), false);
});

test("部分排他(exclusive_with)は無向で効く（片側定義でOK）", () => {
  const b = opt("B", { exclusive_with: ["C", "D"] });
  const c = opt("C"); // C 側には何も定義していない
  const d = opt("D");
  const e = opt("E");
  assert.equal(conflicts(b, c), true, "B→C 定義が C→B にも効く");
  assert.equal(conflicts(c, b), true, "逆向きでも効く");
  assert.equal(conflicts(b, d), true);
  assert.equal(conflicts(b, e), false);
  assert.equal(conflicts(c, d), false);
});

test("findExclusionViolation: 違反があれば最初のペアのラベルを返す", () => {
  const options = [
    opt("A"),
    opt("B", { exclusive_with: ["C"] }),
    opt("C"),
    opt("特になし", { exclusive: true }),
  ];
  // B と C を同時選択 → 違反
  assert.deepEqual(findExclusionViolation(["B", "C"], options), ["B", "C"]);
  // 特になし と A → 違反
  assert.deepEqual(findExclusionViolation(["A", "特になし"], options), ["A", "特になし"]);
  // A と B のみ → 違反なし
  assert.equal(findExclusionViolation(["A", "B"], options), null);
  // 単一選択 → 違反なし
  assert.equal(findExclusionViolation(["特になし"], options), null);
});

test("findExclusionViolation: options に無い値（その他自由記述の生テキスト）はスキップ", () => {
  const options = [opt("A"), opt("その他", { exclusive: true, allow_free_text: true })];
  // 「その他」は exclusive だが、送信値が生テキスト（=options に無い value）なら対象外
  assert.equal(findExclusionViolation(["A", "自由に書いた内容"], options), null);
  // ラベルそのまま "その他" が送られてきた場合は排他判定対象
  assert.deepEqual(findExclusionViolation(["A", "その他"], options), ["A", "その他"]);
});
