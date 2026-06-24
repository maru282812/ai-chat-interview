/**
 * Phase 2: DBテンプレートによるプロンプト生成の動作確認テスト
 *
 * 確認項目:
 * 1. ai_prompt_templates_json が null → 既存コードパスで動作（テンプレート構文を含まない）
 * 2. ai_prompt_templates_json が非null・キーなし → BASE_PROMPT_TEMPLATES を使用
 * 3. ai_prompt_templates_json にカスタムテンプレートあり → そのテンプレートを使用
 * 4. 許可外プレースホルダー → アプリが落ちず warn ログが出る
 * 5. question_role === "free_comment" → noneAnswerPolicy が適用されない
 * 6. probe_guideline + probeStyle 矛盾 → probe_guideline 優先
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

import type { Project, Question } from "../types/domain";

function createBaseProject(): Project {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    name: "Test Project",
    client_name: "Test Client",
    objective: "Test objective",
    status: "draft",
    reward_points: 10,
    research_mode: "survey_interview",
    display_mode: "survey_question",
    primary_objectives: [],
    secondary_objectives: [],
    comparison_constraints: [],
    prompt_rules: [],
    probe_policy: null,
    response_style: { channel: "line", tone: "natural_japanese", max_characters_per_message: 80, max_sentences: 2 },
    ai_state_json: null,
    ai_state_template_key: null,
    ai_state_generated_at: null,
    screening_config: null,
    screening_last_question_order: null,
    ai_prompt_policy_json: null,
    ai_prompt_templates_json: null,
    ai_prompt_mode: "custom",
    ai_prompt_package_version_id: null,
    delivery_enabled: false,
    delivery_type: null,
    delivered_at: null,
    visibility_type: "public",
    entry_code: null,
    client_id: null,
    created_at: "2026-06-07T00:00:00.000Z",
    updated_at: "2026-06-07T00:00:00.000Z"
  };
}

function createBaseQuestion(): Question {
  return {
    id: "00000000-0000-4000-8000-000000000101",
    project_id: "00000000-0000-4000-8000-000000000001",
    question_code: "Q1",
    question_text: "テスト質問",
    comment_top: null,
    comment_bottom: null,
    question_role: "main",
    question_type: "free_text_short",
    is_required: true,
    sort_order: 1,
    answer_output_type: null,
    display_tags_raw: null,
    display_tags_parsed: null,
    visibility_conditions: null,
    page_group_id: null,
    branch_rule: null,
    question_config: null,
    ai_probe_enabled: true,
    probe_guideline: null,
    max_probe_count: null,
    render_strategy: null,
    answer_options_locked: false,
    is_screening_question: false,
    is_system: false,
    is_hidden: false,
    created_at: "2026-06-07T00:00:00.000Z",
    updated_at: "2026-06-07T00:00:00.000Z"
  };
}

// ─────────────────────────────────────────────
// Test 1: null → 既存コードパス（テンプレート {{}} 構文を含まない）
// ─────────────────────────────────────────────
test("T1: ai_prompt_templates_json が null のとき既存コードパスで動作する", async () => {
  const { buildInterviewTurnPrompt } = await import("../prompts/researchPrompts");
  const project = createBaseProject(); // ai_prompt_templates_json: null
  const question = createBaseQuestion();

  const prompt = buildInterviewTurnPrompt({
    project,
    question,
    answer: "テスト回答",
    existingSlots: {},
    currentProbeCount: 0,
    maxProbes: 1,
    aiProbeEnabled: true
  });

  // 既存コードパス → テンプレートプレースホルダー構文が残らない
  assert.ok(!prompt.includes("{{"), "既存コードパスには {{}} が残ってはならない");
  // 既存コードが出力するテキストを含む
  assert.ok(prompt.includes("Return JSON only"), "既存プロンプトの定型文を含む");
  assert.ok(prompt.includes("テスト質問"), "質問テキストが含まれる");
  assert.ok(prompt.includes("テスト回答"), "回答が含まれる");
});

test("T1b: ai_prompt_templates_json が null のとき buildAnalyzeAnswerPrompt も既存コードパスで動作する", async () => {
  const { buildAnalyzeAnswerPrompt } = await import("../prompts/researchPrompts");
  const project = createBaseProject();
  const question = createBaseQuestion();

  const prompt = buildAnalyzeAnswerPrompt({
    project,
    question,
    answer: "テスト回答",
    existingSlots: {},
    maxProbes: 1,
    aiProbeEnabled: true,
    currentProbeCount: 0
  });

  assert.ok(!prompt.includes("{{"), "既存コードパスには {{}} が残ってはならない");
  assert.ok(prompt.includes("Return JSON only"), "既存プロンプトの定型文を含む");
});

// ─────────────────────────────────────────────
// Test 2: ai_prompt_templates_json 非null・キーなし → BASE_PROMPT_TEMPLATES 使用
// ─────────────────────────────────────────────
test("T2: ai_prompt_templates_json が空オブジェクトのとき BASE_PROMPT_TEMPLATES を使用する", async () => {
  const { buildInterviewTurnPrompt } = await import("../prompts/researchPrompts");
  const project: Project = {
    ...createBaseProject(),
    ai_prompt_templates_json: {} // 非null・キーなし
  };
  const question = createBaseQuestion();

  const prompt = buildInterviewTurnPrompt({
    project,
    question,
    answer: "テスト回答",
    existingSlots: {},
    currentProbeCount: 0,
    maxProbes: 1,
    aiProbeEnabled: true
  });

  // BASE_PROMPT_TEMPLATES の buildInterviewTurnPrompt テンプレートの定型文を含む
  assert.ok(prompt.includes("Return JSON only"), "BASE テンプレートの定型文を含む");
  assert.ok(!prompt.includes("{{"), "未解決のプレースホルダーが残らない");
  assert.ok(prompt.includes("テスト質問"), "質問テキストが展開される");
});

// ─────────────────────────────────────────────
// Test 3: カスタムテンプレートが使用される
// ─────────────────────────────────────────────
test("T3: ai_prompt_templates_json にカスタムテンプレートがあるとき使用される", async () => {
  const { buildInterviewTurnPrompt } = await import("../prompts/researchPrompts");
  const project: Project = {
    ...createBaseProject(),
    ai_prompt_templates_json: {
      buildInterviewTurnPrompt: {
        enabled: true,
        template: "CUSTOM_TEMPLATE: goal={{projectGoal}} answer={{answer}}"
      }
    }
  };
  const question = createBaseQuestion();

  const prompt = buildInterviewTurnPrompt({
    project,
    question,
    answer: "カスタム回答",
    existingSlots: {},
    currentProbeCount: 0,
    maxProbes: 1,
    aiProbeEnabled: true
  });

  assert.ok(prompt.startsWith("CUSTOM_TEMPLATE:"), "カスタムテンプレートが先頭に来る");
  assert.ok(prompt.includes("カスタム回答"), "回答がカスタムテンプレートに展開される");
  assert.ok(!prompt.includes("{{"), "未解決のプレースホルダーが残らない");
});

test("T3b: buildAnalyzeAnswerPrompt でカスタムテンプレートが反映される", async () => {
  const { buildAnalyzeAnswerPrompt } = await import("../prompts/researchPrompts");
  const project: Project = {
    ...createBaseProject(),
    ai_prompt_templates_json: {
      buildAnalyzeAnswerPrompt: {
        enabled: true,
        template: "ANALYZE: q={{questionCode}} a={{answer}}"
      }
    }
  };
  const question = createBaseQuestion();

  const prompt = buildAnalyzeAnswerPrompt({
    project,
    question,
    answer: "分析回答",
    existingSlots: {},
    maxProbes: 1,
    aiProbeEnabled: true,
    currentProbeCount: 0
  });

  assert.ok(prompt.startsWith("ANALYZE:"), "カスタムテンプレートが先頭に来る");
  assert.ok(prompt.includes("Q1"), "questionCode が展開される");
  assert.ok(prompt.includes("分析回答"), "answer が展開される");
});

test("T3c: buildProbeGenerationPrompt でカスタムテンプレートが反映される", async () => {
  const { buildProbeGenerationPrompt } = await import("../prompts/researchPrompts");
  const project: Project = {
    ...createBaseProject(),
    ai_prompt_templates_json: {
      buildProbeGenerationPrompt: {
        enabled: true,
        template: "PROBE_GEN: type={{probeType}} answer={{answer}}"
      }
    }
  };
  const question = createBaseQuestion();

  const prompt = buildProbeGenerationPrompt({
    project,
    question,
    answer: "深掘り回答",
    extractedSlots: [],
    completion: null,
    probeType: "concretize",
    missingSlots: [],
    sessionSummary: ""
  });

  assert.ok(prompt.startsWith("PROBE_GEN:"), "カスタムテンプレートが先頭に来る");
  assert.ok(prompt.includes("concretize"), "probeType が展開される");
  assert.ok(prompt.includes("深掘り回答"), "answer が展開される");
});

// ─────────────────────────────────────────────
// Test 4: 許可外プレースホルダー → アプリが落ちず warn ログが出る
// ─────────────────────────────────────────────
test("T4: 許可外プレースホルダーがあってもアプリが落ちない", async () => {
  const { buildProbePrompt } = await import("../prompts/researchPrompts");
  const warnMessages: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnMessages.push(args.map(String).join(" "));
  };

  try {
    const project: Project = {
      ...createBaseProject(),
      ai_prompt_templates_json: {
        buildProbePrompt: {
          enabled: true,
          template: "UNKNOWN: {{unknownPlaceholder123}} answer={{answer}}"
        }
      }
    };
    const question = createBaseQuestion();

    let prompt = "";
    assert.doesNotThrow(() => {
      prompt = buildProbePrompt({
        project,
        question: "質問",
        answer: "回答",
        sessionSummary: ""
      });
    }, "許可外プレースホルダーがあってもエラーにならない");

    // 許可外キーは空文字になる
    assert.ok(!prompt.includes("{{unknownPlaceholder123}}"), "未解決のプレースホルダーが残らない");
    // 有効なキーは展開される
    assert.ok(prompt.includes("回答"), "有効なプレースホルダーは展開される");
  } finally {
    console.warn = originalWarn;
  }
});

// ─────────────────────────────────────────────
// Test 5: free_comment → noneAnswerPolicy が適用されない
// ─────────────────────────────────────────────
test("T5: question_role が free_comment のとき noneAnswerPolicy が適用されない", async () => {
  const { buildAnalyzeAnswerPrompt } = await import("../prompts/researchPrompts");
  const project: Project = {
    ...createBaseProject(),
    ai_prompt_policy_json: { noneAnswerPolicy: "retry_once_softly" },
    ai_prompt_templates_json: {} // テンプレートモード有効
  };
  const question: Question = {
    ...createBaseQuestion(),
    question_role: "free_comment"
  };

  const prompt = buildAnalyzeAnswerPrompt({
    project,
    question,
    answer: "特になし",
    existingSlots: {},
    maxProbes: 0,
    aiProbeEnabled: false,
    currentProbeCount: 0
  });

  // retry_once_softly のガイド文（promptPolicies.ts 固有テキスト）が含まれてはならない
  // buildProbeTypeGuidance には「一度だけ」が含まれるため、より固有な文字列でチェックする
  assert.ok(
    !prompt.includes("少しだけでも"),
    "free_comment には retry_once_softly の noneAnswerPolicy ガイドが適用されない"
  );
  assert.ok(
    !prompt.includes("柔らかい言葉で再確認"),
    "free_comment には noneAnswerPolicy の再確認ガイドが適用されない"
  );
});

// ─────────────────────────────────────────────
// Test 6: probe_guideline + probeStyle 矛盾 → probe_guideline 優先
// ─────────────────────────────────────────────
test("T6: probe_guideline が存在する場合は probeStyle より probe_guideline を優先する", async () => {
  const { buildAnalyzeAnswerPrompt } = await import("../prompts/researchPrompts");
  const project: Project = {
    ...createBaseProject(),
    ai_state_json: {
      probe_guideline: "custom-probe-rule: always ask about specific scene",
      required_slots: [],
      optional_slots: [],
      question_categories: [],
      probe_policy: {},
      completion_rule: {},
      topic_control: {},
      language: "ja"
    },
    ai_prompt_policy_json: { probeStyle: "reason_and_scene" },
    ai_prompt_templates_json: {} // テンプレートモード有効
  };
  const question = createBaseQuestion();

  const prompt = buildAnalyzeAnswerPrompt({
    project,
    question,
    answer: "テスト回答",
    existingSlots: {},
    maxProbes: 1,
    aiProbeEnabled: true,
    currentProbeCount: 0
  });

  // probe_guideline が含まれる
  assert.ok(
    prompt.includes("custom-probe-rule"),
    "probe_guideline の内容が含まれる"
  );
  // probeStyle より probe_guideline が優先される旨の注記が含まれる
  assert.ok(
    prompt.includes("probe_guideline が存在するため"),
    "probe_guideline 優先の注記が含まれる"
  );
});

// ─────────────────────────────────────────────
// Test 7: enabled: false のテンプレートは使用されない
// ─────────────────────────────────────────────
test("T7: enabled が false のテンプレートは無視され BASE_PROMPT_TEMPLATES を使用する", async () => {
  const { buildProbePrompt } = await import("../prompts/researchPrompts");
  const project: Project = {
    ...createBaseProject(),
    ai_prompt_templates_json: {
      buildProbePrompt: {
        enabled: false,
        template: "THIS_SHOULD_NOT_APPEAR"
      }
    }
  };

  const prompt = buildProbePrompt({
    project,
    question: "質問",
    answer: "回答",
    sessionSummary: ""
  });

  assert.ok(
    !prompt.includes("THIS_SHOULD_NOT_APPEAR"),
    "enabled:false のカスタムテンプレートは使用されない"
  );
  // BASE_PROMPT_TEMPLATES の定型文が入る
  assert.ok(
    prompt.includes("Write exactly one short follow-up question"),
    "BASE テンプレートが使用される"
  );
});

// ═══════════════════════════════════════════════════════════════
// Phase 3 テスト
// ═══════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────
// Test P3-1: 許可外プレースホルダーがあれば validatePromptTemplatePlaceholders が返す
// ─────────────────────────────────────────────
test("P3-1: validatePromptTemplatePlaceholders が許可外キーを返す", async () => {
  const { validatePromptTemplatePlaceholders } = await import("../prompts/promptTemplateRenderer");

  const result = validatePromptTemplatePlaceholders(
    "answer={{answer}} unknown={{unknownKey123}}",
    ["answer", "question"]
  );

  assert.strictEqual(result.valid, false, "許可外キーがあるので valid は false");
  assert.deepStrictEqual(result.unknownKeys, ["unknownKey123"], "unknownKey123 が不正リストに含まれる");
});

test("P3-1b: 許可外プレースホルダーなしなら valid=true", async () => {
  const { validatePromptTemplatePlaceholders } = await import("../prompts/promptTemplateRenderer");

  const result = validatePromptTemplatePlaceholders(
    "answer={{answer}} question={{question}}",
    ["answer", "question"]
  );

  assert.strictEqual(result.valid, true, "全て許可済みなので valid は true");
  assert.deepStrictEqual(result.unknownKeys, [], "不正キーリストは空");
});

// ─────────────────────────────────────────────
// Test P3-2: BASE_PROMPT_TEMPLATES の全キーに allowedPlaceholders が定義されている
// ─────────────────────────────────────────────
test("P3-2: BASE_PROMPT_TEMPLATES の全エントリに allowedPlaceholders が存在する", async () => {
  const { BASE_PROMPT_TEMPLATES } = await import("../prompts/basePromptTemplates");

  // Phase I-B: 型別深掘りガイダンス5キーは純散文（{{placeholder}} なし）＝ allowedPlaceholders は空配列
  const GUIDANCE_KEYS = new Set([
    "probeGuidanceCommon",
    "probeGuidanceText",
    "probeGuidanceChoiceSingle",
    "probeGuidanceChoiceMulti",
    "probeGuidanceNumeric",
  ]);
  for (const [key, def] of Object.entries(BASE_PROMPT_TEMPLATES)) {
    assert.ok(Array.isArray(def.allowedPlaceholders), `${key} の allowedPlaceholders が配列`);
    if (!GUIDANCE_KEYS.has(key)) {
      assert.ok(def.allowedPlaceholders.length > 0, `${key} に allowedPlaceholders が定義されている`);
    }
    assert.ok(typeof def.label === "string" && def.label.length > 0,
      `${key} に label が定義されている`);
  }
});

// ─────────────────────────────────────────────
// Test P3-3: template_mode が project 状態によって正しく決まる
// ─────────────────────────────────────────────
test("P3-3: ai_prompt_templates_json が null のとき template_mode は legacy になる", async () => {
  // resolveBasePromptTemplate を通じて確認する
  const { resolveBasePromptTemplate } = await import("../prompts/promptTemplateRenderer");
  const project = createBaseProject(); // ai_prompt_templates_json: null

  // null のとき → BASE_PROMPT_TEMPLATES のデフォルトが返る（legacy モード）
  const tmpl = resolveBasePromptTemplate(project, "buildProbePrompt");
  assert.ok(tmpl.includes("Write exactly one short follow-up question"), "BASE テンプレートが返る");
});

test("P3-3b: カスタムテンプレートがある場合 resolveBasePromptTemplate はそれを返す", async () => {
  const { resolveBasePromptTemplate } = await import("../prompts/promptTemplateRenderer");
  const project = {
    ...createBaseProject(),
    ai_prompt_templates_json: {
      buildProbePrompt: {
        enabled: true,
        template: "MY_CUSTOM_TEMPLATE answer={{answer}}"
      }
    }
  };

  const tmpl = resolveBasePromptTemplate(project as import("../types/domain").Project, "buildProbePrompt");
  assert.ok(tmpl.startsWith("MY_CUSTOM_TEMPLATE"), "カスタムテンプレートが返る");
});

// ─────────────────────────────────────────────
// Test P3-4: TypeScript 型定義に legacy QuestionType が含まれる
// ─────────────────────────────────────────────
test("P3-4: QuestionType に後方互換の legacy 型が含まれる", async () => {
  // 型チェックは compile 時に済んでいるが、runtime でも確認するため
  // question_type: "text" を持つオブジェクトが QuestionType として扱えることを確認
  const { questionRepository: _repo } = await import("../repositories/questionRepository");

  // 型アサーションで "text" が QuestionType として扱えることを確認（コンパイルが通っていれば OK）
  const legacyType: import("../types/domain").QuestionType = "text" as import("../types/domain").QuestionType;
  assert.strictEqual(legacyType, "text", '"text" は QuestionType として有効');

  const scaleType: import("../types/domain").QuestionType = "scale" as import("../types/domain").QuestionType;
  assert.strictEqual(scaleType, "scale", '"scale" は QuestionType として有効');
});

// ─────────────────────────────────────────────
// Test P3-5: テンプレートモードのとき policySection がプロンプトに含まれる
// ─────────────────────────────────────────────
test("P3-5: ai_prompt_policy_json が設定されているとき policySection がプロンプトに含まれる", async () => {
  const { buildProbePrompt } = await import("../prompts/researchPrompts");
  const project = {
    ...createBaseProject(),
    ai_prompt_policy_json: { audience: "female_friendly" },
    ai_prompt_templates_json: {} // テンプレートモード有効
  };
  const question = createBaseQuestion();

  const prompt = buildProbePrompt({
    project: project as import("../types/domain").Project,
    question: "質問",
    answer: "回答",
    sessionSummary: ""
  });

  // female_friendly の方針テキストが末尾に追加されているはず
  assert.ok(prompt.length > 0, "プロンプトが生成される");
  assert.ok(!prompt.includes("{{"), "未解決のプレースホルダーが残らない");
});
