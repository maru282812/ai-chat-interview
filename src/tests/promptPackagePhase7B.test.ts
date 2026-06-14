/**
 * Phase 7-B: 管理ツール系プロンプト一元管理テスト
 *
 * 確認項目:
 * 1. legacy一致: カスタムテンプレートなし → 従来プロンプトと完全一致文字列を出力
 * 2. テンプレート適用: カスタムテンプレートあり → プレースホルダーが正しく置換される
 * 3. legacy モード判定: project=null → templateMode="legacy"
 * 4. base_template モード判定: templates_json あり・カスタムなし → "base_template"
 * 5. custom_template モード判定: templates_json にカスタムあり → "custom_template"
 * 6. 不正プレースホルダー: 使用されていても warn ログで落ちない（空文字に変換）
 * 7. BASE_PROMPT_TEMPLATES に 4 つの新キーが存在する
 * 8. systemPrompt フィールドが管理ツール系キーに設定されている
 * 9. missingAttributeSuggestions: project なし → 常に "legacy"
 * 10. ai_logs 記録フィールドが期待値と一致する
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

import { BASE_PROMPT_TEMPLATES } from "../prompts/basePromptTemplates";
import {
  buildSurveyOptionsPrompt,
  buildAdjustQuestionsPrompt,
  buildGenerateFlowPrompt,
  buildMissingAttributeSuggestionsPrompt,
} from "../prompts/adminPrompts";
import {
  renderPromptTemplate,
  extractTemplatePlaceholders,
} from "../prompts/promptTemplateRenderer";

// ---------------------------------------------------------------------------
// Helper: 従来ハードコードプロンプト（legacy 一致確認用）
// ---------------------------------------------------------------------------

function legacySurveyOptionsUserPrompt(
  questionText: string,
  currentQuestionType: string,
  typeInstruction: string,
  responseFormat: string
): string {
  return `以下のアンケート設問に対して、回答設定の候補を提案してください。

設問文: 「${questionText}」
現在の回答形式: ${currentQuestionType}

${typeInstruction}

注意:
- 選択肢・行・列は実用的で一般的なアンケートで使われる粒度にしてください
- warnings は注意点がある場合のみ記述してください（通常は空配列）

以下のJSON形式のみで回答してください（前後に余分な文字を入れないこと）:
${responseFormat}`;
}

function legacyAdjustQuestionsUserPrompt(
  targetName: string,
  targetObj: string,
  sourceName: string,
  sourceObj: string,
  questionsJson: string
): string {
  return `新規案件:
- プロジェクト名: ${targetName}
- 調査目的: ${targetObj}

参照元案件:
- プロジェクト名: ${sourceName}
- 調査目的: ${sourceObj}

以下の設問リストを新規案件向けに修正し、同じindex配列で返してください:
${questionsJson}

以下のJSON形式のみで回答:
{"adjusted_questions":[{"index":0,"question_text":"修正後の設問文","options":["選択肢1"],"research_goal":"修正後のgoal"}]}`;
}

function legacyGenerateFlowUserPrompt(projectName: string, objective: string): string {
  return `プロジェクト名: ${projectName}
調査目的: ${objective}

以下のJSON形式でフロー設計を生成してください:
{
  "questions": [
    {
      "question_text": "設問文",
      "question_type": "single_choice|multi_choice|free_text_short|free_text_long|numeric",
      "question_role": "screening|main|attribute|free_comment",
      "is_required": true,
      "ai_probe_enabled": false,
      "research_goal": "この設問で知りたいこと（必須）",
      "options": ["選択肢1", "選択肢2"]
    }
  ]
}

回答形式:
- single_choice: 単一選択（options必須）
- multi_choice: 複数選択（options必須）
- free_text_short: 短文自由記述
- free_text_long: 長文自由記述
- numeric: 数値入力

注意: options は選択型のみ設定。research_goal は全設問に設定すること。`;
}

function legacyMissingAttributeUserPrompt(attributeList: string): string {
  return `あなたはユーザーリサーチプラットフォームのAIです。
以下のユーザー属性が不足しています。各属性に対して、LINEデイリーアンケートで使える自然な日本語の設問文と選択肢を提案してください。

属性リスト:
${attributeList}

JSON配列で返してください。各要素:
{
  "attr_key": "属性キー",
  "suggested_question": "設問文（〜ですか？ 形式）",
  "suggested_options": [{"label": "表示名", "value": "値"}],
  "reason": "この属性を優先すべき理由（1文）"
}`;
}

// ---------------------------------------------------------------------------
// Test 1: BASE_PROMPT_TEMPLATES に 4 つの新キーが存在する
// ---------------------------------------------------------------------------
test("Phase7B: BASE_PROMPT_TEMPLATES に Phase 7-B キーが全て登録されている", () => {
  const keys = [
    "buildSurveyOptionsPrompt",
    "buildAdjustQuestionsPrompt",
    "buildGenerateFlowPrompt",
    "buildMissingAttributeSuggestionsPrompt",
  ] as const;

  for (const key of keys) {
    assert.ok(
      key in BASE_PROMPT_TEMPLATES,
      `BASE_PROMPT_TEMPLATES に ${key} が存在しない`
    );
    assert.ok(
      BASE_PROMPT_TEMPLATES[key].template.length > 0,
      `${key}.template が空`
    );
  }
});

// ---------------------------------------------------------------------------
// Test 2: systemPrompt フィールドが管理ツール系キーに設定されている
// ---------------------------------------------------------------------------
test("Phase7B: 管理ツール系キーに systemPrompt が設定されている", () => {
  const keysWithSystem = [
    "buildSurveyOptionsPrompt",
    "buildAdjustQuestionsPrompt",
    "buildGenerateFlowPrompt",
  ] as const;

  for (const key of keysWithSystem) {
    const def = BASE_PROMPT_TEMPLATES[key];
    assert.ok(
      typeof def.systemPrompt === "string" && def.systemPrompt.length > 0,
      `${key} の systemPrompt が未設定`
    );
  }

  // buildMissingAttributeSuggestionsPrompt は systemPrompt なし
  assert.equal(
    BASE_PROMPT_TEMPLATES["buildMissingAttributeSuggestionsPrompt"].systemPrompt,
    undefined
  );
});

// ---------------------------------------------------------------------------
// Test 3: legacy一致 - buildSurveyOptionsPrompt
// ---------------------------------------------------------------------------
test("Phase7B: buildSurveyOptionsPrompt が legacy 時に従来プロンプトと一致する", () => {
  const questionText = "普段どのくらいの頻度でコーヒーを飲みますか？";
  const currentQuestionType = "single_choice";
  const typeInstruction = "「単一選択」形式として、1つだけ選ぶ排他的な選択肢を5〜8件提案してください。";
  const responseFormat = JSON.stringify({
    suggestedOptions: ["選択肢1", "選択肢2"],
    reason: "提案理由（1-2文）",
    warnings: [],
  }, null, 2);

  const result = buildSurveyOptionsPrompt(
    { questionText, currentQuestionType, typeInstruction, responseFormat },
    null
  );

  const expected = legacySurveyOptionsUserPrompt(
    questionText, currentQuestionType, typeInstruction, responseFormat
  );

  assert.equal(result.templateMode, "legacy");
  assert.equal(result.userPrompt, expected);
  assert.equal(result.promptKey, "buildSurveyOptionsPrompt");
});

// ---------------------------------------------------------------------------
// Test 4: legacy一致 - buildAdjustQuestionsPrompt
// ---------------------------------------------------------------------------
test("Phase7B: buildAdjustQuestionsPrompt が legacy 時に従来プロンプトと一致する", () => {
  const params = {
    targetProjectName: "新規案件A",
    targetProjectObjective: "ユーザーの行動を把握する",
    sourceProjectName: "参照元案件B",
    sourceProjectObjective: "消費行動の調査",
    questionsJson: JSON.stringify([{ index: 0, question_text: "テスト設問" }], null, 2),
  };

  const result = buildAdjustQuestionsPrompt(params, null);
  const expected = legacyAdjustQuestionsUserPrompt(
    params.targetProjectName,
    params.targetProjectObjective,
    params.sourceProjectName,
    params.sourceProjectObjective,
    params.questionsJson
  );

  assert.equal(result.templateMode, "legacy");
  assert.equal(result.userPrompt, expected);
});

// ---------------------------------------------------------------------------
// Test 5: legacy一致 - buildGenerateFlowPrompt
// ---------------------------------------------------------------------------
test("Phase7B: buildGenerateFlowPrompt が legacy 時に従来プロンプトと一致する", () => {
  const result = buildGenerateFlowPrompt(
    { projectName: "テストプロジェクト", objective: "消費行動を把握する" },
    null
  );

  const expected = legacyGenerateFlowUserPrompt("テストプロジェクト", "消費行動を把握する");

  assert.equal(result.templateMode, "legacy");
  assert.equal(result.userPrompt, expected);
});

// ---------------------------------------------------------------------------
// Test 6: legacy一致 - buildMissingAttributeSuggestionsPrompt
// ---------------------------------------------------------------------------
test("Phase7B: buildMissingAttributeSuggestionsPrompt が常に legacy を返す", () => {
  const attributeList = "- age（年齢）: 取得率 40%\n- gender（性別）: 取得率 60%";
  const result = buildMissingAttributeSuggestionsPrompt({ attributeList });
  const expected = legacyMissingAttributeUserPrompt(attributeList);

  assert.equal(result.templateMode, "legacy");
  assert.equal(result.userPrompt, expected);
  assert.equal(result.systemPrompt, undefined);
});

// ---------------------------------------------------------------------------
// Test 7: base_template モード - templates_json あり・カスタムなし
// ---------------------------------------------------------------------------
test("Phase7B: templates_json はあるがカスタム未設定 → base_template モード", () => {
  const project = {
    ai_prompt_templates_json: {} // カスタムテンプレートなし
  };

  const result = buildGenerateFlowPrompt(
    { projectName: "テスト", objective: "目的" },
    project
  );

  // templates_json が空オブジェクト → base_template
  assert.equal(result.templateMode, "base_template");
  assert.equal(result.userPrompt, legacyGenerateFlowUserPrompt("テスト", "目的"));
});

// ---------------------------------------------------------------------------
// Test 8: custom_template モード - templates_json にカスタムあり
// ---------------------------------------------------------------------------
test("Phase7B: templates_json にカスタムテンプレートがある → custom_template モード", () => {
  const customTemplate = "カスタム: {{projectName}} / {{objective}}";
  const project = {
    ai_prompt_templates_json: {
      buildGenerateFlowPrompt: {
        enabled: true,
        template: customTemplate,
      }
    }
  };

  const result = buildGenerateFlowPrompt(
    { projectName: "カスタム案件", objective: "カスタム目的" },
    project
  );

  assert.equal(result.templateMode, "custom_template");
  assert.equal(result.userPrompt, "カスタム: カスタム案件 / カスタム目的");
});

// ---------------------------------------------------------------------------
// Test 9: enabled=false はカスタム無効 → base_template にフォールバック
// ---------------------------------------------------------------------------
test("Phase7B: enabled=false のカスタムテンプレートは無効 → base_template", () => {
  const project = {
    ai_prompt_templates_json: {
      buildSurveyOptionsPrompt: {
        enabled: false,
        template: "無効なカスタム",
      }
    }
  };

  const result = buildSurveyOptionsPrompt(
    {
      questionText: "Q",
      currentQuestionType: "single_choice",
      typeInstruction: "提案",
      responseFormat: "{}",
    },
    project
  );

  assert.equal(result.templateMode, "base_template");
});

// ---------------------------------------------------------------------------
// Test 10: renderedPrompt と userPrompt が一致する
// ---------------------------------------------------------------------------
test("Phase7B: renderedPrompt は userPrompt と同一", () => {
  const result = buildAdjustQuestionsPrompt(
    {
      targetProjectName: "A",
      targetProjectObjective: "Obj",
      sourceProjectName: "B",
      sourceProjectObjective: "Obj2",
      questionsJson: "[]",
    },
    null
  );

  assert.equal(result.renderedPrompt, result.userPrompt);
});

// ---------------------------------------------------------------------------
// Test 11: 不正プレースホルダーがあっても例外を投げない（空文字変換）
// ---------------------------------------------------------------------------
test("Phase7B: 未定義プレースホルダーを含むテンプレートも例外なく動作する", () => {
  const templateWithUnknown = "{{projectName}} and {{unknownKey}}";
  // renderPromptTemplate は warn ログ + 空文字変換
  const rendered = renderPromptTemplate(templateWithUnknown, { projectName: "テスト" });
  assert.equal(rendered, "テスト and ");
});

// ---------------------------------------------------------------------------
// Test 12: ai_logs 記録フィールドの構造確認（runAdminToolPrompt の戻り値に対応）
// ---------------------------------------------------------------------------
test("Phase7B: AdminPromptResult が ai_logs 記録に必要なフィールドを持つ", () => {
  const result = buildGenerateFlowPrompt(
    { projectName: "テスト", objective: "目的" },
    null
  );

  // ai_logs に必要なフィールドが全て存在する
  assert.ok(typeof result.promptKey === "string");
  assert.ok(typeof result.templateMode === "string");
  assert.ok(typeof result.userPrompt === "string");
  assert.ok(typeof result.renderedPrompt === "string");
  // systemPrompt は string | undefined
  assert.ok(
    result.systemPrompt === undefined || typeof result.systemPrompt === "string"
  );
});

// ---------------------------------------------------------------------------
// Test 13: allowedPlaceholders が template 内のプレースホルダーを全てカバーする
// ---------------------------------------------------------------------------
test("Phase7B: 各 Phase 7-B テンプレートの allowedPlaceholders が完全", () => {
  const keys = [
    "buildSurveyOptionsPrompt",
    "buildAdjustQuestionsPrompt",
    "buildGenerateFlowPrompt",
    "buildMissingAttributeSuggestionsPrompt",
  ] as const;

  for (const key of keys) {
    const def = BASE_PROMPT_TEMPLATES[key];
    const used = extractTemplatePlaceholders(def.template) as string[];
    const allowed = new Set(def.allowedPlaceholders);
    for (const placeholder of used) {
      assert.ok(
        allowed.has(placeholder),
        `${key}: {{${placeholder}}} が allowedPlaceholders に含まれていない`
      );
    }
  }
});
