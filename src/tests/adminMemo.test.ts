/**
 * adminMemo.test.ts
 *
 * 案件の運営者メモ（Migration 117）。正規化と、一覧のキーワード絞り込みがメモも拾うこと。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMIN_MEMO_MAX_LENGTH, normalizeAdminMemo } from "../lib/adminMemo";
import { EMPTY_FILTER, matchesProjectFilter } from "../lib/projectListFilter";

test("空・空白だけ・文字列以外は null（メモ削除）", () => {
  assert.equal(normalizeAdminMemo(""), null);
  assert.equal(normalizeAdminMemo("  \r\n  "), null);
  assert.equal(normalizeAdminMemo(undefined), null);
  assert.equal(normalizeAdminMemo(["a"]), null);
});

test("前後の空白を落とし、改行を LF に揃える", () => {
  assert.equal(normalizeAdminMemo("  検証用\r\n消してよい\r"), "検証用\n消してよい");
});

test("上限は 2000 文字", () => {
  assert.equal(ADMIN_MEMO_MAX_LENGTH, 2000);
});

test("キーワード絞り込みは案件名だけでなくメモも対象", () => {
  const filter = { ...EMPTY_FILTER, keyword: "差し替え前" };
  assert.equal(matchesProjectFilter({ name: "店舗アンケート (Copy)", admin_memo: "差し替え前の旧版" }, filter), true);
  assert.equal(matchesProjectFilter({ name: "店舗アンケート (Copy)", admin_memo: null }, filter), false);
  assert.equal(matchesProjectFilter({ name: "差し替え前テスト" }, filter), true, "名前一致は従来どおり");
});
