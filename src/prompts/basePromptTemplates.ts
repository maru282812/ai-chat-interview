/**
 * basePromptTemplates.ts
 *
 * 既存 researchPrompts.ts の各プロンプトを {{placeholder}} 形式のテンプレートとして定義します。
 * - 管理画面での表示・編集の基準値
 * - projects.ai_prompt_templates_json が未設定のときのデフォルト
 *
 * 重要:
 * - 実行時変数 ${input.xxx} は {{placeholder}} に変換済み
 * - renderSlotGuide / buildProbeTypeGuidance 等の関数呼び出し部分は専用プレースホルダー化
 * - 既存プロンプトの意味・文言は変更していない
 */

import type { AIPromptPolicy, AIPromptTemplateMap } from "../types/domain";

export type BasePromptKey =
  | "buildAnalyzeAnswerPrompt"
  | "buildInterviewTurnPrompt"
  | "buildProbeGenerationPrompt"
  | "buildQuestionRenderingPrompt"
  | "buildSlotFillingPrompt"
  | "buildCompletionCheckPrompt"
  | "buildSessionSummaryPrompt"
  | "buildFinalStructuredSummaryPrompt"
  | "buildFinalAnalysisPrompt"
  | "buildProbePrompt"
  // Phase 7-A: researchPrompts.ts 内の旧未管理プロンプト（B1〜B7）
  | "buildProjectInitialStatePrompt"
  | "buildProjectAnalysisPrompt"
  | "buildPostAnalysisPrompt"
  | "buildRantExtendedPrompt"
  | "buildDiaryExtendedPrompt"
  | "buildRantCounselorReplyPrompt"
  | "buildPersonaTagsPrompt"
  // Phase 7-B: 管理ツール系 AI 呼び出し（adminController / missingAttributeService）
  | "buildSurveyOptionsPrompt"
  | "buildAdjustQuestionsPrompt"
  | "buildGenerateFlowPrompt"
  | "buildMissingAttributeSuggestionsPrompt";

export interface BasePromptDefinition {
  label: string;
  /** 用途（このプロンプトが何をするか） */
  description: string;
  /** 呼び出しタイミング（いつ・どこから実行されるか） */
  callTiming: string;
  /** 影響範囲（変更すると何に影響するか） */
  impactScope: string;
  /** 出力形式（AIに要求する形式） */
  outputFormat: string;
  /** 利用ポリシー軸（renderPromptPolicySections で末尾に追記されるポリシーのキー） */
  usedPolicies: string[];
  /**
   * 管理ツール系（chat.completions 形式）の呼び出しで使う静的システムメッセージ。
   * 設定されている場合、template はユーザーメッセージとして扱われる。
   * 未設定の場合はメッセージ分離なし（runTextPrompt 形式）。
   */
  systemPrompt?: string;
  template: string;
  allowedPlaceholders: string[];
}

// renderPromptPolicySections の purpose ごとに適用されるポリシー軸（promptPolicies.ts と対応）
const POLICY_AXES_PROBE = [
  "researchType", "audience", "probeStyle", "noneAnswerPolicy", "ambiguousAnswerRule", "restrictions", "priority"
];
const POLICY_AXES_GENERAL = [
  "researchType", "audience", "probeStyle", "noneAnswerPolicy", "ambiguousAnswerRule", "freeAnswerPolicy", "restrictions", "priority"
];
const POLICY_AXES_ANALYSIS = ["researchType", "audience", "freeAnswerPolicy", "restrictions", "priority"];
const POLICY_AXES_SUMMARY = ["researchType", "audience", "restrictions", "priority"];

/** 管理画面表示用にポリシー軸キーの日本語ラベルを返す */
export function describePolicyAxis(key: string): string {
  const map: Record<string, string> = {
    researchType: "調査タイプ",
    audience: "対象者向け",
    probeStyle: "深掘りスタイル",
    noneAnswerPolicy: "「特になし」回答への対応",
    ambiguousAnswerRule: "曖昧回答への対応",
    freeAnswerPolicy: "自由回答の扱い",
    restrictions: "制限ルール",
    priority: "優先方針"
  };
  return map[key] ?? key;
}

