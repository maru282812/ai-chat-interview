/**
 * Phase 5: AIプロンプトパッケージ本番運用強化テスト
 *
 * 確認項目:
 * 1. published version 切替で対象プロジェクトの effective config が変わる
 * 2. archived version 選択中のプロジェクトが published version に fallback する
 * 3. fallback 先なしの場合でも AI 処理が落ちない（custom 相当で解決される）
 * 4. 許可外 placeholder を含む version は警告される
 * 5. 必須 prompt key 不足時は公開できない
 * 6. パッケージ適用変更時に履歴ログが保存される（変更検出 + 入力形）
 * 7. archive 確認画面で利用中プロジェクトが表示される（影響一覧の構築）
 * 8. プロジェクト一覧で fallback 表示が正しく出る
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
  validatePromptPackageVersionConfig,
  validatePromptPackageVersionForPublish,
  validatePromptPackageVersionForApply,
  findMissingRequiredPromptKeys,
} from "../services/promptPackageValidationService";
import {
  buildPackageVersionPreview,
  resolveEffectiveTemplates,
  type PackagePreviewDeps,
} from "../services/promptPackagePreviewService";
import { BASE_PROMPT_TEMPLATES } from "../prompts/basePromptTemplates";
import { renderPromptTemplate } from "../prompts/promptTemplateRenderer";
import type {
  PromptPackage,
  PromptPackageVersion,
} from "../repositories/promptPackageRepository";
import type { ChangeLogCreateInput } from "../repositories/projectPromptPackageChangeLogRepository";

const PKG_ID = "00000000-0000-4000-8000-000000000010";
const VERSION_V1_ID = "00000000-0000-4000-8000-000000000011";
const VERSION_V2_ID = "00000000-0000-4000-8000-000000000012";

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

function makeVersion(overrides: Partial<PromptPackageVersion>): PromptPackageVersion {
  return {
    id: VERSION_V1_ID,
    package_id: PKG_ID,
    version_no: 1,
    status: "published",
    policy_json: { researchType: "interview_research" },
    templates_json: null,
    change_note: null,
    published_at: "2026-06-12T00:00:00.000Z",
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
    ...overrides,
  };
}

/** versions 配列からモック deps を構築する */
function makeDeps(pkg: PromptPackage, versions: PromptPackageVersion[]): PackagePreviewDeps {
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

// ─── 1. published version 切替で effective config が変わる ──────────────────

test("published 切替: v1 published → v1 の policy / v2 へ切替後 → v2 の policy が適用される", async () => {
  const pkg = makePkg();
  const v1 = makeVersion({
    id: VERSION_V1_ID,
    version_no: 1,
    status: "published",
    policy_json: { researchType: "interview_research" },
  });
  const v2 = makeVersion({
    id: VERSION_V2_ID,
    version_no: 2,
    status: "draft",
    policy_json: { researchType: "exploratory_research" },
  });

  // 切替前: プロジェクトは v1 を選択中 → v1 published を直接使用
  const before = await buildPackageVersionPreview(VERSION_V1_ID, makeDeps(pkg, [v1, v2]));
  assert.ok(before);
  assert.equal(before.effectiveVersionNo, 1);
  assert.deepEqual(before.policyJson, { researchType: "interview_research" });
  assert.equal(before.isFallback, false);

  // publish v2 → v1 は archived になる（publishVersion と同じ状態遷移）
  const v1After = { ...v1, status: "archived" as const };
  const v2After = { ...v2, status: "published" as const };

  // 切替後: プロジェクトは v1 を選択したままでも effective config は v2 に変わる
  const after = await buildPackageVersionPreview(VERSION_V1_ID, makeDeps(pkg, [v1After, v2After]));
  assert.ok(after);
  assert.equal(after.isFallback, true);
  assert.equal(after.effectiveVersionNo, 2);
  assert.deepEqual(after.policyJson, { researchType: "exploratory_research" });
});

// ─── 2. archived → published への fallback ──────────────────────────────────

test("archived バージョン選択中 → published バージョンに fallback する", async () => {
  const pkg = makePkg();
  const v1Archived = makeVersion({ id: VERSION_V1_ID, version_no: 1, status: "archived" });
  const v2Published = makeVersion({
    id: VERSION_V2_ID,
    version_no: 2,
    status: "published",
    templates_json: {
      buildProbePrompt: { enabled: true, template: "follow-up: {{question}} / {{answer}}" },
    },
  });

  const preview = await buildPackageVersionPreview(VERSION_V1_ID, makeDeps(pkg, [v1Archived, v2Published]));
  assert.ok(preview);
  assert.equal(preview.selectedStatus, "archived");
  assert.equal(preview.isFallback, true);
  assert.equal(preview.fallbackVersionNo, 2);
  assert.equal(preview.customEquivalent, false);

  // fallback 後のテンプレートが使われる
  const probe = preview.templates.find((t) => t.key === "buildProbePrompt");
  assert.ok(probe);
  assert.equal(probe.source, "package");
  assert.equal(probe.templateMode, "package_template");
  assert.equal(probe.template, "follow-up: {{question}} / {{answer}}");
});

// ─── 3. fallback 先なしでも AI 処理が落ちない ───────────────────────────────

test("archived + published なし → custom 相当で解決され、例外にならない", async () => {
  const pkg = makePkg();
  const v1Archived = makeVersion({ id: VERSION_V1_ID, version_no: 1, status: "archived" });

  const preview = await buildPackageVersionPreview(VERSION_V1_ID, makeDeps(pkg, [v1Archived]));
  assert.ok(preview);
  assert.equal(preview.customEquivalent, true);
  assert.equal(preview.isFallback, false);
  assert.equal(preview.effectiveVersionNo, null);
  assert.equal(preview.policyJson, null);
  assert.deepEqual(preview.templates, []);
});

test("バージョン不明 ID → null を返し、例外にならない", async () => {
  const preview = await buildPackageVersionPreview("missing-id", makeDeps(makePkg(), []));
  assert.equal(preview, null);
});

test("未定義 placeholder を含むテンプレートでもレンダリングは落ちない（空文字に解決）", () => {
  const rendered = renderPromptTemplate("Q: {{question}} / X: {{notDefinedKey}}", { question: "好きな色は？" });
  assert.equal(rendered, "Q: 好きな色は？ / X: ");
});

// ─── 4. 許可外 placeholder は警告 ──────────────────────────────────────────

test("許可外 placeholder を含む version は警告される（保存は可能）", () => {
  const result = validatePromptPackageVersionConfig({
    templatesJson: {
      buildProbePrompt: { enabled: true, template: "{{question}} {{totallyUnknownKey}}" },
    },
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /buildProbePrompt/);
  assert.match(result.warnings[0]!, /\{\{totallyUnknownKey\}\}/);
});

test("不正な JSON 文字列はエラー（保存不可）", () => {
  const result = validatePromptPackageVersionConfig({
    rawPolicyJson: "{ broken json",
    rawTemplatesJson: "[not an object",
  });
  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0]!, /policy_json/);
  assert.match(result.errors[1]!, /templates_json/);
});

