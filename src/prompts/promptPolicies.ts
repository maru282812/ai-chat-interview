/**
 * promptPolicies.ts
 *
 * AIプロンプトポリシーのキー定義・説明文・解決ロジック。
 *
 * 既存ルール（max_probes / ai_probe_enabled / 日本語のみ / 内部コード非表示 / 捏造禁止 等）は
 * researchPrompts.ts 側で維持しており、ここで上書きしない。
 * ここのポリシーは補助方針として既存プロンプトに追加するもの。
 */

import type { AIPromptPolicy, Project } from "../types/domain";

// ────────────────────────────────────────────────
// ポリシーキー定義
// ────────────────────────────────────────────────

export const RESEARCH_TYPE_OPTIONS = [
  { key: "standard_research",    label: "標準リサーチ" },
  { key: "interview_research",   label: "インタビューリサーチ" },
  { key: "survey_interview",     label: "サーベイ+インタビュー" },
  { key: "exploratory_research", label: "探索的リサーチ" }
] as const;

export const AUDIENCE_OPTIONS = [
  { key: "general",          label: "一般（指定なし）" },
  { key: "female_friendly",  label: "女性向け（丁寧・共感重視）" },
  { key: "young_casual",     label: "若年層（カジュアル）" },
  { key: "business",         label: "ビジネス層（フォーマル）" },
  { key: "senior_friendly",  label: "シニア向け（わかりやすく）" }
] as const;

export const PROBE_STYLE_OPTIONS = [
  { key: "standard",             label: "標準" },
  { key: "reason_and_scene",     label: "理由・場面を引き出す" },
  { key: "comparison",           label: "比較・違いを引き出す" },
  { key: "emotion_and_context",  label: "感情・背景を引き出す" },
  { key: "decision_process",     label: "判断プロセスを引き出す" }
] as const;

export const NONE_ANSWER_POLICY_OPTIONS = [
  { key: "default",           label: "デフォルト（既存ルール）" },
  { key: "accept",            label: "そのまま受け入れる" },
  { key: "retry_once_softly", label: "一度だけやさしく再確認" },
  { key: "ask_for_small_hint", label: "小さなヒントを求める" }
] as const;

export const AMBIGUOUS_ANSWER_RULE_OPTIONS = [
  { key: "default",           label: "デフォルト（既存ルール）" },
  { key: "ask_clarification", label: "具体化を求める" },
  { key: "accept_and_note",   label: "受け入れてメモ" },
  { key: "concrete_example",  label: "具体例を引き出す" }
] as const;

export const FREE_ANSWER_POLICY_OPTIONS = [
  { key: "default",          label: "デフォルト（既存ルール）" },
  { key: "accept_none",      label: "「特になし」を受け入れる" },
  { key: "include_verbatim", label: "発言をそのまま含める" },
  { key: "summarize_only",   label: "要約のみ記録" }
] as const;

export const RESTRICTION_OPTIONS = [
  { key: "no_leading_question",                label: "誘導質問禁止" },
  { key: "one_question_only",                  label: "1回につき1質問のみ" },
  { key: "avoid_sensitive_personal_data",      label: "個人情報を引き出さない" },
  { key: "no_medical_legal_financial_claim",   label: "医療・法律・金融の断言禁止" },
  { key: "no_internal_codes",                  label: "内部コードを表示しない" }
] as const;

export const PRIORITY_OPTIONS = [
  { key: "research_quality_first",   label: "調査品質優先" },
  { key: "respondent_comfort_first", label: "回答者の負担軽減優先" },
  { key: "comparability_first",      label: "比較可能性優先" }
] as const;

// ────────────────────────────────────────────────
// 正規化・解決
// ────────────────────────────────────────────────

const VALID_RESEARCH_TYPES = new Set<string>(RESEARCH_TYPE_OPTIONS.map((o) => o.key));
const VALID_AUDIENCES       = new Set<string>(AUDIENCE_OPTIONS.map((o) => o.key));
const VALID_PROBE_STYLES    = new Set<string>(PROBE_STYLE_OPTIONS.map((o) => o.key));
const VALID_NONE_POLICIES   = new Set<string>(NONE_ANSWER_POLICY_OPTIONS.map((o) => o.key));
const VALID_AMBIG_RULES     = new Set<string>(AMBIGUOUS_ANSWER_RULE_OPTIONS.map((o) => o.key));
const VALID_FREE_POLICIES   = new Set<string>(FREE_ANSWER_POLICY_OPTIONS.map((o) => o.key));
const VALID_RESTRICTIONS    = new Set<string>(RESTRICTION_OPTIONS.map((o) => o.key));
const VALID_PRIORITIES      = new Set<string>(PRIORITY_OPTIONS.map((o) => o.key));

