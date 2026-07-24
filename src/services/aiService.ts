import { env } from "../config/env";
import { openai } from "../config/openai";
import {
  evaluateProjectSlotCompletion,
  getProjectAIState,
  getProjectAIStateTemplate,
  normalizeProjectAIState
} from "../lib/projectAiState";
import { logger } from "../lib/logger";
import {
  assessProbeNeed,
  buildHeuristicStructuredPayload,
  buildInterviewQuestionFallback,
  evaluateCompletion,
  normalizeQuestionMeta,
  resolveAnswerAnalysisContext
} from "../lib/questionMetadata";
import {
  buildAnalyzeAnswerPrompt,
  buildCompletionCheckPrompt,
  buildFinalAnalysisPrompt,
  buildFinalStructuredSummaryPrompt,
  buildInterviewTurnPrompt,
  buildProbeGenerationPrompt,
  buildPostAnalysisPrompt,
  buildProjectInitialStatePrompt,
  buildProbePrompt,
  buildQuestionRenderingPrompt,
  buildProjectAnalysisPrompt,
  buildSessionSummaryPrompt,
  buildSlotFillingPrompt,
  buildRantExtendedPrompt,
  buildDiaryExtendedPrompt,
  buildPersonaTagsPrompt,
  buildRantCounselorReplyPrompt
} from "../prompts/researchPrompts";
import { mergePolicyWithOverrides } from "../prompts/promptPolicies";
import { aiLogRepository } from "../repositories/aiLogRepository";
import type {
  PromptPackage,
  PromptPackageVersion,
} from "../repositories/promptPackageRepository";
import type {
  AIPromptTemplateMap,
  AnswerAnalysisAction,
  AnswerAnalysisResult,
  NormalizedExtractionResult,
  Project,
  ProjectAIState,
  Question,
  QuestionExtractionConfig,
  StructuredAnswerCompletion,
  StructuredAnswerPayload,
  StructuredAnswerSlotValue,
  StructuredProbeType
} from "../types/domain";

interface AITextResult {
  text: string;
  usage: Record<string, unknown> | null;
}

interface AIPromptMeta {
  prompt_key?: string | null;
  template_key?: string | null;
  template_mode?: string | null;
  policy_snapshot?: Record<string, unknown> | null;
  // Phase 3: パッケージ追跡
  package_id?: string | null;
  package_version_id?: string | null;
  package_slug?: string | null;
  package_version_no?: number | null;
  // Phase A: 実行時解決状態スナップショット（ai_logs.resolution_json）
  resolution_json?: Record<string, unknown> | null;
}

interface PackageMeta {
  package_id: string;
  package_version_id: string;
  package_slug: string | null;
  package_version_no: number;
}

/**
 * Phase A: 実行時プロンプト解決状態。
 * 真実は PromptPackageVersion に寄せ、Project は「どのバージョンを使うか」を保持する適用先とする。
 * - source: 実行時の主データがどちらに由来したか
 * - usedProjectTemplateFallback / usedProjectPolicyFallback:
 *     package version に templates_json / policy_json が無く Project 側の値へ legacyFallback したか
 * - usedProjectOverride: Project 側 ai_prompt_overrides_json.policy（当面互換・deprecated）が使われたか
 * - warnings: silent fallback を避けるための追跡用メッセージ
 */
export interface PromptResolutionState {
  source: "package_version" | "project_legacy";
  usedProjectTemplateFallback: boolean;
  usedProjectPolicyFallback: boolean;
  usedProjectOverride: boolean;
  warnings: string[];
}

export interface EffectiveProjectConfig extends PromptResolutionState {
  effectiveProject: Project;
  packageMeta: PackageMeta | null;
  /** archived → published への実行時 fallback が発生したか（Phase 4-A） */
  isFallback: boolean;
  /** PromptResolutionState を1オブジェクトとして取り回すためのハンドル（上記フィールドと同値） */
  resolution: PromptResolutionState;
}

/** resolveEffectiveProjectConfig のパッケージ参照依存（テスト時にモック注入する） */
export interface ResolveConfigDeps {
  getVersionById(versionId: string): Promise<PromptPackageVersion | null>;
  getById(packageId: string): Promise<PromptPackage | null>;
  getPublishedVersionByPackageId(packageId: string): Promise<PromptPackageVersion | null>;
}

function logResolutionWarnings(project: Project, warnings: string[]): void {
  if (warnings.length === 0) {
    return;
  }
  logger.warn("aiService.resolveEffectiveProjectConfig: prompt resolution warnings", {
    project_id: project.id,
    warnings,
  });
}

/** プロジェクト文脈なし呼び出し（post_analysis 等で project=null）の既定解決状態 */
const LEGACY_RESOLUTION: PromptResolutionState = {
  source: "project_legacy",
  usedProjectTemplateFallback: false,
  usedProjectPolicyFallback: false,
  usedProjectOverride: false,
  warnings: [],
};

/** project_legacy（パッケージを使わない／使えない）として解決結果を組み立てる */
function buildLegacyResult(project: Project, warnings: string[] = []): EffectiveProjectConfig {
  const resolution: PromptResolutionState = {
    source: "project_legacy",
    usedProjectTemplateFallback: false,
    usedProjectPolicyFallback: false,
    usedProjectOverride: false,
    warnings,
  };
  return { effectiveProject: project, packageMeta: null, isFallback: false, ...resolution, resolution };
}

/** package_version を主データとして解決結果を組み立てる。
 *  優先順位: 1) version.templates_json  2) version.policy_json
 *           3) project override（deprecated・互換用） 4) project 側への legacyFallback */
function buildPackageResult(
  project: Project,
  version: PromptPackageVersion,
  pkg: PromptPackage | null,
  isFallback: boolean,
  baseWarnings: string[]
): EffectiveProjectConfig {
  const warnings = [...baseWarnings];

  // 優先順位1: version.templates_json / 優先順位4: project templates_json への legacyFallback
  let templates = version.templates_json;
  let usedProjectTemplateFallback = false;
  if (templates == null && project.ai_prompt_templates_json != null) {
    templates = project.ai_prompt_templates_json;
    usedProjectTemplateFallback = true;
    warnings.push(
      `[legacyFallback] templates: package v${version.version_no} に templates_json が無いため project.ai_prompt_templates_json を使用`
    );
  }

  // 優先順位2: version.policy_json / 優先順位4: project policy_json への legacyFallback
  let policy = version.policy_json;
  let usedProjectPolicyFallback = false;
  if (policy == null && project.ai_prompt_policy_json != null) {
    policy = project.ai_prompt_policy_json;
    usedProjectPolicyFallback = true;
    warnings.push(
      `[legacyFallback] policy: package v${version.version_no} に policy_json が無いため project.ai_prompt_policy_json を使用`
    );
  }

  // 優先順位3: project override（ai_prompt_overrides_json.policy）は当面互換用として残すが deprecated
  let usedProjectOverride = false;
  const overridePolicy = project.ai_prompt_overrides_json?.policy;
  if (overridePolicy && Object.keys(overridePolicy).length > 0) {
    policy = mergePolicyWithOverrides(policy, overridePolicy);
    usedProjectOverride = true;
    warnings.push(
      "[deprecated] project override (ai_prompt_overrides_json.policy) が適用されました。真実は package version へ寄せる方針のため将来廃止予定です（Phase B 以降）"
    );
  }

  logResolutionWarnings(project, warnings);

  const resolution: PromptResolutionState = {
    source: "package_version",
    usedProjectTemplateFallback,
    usedProjectPolicyFallback,
    usedProjectOverride,
    warnings,
  };

  return {
    effectiveProject: {
      ...project,
      ai_prompt_policy_json: policy,
      ai_prompt_templates_json: templates ?? null,
    },
    packageMeta: {
      package_id: version.package_id,
      package_version_id: version.id,
      package_slug: pkg?.slug ?? null,
      package_version_no: version.version_no,
    },
    isFallback,
    ...resolution,
    resolution,
  };
}

