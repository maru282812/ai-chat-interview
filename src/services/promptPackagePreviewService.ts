/**
 * promptPackagePreviewService.ts
 *
 * Phase 5-A: パッケージ適用時のプレビュー。
 * 選択中のパッケージバージョンに対して「実際に使われる設定」を解決して返す。
 *
 * - archived バージョン選択時は aiService.resolveEffectiveProjectConfig と同じルールで
 *   published バージョンへ fallback した内容をプレビューする
 * - fallback 先がない場合は custom 相当になることを明示する（customEquivalent = true）
 */

import { BASE_PROMPT_TEMPLATES, type BasePromptKey } from "../prompts/basePromptTemplates";
import type { AIPromptPolicy, AIPromptTemplateMap } from "../types/domain";
import type {
  PromptPackage,
  PromptPackageVersion,
} from "../repositories/promptPackageRepository";

export interface PackagePreviewTemplate {
  key: BasePromptKey;
  label: string;
  /** package = バージョンのカスタムテンプレート / base = BASE_PROMPT_TEMPLATES フォールバック / disabled = 明示的に無効化（base 使用） */
  source: "package" | "base" | "disabled";
  templateMode: "package_template" | "base_template";
  template: string;
}

export interface PackageVersionPreview {
  packageId: string;
  packageSlug: string | null;
  packageName: string | null;
  /** 選択中バージョン */
  selectedVersionNo: number;
  selectedStatus: string;
  /** archived → published への fallback が発生するか */
  isFallback: boolean;
  fallbackVersionNo: number | null;
  /** fallback 先がなく custom 相当で動作するか */
  customEquivalent: boolean;
  /** 実際に適用されるバージョン（customEquivalent の場合は null） */
  effectiveVersionNo: number | null;
  effectiveStatus: string | null;
  /** 実際に適用される policy_json（customEquivalent の場合は null = プロジェクト個別設定） */
  policyJson: AIPromptPolicy | null;
  /** 実際に使用されるプロンプトテンプレート一覧（customEquivalent の場合は空配列） */
  templates: PackagePreviewTemplate[];
}

export interface PackagePreviewDeps {
  getVersionById(versionId: string): Promise<PromptPackageVersion | null>;
  getById(packageId: string): Promise<PromptPackage | null>;
  getPublishedVersionByPackageId(packageId: string): Promise<PromptPackageVersion | null>;
}

async function defaultDeps(): Promise<PackagePreviewDeps> {
  const { promptPackageRepository } = await import("../repositories/promptPackageRepository");
  return promptPackageRepository;
}

/** バージョンの templates_json から、実際に使用されるテンプレートをキーごとに解決する */
export function resolveEffectiveTemplates(
  templatesJson: AIPromptTemplateMap | null | undefined
): PackagePreviewTemplate[] {
  return (Object.keys(BASE_PROMPT_TEMPLATES) as BasePromptKey[]).map((key) => {
    const def = BASE_PROMPT_TEMPLATES[key];
    const entry = templatesJson?.[key];
    const isDisabled = entry?.enabled === false;
    const hasCustom = !isDisabled && typeof entry?.template === "string" && !!entry.template.trim();
    return {
      key,
      label: def.label,
      source: hasCustom ? "package" : isDisabled ? "disabled" : "base",
      templateMode: hasCustom ? "package_template" : "base_template",
      template: hasCustom ? (entry!.template as string) : def.template,
    };
  });
}

/**
 * パッケージバージョンのプレビューを構築する。
 * バージョンが存在しない場合は null を返す。
 */
export async function buildPackageVersionPreview(
  versionId: string,
  deps?: PackagePreviewDeps
): Promise<PackageVersionPreview | null> {
  const repo = deps ?? (await defaultDeps());
  const version = await repo.getVersionById(versionId);
  if (!version) return null;

  const pkg = await repo.getById(version.package_id);
  const base = {
    packageId: version.package_id,
    packageSlug: pkg?.slug ?? null,
    packageName: pkg?.name ?? null,
    selectedVersionNo: version.version_no,
    selectedStatus: version.status,
  };

  // archived → published へ fallback（aiService.resolveEffectiveProjectConfig と同一ルール）
  if (version.status === "archived") {
    const published = await repo.getPublishedVersionByPackageId(version.package_id);
    if (!published) {
      return {
        ...base,
        isFallback: false,
        fallbackVersionNo: null,
        customEquivalent: true,
        effectiveVersionNo: null,
        effectiveStatus: null,
        policyJson: null,
        templates: [],
      };
    }
    return {
      ...base,
      isFallback: true,
      fallbackVersionNo: published.version_no,
      customEquivalent: false,
      effectiveVersionNo: published.version_no,
      effectiveStatus: published.status,
      policyJson: published.policy_json,
      templates: resolveEffectiveTemplates(published.templates_json),
    };
  }

  return {
    ...base,
    isFallback: false,
    fallbackVersionNo: null,
    customEquivalent: false,
    effectiveVersionNo: version.version_no,
    effectiveStatus: version.status,
    policyJson: version.policy_json,
    templates: resolveEffectiveTemplates(version.templates_json),
  };
}
