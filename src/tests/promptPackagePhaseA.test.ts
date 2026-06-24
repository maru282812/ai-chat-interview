/**
 * Phase A: 管理主体変更（Project → PromptPackageVersion）テスト
 *
 * 確認項目:
 * 1. package mode + version あり（published） → source === "package_version"
 * 2. package mode + version なし → warnings が出る（silent fallback しない）
 * 3. version.templates_json が実行時 templates として使われる
 * 4. version.policy_json が実行時 policy として使われる
 * 5. project override 使用時に usedProjectOverride = true
 * 6. custom / legacy project は project_legacy として動作継続
 * 7. version に templates/policy が無い → project へ legacyFallback + フラグが立つ
 * 8. resolvePromptMeta が resolution_json を ai_logs 用に整形する
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

import {
  resolveEffectiveProjectConfig,
  resolvePromptMeta,
  type ResolveConfigDeps,
} from "../services/aiService";
import type { Project } from "../types/domain";
import type { PromptPackage, PromptPackageVersion } from "../repositories/promptPackageRepository";

const BASE_PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const PKG_ID = "00000000-0000-4000-8000-000000000010";
const VERSION_V1_ID = "00000000-0000-4000-8000-000000000011";
const VERSION_V2_ID = "00000000-0000-4000-8000-000000000012";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: BASE_PROJECT_ID,
    name: "テストプロジェクト",
    client_name: null,
    objective: null,
    status: "draft",
    reward_points: 0,
    research_mode: "survey_interview",
    display_mode: "survey_question",
    primary_objectives: [],
    secondary_objectives: [],
    comparison_constraints: [],
    prompt_rules: [],
    probe_policy: null,
    response_style: null,
    ai_state_json: null,
    ai_state_template_key: null,
    ai_state_generated_at: null,
    screening_config: null,
    screening_last_question_order: null,
    ai_prompt_policy_json: { researchType: "standard_research" },
    ai_prompt_templates_json: null,
    ai_prompt_mode: "custom",
    ai_prompt_package_version_id: null,
    delivery_enabled: false,
    delivery_type: null,
    delivered_at: null,
    visibility_type: "public",
    entry_code: null,
    client_id: null,
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}

function makeVersion(overrides: Partial<PromptPackageVersion>): PromptPackageVersion {
  return {
    id: VERSION_V1_ID,
    package_id: PKG_ID,
    version_no: 1,
    status: "published",
    policy_json: { researchType: "interview_research" },
    templates_json: null,
    builder_spec_json: null,
    change_note: null,
    published_at: "2026-06-12T00:00:00.000Z",
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}

function makePkg(overrides: Partial<PromptPackage> = {}): PromptPackage {
  return {
    id: PKG_ID,
    slug: "standard_interview",
    name: "標準インタビュー",
    description: null,
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}

/** versions 配列からモック deps を構築する */
function makeDeps(pkg: PromptPackage, versions: PromptPackageVersion[]): ResolveConfigDeps {
  return {
    async getVersionById(versionId) {
      return versions.find((v) => v.id === versionId) ?? null;
    },
    async getById(packageId) {
      return pkg.id === packageId ? pkg : null;
    },
    async getPublishedVersionByPackageId(packageId) {
      return versions.find((v) => v.package_id === packageId && v.status === "published") ?? null;
    },
  };
}

// ─── 1. package mode + version あり → source = package_version ────────────────

test("package mode + published version → source === 'package_version'・packageMeta が立つ", async () => {
  const pkg = makePkg();
  const v1 = makeVersion({ status: "published" });
  const project = makeProject({
    ai_prompt_mode: "package",
    ai_prompt_package_version_id: VERSION_V1_ID,
  });

  const result = await resolveEffectiveProjectConfig(project, makeDeps(pkg, [v1]));

  assert.equal(result.source, "package_version");
  assert.equal(result.isFallback, false);
  assert.ok(result.packageMeta);
  assert.equal(result.packageMeta!.package_version_id, VERSION_V1_ID);
  assert.equal(result.packageMeta!.package_version_no, 1);
  assert.equal(result.packageMeta!.package_slug, "standard_interview");
  assert.equal(result.usedProjectTemplateFallback, false);
  assert.equal(result.usedProjectPolicyFallback, false);
  assert.equal(result.usedProjectOverride, false);
  assert.deepEqual(result.warnings, []);
});

// ─── 2. package mode + version なし → warnings が出る ────────────────────────