/**
 * Phase A: 実行時の主データを PromptPackageVersion に寄せる解決関数。
 * package mode かつ version が存在する場合、templates/policy の真実は package version。
 * Project 側 templates/policy は legacyFallback、override は deprecated 互換層として扱う。
 * 設定中バージョンが archived の場合、同パッケージの published バージョンへ自動 fallback する。
 * 管理画面のプレビュー/テスト実行でも同一の解決結果を使うため export している。
 * deps を渡すとパッケージ参照をモックできる（テスト用）。
 */
export async function resolveEffectiveProjectConfig(
  project: Project,
  deps?: ResolveConfigDeps
): Promise<EffectiveProjectConfig> {
  // package モードでない（custom / legacy）→ プロジェクト個別設定をそのまま使用
  if (project.ai_prompt_mode !== "package") {
    return buildLegacyResult(project);
  }

  // Phase A #4: package モードなのにバージョン未選択 → silent legacy fallback せず warnings に必ず記録
  // （画面側修正前のため今回は warnings 記録付き fallback。Phase C で作成ブロックへ変更予定）
  if (!project.ai_prompt_package_version_id) {
    const warnings = [
      "[package-unset] ai_prompt_mode=package ですが ai_prompt_package_version_id が未選択です。project 個別設定へ legacy fallback します（Phase C で作成時ブロック予定）",
    ];
    logResolutionWarnings(project, warnings);
    return buildLegacyResult(project, warnings);
  }

  try {
    const repo: ResolveConfigDeps =
      deps ?? (await import("../repositories/promptPackageRepository")).promptPackageRepository;
    const version = await repo.getVersionById(project.ai_prompt_package_version_id);

    if (!version) {
      const warnings = [
        `[package-missing] 参照バージョン(${project.ai_prompt_package_version_id})が見つかりません。legacy fallback します`,
      ];
      logResolutionWarnings(project, warnings);
      return buildLegacyResult(project, warnings);
    }

    // archived の場合、同パッケージの published バージョンへ fallback
    if (version.status === "archived") {
      const publishedVersion = await repo.getPublishedVersionByPackageId(version.package_id);
      if (!publishedVersion) {
        const warnings = [
          `[package-archived-no-published] 参照バージョン v${version.version_no} は archived で、同パッケージに公開版がありません。legacy fallback します`,
        ];
        logResolutionWarnings(project, warnings);
        return buildLegacyResult(project, warnings);
      }
      const pkg = await repo.getById(publishedVersion.package_id);
      return buildPackageResult(project, publishedVersion, pkg, true, [
        `[package-archived-fallback] 参照バージョン v${version.version_no} は archived のため公開版 v${publishedVersion.version_no} へ fallback します`,
      ]);
    }

    if (version.status !== "published") {
      // draft 等 → 適用不可。silent fallback せず warnings 記録付きで legacy fallback
      const warnings = [
        `[package-not-published] 参照バージョン v${version.version_no} は status=${version.status} のため適用できません。legacy fallback します`,
      ];
      logResolutionWarnings(project, warnings);
      return buildLegacyResult(project, warnings);
    }

    const pkg = await repo.getById(version.package_id);
    return buildPackageResult(project, version, pkg, false, []);
  } catch (error) {
    const warnings = [
      `[package-resolve-error] パッケージ解決に失敗しました: ${error instanceof Error ? error.message : String(error)}. legacy fallback します`,
    ];
    logResolutionWarnings(project, warnings);
    return buildLegacyResult(project, warnings);
  }
}

/** Phase A: 実行時解決状態を ai_logs.resolution_json 用の素の JSON に整形する。
 *  最低限「package_version を主に使ったか / project fallback したか / override が使われたか」を追跡できる。 */
function buildResolutionJson(
  resolution: PromptResolutionState,
  packageMeta: PackageMeta | null | undefined
): Record<string, unknown> {
  return {
    source: resolution.source,
    used_package_version: resolution.source === "package_version",
    used_project_template_fallback: resolution.usedProjectTemplateFallback,
    used_project_policy_fallback: resolution.usedProjectPolicyFallback,
    used_project_fallback:
      resolution.usedProjectTemplateFallback || resolution.usedProjectPolicyFallback,
    used_project_override: resolution.usedProjectOverride,
    package_version_id: packageMeta?.package_version_id ?? null,
    package_version_no: packageMeta?.package_version_no ?? null,
    warnings: resolution.warnings,
  };
}

export function resolvePromptMeta(
  project: Project | null,
  promptKey: string,
  packageMeta?: PackageMeta | null,
  resolution?: PromptResolutionState | null
): AIPromptMeta {
  // Phase 7-A: プロジェクト文脈なしの呼び出し（ペルソナタグ等）は legacy 扱い
  if (!project) {
    return {
      prompt_key: promptKey,
      template_key: null,
      template_mode: "legacy",
      policy_snapshot: null,
      resolution_json: resolution ? buildResolutionJson(resolution, packageMeta) : null,
    };
  }
  const templates = project.ai_prompt_templates_json as AIPromptTemplateMap | null | undefined;
  let base: AIPromptMeta;
  if (packageMeta) {
    // Phase F: パッケージ適用中は本文が BASE 由来でも常に package_template として記録する
    // （空Version / archived→published fallback など templates が null/疎なケースも確実に追跡）
    base = {
      prompt_key: promptKey,
      template_key: promptKey,
      template_mode: "package_template",
      policy_snapshot: (project.ai_prompt_policy_json as Record<string, unknown> | null) ?? null,
    };
  } else if (!templates) {
    base = { prompt_key: promptKey, template_key: null, template_mode: "legacy", policy_snapshot: null };
  } else {
    const entry = (templates as Record<string, { enabled?: boolean; template?: string } | undefined>)[promptKey];
    const isCustom = entry?.enabled !== false && typeof entry?.template === "string" && entry.template.trim() !== "";
    base = {
      prompt_key: promptKey,
      template_key: promptKey,
      template_mode: isCustom ? "custom_template" : "base_template",
      policy_snapshot: (project.ai_prompt_policy_json as Record<string, unknown> | null) ?? null,
    };
  }
  const resolutionJson = resolution ? buildResolutionJson(resolution, packageMeta) : null;
  if (packageMeta) {
    return {
      ...base,
      package_id: packageMeta.package_id,
      package_version_id: packageMeta.package_version_id,
      package_slug: packageMeta.package_slug,
      package_version_no: packageMeta.package_version_no,
      resolution_json: resolutionJson,
    };
  }
  return { ...base, resolution_json: resolutionJson };
}

function buildJapaneseSystemInstruction(purpose: string): string {
  return [
    "あなたはLINEインタビュー支援AIです。",
    "必ず日本語で出力してください。",
    "JSONを求められた場合はJSON以外を一切出力しないでください。",
    "過去の別案件や別セッションの文脈を混ぜてはいけません。",
    `purpose: ${purpose}`
  ].join("\n");
}

function collectJsonStringValues(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectJsonStringValues(item));
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap((item) => collectJsonStringValues(item));
  }
  return [];
}

function hasEnglishDominance(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }

  const englishWords = normalized.match(/[A-Za-z]{3,}/g) ?? [];
  const japaneseChars = normalized.match(/[ぁ-んァ-ン一-龠々ー]/g) ?? [];
  return englishWords.length >= 3 && englishWords.length > japaneseChars.length / 8;
}

function shouldRetryForJapanese(text: string, mode: "text" | "json_values"): boolean {
  if (mode === "text") {
    return hasEnglishDominance(text);
  }

  try {
    const parsed = parseJsonResponse<unknown>(text);
    return collectJsonStringValues(parsed).some((value) => hasEnglishDominance(value));
  } catch {
    return false;
  }
}

