/**
 * Phase E: プロンプトパッケージ作成UI 再設計
 *
 * 1. generatePackageSlug: パッケージ名から URL 用 slug を自動生成（利用者は slug を意識しない）
 * 2. resolveVersionCopySource: 「既存パッケージへの Version 追加」のコピー元解決
 *    （公開中 / 最新（draft含む）/ 空）
 * 3. resolveUniquePackageSlug: 既存 slug と衝突する場合 base-2, base-3, ... と連番付与
 */

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_BASIC_USER ||= "admin";
process.env.ADMIN_BASIC_PASSWORD ||= "password";

import { generatePackageSlug, resolveUniquePackageSlug, resolveVersionCopySource } from "../controllers/adminController";

// ─── 1. generatePackageSlug ──────────────────────────────────────────────────

test("E1: 英語名はそのまま slug 化（小文字・ハイフン区切り）", () => {
  assert.equal(generatePackageSlug("Website Hunter"), "website-hunter");
  assert.equal(generatePackageSlug("Beauty Salon Site"), "beauty-salon-site");
});

test("E2: 記号・連続スペースは1つのハイフンに畳み、前後は除去", () => {
  assert.equal(generatePackageSlug("  Foo / Bar!!  "), "foo-bar");
  assert.equal(generatePackageSlug("A___B"), "a-b");
});

test("E3: 日本語のみ等で生成できない場合は package- フォールバック", () => {
  const slug = generatePackageSlug("美容室サイト制作");
  assert.match(slug, /^package-[a-z0-9]+$/);
});

test("E4: 空文字も package- フォールバック", () => {
  assert.match(generatePackageSlug(""), /^package-[a-z0-9]+$/);
});

// ─── 2. resolveVersionCopySource ─────────────────────────────────────────────

type V = { id: string; status: string; version_no: number };
// version_no 降順（listVersions の並び）
const versions: V[] = [
  { id: "v3", status: "draft", version_no: 3 },
  { id: "v2", status: "published", version_no: 2 },
  { id: "v1", status: "archived", version_no: 1 },
];

test("E5: copy_published は公開中バージョンを返す", () => {
  assert.equal(resolveVersionCopySource(versions, "copy_published")?.id, "v2");
});

test("E6: copy_latest は draft を含む最新（先頭）を返す", () => {
  assert.equal(resolveVersionCopySource(versions, "copy_latest")?.id, "v3");
});

test("E7: empty は null（空で作成）", () => {
  assert.equal(resolveVersionCopySource(versions, "empty"), null);
});

test("E8: 公開中が無い場合 copy_published は null", () => {
  const noPublished: V[] = [{ id: "v1", status: "draft", version_no: 1 }];
  assert.equal(resolveVersionCopySource(noPublished, "copy_published"), null);
});

test("E9: バージョンが空なら copy_latest も null", () => {
  assert.equal(resolveVersionCopySource([], "copy_latest"), null);
});

// ─── 3. resolveUniquePackageSlug ─────────────────────────────────────────────

test("E10: 未使用の base はそのまま返す", () => {
  assert.equal(resolveUniquePackageSlug("beauty-salon", []), "beauty-salon");
  assert.equal(resolveUniquePackageSlug("beauty-salon", ["other"]), "beauty-salon");
});

test("E11: 衝突時は -2 から連番を付ける", () => {
  assert.equal(resolveUniquePackageSlug("beauty-salon", ["beauty-salon"]), "beauty-salon-2");
  assert.equal(
    resolveUniquePackageSlug("beauty-salon", ["beauty-salon", "beauty-salon-2"]),
    "beauty-salon-3",
  );
});

test("E12: 連番の歯抜けがあっても最小の未使用番号を選ぶ", () => {
  // -2 が空いていれば -3 が埋まっていても -2 を返す
  assert.equal(
    resolveUniquePackageSlug("beauty-salon", ["beauty-salon", "beauty-salon-3"]),
    "beauty-salon-2",
  );
});

test("E13: フォールバック slug にも連番で衝突回避できる", () => {
  const base = generatePackageSlug("美容室サイト制作");
  assert.equal(resolveUniquePackageSlug(base, [base]), `${base}-2`);
});
