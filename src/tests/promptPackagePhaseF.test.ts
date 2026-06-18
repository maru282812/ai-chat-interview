/**
 * Phase F: プロンプトビルダー（方針 → AI生成 → templates_json）
 *
 * 1. BUILDER_GENERATION_KEYS: 生成対象は会話系（usedPolicies 非空）10キーのみ。
 *    タグ系・管理ツール系（B/C群）は含まない。
 * 2. normalizePromptBuilderSpec: trim / 未知キー破棄 / prohibitions の配列化。
 * 3. buildGenerationMetaPrompt: 各対象BASE本文＋方針＋保持ルールを含む。
 * 4. parseGenerationResult: 正常採用 / プレースホルダー欠落・混入は不採用＋warning / 不正JSON。
 * 5. generatePromptPackageVersionTemplates: callRaw をスタブして生成結果が返ることを確認。
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

import { BASE_PROMPT_TEMPLATES, BUILDER_GENERATION_KEYS, type BasePromptKey } from "../prompts/basePromptTemplates";
import {
  normalizePromptBuilderSpec,
  buildGenerationMetaPrompt,
  parseGenerationResult,
  PROMPT_BUILDER_FIELDS,
  POLICY_HEADER_KEYS,
} from "../services/promptBuilderService";

// ─── 1. BUILDER_GENERATION_KEYS ──────────────────────────────────────────────

test("F1: 生成対象は会話系10キー（usedPolicies 非空）", () => {
  assert.equal(BUILDER_GENERATION_KEYS.length, 10);
  for (const key of BUILDER_GENERATION_KEYS) {
    assert.ok(BASE_PROMPT_TEMPLATES[key].usedPolicies.length > 0, `${key} は usedPolicies 非空のはず`);
  }
});

test("F2: タグ系・管理ツール系（B/C群）は生成対象に含まれない", () => {
  const excluded: BasePromptKey[] = [
    "buildRantExtendedPrompt",
    "buildDiaryExtendedPrompt",
    "buildPersonaTagsPrompt",
    "buildProjectInitialStatePrompt",
    "buildGenerateFlowPrompt",
    "buildSurveyOptionsPrompt",
    "buildMissingAttributeSuggestionsPrompt",
  ];
  for (const key of excluded) {
    assert.ok(!BUILDER_GENERATION_KEYS.includes(key), `${key} は生成対象外のはず`);
  }
});

// ─── 2. normalizePromptBuilderSpec ───────────────────────────────────────────

test("F3: テキストフィールドは trim、空・未知キーは破棄", () => {
  const spec = normalizePromptBuilderSpec({
    purpose: "  インタビュー  ",
    goal: "",
    questionStyle: "フレンドリー",
    unknownKey: "捨てられる",
  });
  assert.equal(spec.purpose, "インタビュー");
  assert.equal(spec.questionStyle, "フレンドリー");
  assert.equal(spec.goal, undefined);
  assert.ok(!("unknownKey" in spec));
});

test("F4: prohibitions は配列・改行区切り文字列どちらも配列化（空行除去）", () => {
  const fromArray = normalizePromptBuilderSpec({ prohibitions: [" 誘導質問しない ", "", "断定しない"] });
  assert.deepEqual(fromArray.prohibitions, ["誘導質問しない", "断定しない"]);

  const fromString = normalizePromptBuilderSpec({ prohibitions: "A\n\nB\n C " });
  assert.deepEqual(fromString.prohibitions, ["A", "B", "C"]);

  const empty = normalizePromptBuilderSpec({ prohibitions: ["", "  "] });
  assert.ok(!("prohibitions" in empty));
});

test("F5: 不正入力は空オブジェクト", () => {
  assert.deepEqual(normalizePromptBuilderSpec(null), {});
  assert.deepEqual(normalizePromptBuilderSpec("string"), {});
});

test("F6: PROMPT_BUILDER_FIELDS は11軸を定義しUIメタを持つ", () => {
  assert.equal(PROMPT_BUILDER_FIELDS.length, 11);
  for (const f of PROMPT_BUILDER_FIELDS) {
    assert.ok(f.key && f.label && f.type, "key/label/type が必要");
  }
});

test("F6b: 振る舞い方針セクション（behaviorPolicy/usagePreset/probeIntensity/outputQuality）も正規化・保持される", () => {
  assert.deepEqual(POLICY_HEADER_KEYS, ["behaviorPolicy", "usagePreset", "probeIntensity", "outputQuality"]);
  const spec = normalizePromptBuilderSpec({
    behaviorPolicy: "  LINEインタビュー用。質問攻めにしない。  ",
    usagePreset: "インタビュー",
    probeIntensity: "積極的",
    outputQuality: "",
  });
  assert.equal(spec.behaviorPolicy, "LINEインタビュー用。質問攻めにしない。");
  assert.equal(spec.usagePreset, "インタビュー");
  assert.equal(spec.probeIntensity, "積極的");
  assert.equal(spec.outputQuality, undefined);
});

// ─── 3. buildGenerationMetaPrompt ────────────────────────────────────────────

test("F7: メタプロンプトに方針・対象BASE本文・保持ルールが含まれる", () => {
  const prompt = buildGenerationMetaPrompt({ questionStyle: "フレンドリー", goal: "解約理由の把握" });
  // 方針
  assert.ok(prompt.includes("フレンドリー"));
  assert.ok(prompt.includes("解約理由の把握"));
  // 各対象キーと BASE 本文の一部
  for (const key of BUILDER_GENERATION_KEYS) {
    assert.ok(prompt.includes(`### KEY: ${key}`), `${key} のブロックが必要`);
  }
  assert.ok(prompt.includes("Write exactly one short follow-up question."), "buildProbePrompt の BASE 本文が必要");
  // 保持ルール
  assert.ok(prompt.includes("プレースホルダー"));
  assert.ok(prompt.includes("出力形式"));
});

test("F7b: 振る舞い方針セクションの内容もメタプロンプトの方針ブロックに含まれる", () => {
  const prompt = buildGenerationMetaPrompt({
    behaviorPolicy: "質問攻めにしない。深掘りは最大2回。",
    usagePreset: "インタビュー",
    outputQuality: "精度優先",
  });
  assert.ok(prompt.includes("質問攻めにしない。深掘りは最大2回。"));
  assert.ok(prompt.includes("インタビュー"));
  assert.ok(prompt.includes("精度優先"));
});

// ─── 4. parseGenerationResult ────────────────────────────────────────────────

/** BASE 本文をそのまま採用した場合（プレースホルダー完全一致）の正常JSON */
function baseEchoJson(keys: BasePromptKey[]): string {
  const obj: Record<string, string> = {};
  for (const k of keys) obj[k] = BASE_PROMPT_TEMPLATES[k].template;
  return JSON.stringify(obj);
}

