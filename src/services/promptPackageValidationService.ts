/**
 * promptPackageValidationService.ts
 *
 * Phase 5-B: プロンプトパッケージのバリデーション。
 * バージョン保存時・公開時・プロジェクト適用時に呼び出す。
 *
 * エラーと警告の区別:
 * - エラー: 保存・公開・適用不可（壊れた JSON / 必須プロンプトキーのテンプレートが空 など）
 * - 警告: 保存可能だが画面に表示（許可外プレースホルダー / archived 直接選択 など）
 */

import { BASE_PROMPT_TEMPLATES, type BasePromptKey } from "../prompts/basePromptTemplates";
import { extractTemplatePlaceholders } from "../prompts/promptTemplateRenderer";
import { normalizeAIPromptPolicy } from "../prompts/promptPolicies";
import type { AIPromptTemplateMap } from "../types/domain";
import type { PromptPackageVersion } from "../repositories/promptPackageRepository";

export interface PromptPackageValidationResult {
  errors: string[];
  warnings: string[];
}

/** 全プロンプトキー = 必須キー（未定義キーは BASE にフォールバックするため、定義済みエントリの整合性を検証する） */
export const REQUIRED_PROMPT_KEYS = Object.keys(BASE_PROMPT_TEMPLATES) as BasePromptKey[];

/** JSON 文字列としての妥当性を検証する。空文字は「未設定」として許容する */
export function parseJsonText(raw: string, label: string): { value: unknown; error: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { value: null, error: null };
  }
  try {
    return { value: JSON.parse(trimmed), error: null };
  } catch {
    return { value: null, error: `${label} が JSON として不正です。` };
  }
}

/**
 * パッケージバージョンの policy_json / templates_json を検証する。
 * raw テキスト（フォーム入力）と parse 済みオブジェクトのどちらでも検証できる。
 */
export function validatePromptPackageVersionConfig(input: {
  rawPolicyJson?: string;
  rawTemplatesJson?: string;
  policyJson?: unknown;
  templatesJson?: unknown;
}): PromptPackageValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── JSON としての妥当性 ──
  let policyJson: unknown = input.policyJson ?? null;
  if (typeof input.rawPolicyJson === "string") {
    const parsed = parseJsonText(input.rawPolicyJson, "policy_json");
    if (parsed.error) errors.push(parsed.error);
    else policyJson = parsed.value;
  }

  let templatesJson: unknown = input.templatesJson ?? null;
  if (typeof input.rawTemplatesJson === "string") {
    const parsed = parseJsonText(input.rawTemplatesJson, "templates_json");
    if (parsed.error) errors.push(parsed.error);
    else templatesJson = parsed.value;
  }

  // ── policy_json の構造検証 ──
  if (policyJson != null) {
    if (typeof policyJson !== "object" || Array.isArray(policyJson)) {
      errors.push("policy_json はオブジェクトである必要があります。");
    } else {
      const raw = policyJson as Record<string, unknown>;
      const normalized = normalizeAIPromptPolicy(raw) as Record<string, unknown>;
      for (const key of Object.keys(raw)) {
        if (!(key in normalized)) {
          warnings.push(`[policy_json] 未対応または不正な値のキーです（無視されます）: ${key}`);
        }
      }
    }
  }

  // ── templates_json の構造検証 ──
  if (templatesJson != null) {
    if (typeof templatesJson !== "object" || Array.isArray(templatesJson)) {
      errors.push("templates_json はオブジェクトである必要があります。");
    } else {
      const templateResult = validateTemplatesMap(templatesJson as AIPromptTemplateMap);
      errors.push(...templateResult.errors);
      warnings.push(...templateResult.warnings);
    }
  }

  return { errors, warnings };
}

