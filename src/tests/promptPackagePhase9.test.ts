/**
 * Phase 9: Package First 化（再設計指示 Phase A〜F）テスト
 *
 * 確認項目:
 * 1. buildInitialTemplatesForPreset('standard') が全キーを enabled+template 付きで返す
 * 2. 各プリセットの policy が想定キーを持つ / templateOverrides が反映される
 * 3. summarizeTemplateDefinitions の数え方（custom / base / disabled / defined）
 * 4. resolvePromptMeta: packageMeta あり×templates null → package_template（Phase F 回帰）
 * 5. resolvePromptMeta: packageMeta なし×templates null → legacy（既存挙動維持）
 */

import assert from "node:assert/strict";
import { test } from "node:test";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.OPENAI_TOOL_MODEL ||= "gpt-4o-mini";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_BASIC_USER ||= "admin";
process.env.ADMIN_BASIC_PASSWORD ||= "password";

import {
  BASE_PROMPT_TEMPLATES,
  ALL_PROMPT_KEYS,
  PROMPT_PRESETS,
  buildInitialTemplatesForPreset,
  summarizeTemplateDefinitions,
  type PromptPresetKey,
} from "../prompts/basePromptTemplates";
import { resolvePromptMeta } from "../services/aiService";
import type { Project } from "../types/domain";

// Phase 7-B で管理ツール系4キー、Phase I-B で型別深掘りガイダンス5キー、
// 管理画面AIチャットで adminChatCommon 1キーが増えて全27キー。
const TOTAL_KEYS = 27;

// ---------------------------------------------------------------------------
// Test 1: BASE標準セット生成（空Version撲滅）
// ---------------------------------------------------------------------------
test("Phase9: buildInitialTemplatesForPreset('standard') が全キーを実体化する", () => {
  assert.equal(ALL_PROMPT_KEYS.length, TOTAL_KEYS);
  const templates = buildInitialTemplatesForPreset("standard");
  assert.equal(Object.keys(templates).length, TOTAL_KEYS);
  for (const key of ALL_PROMPT_KEYS) {
    const entry = templates[key];
    assert.ok(entry, `${key} が存在しない`);
    assert.equal(entry.enabled, true);
    // standard は BASE 本文そのまま
    assert.equal(entry.template, BASE_PROMPT_TEMPLATES[key].template);
    assert.ok((entry.template ?? "").trim().length > 0);
  }
});

test("Phase9: standard 生成の定義率は 全キー/全キー（全てカスタム実体）", () => {
  const summary = summarizeTemplateDefinitions(buildInitialTemplatesForPreset("standard"));
  assert.deepEqual(summary, { total: TOTAL_KEYS, defined: TOTAL_KEYS, custom: TOTAL_KEYS, base: 0, disabled: 0 });
});

// ---------------------------------------------------------------------------
// Test 2: プリセット policy / templateOverrides
// ---------------------------------------------------------------------------
test("Phase9: 各プリセットが定義され standard 以外は policy を持つ", () => {
  const keys: PromptPresetKey[] = ["standard", "business", "website_hunter", "interview", "animal_hospital"];
  for (const k of keys) {
    assert.ok(PROMPT_PRESETS[k], `${k} プリセットが無い`);
    assert.ok(typeof PROMPT_PRESETS[k].label === "string");
  }
  // standard は空ポリシー
  assert.equal(Object.keys(PROMPT_PRESETS.standard.policy).length, 0);
  // business はフォーマル系の軸を持つ
  assert.equal(PROMPT_PRESETS.business.policy.audience, "business");
  assert.ok(Array.isArray(PROMPT_PRESETS.business.policy.restrictions));
});

test("Phase9: templateOverrides は buildInitialTemplatesForPreset に反映される", () => {
  // 動的にオーバーライドを差し込んで反映を検証（定義は汚さない）
  const sampleKey = ALL_PROMPT_KEYS[0]!;
  const original = PROMPT_PRESETS.standard.templateOverrides;
  PROMPT_PRESETS.standard.templateOverrides = { [sampleKey]: "OVERRIDE_BODY" };
  try {
    const templates = buildInitialTemplatesForPreset("standard");
    assert.equal(templates[sampleKey]!.template, "OVERRIDE_BODY");
  } finally {
    PROMPT_PRESETS.standard.templateOverrides = original;
  }
});

// ---------------------------------------------------------------------------
// Test 3: 定義率サマリー
// ---------------------------------------------------------------------------
test("Phase9: summarizeTemplateDefinitions が custom/base/disabled/defined を正しく数える", () => {
  const k = ALL_PROMPT_KEYS;
  const templates = {
    [k[0]!]: { enabled: true, template: "カスタム本文" }, // custom
    [k[1]!]: { enabled: true, template: "" },              // base（空本文）
    [k[2]!]: { enabled: true },                            // base（template 未設定）
    [k[3]!]: { enabled: false, template: "x" },            // disabled
  };
  const s = summarizeTemplateDefinitions(templates);
  assert.equal(s.total, TOTAL_KEYS);
  assert.equal(s.custom, 1);
  assert.equal(s.disabled, 1);
  // 残り（base）= total - custom - disabled
  assert.equal(s.base, TOTAL_KEYS - 1 - 1);
  assert.equal(s.defined, s.custom + s.base);
});

test("Phase9: null templates_json は全キー base 扱い（defined=全キー, custom=0）", () => {
  const s = summarizeTemplateDefinitions(null);
  assert.deepEqual(s, { total: TOTAL_KEYS, defined: TOTAL_KEYS, custom: 0, base: TOTAL_KEYS, disabled: 0 });
});

// ---------------------------------------------------------------------------
// Test 4 / 5: resolvePromptMeta（Phase F）
// ---------------------------------------------------------------------------
const packageMeta = {
  package_id: "pkg-1",
  package_version_id: "ver-1",
  package_slug: "standard_interview",
  package_version_no: 3,
};

function makeProject(templatesJson: unknown): Project {
  return {
    ai_prompt_templates_json: templatesJson,
    ai_prompt_policy_json: null,
    ai_prompt_mode: "package",
  } as unknown as Project;
}

test("Phase9(F): packageMeta あり × templates null でも package_template を記録する", () => {
  const meta = resolvePromptMeta(makeProject(null), "buildAnalyzeAnswerPrompt", packageMeta);
  assert.equal(meta.template_mode, "package_template");
  assert.equal(meta.template_key, "buildAnalyzeAnswerPrompt");
  assert.equal(meta.package_id, "pkg-1");
  assert.equal(meta.package_version_no, 3);
});

test("Phase9(F): packageMeta あり × BASE由来テンプレートでも package_template", () => {
  const meta = resolvePromptMeta(
    makeProject({ buildAnalyzeAnswerPrompt: { enabled: true } }),
    "buildAnalyzeAnswerPrompt",
    packageMeta
  );
  assert.equal(meta.template_mode, "package_template");
});

test("Phase9(F): packageMeta なし × templates null は従来通り legacy", () => {
  const meta = resolvePromptMeta(makeProject(null), "buildAnalyzeAnswerPrompt", null);
  assert.equal(meta.template_mode, "legacy");
  assert.equal(meta.package_id, undefined);
});

test("Phase9(F): packageMeta なし × カスタム本文は custom_template", () => {
  const meta = resolvePromptMeta(
    makeProject({ buildAnalyzeAnswerPrompt: { enabled: true, template: "X{{answer}}" } }),
    "buildAnalyzeAnswerPrompt",
    null
  );
  assert.equal(meta.template_mode, "custom_template");
});
