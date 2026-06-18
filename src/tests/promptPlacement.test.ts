/**
 * プロンプト配置メタ（可視化用）の整合テスト
 *
 * PROMPT_KEY_PLACEMENT は管理画面で「どのキーがどの系統で・どこで発火し・
 * 深掘りに影響するか」を見せるためのメタ。文面・runtime には影響しないが、
 * BASE_PROMPT_TEMPLATES / BUILDER_GENERATION_KEYS とズレると誤誘導になるため、
 * 整合を固定する。
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ALL_PROMPT_KEYS,
  BUILDER_GENERATION_KEYS,
  BASE_PROMPT_TEMPLATES,
  PROMPT_KEY_PLACEMENT,
  PROMPT_FAMILY_LABEL,
  PROMPT_FAMILY_ORDER,
  summarizeTemplateDefinitions,
  summarizeTemplateDefinitionsByFamily,
  type BasePromptKey,
} from "../prompts/basePromptTemplates";

test("P1: 全21キーに配置メタが存在し、余剰キーがない", () => {
  for (const key of ALL_PROMPT_KEYS) {
    assert.ok(PROMPT_KEY_PLACEMENT[key], `${key} の配置メタが無い`);
  }
  assert.equal(Object.keys(PROMPT_KEY_PLACEMENT).length, ALL_PROMPT_KEYS.length);
});

test("P2: conversation 系統 ⊇ BUILDER_GENERATION_KEYS（生成対象10 ＋ 型別ガイダンス5）", () => {
  const conversation = ALL_PROMPT_KEYS.filter(
    (k) => PROMPT_KEY_PLACEMENT[k].family === "conversation"
  );
  // 会話系は「AI一括生成対象（usedPolicies 非空＝BUILDER_GENERATION_KEYS）」を必ず含む
  for (const k of BUILDER_GENERATION_KEYS) {
    assert.ok(conversation.includes(k), `${k} は conversation 系統のはず`);
  }
  // 生成対象に含まれない会話系＝型別深掘りガイダンス（バージョン管理対象だが一括生成外）
  const guidance = conversation.filter((k) => !BUILDER_GENERATION_KEYS.includes(k));
  assert.deepEqual([...guidance].sort(), [
    "probeGuidanceChoiceMulti",
    "probeGuidanceChoiceSingle",
    "probeGuidanceCommon",
    "probeGuidanceNumeric",
    "probeGuidanceText",
  ]);
});

test("P3: managedBy=package は conversation 系統に限る", () => {
  for (const key of ALL_PROMPT_KEYS) {
    const p = PROMPT_KEY_PLACEMENT[key];
    assert.equal(
      p.managedBy === "package",
      p.family === "conversation",
      `${key}: managedBy と family の対応が不整合`
    );
  }
});

test("P4: dormant フラグは callTiming（呼び出し元なし）と一致", () => {
  for (const key of ALL_PROMPT_KEYS) {
    const expected = BASE_PROMPT_TEMPLATES[key].callTiming.includes("現在呼び出し元なし");
    assert.equal(PROMPT_KEY_PLACEMENT[key].dormant, expected, `${key}: dormant 不整合`);
  }
});

test("P5: 深掘り影響キーは想定どおり（analyze/interview/probe生成/probe簡易）", () => {
  const probeImpact = ALL_PROMPT_KEYS.filter((k) => PROMPT_KEY_PLACEMENT[k].probeImpact);
  const expected: BasePromptKey[] = [
    "buildAnalyzeAnswerPrompt",
    "buildInterviewTurnPrompt",
    "buildProbeGenerationPrompt",
    "buildProbePrompt",
    // Phase I-B: 型別深掘りガイダンスも深掘り挙動に直結
    "probeGuidanceCommon",
    "probeGuidanceText",
    "probeGuidanceChoiceSingle",
    "probeGuidanceChoiceMulti",
    "probeGuidanceNumeric",
  ];
  assert.deepEqual([...probeImpact].sort(), [...expected].sort());
});

test("P6: 休眠キーは発火文脈が空・非休眠キーは1つ以上", () => {
  for (const key of ALL_PROMPT_KEYS) {
    const p = PROMPT_KEY_PLACEMENT[key];
    if (p.dormant) {
      assert.equal(p.contexts.length, 0, `${key}: 休眠なのに発火文脈がある`);
    } else {
      assert.ok(p.contexts.length > 0, `${key}: 非休眠なのに発火文脈が無い`);
    }
  }
});

test("P7: 使用される全系統にラベルがあり、ORDER が網羅している", () => {
  const used = new Set(ALL_PROMPT_KEYS.map((k) => PROMPT_KEY_PLACEMENT[k].family));
  for (const fam of used) {
    assert.ok(PROMPT_FAMILY_LABEL[fam], `${fam} のラベルが無い`);
    assert.ok(PROMPT_FAMILY_ORDER.includes(fam), `${fam} が ORDER に無い`);
  }
});

test("P8: 系統別サマリーの合計が全体サマリーと一致する", () => {
  // 一部 custom / 一部 disabled の templates_json を作って集計を検証
  const templates = {
    buildAnalyzeAnswerPrompt: { enabled: true, template: "custom A" },
    buildInterviewTurnPrompt: { enabled: false, template: "" },
    buildPostAnalysisPrompt: { enabled: true, template: "custom P" },
  } as Record<string, { enabled: boolean; template: string }>;

  const whole = summarizeTemplateDefinitions(templates);
  const byFamily = summarizeTemplateDefinitionsByFamily(templates);

  const sum = byFamily.reduce(
    (a, f) => ({
      total: a.total + f.total,
      custom: a.custom + f.custom,
      base: a.base + f.base,
      disabled: a.disabled + f.disabled,
    }),
    { total: 0, custom: 0, base: 0, disabled: 0 }
  );
  assert.equal(sum.total, whole.total);
  assert.equal(sum.custom, whole.custom);
  assert.equal(sum.base, whole.base);
  assert.equal(sum.disabled, whole.disabled);
  // 各系統内も内訳合計が total に一致
  for (const f of byFamily) {
    assert.equal(f.custom + f.base + f.disabled, f.total, `${f.family} の内訳合計不一致`);
  }
});

test("P9: 系統別サマリーは PROMPT_FAMILY_ORDER 順で managedBy が正しい", () => {
  const byFamily = summarizeTemplateDefinitionsByFamily(null);
  const order = byFamily.map((f) => f.family);
  const expectedOrder = PROMPT_FAMILY_ORDER.filter((f) => order.includes(f));
  assert.deepEqual(order, expectedOrder);
  for (const f of byFamily) {
    assert.equal(f.managedBy, f.family === "conversation" ? "package" : "base");
  }
});