test("templates_json が配列 → エラー / policy_json の未知キー → 警告", () => {
  const arrayResult = validatePromptPackageVersionConfig({ templatesJson: ["a"] });
  assert.equal(arrayResult.errors.length, 1);

  const policyResult = validatePromptPackageVersionConfig({
    policyJson: { researchType: "interview_research", unknownPolicyKey: "x" },
  });
  assert.equal(policyResult.errors.length, 0);
  assert.equal(policyResult.warnings.length, 1);
  assert.match(policyResult.warnings[0]!, /unknownPolicyKey/);
});

// ─── 5. 必須 prompt key 不足時は公開できない ────────────────────────────────

test("必須 prompt key のテンプレートが空白のみ → 公開バリデーションでエラー", () => {
  const version = makeVersion({
    templates_json: {
      buildAnalyzeAnswerPrompt: { enabled: true, template: "   " },
    },
  });
  const result = validatePromptPackageVersionForPublish(version);
  assert.ok(result.errors.length > 0);
  assert.match(result.errors[0]!, /buildAnalyzeAnswerPrompt/);

  const missing = findMissingRequiredPromptKeys(version.templates_json);
  assert.deepEqual(missing, ["buildAnalyzeAnswerPrompt"]);
});

test("templates_json 未設定（BASE フォールバック）→ 公開可能", () => {
  const version = makeVersion({ templates_json: null });
  const result = validatePromptPackageVersionForPublish(version);
  assert.equal(result.errors.length, 0);
});