async function runTextPrompt(
  sessionId: string | null,
  purpose: string,
  prompt: string,
  options: {
    japaneseCheckMode?: "text" | "json_values" | "none";
  } = {},
  promptMeta?: AIPromptMeta
): Promise<AITextResult> {
  const japaneseCheckMode = options.japaneseCheckMode ?? "text";
  let finalText = "";
  let finalUsage: Record<string, unknown> | null = null;
  let finalPrompt = "";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    finalPrompt = [
      buildJapaneseSystemInstruction(purpose),
      attempt > 0
        ? "前回の出力に英語が混ざりました。今回は日本語だけで出力し直してください。"
        : "",
      prompt
    ]
      .filter(Boolean)
      .join("\n\n");

    const response = await openai.responses.create({
      model: env.OPENAI_MODEL,
      input: finalPrompt
    });

    finalText = response.output_text.trim();
    finalUsage = (response.usage as Record<string, unknown> | undefined) ?? null;
    if (japaneseCheckMode === "none" || !shouldRetryForJapanese(finalText, japaneseCheckMode)) {
      break;
    }
  }

  try {
    await aiLogRepository.create({
      session_id: sessionId,
      purpose,
      prompt: finalPrompt,
      response: finalText,
      token_usage: finalUsage,
      prompt_key: promptMeta?.prompt_key ?? null,
      template_key: promptMeta?.template_key ?? null,
      template_mode: promptMeta?.template_mode ?? null,
      policy_snapshot: promptMeta?.policy_snapshot ?? null,
      rendered_prompt: prompt,
      package_id: promptMeta?.package_id ?? null,
      package_version_id: promptMeta?.package_version_id ?? null,
      package_slug: promptMeta?.package_slug ?? null,
      package_version_no: promptMeta?.package_version_no ?? null,
      resolution_json: promptMeta?.resolution_json ?? null,
    });
  } catch (logError) {
    // ログ記録の失敗でAI応答自体を失わせない（投稿返信などユーザー向けフローを止めない）
    logger.warn("aiService: ai_logs write failed", {
      purpose,
      error: logError instanceof Error ? logError.message : String(logError)
    });
  }

  return {
    text: finalText,
    usage: finalUsage
  };
}

/**
 * OpenAI 呼び出しで投げられた例外を、管理画面で原因が分かる日本語メッセージに整形する。
 * 元の API メッセージも末尾に残す（API キー等の秘匿情報は OpenAI のエラー本文には含まれない）。
 * カテゴリ: [認証] / [モデル] / [API設定] / [レート制限] / [サーバー] / [ネットワーク] / [不明]
 */
export function describeOpenAIError(err: unknown): string {
  const e = (err ?? {}) as {
    status?: number;
    code?: string | null;
    type?: string | null;
    message?: string;
    name?: string;
  };
  const status = typeof e.status === "number" ? e.status : undefined;
  const code = e.code ?? undefined;
  const original = e.message || (typeof err === "string" ? err : String(err));
  const model = env.OPENAI_MODEL;
  const tail = ` 元のエラー: ${original}`;

  // ステータスを持たない＝接続/タイムアウト系（ネットワーク）
  if (status === undefined) {
    if (e.name === "APIConnectionTimeoutError" || /timeout/i.test(original)) {
      return `[ネットワーク] OpenAI への接続がタイムアウトしました。回線状況やプロキシ設定を確認してください。${tail}`;
    }
    return `[ネットワーク] OpenAI へ接続できませんでした。回線・DNS・プロキシ設定を確認してください。${tail}`;
  }

  if (status === 401) {
    return `[認証] OpenAI API キーが無効か失効しています（401 ${code ?? "invalid_api_key"}）。.env の OPENAI_API_KEY を確認してください。${tail}`;
  }
  if (status === 403) {
    return `[認証] この API キーでは許可されていない操作です（403 ${code ?? ""}）。組織・地域・モデルへのアクセス権限を確認してください。${tail}`;
  }
  if (status === 404 || code === "model_not_found") {
    return `[モデル] 指定モデル「${model}」が見つからない／このキーで利用できません（${status} ${code ?? ""}）。.env の OPENAI_MODEL を有効なモデル名に設定してください。${tail}`;
  }
  if (status === 429) {
    if (code === "insufficient_quota") {
      return `[API設定] OpenAI の利用枠（クォータ/残高）が不足しています（429 insufficient_quota）。請求設定を確認してください。${tail}`;
    }
    return `[レート制限] OpenAI のレート制限に達しました（429 ${code ?? ""}）。少し待って再実行してください。${tail}`;
  }
  if (status === 400 || status === 422) {
    return `[API設定] リクエストが不正としてモデル「${model}」に拒否されました（${status} ${code ?? ""}）。モデル名・パラメータ・プロンプト形式を確認してください。${tail}`;
  }
  if (status >= 500) {
    return `[サーバー] OpenAI 側で一時的なエラーが発生しました（${status} ${code ?? ""}）。時間をおいて再実行してください。${tail}`;
  }
  return `[不明] OpenAI 呼び出しに失敗しました（${status}${code ? ` ${code}` : ""}）。${tail}`;
}

function stripCodeFence(text: string): string {
  return text.replace(/^```(?:json)?\s*/u, "").replace(/\s*```$/u, "").trim();
}

function parseJsonResponse<T>(text: string): T {
  return JSON.parse(stripCodeFence(text)) as T;
}

function clampConfidence(value: unknown, fallback = 0.5): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }
  return Math.max(0, Math.min(1, numeric));
}

function sanitizeProbeType(value: unknown): StructuredProbeType | null {
  if (value === "missing_slot" || value === "concretize" || value === "clarify") {
    return value;
  }
  return null;
}

function sanitizeAction(value: unknown): AnswerAnalysisAction | null {
  if (value === "ask_next" || value === "probe" || value === "skip" || value === "finish") {
    return value;
  }
  return null;
}

function mergeSlotMaps(
  ...slotMaps: Array<Record<string, string | null | undefined> | null | undefined>
): Record<string, string | null> {
  return slotMaps.reduce<Record<string, string | null>>((accumulator, slotMap) => {
    if (!slotMap) {
      return accumulator;
    }

    for (const [key, value] of Object.entries(slotMap)) {
      if (typeof value === "string" && value.trim()) {
        accumulator[key] = value.trim();
      } else if (!(key in accumulator)) {
        accumulator[key] = null;
      }
    }

    return accumulator;
  }, {});
}

function isLikelyInternalSlotLabel(value: string): boolean {
  return /^[a-z][a-z0-9_]*$/i.test(value.trim());
}

function resolveUserFacingSlotLabel(input: {
  slotKey: string | null | undefined;
  question: Question;
  project: Project;
}): string {
  const meta = normalizeQuestionMeta(
    input.question,
    input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
    { projectAiState: input.project.ai_state_json }
  );
  const slot = meta.expected_slots.find((candidate) => candidate.key === input.slotKey);
  const label = slot?.label?.trim();

  if (label && !isLikelyInternalSlotLabel(label) && !hasEnglishDominance(label)) {
    return label;
  }
  if (slot?.description?.trim()) {
    return slot.description.trim();
  }
  return "その点";
}

function shouldRejectUserFacingQuestion(
  question: string,
  project: Project,
  slotKeys: string[]
): boolean {
  const normalized = question.trim();
  if (!normalized) {
    return false;
  }

  if (hasEnglishDominance(normalized)) {
    return true;
  }

  return slotKeys.some((slotKey) => {
    if (!slotKey) {
      return false;
    }
    return normalized.toLowerCase().includes(slotKey.toLowerCase());
  });
}

function buildFallbackProbeQuestion(input: {
  question: Question;
  missingSlots: string[];
  probeType: StructuredProbeType | null;
  project: Project;
}): string | null {
  if (!input.probeType) {
    return null;
  }

  const meta = normalizeQuestionMeta(
    input.question,
    input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
    { projectAiState: input.project.ai_state_json }
  );
  const firstMissingSlot = input.missingSlots[0];
  const slotLabel =
    meta.expected_slots.find((slot) => slot.key === firstMissingSlot)?.label ??
    firstMissingSlot ??
    "その点";

  switch (input.probeType) {
    case "missing_slot":
      return `${slotLabel}について、もう少し具体的に教えてください。`;
    case "clarify":
      return "今のご回答の意味が伝わるように、もう少し詳しく教えてください。";
    case "concretize":
      return "そのときの状況や理由がわかる具体例を1つ教えてください。";
    default:
      return null;
  }
}

function convertSlotMapToArray(slotMap: Record<string, string | null>): StructuredAnswerSlotValue[] {
  return Object.entries(slotMap).map(([key, value]) => ({
    key,
    value,
    confidence: value ? 0.8 : null,
    evidence: value
  }));
}