/** templates_json の各エントリを検証する */
function validateTemplatesMap(templates: AIPromptTemplateMap): PromptPackageValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const [key, entry] of Object.entries(templates)) {
    if (!entry) continue;
    const def = BASE_PROMPT_TEMPLATES[key as BasePromptKey];

    // 未知のキー → 警告（実行時には無視される）
    if (!def) {
      warnings.push(`[${key}] 未定義のプロンプトキーです（無視されます）`);
      continue;
    }

    const isEnabled = entry.enabled !== false;

    // 必須プロンプトキーのテンプレートが定義されているのに空白のみ → エラー
    if (isEnabled && typeof entry.template === "string" && entry.template.length > 0 && !entry.template.trim()) {
      errors.push(`[${key}] 必須プロンプトキーのテンプレートが空白のみです`);
      continue;
    }

    if (typeof entry.template !== "string" || !entry.template.trim()) continue;

    // 許可外プレースホルダー → 警告（実行時には空文字に置換され落ちないため）
    const used = extractTemplatePlaceholders(entry.template);
    const allowed = new Set(def.allowedPlaceholders);
    const unknownKeys = used.filter((k) => !allowed.has(k));
    if (unknownKeys.length > 0) {
      warnings.push(`[${key}] 許可外プレースホルダー: ${unknownKeys.map((k) => `{{${k}}}`).join(", ")}`);
    }
  }

  return { errors, warnings };
}

/**
 * 必須プロンプトキーのうち、実行時に有効なテンプレートへ解決できないキーを返す。
 * - エントリが enabled なのにテンプレートが空白のみ → 不足扱い（公開不可）
 * - 未定義・無効化エントリは BASE_PROMPT_TEMPLATES へフォールバックするため不足ではない
 */
export function findMissingRequiredPromptKeys(templates: AIPromptTemplateMap | null | undefined): string[] {
  if (!templates) return [];
  const missing: string[] = [];
  for (const key of REQUIRED_PROMPT_KEYS) {
    const entry = templates[key];
    if (!entry) continue;
    const isEnabled = entry.enabled !== false;
    if (isEnabled && typeof entry.template === "string" && entry.template.length > 0 && !entry.template.trim()) {
      missing.push(key);
    }
  }
  return missing;
}

/** 公開時の検証。エラーがある場合は公開不可 */
export function validatePromptPackageVersionForPublish(
  version: Pick<PromptPackageVersion, "policy_json" | "templates_json">
): PromptPackageValidationResult {
  const result = validatePromptPackageVersionConfig({
    policyJson: version.policy_json,
    templatesJson: version.templates_json,
  });
  const missing = findMissingRequiredPromptKeys(version.templates_json);
  for (const key of missing) {
    const message = `[${key}] 必須プロンプトキーのテンプレートが不足しています（公開できません）`;
    if (!result.errors.some((e) => e.startsWith(`[${key}]`))) {
      result.errors.push(message);
    }
  }
  return result;
}

/**
 * プロジェクト適用時の検証。
 * - draft → エラー（適用不可）
 * - archived + published あり → 警告（fallback 適用）
 * - archived + published なし → 強い警告（custom 相当で動作）
 */
export function validatePromptPackageVersionForApply(
  version: Pick<PromptPackageVersion, "status" | "version_no"> | null,
  publishedVersion: Pick<PromptPackageVersion, "version_no"> | null
): PromptPackageValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!version) {
    errors.push("指定されたパッケージバージョンが見つかりません。");
    return { errors, warnings };
  }
  if (version.status === "draft") {
    errors.push("draft バージョンはプロジェクトに適用できません。先に公開してください。");
    return { errors, warnings };
  }
  if (version.status === "archived") {
    if (publishedVersion) {
      warnings.push(
        `archived バージョン（v${version.version_no}）を選択しています。実行時は公開中の v${publishedVersion.version_no} に自動 fallback されます。`
      );
    } else {
      warnings.push(
        `【強い警告】archived バージョン（v${version.version_no}）を選択していますが、このパッケージに公開中バージョンが存在しません。AIプロンプトはプロジェクト個別設定（custom 相当）で動作します。`
      );
    }
  }
  return { errors, warnings };
}
