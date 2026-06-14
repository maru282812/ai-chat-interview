/**
 * Phase G: custom モード整理（Package First 化）テスト
 *
 * 確認項目:
 * 1. custom プロジェクトの分類と推奨アクション（本文直持ち / policy のみ / 設定なし）
 * 2. package モード×バージョン未設定 → packageUnset
 * 3. archived バージョン参照 → archivedRef（fallback 先あり/なし）
 * 4. orphan 参照（draft / 削除済み）→ orphanRef
 * 5. published 参照は対応不要（どのカテゴリにも入らない）
 * 6. counts.needsAttention が重複なし件数で算出される
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildPromptMigrationReport,
  type MigrationProjectInput,
  type ReferencedVersionMeta,
} from "../services/promptMigrationService";

function project(over: Partial<MigrationProjectInput> & { id: string; name: string }): MigrationProjectInput {
  return {
    status: "active",
    ai_prompt_mode: "package",
    ai_prompt_package_version_id: null,
    ai_prompt_policy_json: null,
    ai_prompt_templates_json: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Test 1: custom 分類と推奨アクション
// ---------------------------------------------------------------------------
test("PhaseG: custom プロジェクトを本文/policy 有無で分類し推奨を付与する", () => {
  const report = buildPromptMigrationReport({
    projects: [
      project({ id: "c1", name: "本文直持ち", ai_prompt_mode: "custom", ai_prompt_templates_json: { buildProbePrompt: { enabled: true, template: "x" } } }),
      project({ id: "c2", name: "policyのみ", ai_prompt_mode: "custom", ai_prompt_policy_json: { audience: "women" } }),
      project({ id: "c3", name: "設定なし", ai_prompt_mode: "custom" }),
      project({ id: "c4", name: "null扱い", ai_prompt_mode: null }),
    ],
    versionMetaById: new Map(),
    publishedVersionNoByPackage: new Map(),
  });

  assert.equal(report.customProjects.length, 4);
  const c1 = report.customProjects.find((r) => r.id === "c1")!;
  assert.equal(c1.hasTemplates, true);
  assert.match(c1.suggestion, /専用パッケージ/);

  const c2 = report.customProjects.find((r) => r.id === "c2")!;
  assert.equal(c2.hasTemplates, false);
  assert.equal(c2.hasPolicy, true);
  assert.match(c2.suggestion, /オーバーライド/);

  const c3 = report.customProjects.find((r) => r.id === "c3")!;
  assert.equal(c3.hasPolicy, false);
  assert.match(c3.suggestion, /割り当てるだけ/);

  // null mode も custom として分類
  assert.ok(report.customProjects.some((r) => r.id === "c4"));
  assert.equal(report.counts.custom, 4);
});

// ---------------------------------------------------------------------------
// Test 2: 空 policy / 空 templates は「持たない」扱い
// ---------------------------------------------------------------------------
test("PhaseG: 空オブジェクトの policy/templates は保有なしと判定する", () => {
  const report = buildPromptMigrationReport({
    projects: [
      project({ id: "e1", name: "空", ai_prompt_mode: "custom", ai_prompt_policy_json: {}, ai_prompt_templates_json: {} }),
    ],
    versionMetaById: new Map(),
    publishedVersionNoByPackage: new Map(),
  });
  const e1 = report.customProjects[0]!;
  assert.equal(e1.hasPolicy, false);
  assert.equal(e1.hasTemplates, false);
});

// ---------------------------------------------------------------------------
// Test 3: package 未設定
// ---------------------------------------------------------------------------
test("PhaseG: package モードでバージョン未設定は packageUnset に入る", () => {
  const report = buildPromptMigrationReport({
    projects: [project({ id: "u1", name: "未設定", ai_prompt_mode: "package", ai_prompt_package_version_id: null })],
    versionMetaById: new Map(),
    publishedVersionNoByPackage: new Map(),
  });
  assert.equal(report.packageUnsetProjects.length, 1);
  assert.equal(report.packageUnsetProjects[0]!.id, "u1");
  assert.equal(report.counts.package, 1);
});

// ---------------------------------------------------------------------------
// Test 4: archived 参照（fallback あり / なし）
// ---------------------------------------------------------------------------
test("PhaseG: archived 参照を fallback 有無付きで検出する", () => {
  const versionMetaById = new Map<string, ReferencedVersionMeta>([
    ["v-arch-a", { status: "archived", version_no: 2, package_id: "pkg-a" }],
    ["v-arch-b", { status: "archived", version_no: 1, package_id: "pkg-b" }],
  ]);
  const publishedVersionNoByPackage = new Map<string, number>([["pkg-a", 3]]); // pkg-b は公開版なし

  const report = buildPromptMigrationReport({
    projects: [
      project({ id: "a1", name: "fallbackあり", ai_prompt_package_version_id: "v-arch-a" }),
      project({ id: "a2", name: "fallbackなし", ai_prompt_package_version_id: "v-arch-b" }),
    ],
    versionMetaById,
    publishedVersionNoByPackage,
  });

  assert.equal(report.archivedRefProjects.length, 2);
  const a1 = report.archivedRefProjects.find((r) => r.id === "a1")!;
  assert.equal(a1.hasFallback, true);
  assert.equal(a1.fallbackVersionNo, 3);
  assert.equal(a1.archivedVersionNo, 2);

  const a2 = report.archivedRefProjects.find((r) => r.id === "a2")!;
  assert.equal(a2.hasFallback, false);
  assert.equal(a2.fallbackVersionNo, null);
});

// ---------------------------------------------------------------------------
// Test 5: orphan 参照（missing / draft）と published は対応不要
// ---------------------------------------------------------------------------
test("PhaseG: orphan 参照（missing/draft）検出・published は対応不要", () => {
  const versionMetaById = new Map<string, ReferencedVersionMeta>([
    ["v-draft", { status: "draft", version_no: 1, package_id: "pkg-x" }],
    ["v-pub", { status: "published", version_no: 5, package_id: "pkg-y" }],
  ]);

  const report = buildPromptMigrationReport({
    projects: [
      project({ id: "o1", name: "削除済み参照", ai_prompt_package_version_id: "v-missing" }),
      project({ id: "o2", name: "draft参照", ai_prompt_package_version_id: "v-draft" }),
      project({ id: "ok", name: "健全", ai_prompt_package_version_id: "v-pub" }),
    ],
    versionMetaById,
    publishedVersionNoByPackage: new Map(),
  });

  assert.equal(report.orphanRefProjects.length, 2);
  assert.equal(report.orphanRefProjects.find((r) => r.id === "o1")!.reason, "missing");
  assert.equal(report.orphanRefProjects.find((r) => r.id === "o2")!.reason, "draft");

  // published 参照はどのカテゴリにも入らない（対応不要）
  assert.ok(!report.customProjects.some((r) => r.id === "ok"));
  assert.ok(!report.archivedRefProjects.some((r) => r.id === "ok"));
  assert.ok(!report.orphanRefProjects.some((r) => r.id === "ok"));
  assert.ok(!report.packageUnsetProjects.some((r) => r.id === "ok"));
});

// ---------------------------------------------------------------------------
// Test 6: counts.needsAttention は重複なし件数
// ---------------------------------------------------------------------------
test("PhaseG: counts が各カテゴリと needsAttention を正しく集計する", () => {
  const versionMetaById = new Map<string, ReferencedVersionMeta>([
    ["v-arch", { status: "archived", version_no: 1, package_id: "p" }],
    ["v-pub", { status: "published", version_no: 2, package_id: "p" }],
  ]);
  const report = buildPromptMigrationReport({
    projects: [
      project({ id: "1", name: "custom", ai_prompt_mode: "custom" }),
      project({ id: "2", name: "unset", ai_prompt_package_version_id: null }),
      project({ id: "3", name: "arch", ai_prompt_package_version_id: "v-arch" }),
      project({ id: "4", name: "pub", ai_prompt_package_version_id: "v-pub" }),
    ],
    versionMetaById,
    publishedVersionNoByPackage: new Map([["p", 2]]),
  });

  assert.equal(report.counts.total, 4);
  assert.equal(report.counts.package, 3);
  assert.equal(report.counts.custom, 1);
  assert.equal(report.counts.packageUnset, 1);
  assert.equal(report.counts.archivedRef, 1);
  assert.equal(report.counts.orphanRef, 0);
  // custom + unset + archived = 3 件（published は除外）
  assert.equal(report.counts.needsAttention, 3);
});

// ---------------------------------------------------------------------------
// Test 7: 健全な全 package プロジェクトは needsAttention 0
// ---------------------------------------------------------------------------
test("PhaseG: 全て published 参照なら needsAttention は 0", () => {
  const versionMetaById = new Map<string, ReferencedVersionMeta>([
    ["v", { status: "published", version_no: 1, package_id: "p" }],
  ]);
  const report = buildPromptMigrationReport({
    projects: [
      project({ id: "1", name: "a", ai_prompt_package_version_id: "v" }),
      project({ id: "2", name: "b", ai_prompt_package_version_id: "v" }),
    ],
    versionMetaById,
    publishedVersionNoByPackage: new Map(),
  });
  assert.equal(report.counts.needsAttention, 0);
});
