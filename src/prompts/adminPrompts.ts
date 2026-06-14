/**
 * adminPrompts.ts  (Phase 7-B)
 *
 * 管理ツール系 AI 呼び出し用プロンプトビルダー。
 * - adminController の 3 AI 呼び出し
 * - missingAttributeService の 1 AI 呼び出し
 *
 * 設計方針:
 * - ベーステンプレートの文言は従来ハードコードと完全一致
 * - プロジェクトに custom template が設定されていれば優先使用
 * - プロジェクトなし / テンプレートなし → legacy モード（従来プロンプトと同一文字列）
 * - systemPrompt は静的（BASE_PROMPT_TEMPLATES[key].systemPrompt から取得）
 */

import type { Project, AIPromptTemplateMap } from "../types/domain";
import { BASE_PROMPT_TEMPLATES, type BasePromptKey } from "./basePromptTemplates";
import { renderPromptTemplate } from "./promptTemplateRenderer";

export interface AdminPromptResult {
  /** chat.completions system メッセージ。undefined なら system なし */
  systemPrompt: string | undefined;
  /** chat.completions user メッセージ（レンダリング済み） */
  userPrompt: string;
  promptKey: BasePromptKey;
  templateMode: "legacy" | "base_template" | "custom_template";
  /** レンダリング前のテンプレート文字列（ai_logs.rendered_prompt に保存） */
  renderedPrompt: string;
}

/** プロジェクトの templates_json からカスタムテンプレートを解決する */
function resolveTemplate(
  project: Pick<Project, "ai_prompt_templates_json"> | null | undefined,
  key: BasePromptKey
): { template: string; mode: "legacy" | "base_template" | "custom_template" } {
  const def = BASE_PROMPT_TEMPLATES[key];
  if (!project?.ai_prompt_templates_json) {
    return { template: def.template, mode: "legacy" };
  }
  const customTemplates = project.ai_prompt_templates_json as AIPromptTemplateMap;
  const entry = (customTemplates as Record<string, { enabled?: boolean; template?: string } | undefined>)[key];
  if (entry?.enabled !== false && typeof entry?.template === "string" && entry.template.trim()) {
    return { template: entry.template, mode: "custom_template" };
  }
  return { template: def.template, mode: "base_template" };
}

// ---------------------------------------------------------------------------
// 1. 設問回答設定候補提案
// ---------------------------------------------------------------------------

export interface SurveyOptionsPromptParams {
  questionText: string;
  currentQuestionType: string;
  typeInstruction: string;
  responseFormat: string;
}

export function buildSurveyOptionsPrompt(
  params: SurveyOptionsPromptParams,
  project?: Pick<Project, "ai_prompt_templates_json"> | null
): AdminPromptResult {
  const key: BasePromptKey = "buildSurveyOptionsPrompt";
  const def = BASE_PROMPT_TEMPLATES[key];
  const { template, mode } = resolveTemplate(project, key);

  const userPrompt = renderPromptTemplate(template, {
    questionText: params.questionText,
    currentQuestionType: params.currentQuestionType,
    typeInstruction: params.typeInstruction,
    responseFormat: params.responseFormat,
  });

  return {
    systemPrompt: def.systemPrompt,
    userPrompt,
    promptKey: key,
    templateMode: mode,
    renderedPrompt: userPrompt,
  };
}

// ---------------------------------------------------------------------------
// 2. 設問テキスト流用調整
// ---------------------------------------------------------------------------

export interface AdjustQuestionsPromptParams {
  targetProjectName: string;
  targetProjectObjective: string;
  sourceProjectName: string;
  sourceProjectObjective: string;
  questionsJson: string;
}

export function buildAdjustQuestionsPrompt(
  params: AdjustQuestionsPromptParams,
  project?: Pick<Project, "ai_prompt_templates_json"> | null
): AdminPromptResult {
  const key: BasePromptKey = "buildAdjustQuestionsPrompt";
  const def = BASE_PROMPT_TEMPLATES[key];
  const { template, mode } = resolveTemplate(project, key);

  const userPrompt = renderPromptTemplate(template, {
    targetProjectName: params.targetProjectName,
    targetProjectObjective: params.targetProjectObjective,
    sourceProjectName: params.sourceProjectName,
    sourceProjectObjective: params.sourceProjectObjective,
    questionsJson: params.questionsJson,
  });

  return {
    systemPrompt: def.systemPrompt,
    userPrompt,
    promptKey: key,
    templateMode: mode,
    renderedPrompt: userPrompt,
  };
}

// ---------------------------------------------------------------------------
// 3. AIフロー自動生成
// ---------------------------------------------------------------------------

export interface GenerateFlowPromptParams {
  projectName: string;
  objective: string;
}

export function buildGenerateFlowPrompt(
  params: GenerateFlowPromptParams,
  project?: Pick<Project, "ai_prompt_templates_json"> | null
): AdminPromptResult {
  const key: BasePromptKey = "buildGenerateFlowPrompt";
  const def = BASE_PROMPT_TEMPLATES[key];
  const { template, mode } = resolveTemplate(project, key);

  const userPrompt = renderPromptTemplate(template, {
    projectName: params.projectName,
    objective: params.objective,
  });

  return {
    systemPrompt: def.systemPrompt,
    userPrompt,
    promptKey: key,
    templateMode: mode,
    renderedPrompt: userPrompt,
  };
}

// ---------------------------------------------------------------------------
// 4. 属性不足設問提案
// ---------------------------------------------------------------------------

export interface MissingAttributeSuggestionsPromptParams {
  /** `- attr_key（ラベル）: 取得率 N%` 形式の行を結合した文字列 */
  attributeList: string;
}

export function buildMissingAttributeSuggestionsPrompt(
  params: MissingAttributeSuggestionsPromptParams
): AdminPromptResult {
  const key: BasePromptKey = "buildMissingAttributeSuggestionsPrompt";
  const def = BASE_PROMPT_TEMPLATES[key];
  // プロジェクト文脈なし → 常に legacy
  const userPrompt = renderPromptTemplate(def.template, {
    attributeList: params.attributeList,
  });

  return {
    systemPrompt: def.systemPrompt,
    userPrompt,
    promptKey: key,
    templateMode: "legacy",
    renderedPrompt: userPrompt,
  };
}
