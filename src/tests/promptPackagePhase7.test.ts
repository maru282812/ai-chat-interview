/**
 * Phase 7-A: 旧未管理プロンプト（B1〜B7）のパッケージ管理対象化テスト
 *
 * 確認項目:
 * 1. BASE_PROMPT_TEMPLATES に7キーが追加されている（計17キー）
 * 2. 各テンプレートのプレースホルダーが allowedPlaceholders に収まっている
 * 3. ai_prompt_templates_json が null / project なし → 従来のハードコードパスで動作
 * 4. ai_prompt_templates_json が {} → ベーステンプレートで動作（内容は従来と同等）
 * 5. カスタムテンプレートが設定されている → カスタムを使用
 * 6. バリデーション・プレビューサービスが新キーを自動で対象に含む
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

import type { Project } from "../types/domain";

const PHASE7_KEYS = [
  "buildProjectInitialStatePrompt",
  "buildProjectAnalysisPrompt",
  "buildPostAnalysisPrompt",
  "buildRantExtendedPrompt",
  "buildDiaryExtendedPrompt",
  "buildRantCounselorReplyPrompt",
  "buildPersonaTagsPrompt"
] as const;

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
    primary_objectives: ["主目的1"],
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
    created_at: "2026-06-13T00:00:00.000Z",
    updated_at: "2026-06-13T00:00:00.000Z"
  };
}

// ─────────────────────────────────────────────
// 1. キー定義
// ─────────────────────────────────────────────
test("P7-1: BASE_PROMPT_TEMPLATES に Phase 7-A の7キーが定義されている", async () => {
  const { BASE_PROMPT_TEMPLATES } = await import("../prompts/basePromptTemplates");
  for (const key of PHASE7_KEYS) {
    assert.ok(BASE_PROMPT_TEMPLATES[key], `${key} が BASE_PROMPT_TEMPLATES に存在する`);
    assert.ok(BASE_PROMPT_TEMPLATES[key].template.trim().length > 0, `${key} のテンプレートが空でない`);
    assert.ok(BASE_PROMPT_TEMPLATES[key].label.length > 0, `${key} のラベルが空でない`);
  }
  // Phase 7-B で管理ツール系4キー追加で21キー、Phase I-B で型別深掘りガイダンス5キー追加で26キー
  assert.equal(Object.keys(BASE_PROMPT_TEMPLATES).length, 26, "合計26キー（既存10 + Phase7-A 7 + Phase7-B 4 + Phase I-B 5）");
});

test("P7-2: 新キーのテンプレート内プレースホルダーが allowedPlaceholders に収まる", async () => {
  const { BASE_PROMPT_TEMPLATES } = await import("../prompts/basePromptTemplates");
  const { extractTemplatePlaceholders } = await import("../prompts/promptTemplateRenderer");
  for (const key of PHASE7_KEYS) {
    const def = BASE_PROMPT_TEMPLATES[key];
    const used = extractTemplatePlaceholders(def.template);
    const allowed = new Set(def.allowedPlaceholders);
    const unknown = used.filter((k) => !allowed.has(k));
    assert.deepEqual(unknown, [], `${key}: 許可外プレースホルダーなし`);
  }
});

// ─────────────────────────────────────────────
// 2. legacy パス（templates_json null / project なし）
// ─────────────────────────────────────────────
test("P7-3: templates_json が null のとき従来のハードコードパスで動作する", async () => {
  const prompts = await import("../prompts/researchPrompts");
  const project = createBaseProject();

  const initialState = prompts.buildProjectInitialStatePrompt({
    project,
    template: { key: "tpl", label: "テンプレ", description: "説明", state: { version: 1 } } as never
  });
  assert.ok(!initialState.includes("{{"), "B1 legacy: {{}} を含まない");
  assert.ok(initialState.includes("Project name: Test Project"), "B1 legacy: プロジェクト名を含む");

  const projectAnalysis = prompts.buildProjectAnalysisPrompt({
    project,
    respondentSummaries: [],
    comparisonUnits: [],
    freeAnswerPolicy: { policy: "summary_only", target_question_codes: [] }
  });
  assert.ok(!projectAnalysis.includes("{{"), "B2 legacy: {{}} を含まない");
  assert.ok(projectAnalysis.includes("executive_summary"), "B2 legacy: 必須キー説明を含む");

  const postAnalysis = prompts.buildPostAnalysisPrompt({
    postType: "rant",
    sourceMode: null,
    content: "テスト投稿"
  });
  assert.ok(!postAnalysis.includes("{{"), "B3 legacy: {{}} を含まない");
  assert.ok(postAnalysis.includes("Content: テスト投稿"), "B3 legacy: 投稿内容を含む");

  const rant = prompts.buildRantExtendedPrompt("愚痴テキスト");
  assert.ok(!rant.includes("{{"), "B4 legacy: {{}} を含まない");
  assert.ok(rant.includes("テキスト: 愚痴テキスト"), "B4 legacy: 内容を含む");

  const diary = prompts.buildDiaryExtendedPrompt("日記テキスト");
  assert.ok(!diary.includes("{{"), "B5 legacy: {{}} を含まない");
  assert.ok(diary.includes("mood_score"), "B5 legacy: 必須キーを含む");

  const reply = prompts.buildRantCounselorReplyPrompt("つらい", ["仕事"]);
  assert.ok(!reply.includes("{{"), "B6 legacy: {{}} を含まない");
  assert.ok(reply.includes("つらい"), "B6 legacy: 投稿内容を含む");
  assert.ok(reply.includes("仕事"), "B6 legacy: タグを含む");

  const persona = prompts.buildPersonaTagsPrompt([
    { summary: "要約A", tags: ["タグ1"], sentiment: "positive" }
  ]);
  assert.ok(!persona.includes("{{"), "B7 legacy: {{}} を含まない");
  assert.ok(persona.includes("投稿1: 要約A"), "B7 legacy: 分析データを含む");
});

// ─────────────────────────────────────────────
// 3. ベーステンプレートパス（templates_json = {}）
// ─────────────────────────────────────────────
test("P7-4: templates_json が {} のときベーステンプレートで動作し内容が保持される", async () => {
  const prompts = await import("../prompts/researchPrompts");
  const project: Project = { ...createBaseProject(), ai_prompt_templates_json: {} };

  const initialState = prompts.buildProjectInitialStatePrompt({
    project,
    template: { key: "tpl", label: "テンプレ", description: "説明", state: { version: 1 } } as never
  });
  assert.ok(!initialState.includes("{{"), "B1 base: プレースホルダーが残らない");
  assert.ok(initialState.includes("Project name: Test Project"), "B1 base: プロジェクト名を含む");
  assert.ok(initialState.includes("Recommended template key: tpl"), "B1 base: テンプレートキーを含む");
  assert.ok(initialState.includes("Primary objectives\n- 主目的1"), "B1 base: renderList の出力を含む");

  const projectAnalysis = prompts.buildProjectAnalysisPrompt({
    project,
    respondentSummaries: [],
    comparisonUnits: [],
    freeAnswerPolicy: { policy: "summary_only", target_question_codes: [] }
  });
  assert.ok(!projectAnalysis.includes("{{"), "B2 base: プレースホルダーが残らない");
  assert.ok(projectAnalysis.includes("You are supporting a LINE research project."), "B2 base: sharedSections を含む");
  assert.ok(projectAnalysis.includes('"summary_only"'), "B2 base: freeAnswerPolicy JSON を含む");

  const postAnalysis = prompts.buildPostAnalysisPrompt({
    postType: "diary",
    sourceMode: "interview",
    content: "テスト投稿",
    project
  });
  assert.ok(!postAnalysis.includes("{{"), "B3 base: プレースホルダーが残らない");
  assert.ok(postAnalysis.includes("Post type: diary"), "B3 base: 投稿タイプを含む");
  assert.ok(postAnalysis.includes("Source mode: interview"), "B3 base: ソースモードを含む");

  const rant = prompts.buildRantExtendedPrompt("愚痴テキスト", project);
  assert.ok(!rant.includes("{{"), "B4 base: プレースホルダーが残らない");
  assert.ok(rant.includes("テキスト: 愚痴テキスト"), "B4 base: 内容を含む");
  assert.ok(rant.includes("danger_flag"), "B4 base: 必須キーを含む");

  const diary = prompts.buildDiaryExtendedPrompt("日記テキスト", project);
  assert.ok(!diary.includes("{{"), "B5 base: プレースホルダーが残らない");
  assert.ok(diary.includes("テキスト: 日記テキスト"), "B5 base: 内容を含む");

  const reply = prompts.buildRantCounselorReplyPrompt("つらい", [], project);
  assert.ok(!reply.includes("{{"), "B6 base: プレースホルダーが残らない");
  assert.ok(reply.includes("（タグなし）"), "B6 base: タグなし表記を含む");
  assert.ok(reply.includes("80文字以内"), "B6 base: 文字数ルールを保持");

  const persona = prompts.buildPersonaTagsPrompt(
    [{ summary: "要約A", tags: ["タグ1"], sentiment: "positive" }],
    project
  );
  assert.ok(!persona.includes("{{"), "B7 base: プレースホルダーが残らない");
  assert.ok(persona.includes("投稿1: 要約A [感情: positive] [タグ: タグ1]"), "B7 base: 整形済み分析データを含む");
});

// ─────────────────────────────────────────────
// 4. カスタムテンプレートパス
// ─────────────────────────────────────────────
test("P7-5: カスタムテンプレートが設定されているときはカスタムを使用する", async () => {
  const prompts = await import("../prompts/researchPrompts");
  const project: Project = {
    ...createBaseProject(),
    ai_prompt_templates_json: {
      buildRantCounselorReplyPrompt: {
        enabled: true,
        template: "カスタム返信プロンプト: {{postText}} / タグ: {{selectedTags}}"
      }
    }
  };

  const reply = prompts.buildRantCounselorReplyPrompt("つらい", ["仕事", "健康"], project);
  assert.equal(reply, "カスタム返信プロンプト: つらい / タグ: 仕事、健康");

  // 未設定キーはベーステンプレートにフォールバック
  const rant = prompts.buildRantExtendedPrompt("愚痴テキスト", project);
  assert.ok(rant.includes("あなたはユーザーの愚痴投稿を分析するAIです。"), "未設定キーはベースを使用");
});

test("P7-6: enabled=false のカスタムテンプレートはベーステンプレートへフォールバックする", async () => {
  const prompts = await import("../prompts/researchPrompts");
  const project: Project = {
    ...createBaseProject(),
    ai_prompt_templates_json: {
      buildRantExtendedPrompt: { enabled: false, template: "使われないテンプレート" }
    }
  };

  const rant = prompts.buildRantExtendedPrompt("愚痴テキスト", project);
  assert.ok(!rant.includes("使われないテンプレート"), "無効化テンプレートは使用しない");
  assert.ok(rant.includes("あなたはユーザーの愚痴投稿を分析するAIです。"), "ベーステンプレートを使用");
});

// ─────────────────────────────────────────────
// 5. バリデーション・プレビューの自動対象化
// ─────────────────────────────────────────────
test("P7-7: バリデーション・プレビューサービスが新キーを対象に含む", async () => {
  const { REQUIRED_PROMPT_KEYS, findMissingRequiredPromptKeys, validatePromptPackageVersionConfig } =
    await import("../services/promptPackageValidationService");
  const { resolveEffectiveTemplates } = await import("../services/promptPackagePreviewService");

  for (const key of PHASE7_KEYS) {
    assert.ok(REQUIRED_PROMPT_KEYS.includes(key), `${key} が REQUIRED_PROMPT_KEYS に含まれる`);
  }

  // プレビュー: 26キー全件が解決される（Phase 7-B で4キー、Phase I-B で5キー追加）
  const templates = resolveEffectiveTemplates({});
  assert.equal(templates.length, 26, "プレビューが26キーを返す");
  assert.ok(
    templates.some((t) => t.key === "buildPersonaTagsPrompt" && t.source === "base"),
    "新キーが base ソースで解決される"
  );

  // enabled なのに空白のみ → 公開不可扱い
  const missing = findMissingRequiredPromptKeys({
    buildRantExtendedPrompt: { enabled: true, template: "   " }
  });
  assert.deepEqual(missing, ["buildRantExtendedPrompt"], "空白テンプレートは不足扱い");

  // 許可外プレースホルダー → 警告
  const result = validatePromptPackageVersionConfig({
    templatesJson: {
      buildPostAnalysisPrompt: { enabled: true, template: "{{content}} {{unknownKey}}" }
    }
  });
  assert.equal(result.errors.length, 0, "許可外プレースホルダーはエラーにしない");
  assert.ok(
    result.warnings.some((w) => w.includes("unknownKey")),
    "許可外プレースホルダーは警告になる"
  );
});

// ─────────────────────────────────────────────
// 6. 変数不足時の挙動（warn + 空文字置換でアプリを落とさない）
// ─────────────────────────────────────────────
test("P7-8: テンプレートに未知のプレースホルダーがあっても空文字置換で落ちない", async () => {
  const prompts = await import("../prompts/researchPrompts");
  const project: Project = {
    ...createBaseProject(),
    ai_prompt_templates_json: {
      buildDiaryExtendedPrompt: { enabled: true, template: "日記: {{content}} 未知: {{notDefined}}" }
    }
  };

  const diary = prompts.buildDiaryExtendedPrompt("日記テキスト", project);
  assert.equal(diary, "日記: 日記テキスト 未知: ", "未知プレースホルダーは空文字に置換される");
});
