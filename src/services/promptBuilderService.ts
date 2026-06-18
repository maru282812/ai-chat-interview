/**
 * promptBuilderService.ts  (Phase F)
 *
 * 「プロンプトビルダー」= パッケージ Version の方針管理。
 *
 * 運用者は AI の振る舞い方針（用途 / 目的 / 質問スタイル / 深掘り方針 / 完了条件 …）を
 * 構造化して入力する。その方針から **Version 作成/編集時に一度だけ** AI が会話系10キーの
 * テンプレート本文を生成し、templates_json に焼き込む。
 *
 * 重要な不変条件:
 * - 実行時にはこのサービスを一切呼ばない（生成は管理画面のボタン押下時のみ）。
 * - 生成は BASE 本文を方針で書き換える。{{placeholder}} と出力契約（JSON必須キー等）は
 *   保持しなければならない。parseGenerationResult でプレースホルダーの増減を検証し、
 *   破綻したキーは不採用にする。
 */

import {
  BASE_PROMPT_TEMPLATES,
  BUILDER_GENERATION_KEYS,
  type BasePromptKey,
} from "../prompts/basePromptTemplates";
import type { PromptBuilderSpec } from "../types/domain";
import { extractPlaceholders } from "./promptPackageDiffService";

export type { PromptBuilderSpec } from "../types/domain";

// ────────────────────────────────────────────────
// 方針スペック フィールド定義
// ────────────────────────────────────────────────

export type PromptBuilderFieldType = "text" | "textarea" | "list";

export interface PromptBuilderFieldDef {
  key: keyof PromptBuilderSpec;
  label: string;
  type: PromptBuilderFieldType;
  placeholder: string;
  hint?: string;
}

/** UI（version-form 基本モード）生成用フィールド定義 */
export const PROMPT_BUILDER_FIELDS: PromptBuilderFieldDef[] = [
  { key: "purpose", label: "用途", type: "text", placeholder: "例: インタビュー" },
  { key: "goal", label: "目的", type: "textarea", placeholder: "例: 解約理由の本音と背景を理解する" },
  { key: "targetUser", label: "対象ユーザー", type: "text", placeholder: "例: 30〜40代の既存ユーザー" },
  { key: "aiPersona", label: "AI人格", type: "text", placeholder: "例: 親しみやすく聞き上手なインタビュアー" },
  { key: "questionStyle", label: "質問スタイル", type: "text", placeholder: "例: フレンドリー" },
  { key: "probePolicy", label: "深掘り方針", type: "textarea", placeholder: "例: 積極的に理由・場面を1点ずつ引き出す" },
  { key: "completionCondition", label: "完了条件", type: "text", placeholder: "例: 必須項目100%" },
  { key: "ambiguousAnswer", label: "曖昧回答への対応", type: "text", placeholder: "例: 一度だけ具体化を求める" },
  { key: "noneAnswer", label: "「特になし・わからない」への対応", type: "text", placeholder: "例: 別角度でやさしく再質問" },
  { key: "outputFormatNote", label: "出力形式の補足", type: "textarea", placeholder: "例: 1メッセージは短く、LINE向けの口調で", hint: "JSON出力の必須キーは自動で保持されます。ここはトーンや長さの補足のみ。" },
  { key: "prohibitions", label: "禁止事項", type: "list", placeholder: "1行に1つ（例: 誘導質問をしない）", hint: "改行区切りで複数指定できます。" },
];

/**
 * 「振る舞い方針」セクション（version-form 最上部・常時表示）のフィールドキー。
 * PROMPT_BUILDER_FIELDS（基本モードの詳細な内訳11軸）とは別管理だが、
 * いずれも builder_spec_json に格納され生成の入力になる。すべて任意の文字列。
 */
export const POLICY_HEADER_KEYS: (keyof PromptBuilderSpec)[] = [
  "behaviorPolicy",
  "usagePreset",
  "probeIntensity",
  "outputQuality",
];

const TEXT_FIELD_KEYS: (keyof PromptBuilderSpec)[] = [
  ...POLICY_HEADER_KEYS,
  ...PROMPT_BUILDER_FIELDS.filter((f) => f.type !== "list").map((f) => f.key),
];