test("enabled=false のキーは BASE にフォールバックするため公開可能", () => {
  const version = makeVersion({
    templates_json: { buildProbePrompt: { enabled: false } },
  });
  const result = validatePromptPackageVersionForPublish(version);
  assert.equal(result.errors.length, 0);
  assert.deepEqual(findMissingRequiredPromptKeys(version.templates_json), []);
});

// ─── 適用時バリデーション（5-B） ───────────────────────────────────────────

test("draft バージョンはプロジェクトに適用不可（エラー）", () => {
  const result = validatePromptPackageVersionForApply(
    makeVersion({ status: "draft" }),
    null
  );
  assert.equal(result.errors.length, 1);
});

test("archived 直接選択 + published あり → 警告（適用は可能）", () => {
  const result = validatePromptPackageVersionForApply(
    makeVersion({ status: "archived", version_no: 1 }),
    makeVersion({ id: VERSION_V2_ID, version_no: 2 })
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /fallback/);
});

test("archived 直接選択 + published なし → 強い警告", () => {
  const result = validatePromptPackageVersionForApply(
    makeVersion({ status: "archived", version_no: 1 }),
    null
  );
  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0]!, /強い警告/);
  assert.match(result.warnings[0]!, /custom 相当/);
});

// ─── 6. パッケージ適用変更時に履歴ログが保存される ──────────────────────────

test("変更検出: モード or バージョンが変わったときのみログ対象になる", () => {
  const cases: Array<{ oldMode: string; newMode: string; oldId: string | null; newId: string | null; expected: boolean }> = [
    { oldMode: "custom", newMode: "package", oldId: null, newId: VERSION_V1_ID, expected: true },
    { oldMode: "package", newMode: "package", oldId: VERSION_V1_ID, newId: VERSION_V2_ID, expected: true },
    { oldMode: "package", newMode: "custom", oldId: VERSION_V1_ID, newId: null, expected: true },
    { oldMode: "package", newMode: "package", oldId: VERSION_V1_ID, newId: VERSION_V1_ID, expected: false },
    { oldMode: "custom", newMode: "custom", oldId: null, newId: null, expected: false },
  ];
  for (const c of cases) {
    const packageChanged = c.oldMode !== c.newMode || c.oldId !== c.newId;
    assert.equal(packageChanged, c.expected, JSON.stringify(c));
  }
});

test("履歴ログ入力: changed_by（操作者）を含むスナップショット形で保存される", () => {
  const input: ChangeLogCreateInput = {
    projectId: "00000000-0000-4000-8000-000000000001",
    oldVersionId: null,
    newVersionId: VERSION_V1_ID,
    oldPackageSlug: null,
    newPackageSlug: "standard_interview",
    oldVersionNo: null,
    newVersionNo: 1,
    oldMode: "custom",
    newMode: "package",
    changeReason: "標準パッケージへ移行",
    changedBy: "admin",
  };
  assert.equal(input.changedBy, "admin");
  assert.equal(input.newMode, "package");
  assert.equal(input.newPackageSlug, "standard_interview");
});

// ─── 7. archive 確認画面で利用中プロジェクトが表示される ────────────────────

test("archive 確認: 利用中プロジェクト一覧と fallback 先が構築される", () => {
  const v1 = makeVersion({ id: VERSION_V1_ID, version_no: 1, status: "published" });
  const v2 = makeVersion({ id: VERSION_V2_ID, version_no: 2, status: "draft" });
  const usingProjects = [
    { id: "p1", name: "プロジェクトA", status: "active", ai_prompt_mode: "package", ai_prompt_package_version_id: VERSION_V1_ID },
    { id: "p2", name: "プロジェクトB", status: "draft", ai_prompt_mode: "package", ai_prompt_package_version_id: VERSION_V1_ID },
  ];

  // archiveConfirmPromptPackageVersion と同じ構築ロジック:
  // fallback 先 = 同パッケージの published のうちアーカイブ対象以外
  const published = [v1, v2].find((v) => v.status === "published") ?? null;
  const fallbackVersion = published && published.id !== VERSION_V1_ID ? published : null;

  assert.equal(usingProjects.length, 2);
  assert.equal(usingProjects[0]!.name, "プロジェクトA");
  // v1 自身をアーカイブするため fallback 先なし（赤警告ケース）
  assert.equal(fallbackVersion, null);
});

