/**
 * 案件の配布用URL（QRの中身）の決定ルール。
 * 店舗専用は entry_code の専用URL、通常案件は案件詳細ページ。
 * 詳細ページは published × public × is_discoverable でしか開けないので、欠けたら警告を出す。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { env } from "../config/env";
import { resolveProjectDistribution } from "../lib/projectDistributionUrl";

const SURVEY_ID = "1234567890-abcdefgh";

function withSurveyLiff(run: () => void): void {
  const target = env as unknown as { LINE_LIFF_ID_SURVEY?: string };
  const saved = target.LINE_LIFF_ID_SURVEY;
  target.LINE_LIFF_ID_SURVEY = SURVEY_ID;
  try {
    run();
  } finally {
    target.LINE_LIFF_ID_SURVEY = saved;
  }
}

test("店舗専用＋entry_code は /liff/store 導線の恒久URL", () => {
  withSurveyLiff(() => {
    const d = resolveProjectDistribution({
      id: "p-1", status: "published", visibility_type: "private_store", entry_code: "nurse-amano"
    });
    assert.equal(d.kind, "store_entry");
    assert.ok(d.url?.startsWith(`https://liff.line.me/${SURVEY_ID}`));
    assert.equal(new URL(d.url!).searchParams.get("entry_code"), "nurse-amano");
    assert.deepEqual(d.warnings, []);
  });
});

test("店舗専用で entry_code 未設定なら URL は出さない", () => {
  const d = resolveProjectDistribution({ id: "p-1", status: "published", visibility_type: "private_store", entry_code: null });
  assert.equal(d.url, null);
  assert.equal(d.warnings.length, 1);
});

test("通常案件は案件詳細ページの恒久URL（公開中・一覧ONなら警告なし）", () => {
  withSurveyLiff(() => {
    const d = resolveProjectDistribution({ id: "p-1", status: "published", visibility_type: "public", is_discoverable: true });
    assert.equal(d.kind, "project_detail");
    assert.equal(d.url, `https://liff.line.me/${SURVEY_ID}/projects/p-1?liff_ctx=${SURVEY_ID}`);
    assert.deepEqual(d.warnings, []);
  });
});

test("通常案件でも未公開・一覧OFFなら QR は出すが警告する", () => {
  withSurveyLiff(() => {
    const d = resolveProjectDistribution({ id: "p-1", status: "draft", visibility_type: "public", is_discoverable: false });
    assert.ok(d.url);
    assert.equal(d.warnings.length, 2);
  });
});

test("デモ案件は公開区分・ステータス・一覧に関係なくデモ入口の恒久URLで、警告を出さない", () => {
  withSurveyLiff(() => {
    for (const visibility_type of ["public", "private_store"]) {
      const d = resolveProjectDistribution({
        id: "p-1", status: "draft", visibility_type, is_discoverable: false, entry_code: null, is_demo: true
      });
      assert.equal(d.kind, "demo_entry");
      assert.equal(d.url, `https://liff.line.me/${SURVEY_ID}?demo_project=p-1`);
      assert.deepEqual(d.warnings, []);
    }
  });
});

test("アーカイブ済みのデモ案件は QR から回答できないと警告する", () => {
  withSurveyLiff(() => {
    const d = resolveProjectDistribution({ id: "p-1", status: "archived", visibility_type: "public", is_demo: true });
    assert.equal(d.kind, "demo_entry");
    assert.equal(d.warnings.length, 1);
  });
});