export const BASE_PROMPT_TEMPLATES: Record<BasePromptKey, BasePromptDefinition> = {

  buildAnalyzeAnswerPrompt: {
    label: "回答分析プロンプト",
    description: "1ターンの回答を分析し、次アクション（probe / ask_next / skip / finish）を決定する",
    callTiming: "回答受信ごと（liffController / conversationOrchestratorService）",
    impactScope: "深掘り発火・次質問遷移・スキップ・完了の全進行判定。survey / survey_interview モードの中核",
    outputFormat: "JSON（action / question / reason / collected_slots / is_sufficient）",
    usedPolicies: POLICY_AXES_PROBE,
    allowedPlaceholders: [
      "projectGoal", "userUnderstandingGoal", "projectLanguage", "strictTopicLock",
      "projectRequiredSlots", "currentRequiredSlots", "currentOptionalSlots", "nextRequiredSlots",
      "questionCode", "questionType", "questionText", "probeGoal",
      "answer", "answerOptions", "existingSlots",
      "aiProbeEnabled", "currentProbeCount", "maxProbes", "projectRequiredSlotKeys",
      "probeGuideline", "probeTypeGuidance", "freeCommentPolicy", "modeStyleGuide"
    ],
    template: `Return JSON only.
You are the single decision-maker for one turn of a LINE-based interview or survey.
Decide the next action from the project objective first, not only from the current question text.

Priority execution context
- project_goal: {{projectGoal}}
- user_understanding_goal: {{userUnderstandingGoal}}
- project_language: {{projectLanguage}}
- strict_topic_lock: {{strictTopicLock}}

{{projectRequiredSlots}}

{{currentRequiredSlots}}

{{currentOptionalSlots}}

{{nextRequiredSlots}}

Current turn context
- question_code: {{questionCode}}
- question_type: {{questionType}}
- question_text: {{questionText}}
- probe_goal: {{probeGoal}}
- answer: {{answer}}
{{answerOptions}}
- existing_slots: {{existingSlots}}
- ai_probe_enabled: {{aiProbeEnabled}}
- current_probe_count: {{currentProbeCount}}
- max_probes: {{maxProbes}}
- project_required_slot_keys: {{projectRequiredSlotKeys}}

Decision policy
- Judge sufficiency by whether the essential information has been captured.
- A short but concrete answer can be sufficient.
- A long but abstract answer can still require a probe.
- Probe when required information is still missing, when the answer is abstract, or when the project-level understanding is still weak.
- Do not treat answer length alone as a failure.
- If the current question is sufficiently answered and the next question's required slots are already covered, action can be skip.
- action finish is allowed only when the project-level required information is already captured.
- If you probe, ask exactly one focused follow-up.
- Do not expose internal slot keys such as snake_case names to the respondent.
- If ai_probe_enabled is false, action MUST be ask_next regardless of answer quality.
{{probeGuideline}}

{{probeTypeGuidance}}

CRITICAL: When action is probe, the question field MUST reference the actual content of the answer above.
Do not generate a generic probe that ignores what the respondent said.

{{freeCommentPolicy}}
{{modeStyleGuide}}

Output schema
{
  "action": "probe | ask_next | skip | finish",
  "question": "Japanese user-facing text. Empty string unless action is probe.",
  "reason": "short internal reason in English or Japanese",
  "collected_slots": { "slot_key": "value or null" },
  "is_sufficient": true
}

Output constraints
- question must be Japanese only.
- question must contain a single intent.
- collected_slots must include only grounded information from the answer.
- If action is not probe, return an empty question string.
- Do not wrap JSON in markdown.`
  },

  buildInterviewTurnPrompt: {
    label: "インタビュータープロンプト",
    description: "インタビュー進行の1ターンを判定し、次アクションと返答テキストを生成する",
    callTiming: "インタビュー型（interview_chat）の各ターン（conversationOrchestratorService）",
    impactScope: "インタビュー進行判定とユーザーへの返答テキスト全体（深掘り・次質問・終了の判定を含む）",
    outputFormat: "JSON（action / response_text / collected_slots / reason）",
    usedPolicies: POLICY_AXES_PROBE,
    allowedPlaceholders: [
      "projectGoal", "userUnderstandingGoal", "requiredInformation",
      "question", "questionType", "probeGoal", "answer", "answerOptions",
      "collectedSoFar", "probeCount", "maxProbes", "nextQuestion",
      "canProbe", "probeGuideline", "probeTypeGuidance"
    ],
    template: `Return JSON only.
You are an interviewer conducting a LINE-based research interview in Japanese.
You have just received an answer and must decide the next action.

Project goal: {{projectGoal}}
User understanding goal: {{userUnderstandingGoal}}
{{requiredInformation}}

Current turn
- question: {{question}}
- question_type: {{questionType}}
- probe_goal: {{probeGoal}}
- answer: {{answer}}
{{answerOptions}}
- collected_so_far: {{collectedSoFar}}
- probe_count: {{probeCount}}
- next_question: {{nextQuestion}}

Probe rules
{{canProbe}}
{{probeGuideline}}

{{probeTypeGuidance}}

CRITICAL: When action is probe, response_text MUST reference the actual content of the answer above.
Do not generate a generic probe that ignores what the respondent said.

Skip rules
- If next_question asks for information already collected in collected_so_far, action can be skip
- Skip means: skip the next question and advance further

Response rules
- Write all user-facing text in natural Japanese conversation style
- Do NOT use Q1/Q2 numbers or internal codes
- Keep messages short and suitable for LINE chat
- If action is probe: response_text = one follow-up question grounded in the respondent's answer
- If action is ask_next or skip: response_text = the next question rendered as natural conversation
- If action is finish: response_text = null

Output schema
{
  "action": "probe | ask_next | skip | finish",
  "response_text": "text to send to user (probe or next question), null if finish",
  "collected_slots": { "slot_key": "extracted value or null" },
  "reason": "short internal reason"
}

Output constraints
- JSON only, no markdown fences
- response_text must be Japanese
- collected_slots must be grounded in the answer`
  },

  buildProbeGenerationPrompt: {
    label: "深掘り質問生成プロンプト",
    description: "スロット不足・抽象回答に対して深掘り質問を1件生成する",
    callTiming: "現在呼び出し元なし（休眠コードパス。テンプレート管理対象として温存）",
    impactScope: "構造化深掘り質問の生成（aiService.generateStructuredProbe）。現行フローでは未使用",
    outputFormat: "JSON（probe_question / probe_type / focus）",
    usedPolicies: POLICY_AXES_PROBE,
    allowedPlaceholders: [
      "sharedSections", "questionCode", "questionType", "questionText",
      "answerOptions", "probeType", "answer", "previousAnswer",
      "extractedSlots", "completion", "missingSlots",
      "questionObjectiveGuide", "probeGoal", "probeConfig", "sessionSummary",
      "probeTypeGuidance"
    ],
    template: `{{sharedSections}}
Return JSON only.
Required keys: probe_question, probe_type, focus
Ask exactly one follow-up question.
Do not repeat the original question verbatim.
Do not ask multiple questions.
Do not mention internal codes or slots by name.
Do not ignore the user's answer and jump to a new question.
Do not transform the topic into another category.
CRITICAL: The probe_question MUST be grounded in the actual answer content below. Do not generate a generic question that ignores what the respondent said.
Question code: {{questionCode}}
Question type: {{questionType}}
Question text: {{questionText}}
{{answerOptions}}
Probe type: {{probeType}}
User's answer: {{answer}}
Previous answer text: {{previousAnswer}}
Extracted slots: {{extractedSlots}}
Completion: {{completion}}
Missing slots: {{missingSlots}}
{{questionObjectiveGuide}}
Probe goal: {{probeGoal}}
Probe config: {{probeConfig}}
Session summary: {{sessionSummary}}
{{probeTypeGuidance}}`
  },

  buildQuestionRenderingPrompt: {
    label: "質問レンダリングプロンプト",
    description: "内部質問を回答者向けの自然な日本語質問文に変換する",
    callTiming: "質問提示前（conversationOrchestratorService）",
    impactScope: "回答者に表示される質問文の自然さ・トーン・文脈接続",
    outputFormat: "テキスト（回答者向け質問文のみ）",
    usedPolicies: POLICY_AXES_GENERAL,
    allowedPlaceholders: [
      "sharedSections",
      "questionCode", "questionType", "questionText", "questionRole",
      "renderStyle", "questionObjectiveGuide", "slotGuide",
      "previousQuestion", "previousAnswer", "questionConfig"
    ],
    template: `{{sharedSections}}
Write exactly one question for the respondent.
Do not show internal question numbers such as Q1 or internal codes.
Keep the internal meaning of the question intact.
Do not convert the topic into a different category or analogy.
If there is a previous answer, connect naturally from it.
For interview mode, make it sound like a human interviewer.
Output only the user-facing question text.
Internal question code: {{questionCode}}
Internal question text: {{questionText}}
Question type: {{questionType}}
Question role: {{questionRole}}
Render style: {{renderStyle}}
{{questionObjectiveGuide}}
{{slotGuide}}
Previous question text: {{previousQuestion}}
Previous answer text: {{previousAnswer}}
Question config: {{questionConfig}}`
  },

  buildSlotFillingPrompt: {
    label: "スロット抽出プロンプト",
    description: "回答からスロット情報を構造化抽出する",
    callTiming: "現在呼び出し元なし（休眠コードパス。テンプレート管理対象として温存）",
    impactScope: "回答からのスロット構造化抽出（aiService.fillAnswerSlots）。現行フローでは未使用",
    outputFormat: "JSON（structured_summary / extracted_slots / comparable_payload）",
    usedPolicies: POLICY_AXES_GENERAL,
    allowedPlaceholders: [
      "sharedSections",
      "questionCode", "questionText", "questionObjectiveGuide", "slotGuide",
      "answer", "probeAnswer"
    ],
    template: `{{sharedSections}}
Return JSON only.
Required keys: structured_summary, extracted_slots, comparable_payload
extracted_slots must be an array of objects with keys: key, value, confidence, evidence
Use null when a slot is not supported by the answer.
Do not infer facts that are not clearly stated.
Question code: {{questionCode}}
Question text: {{questionText}}
{{questionObjectiveGuide}}
{{slotGuide}}
Primary answer: {{answer}}
Probe answer: {{probeAnswer}}`
  },

  buildCompletionCheckPrompt: {
    label: "完了チェックプロンプト",
    description: "回答が十分かどうか（完了条件を満たすか）を判定する",
    callTiming: "現在呼び出し元なし（休眠コードパス。テンプレート管理対象として温存）",
    impactScope: "必須情報の充足判定（aiService.checkAnswerCompletion）。現行フローでは未使用",
    outputFormat: "JSON（is_complete / missing_slots / reasons / quality_score）",
    usedPolicies: POLICY_AXES_GENERAL,
    allowedPlaceholders: [
      "sharedSections",
      "questionCode", "questionText",
      "completionConditions", "badAnswerPatterns",
      "questionObjectiveGuide", "slotGuide",
      "answer", "extractedSlots"
    ],
    template: `{{sharedSections}}
Return JSON only.
Required keys: is_complete, missing_slots, reasons, quality_score
Judge strictly but pragmatically.
is_complete must be true only when all expected_slots are filled, bad patterns are absent, and quality_score is high enough.
quality_score must be an integer from 0 to 100.
If the answer is too abstract or matches bad answer patterns, include a reason.
Question code: {{questionCode}}
Question text: {{questionText}}
Completion conditions: {{completionConditions}}
Bad answer patterns: {{badAnswerPatterns}}
{{questionObjectiveGuide}}
{{slotGuide}}
Answer: {{answer}}
Extracted slots: {{extractedSlots}}`
  },

  buildSessionSummaryPrompt: {
    label: "セッション要約プロンプト",
    description: "直近の会話トランスクリプトからセッション要約を更新する",
    callTiming: "セッション完了時（conversationService）",
    impactScope: "セッション要約の品質。最終構造化サマリー・深掘り生成の入力としても使われる",
    outputFormat: "テキスト（要約のみ・200文字程度）",
    usedPolicies: POLICY_AXES_SUMMARY,
    allowedPlaceholders: [
      "sharedSections", "previousSummary", "recentTranscript"
    ],
    template: `{{sharedSections}}
Update the session summary using the recent transcript.
Keep it factual, compact, and cumulative.
Maximum length: 200 Japanese characters or equivalent brevity.
Previous summary: {{previousSummary}}
Recent transcript: {{recentTranscript}}
Output summary text only.`
  },

  buildFinalStructuredSummaryPrompt: {
    label: "最終構造化サマリープロンプト",
    description: "セッション全体の回答を統合してユーザー理解単位で最終サマリーを生成する",
    callTiming: "分析実行時（analysisService）",
    impactScope: "最終構造化サマリー。管理画面の分析結果表示・回答比較の基盤データ",
    outputFormat: "JSON（summary / usage_scene / motive / pain_points / alternatives / desired_state / insight_candidates / user_understanding / structured_answers）",
    usedPolicies: POLICY_AXES_ANALYSIS,
    allowedPlaceholders: [
      "sharedSections", "sessionSummary", "answers"
    ],
    template: `{{sharedSections}}
Return JSON only.
Required top-level keys: summary, usage_scene, motive, pain_points, alternatives, desired_state, insight_candidates, user_understanding, structured_answers
Organize the final summary by user understanding unit, not by question order.
user_understanding should be an object that integrates context, behaviors, motivations, blockers, desired outcomes, and notable evidence across all answers.
structured_answers must be an object keyed by question_code.
Each structured_answers item should contain question_text, answer_text, structured_summary, extracted_slots, completion.
Use extracted slots to build comparable qualitative structure.
Do not exaggerate. Prefer patterns supported by the answers.
Session summary: {{sessionSummary}}
Answers: {{answers}}`
  },

  buildFinalAnalysisPrompt: {
    label: "最終分析プロンプト（簡易版）",
    description: "セッション要約と回答一覧から簡易最終分析JSONを生成する",
    callTiming: "最終構造化サマリーの JSON パース失敗時のフォールバック（analysisService）",
    impactScope: "簡易最終分析。構造化サマリー失敗時のみ分析結果に反映される",
    outputFormat: "JSON（summary / usage_scene / motive / pain_points / alternatives / insight_candidates）",
    usedPolicies: POLICY_AXES_ANALYSIS,
    allowedPlaceholders: [
      "sharedSections", "sessionSummary", "answers"
    ],
    template: `{{sharedSections}}
Return JSON only.
Required keys: summary, usage_scene, motive, pain_points, alternatives, insight_candidates
Do not exaggerate. Prefer patterns that are supported by the answers.
Session summary: {{sessionSummary}}
Answers: {{answers}}`
  },

  buildProbePrompt: {
    label: "深掘りプロンプト（シンプル版）",
    description: "質問と回答を受けて1件の深掘り質問を生成する（汎用版）",
    callTiming: "深掘り発火時（conversationService）",
    impactScope: "単発の深掘り質問文（回答者にそのまま表示される）",
    outputFormat: "テキスト（深掘り質問のみ）",
    usedPolicies: POLICY_AXES_PROBE,
    allowedPlaceholders: [
      "sharedSections", "question", "answer", "sessionSummary"
    ],
    template: `{{sharedSections}}
Write exactly one short follow-up question.
Do not repeat the original question.
Do not ask multiple questions.
Do not change the topic or introduce a different category.
CRITICAL: The follow-up question MUST be grounded in the actual answer content below.
Current question: {{question}}
Answer: {{answer}}
Session summary: {{sessionSummary}}
Output only the follow-up question text.`
  },

  // ============================================================
  // Phase 7-A: B1〜B7（旧未管理プロンプト）
  // ポリシー軸は適用しない（従来挙動を保持するため usedPolicies は空）
  // ============================================================

  buildProjectInitialStatePrompt: {
    label: "プロジェクトAI初期状態生成プロンプト",
    description: "プロジェクト目的からAI初期状態（required_slots / probe_policy / completion_rule 等）を生成する",
    callTiming: "プロジェクトAI状態の初期生成時（projectAiStateService.ensureGenerated）",
    impactScope: "projects.ai_state_json の生成内容。A群ほぼ全プロンプトの実行時コンテキストの源泉",
    outputFormat: "JSON（version / template_key / project_goal / required_slots / probe_policy / completion_rule / topic_control ほか）",
    usedPolicies: [],
    allowedPlaceholders: [
      "projectName", "clientName", "objective", "researchMode",
      "primaryObjectives", "secondaryObjectives", "comparisonConstraints", "promptRules",
      "templateKey", "templateLabel", "templateDescription", "templateStateExample"
    ],
    template: `Return JSON only.
The output language must be Japanese.
JSON keys must stay in English.
Do not wrap the JSON in markdown fences.
Do not add explanation outside JSON.
You are generating the project-level AI initial state for a LINE interview system.
This state will be reused at runtime to reduce repeated interpretation cost.
The state must define what information should be collected at the project level, not at a single-question level.
Required top-level keys: version, template_key, project_goal, user_understanding_goal, required_slots, optional_slots, question_categories, probe_policy, completion_rule, topic_control, language
required_slots and optional_slots must be arrays of objects with keys: key, label, required, description, examples
question_categories must be a Japanese string array.
probe_policy keys: default_max_probes, force_probe_on_bad, strict_topic_lock, allow_followup_expansion
completion_rule keys: required_slots_needed, allow_finish_without_optional, min_required_slots_to_finish
topic_control keys: forbidden_topic_shift, topic_lock_note
Use concise, practical Japanese labels for admin UI.
Prefer 3 to 5 required slots and 0 to 5 optional slots.
Set strict_topic_lock and forbidden_topic_shift to true unless the project obviously requires wider exploration.
default_max_probes should usually be 1 and at most 2.
Project name: {{projectName}}
Client name: {{clientName}}
Objective: {{objective}}
Research mode: {{researchMode}}
{{primaryObjectives}}
{{secondaryObjectives}}
{{comparisonConstraints}}
{{promptRules}}
Recommended template key: {{templateKey}}
Recommended template label: {{templateLabel}}
Recommended template description: {{templateDescription}}
Recommended template state example: {{templateStateExample}}
Optimize for a reusable project blueprint that humans can inspect and edit in the admin UI.`
  },

  buildProjectAnalysisPrompt: {
    label: "プロジェクト分析プロンプト",
    description: "プロジェクト横断で回答者を比較分析しレポートJSONを生成する",
    callTiming: "管理画面の分析レポート生成時（analysisService.generateProjectAnalysisReport）",
    impactScope: "プロジェクト分析レポート（project_analysis_reports）の生成内容全体",
    outputFormat: "JSON（executive_summary / overall_trends / primary_objectives / comparison_focus / respondent_summaries ほか）",
    usedPolicies: [],
    allowedPlaceholders: [
      "sharedSections", "respondentSummaries", "comparisonUnits", "freeAnswerPolicy"
    ],
    template: `{{sharedSections}}
Return JSON only.
Use primary objectives as the main axis of analysis.
Use secondary objectives only as supporting context.
Keep each respondent summary concise.
When comparing multiple respondents, prioritize common viewpoints and repeated patterns.
Do not let unusual or entertaining single responses dominate the conclusion.
Prefer structured comparison units first. Use free-text answers as qualitative support.
Required JSON keys:
executive_summary
overall_trends
primary_objectives
secondary_objectives
comparison_focus
free_answer_policy
respondent_summaries
JSON shape hints:
- overall_trends: string[]
- primary_objectives: [{"objective":"...","summary":"...","evidence":["..."]}]
- secondary_objectives: [{"objective":"...","summary":"...","evidence":["..."]}]
- comparison_focus: [{"unit":"...","summary":"..."}]
- free_answer_policy: {"summary":"...","target_question_codes":["..."]}
- respondent_summaries: [{"respondent_id":"...","summary":"..."}]
Respondent summaries input: {{respondentSummaries}}
Comparison units input: {{comparisonUnits}}
Free answer policy input: {{freeAnswerPolicy}}`
  },

  buildPostAnalysisPrompt: {
    label: "投稿分析プロンプト",
    description: "単一のユーザー投稿を分析し summary / tags / sentiment 等を抽出する",
    callTiming: "投稿受信ごと非同期（analysisService.analyzePost ← conversationOrchestratorService / liffController）",
    impactScope: "post_analyses の生成内容。ペルソナタグ生成（buildPersonaTagsPrompt）の入力にもなる",
    outputFormat: "JSON（summary / tags / sentiment / keywords / actionability / insight_type / specificity / novelty）",
    usedPolicies: [],
    allowedPlaceholders: ["postType", "sourceMode", "content"],
    template: `You analyze a single user post from a LINE-based research product.
Return JSON only.
Required keys: summary, tags, sentiment, keywords, actionability, insight_type, specificity, novelty
sentiment must be one of: positive, neutral, negative, mixed
actionability must be one of: high, medium, low
insight_type must be one of: issue, request, complaint, praise, other
specificity and novelty must be integers from 0 to 100
tags and keywords must be JSON arrays of short strings.
Do not invent facts outside the text.
summary should be concise and useful for enterprise review.
Post type: {{postType}}
Source mode: {{sourceMode}}
Content: {{content}}`
  },

  buildRantExtendedPrompt: {
    label: "愚痴拡張分析プロンプト",
    description: "愚痴投稿のカテゴリ・深刻度・危険フラグ・特徴フレーズを判定する",
    callTiming: "愚痴投稿の拡張分析時（aiTagService.analyzeRantPost）",
    impactScope: "post_analyses.raw_json.rant_extended（危険フラグ判定を含む）",
    outputFormat: "JSON（rant_category / severity / danger_flag / top_phrases）",
    usedPolicies: [],
    allowedPlaceholders: ["content"],
    template: `あなたはユーザーの愚痴投稿を分析するAIです。
以下の愚痴テキストを分析し、JSON形式のみで返してください。
必須キー:
  rant_category: '仕事' | '人間関係' | '健康' | '消費' | 'その他'
  severity: 1（軽微）| 2（中程度）| 3（深刻）— 整数
  danger_flag: true | false — 自傷・犯罪・暴力等の危険ワードを含む場合 true
  top_phrases: 最大3件の特徴フレーズ文字列配列（空なら []）
JSON以外を一切出力しないこと。
テキスト: {{content}}`
  },

  buildDiaryExtendedPrompt: {
    label: "日記拡張分析プロンプト",
    description: "日記投稿の mood_score・トピック・行動シグナルを判定する",
    callTiming: "日記投稿の拡張分析時（aiTagService.analyzeDiaryPost）",
    impactScope: "post_analyses.raw_json.diary_extended と behavior_signals",
    outputFormat: "JSON（mood_score / topic_categories / behavior_signals）",
    usedPolicies: [],
    allowedPlaceholders: ["content"],
    template: `あなたはユーザーの日記を分析するAIです。
以下の日記テキストを分析し、JSON形式のみで返してください。
必須キー:
  mood_score: -5（非常にネガティブ）〜+5（非常にポジティブ）の整数
  topic_categories: 最大3件の配列 — 選択肢: 健康, 消費, 仕事, 趣味, 人間関係, その他
  behavior_signals: 最大3件の行動シグナル文字列配列（例: 節約志向, 運動増加, 睡眠悪化）
JSON以外を一切出力しないこと。
テキスト: {{content}}`
  },

  buildRantCounselorReplyPrompt: {
    label: "カウンセラー返信プロンプト",
    description: "愚痴投稿への短い受け止め返信（80文字以内）を生成する",
    callTiming: "愚痴投稿の受信直後（liffController.createPost）",
    impactScope: "投稿者にそのまま表示されるAI返信文面（ユーザー向け文面）",
    outputFormat: "テキスト（返信文のみ・1〜2文・80文字以内）",
    usedPolicies: [],
    allowedPlaceholders: ["postText", "selectedTags"],
    template: `あなたは匿名の本音・悩み投稿に対して、やさしく一言だけ返すカウンセラー風AIです。
目的は、投稿者を評価したり、解決策を押しつけたりすることではありません。
投稿者が「少し受け止めてもらえた」と感じられる短い返信をしてください。

ルール:
- 日本語で返信する
- 1〜2文以内
- 80文字以内
- 医師・専門家として診断しない
- 「あなたは〇〇です」と断定しない
- 説教しない
- 無理に前向きにしない
- 具体的な危険行為の助言をしない
- 投稿者の感情を否定しない
- タメ口にしすぎない
- カウンセラーのように、やさしく受け止める
- 必要に応じて「今日は少し休んでもいいと思います」程度の軽い言葉にする

投稿内容:
{{postText}}

選択タグ:
{{selectedTags}}

返信:`
  },

  buildPersonaTagsPrompt: {
    label: "ペルソナタグ生成プロンプト",
    description: "ユーザーの投稿分析データから属性タグとペルソナ要約を生成する",
    callTiming: "ユーザー属性タグ生成時（aiTagService.generateTagsForUser）",
    impactScope: "user_profiles の AIタグ / ペルソナ要約と user_attributes（ai_inferred）",
    outputFormat: "JSON（tags: 3〜5件 / persona_summary: 50〜100文字）",
    usedPolicies: [],
    allowedPlaceholders: ["postAnalyses"],
    template: `あなたはリサーチプラットフォームのユーザー属性推定AIです。
以下のユーザー投稿分析データを基に、このユーザーを表す属性タグとペルソナ要約を生成してください。
JSON形式のみで返してください。
必須キー:
  tags: 3〜5件の短いタグ文字列配列（例: ファッション好き, 節約志向, ストレス多め）
  persona_summary: このユーザーの人物像を50〜100文字で記述
JSON以外を一切出力しないこと。
投稿分析データ:
{{postAnalyses}}`
  },

  // Phase 7-B: 管理ツール系プロンプト（adminController / missingAttributeService）

  buildSurveyOptionsPrompt: {
    label: "設問回答設定候補提案プロンプト",
    description: "設問タイプに応じた回答設定（選択肢・行列・数値等）の候補をAIが提案する",
    callTiming: "フローデザイナーの「AI候補生成」ボタン押下時（adminController.apiSuggestAnswerOptions）",
    impactScope: "提案候補の内容のみ。本番フローには影響なし",
    outputFormat: "JSON（suggestedOptions / suggestedRows+Cols / suggestedMin+Max / 等、タイプ依存）",
    usedPolicies: [],
    systemPrompt: [
      "あなたはアンケート設計の専門家です。",
      "必ず日本語で出力してください。",
      "JSONを求められた場合はJSON以外を一切出力しないでください。",
    ].join("\n"),
    allowedPlaceholders: ["questionText", "currentQuestionType", "typeInstruction", "responseFormat"],
    template: `以下のアンケート設問に対して、回答設定の候補を提案してください。

設問文: 「{{questionText}}」
現在の回答形式: {{currentQuestionType}}

{{typeInstruction}}

注意:
- 選択肢・行・列は実用的で一般的なアンケートで使われる粒度にしてください
- warnings は注意点がある場合のみ記述してください（通常は空配列）

以下のJSON形式のみで回答してください（前後に余分な文字を入れないこと）:
{{responseFormat}}`
  },

  buildAdjustQuestionsPrompt: {
    label: "設問テキスト流用調整プロンプト",
    description: "参照元案件の設問テキストを、新規案件のプロジェクト名・調査目的に合わせて書き換える",
    callTiming: "フロー流用時のAI調整（adminController.apiImportFlowFromProject）",
    impactScope: "流用後の設問テキスト・選択肢・research_goal のみ",
    outputFormat: "JSON（adjusted_questions 配列）",
    usedPolicies: [],
    systemPrompt: [
      "あなたはアンケート設計専門家です。",
      "参照元案件の設問テキストを、新規案件の「プロジェクト名」と「調査目的」に合わせて自然に書き換えてください。",
      "設問の構造・順番・回答形式・分岐設定は変更しないこと。",
      "必ずJSON形式のみで回答すること。日本語で出力すること。",
    ].join("\n"),
    allowedPlaceholders: [
      "targetProjectName", "targetProjectObjective",
      "sourceProjectName", "sourceProjectObjective",
      "questionsJson",
    ],
    template: `新規案件:
- プロジェクト名: {{targetProjectName}}
- 調査目的: {{targetProjectObjective}}

参照元案件:
- プロジェクト名: {{sourceProjectName}}
- 調査目的: {{sourceProjectObjective}}

以下の設問リストを新規案件向けに修正し、同じindex配列で返してください:
{{questionsJson}}

以下のJSON形式のみで回答:
{"adjusted_questions":[{"index":0,"question_text":"修正後の設問文","options":["選択肢1"],"research_goal":"修正後のgoal"}]}`
  },

  buildGenerateFlowPrompt: {
    label: "AIフロー自動生成プロンプト",
    description: "プロジェクト名と調査目的から設問フロー全体をAIが自動生成する",
    callTiming: "フローデザイナーの「AIフロー生成」ボタン押下時（adminController.apiGenerateFlow）",
    impactScope: "新規作成される設問一覧（本番フローに直接追加される）",
    outputFormat: "JSON（questions 配列）",
    usedPolicies: [],
    systemPrompt: [
      "あなたはアンケート・インタビュー設計専門家です。",
      "プロジェクト名と調査目的に沿った実用的な設問フローをJSON形式で生成してください。",
      "設問は調査として成立する自然な流れで構成し、8〜15問程度にしてください。",
      "日本語で出力し、必ずJSON形式のみで回答してください。",
    ].join("\n"),
    allowedPlaceholders: ["projectName", "objective"],
    template: `プロジェクト名: {{projectName}}
調査目的: {{objective}}

以下のJSON形式でフロー設計を生成してください:
{
  "questions": [
    {
      "question_text": "設問文",
      "question_type": "single_choice|multi_choice|free_text_short|free_text_long|numeric",
      "question_role": "screening|main|attribute|free_comment",
      "is_required": true,
      "ai_probe_enabled": false,
      "research_goal": "この設問で知りたいこと（必須）",
      "options": ["選択肢1", "選択肢2"]
    }
  ]
}

回答形式:
- single_choice: 単一選択（options必須）
- multi_choice: 複数選択（options必須）
- free_text_short: 短文自由記述
- free_text_long: 長文自由記述
- numeric: 数値入力

注意: options は選択型のみ設定。research_goal は全設問に設定すること。`
  },

  buildMissingAttributeSuggestionsPrompt: {
    label: "属性不足設問提案プロンプト",
    description: "カバレッジ不足のユーザー属性に対して、LINEデイリーアンケート用の設問を提案する",
    callTiming: "管理画面の属性カバレッジ確認時（missingAttributeService.suggestQuestions）",
    impactScope: "管理者向けの提案表示のみ。本番フローには影響なし",
    outputFormat: "JSON配列（attr_key / suggested_question / suggested_options / reason）",
    usedPolicies: [],
    allowedPlaceholders: ["attributeList"],
    template: `あなたはユーザーリサーチプラットフォームのAIです。
以下のユーザー属性が不足しています。各属性に対して、LINEデイリーアンケートで使える自然な日本語の設問文と選択肢を提案してください。

属性リスト:
{{attributeList}}

JSON配列で返してください。各要素:
{
  "attr_key": "属性キー",
  "suggested_question": "設問文（〜ですか？ 形式）",
  "suggested_options": [{"label": "表示名", "value": "値"}],
  "reason": "この属性を優先すべき理由（1文）"
}`
  }
};