/** 不正・空フィールドを除去して正規化した PromptBuilderSpec を返す */
export function normalizePromptBuilderSpec(raw: unknown): PromptBuilderSpec {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const r = raw as Record<string, unknown>;
  const spec: PromptBuilderSpec = {};

  for (const key of TEXT_FIELD_KEYS) {
    const value = r[key];
    if (typeof value === "string" && value.trim() !== "") {
      (spec as Record<string, unknown>)[key] = value.trim();
    }
  }

  // prohibitions: 配列 or 改行区切り文字列の両方を受け付ける
  const rawProhibitions = r.prohibitions;
  let prohibitions: string[] = [];
  if (Array.isArray(rawProhibitions)) {
    prohibitions = rawProhibitions.filter((v): v is string => typeof v === "string");
  } else if (typeof rawProhibitions === "string") {
    prohibitions = rawProhibitions.split(/\r?\n/);
  }
  prohibitions = prohibitions.map((v) => v.trim()).filter((v) => v !== "");
  if (prohibitions.length > 0) {
    spec.prohibitions = prohibitions;
  }

  return spec;
}

/** スペックが実質的に空かどうか */
export function isPromptBuilderSpecEmpty(spec: PromptBuilderSpec): boolean {
  return Object.keys(normalizePromptBuilderSpec(spec)).length === 0;
}

// ────────────────────────────────────────────────
// 生成メタプロンプト
// ────────────────────────────────────────────────

function renderSpecForPrompt(spec: PromptBuilderSpec): string {
  const lines: string[] = [];
  const push = (label: string, value: string | undefined) => {
    if (value && value.trim()) lines.push(`- ${label}: ${value.trim()}`);
  };
  push("振る舞い方針 (behavior_policy)", spec.behaviorPolicy);
  push("用途プリセット (usage_preset)", spec.usagePreset);
  push("深掘り強度 (probe_intensity)", spec.probeIntensity);
  push("出力品質 (output_quality)", spec.outputQuality);
  push("用途 (purpose)", spec.purpose);
  push("目的 (goal)", spec.goal);
  push("対象ユーザー (target_user)", spec.targetUser);
  push("AI人格 (ai_persona)", spec.aiPersona);
  push("質問スタイル (question_style)", spec.questionStyle);
  push("深掘り方針 (probe_policy)", spec.probePolicy);
  push("完了条件 (completion_condition)", spec.completionCondition);
  push("曖昧回答への対応 (ambiguous_answer)", spec.ambiguousAnswer);
  push("特になし・わからないへの対応 (none_answer)", spec.noneAnswer);
  push("出力形式の補足 (output_format_note)", spec.outputFormatNote);
  if (spec.prohibitions && spec.prohibitions.length > 0) {
    lines.push(`- 禁止事項 (prohibitions):`);
    for (const p of spec.prohibitions) lines.push(`    - ${p}`);
  }
  return lines.length > 0 ? lines.join("\n") : "(指定なし)";
}

/**
 * 方針から対象テンプレート群を書き換える単一のメタプロンプトを構築する。
 * 出力は {"<key>": "<書き換え後の全文>", ...} の JSON のみ。
 */
export function buildGenerationMetaPrompt(
  spec: PromptBuilderSpec,
  targetKeys: BasePromptKey[] = BUILDER_GENERATION_KEYS
): string {
  const specBlock = renderSpecForPrompt(spec);

  const templateBlocks = targetKeys.map((key) => {
    const def = BASE_PROMPT_TEMPLATES[key];
    const placeholders = def.allowedPlaceholders.map((p) => `{{${p}}}`).join(" ");
    return [
      `### KEY: ${key}`,
      `用途: ${def.label} — ${def.description}`,
      `出力形式（必ず保持すること）: ${def.outputFormat}`,
      `使用可能なプレースホルダー（増減・改名禁止）: ${placeholders || "(なし)"}`,
      `--- BASE本文 ---`,
      def.template,
      `--- BASE本文ここまで ---`,
    ].join("\n");
  });

  return `あなたはLINEベースのリサーチ/インタビューシステムのプロンプト設計者です。
以下の「運用者の方針」を反映して、各テンプレート本文（BASE）を書き換えてください。

# 運用者の方針
${specBlock}

# 厳守ルール（違反した出力は破棄されます）
1. 各テンプレート内の {{placeholder}} トークンは一切増やさず・減らさず・改名しないこと。位置や前後の文脈は方針に合わせて自然に調整してよい。
2. 各テンプレートの「出力形式」（"Return JSON only" や必須JSONキー、"Japanese only" 等の既存の出力契約）は必ず保持すること。新しい必須キーを足したり既存キーを消したりしないこと。
3. 方針が特定テンプレートに無関係な場合は、そのBASE本文をほぼそのまま使ってよい（無理に方針を押し込まない）。
4. 内部コードやスロットキーを回答者向け文面に露出させないという既存方針を保持すること。
5. 出力は次のJSONオブジェクトのみ。各値は書き換え後のテンプレート全文（文字列）。マークダウンのコードフェンスや説明文を一切付けないこと。

# 書き換え対象テンプレート
${templateBlocks.join("\n\n")}

# 出力JSONの形（キーは上記KEYと完全一致させること）
{
${targetKeys.map((k) => `  "${k}": "..."`).join(",\n")}
}`;
}