test("F8: 正常JSONは対象キーのみ採用", () => {
  const res = parseGenerationResult(baseEchoJson(BUILDER_GENERATION_KEYS));
  assert.equal(res.generatedKeys.length, 10);
  assert.equal(Object.keys(res.templates).length, 10);
  assert.equal(res.warnings.length, 0);
});

test("F9: コードフェンス付きJSONも解析できる", () => {
  const wrapped = "```json\n" + baseEchoJson(["buildProbePrompt"]) + "\n```";
  const res = parseGenerationResult(wrapped, ["buildProbePrompt"]);
  assert.equal(res.generatedKeys.length, 1);
});

test("F10: 必要なプレースホルダーが欠落した本文は不採用＋warning", () => {
  // buildProbePrompt から {{answer}} を除去
  const broken = BASE_PROMPT_TEMPLATES.buildProbePrompt.template.replace("{{answer}}", "(削除)");
  const res = parseGenerationResult(JSON.stringify({ buildProbePrompt: broken }), ["buildProbePrompt"]);
  assert.equal(res.generatedKeys.length, 0);
  assert.ok(res.warnings.some((w) => w.includes("buildProbePrompt") && w.includes("欠落")));
});

test("F11: 許可外プレースホルダーが混入した本文は不採用＋warning", () => {
  const tampered = BASE_PROMPT_TEMPLATES.buildProbePrompt.template + " {{nope}}";
  const res = parseGenerationResult(JSON.stringify({ buildProbePrompt: tampered }), ["buildProbePrompt"]);
  assert.equal(res.generatedKeys.length, 0);
  assert.ok(res.warnings.some((w) => w.includes("許可外")));
});

test("F12: 不正JSON・空応答は空＋warning", () => {
  const bad = parseGenerationResult("これはJSONではありません", ["buildProbePrompt"]);
  assert.equal(bad.generatedKeys.length, 0);
  assert.ok(bad.warnings.length > 0);

  const empty = parseGenerationResult("", ["buildProbePrompt"]);
  assert.equal(empty.generatedKeys.length, 0);
  assert.ok(empty.warnings.length > 0);
});

test("F13: 対象外キーは無視（warning に記録）", () => {
  const json = JSON.stringify({
    buildProbePrompt: BASE_PROMPT_TEMPLATES.buildProbePrompt.template,
    buildRantExtendedPrompt: "対象外",
  });
  const res = parseGenerationResult(json, ["buildProbePrompt"]);
  assert.equal(res.generatedKeys.length, 1);
  assert.ok(res.warnings.some((w) => w.includes("対象外") || w.includes("buildRantExtendedPrompt")));
});

// ─── 5. controller: generatePromptPackageVersionTemplates ────────────────────

test("F14: 生成ハンドラは callRaw 結果をパースして JSON 返却（DB非依存）", async () => {
  const { aiService } = await import("../services/aiService");
  const originalCallRaw = aiService.callRaw;
  aiService.callRaw = async () => ({ content: baseEchoJson(BUILDER_GENERATION_KEYS), tokenUsage: null });
  try {
    const { adminController } = await import("../controllers/adminController");

    let captured: unknown = null;
    let statusCode = 200;
    const res = {
      status(c: number) { statusCode = c; return res; },
      json(b: unknown) { captured = b; return res; },
    };
    const req = { body: { builder_spec_json: JSON.stringify({ questionStyle: "フレンドリー" }) } };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await adminController.generatePromptPackageVersionTemplates(req as any, res as any);

    assert.equal(statusCode, 200);
    const body = captured as { generatedKeys: string[]; templates: Record<string, string> };
    assert.equal(body.generatedKeys.length, 10);
    assert.ok(body.templates.buildProbePrompt);
  } finally {
    aiService.callRaw = originalCallRaw;
  }
});

test("F15: 方針未入力は 400", async () => {
  const { adminController } = await import("../controllers/adminController");
  let statusCode = 200;
  let captured: unknown = null;
  const res = {
    status(c: number) { statusCode = c; return res; },
    json(b: unknown) { captured = b; return res; },
  };
  const req = { body: { builder_spec_json: "{}" } };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await adminController.generatePromptPackageVersionTemplates(req as any, res as any);
  assert.equal(statusCode, 400);
  assert.ok((captured as { error: string }).error);
});

console.log("promptPackagePhaseF.test.ts: all tests defined");