/** 全プロンプトキー一覧（21キー） */
export const ALL_PROMPT_KEYS = Object.keys(BASE_PROMPT_TEMPLATES) as BasePromptKey[];

// ============================================================
// Phase A/B: 用途プリセット（パッケージ Version 1 の初期テンプレ生成器）
// ============================================================

export type PromptPresetKey =
  | "standard"
  | "business"
  | "website_hunter"
  | "interview"
  | "animal_hospital";

export interface PromptPreset {
  label: string;
  description: string;
  /** プリセット既定ポリシー（policy_json の初期値） */
  policy: AIPromptPolicy;
  /**
   * 用途別の本文上書き（任意）。指定キーのみ BASE 本文の代わりに使う。
   * 初期実装では空〜最小（差別化はまず policy 軸で表現）。将来ここに追記する。
   */
  templateOverrides?: Partial<Record<BasePromptKey, string>>;
}

/**
 * 用途プリセット定義。category（分類タグ）とは別概念で、
 * パッケージ作成時に Version 1 の初期テンプレート＋ポリシーを生成するための「型」。
 */
export const PROMPT_PRESETS: Record<PromptPresetKey, PromptPreset> = {
  standard: {
    label: "標準（汎用）",
    description: "BASE標準セットをそのまま使用。ポリシーは未設定（各プロジェクト/既存ルールに委ねる）。",
    policy: {},
  },
  business: {
    label: "ビジネス向け（フォーマル）",
    description: "ビジネス層向け。フォーマルなトーン・判断プロセス重視・比較可能性優先。",
    policy: {
      researchType: "standard_research",
      audience: "business",
      probeStyle: "decision_process",
      restrictions: ["no_medical_legal_financial_claim", "no_internal_codes"],
      priority: "comparability_first",
    },
  },
  website_hunter: {
    label: "Webサイト探索（Website Hunter）",
    description: "探索的リサーチ。理由・場面を引き出し、調査品質を優先する。",
    policy: {
      researchType: "exploratory_research",
      audience: "general",
      probeStyle: "reason_and_scene",
      restrictions: ["no_leading_question", "no_internal_codes"],
      priority: "research_quality_first",
    },
  },
  interview: {
    label: "インタビュー",
    description: "インタビューリサーチ。感情・背景を引き出し、調査品質を優先する。",
    policy: {
      researchType: "interview_research",
      audience: "general",
      probeStyle: "emotion_and_context",
      restrictions: ["no_leading_question", "one_question_only", "no_internal_codes"],
      priority: "research_quality_first",
    },
  },
  animal_hospital: {
    label: "動物病院",
    description: "飼い主向け。やさしいトーンで感情・背景を受け止め、回答者の負担を軽減する。",
    policy: {
      researchType: "standard_research",
      audience: "senior_friendly",
      probeStyle: "emotion_and_context",
      restrictions: ["no_medical_legal_financial_claim", "no_leading_question", "no_internal_codes"],
      priority: "respondent_comfort_first",
    },
  },
};

