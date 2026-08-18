/**
 * projectListFilter.test.ts
 *
 * 案件一覧の絞り込み（Migration 096）。
 *
 * 店舗展開で案件は「店舗数 × A/B/C」に増える。絞り込みが取りこぼすと
 * 「案件が消えた」ように見えるので、特に **どのフィルタでも出てこない案件が
 * 生まれないこと** を厚めに固定する。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  EMPTY_FILTER,
  filterProjectRows,
  hasActiveFilter,
  matchesProjectFilter,
  parseProjectListFilter,
  type FilterableProject,
} from "../lib/projectListFilter";

const p = (over: Partial<FilterableProject> = {}): FilterableProject => ({
  store_id: null,
  industry_template_id: null,
  template_step_role: null,
  name: "案件",
  status: "published",
  ...over,
});

const SALON = "tpl-salon";
const SHIBUYA = "store-shibuya";

// ------------------------------------------------------------------
// クエリの解釈
// ------------------------------------------------------------------

test("空クエリは絞り込みなし", () => {
  const f = parseProjectListFilter({});
  assert.deepEqual(f, EMPTY_FILTER);
  assert.equal(hasActiveFilter(f), false);
});

test("空文字は「指定なし」として扱う（select の「すべて」）", () => {
  const f = parseProjectListFilter({ industry: "", store: "  ", q: "" });
  assert.equal(hasActiveFilter(f), false);
});

test("指定があれば拾う", () => {
  const f = parseProjectListFilter({ industry: SALON, store: SHIBUYA, role: "entry", q: " 渋谷 ", status: "published" });
  assert.equal(f.industry, SALON);
  assert.equal(f.store, SHIBUYA);
  assert.equal(f.role, "entry");
  assert.equal(f.keyword, "渋谷", "前後の空白は落とす");
  assert.equal(hasActiveFilter(f), true);
});

// ------------------------------------------------------------------
// 絞り込み本体
// ------------------------------------------------------------------

test("業種で絞れる", () => {
  const f = parseProjectListFilter({ industry: SALON });
  assert.equal(matchesProjectFilter(p({ industry_template_id: SALON }), f), true);
  assert.equal(matchesProjectFilter(p({ industry_template_id: "tpl-nail" }), f), false);
});

test("店舗で絞れる", () => {
  const f = parseProjectListFilter({ store: SHIBUYA });
  assert.equal(matchesProjectFilter(p({ store_id: SHIBUYA }), f), true);
  assert.equal(matchesProjectFilter(p({ store_id: "store-shinjuku" }), f), false);
});

test("役割（A/B/C・原本）で絞れる", () => {
  const f = parseProjectListFilter({ role: "entry" });
  assert.equal(matchesProjectFilter(p({ template_step_role: "entry" }), f), true);
  assert.equal(matchesProjectFilter(p({ template_step_role: "verify" }), f), false);
});

test("「店舗なし」で従来の通常案件を拾える（取り残しを防ぐ）", () => {
  // 店舗展開前からある案件は store_id=null。これを探せないと
  // 「案件が消えた」ように見えるので明示的に拾えること。
  const f = parseProjectListFilter({ store: "none" });
  assert.equal(matchesProjectFilter(p({ store_id: null }), f), true);
  assert.equal(matchesProjectFilter(p({ store_id: SHIBUYA }), f), false);
});

test("「業種なし」「サイクル外」も同様に拾える", () => {
  assert.equal(
    matchesProjectFilter(p({ industry_template_id: null }), parseProjectListFilter({ industry: "none" })),
    true
  );
  assert.equal(
    matchesProjectFilter(p({ template_step_role: null }), parseProjectListFilter({ role: "none" })),
    true
  );
});

test("案件名の部分一致は大文字小文字を無視する", () => {
  const f = parseProjectListFilter({ q: "SALON" });
  assert.equal(matchesProjectFilter(p({ name: "yotto-salon-a 案件" }), f), true);
  assert.equal(matchesProjectFilter(p({ name: "ネイル案件" }), f), false);
});

test("状態で絞れる", () => {
  const f = parseProjectListFilter({ status: "draft" });
  assert.equal(matchesProjectFilter(p({ status: "draft" }), f), true);
  assert.equal(matchesProjectFilter(p({ status: "published" }), f), false);
});

test("複数条件は AND で効く", () => {
  const f = parseProjectListFilter({ industry: SALON, role: "entry" });
  assert.equal(
    matchesProjectFilter(p({ industry_template_id: SALON, template_step_role: "entry" }), f),
    true
  );
  assert.equal(
    matchesProjectFilter(p({ industry_template_id: SALON, template_step_role: "verify" }), f),
    false
  );
});

// ------------------------------------------------------------------
// 一覧への適用
// ------------------------------------------------------------------

test("絞り込み無しなら元の配列をそのまま返す", () => {
  const rows = [{ project: p() }, { project: p() }];
  assert.equal(filterProjectRows(rows, EMPTY_FILTER, (r) => r.project), rows);
});

test("30店舗規模でも目的の店舗だけに絞れる", () => {
  // 30店舗 × A/B/C = 90件を作り、1店舗ぶん（3件）に絞れること。
  const rows = [];
  for (let i = 0; i < 30; i++) {
    for (const role of ["entry", "followup", "verify"]) {
      rows.push({ project: p({ store_id: `store-${i}`, industry_template_id: SALON, template_step_role: role }) });
    }
  }
  assert.equal(rows.length, 90);

  const only = filterProjectRows(rows, parseProjectListFilter({ store: "store-7" }), (r) => r.project);
  assert.equal(only.length, 3, "1店舗のA/B/Cだけになること");

  const entries = filterProjectRows(rows, parseProjectListFilter({ role: "entry" }), (r) => r.project);
  assert.equal(entries.length, 30, "全店舗のAだけを横断で見られること");
});

test("どのフィルタにも当たらない案件が生まれない（全件が「すべて」で出る）", () => {
  const rows = [
    { project: p({ store_id: SHIBUYA, industry_template_id: SALON, template_step_role: "entry" }) },
    { project: p({ store_id: null, industry_template_id: null, template_step_role: null }) },
    { project: p({ store_id: null, industry_template_id: SALON, template_step_role: "template" }) },
  ];
  assert.equal(filterProjectRows(rows, EMPTY_FILTER, (r) => r.project).length, 3);

  // 店舗フィルタの「すべて」と「店舗なし」の和が全件を覆うこと
  const withStore = filterProjectRows(rows, parseProjectListFilter({ store: SHIBUYA }), (r) => r.project);
  const noStore = filterProjectRows(rows, parseProjectListFilter({ store: "none" }), (r) => r.project);
  assert.equal(withStore.length + noStore.length, 3, "どちらにも入らない案件があってはいけない");
});
