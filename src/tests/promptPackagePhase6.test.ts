/**
 * Phase 6: AIプロンプト管理基盤 改修テスト
 *
 * 確認項目:
 * 1. 6-B: mergePolicyWithOverrides — オーバーライドキーのみ上書き・restrictions は配列ごと置換・不正値除去
 * 2. 6-C: BASE_PROMPT_TEMPLATES — 全10テンプレートに可視化メタ（用途・タイミング・影響範囲・出力形式・利用ポリシー）が定義されている
 * 3. 6-E: diffLines / extractPlaceholders / diffPolicies / diffTemplates / buildVersionDiff
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

import { mergePolicyWithOverrides } from "../prompts/promptPolicies";
import { BASE_PROMPT_TEMPLATES, describePolicyAxis, type BasePromptKey } from "../prompts/basePromptTemplates";
import {
  buildVersionDiff,
  diffLines,
  diffPolicies,
  diffTemplates,
  extractPlaceholders,
} from "../services/promptPackageDiffService";
import type { PromptPackageVersion } from "../repositories/promptPackageRepository";

// ─── 6-B: mergePolicyWithOverrides ───────────────────────────────────────────

test("オーバーライドで設定したキーのみパッケージ policy を上書きする", () => {
  const merged = mergePolicyWithOverrides(
    { researchType: "standard_research", audience: "general", priority: "research_quality_first" },
    { audience: "female_friendly" }
  );
  assert.deepEqual(merged, {
    researchType: "standard_research",
    audience: "female_friendly",
    priority: "research_quality_first",
  });
});

test("オーバーライドが空ならパッケージ policy がそのまま返る", () => {
  const merged = mergePolicyWithOverrides({ researchType: "interview_research" }, null);
  assert.deepEqual(merged, { researchType: "interview_research" });
  const merged2 = mergePolicyWithOverrides({ researchType: "interview_research" }, {});
  assert.deepEqual(merged2, { researchType: "interview_research" });
});

test("restrictions は部分マージではなく配列ごと置換される", () => {
  const merged = mergePolicyWithOverrides(
    { restrictions: ["no_leading_question", "one_question_only"] },
    { restrictions: ["no_internal_codes"] }
  );
  assert.deepEqual(merged.restrictions, ["no_internal_codes"]);
});

test("restrictions を空配列で上書きすると制限なしになる", () => {
  const merged = mergePolicyWithOverrides(
    { restrictions: ["no_leading_question"] },
    { restrictions: [] }
  );
  assert.deepEqual(merged.restrictions, []);
});

test("不正なキー・不正な値は正規化で除去される", () => {
  const merged = mergePolicyWithOverrides(
    { researchType: "standard_research" },
    { audience: "invalid_audience_value", researchType: "interview_research" } as never
  );
  // 不正値 audience は落ち、有効値 researchType は上書きされる
  assert.deepEqual(merged, { researchType: "interview_research" });
});

test("パッケージ policy が null でもオーバーライドのみで成立する", () => {
  const merged = mergePolicyWithOverrides(null, { probeStyle: "comparison" });
  assert.deepEqual(merged, { probeStyle: "comparison" });
});

// ─── 6-C: 可視化メタ情報 ─────────────────────────────────────────────────────

test("全テンプレートに可視化メタ情報が定義されている", () => {
  // Phase 7-A で B1〜B7 が追加され 17 キー
  // Phase 7-B で管理ツール系 4 キーが追加され 21 キー
  // ポリシー軸は B 群・管理ツール群には適用しないため usedPolicies は空を許容
  const PHASE7_KEYS = new Set([
    "buildProjectInitialStatePrompt",
    "buildProjectAnalysisPrompt",
    "buildPostAnalysisPrompt",
    "buildRantExtendedPrompt",
    "buildDiaryExtendedPrompt",
    "buildRantCounselorReplyPrompt",
    "buildPersonaTagsPrompt",
    // Phase 7-B 管理ツール系
    "buildSurveyOptionsPrompt",
    "buildAdjustQuestionsPrompt",
    "buildGenerateFlowPrompt",
    "buildMissingAttributeSuggestionsPrompt",
  ]);
  const keys = Object.keys(BASE_PROMPT_TEMPLATES) as BasePromptKey[];
  assert.equal(keys.length, 21);
  for (const key of keys) {
    const def = BASE_PROMPT_TEMPLATES[key];
    assert.ok(def.description.trim(), `${key}: description（用途）が空`);
    assert.ok(def.callTiming.trim(), `${key}: callTiming（呼び出しタイミング）が空`);
    assert.ok(def.impactScope.trim(), `${key}: impactScope（影響範囲）が空`);
    assert.ok(def.outputFormat.trim(), `${key}: outputFormat（出力形式）が空`);
    assert.ok(Array.isArray(def.usedPolicies), `${key}: usedPolicies が配列でない`);
    if (!PHASE7_KEYS.has(key)) {
      assert.ok(def.usedPolicies.length > 0, `${key}: usedPolicies（利用ポリシー）が空`);
    }
    assert.ok(def.allowedPlaceholders.length > 0, `${key}: allowedPlaceholders（利用変数）が空`);
  }
});

test("describePolicyAxis は全軸の日本語ラベルを返す", () => {
  assert.equal(describePolicyAxis("researchType"), "調査タイプ");
  assert.equal(describePolicyAxis("restrictions"), "制限ルール");
  // 未知キーはそのまま返す
  assert.equal(describePolicyAxis("unknownKey"), "unknownKey");
});

// ─── 6-E: 差分計算 ───────────────────────────────────────────────────────────

test("diffLines: 追加・削除・共通行を判定する", () => {
  const rows = diffLines("line1\nline2\nline3", "line1\nlineX\nline3");
  assert.deepEqual(rows, [
    { type: "same", text: "line1" },
    { type: "removed", text: "line2" },
    { type: "added", text: "lineX" },
    { type: "same", text: "line3" },
  ]);
});

test("diffLines: 同一テキストは全行 same", () => {
  const rows = diffLines("a\nb", "a\nb");
  assert.ok(rows.every((r) => r.type === "same"));
});

test("extractPlaceholders: {{placeholder}} を重複なしで抽出する", () => {
  const found = extractPlaceholders("A {{foo}} B {{ bar }} C {{foo}}");
  assert.deepEqual(found.sort(), ["bar", "foo"]);
});

test("diffPolicies: 変更されたキーのみ返す", () => {
  const changes = diffPolicies(
    { researchType: "standard_research", audience: "general" },
    { researchType: "standard_research", audience: "business", priority: "comparability_first" }
  );
  assert.deepEqual(
    changes.map((c) => c.key).sort(),
    ["audience", "priority"]
  );
  const audienceChange = changes.find((c) => c.key === "audience");
  assert.equal(audienceChange?.fromValue, "general");
  assert.equal(audienceChange?.toValue, "business");
  const priorityChange = changes.find((c) => c.key === "priority");
  assert.equal(priorityChange?.fromValue, null);
});

test("diffTemplates: カスタム化されたテンプレートを added として検出する", () => {
  const changes = diffTemplates(
    null,
    { buildProbePrompt: { enabled: true, template: "カスタム深掘り {{question}} {{answer}}" } }
  );
  const probeChange = changes.find((c) => c.key === "buildProbePrompt");
  assert.equal(probeChange?.changeType, "added");
  assert.ok(probeChange!.lines.length > 0);
  // 他キーは unchanged
  const others = changes.filter((c) => c.key !== "buildProbePrompt");
  assert.ok(others.every((c) => c.changeType === "unchanged"));
});

test("diffTemplates: カスタム → デフォルトに戻すと removed・削除変数を検出する", () => {
  const changes = diffTemplates(
    { buildProbePrompt: { enabled: true, template: "カスタム {{question}} {{customVar}}" } },
    null
  );
  const probeChange = changes.find((c) => c.key === "buildProbePrompt");
  assert.equal(probeChange?.changeType, "removed");
  assert.ok(probeChange!.removedPlaceholders.includes("customVar"));
});

test("buildVersionDiff: policy とテンプレートの差分をまとめて返す", () => {
  const baseVersion: PromptPackageVersion = {
    id: "00000000-0000-4000-8000-000000000011",
    package_id: "00000000-0000-4000-8000-000000000010",
    version_no: 1,
    status: "archived",
    policy_json: { researchType: "standard_research" },
    templates_json: null,
    change_note: null,
    published_at: null,
    created_at: "2026-06-12T00:00:00.000Z",
    updated_at: "2026-06-12T00:00:00.000Z",
  };
  const nextVersion: PromptPackageVersion = {
    ...baseVersion,
    id: "00000000-0000-4000-8000-000000000012",
    version_no: 2,
    status: "published",
    policy_json: { researchType: "interview_research" },
    templates_json: { buildProbePrompt: { enabled: true, template: "new {{question}}" } },
  };

  const diff = buildVersionDiff(baseVersion, nextVersion);
  assert.equal(diff.policyChanges.length, 1);
  assert.equal(diff.policyChanges[0]?.key, "researchType");
  assert.equal(diff.changedTemplateCount, 1);
  // Phase 7-B: 管理ツール系4キー追加で全21キー
  assert.equal(diff.templateChanges.length, 21);
});
