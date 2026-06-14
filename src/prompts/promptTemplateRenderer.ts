/**
 * promptTemplateRenderer.ts
 *
 * {{placeholder}} 形式のテンプレートを実行時コンテキストで安全に解決する。
 *
 * 設計方針:
 * - eval・Function コンストラクタは一切使わない
 * - 許可リスト外のプレースホルダーは警告ログ + 空文字に変換
 * - JSON.stringify が必要な値はレンダラー側で処理
 */

import { logger } from "../lib/logger";
import type { Project, AIPromptTemplateMap } from "../types/domain";
import { BASE_PROMPT_TEMPLATES, type BasePromptKey } from "./basePromptTemplates";

export type PromptTemplateContext = Record<string, string | null | undefined>;

/**
 * テンプレート文字列内の {{key}} を context の値で置換する。
 * 未定義キーは空文字にし、警告ログを出す。
 */
export function renderPromptTemplate(template: string, context: PromptTemplateContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      const value = context[key];
      return value != null ? value : "";
    }
    logger.warn("promptTemplateRenderer: undefined placeholder", { placeholder: key });
    return "";
  });
}

/**
 * テンプレート内の {{placeholder}} キー一覧を抽出する。
 */
export function extractTemplatePlaceholders(template: string): string[] {
  const matches = [...template.matchAll(/\{\{(\w+)\}\}/g)];
  return [...new Set(matches.map((m) => m[1]).filter((k): k is string => k !== undefined))];
}

/**
 * テンプレートで使用されているプレースホルダーが allowedPlaceholders に含まれるか検証し、
 * 不正なものがあれば警告する（アプリは落とさない）。
 */
export function validatePromptTemplatePlaceholders(
  template: string,
  allowedPlaceholders: string[]
): { valid: boolean; unknownKeys: string[] } {
  const used = extractTemplatePlaceholders(template);
  const allowed = new Set(allowedPlaceholders);
  const unknownKeys = used.filter((k) => !allowed.has(k));
  if (unknownKeys.length > 0) {
    logger.warn("promptTemplateRenderer: unknown placeholders found", { unknownKeys });
  }
  return { valid: unknownKeys.length === 0, unknownKeys };
}

/**
 * プロジェクトの ai_prompt_templates_json を参照し、対象キーのテンプレートを解決する。
 * - ai_prompt_templates_json に enabled:true かつ template 文字列があればそれを使用
 * - なければ BASE_PROMPT_TEMPLATES のデフォルトを使用
 */
export function resolveBasePromptTemplate(
  project: Pick<Project, "ai_prompt_templates_json">,
  promptKey: BasePromptKey
): string {
  const customTemplates = project.ai_prompt_templates_json as AIPromptTemplateMap | null | undefined;
  const entry = customTemplates?.[promptKey];
  if (entry?.enabled !== false && typeof entry?.template === "string" && entry.template.trim()) {
    return entry.template;
  }
  return BASE_PROMPT_TEMPLATES[promptKey]?.template ?? "";
}
