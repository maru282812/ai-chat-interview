/**
 * probePlaygroundService.ts  (Phase I / A part2)
 *
 * 「深掘りプレイグラウンド」= パッケージ Version の本文＋コード側の深掘りロジック
 * （buildProbeTypeGuidance）＋policy を含む “実パイプライン” のプロンプトを組み立て、
 * 設問＋回答に対してそのバージョンが出す深掘りを確認するための純関数群。
 *
 * 重要な不変条件:
 * - DB には一切書き込まない（管理画面のボタン押下時のみ・ステートレス）。
 * - 実行時（本番会話）からは呼ばれない。
 * - 合成 Project の ai_prompt_templates_json に Version の本文を載せることで、
 *   researchPrompts の実ビルダーが「そのバージョンの本文＋実 probeTypeGuidance」で
 *   プロンプトを構築する（raw テンプレ展開ではなく本番同等の組み立て）。
 * - ai_state_json は null（プロジェクトAI状態は再現しない）。用途は
 *   「テンプレ本文＋型別ガイダンスの効き」を見ること。本番完全再現は対象外。
 */

import {
  buildAnalyzeAnswerPrompt,
  buildInterviewTurnPrompt,
  buildProbePrompt,
} from "../prompts/researchPrompts";
import type {
  AIPromptPolicy,
  AIPromptTemplateMap,
  Project,
  Question,
  QuestionType,
} from "../types/domain";

export type ProbePlaygroundMode = "analyze" | "interview" | "probe";

export interface ProbePlaygroundInput {
  mode: ProbePlaygroundMode;
  /** 対象バージョンの本文（未保存 override 反映済みでよい） */
  templates: AIPromptTemplateMap | null;
  policy: AIPromptPolicy | null;
  questionText: string;
  answer: string;
  /** 既定: free_text_long */
  questionType?: QuestionType;
  /** 選択式のときの選択肢 */
  options?: { value: string; label: string }[];
  /** 収集ゴール（合成 Project.objective） */
  projectGoal?: string;
  /** 既定: 1 */
  maxProbes?: number;
}

/** mode → 実際に発火する会話系プロンプトキー（表示用） */
export const PROBE_PLAYGROUND_KEY: Record<ProbePlaygroundMode, string> = {
  analyze: "buildAnalyzeAnswerPrompt",
  interview: "buildInterviewTurnPrompt",
  probe: "buildProbePrompt",
};

/** 合成 Project を作る（実ビルダーが参照するフィールドのみ・他は null/空で安全） */
function buildSyntheticProject(input: ProbePlaygroundInput): Project {
  const researchMode = input.mode === "interview" ? "interview" : "survey_interview";
  return {
    id: "00000000-0000-4000-8000-0000000p1a40",
    name: "（深掘りプレイグラウンド）",
    user_display_title: null,
    client_name: null,
    objective: input.projectGoal?.trim() || null,
    status: "active",
    reward_points: 0,
    research_mode: researchMode,
    display_mode: researchMode === "interview" ? "interview_chat" : "survey_question",
    primary_objectives: [],
    secondary_objectives: [],
    comparison_constraints: [],
    prompt_rules: [],
    probe_policy: null,
    response_style: null,
    ai_state_json: null,
    ai_state_template_key: null,
    ai_state_generated_at: null,
    screening_config: null,
    screening_last_question_order: null,
    ai_prompt_policy_json: input.policy ?? null,
    ai_prompt_templates_json: input.templates ?? null,
    ai_prompt_mode: "package",
    ai_prompt_package_version_id: null,
    ai_prompt_overrides_json: null,
    delivery_enabled: false,
    delivery_type: null,
    delivered_at: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  } as unknown as Project;
}

