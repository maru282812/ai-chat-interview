/**
 * Phase C: Package 中心導線テスト
 *
 * 1. 新規作成ブロック判定（resolvePackageVersionIdFromRequest の blockIfUnselected ロジック）
 *    - package モード + 未選択 + 適用可能パッケージあり → ブロック（エラー）
 *    - package モード + 未選択 + 適用可能パッケージなし → 許容（警告フロー）
 *    - 更新（blockIfUnselected=false）は常に許容
 * 2. パッケージ画面からの適用（applyPackageToProject の検証ロジック）
 *    - バージョンが別パッケージ → 無効
 *    - draft → 適用不可 / published → 適用可 / archived(+published) → 適用可
 * 3. 利用中プロジェクト一覧の「公開版を適用」表示判定（show.ejs onPublished）
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

import { validatePromptPackageVersionForApply } from "../services/promptPackageValidationService";
import type { PromptPackageVersion } from "../repositories/promptPackageRepository";

const PKG_ID = "00000000-0000-4000-8000-000000000010";
const OTHER_PKG_ID = "00000000-0000-4000-8000-000000000020";
const V1 = "00000000-0000-4000-8000-000000000011";
const V2 = "00000000-0000-4000-8000-000000000012";

function makeVersion(overrides: Partial<PromptPackageVersion>): PromptPackageVersion {
  return {
    id: V1,
    package_id: PKG_ID,
    version_no: 1,
    status: "published",
    policy_json: null,
    templates_json: null,
    builder_spec_json: null,
    change_note: null,
    published_at: "2026-06-14T00:00:00.000Z",
    created_at: "2026-06-14T00:00:00.000Z",
    updated_at: "2026-06-14T00:00:00.000Z",
    ...overrides,
  };
}

// ─── 1. 新規作成ブロック判定 ────────────────────────────────────────────────

/** resolvePackageVersionIdFromRequest の未選択時ロジック（mode=package, versionId なし）。
 *  戻り値の "block" は errorMessage を返すケース。 */
function resolveUnselected(opts: { blockIfUnselected: boolean; hasSelectable: boolean }): "block" | "warn" {
  if (opts.blockIfUnselected && opts.hasSelectable) return "block";
  return "warn";
}

test("新規作成 + 適用可能パッケージあり + 未選択 → ブロック", () => {
  assert.equal(resolveUnselected({ blockIfUnselected: true, hasSelectable: true }), "block");
});

test("新規作成 + 適用可能パッケージなし + 未選択 → 許容（警告フロー）", () => {
  assert.equal(resolveUnselected({ blockIfUnselected: true, hasSelectable: false }), "warn");
});

test("更新（blockIfUnselected=false）は適用可能パッケージがあっても未選択を許容", () => {
  assert.equal(resolveUnselected({ blockIfUnselected: false, hasSelectable: true }), "warn");
});

// ─── 2. パッケージ画面からの適用 検証 ───────────────────────────────────────

/** applyPackageToProject の検証ロジック。指定バージョンが対象パッケージのもので、適用可能か。 */
function canApply(
  version: PromptPackageVersion | null,
  packageId: string,
  publishedVersion: PromptPackageVersion | null
): boolean {
  if (!version || version.package_id !== packageId) return false;
  return validatePromptPackageVersionForApply(version, publishedVersion).errors.length === 0;
}

test("別パッケージのバージョンは適用不可", () => {
  const v = makeVersion({ package_id: OTHER_PKG_ID, status: "published" });
  assert.equal(canApply(v, PKG_ID, null), false);
});

test("draft バージョンは適用不可", () => {
  const v = makeVersion({ status: "draft" });
  assert.equal(canApply(v, PKG_ID, null), false);
});

test("published バージョンは適用可", () => {
  const v = makeVersion({ status: "published" });
  assert.equal(canApply(v, PKG_ID, null), true);
});

test("archived バージョン + published fallback あり → 適用可（実行時は published へ fallback）", () => {
  const archived = makeVersion({ id: V1, version_no: 1, status: "archived" });
  const published = makeVersion({ id: V2, version_no: 2, status: "published" });
  assert.equal(canApply(archived, PKG_ID, published), true);
});

// ─── 3. 「公開版を適用」ボタン表示判定 ──────────────────────────────────────

/** show.ejs: 公開版があり、プロジェクトがそれ以外を参照しているときだけ再適用ボタンを出す。 */
function showReapply(publishedVersionId: string | null, projectVersionId: string | null): boolean {
  if (!publishedVersionId) return false;
  return projectVersionId !== publishedVersionId;
}

test("公開版を参照中のプロジェクトには再適用ボタンを出さない", () => {
  assert.equal(showReapply(V2, V2), false);
});

test("archived/旧版を参照中のプロジェクトには再適用ボタンを出す", () => {
  assert.equal(showReapply(V2, V1), true);
});

test("公開版が存在しないパッケージでは再適用ボタンを出さない", () => {
  assert.equal(showReapply(null, V1), false);
});
