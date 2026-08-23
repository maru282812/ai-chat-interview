/**
 * screenSearch.test.ts
 *
 * 画面カタログのグローバル検索（src/services/adminChat/screenSearchService.ts）。
 * この関数は Phase 3 の `find_screen` ツールからも共用されるので、
 * **副作用なし・DB非依存の純関数** であることが前提。ここでも DB には触らない。
 *
 * 受入基準（計画書 Phase 2 の完了条件）:
 * - 「離脱」で /admin/cycles が上位に出る
 * - 「配信」で配信系が複数出る
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { ADMIN_SCREENS } from "../lib/adminScreenCatalog";
import { SCREEN_SEARCH_LIMIT, searchScreens } from "../services/adminChat/screenSearchService";

// ---------------------------------------------------------------------------
// 受入基準
// ---------------------------------------------------------------------------

test("「離脱」で /admin/cycles が上位に出る", () => {
  const results = searchScreens("離脱");
  assert.ok(results.length > 0, "「離脱」で候補が1件も出ていない");

  const index = results.findIndex((r) => r.url === "/admin/cycles");
  assert.ok(index >= 0, `/admin/cycles が候補に出ていない: ${results.map((r) => r.url).join(", ")}`);
  assert.ok(index < 3, `/admin/cycles が上位3件に入っていない（${index + 1}位）`);
});

test("「配信」で配信系が複数出る", () => {
  const results = searchScreens("配信");
  const deliveryUrls = results.filter((r) => r.group === "配信").map((r) => r.url);
  assert.ok(
    deliveryUrls.length >= 2,
    `配信グループの候補が複数出ていない: ${results.map((r) => `${r.group}:${r.url}`).join(", ")}`
  );
  // 配信オペレーションは配信系の入口なので候補に含まれること
  assert.ok(
    results.some((r) => r.url === "/admin/delivery-operations"),
    "配信オペレーションが候補に出ていない"
  );
});

// ---------------------------------------------------------------------------
// スコアリングの順序（label > synonyms > settings > description）
// ---------------------------------------------------------------------------

test("label 完全一致がフィールド下位のみの一致より上に来る", () => {
  // 「書類管理」は documents-index の label そのもの
  const results = searchScreens("書類管理");
  assert.equal(results[0]?.url, "/admin/documents");
  assert.ok(results[0]?.matchedOn.includes("label"));
});

test("settings に当たった画面は matchedOn と matchedTerms で理由が分かる", () => {
  const results = searchScreens("NGワード");
  const hit = results.find((r) => r.url === "/admin/data-management");
  assert.ok(hit, "NGワードで データ管理 が出ていない");
  assert.ok(hit?.matchedOn.includes("settings") || hit?.matchedOn.includes("synonyms"));
  assert.ok((hit?.matchedTerms.length ?? 0) > 0, "当たった語が返っていない");
});

test("matchedOn は重みの高い順（label→synonyms→settings→description）に並ぶ", () => {
  const order = ["label", "synonyms", "settings", "description"];
  for (const q of ["配信", "設定", "書類", "品質"]) {
    for (const result of searchScreens(q)) {
      const positions = result.matchedOn.map((f) => order.indexOf(f));
      const sorted = [...positions].sort((a, b) => a - b);
      assert.deepEqual(positions, sorted, `${q} / ${result.key} の matchedOn の順序が崩れている`);
    }
  }
});

test("スコアは降順で返る", () => {
  const results = searchScreens("設定");
  for (let i = 1; i < results.length; i += 1) {
    assert.ok(
      (results[i - 1]?.score ?? 0) >= (results[i]?.score ?? 0),
      "スコア降順になっていない"
    );
  }
});

// ---------------------------------------------------------------------------
// 索引ページ自身が引ける（Phase 2 で追加したエントリ）
// ---------------------------------------------------------------------------

test("「索引」で設定の索引ページが出る", () => {
  const results = searchScreens("索引");
  assert.ok(
    results.some((r) => r.url === "/admin/screen-index"),
    "設定の索引がカタログから引けていない"
  );
});

// ---------------------------------------------------------------------------
// 入力の境界
// ---------------------------------------------------------------------------

test("空文字・空白のみ・非文字列は空配列（例外を投げない）", () => {
  assert.deepEqual(searchScreens(""), []);
  assert.deepEqual(searchScreens("   "), []);
  assert.deepEqual(searchScreens("　"), []); // 全角空白
  assert.deepEqual(searchScreens(undefined as unknown as string), []);
  assert.deepEqual(searchScreens(null as unknown as string), []);
});

test("該当が無ければ空配列を返す（無理なフォールバックをしない）", () => {
  assert.deepEqual(searchScreens("zzzzzこんな語は台帳に無いzzzzz"), []);
});

test("上位8件までに絞る", () => {
  // 「設定」は多くの画面に含まれるので上限に当たる
  const results = searchScreens("設定");
  assert.ok(results.length <= SCREEN_SEARCH_LIMIT);
  assert.equal(searchScreens("設定", 3).length, Math.min(3, results.length));
});

test("空白区切りは OR で加点する（片方しか当たらなくても 0 件にしない）", () => {
  const results = searchScreens("離脱 サイクル");
  assert.ok(results.some((r) => r.url === "/admin/cycles"));
});

test("大文字小文字を区別しない（英字キー・synonyms 用）", () => {
  const lower = searchScreens("dashboard").map((r) => r.key);
  const upper = searchScreens("DASHBOARD").map((r) => r.key);
  assert.deepEqual(upper, lower);
  assert.ok(lower.includes("dashboard"));
});

// ---------------------------------------------------------------------------
// 純関数であることの担保（Phase 3 の find_screen が同じ関数を呼ぶ）
// ---------------------------------------------------------------------------

test("カタログを書き換えない（返り値を変更しても次回の結果に影響しない）", () => {
  const before = searchScreens("配信");
  const first = before[0];
  assert.ok(first);
  first.label = "MUTATED";
  first.matchedTerms.push("MUTATED");

  const after = searchScreens("配信");
  assert.notEqual(after[0]?.label, "MUTATED");
  assert.ok(!after[0]?.matchedTerms.includes("MUTATED"));

  // 台帳側も無傷であること
  assert.ok(!ADMIN_SCREENS.some((s) => s.label === "MUTATED"));
});

test("同じクエリを2回呼んでも同じ結果（状態を持たない）", () => {
  const a = searchScreens("品質").map((r) => r.key);
  const b = searchScreens("品質").map((r) => r.key);
  assert.deepEqual(a, b);
});

test("返す url はカタログの path と一致する（サーバー計算値のみ）", () => {
  const paths = new Set(ADMIN_SCREENS.map((s) => s.path));
  for (const q of ["配信", "離脱", "書類", "品質", "設定"]) {
    for (const result of searchScreens(q)) {
      assert.ok(paths.has(result.url), `${result.url} がカタログに無い URL`);
    }
  }
});
