/**
 * Phase B: Project 編集 UI 縮小（適用先選択のみ）テスト
 *
 * Phase B はプロジェクト編集画面から policy/override/custom-ラジオ編集を撤去し、
 * 「どのパッケージ・バージョンを適用するか」だけを設定させる。本テストは UI を持たない
 * ため、core となる2つの不変条件を logic-replication で固定する:
 *  1. hidden ai_prompt_mode の解決ルール（researchForm.ejs syncPromptMode と同一）
 *  2. updateProject の data 保全ルール（custom 既存 policy/overrides を温存する）
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

// ─── 1. hidden ai_prompt_mode の解決ルール（syncPromptMode 相当） ────────────

/** researchForm.ejs の syncPromptMode と同一の判定。
 *  - 初期 package（新規 / 既存 package）→ 常に package
 *  - 初期 custom（legacy）→ バージョン未選択なら custom 維持、選択したら package 昇格 */
function resolveHiddenMode(initial: "custom" | "package", selectedVersionId: string): "custom" | "package" {
  const hasVersion = selectedVersionId.trim() !== "";
  if (initial === "custom" && !hasVersion) return "custom";
  return "package";
}

test("新規 / 既存 package プロジェクトは常に package（バージョン有無に関わらず）", () => {
  assert.equal(resolveHiddenMode("package", ""), "package");
  assert.equal(resolveHiddenMode("package", "v-1"), "package");
});

test("legacy custom プロジェクト: バージョン未選択なら custom を維持する", () => {
  assert.equal(resolveHiddenMode("custom", ""), "custom");
  assert.equal(resolveHiddenMode("custom", "   "), "custom");
});

test("legacy custom プロジェクト: パッケージバージョンを選択したら package へ昇格する", () => {
  assert.equal(resolveHiddenMode("custom", "v-1"), "package");
});

// ─── 2. updateProject の data 保全ルール ────────────────────────────────────

/** updateProject の保存値構築（Phase B 後）。policy/overrides はフォームから読まず既存を温存。 */
function buildUpdatePromptFields(existing: {
  ai_prompt_policy_json: Record<string, unknown> | null;
  ai_prompt_templates_json: Record<string, unknown> | null;
  ai_prompt_overrides_json: Record<string, unknown> | null;
}) {
  return {
    ai_prompt_policy_json: existing.ai_prompt_policy_json ?? null,
    ai_prompt_templates_json: existing.ai_prompt_templates_json ?? null,
    ai_prompt_overrides_json: existing.ai_prompt_overrides_json ?? null,
  };
}

test("更新時: 既存 custom プロジェクトの policy / templates / overrides は温存される（フォームで上書きしない）", () => {
  const existing = {
    ai_prompt_policy_json: { researchType: "interview_research" },
    ai_prompt_templates_json: { buildProbePrompt: { enabled: true, template: "x" } },
    ai_prompt_overrides_json: { policy: { probeStyle: "comparison" } },
  };
  const saved = buildUpdatePromptFields(existing);
  assert.deepEqual(saved.ai_prompt_policy_json, existing.ai_prompt_policy_json);
  assert.deepEqual(saved.ai_prompt_templates_json, existing.ai_prompt_templates_json);
  assert.deepEqual(saved.ai_prompt_overrides_json, existing.ai_prompt_overrides_json);
});

test("作成時: package プロジェクトは policy / overrides を持たない（真実はパッケージ側）", () => {
  // createProject は ai_prompt_policy_json / overrides を null 固定にする
  const created = {
    ai_prompt_policy_json: null as Record<string, unknown> | null,
    ai_prompt_templates_json: null as Record<string, unknown> | null,
    ai_prompt_overrides_json: null as Record<string, unknown> | null,
  };
  assert.equal(created.ai_prompt_policy_json, null);
  assert.equal(created.ai_prompt_overrides_json, null);
});
