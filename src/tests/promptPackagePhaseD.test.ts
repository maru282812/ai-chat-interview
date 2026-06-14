/**
 * Phase D: custom → package 実データ移行（実行系）テスト
 *
 * 1. buildMigrationSlug: projectId から決定的・一意なスラグ
 * 2. buildMigrationPlan（純関数）: custom 分類と移送内容
 * 3. executeMigrationPlan dry-run: 書込みなし・outcome は planned/skipped
 * 4. executeMigrationPlan 実行: 順序どおり書込み・repoint・changeLog、outcome migrated
 * 5. 失敗隔離: 1件失敗しても他は継続、失敗プロジェクトは repoint されない（custom 維持）
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
  buildMigrationSlug,
  buildMigrationPlan,
  executeMigrationPlan,
  type MigrationProjectInput,
  type MigrationExecutorDeps,
} from "../services/promptMigrationService";

function proj(overrides: Partial<MigrationProjectInput>): MigrationProjectInput {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "P",
    status: "active",
    ai_prompt_mode: "custom",
    ai_prompt_package_version_id: null,
    ai_prompt_policy_json: null,
    ai_prompt_templates_json: null,
    ...overrides,
  };
}

// ─── 1. slug ─────────────────────────────────────────────────────────────────

test("buildMigrationSlug: projectId から決定的に生成され、同一IDは同一スラグ", () => {
  const id = "abcd1234-5678-90ef-ghij-klmnopqrstuv";
  assert.equal(buildMigrationSlug(id), buildMigrationSlug(id));
  assert.match(buildMigrationSlug(id), /^migrated-[0-9a-z]+$/);
  assert.notEqual(buildMigrationSlug("aaaa1111-x"), buildMigrationSlug("bbbb2222-x"));
});

// ─── 2. buildMigrationPlan ───────────────────────────────────────────────────

test("plan: policy+templates 直持ちの custom → create_package で両方移送", () => {
  const plan = buildMigrationPlan([
    proj({
      id: "11111111-1111-4000-8000-000000000001",
      ai_prompt_policy_json: { researchType: "interview_research" },
      ai_prompt_templates_json: { buildProbePrompt: { enabled: true, template: "x" } },
    }),
  ]);
  assert.equal(plan.items.length, 1);
  const item = plan.items[0]!;
  assert.equal(item.action, "create_package");
  assert.deepEqual(item.policyJson, { researchType: "interview_research" });
  assert.deepEqual(item.templatesJson, { buildProbePrompt: { enabled: true, template: "x" } });
  assert.equal(plan.counts.toMigrate, 1);
});

test("plan: policy のみ / templates のみ → 片方 null で create_package", () => {
  const plan = buildMigrationPlan([
    proj({ id: "1", ai_prompt_policy_json: { researchType: "interview_research" } }),
    proj({ id: "2", ai_prompt_templates_json: { buildProbePrompt: { enabled: true, template: "y" } } }),
  ]);
  assert.equal(plan.items[0]!.action, "create_package");
  assert.equal(plan.items[0]!.templatesJson, null);
  assert.equal(plan.items[1]!.action, "create_package");
  assert.equal(plan.items[1]!.policyJson, null);
});

test("plan: 個別設定なしの custom → skip", () => {
  const plan = buildMigrationPlan([proj({ id: "3" })]);
  assert.equal(plan.items[0]!.action, "skip");
  assert.match(plan.items[0]!.skipReason!, /個別設定なし/);
  assert.equal(plan.counts.toMigrate, 0);
  assert.equal(plan.counts.skipped, 1);
});

test("plan: package モードのプロジェクトは対象外（プランに含まれない）", () => {
  const plan = buildMigrationPlan([
    proj({ id: "4", ai_prompt_mode: "package", ai_prompt_package_version_id: "v-1" }),
    proj({ id: "5", ai_prompt_policy_json: { researchType: "interview_research" } }),
  ]);
  assert.equal(plan.items.length, 1);
  assert.equal(plan.items[0]!.projectId, "5");
});

test("plan: 空オブジェクトの policy は設定なし扱い（skip）", () => {
  const plan = buildMigrationPlan([proj({ id: "6", ai_prompt_policy_json: {} })]);
  assert.equal(plan.items[0]!.action, "skip");
});

// ─── 3 & 4 & 5. executeMigrationPlan ─────────────────────────────────────────

interface Calls {
  createPackage: unknown[];
  createVersion: unknown[];
  publishVersion: string[];
  repointProject: Array<{ projectId: string; versionId: string }>;
  recordChangeLog: unknown[];
  order: string[];
}

function makeDeps(overrides: Partial<MigrationExecutorDeps> = {}): { deps: MigrationExecutorDeps; calls: Calls } {
  const calls: Calls = {
    createPackage: [], createVersion: [], publishVersion: [], repointProject: [], recordChangeLog: [], order: [],
  };
  let pkgSeq = 0;
  let verSeq = 0;
  const deps: MigrationExecutorDeps = {
    async createPackage(input) {
      calls.createPackage.push(input); calls.order.push("createPackage");
      return { id: `pkg-${++pkgSeq}` };
    },
    async createVersion(input) {
      calls.createVersion.push(input); calls.order.push("createVersion");
      return { id: `ver-${++verSeq}`, version_no: 1 };
    },
    async publishVersion(versionId) {
      calls.publishVersion.push(versionId); calls.order.push("publishVersion");
    },
    async repointProject(projectId, versionId) {
      calls.repointProject.push({ projectId, versionId }); calls.order.push("repointProject");
    },
    async recordChangeLog(input) {
      calls.recordChangeLog.push(input); calls.order.push("recordChangeLog");
    },
    ...overrides,
  };
  return { deps, calls };
}

test("execute dry-run: 書込みは一切行われず outcome は planned/skipped", async () => {
  const plan = buildMigrationPlan([
    proj({ id: "1", ai_prompt_policy_json: { researchType: "interview_research" } }),
    proj({ id: "2" }), // skip
  ]);
  const { deps, calls } = makeDeps();
  const result = await executeMigrationPlan(plan, deps, { dryRun: true, changedBy: "admin" });

  assert.equal(result.dryRun, true);
  assert.equal(result.counts.planned, 1);
  assert.equal(result.counts.skipped, 1);
  assert.equal(result.counts.migrated, 0);
  assert.equal(calls.order.length, 0); // 一切書込みなし
});

test("execute 実行: package→version→publish→repoint→log の順で処理し migrated", async () => {
  const plan = buildMigrationPlan([
    proj({
      id: "11111111-1111-4000-8000-000000000001",
      name: "移行対象",
      ai_prompt_policy_json: { researchType: "interview_research" },
    }),
  ]);
  const { deps, calls } = makeDeps();
  const result = await executeMigrationPlan(plan, deps, { dryRun: false, changedBy: "admin" });

  assert.equal(result.counts.migrated, 1);
  assert.deepEqual(calls.order, ["createPackage", "createVersion", "publishVersion", "repointProject", "recordChangeLog"]);
  assert.equal(calls.repointProject[0]!.projectId, "11111111-1111-4000-8000-000000000001");
  assert.equal(calls.repointProject[0]!.versionId, "ver-1");
  const log = calls.recordChangeLog[0] as { oldMode: string; newMode: string };
  assert.equal(log.oldMode, "custom");
  assert.equal(log.newMode, "package");
  const r0 = result.results[0]!;
  assert.equal(r0.outcome, "migrated");
  assert.equal(r0.packageId, "pkg-1");
  assert.equal(r0.versionId, "ver-1");
});

test("execute 失敗隔離: 1件が createPackage で失敗しても他は移行され、失敗側は repoint されない", async () => {
  const plan = buildMigrationPlan([
    proj({ id: "11111111-1111-4000-8000-000000000001", name: "失敗", ai_prompt_policy_json: { researchType: "interview_research" } }),
    proj({ id: "22222222-2222-4000-8000-000000000002", name: "成功", ai_prompt_policy_json: { researchType: "exploratory_research" } }),
  ]);
  let firstCall = true;
  const { deps, calls } = makeDeps({
    async createPackage(input) {
      if (firstCall) { firstCall = false; throw new Error("slug collision"); }
      calls.createPackage.push(input); calls.order.push("createPackage");
      return { id: "pkg-ok" };
    },
  });
  const result = await executeMigrationPlan(plan, deps, { dryRun: false, changedBy: null });

  assert.equal(result.counts.failed, 1);
  assert.equal(result.counts.migrated, 1);
  // 失敗したプロジェクトは repoint されない（custom 維持・可逆）
  assert.equal(calls.repointProject.length, 1);
  assert.equal(calls.repointProject[0]!.projectId, "22222222-2222-4000-8000-000000000002");
  const failed = result.results.find((r) => r.outcome === "failed")!;
  assert.match(failed.message!, /slug collision/);
});