/** 不正なキーを除去して正規化した AIPromptPolicy を返す */
export function normalizeAIPromptPolicy(raw: unknown): AIPromptPolicy {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const r = raw as Record<string, unknown>;
  const policy: AIPromptPolicy = {};

  if (typeof r.researchType === "string" && VALID_RESEARCH_TYPES.has(r.researchType)) {
    policy.researchType = r.researchType;
  }
  if (typeof r.audience === "string" && VALID_AUDIENCES.has(r.audience)) {
    policy.audience = r.audience;
  }
  if (typeof r.probeStyle === "string" && VALID_PROBE_STYLES.has(r.probeStyle)) {
    policy.probeStyle = r.probeStyle;
  }
  if (typeof r.noneAnswerPolicy === "string" && VALID_NONE_POLICIES.has(r.noneAnswerPolicy)) {
    policy.noneAnswerPolicy = r.noneAnswerPolicy;
  }
  if (typeof r.ambiguousAnswerRule === "string" && VALID_AMBIG_RULES.has(r.ambiguousAnswerRule)) {
    policy.ambiguousAnswerRule = r.ambiguousAnswerRule;
  }
  if (typeof r.freeAnswerPolicy === "string" && VALID_FREE_POLICIES.has(r.freeAnswerPolicy)) {
    policy.freeAnswerPolicy = r.freeAnswerPolicy;
  }
  if (Array.isArray(r.restrictions)) {
    policy.restrictions = (r.restrictions as unknown[])
      .filter((v): v is string => typeof v === "string" && VALID_RESTRICTIONS.has(v));
  }
  if (typeof r.priority === "string" && VALID_PRIORITIES.has(r.priority)) {
    policy.priority = r.priority;
  }
  return policy;
}

/** Project から正規化済みの AIPromptPolicy を取得する（null の場合は空オブジェクト） */
export function resolveAIPromptPolicy(project: Project): AIPromptPolicy {
  return normalizeAIPromptPolicy(project.ai_prompt_policy_json ?? {});
}

/**
 * Phase 6-B: パッケージの policy にプロジェクト個別オーバーライドをマージする。
 * - overrides 側で設定されたキーのみ basePolicy を上書きする（疎なオーバーライド）
 * - restrictions は配列ごと置換（部分追加・削除はしない。挙動を予測可能に保つため）
 * - どちらも normalizeAIPromptPolicy を通すため不正キー・不正値は混入しない
 */
export function mergePolicyWithOverrides(
  basePolicy: AIPromptPolicy | null | undefined,
  overridePolicy: AIPromptPolicy | null | undefined
): AIPromptPolicy {
  const base = normalizeAIPromptPolicy(basePolicy ?? {});
  const override = normalizeAIPromptPolicy(overridePolicy ?? {});
  return { ...base, ...override };
}

// ────────────────────────────────────────────────
// 各セクションのテキスト生成
// ────────────────────────────────────────────────

export function renderResearchTypeGuide(policy: AIPromptPolicy): string | null {
  if (!policy.researchType || policy.researchType === "standard_research") return null;
  const opt = RESEARCH_TYPE_OPTIONS.find((o) => o.key === policy.researchType);
  if (!opt) return null;
  const guides: Record<string, string> = {
    interview_research:   "調査スタイル: インタビューリサーチ。回答者の文脈・経緯・動機を深く引き出すことを重視する。",
    survey_interview:     "調査スタイル: サーベイ+インタビュー。構造化比較と自由な深掘りを両立させる。",
    exploratory_research: "調査スタイル: 探索的リサーチ。仮説なしに回答者の視点・語彙・枠組みを引き出す。"
  };
  return guides[policy.researchType] ?? null;
}

export function renderAudienceGuide(policy: AIPromptPolicy): string | null {
  if (!policy.audience || policy.audience === "general") return null;
  const guides: Record<string, string> = {
    female_friendly:  "対象者配慮: 女性向け。共感的・丁寧な語り口を使い、押しつけがましい質問は避ける。",
    young_casual:     "対象者配慮: 若年層向け。カジュアルで親しみやすい表現を使う。ただし友達語は避ける。",
    business:         "対象者配慮: ビジネス層向け。フォーマルで簡潔な語り口を使う。",
    senior_friendly:  "対象者配慮: シニア向け。平易な言葉・短い文・丁寧な敬語を使う。"
  };
  return guides[policy.audience] ?? null;
}

export function renderProbeStyleGuide(policy: AIPromptPolicy): string | null {
  if (!policy.probeStyle || policy.probeStyle === "standard") return null;
  const guides: Record<string, string> = {
    reason_and_scene:    "深掘りスタイル補助方針: なぜそう感じたのか（理由）と、どんな場面だったか（場面）を1点ずつ引き出すことを優先する。",
    comparison:          "深掘りスタイル補助方針: 他の選択肢・経験・状況と比べてどう違ったかという比較軸で深掘りすることを優先する。",
    emotion_and_context: "深掘りスタイル補助方針: そのときの感情と、その感情が生まれた背景・文脈を引き出すことを優先する。",
    decision_process:    "深掘りスタイル補助方針: どのように判断・選択したか、そのプロセスや優先軸を引き出すことを優先する。"
  };
  return guides[policy.probeStyle] ?? null;
}