test("package mode + version 未選択 → project_legacy だが warnings に必ず記録（silent fallback しない）", async () => {
  const project = makeProject({
    ai_prompt_mode: "package",
    ai_prompt_package_version_id: null,
  });

  const result = await resolveEffectiveProjectConfig(project, makeDeps(makePkg(), []));

  assert.equal(result.source, "project_legacy");
  assert.equal(result.packageMeta, null);
  assert.ok(result.warnings.length > 0);
  assert.match(result.warnings[0]!, /package-unset/);
  // 既存挙動継続: project 個別設定がそのまま使われる
  assert.deepEqual(result.effectiveProject.ai_prompt_policy_json, { researchType: "standard_research" });
});

// ─── 3. version.templates_json が使われる ────────────────────────────────────

test("version.templates_json が実行時 templates として使われる", async () => {
  const pkg = makePkg();
  const v1 = makeVersion({
    status: "published",
    templates_json: {
      buildProbePrompt: { enabled: true, template: "pkg probe: {{question}}" },
    },
  });
  const project = makeProject({
    ai_prompt_mode: "package",
    ai_prompt_package_version_id: VERSION_V1_ID,
    // project 側にも別 templates があるが、package version が優先される
    ai_prompt_templates_json: {
      buildProbePrompt: { enabled: true, template: "project probe (使われない)" },
    },
  });

  const result = await resolveEffectiveProjectConfig(project, makeDeps(pkg, [v1]));

  assert.equal(result.source, "package_version");
  assert.equal(result.usedProjectTemplateFallback, false);
  assert.deepEqual(result.effectiveProject.ai_prompt_templates_json, {
    buildProbePrompt: { enabled: true, template: "pkg probe: {{question}}" },
  });
});

// ─── 4. version.policy_json が使われる ───────────────────────────────────────

test("version.policy_json が実行時 policy として使われる（project policy を上書き）", async () => {
  const pkg = makePkg();
  const v1 = makeVersion({
    status: "published",
    policy_json: { researchType: "exploratory_research" },
  });
  const project = makeProject({
    ai_prompt_mode: "package",
    ai_prompt_package_version_id: VERSION_V1_ID,
    ai_prompt_policy_json: { researchType: "standard_research" },
  });

  const result = await resolveEffectiveProjectConfig(project, makeDeps(pkg, [v1]));

  assert.equal(result.source, "package_version");
  assert.equal(result.usedProjectPolicyFallback, false);
  assert.deepEqual(result.effectiveProject.ai_prompt_policy_json, { researchType: "exploratory_research" });
});

// ─── 5. project override 使用時に usedProjectOverride = true ──────────────────

test("project override 使用時に usedProjectOverride = true・deprecated warning が出る", async () => {
  const pkg = makePkg();
  const v1 = makeVersion({
    status: "published",
    policy_json: { researchType: "interview_research", probeStyle: "standard" },
  });
  const project = makeProject({
    ai_prompt_mode: "package",
    ai_prompt_package_version_id: VERSION_V1_ID,
    ai_prompt_overrides_json: { policy: { probeStyle: "comparison" } },
  });

  const result = await resolveEffectiveProjectConfig(project, makeDeps(pkg, [v1]));

  assert.equal(result.source, "package_version");
  assert.equal(result.usedProjectOverride, true);
  assert.ok(result.warnings.some((w) => /deprecated/.test(w)));
  // override が package policy にマージされている
  const policy = result.effectiveProject.ai_prompt_policy_json as Record<string, unknown>;
  assert.equal(policy["probeStyle"], "comparison");
  assert.equal(policy["researchType"], "interview_research");
});

// ─── 6. custom / legacy project は project_legacy として動作継続 ──────────────

test("custom モード → project_legacy・packageMeta = null・warnings なし", async () => {
  const project = makeProject({ ai_prompt_mode: "custom" });

  const result = await resolveEffectiveProjectConfig(project, makeDeps(makePkg(), []));

  assert.equal(result.source, "project_legacy");
  assert.equal(result.packageMeta, null);
  assert.equal(result.isFallback, false);
  assert.deepEqual(result.warnings, []);
  // 既存の project 設定がそのまま使われる
  assert.equal(result.effectiveProject, project);
});

// ─── 7. version に templates/policy が無い → project へ legacyFallback ─────────