// ────────────────────────────────────────────────
// 生成結果のパース・検証
// ────────────────────────────────────────────────

export interface GenerationParseResult {
  /** 採用された生成本文（key → template） */
  templates: Partial<Record<BasePromptKey, string>>;
  /** 採用キー一覧 */
  generatedKeys: BasePromptKey[];
  /** 不採用・注意メッセージ */
  warnings: string[];
}

/** 先頭/末尾のコードフェンスを除去して JSON 部分を取り出す */
function stripJsonFences(text: string): string {
  let t = text.trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\s*/, "").replace(/```\s*$/, "").trim();
  }
  // 最初の { から最後の } まで（前後の余分なテキスト対策）
  const first = t.indexOf("{");
  const last = t.lastIndexOf("}");
  if (first >= 0 && last > first) {
    t = t.slice(first, last + 1);
  }
  return t;
}

/**
 * AI生成結果（JSON文字列）を対象キーのみ採用してパース・検証する。
 * - JSONパース失敗 → 空 + warning
 * - 対象外キー → 無視
 * - プレースホルダーが BASE の allowedPlaceholders と完全一致しない本文 → 不採用 + warning
 *   （未使用プレースホルダーは許容＝部分集合。許可外/未定義の混入と、必須トークンの欠落は不採用）
 */
export function parseGenerationResult(
  text: string | null | undefined,
  targetKeys: BasePromptKey[] = BUILDER_GENERATION_KEYS
): GenerationParseResult {
  const result: GenerationParseResult = { templates: {}, generatedKeys: [], warnings: [] };

  if (!text || !text.trim()) {
    result.warnings.push("AIから空の応答が返りました。再試行してください。");
    return result;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFences(text));
  } catch {
    result.warnings.push("AI応答をJSONとして解析できませんでした。再試行してください。");
    return result;
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    result.warnings.push("AI応答が想定したオブジェクト形式ではありませんでした。");
    return result;
  }

  const obj = parsed as Record<string, unknown>;
  const targetSet = new Set<string>(targetKeys);

  for (const key of targetKeys) {
    const value = obj[key];
    if (typeof value !== "string" || value.trim() === "") {
      result.warnings.push(`${key}: 生成本文が空のため不採用（BASEを維持）。`);
      continue;
    }

    const def = BASE_PROMPT_TEMPLATES[key];
    const allowed = new Set(def.allowedPlaceholders);
    const baseSet = new Set(extractPlaceholders(def.template));
    const genSet = new Set(extractPlaceholders(value));

    // 許可外プレースホルダーの混入を不採用
    const unknownPlaceholders = [...genSet].filter((p) => !allowed.has(p));
    if (unknownPlaceholders.length > 0) {
      result.warnings.push(
        `${key}: 許可外のプレースホルダー {{${unknownPlaceholders.join("}}, {{")}}} が混入したため不採用（BASEを維持）。`
      );
      continue;
    }
    // BASE で使われていた必須トークンの欠落を不採用
    const missing = [...baseSet].filter((p) => !genSet.has(p));
    if (missing.length > 0) {
      result.warnings.push(
        `${key}: 必要なプレースホルダー {{${missing.join("}}, {{")}}} が欠落したため不採用（BASEを維持）。`
      );
      continue;
    }

    result.templates[key] = value;
    result.generatedKeys.push(key);
  }

  // 対象外キーが返ってきても無視（targetSet を使って検出のみ）
  const extraKeys = Object.keys(obj).filter((k) => !targetSet.has(k));
  if (extraKeys.length > 0) {
    result.warnings.push(`対象外のキー（${extraKeys.join(", ")}）は無視しました。`);
  }

  if (result.generatedKeys.length === 0 && result.warnings.length === 0) {
    result.warnings.push("採用できる生成本文がありませんでした。");
  }

  return result;
}