/**
 * 用途プリセットから Version 1 の初期テンプレート（全21キー）を生成する。
 * 各キーを enabled=true で実体化し、本文は templateOverrides ?? BASE 本文。
 * これにより作成直後に「21/21 定義済み」状態になる（空Version撲滅）。
 */
export function buildInitialTemplatesForPreset(preset: PromptPresetKey): AIPromptTemplateMap {
  const def = PROMPT_PRESETS[preset] ?? PROMPT_PRESETS.standard;
  const overrides = def.templateOverrides ?? {};
  const map: AIPromptTemplateMap = {};
  for (const key of ALL_PROMPT_KEYS) {
    map[key] = {
      enabled: true,
      template: overrides[key] ?? BASE_PROMPT_TEMPLATES[key].template,
    };
  }
  return map;
}

export interface TemplateDefinitionSummary {
  /** 全キー数（21） */
  total: number;
  /** 定義済み（custom + base） */
  defined: number;
  /** カスタム本文あり */
  custom: number;
  /** enabled だが本文なし（実行時 BASE 利用） */
  base: number;
  /** enabled=false（無効化） */
  disabled: number;
}

/**
 * パッケージバージョンの templates_json から定義率サマリーを算出する。
 * - custom   : enabled かつ template 非空
 * - base     : enabled かつ template 空（実行時 BASE_PROMPT_TEMPLATES にフォールバック）
 * - disabled : enabled=false
 * - 未登録キーは base 扱い（実行時 BASE フォールバックのため）
 */