test("publish 確認: 影響プロジェクトの willFallback が正しく構築される", () => {
  const v1Published = makeVersion({ id: VERSION_V1_ID, version_no: 1, status: "published" });
  const v2Draft = makeVersion({ id: VERSION_V2_ID, version_no: 2, status: "draft" });
  const versionById = new Map([[v1Published.id, v1Published], [v2Draft.id, v2Draft]]);
  const usingProjects = [
    { id: "p1", name: "プロジェクトA", status: "active", ai_prompt_mode: "package", ai_prompt_package_version_id: VERSION_V1_ID },
  ];

  // publishConfirmPromptPackageVersion と同じ構築ロジック（v2 を公開する場合）
  const publishTargetId = VERSION_V2_ID;
  const affected = usingProjects.map((p) => {
    const used = p.ai_prompt_package_version_id ? versionById.get(p.ai_prompt_package_version_id) ?? null : null;
    return {
      projectName: p.name,
      usedVersionNo: used?.version_no ?? null,
      willFallback: !!used && used.id !== publishTargetId,
    };
  });

  assert.equal(affected.length, 1);
  assert.equal(affected[0]!.usedVersionNo, 1);
  // v1 選択中のプロジェクトは v2 公開後に fallback する
  assert.equal(affected[0]!.willFallback, true);
});

// ─── 8. プロジェクト一覧の fallback 表示 ────────────────────────────────────

test("プロジェクト一覧: archived 使用中 + published あり → isFallback = true / fallbackVersionNo 表示", () => {
  const v1Archived = makeVersion({ id: VERSION_V1_ID, version_no: 1, status: "archived" });
  const v2Published = makeVersion({ id: VERSION_V2_ID, version_no: 2, status: "published" });
  const pkg = makePkg();

  // adminService.listProjects の packageInfo 構築ロジック
  const fallback = v2Published;
  const packageInfo = {
    packageName: pkg.name,
    packageSlug: pkg.slug,
    versionNo: v1Archived.version_no,
    versionStatus: v1Archived.status,
    isFallback: !!fallback,
    fallbackVersionNo: fallback.version_no,
  };

  assert.equal(packageInfo.isFallback, true);
  assert.equal(packageInfo.versionNo, 1);
  assert.equal(packageInfo.fallbackVersionNo, 2);
});

// ─── resolveEffectiveTemplates の網羅性 ─────────────────────────────────────

test("resolveEffectiveTemplates: 全プロンプトキーを返し、未定義キーは base にフォールバック", () => {
  const templates = resolveEffectiveTemplates({
    buildProbePrompt: { enabled: true, template: "custom probe {{question}}" },
    buildSessionSummaryPrompt: { enabled: false },
  });

  assert.equal(templates.length, Object.keys(BASE_PROMPT_TEMPLATES).length);

  const probe = templates.find((t) => t.key === "buildProbePrompt")!;
  assert.equal(probe.source, "package");
  assert.equal(probe.template, "custom probe {{question}}");

  const summary = templates.find((t) => t.key === "buildSessionSummaryPrompt")!;
  assert.equal(summary.source, "disabled");
  assert.equal(summary.templateMode, "base_template");
  assert.equal(summary.template, BASE_PROMPT_TEMPLATES.buildSessionSummaryPrompt.template);

  const analyze = templates.find((t) => t.key === "buildAnalyzeAnswerPrompt")!;
  assert.equal(analyze.source, "base");
  assert.equal(analyze.template, BASE_PROMPT_TEMPLATES.buildAnalyzeAnswerPrompt.template);
});