/** 合成 Question を作る（実ビルダー/normalizeQuestionMeta が参照するフィールドのみ） */
function buildSyntheticQuestion(input: ProbePlaygroundInput): Question {
  const questionType = input.questionType ?? "free_text_long";
  const options = input.options ?? [];
  return {
    id: "00000000-0000-4000-8000-0000000p1a41",
    project_id: "00000000-0000-4000-8000-0000000p1a40",
    question_code: "PLAYGROUND",
    question_text: input.questionText,
    comment_top: null,
    comment_bottom: null,
    question_role: "main",
    question_type: questionType,
    is_required: true,
    sort_order: 1,
    answer_output_type: null,
    display_tags_raw: null,
    display_tags_parsed: null,
    visibility_conditions: null,
    page_group_id: null,
    branch_rule: null,
    question_config: options.length > 0 ? { options } : null,
    ai_probe_enabled: true,
    probe_guideline: null,
    max_probe_count: null,
    render_strategy: null,
    answer_options_locked: false,
    is_screening_question: false,
    is_system: false,
    is_hidden: false,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
  } as unknown as Question;
}

/**
 * mode に応じた実ビルダーで、そのバージョンの深掘りプロンプト全文を構築する（AI 呼び出しはしない）。
 */
export function buildProbePlaygroundPrompt(input: ProbePlaygroundInput): string {
  const project = buildSyntheticProject(input);
  const question = buildSyntheticQuestion(input);
  const maxProbes = input.maxProbes ?? 1;

  if (input.mode === "interview") {
    return buildInterviewTurnPrompt({
      project,
      question,
      answer: input.answer,
      nextQuestion: null,
      existingSlots: {},
      currentProbeCount: 0,
      maxProbes,
      aiProbeEnabled: true,
      conversationSummary: null,
    });
  }

  if (input.mode === "probe") {
    return buildProbePrompt({
      project,
      question: input.questionText,
      answer: input.answer,
      sessionSummary: "",
    });
  }

  // analyze（survey_interview）
  return buildAnalyzeAnswerPrompt({
    project,
    question,
    nextQuestion: null,
    answer: input.answer,
    existingSlots: {},
    maxProbes,
    aiProbeEnabled: true,
    currentProbeCount: 0,
  });
}

export interface ProbePlaygroundParsed {
  /** 抽出できた深掘り文（無ければ null） */
  probe: string | null;
  /** analyze/interview の action（probe / ask_next / skip / finish） */
  action: string | null;
  /** 内部理由（あれば） */
  reason: string | null;
  /** JSON として解釈できたか */
  parsedJson: boolean;
}

/**
 * AI応答から深掘り文を抽出する。
 * - analyze: { action, question, reason } → question が深掘り文
 * - interview: { action, response_text, reason } → response_text が深掘り文
 * - probe: プレーンテキスト（そのまま深掘り文）
 */
export function parseProbePlaygroundResult(
  mode: ProbePlaygroundMode,
  raw: string | null | undefined
): ProbePlaygroundParsed {
  const empty: ProbePlaygroundParsed = { probe: null, action: null, reason: null, parsedJson: false };
  if (!raw || !raw.trim()) return empty;

  if (mode === "probe") {
    return { probe: raw.trim(), action: null, reason: null, parsedJson: false };
  }

  // JSON 抽出（コードフェンス / 前後テキストに耐性）
  let text = raw.trim();
  const fence = text.match(/```[a-zA-Z]*\s*([\s\S]*?)```/);
  if (fence?.[1]) text = fence[1].trim();
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first >= 0 && last > first) text = text.slice(first, last + 1);

  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ...empty, probe: raw.trim() };
    obj = parsed as Record<string, unknown>;
  } catch {
    // パース不能なら raw をそのまま深掘り文候補として返す
    return { ...empty, probe: raw.trim() };
  }

  const action = typeof obj.action === "string" ? obj.action : null;
  const reason = typeof obj.reason === "string" ? obj.reason : null;
  const field = mode === "interview" ? obj.response_text : obj.question;
  const probe = typeof field === "string" && field.trim() ? field.trim() : null;
  return { probe, action, reason, parsedJson: true };
}