export function summarizeTemplateDefinitions(
  templates: AIPromptTemplateMap | null | undefined
): TemplateDefinitionSummary {
  const total = ALL_PROMPT_KEYS.length;
  let custom = 0;
  let base = 0;
  let disabled = 0;
  for (const key of ALL_PROMPT_KEYS) {
    const entry = templates?.[key];
    if (entry && entry.enabled === false) {
      disabled += 1;
    } else if (entry && typeof entry.template === "string" && entry.template.trim() !== "") {
      custom += 1;
    } else {
      base += 1;
    }
  }
  return { total, defined: custom + base, custom, base, disabled };
}

/** 管理画面表示用に許可プレースホルダーの説明を返す */
export function describePlaceholder(key: string): string {
  const map: Record<string, string> = {
    sessionSummary: "セッション要約テキスト",
    answers: "回答一覧 (JSON)",
    answer: "現在の回答テキスト",
    questionText: "質問文",
    questionCode: "質問コード",
    questionType: "質問タイプ",
    existingSlots: "収集済みスロット (JSON)",
    slotGuide: "期待スロット一覧（renderSlotGuide）",
    probeTypeGuidance: "深掘りタイプガイダンス（buildProbeTypeGuidance）",
    questionObjectiveGuide: "質問目的ガイド（renderQuestionObjectiveGuide）",
    answerOptions: "回答選択肢（renderAnswerOptionsForPrompt）",
    projectAIStateGuide: "プロジェクトAI状態ガイド（renderProjectAIStateGuide）",
    sharedSections: "共通セクション（buildSharedSections）",
    probeGuideline: "カスタム深掘りガイドライン",
    freeCommentPolicy: "自由コメントポリシー",
    modeStyleGuide: "モード別スタイルガイド",
    previousSummary: "直前のセッション要約",
    recentTranscript: "直近の会話トランスクリプト",
    probeType: "深掘りタイプ",
    extractedSlots: "抽出済みスロット (JSON)",
    completion: "完了状態オブジェクト (JSON)",
    missingSlots: "未取得スロット一覧 (JSON)",
    probeConfig: "深掘り設定 (JSON)",
    completionConditions: "完了条件 (JSON)",
    badAnswerPatterns: "不良回答パターン (JSON)",
    renderStyle: "レンダリングスタイル (JSON)",
    questionConfig: "質問設定 (JSON)",
    probeGoal: "深掘りゴール",
    previousAnswer: "直前の回答テキスト",
    previousQuestion: "直前の質問テキスト",
    projectGoal: "プロジェクトゴール",
    userUnderstandingGoal: "ユーザー理解ゴール",
    projectLanguage: "言語設定",
    strictTopicLock: "トピックロック設定",
    projectRequiredSlots: "プロジェクト必須スロット一覧",
    currentRequiredSlots: "現在質問の必須スロット一覧",
    currentOptionalSlots: "現在質問の任意スロット一覧",
    nextRequiredSlots: "次質問の必須スロット一覧",
    aiProbeEnabled: "AI深掘り有効フラグ",
    currentProbeCount: "現在の深掘り回数",
    maxProbes: "最大深掘り回数",
    projectRequiredSlotKeys: "プロジェクト必須スロットキー (JSON)",
    requiredInformation: "収集必須情報一覧",
    question: "質問テキスト",
    collectedSoFar: "収集済み情報 (JSON)",
    probeCount: "深掘りカウンター表示",
    nextQuestion: "次の質問",
    canProbe: "深掘り可否フラグ説明",
    questionRole: "質問ロール",
    // Phase 7-A: B1〜B7 用プレースホルダー
    projectName: "プロジェクト名",
    clientName: "クライアント名",
    objective: "プロジェクト目的",
    researchMode: "リサーチモード",
    // Phase 7-B: 管理ツール系プレースホルダー
    currentQuestionType: "現在の回答形式（question_type）",
    typeInstruction: "回答形式別の提案指示文（コードで生成）",
    responseFormat: "期待するJSONレスポンス形式のサンプル（コードで生成）",
    targetProjectName: "流用先プロジェクト名",
    targetProjectObjective: "流用先調査目的",
    sourceProjectName: "流用元プロジェクト名",
    sourceProjectObjective: "流用元調査目的",
    questionsJson: "流用元設問リスト (JSON)",
    attributeList: "属性不足リスト（attr_key・カバレッジ付き）",
    primaryObjectives: "主目的一覧（renderList）",
    secondaryObjectives: "副目的一覧（renderList）",
    comparisonConstraints: "比較制約一覧（renderList）",
    promptRules: "プロンプトルール一覧（renderList）",
    templateKey: "推奨AI状態テンプレートキー",
    templateLabel: "推奨AI状態テンプレートラベル",
    templateDescription: "推奨AI状態テンプレート説明",
    templateStateExample: "推奨AI状態テンプレート例 (JSON)",
    respondentSummaries: "回答者サマリー一覧 (JSON)",
    comparisonUnits: "比較ユニット一覧 (JSON)",
    freeAnswerPolicy: "自由回答ポリシー (JSON)",
    postType: "投稿タイプ",
    sourceMode: "投稿時のリサーチモード",
    content: "投稿テキスト",
    postText: "投稿内容（カウンセラー返信対象）",
    selectedTags: "選択タグ（「、」区切り）",
    postAnalyses: "投稿分析データ一覧（整形済みテキスト）"
  };
  return map[key] ?? key;
}