test("version の templates/policy が null → project へ legacyFallback しフラグが立つ", async () => {
  const pkg = makePkg();
  const v1 = makeVersion({ status: "published", templates_json: null, policy_json: null });
  const project = makeProject({
    ai_prompt_mode: "package",
    ai_prompt_package_version_id: VERSION_V1_ID,
    ai_prompt_policy_json: { researchType: "standard_research" },
    ai_prompt_templates_json: { buildProbePrompt: { enabled: true, template: "proj fallback" } },
  });

  const result = await resolveEffectiveProjectConfig(project, makeDeps(pkg, [v1]));

  assert.equal(result.source, "package_version");
  assert.equal(result.usedProjectTemplateFallback, true);
  assert.equal(result.usedProjectPolicyFallback, true);
  assert.ok(result.warnings.some((w) => /legacyFallback/.test(w) && /templates/.test(w)));
  assert.ok(result.warnings.some((w) => /legacyFallback/.test(w) && /policy/.test(w)));
  // fallback された値が実行時に使われる
  assert.deepEqual(result.effectiveProject.ai_prompt_policy_json, { researchType: "standard_research" });
});

// ─── archived → published fallback も package_version 主体になる ──────────────

test("archived version + published あり → published を package_version 主体で使用・isFallback = true", async () => {
  const pkg = makePkg();
  const v1Archived = makeVersion({ id: VERSION_V1_ID, version_no: 1, status: "archived" });
  const v2Published = makeVersion({
    id: VERSION_V2_ID,
    version_no: 2,
    status: "published",
    policy_json: { researchType: "exploratory_research" },
  });
  const project = makeProject({
    ai_prompt_mode: "package",
    ai_prompt_package_version_id: VERSION_V1_ID,
  });

  const result = await resolveEffectiveProjectConfig(project, makeDeps(pkg, [v1Archived, v2Published]));

  assert.equal(result.source, "package_version");
  assert.equal(result.isFallback, true);
  assert.equal(result.packageMeta!.package_version_no, 2);
  assert.ok(result.warnings.some((w) => /archived-fallback/.test(w)));
});

test("archived version + published なし → project_legacy + warnings（silent fallback しない）", async () => {
  const pkg = makePkg();
  const v1Archived = makeVersion({ id: VERSION_V1_ID, version_no: 1, status: "archived" });
  const project = makeProject({
    ai_prompt_mode: "package",
    ai_prompt_package_version_id: VERSION_V1_ID,
  });

  const result = await resolveEffectiveProjectConfig(project, makeDeps(pkg, [v1Archived]));

  assert.equal(result.source, "project_legacy");
  assert.equal(result.packageMeta, null);
  assert.ok(result.warnings.some((w) => /archived-no-published/.test(w)));
});

test("draft version 参照 → project_legacy + warnings", async () => {
  const pkg = makePkg();
  const v1Draft = makeVersion({ id: VERSION_V1_ID, version_no: 1, status: "draft" });
  const project = makeProject({
    ai_prompt_mode: "package",
    ai_prompt_package_version_id: VERSION_V1_ID,
  });

  const result = await resolveEffectiveProjectConfig(project, makeDeps(pkg, [v1Draft]));

  assert.equal(result.source, "project_legacy");
  assert.ok(result.warnings.some((w) => /not-published/.test(w)));
});

// ─── 8. resolvePromptMeta が resolution_json を整形する ──────────────────────

test("resolvePromptMeta: package_version 解決状態を resolution_json に記録する", () => {
  const project = makeProject({ ai_prompt_mode: "package" });
  const packageMeta = {
    package_id: PKG_ID,
    package_version_id: VERSION_V1_ID,
    package_slug: "standard_interview",
    package_version_no: 1,
  };
  const meta = resolvePromptMeta(project, "buildProbePrompt", packageMeta, {
    source: "package_version",
    usedProjectTemplateFallback: false,
    usedProjectPolicyFallback: true,
    usedProjectOverride: true,
    warnings: ["[deprecated] x"],
  });

  assert.equal(meta.template_mode, "package_template");
  assert.ok(meta.resolution_json);
  const r = meta.resolution_json as Record<string, unknown>;
  assert.equal(r["source"], "package_version");
  assert.equal(r["used_package_version"], true);
  assert.equal(r["used_project_policy_fallback"], true);
  assert.equal(r["used_project_fallback"], true);
  assert.equal(r["used_project_override"], true);
  assert.equal(r["package_version_no"], 1);
});

test("resolvePromptMeta: resolution 未指定なら resolution_json は記録されない（後方互換）", () => {
  const project = makeProject({ ai_prompt_mode: "custom" });
  const meta = resolvePromptMeta(project, "buildProbePrompt");
  assert.equal(meta.resolution_json ?? null, null);
});
