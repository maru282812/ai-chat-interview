/**
 * promptPackageDiffService.ts
 *
 * Phase 6-E: 同一パッケージ内のバージョン同士の差分を計算する。
 * - policy_json: 軸ごとの変更（変更された方針）
 * - templates_json: 実効テンプレート（カスタム or BASE フォールバック）同士の
 *   行単位 diff・追加/削除されたプレースホルダー（変数）
 *
 * 外部ライブラリを使わず LCS ベースの行 diff を実装している（テンプレートは高々数百行）。
 */

import { BASE_PROMPT_TEMPLATES, describePolicyAxis, type BasePromptKey } from "../prompts/basePromptTemplates";
import type { AIPromptPolicy, AIPromptTemplateMap } from "../types/domain";
import type { PromptPackageVersion } from "../repositories/promptPackageRepository";
import { resolveEffectiveTemplates, type PackagePreviewTemplate } from "./promptPackagePreviewService";

export interface LineDiffRow {
  type: "same" | "added" | "removed";
  text: string;
}

export interface PolicyDiffEntry {
  key: string;
  label: string;
  /** 表示用の値（未設定は null） */
  fromValue: string | null;
  toValue: string | null;
}

export type TemplateChangeType = "unchanged" | "modified" | "added" | "removed";

export interface TemplateDiffEntry {
  key: BasePromptKey;
  label: string;
  /**
   * unchanged: 実効テンプレートが同一
   * modified : 両方カスタムあり（または base⇄カスタム以外の変化）で本文が変化
   * added    : base（デフォルト）→ カスタムテンプレートに変更
   * removed  : カスタムテンプレート → base（デフォルト）に戻った
   */
  changeType: TemplateChangeType;
  fromSource: PackagePreviewTemplate["source"];
  toSource: PackagePreviewTemplate["source"];
  /** 追加された変数（{{placeholder}}） */
  addedPlaceholders: string[];
  /** 削除された変数 */
  removedPlaceholders: string[];
  /** 行単位 diff（unchanged の場合は空配列） */
  lines: LineDiffRow[];
}

export interface VersionDiff {
  policyChanges: PolicyDiffEntry[];
  templateChanges: TemplateDiffEntry[];
  changedTemplateCount: number;
}

/** LCS ベースの行単位 diff */
export function diffLines(oldText: string, newText: string): LineDiffRow[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const n = oldLines.length;
  const m = newLines.length;

  // LCS テーブル（(n+1) x (m+1) をフラット配列で保持）
  const width = m + 1;
  const lcs = new Array<number>((n + 1) * width).fill(0);
  const at = (i: number, j: number): number => lcs[i * width + j] ?? 0;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * width + j] = oldLines[i] === newLines[j]
        ? at(i + 1, j + 1) + 1
        : Math.max(at(i + 1, j), at(i, j + 1));
    }
  }

  const rows: LineDiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (oldLines[i] === newLines[j]) {
      rows.push({ type: "same", text: oldLines[i] ?? "" });
      i++;
      j++;
    } else if (at(i + 1, j) >= at(i, j + 1)) {
      rows.push({ type: "removed", text: oldLines[i] ?? "" });
      i++;
    } else {
      rows.push({ type: "added", text: newLines[j] ?? "" });
      j++;
    }
  }
  while (i < n) rows.push({ type: "removed", text: oldLines[i++] ?? "" });
  while (j < m) rows.push({ type: "added", text: newLines[j++] ?? "" });
  return rows;
}

/** テンプレート本文から {{placeholder}} を抽出する */
export function extractPlaceholders(template: string): string[] {
  const found = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(template)) !== null) {
    const name = match[1];
    if (name) found.add(name);
  }
  return [...found];
}

function formatPolicyValue(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (Array.isArray(value)) return value.length > 0 ? value.join(", ") : "（制限なし）";
  return String(value);
}

const POLICY_KEYS: (keyof AIPromptPolicy)[] = [
  "researchType", "audience", "probeStyle", "noneAnswerPolicy",
  "ambiguousAnswerRule", "freeAnswerPolicy", "restrictions", "priority",
];

/** policy_json の差分（変更されたキーのみ） */
export function diffPolicies(
  fromPolicy: AIPromptPolicy | null | undefined,
  toPolicy: AIPromptPolicy | null | undefined
): PolicyDiffEntry[] {
  const from = fromPolicy ?? {};
  const to = toPolicy ?? {};
  const changes: PolicyDiffEntry[] = [];
  for (const key of POLICY_KEYS) {
    const fromValue = formatPolicyValue(from[key]);
    const toValue = formatPolicyValue(to[key]);
    if (fromValue !== toValue) {
      changes.push({ key, label: describePolicyAxis(key), fromValue, toValue });
    }
  }
  return changes;
}

function resolveChangeType(
  fromTmpl: PackagePreviewTemplate,
  toTmpl: PackagePreviewTemplate
): TemplateChangeType {
  if (fromTmpl.template === toTmpl.template && fromTmpl.source === toTmpl.source) {
    return "unchanged";
  }
  if (fromTmpl.source !== "package" && toTmpl.source === "package") return "added";
  if (fromTmpl.source === "package" && toTmpl.source !== "package") return "removed";
  return "modified";
}

/** templates_json の差分（実効テンプレート同士を比較） */
export function diffTemplates(
  fromTemplates: AIPromptTemplateMap | null | undefined,
  toTemplates: AIPromptTemplateMap | null | undefined
): TemplateDiffEntry[] {
  const fromEffective = resolveEffectiveTemplates(fromTemplates);
  const toEffective = resolveEffectiveTemplates(toTemplates);
  const toByKey = new Map(toEffective.map((t) => [t.key, t]));

  return fromEffective.map((fromTmpl) => {
    const toTmpl = toByKey.get(fromTmpl.key) as PackagePreviewTemplate;
    const def = BASE_PROMPT_TEMPLATES[fromTmpl.key];
    const changeType = resolveChangeType(fromTmpl, toTmpl);

    const fromPlaceholders = new Set(extractPlaceholders(fromTmpl.template));
    const toPlaceholders = new Set(extractPlaceholders(toTmpl.template));

    return {
      key: fromTmpl.key,
      label: def.label,
      changeType,
      fromSource: fromTmpl.source,
      toSource: toTmpl.source,
      addedPlaceholders: [...toPlaceholders].filter((p) => !fromPlaceholders.has(p)),
      removedPlaceholders: [...fromPlaceholders].filter((p) => !toPlaceholders.has(p)),
      lines: changeType === "unchanged" ? [] : diffLines(fromTmpl.template, toTmpl.template),
    };
  });
}

/** 2バージョン間の差分を計算する */
export function buildVersionDiff(
  fromVersion: PromptPackageVersion,
  toVersion: PromptPackageVersion
): VersionDiff {
  const policyChanges = diffPolicies(fromVersion.policy_json, toVersion.policy_json);
  const templateChanges = diffTemplates(fromVersion.templates_json, toVersion.templates_json);
  return {
    policyChanges,
    templateChanges,
    changedTemplateCount: templateChanges.filter((t) => t.changeType !== "unchanged").length,
  };
}