export function renderNoneAnswerPolicyGuide(
  policy: AIPromptPolicy,
  questionRole?: string | null
): string | null {
  // free_comment には noneAnswerPolicy を適用しない
  if (questionRole === "free_comment") return null;
  if (!policy.noneAnswerPolicy || policy.noneAnswerPolicy === "default") return null;
  const guides: Record<string, string> = {
    accept:             "「特になし」「わからない」等の辞退回答: そのまま受け入れ、次の質問へ進む。",
    retry_once_softly:  "「特になし」「わからない」等の辞退回答: 一度だけ「強いて言うなら」「少しだけでも」等の柔らかい言葉で再確認する。それでも出ない場合は受け入れる。",
    ask_for_small_hint: "「特になし」「わからない」等の辞退回答: 「少しだけでも気になることは？」のように小さなヒントを求めてみる。それでも出ない場合は受け入れる。"
  };
  return guides[policy.noneAnswerPolicy] ?? null;
}

export function renderAmbiguousAnswerGuide(policy: AIPromptPolicy): string | null {
  if (!policy.ambiguousAnswerRule || policy.ambiguousAnswerRule === "default") return null;
  const guides: Record<string, string> = {
    ask_clarification: "曖昧回答への対応: 「もう少し具体的に教えてもらえますか」のように具体化を1回求める。",
    accept_and_note:   "曖昧回答への対応: 曖昧なまま受け入れ、その旨を reason に記録する。",
    concrete_example:  "曖昧回答への対応: 「たとえばどんな状況でしたか？」のように具体例を1点引き出す。"
  };
  return guides[policy.ambiguousAnswerRule] ?? null;
}

export function renderRestrictionGuide(policy: AIPromptPolicy): string | null {
  const restrictions = policy.restrictions ?? [];
  if (restrictions.length === 0) return null;
  const descriptions: Record<string, string> = {
    no_leading_question:              "誘導質問を行わない（回答者の意見を決めつけない）",
    one_question_only:                "1メッセージで1つの質問のみ行う",
    avoid_sensitive_personal_data:    "氏名・住所・電話番号等の個人情報を引き出す質問をしない",
    no_medical_legal_financial_claim: "医療・法律・金融に関する断言・診断・助言を行わない",
    no_internal_codes:                "内部コード・スロットキー等をユーザーに見せない"
  };
  const lines = restrictions
    .map((k) => descriptions[k])
    .filter(Boolean)
    .map((d) => `- ${d}`);
  if (lines.length === 0) return null;
  return ["追加制限ルール:", ...lines].join("\n");
}

export function renderPriorityGuide(policy: AIPromptPolicy): string | null {
  if (!policy.priority) return null;
  const guides: Record<string, string> = {
    research_quality_first:   "優先方針: 調査品質を最優先とする。多少回答者に負荷がかかっても必要な情報を取得する。",
    respondent_comfort_first: "優先方針: 回答者の負担軽減を最優先とする。答えにくい質問はスキップするか言い方を和らげる。",
    comparability_first:      "優先方針: 比較可能性を最優先とする。回答者間で同等の情報を取得できるよう質問を統一する。"
  };
  return guides[policy.priority] ?? null;
}

/**
 * 全ポリシーセクションをまとめて生成する。
 * purpose: "probe" | "slot_filling" | "analysis" | "summary" | "general"
 */
export function renderPromptPolicySections(
  project: Project,
  purpose: string,
  options?: { questionRole?: string | null }
): string | null {
  const policy = resolveAIPromptPolicy(project);
  const sections: string[] = [];

  const researchType = renderResearchTypeGuide(policy);
  if (researchType) sections.push(researchType);

  const audience = renderAudienceGuide(policy);
  if (audience) sections.push(audience);

  if (purpose === "probe" || purpose === "general") {
    const probeStyle = renderProbeStyleGuide(policy);
    if (probeStyle) sections.push(probeStyle);

    const noneAnswer = renderNoneAnswerPolicyGuide(policy, options?.questionRole);
    if (noneAnswer) sections.push(noneAnswer);

    const ambiguous = renderAmbiguousAnswerGuide(policy);
    if (ambiguous) sections.push(ambiguous);
  }

  if (purpose === "analysis" || purpose === "general") {
    const freeAnswer = renderFreeAnswerPolicyGuide(policy);
    if (freeAnswer) sections.push(freeAnswer);
  }

  const restrictions = renderRestrictionGuide(policy);
  if (restrictions) sections.push(restrictions);

  const priority = renderPriorityGuide(policy);
  if (priority) sections.push(priority);

  if (sections.length === 0) return null;
  return ["[AIプロンプト補助方針]", ...sections].join("\n");
}

function renderFreeAnswerPolicyGuide(policy: AIPromptPolicy): string | null {
  if (!policy.freeAnswerPolicy || policy.freeAnswerPolicy === "default") return null;
  const guides: Record<string, string> = {
    accept_none:      "自由回答の扱い: 「特になし」「ありません」等は積極的に受け入れる。",
    include_verbatim: "自由回答の扱い: 回答者の発言をできるだけそのまま含めてサマリーを作成する。",
    summarize_only:   "自由回答の扱い: 自由回答は要約のみを記録し、逐語は含めない。"
  };
  return guides[policy.freeAnswerPolicy] ?? null;
}
