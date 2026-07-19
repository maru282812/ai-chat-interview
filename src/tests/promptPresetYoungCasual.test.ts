/**
 * 若年層プリセット（カジュアル・非誘導）テスト
 *
 * 確認項目:
 * 1. young_casual プリセットが定義され、標準と同じく全キーを実体化する
 * 2. 上書き対象は非誘導と同じ10キーだけ（他は BASE＝標準と同一）
 * 3. 上書きは「BASE 本文 ＋ 非誘導ルール ＋ トーンルール」の積み上げ（挙動保存）
 * 4. 確定事項（絵文字禁止・です・ます維持・1問短く・再深掘りしない）が本文に入る
 * 5. policy は若年層向けの既定を持つ／テンプレ側と矛盾する軸は立てない
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
  YOUNG_CASUAL_OVERRIDE_KEYS,
  buildInitialTemplatesForPreset,
  buildNonLeadingTemplateOverrides,
  summarizeTemplateDefinitions,
} from "../prompts/basePromptTemplates";

test("YC1: young_casual プリセットが存在し全キーを実体化する", () => {
  assert.ok(PROMPT_PRESETS.young_casual, "young_casual プリセットが無い");
  const templates = buildInitialTemplatesForPreset("young_casual");
  assert.equal(Object.keys(templates).length, ALL_PROMPT_KEYS.length);
  for (const key of ALL_PROMPT_KEYS) {
    assert.equal(templates[key]!.enabled, true);
    assert.ok((templates[key]!.template ?? "").trim().length > 0, `${key} が空本文`);
  }
  const summary = summarizeTemplateDefinitions(templates);
  assert.equal(summary.custom, ALL_PROMPT_KEYS.length);
  assert.equal(summary.disabled, 0);
});

test("YC2: 上書き対象は非誘導と同じ10キーのみ・残りは標準と完全一致", () => {
  assert.deepEqual(
    [...YOUNG_CASUAL_OVERRIDE_KEYS].sort(),
    [...NON_LEADING_OVERRIDE_KEYS].sort(),
  );

  const young = buildInitialTemplatesForPreset("young_casual");
  const standard = buildInitialTemplatesForPreset("standard");
  const overrideSet = new Set(YOUNG_CASUAL_OVERRIDE_KEYS);

  for (const key of ALL_PROMPT_KEYS) {
    if (overrideSet.has(key)) {
      assert.notEqual(young[key]!.template, standard[key]!.template, `${key} が標準と同一`);
    } else {
      assert.equal(young[key]!.template, standard[key]!.template, `${key} が標準から変化した`);
    }
  }
});

test("YC3: BASE 本文 ＋ 非誘導ルール ＋ トーンルール の積み上げになっている", () => {
  const templates = buildInitialTemplatesForPreset("young_casual");
  const nonLeading = buildNonLeadingTemplateOverrides();

  for (const key of YOUNG_CASUAL_OVERRIDE_KEYS) {
    const body = templates[key]!.template!;
    const placement = PROMPT_KEY_PLACEMENT[key];
    assert.equal(placement.family, "conversation", `${key} が会話系でない`);
    assert.equal(placement.managedBy, "package", `${key} がパッケージ管理対象でない`);

    // BASE 本文がそのまま残る（既存挙動を壊さない）
    assert.ok(
      body.startsWith(BASE_PROMPT_TEMPLATES[key].template),
      `${key} が BASE 本文で始まっていない`,
    );
    // 非誘導ルールを丸ごと内包する（合成版＝非誘導を外さない）
    assert.ok(body.startsWith(nonLeading[key]!), `${key} が非誘導本文を保持していない`);
    // その後ろにトーンルールが乗る
    const hasTone = body.includes("Tone rule (young respondents)") || body.includes("若年層向けの深掘り");
    assert.ok(hasTone, `${key} にトーンルールが追記されていない`);
    // 非誘導ルールは残ったままである
    const hasNonLeading = body.includes("Non-leading rule") || body.includes("非誘導ルール");
    assert.ok(hasNonLeading, `${key} で非誘導ルールが失われた`);
  }
});

test("YC4: 確定事項（絵文字禁止・です・ます維持・短文・再深掘り禁止）が本文に入る", () => {
  const templates = buildInitialTemplatesForPreset("young_casual");
  const enKeys = YOUNG_CASUAL_OVERRIDE_KEYS.filter(
    (k) => !k.startsWith("probeGuidance"),
  );
  const jaKeys = YOUNG_CASUAL_OVERRIDE_KEYS.filter((k) => k.startsWith("probeGuidance"));

  for (const key of enKeys) {
    const body = templates[key]!.template!;
    assert.ok(body.includes("Do not use emoji"), `${key} に絵文字禁止が無い`);
    assert.ok(body.includes("です・ます"), `${key} に敬語維持の指定が無い`);
    assert.ok(body.includes("60 Japanese characters or fewer"), `${key} に長さ上限が無い`);
    assert.ok(body.includes("Never probe the same point twice"), `${key} に再深掘り禁止が無い`);
    assert.ok(body.includes("slang"), `${key} に若者言葉の模倣禁止が無い`);
  }

  for (const key of jaKeys) {
    const body = templates[key]!.template!;
    assert.ok(body.includes("絵文字は使わない"), `${key} に絵文字禁止が無い`);
    assert.ok(body.includes("「です・ます」を保つ"), `${key} に敬語維持の指定が無い`);
    assert.ok(body.includes("再確認は1回まで"), `${key} に辞退回答の上限が無い`);
  }
});

test("YC5: policy は若年層向けの既定を持ち、テンプレと衝突する軸は立てない", () => {
  const policy = PROMPT_PRESETS.young_casual.policy;
  assert.equal(policy.audience, "young_casual");
  assert.equal(policy.priority, "respondent_comfort_first");
  assert.equal(policy.noneAnswerPolicy, "ask_for_small_hint");
  assert.ok(policy.restrictions?.includes("no_leading_question"));
  assert.ok(policy.restrictions?.includes("one_question_only"));
  // ambiguousAnswerRule は既定のまま（concrete_example の「たとえば〜」が
  // 非誘導ルールの禁止形と字面で衝突するため、抽象語対応はテンプレ側に一本化する）
  assert.equal(policy.ambiguousAnswerRule, undefined);
});