function buildAnswerExtractionPrompt(input: {
  project: Project;
  question: Question;
  answer: string;
  extractionConfig: QuestionExtractionConfig;
  ruleResult: NormalizedExtractionResult;
}): string {
  return [
    "You extract structured entities from one free-text answer.",
    "Return JSON only.",
    "Use the configured schema keys exactly.",
    "Keep the output concise and grounded only in the answer text.",
    "",
    `Project objective: ${input.project.objective ?? input.project.name}`,
    `Question: ${input.question.question_text}`,
    `Extraction config: ${JSON.stringify(input.extractionConfig)}`,
    `Rule result: ${JSON.stringify(input.ruleResult)}`,
    `Answer: ${input.answer}`,
    "",
    "Return this JSON shape:",
    JSON.stringify(
      {
        mode: input.extractionConfig.mode ?? "multi_object",
        status: "completed",
        method: "ai_assisted",
        target: input.extractionConfig.target ?? "post_answer",
        summary: {},
        entities: [{ index: 0, fields: {} }],
        missing_fields: [],
        needs_ai_assist: false
      },
      null,
      2
    )
  ].join("\n");
}

export const aiService = {
  async generateProjectInitialState(input: { project: Project }): Promise<ProjectAIState> {
    const template = getProjectAIStateTemplate(
      input.project.ai_state_template_key,
      input.project.research_mode
    );
    const { effectiveProject, packageMeta, resolution } = await resolveEffectiveProjectConfig(input.project);
    const prompt = buildProjectInitialStatePrompt({
      project: effectiveProject,
      template
    });
    const result = await runTextPrompt(null, "project_initial_state", prompt, {
      japaneseCheckMode: "none"
    }, resolvePromptMeta(effectiveProject, "buildProjectInitialStatePrompt", packageMeta, resolution));

    return normalizeProjectAIState(parseJsonResponse<ProjectAIState>(result.text), {
      fallbackTemplateKey: template.key,
      fallbackProject: input.project
    });
  },

  async renderQuestion(input: {
    sessionId: string;
    project: Project;
    question: Question;
    previousQuestionText?: string | null;
    previousAnswerText?: string | null;
  }): Promise<string> {
    const { effectiveProject, packageMeta, resolution } = await resolveEffectiveProjectConfig(input.project);
    const prompt = buildQuestionRenderingPrompt({ ...input, project: effectiveProject });

    try {
      const result = await runTextPrompt(input.sessionId, "question_render", prompt, {
        japaneseCheckMode: "text"
      }, resolvePromptMeta(effectiveProject, "buildQuestionRenderingPrompt", packageMeta, resolution));
      return (
        result.text.replace(/^["']|["']$/g, "") ||
        buildInterviewQuestionFallback({
          ...input,
          contextType:
            input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
          projectAiState: input.project.ai_state_json
        })
      );
    } catch {
      return buildInterviewQuestionFallback({
        ...input,
        contextType:
          input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
        projectAiState: input.project.ai_state_json
      });
    }
  },

  async analyzeAnswer(input: {
    sessionId: string;
    project: Project;
    question: Question;
    nextQuestion?: Question | null;
    answer: string;
    existingSlots: Record<string, string | null>;
    maxProbes: number;
    aiProbeEnabled: boolean;
    currentProbeCount: number;
  }): Promise<AnswerAnalysisResult> {
    const { effectiveProject, packageMeta, resolution } = await resolveEffectiveProjectConfig(input.project);
    const contextType =
      input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode;
    const projectAiState = getProjectAIState(input.project);
    const promptContext = resolveAnswerAnalysisContext({
      project: effectiveProject,
      question: input.question,
      nextQuestion: input.nextQuestion,
      contextType
    });
    const meta = normalizeQuestionMeta(input.question, contextType, {
      projectAiState: input.project.ai_state_json
    });
    const nextMeta =
      input.nextQuestion && meta.can_prefill_future_slots
        ? normalizeQuestionMeta(
            input.nextQuestion,
            input.nextQuestion.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
            { projectAiState: input.project.ai_state_json }
          )
        : null;
    const allowedKeys = new Set([
      ...meta.expected_slots.map((slot) => slot.key),
      ...(nextMeta?.expected_slots ?? []).map((slot) => slot.key),
      ...projectAiState.required_slots.map((slot) => slot.key),
      ...projectAiState.optional_slots.map((slot) => slot.key)
    ]);
    const prompt = buildAnalyzeAnswerPrompt({
      ...input,
      project: effectiveProject,
      maxProbes: input.maxProbes,
      aiProbeEnabled: input.aiProbeEnabled,
      currentProbeCount: input.currentProbeCount
    });

    const normalizeCollectedSlots = (rawValue: unknown): Record<string, string | null> => {
      const parsedSlots =
        rawValue && typeof rawValue === "object" && !Array.isArray(rawValue)
          ? (rawValue as Record<string, unknown>)
          : {};
      const filtered = Object.entries(parsedSlots).reduce<Record<string, string | null>>(
        (accumulator, [key, value]) => {
          if (allowedKeys.size > 0 && !allowedKeys.has(key)) {
            return accumulator;
          }
          accumulator[key] = typeof value === "string" && value.trim() ? value.trim() : null;
          return accumulator;
        },
        {}
      );

      return mergeSlotMaps(input.existingSlots, filtered);
    };

    const buildResult = (raw: {
      action?: unknown;
      question?: unknown;
      reason?: unknown;
      collected_slots?: unknown;
      is_sufficient?: unknown;
    } | null,
    confidenceFallback: number): AnswerAnalysisResult => {
      const collectedSlots = normalizeCollectedSlots(raw?.collected_slots);
      const extractedSlots = convertSlotMapToArray(collectedSlots);
      const assessment = assessProbeNeed({
        question: input.question,
        answerText: input.answer,
        extractedSlots,
        currentProbeCountForAnswer: input.currentProbeCount,
        contextType,
        projectAiState: input.project.ai_state_json
      });
      const completion = evaluateCompletion({
        question: input.question,
        answerText: input.answer,
        extractedSlots,
        contextType,
        projectAiState: input.project.ai_state_json
      });
      const currentQuestionSatisfied = completion.missing_slots.length === 0;
      const projectCompletion = evaluateProjectSlotCompletion(input.project, collectedSlots);
      const nextQuestionRequiredKeys =
        promptContext.next_question_required_slots.length > 0
          ? promptContext.next_question_required_slots.map((slot) => slot.key)
          : [];
      const nextQuestionSatisfied =
        nextQuestionRequiredKeys.length > 0 && nextQuestionRequiredKeys.every((key) => Boolean(collectedSlots[key]?.trim()));
      const canProbe = input.aiProbeEnabled && input.currentProbeCount < input.maxProbes && input.maxProbes > 0;
      const skipEligible =
        currentQuestionSatisfied &&
        nextQuestionSatisfied &&
        !assessment.isBadAnswer &&
        !assessment.isAbstract;
      const derivedSufficient =
        currentQuestionSatisfied &&
        !assessment.isBadAnswer &&
        !assessment.isAbstract;
      const parsedAction = sanitizeAction(raw?.action);
      const probeType = assessment.probeType;

      let action: AnswerAnalysisAction =
        projectCompletion.isComplete
          ? "finish"
          : canProbe && assessment.shouldProbe
            ? "probe"
            : skipEligible
              ? "skip"
              : "ask_next";
      const decisionPath = [`fallback:${action}`];

      if (parsedAction === "finish") {
        if (projectCompletion.isComplete) {
          action = "finish";
          decisionPath.push("ai:finish");
        } else {
          decisionPath.push("ai:finish_rejected");
        }
      } else if (parsedAction === "probe") {
        if (canProbe) {
          action = "probe";
          decisionPath.push("ai:probe");
        } else {
          decisionPath.push("ai:probe_rejected");
        }
      } else if (parsedAction === "skip") {
        if (skipEligible) {
          action = "skip";
          decisionPath.push("ai:skip");
        } else {
          decisionPath.push("ai:skip_rejected");
        }
      } else if (parsedAction === "ask_next") {
        action = "ask_next";
        decisionPath.push("ai:ask_next");
      } else {
        decisionPath.push("ai:missing_action");
      }

      const rawQuestion =
        typeof raw?.question === "string" && raw.question.trim() ? raw.question.trim() : null;
      const safeQuestion =
        action === "probe" && rawQuestion && !shouldRejectUserFacingQuestion(rawQuestion, input.project, Array.from(allowedKeys))
          ? rawQuestion
          : action === "probe"
            ? buildFallbackProbeQuestion({
                question: input.question,
                missingSlots: assessment.missingSlots,
                probeType: canProbe ? probeType : null,
                project: input.project
              })
            : null;
      const reason =
        typeof raw?.reason === "string" && raw.reason.trim()
          ? raw.reason.trim()
          : projectCompletion.isComplete
            ? "project_required_slots_filled"
            : action === "probe"
              ? assessment.missingSlots.length > 0
                ? `missing_slots:${assessment.missingSlots.join(",")}`
                : "insufficient_answer"
              : action === "skip"
                ? "current_and_next_required_slots_filled"
                : "continue_to_next_question";

      if (env.NODE_ENV === "development") {
        logger.info("analyzeAnswer.decision_path", {
          sessionId: input.sessionId,
          questionCode: input.question.question_code,
          action,
          decisionPath,
          projectCompletion: projectCompletion.isComplete,
          currentQuestionSatisfied,
          nextQuestionSatisfied,
          canProbe,
          assessment: {
            shouldProbe: assessment.shouldProbe,
            missingSlots: assessment.missingSlots,
            isBadAnswer: assessment.isBadAnswer,
            isAbstract: assessment.isAbstract
          }
        });
      }

      return {
        action,
        question: safeQuestion,
        reason,
        collected_slots: collectedSlots,
        is_sufficient: Boolean(raw?.is_sufficient) || derivedSufficient,
        missing_slots: completion.missing_slots,
        probe_type: action === "probe" && canProbe ? probeType : null,
        confidence: clampConfidence((raw as { confidence?: unknown } | null)?.confidence, confidenceFallback)
      };
    };

    if (env.NODE_ENV === "development") {
      logger.info("analyzeAnswer.input", {
        sessionId: input.sessionId,
        questionCode: input.question.question_code,
        project_goal: promptContext.project_goal,
        current_question: input.question.question_text,
        user_answer: input.answer,
        required_slots: promptContext.required_slots.map((slot) => slot.key),
        optional_slots: promptContext.optional_slots.map((slot) => slot.key),
        existing_slots: input.existingSlots,
        max_probes: input.maxProbes,
        ai_probe_enabled: input.aiProbeEnabled,
        current_probe_count: input.currentProbeCount
      });
    }

    try {
      const result = await runTextPrompt(input.sessionId, "answer_analysis", prompt, {
        japaneseCheckMode: "json_values"
      }, resolvePromptMeta(effectiveProject, "buildAnalyzeAnswerPrompt", packageMeta, resolution));
      const parsed = parseJsonResponse<{
        action?: unknown;
        question?: unknown;
        reason?: unknown;
        collected_slots?: unknown;
        is_sufficient?: unknown;
        confidence?: unknown;
      }>(result.text);
      const normalized = buildResult(parsed, 0.7);

      if (env.NODE_ENV === "development") {
        logger.info("analyzeAnswer.output", {
          sessionId: input.sessionId,
          action: normalized.action,
          question: normalized.question,
          reason: normalized.reason,
          collected_slots: normalized.collected_slots,
          is_sufficient: normalized.is_sufficient
        });
      }

      return normalized;
    } catch (error) {
      const heuristic = buildHeuristicStructuredPayload({
        question: input.question,
        answerText: input.answer,
        source: input.currentProbeCount > 0 ? "ai_probe" : "primary",
        contextType,
        projectAiState: input.project.ai_state_json
      });
      const heuristicSlots = (heuristic.extracted_slots ?? []).reduce<Record<string, string | null>>(
        (accumulator, slot) => {
          accumulator[slot.key] = slot.value ?? null;
          return accumulator;
        },
        {}
      );
      const normalized = buildResult(
        {
          action: null,
          question: null,
          reason: "fallback_after_parse_error",
          collected_slots: mergeSlotMaps(input.existingSlots, heuristicSlots),
          is_sufficient: false
        },
        0.45
      );

      if (env.NODE_ENV === "development") {
        logger.warn("analyzeAnswer.fallback", {
          sessionId: input.sessionId,
          error: error instanceof Error ? error.message : String(error),
          action: normalized.action,
          collected_slots: normalized.collected_slots
        });
      }

      return normalized;
    }
  },

  async extractAnswerEntities(input: {
    sessionId: string;
    project: Project;
    question: Question;
    answer: string;
    extractionConfig: QuestionExtractionConfig;
    ruleResult: NormalizedExtractionResult;
  }): Promise<NormalizedExtractionResult | null> {
    const prompt = buildAnswerExtractionPrompt(input);

    try {
      const result = await runTextPrompt(input.sessionId, "answer_extraction", prompt, {
        japaneseCheckMode: "json_values"
      });
      const parsed = parseJsonResponse<Partial<NormalizedExtractionResult>>(result.text);

      return {
        mode:
          parsed.mode === "single_object" || parsed.mode === "multi_object" || parsed.mode === "none"
            ? parsed.mode
            : input.extractionConfig.mode ?? input.ruleResult.mode,
        status:
          parsed.status === "completed" ||
          parsed.status === "partial" ||
          parsed.status === "pending" ||
          parsed.status === "failed" ||
          parsed.status === "skipped"
            ? parsed.status
            : input.ruleResult.status,
        method: "ai_assisted",
        target:
          parsed.target === "post_answer" || parsed.target === "post_session"
            ? parsed.target
            : input.extractionConfig.target ?? input.ruleResult.target,
        schema_version:
          typeof parsed.schema_version === "string" ? parsed.schema_version : input.ruleResult.schema_version ?? null,
        summary:
          parsed.summary && typeof parsed.summary === "object" && !Array.isArray(parsed.summary)
            ? (parsed.summary as Record<string, unknown>)
            : input.ruleResult.summary,
        entities: Array.isArray(parsed.entities)
          ? parsed.entities
              .map((entity, index) => {
                const fields =
                  entity && typeof entity === "object" && "fields" in entity && entity.fields && typeof entity.fields === "object"
                    ? (entity.fields as Record<string, string | number | boolean | null>)
                    : {};
                return {
                  index:
                    entity && typeof entity === "object" && "index" in entity && typeof entity.index === "number"
                      ? entity.index
                      : index,
                  fields
                };
              })
          : input.ruleResult.entities,
        missing_fields: Array.isArray(parsed.missing_fields)
          ? parsed.missing_fields.map((item) => String(item))
          : input.ruleResult.missing_fields,
        needs_ai_assist:
          typeof parsed.needs_ai_assist === "boolean" ? parsed.needs_ai_assist : false,
        extracted_at: new Date().toISOString()
      };
    } catch {
      return null;
    }
  },

  async generateProbeQuestion(input: {
    sessionId: string;
    project: Project;
    question: string;
    answer: string;
    sessionSummary: string;
  }): Promise<string> {
    const { effectiveProject, packageMeta, resolution } = await resolveEffectiveProjectConfig(input.project);
    const prompt = buildProbePrompt({ ...input, project: effectiveProject });
    const result = await runTextPrompt(input.sessionId, "probe_generation", prompt, {
      japaneseCheckMode: "text"
    }, resolvePromptMeta(effectiveProject, "buildProbePrompt", packageMeta, resolution));
    return result.text.replace(/^["']|["']$/g, "");
  },

  async interviewTurn(input: {
    sessionId: string;
    project: Project;
    question: Question;
    answer: string;
    nextQuestion?: Question | null;
    existingSlots: Record<string, string | null>;
    currentProbeCount: number;
    maxProbes: number;
    aiProbeEnabled: boolean;
    conversationSummary?: string | null;
  }): Promise<{
    action: AnswerAnalysisAction;
    response_text: string | null;
    collected_slots: Record<string, string | null>;
    reason: string;
  }> {
    const { effectiveProject, packageMeta, resolution } = await resolveEffectiveProjectConfig(input.project);
    const prompt = buildInterviewTurnPrompt({ ...input, project: effectiveProject });

    try {
      const result = await runTextPrompt(input.sessionId, "interview_turn", prompt, {
        japaneseCheckMode: "json_values"
      }, resolvePromptMeta(effectiveProject, "buildInterviewTurnPrompt", packageMeta, resolution));
      const parsed = parseJsonResponse<{
        action?: unknown;
        response_text?: unknown;
        collected_slots?: unknown;
        reason?: unknown;
      }>(result.text);

      const action = sanitizeAction(parsed.action) ?? "ask_next";
      const responseText =
        typeof parsed.response_text === "string" && parsed.response_text.trim()
          ? parsed.response_text.trim()
          : null;
      const rawSlots =
        parsed.collected_slots && typeof parsed.collected_slots === "object" && !Array.isArray(parsed.collected_slots)
          ? (parsed.collected_slots as Record<string, unknown>)
          : {};
      const collectedSlots = Object.entries(rawSlots).reduce<Record<string, string | null>>(
        (acc, [key, value]) => {
          acc[key] = typeof value === "string" && value.trim() ? value.trim() : null;
          return acc;
        },
        {}
      );

      return {
        action,
        response_text: responseText,
        collected_slots: mergeSlotMaps(input.existingSlots, collectedSlots),
        reason: typeof parsed.reason === "string" ? parsed.reason : action
      };
    } catch {
      return {
        action: "ask_next",
        response_text: null,
        collected_slots: input.existingSlots,
        reason: "fallback_parse_error"
      };
    }
  },

  /**
   * Phase 6-F: 現在呼び出し元なし（休眠）だが意図的に温存。
   * buildProbeGenerationPrompt はプロンプトパッケージの管理対象10テンプレートの1つであり、
   * 構造化深掘りフローを再有効化する際にこのメソッドが入口になるため削除しない。
   */
  async generateStructuredProbe(input: {
    sessionId: string;
    project: Project;
    question: Question;
    answer: string;
    extractedSlots: StructuredAnswerSlotValue[];
    completion: StructuredAnswerCompletion | null;
    probeType: StructuredProbeType;
    missingSlots: string[];
    previousAnswerText?: string | null;
    sessionSummary: string;
  }): Promise<{
    probe_question: string;
    probe_type: StructuredProbeType;
    focus: string;
  }> {
    const { effectiveProject, packageMeta, resolution } = await resolveEffectiveProjectConfig(input.project);
    const prompt = buildProbeGenerationPrompt({ ...input, project: effectiveProject });
    const result = await runTextPrompt(input.sessionId, "structured_probe_generation", prompt, {
      japaneseCheckMode: "json_values"
    }, resolvePromptMeta(effectiveProject, "buildProbeGenerationPrompt", packageMeta, resolution));
    const parsed = parseJsonResponse<{
      probe_question?: string;
      probe_type?: StructuredProbeType;
      focus?: string;
    }>(result.text);

    return {
      probe_question: String(parsed.probe_question ?? "").trim(),
      probe_type: parsed.probe_type ?? input.probeType,
      focus: String(parsed.focus ?? "").trim()
    };
  },

  /**
   * Phase 6-F: 現在呼び出し元なし（休眠）だが意図的に温存。
   * buildSlotFillingPrompt はプロンプトパッケージの管理対象10テンプレートの1つであり、
   * スロット構造化抽出フローを再有効化する際にこのメソッドが入口になるため削除しない。
   */
  async fillAnswerSlots(input: {
    sessionId: string;
    project: Project;
    question: Question;
    answer: string;
    probeAnswer?: string | null;
    source: string;
    reason?: string | null;
    probeType?: StructuredProbeType | null;
  }): Promise<StructuredAnswerPayload> {
    const { effectiveProject, packageMeta, resolution } = await resolveEffectiveProjectConfig(input.project);
    const prompt = buildSlotFillingPrompt({ ...input, project: effectiveProject });

    try {
      const result = await runTextPrompt(input.sessionId, "slot_filling", prompt, {
        japaneseCheckMode: "json_values"
      }, resolvePromptMeta(effectiveProject, "buildSlotFillingPrompt", packageMeta, resolution));
      const parsed = parseJsonResponse<{
        structured_summary?: string;
        extracted_slots?: StructuredAnswerSlotValue[];
        comparable_payload?: Record<string, string | string[] | null>;
      }>(result.text);
      const extractedSlots = Array.isArray(parsed.extracted_slots) ? parsed.extracted_slots : [];
      const completion = evaluateCompletion({
        question: input.question,
        answerText: [input.answer, input.probeAnswer].filter(Boolean).join("\n"),
        extractedSlots,
        contextType:
          input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
        projectAiState: input.project.ai_state_json
      });

      return {
        ...buildHeuristicStructuredPayload({
          question: input.question,
          answerText: [input.answer, input.probeAnswer].filter(Boolean).join("\n"),
          source: input.source,
          reason: input.reason,
          probeType: input.probeType,
          contextType:
            input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
          projectAiState: input.project.ai_state_json
        }),
        structured_summary: parsed.structured_summary?.trim() || null,
        extracted_slots: extractedSlots,
        comparable_payload: parsed.comparable_payload ?? undefined,
        completion
      };
    } catch {
      return buildHeuristicStructuredPayload({
        question: input.question,
        answerText: [input.answer, input.probeAnswer].filter(Boolean).join("\n"),
        source: input.source,
        reason: input.reason,
        probeType: input.probeType,
        contextType:
          input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
        projectAiState: input.project.ai_state_json
      });
    }
  },

  /**
   * Phase 6-F: 現在呼び出し元なし（休眠）だが意図的に温存。
   * buildCompletionCheckPrompt はプロンプトパッケージの管理対象10テンプレートの1つであり、
   * 完了チェックフローを再有効化する際にこのメソッドが入口になるため削除しない。
   */
  async checkAnswerCompletion(input: {
    sessionId: string;
    project: Project;
    question: Question;
    answer: string;
    extractedSlots: StructuredAnswerSlotValue[];
  }): Promise<StructuredAnswerCompletion> {
    const { effectiveProject, packageMeta, resolution } = await resolveEffectiveProjectConfig(input.project);
    const prompt = buildCompletionCheckPrompt({ ...input, project: effectiveProject });

    try {
      const result = await runTextPrompt(input.sessionId, "completion_check", prompt, {
        japaneseCheckMode: "json_values"
      }, resolvePromptMeta(effectiveProject, "buildCompletionCheckPrompt", packageMeta, resolution));
      const parsed = parseJsonResponse<{
        is_complete?: boolean;
        missing_slots?: string[];
        reasons?: string[];
        quality_score?: number;
      }>(result.text);

      return evaluateCompletion({
        question: input.question,
        answerText: input.answer,
        extractedSlots: input.extractedSlots,
        contextType:
          input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
        projectAiState: input.project.ai_state_json,
        qualityScore:
          typeof parsed.quality_score === "number" && Number.isFinite(parsed.quality_score)
            ? parsed.quality_score
            : null
      });
    } catch {
      return evaluateCompletion({
        question: input.question,
        answerText: input.answer,
        extractedSlots: input.extractedSlots,
        contextType:
          input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
        projectAiState: input.project.ai_state_json
      });
    }
  },

  async summarizeSession(input: {
    sessionId: string;
    project: Project;
    previousSummary: string;
    recentTranscript: string;
  }): Promise<string> {
    const { effectiveProject, packageMeta, resolution } = await resolveEffectiveProjectConfig(input.project);
    const prompt = buildSessionSummaryPrompt({ ...input, project: effectiveProject });
    const result = await runTextPrompt(input.sessionId, "session_summary", prompt, {
      japaneseCheckMode: "text"
    }, resolvePromptMeta(effectiveProject, "buildSessionSummaryPrompt", packageMeta, resolution));
    return result.text;
  },

  async finalAnalyze(input: {
    sessionId: string;
    project: Project;
    sessionSummary: string;
    answers: Array<{
      question_code: string;
      question_text: string;
      answer_text: string;
      normalized_answer: Record<string, unknown> | null;
    }>;
  }): Promise<Record<string, unknown>> {
    const { effectiveProject, packageMeta, resolution } = await resolveEffectiveProjectConfig(input.project);
    const prompt = buildFinalStructuredSummaryPrompt({ ...input, project: effectiveProject });

    try {
      const result = await runTextPrompt(input.sessionId, "final_structured_summary", prompt, {
        japaneseCheckMode: "json_values"
      }, resolvePromptMeta(effectiveProject, "buildFinalStructuredSummaryPrompt", packageMeta, resolution));
      return parseJsonResponse<Record<string, unknown>>(result.text);
    } catch {
      const fallbackPrompt = buildFinalAnalysisPrompt({
        project: effectiveProject,
        sessionSummary: input.sessionSummary,
        answers: input.answers
          .map((answer) => `${answer.question_code}: ${answer.answer_text}`)
          .join("\n")
      });
      const fallback = await runTextPrompt(input.sessionId, "final_analysis", fallbackPrompt, {
        japaneseCheckMode: "json_values"
      }, resolvePromptMeta(effectiveProject, "buildFinalAnalysisPrompt", packageMeta, resolution));
      return parseJsonResponse<Record<string, unknown>>(fallback.text);
    }
  },

  async generateProjectAnalysis(input: {
    project: Project;
    respondentSummaries: Array<{
      respondent_id: string;
      respondent_name: string;
      line_user_id: string;
      session_id: string;
      session_status: string;
      completed_at: string | null;
      summary: string;
    }>;
    comparisonUnits: Array<{
      question_code: string;
      question_order: number;
      question_text: string;
      question_role: string;
      question_type: string;
      aggregation_type: string;
      response_count: number;
      values: Array<{ label: string; count: number }>;
      note: string;
    }>;
    freeAnswerPolicy: {
      policy: string;
      target_question_codes: string[];
    };
  }): Promise<Record<string, unknown>> {
    const { effectiveProject, packageMeta, resolution } = await resolveEffectiveProjectConfig(input.project);
    const prompt = buildProjectAnalysisPrompt({ ...input, project: effectiveProject });
    const result = await runTextPrompt(null, "project_analysis", prompt, {
      japaneseCheckMode: "none"
    }, resolvePromptMeta(effectiveProject, "buildProjectAnalysisPrompt", packageMeta, resolution));

    return JSON.parse(result.text) as Record<string, unknown>;
  },

  async analyzePost(input: {
    postId: string;
    postType: string;
    sourceMode: string | null;
    content: string;
    /** Phase 7-A: 投稿がプロジェクトに紐づく場合のテンプレート解決用 */
    project?: Project | null;
    /** Phase 7-A: 投稿がセッションに紐づく場合の ai_logs 記録用 */
    sessionId?: string | null;
  }): Promise<{
    summary?: string;
    tags?: string[];
    sentiment?: "positive" | "neutral" | "negative" | "mixed";
    keywords?: string[];
    actionability?: "high" | "medium" | "low";
    insight_type?: "issue" | "request" | "complaint" | "praise" | "other" | string;
    specificity?: number;
    novelty?: number;
  }> {
    const { effectiveProject, packageMeta, resolution } = input.project
      ? await resolveEffectiveProjectConfig(input.project)
      : { effectiveProject: null, packageMeta: null, resolution: LEGACY_RESOLUTION };
    const prompt = buildPostAnalysisPrompt({ ...input, project: effectiveProject });
    const result = await runTextPrompt(input.sessionId ?? null, "post_analysis", prompt, {
      japaneseCheckMode: "none"
    }, resolvePromptMeta(effectiveProject, "buildPostAnalysisPrompt", packageMeta, resolution));
    return JSON.parse(result.text) as {
      summary?: string;
      tags?: string[];
      sentiment?: "positive" | "neutral" | "negative" | "mixed";
      keywords?: string[];
      actionability?: "high" | "medium" | "low";
      insight_type?: "issue" | "request" | "complaint" | "praise" | "other" | string;
      specificity?: number;
      novelty?: number;
    };
  },

  // ============================================================
  // Phase 2-C: 愚痴・日記拡張分析 / AIタグ生成
  // ============================================================

  async analyzeRantExtended(
    content: string,
    options?: { project?: Project | null; sessionId?: string | null }
  ): Promise<{
    rant_category: string;
    severity: number;
    danger_flag: boolean;
    top_phrases: string[];
  } | null> {
    try {
      const { effectiveProject, packageMeta, resolution } = options?.project
        ? await resolveEffectiveProjectConfig(options.project)
        : { effectiveProject: null, packageMeta: null, resolution: LEGACY_RESOLUTION };
      const prompt = buildRantExtendedPrompt(content, effectiveProject);
      const result = await runTextPrompt(options?.sessionId ?? null, "rant_extended_analysis", prompt, {
        japaneseCheckMode: "none"
      }, resolvePromptMeta(effectiveProject, "buildRantExtendedPrompt", packageMeta, resolution));
      return parseJsonResponse<{
        rant_category: string;
        severity: number;
        danger_flag: boolean;
        top_phrases: string[];
      }>(result.text);
    } catch {
      return null;
    }
  },

  async analyzeDiaryExtended(
    content: string,
    options?: { project?: Project | null; sessionId?: string | null }
  ): Promise<{
    mood_score: number;
    topic_categories: string[];
    behavior_signals: string[];
  } | null> {
    try {
      const { effectiveProject, packageMeta, resolution } = options?.project
        ? await resolveEffectiveProjectConfig(options.project)
        : { effectiveProject: null, packageMeta: null, resolution: LEGACY_RESOLUTION };
      const prompt = buildDiaryExtendedPrompt(content, effectiveProject);
      const result = await runTextPrompt(options?.sessionId ?? null, "diary_extended_analysis", prompt, {
        japaneseCheckMode: "none"
      }, resolvePromptMeta(effectiveProject, "buildDiaryExtendedPrompt", packageMeta, resolution));
      return parseJsonResponse<{
        mood_score: number;
        topic_categories: string[];
        behavior_signals: string[];
      }>(result.text);
    } catch {
      return null;
    }
  },

  async generateRantCounselorReply(
    postText: string,
    tagLabels: string[],
    options?: { project?: Project | null; sessionId?: string | null }
  ): Promise<string | null> {
    if (!postText.trim()) {
      return null;
    }
    try {
      const { effectiveProject, packageMeta, resolution } = options?.project
        ? await resolveEffectiveProjectConfig(options.project)
        : { effectiveProject: null, packageMeta: null, resolution: LEGACY_RESOLUTION };
      const prompt = buildRantCounselorReplyPrompt(postText, tagLabels, effectiveProject);
      const result = await runTextPrompt(options?.sessionId ?? null, "rant_counselor_reply", prompt, {
        japaneseCheckMode: "none"
      }, resolvePromptMeta(effectiveProject, "buildRantCounselorReplyPrompt", packageMeta, resolution));
      return result.text || null;
    } catch {
      return null;
    }
  },

  /**
   * 管理画面の生 AI 実行ヘルパー（プロンプトプレビュー / 深掘りプレイグラウンド /
   * 振る舞いプレビュー）。本番会話と同じ Responses API + env.OPENAI_MODEL を使い、
   * 「そのモデルが実際に返す生応答」をそのまま見せるのが用途。
   *
   * Chat Completions ではなく Responses API を使う理由:
   * - OPENAI_MODEL は gpt-5 系（reasoning モデル）想定で、本番の会話パイプライン
   *   （runTextPrompt）も Responses API を使う。管理画面で本番同等の挙動を再現したい。
   * - 管理ツール系の JSON 強制呼び出し（runAdminToolPrompt）とは用途が別。あちらは
   *   response_format:json_object が必要なため Chat Completions + OPENAI_TOOL_MODEL を使う。
   *
   * エラーは握りつぶさず、原因カテゴリ（認証 / モデル / API設定 / レート制限 /
   * レスポンス形式 / ネットワーク）が分かる日本語メッセージに整形して throw する。
   */
  async callRaw(input: { prompt: string }): Promise<{ content: string | null; tokenUsage: Record<string, unknown> | null }> {
    let response: Awaited<ReturnType<typeof openai.responses.create>>;
    try {
      response = await openai.responses.create({
        model: env.OPENAI_MODEL,
        input: input.prompt
      });
    } catch (err) {
      throw new Error(describeOpenAIError(err));
    }

    const content = response.output_text?.trim() ?? null;
    if (!content) {
      // 応答は返ったが本文が空 = レスポンス形式の問題。gpt-5 系では reasoning が
      // 出力上限を食い尽くして status:incomplete になるケースがあるため理由も添える。
      const status = (response as { status?: string }).status;
      const reason = (response as { incomplete_details?: { reason?: string } }).incomplete_details?.reason;
      const detail =
        status === "incomplete"
          ? `status=incomplete${reason ? `, reason=${reason}` : ""}（出力トークン上限に達した可能性があります）`
          : `status=${status ?? "不明"}`;
      throw new Error(
        `[レスポンス形式] モデル(${env.OPENAI_MODEL})が空の応答を返しました（${detail}）。`
      );
    }

    return {
      content,
      tokenUsage: (response.usage as Record<string, unknown> | undefined) ?? null
    };
  },

  async generateUserPersonaTags(
    analyses: { summary: string | null; tags: unknown[]; sentiment: string }[],
    options?: { project?: Project | null; sessionId?: string | null }
  ): Promise<{ tags: string[]; persona_summary: string } | null> {
    if (analyses.length === 0) {
      return null;
    }
    try {
      const { effectiveProject, packageMeta, resolution } = options?.project
        ? await resolveEffectiveProjectConfig(options.project)
        : { effectiveProject: null, packageMeta: null, resolution: LEGACY_RESOLUTION };
      const prompt = buildPersonaTagsPrompt(analyses, effectiveProject);
      const result = await runTextPrompt(options?.sessionId ?? null, "persona_tag_generation", prompt, {
        japaneseCheckMode: "none"
      }, resolvePromptMeta(effectiveProject, "buildPersonaTagsPrompt", packageMeta, resolution));
      return parseJsonResponse<{ tags: string[]; persona_summary: string }>(result.text);
    } catch {
      return null;
    }
  }
};

// ---------------------------------------------------------------------------
// Phase 7-B: 管理ツール系 AI 呼び出し（adminController / missingAttributeService）
// chat.completions API + json_object format + OPENAI_TOOL_MODEL を使用する。
// runTextPrompt とは別経路だが ai_logs への記録形式は同一。
// ---------------------------------------------------------------------------

export interface AdminToolPromptParams {
  /** ai_logs.purpose に記録する用途識別子 */
  purpose: string;
  /** chat.completions system メッセージ。undefined なら system なし */
  systemPrompt: string | undefined;
  /** chat.completions user メッセージ */
  userPrompt: string;
  maxTokens: number;
  temperature: number;
  promptKey: string;
  templateMode: "legacy" | "base_template" | "custom_template";
  /** ai_logs.rendered_prompt に保存するレンダリング済みユーザープロンプト */
  renderedPrompt: string;
}

/**
 * 管理ツール系 AI 呼び出し（設問生成・フロー流用・属性提案）を実行し ai_logs に記録する。
 * - モデルは env.OPENAI_TOOL_MODEL（デフォルト gpt-4o-mini）を使用
 * - response_format: json_object 固定
 * - ログ書き込み失敗でも AI 応答自体は返す
 */
export async function runAdminToolPrompt(params: AdminToolPromptParams): Promise<string> {
  const messages: Array<{ role: "system" | "user"; content: string }> = [];
  if (params.systemPrompt) {
    messages.push({ role: "system", content: params.systemPrompt });
  }
  messages.push({ role: "user", content: params.userPrompt });

  // gpt-5 系 reasoning モデルは chat.completions で max_tokens と temperature(≠1) を
  // 受け付けない（max_completion_tokens が必須）。OPENAI_TOOL_MODEL の設定値だけで
  // 管理ツール系 AI が全滅しないよう、モデル系統でパラメータを切り替える。
  const isGpt5Family = /^gpt-5/.test(env.OPENAI_TOOL_MODEL);
  const response = await openai.chat.completions.create({
    model: env.OPENAI_TOOL_MODEL,
    messages,
    response_format: { type: "json_object" },
    ...(isGpt5Family
      ? {
          // reasoning トークンが出力予算を食い潰して本文が空にならないよう余裕を持たせる。
          // reasoning_effort は世代間の共通値 "low" を使う（"minimal" は gpt-5.4 で不可、
          // "none" は初代 gpt-5 で不可）。
          max_completion_tokens: params.maxTokens + 1024,
          reasoning_effort: "low" as const,
        }
      : {
          temperature: params.temperature,
          max_tokens: params.maxTokens,
        }),
  });

  const text = response.choices[0]?.message?.content ?? "{}";
  const usage = (response.usage as Record<string, unknown> | undefined) ?? null;

  // ai_logs に記録（失敗してもレスポンスは返す）
  try {
    const loggedPrompt = params.systemPrompt
      ? `${params.systemPrompt}\n\n${params.userPrompt}`
      : params.userPrompt;
    await aiLogRepository.create({
      session_id: null,
      purpose: params.purpose,
      prompt: loggedPrompt,
      response: text,
      token_usage: usage,
      prompt_key: params.promptKey,
      template_key: params.templateMode !== "legacy" ? params.promptKey : null,
      template_mode: params.templateMode,
      policy_snapshot: null,
      rendered_prompt: params.renderedPrompt,
      package_id: null,
      package_version_id: null,
      package_slug: null,
      package_version_no: null,
    });
  } catch (logError) {
    logger.warn("runAdminToolPrompt: ai_logs write failed", {
      purpose: params.purpose,
      error: logError instanceof Error ? logError.message : String(logError),
    });
  }

  return text;
}

// ---------------------------------------------------------------------------
// 管理画面AIチャット: tool-calling 対応の1ターン呼び出し
// （docs/impl-admin-ai-chat.md Phase 1）
//
// runAdminToolPrompt との違いは response_format を使わず tools を渡す点だけで、
// モデル（OPENAI_TOOL_MODEL）と gpt-5 系のパラメータ分岐は同じものを使う。
// ai_logs への記録は会話全体をまとめて adminChatService 側で行うため、ここではしない。
// ---------------------------------------------------------------------------

/** chat.completions のメッセージ（tool ロールを含む）。SDK 型に依存せず扱う */
export type AdminChatMessage = Record<string, unknown>;

export interface AdminToolChatResult {
  /** アシスタントのメッセージ（tool_calls を含みうる）。そのまま履歴に積める形 */
  message: Record<string, unknown>;
  content: string | null;
  toolCalls: Array<{ id: string; name: string; argumentsJson: string }>;
  tokenUsage: Record<string, unknown> | null;
}

export async function runAdminToolChat(params: {
  messages: AdminChatMessage[];
  tools: Array<Record<string, unknown>>;
  maxTokens?: number;
  temperature?: number;
}): Promise<AdminToolChatResult> {
  const maxTokens = params.maxTokens ?? 1200;
  const model = env.ADMIN_CHAT_MODEL || env.OPENAI_TOOL_MODEL;
  const isGpt5Family = /^gpt-5/.test(model);

  const response = await openai.chat.completions.create({
    model,
    // biome-ignore lint/suspicious/noExplicitAny: SDK の厳密なメッセージ型に合わせるとツール履歴の受け渡しが煩雑になるため
    messages: params.messages as any,
    // biome-ignore lint/suspicious/noExplicitAny: 同上（tools は JSON Schema をそのまま渡す）
    ...(params.tools.length > 0 ? { tools: params.tools as any, tool_choice: "auto" as const } : {}),
    ...(isGpt5Family
      ? {
          max_completion_tokens: maxTokens + 1024,
          reasoning_effort: "low" as const,
        }
      : {
          temperature: params.temperature ?? 0.3,
          max_tokens: maxTokens,
        }),
  });

  const message = (response.choices[0]?.message ?? {}) as Record<string, unknown>;
  const rawToolCalls = (message["tool_calls"] as Array<Record<string, unknown>> | undefined) ?? [];
  const toolCalls = rawToolCalls
    .map((call) => {
      const fn = call["function"] as Record<string, unknown> | undefined;
      return {
        id: String(call["id"] ?? ""),
        name: String(fn?.["name"] ?? ""),
        argumentsJson: String(fn?.["arguments"] ?? "{}"),
      };
    })
    .filter((call) => call.id !== "" && call.name !== "");

  return {
    message,
    content: (message["content"] as string | null) ?? null,
    toolCalls,
    tokenUsage: (response.usage as Record<string, unknown> | undefined) ?? null,
  };
}
