/**
 * 非誘導プリセット（例示なし）テスト
 *
 * 確認項目:
 * 1. non_leading プリセットが定義され、標準と同じく全キーを実体化する
 * 2. 上書き対象は「回答者に見える文面を出す10キー」だけ（他は BASE＝標準と同一）
 * 3. 上書きは BASE 本文への追記（BASE 本文が丸ごと保持される＝挙動保存）
 * 4. 設問文をレンダリングするキーだけ「元設問の例示を落とす」指示を持つ
 * 5. policy は標準と同じ空（標準との差分を例示排除だけに限定する）
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
  ALL_PROMPT_KEYS,
  BASE_PROMPT_TEMPLATES,
  NON_LEADING_OVERRIDE_KEYS,
  PROMPT_KEY_PLACEMENT,
  PROMPT_PRESETS,
  buildInitialTemplatesForPreset,
  summarizeTemplateDefinitions,
  type BasePromptKey,
} from "../prompts/basePromptTemplates";

const EXPECTED_OVERRIDE_KEYS: BasePromptKey[] = [
  "buildAnalyzeAnswerPrompt",
  "buildProbeGenerationPrompt",
  "buildProbePrompt",
  "buildQuestionRenderingPrompt",
  "buildInterviewTurnPrompt",
  "probeGuidanceCommon",
  "probeGuidanceText",
  "probeGuidanceChoiceSingle",
  "probeGuidanceChoiceMulti",
  "probeGuidanceNumeric",
];

test("NL1: non_leading プリセットが存在し全キーを実体化する", () => {
  assert.ok(PROMPT_PRESETS.non_leading, "non_leading プリセットが無い");
  const templates = buildInitialTemplatesForPreset("non_leading");
  assert.equal(Object.keys(templates).length, ALL_PROMPT_KEYS.length);
  for (const key of ALL_PROMPT_KEYS) {
    assert.equal(templates[key]!.enabled, true);
    assert.ok((templates[key]!.template ?? "").trim().length > 0, `${key} が空本文`);
  }
  const summary = summarizeTemplateDefinitions(templates);
  assert.equal(summary.custom, ALL_PROMPT_KEYS.length);
  assert.equal(summary.disabled, 0);
});

test("NL2: 上書き対象は10キーのみ・残りは標準（BASE）と完全一致", () => {
  assert.deepEqual([...NON_LEADING_OVERRIDE_KEYS].sort(), [...EXPECTED_OVERRIDE_KEYS].sort());

  const nonLeading = buildInitialTemplatesForPreset("non_leading");
  const standard = buildInitialTemplatesForPreset("standard");
  const overrideSet = new Set(NON_LEADING_OVERRIDE_KEYS);

  for (const key of ALL_PROMPT_KEYS) {
    if (overrideSet.has(key)) {
      assert.notEqual(nonLeading[key]!.template, standard[key]!.template, `${key} が標準と同一`);
    } else {
      assert.equal(nonLeading[key]!.template, standard[key]!.template, `${key} が標準から変化した`);
    }
  }
});

test("NL3: 上書き対象は全て会話系（package 管理）かつ BASE 本文を丸ごと保持する", () => {
  const templates = buildInitialTemplatesForPreset("non_leading");
  for (const key of NON_LEADING_OVERRIDE_KEYS) {
    const placement = PROMPT_KEY_PLACEMENT[key];
    assert.equal(placement.family, "conversation", `${key} が会話系でない`);
    assert.equal(placement.managedBy, "package", `${key} がパッケージ管理対象でない`);
    // 追記方式＝BASE 本文がそのまま残る（既存挙動を壊さない）
    assert.ok(
      templates[key]!.template!.startsWith(BASE_PROMPT_TEMPLATES[key].template),
      `${key} が BASE 本文で始まっていない（追記方式が壊れている）`,
    );
  }
});

test("NL4: 上書き本文に例示禁止ルールが入る／設問レンダリング系だけ例示除去指示を持つ", () => {
  const templates = buildInitialTemplatesForPreset("non_leading");
  const stripKeys: BasePromptKey[] = ["buildQuestionRenderingPrompt", "buildInterviewTurnPrompt"];

  for (const key of NON_LEADING_OVERRIDE_KEYS) {
    const body = templates[key]!.template!;
    const hasRule = body.includes("Non-leading rule") || body.includes("非誘導ルール");
    assert.ok(hasRule, `${key} に非誘導ルールが追記されていない`);
    assert.ok(body.includes("たとえば"), `${key} に禁止形の明示が無い`);
  }

  for (const key of stripKeys) {
    assert.ok(
      templates[key]!.template!.includes("drop that example part"),
      `${key} に元設問の例示除去指示が無い`,
    );
  }
  // 深掘り専用キーには元設問の例示除去指示を入れない（対象の設問文が存在しないため）
  assert.ok(!templates.buildProbePrompt!.template!.includes("drop that example part"));

  // 「既出の語しか使わない」は深掘り専用。設問レンダリング側に入れると元設問を再現できなくなる
  const probeOnly = "words the respondent has already used";
  assert.ok(templates.buildProbePrompt!.template!.includes(probeOnly));
  assert.ok(templates.buildProbeGenerationPrompt!.template!.includes(probeOnly));
  assert.ok(templates.buildAnalyzeAnswerPrompt!.template!.includes(probeOnly));
  for (const key of stripKeys) {
    assert.ok(
      !templates[key]!.template!.includes(probeOnly),
      `${key} に深掘り専用ルールが混入している（設問文が再現できなくなる）`,
    );
  }
});

test("NL5: policy は標準と同じ空（差分を例示排除だけに限定する）", () => {
  assert.equal(Object.keys(PROMPT_PRESETS.non_leading.policy).length, 0);
});
