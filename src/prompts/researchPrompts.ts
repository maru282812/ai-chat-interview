import { getProjectResearchSettings } from "../lib/projectResearch";
import { getProjectAIState, type ProjectAIStateTemplateDefinition } from "../lib/projectAiState";
import { normalizeQuestionMeta, resolveAnswerAnalysisContext } from "../lib/questionMetadata";
import type {
  Project,
  Question,
  QuestionExpectedSlot,
  ResearchMode,
  StructuredAnswerCompletion,
  StructuredAnswerSlotValue,
  StructuredProbeType
} from "../types/domain";

type PromptPurpose =
  | "question_render"
  | "probe_generation"
  | "slot_filling"
  | "completion_check"
  | "summary"
  | "analysis";

function modeLabel(mode: ResearchMode): string {
  switch (mode) {
    case "interview":
      return "interview";
    case "survey_with_interview_probe":
      return "survey_with_interview_probe";
    default:
      return "survey";
  }
}

function modeInstruction(mode: ResearchMode, purpose: PromptPurpose): string {
  if (purpose === "question_render") {
    switch (mode) {
      case "interview":
        return "Render the next question as a natural interviewer utterance. Do not expose question numbers or internal codes.";
      case "survey_with_interview_probe":
        return "Keep the question concise and survey-first, but make the wording feel natural.";
      default:
        return "Keep the wording clear and concise for structured survey response capture.";
    }
  }

  if (purpose === "probe_generation") {
    switch (mode) {
      case "interview":
        return "Ask one natural follow-up that deepens context, motive, or concrete detail.";
      case "survey_with_interview_probe":
        return "Ask one light follow-up only when it improves comparable insight.";
      default:
        return "Ask one follow-up only when it materially improves structured understanding.";
    }
  }

  if (purpose === "slot_filling") {
    return "Extract structured slots conservatively from the answer and follow-up context.";
  }

  if (purpose === "completion_check") {
    return "Judge whether the answer is complete enough for comparison and whether a follow-up is still needed.";
  }

  if (purpose === "summary") {
    switch (mode) {
      case "interview":
        return "Preserve the evolving respondent context and decision logic.";
      case "survey_with_interview_probe":
        return "Summarize the main answer first, then only the useful probe detail.";
      default:
        return "Compress the answer stream into the smallest useful factual summary.";
    }
  }

  switch (mode) {
    case "interview":
      return "Analyze as an interview: preserve reasoning, context, and decision process.";
    case "survey_with_interview_probe":
      return "Analyze as survey answers with limited probe detail. Keep common comparisons central.";
    default:
      return "Analyze as structured survey data first and qualitative support second.";
  }
}

function renderList(title: string, items: string[], emptyText: string): string {
  if (items.length === 0) {
    return `${title}\n- ${emptyText}`;
  }

  return `${title}\n${items.map((item) => `- ${item}`).join("\n")}`;
}

function renderSlotGuide(slots: QuestionExpectedSlot[]): string {
  if (slots.length === 0) {
    return "Expected slots\n- none";
  }

  return [
    "Expected slots",
    ...slots.map((slot) =>
      [
        `- key: ${slot.key}`,
        `label: ${slot.label ?? slot.key}`,
        `required: ${slot.required !== false}`,
        `description: ${slot.description ?? "none"}`,
        `examples: ${(slot.examples ?? []).join(" | ") || "none"}`
      ].join(", ")
    )
  ].join("\n");
}

function renderFutureSlotGuide(question: Question | null | undefined, slots: QuestionExpectedSlot[]): string {
  if (!question || slots.length === 0) {
    return "Future-prefill slot candidates\n- none";
  }

  return [
    `Future-prefill slot candidates for next question (${question.question_code})`,
    ...slots.map((slot) =>
      [
        `- key: ${slot.key}`,
        `label: ${slot.label ?? slot.key}`,
        `required: ${slot.required !== false}`,
        `description: ${slot.description ?? "none"}`,
        `examples: ${(slot.examples ?? []).join(" | ") || "none"}`
      ].join(", ")
    )
  ].join("\n");
}

function renderJapaneseSlotList(title: string, slots: QuestionExpectedSlot[], emptyText: string): string {
  if (slots.length === 0) {
    return `${title}:\n- ${emptyText}`;
  }

  return [
    `${title}:`,
    ...slots.map((slot) => {
      const parts = [slot.label ?? slot.key];
      if (slot.description) {
        parts.push(slot.description);
      }
      if (Array.isArray(slot.examples) && slot.examples.length > 0) {
        parts.push(`例: ${slot.examples.join(" / ")}`);
      }
      return `- ${parts.join(" / ")}`;
    })
  ].join("\n");
}

function renderQuestionObjectiveGuide(input: {
  researchGoal: string | null;
  questionGoal: string | null;
  strictTopicLock: boolean;
  allowFollowupExpansion: boolean;
}): string {
  const rules = [
    "\u4ee5\u4e0b\u3092\u53b3\u5b88\u3057\u3066\u304f\u3060\u3055\u3044:",
    "\u30fb\u76ee\u7684\u306b\u95a2\u4fc2\u306e\u306a\u3044\u8cea\u554f\u306f\u7981\u6b62",
    "\u30fb\u65b0\u3057\u3044\u8a71\u984c\u3092\u51fa\u3055\u306a\u3044",
    "\u30fb\u56de\u7b54\u306e\u4e0d\u8db3\u90e8\u5206\u306e\u307f\u3092\u6df1\u6398\u308a\u3059\u308b"
  ];

  if (input.strictTopicLock) {
    rules.push("\u30fb\u73fe\u5728\u306e\u8cea\u554f\u306e research_goal \u304b\u3089\u9038\u8131\u3057\u3066\u306f\u3044\u3051\u306a\u3044");
    rules.push("\u30fb\u5225\u30b8\u30e3\u30f3\u30eb\u306e\u8a71\u984c\u3092\u51fa\u3057\u3066\u306f\u3044\u3051\u306a\u3044");
    rules.push("\u30fb\u4f8b\u793a\u3082\u540c\u30b8\u30e3\u30f3\u30eb\u306e\u307f\u8a31\u53ef");
  }

  if (!input.allowFollowupExpansion) {
    rules.push("\u30fb\u8a71\u984c\u3092\u5e83\u3052\u305a\u3001\u4eca\u306e\u8cea\u554f\u306e\u4e0d\u8db3\u90e8\u5206\u3060\u3051\u3092\u88dc\u3046");
  }

  return [
    "\u3053\u306e\u8cea\u554f\u306e\u76ee\u7684:",
    input.questionGoal ?? "not set",
    "",
    "\u8abf\u67fb\u306e\u76ee\u7684:",
    input.researchGoal ?? "not set",
    "",
    ...rules
  ].join("\n");
}

function renderProjectAIStateGuide(project: Project): string {
  const aiState = getProjectAIState(project);
  return [
    "Project AI state",
    `- project_goal: ${aiState.project_goal || "not set"}`,
    `- user_understanding_goal: ${aiState.user_understanding_goal || "not set"}`,
    `- question_categories: ${aiState.question_categories.join(" / ") || "none"}`,
    `- required_slots: ${aiState.required_slots.map((slot) => slot.label).join(" / ") || "none"}`,
    `- optional_slots: ${aiState.optional_slots.map((slot) => slot.label).join(" / ") || "none"}`,
    `- completion_required_slots: ${aiState.completion_rule.required_slots_needed.join(" / ") || "none"}`,
    `- allow_finish_without_optional: ${aiState.completion_rule.allow_finish_without_optional}`,
    `- default_max_probes: ${aiState.probe_policy.default_max_probes}`,
    `- force_probe_on_bad: ${aiState.probe_policy.force_probe_on_bad}`,
    `- strict_topic_lock: ${aiState.probe_policy.strict_topic_lock}`,
    `- forbidden_topic_shift: ${aiState.topic_control.forbidden_topic_shift}`,
    `- language: ${aiState.language}`
  ].join("\n");
}

function buildSharedSections(project: Project, purpose: PromptPurpose): string[] {
  const settings = getProjectResearchSettings(project);
  const absoluteRules = [
    "Do not invent facts that are not grounded in the answers.",
    "Keep wording suitable for short LINE-based conversations.",
    "Ask or summarize one point at a time.",
    "Prefer comparable observations over flashy anecdotes.",
    "Keep output concise and readable.",
    "Use primary objectives as the center of gravity.",
    "Use secondary objectives as supporting context."
  ];

  return [
    "You are supporting a LINE research project.",
    `Research mode: ${modeLabel(settings.research_mode)} (${settings.research_mode})`,
    modeInstruction(settings.research_mode, purpose),
    project.ai_state_json ? renderProjectAIStateGuide(project) : "Project AI state: not generated",
    project.ai_state_json
      ? "Raw project objective is intentionally omitted because project_ai_state should be the main execution context."
      : project.objective
        ? `Project objective: ${project.objective}`
        : "Project objective: not set",
    project.ai_state_json
      ? "Primary/secondary objectives are intentionally compressed into project_ai_state."
      : renderList("Primary objectives", settings.primary_objectives, "not set"),
    project.ai_state_json
      ? ""
      : renderList("Secondary objectives", settings.secondary_objectives, "not set"),
    project.ai_state_json
      ? "Comparison constraints are intentionally compressed into project_ai_state."
      : renderList("Comparison constraints", settings.comparison_constraints, "not set"),
    project.ai_state_json
      ? "Project prompt rules are intentionally compressed into project_ai_state."
      : renderList("Project prompt rules", settings.prompt_rules, "not set"),
    renderList("Absolute rules", absoluteRules, "none"),
    [
      "Response style",
      `- channel: ${settings.response_style.channel}`,
      `- tone: ${settings.response_style.tone}`,
      `- max_characters_per_message: ${settings.response_style.max_characters_per_message}`,
      `- max_sentences: ${settings.response_style.max_sentences}`
    ].join("\n")
  ].filter((section) => Boolean(section));
}

export function buildProjectInitialStatePrompt(input: {
  project: Pick<
    Project,
    | "name"
    | "client_name"
    | "objective"
    | "research_mode"
    | "primary_objectives"
    | "secondary_objectives"
    | "comparison_constraints"
    | "prompt_rules"
  >;
  template: ProjectAIStateTemplateDefinition;
}): string {
  return [
    "Return JSON only.",
    "The output language must be Japanese.",
    "JSON keys must stay in English.",
    "Do not wrap the JSON in markdown fences.",
    "Do not add explanation outside JSON.",
    "You are generating the project-level AI initial state for a LINE interview system.",
    "This state will be reused at runtime to reduce repeated interpretation cost.",
    "The state must define what information should be collected at the project level, not at a single-question level.",
    "Required top-level keys: version, template_key, project_goal, user_understanding_goal, required_slots, optional_slots, question_categories, probe_policy, completion_rule, topic_control, language",
    "required_slots and optional_slots must be arrays of objects with keys: key, label, required, description, examples",
    "question_categories must be a Japanese string array.",
    "probe_policy keys: default_max_probes, force_probe_on_bad, strict_topic_lock, allow_followup_expansion",
    "completion_rule keys: required_slots_needed, allow_finish_without_optional, min_required_slots_to_finish",
    "topic_control keys: forbidden_topic_shift, topic_lock_note",
    "Use concise, practical Japanese labels for admin UI.",
    "Prefer 3 to 5 required slots and 0 to 5 optional slots.",
    "Set strict_topic_lock and forbidden_topic_shift to true unless the project obviously requires wider exploration.",
    "default_max_probes should usually be 1 and at most 2.",
    `Project name: ${input.project.name}`,
    `Client name: ${input.project.client_name ?? "not set"}`,
    `Objective: ${input.project.objective ?? "not set"}`,
    `Research mode: ${input.project.research_mode}`,
    renderList("Primary objectives", input.project.primary_objectives ?? [], "not set"),
    renderList("Secondary objectives", input.project.secondary_objectives ?? [], "not set"),
    renderList("Comparison constraints", input.project.comparison_constraints ?? [], "not set"),
    renderList("Prompt rules", input.project.prompt_rules ?? [], "not set"),
    `Recommended template key: ${input.template.key}`,
    `Recommended template label: ${input.template.label}`,
    `Recommended template description: ${input.template.description}`,
    `Recommended template state example: ${JSON.stringify(input.template.state)}`,
    "Optimize for a reusable project blueprint that humans can inspect and edit in the admin UI."
  ].join("\n\n");
}

export function buildQuestionRenderingPrompt(input: {
  project: Project;
  question: Question;
  previousQuestionText?: string | null;
  previousAnswerText?: string | null;
}): string {
  const meta = normalizeQuestionMeta(
    input.question,
    input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
    { projectAiState: input.project.ai_state_json }
  );

  return [
    ...buildSharedSections(input.project, "question_render"),
    "Write exactly one question for the respondent.",
    "Do not show internal question numbers such as Q1 or internal codes.",
    "Keep the internal meaning of the question intact.",
    "Do not convert the topic into a different category or analogy.",
    "If there is a previous answer, connect naturally from it.",
    "For interview mode, make it sound like a human interviewer.",
    "Output only the user-facing question text.",
    `Internal question code: ${input.question.question_code}`,
    `Internal question text: ${input.question.question_text}`,
    `Question type: ${input.question.question_type}`,
    `Question role: ${input.question.question_role}`,
    `Render style: ${JSON.stringify(meta.render_style)}`,
    renderQuestionObjectiveGuide({
      researchGoal: meta.research_goal,
      questionGoal: meta.question_goal,
      strictTopicLock: meta.probe_config.strict_topic_lock,
      allowFollowupExpansion: meta.probe_config.allow_followup_expansion
    }),
    renderSlotGuide(meta.expected_slots),
    `Previous question text: ${input.previousQuestionText ?? "none"}`,
    `Previous answer text: ${input.previousAnswerText ?? "none"}`,
    `Question config: ${JSON.stringify(input.question.question_config ?? {})}`
  ].join("\n\n");
}

export function buildProbeGenerationPrompt(input: {
  project: Project;
  question: Question;
  answer: string;
  extractedSlots: StructuredAnswerSlotValue[];
  completion: StructuredAnswerCompletion | null;
  probeType: StructuredProbeType;
  missingSlots: string[];
  previousAnswerText?: string | null;
  sessionSummary: string;
}): string {
  const meta = normalizeQuestionMeta(
    input.question,
    input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
    { projectAiState: input.project.ai_state_json }
  );

  return [
    ...buildSharedSections(input.project, "probe_generation"),
    "Return JSON only.",
    'Required keys: probe_question, probe_type, focus',
    "Ask exactly one follow-up question.",
    "Do not repeat the original question verbatim.",
    "Do not ask multiple questions.",
    "Do not mention internal codes or slots by name.",
    "Do not ignore the user's answer and jump to a new question.",
    "Do not transform the topic into another category.",
    `Probe type: ${input.probeType}`,
    `Question code: ${input.question.question_code}`,
    `Question text: ${input.question.question_text}`,
    `Answer: ${input.answer}`,
    `Previous answer text: ${input.previousAnswerText ?? "none"}`,
    `Extracted slots: ${JSON.stringify(input.extractedSlots)}`,
    `Completion: ${JSON.stringify(input.completion)}`,
    `Missing slots: ${JSON.stringify(input.missingSlots)}`,
    renderQuestionObjectiveGuide({
      researchGoal: meta.research_goal,
      questionGoal: meta.question_goal,
      strictTopicLock: meta.probe_config.strict_topic_lock,
      allowFollowupExpansion: meta.probe_config.allow_followup_expansion
    }),
    `Probe goal: ${meta.probe_goal ?? "none"}`,
    `Probe config: ${JSON.stringify(meta.probe_config)}`,
    `Session summary: ${input.sessionSummary || "none"}`
  ].join("\n\n");
}

export function buildAnalyzeAnswerPrompt(input: {
  project: Project;
  question: Question;
  nextQuestion?: Question | null;
  answer: string;
  existingSlots: Record<string, string | null>;
  maxProbes: number;
  aiProbeEnabled: boolean;
  currentProbeCount: number;
}): string {
  const context = resolveAnswerAnalysisContext({
    project: input.project,
    question: input.question,
    nextQuestion: input.nextQuestion,
    contextType:
      input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode
  });
  const projectAiState = getProjectAIState(input.project);

  return [
    "あなたは消費者インタビューを行うAIです。",
    "",
    "# 目的",
    "このインタビューの目的は以下です:",
    context.project_goal || "現在の案件で本質的に知りたい情報を集めること",
    "",
    "あなたの役割は、回答者の発言から「本質的に知りたい情報」を引き出すことです。",
    "",
    "# 絶対ルール",
    "- 質問は必ず現在の設問の意図に沿うこと",
    "- 関係ない話題に絶対に逸れない（topic lock）",
    "- 他の案件や過去の文脈を絶対に混ぜない",
    "- 回答者が不快に感じる繰り返し質問は禁止",
    "- すでに回答されている内容は再質問しない",
    "",
    "# スロット定義",
    "今回収集すべき情報:",
    "",
    renderJapaneseSlotList(
      "必須",
      context.required_slots,
      "現在の設問で知りたい具体情報を日本語で整理してください"
    ),
    "",
    renderJapaneseSlotList(
      "任意",
      context.optional_slots,
      "任意スロットが未設定なら、補足的に得られた具体情報だけを扱ってください"
    ),
    "",
    "# 現在の状況",
    `現在の設問:\n${input.question.question_text}`,
    `回答:\n${input.answer}`,
    `現在取得済みスロット:\n${JSON.stringify(input.existingSlots)}`,
    "",
    "# 判断ルール",
    "",
    "## ① 回答の質判定",
    "以下の場合は「不十分」と判断:",
    "- 特になし / わからない / ない",
    "- 抽象的（例: なんとなく、普通）",
    "- 短すぎる（具体性なし）",
    "",
    "## ② 深堀り条件",
    "以下すべて満たす場合のみ深堀り:",
    `- AI深堀りがON: ${input.aiProbeEnabled}`,
    `- probe回数 < max_probes: ${input.currentProbeCount} < ${input.maxProbes}`,
    "- 回答が不十分 or スロット未充足",
    "",
    "## ③ スキップ条件",
    "以下すべて満たす場合のみ次設問スキップ:",
    "- 現設問のrequired_slotsが埋まっている",
    "- 次設問のrequired_slotsも埋まっている",
    "- 回答が具体的（bad answerではない）",
    "",
    "## ④ 終了条件",
    "以下のみ:",
    "- projectのrequired_slotsが全て埋まった",
    "",
    "# 補足コンテキスト",
    `現在の設問の補助目的:\n${context.user_understanding_goal ?? "未設定"}`,
    renderJapaneseSlotList(
      "次設問の必須スロット",
      context.next_question_required_slots,
      "次設問の必須スロットは未設定です"
    ),
    `project required slots:\n${JSON.stringify(context.project_required_slot_keys)}`,
    `strict_topic_lock: ${context.strict_topic_lock}`,
    `required_slots source: ${context.sources.required_slots}`,
    `optional_slots source: ${context.sources.optional_slots}`,
    `max_probes source: ${context.sources.max_probes}`,
    `strict_topic_lock source: ${context.sources.strict_topic_lock}`,
    `project_ai_state language: ${projectAiState.language}`,
    "",
    "# 出力ルール",
    "必ず以下のJSON形式で返す:",
    "",
    "{",
    '  "action": "ask_next | probe | skip | finish",',
    '  "question": "ユーザーに見せる質問（日本語）",',
    '  "reason": "内部理由",',
    '  "collected_slots": {},',
    '  "is_sufficient": true',
    "}",
    "",
    "action が probe 以外のときは question を空文字にしてください。",
    "collected_slots には、今回の回答から根拠を持って確定できる値だけを入れてください。",
    "internal slot key は user-facing question にそのまま出さないでください。",
    "user-facing output は日本語のみで、英語混入は禁止です。",
    "",
    "# 質問生成ルール",
    "- 自然な日本語で話す",
    "- 設問番号は使わない（interviewモード）",
    "- 1回の質問は1意図のみ",
    "- 抽象的な言葉は禁止（usage_sceneなど）",
    "",
    "# 深堀りルール",
    "NG:",
    "- 同じ質問の言い換え",
    "- 意味不明な抽象質問",
    "",
    "OK:",
    "- 「いつ」「どこで」「なぜ」「具体例」",
    "",
    "JSON以外は出力しないでください。"
  ].join("\n");
}

export function buildSlotFillingPrompt(input: {
  project: Project;
  question: Question;
  answer: string;
  probeAnswer?: string | null;
}): string {
  const meta = normalizeQuestionMeta(
    input.question,
    input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
    { projectAiState: input.project.ai_state_json }
  );

  return [
    ...buildSharedSections(input.project, "slot_filling"),
    "Return JSON only.",
    'Required keys: structured_summary, extracted_slots, comparable_payload',
    "extracted_slots must be an array of objects with keys: key, value, confidence, evidence",
    "Use null when a slot is not supported by the answer.",
    "Do not infer facts that are not clearly stated.",
    `Question code: ${input.question.question_code}`,
    `Question text: ${input.question.question_text}`,
    renderQuestionObjectiveGuide({
      researchGoal: meta.research_goal,
      questionGoal: meta.question_goal,
      strictTopicLock: meta.probe_config.strict_topic_lock,
      allowFollowupExpansion: meta.probe_config.allow_followup_expansion
    }),
    renderSlotGuide(meta.expected_slots),
    `Primary answer: ${input.answer}`,
    `Probe answer: ${input.probeAnswer ?? "none"}`
  ].join("\n\n");
}

export function buildCompletionCheckPrompt(input: {
  project: Project;
  question: Question;
  answer: string;
  extractedSlots: StructuredAnswerSlotValue[];
}): string {
  const meta = normalizeQuestionMeta(
    input.question,
    input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode,
    { projectAiState: input.project.ai_state_json }
  );

  return [
    ...buildSharedSections(input.project, "completion_check"),
    "Return JSON only.",
    'Required keys: is_complete, missing_slots, reasons, quality_score',
    "Judge strictly but pragmatically.",
    "is_complete must be true only when all expected_slots are filled, bad patterns are absent, and quality_score is high enough.",
    "quality_score must be an integer from 0 to 100.",
    "If the answer is too abstract or matches bad answer patterns, include a reason.",
    `Question code: ${input.question.question_code}`,
    `Question text: ${input.question.question_text}`,
    `Completion conditions: ${JSON.stringify(meta.completion_conditions)}`,
    `Bad answer patterns: ${JSON.stringify(meta.bad_answer_patterns)}`,
    renderQuestionObjectiveGuide({
      researchGoal: meta.research_goal,
      questionGoal: meta.question_goal,
      strictTopicLock: meta.probe_config.strict_topic_lock,
      allowFollowupExpansion: meta.probe_config.allow_followup_expansion
    }),
    renderSlotGuide(meta.expected_slots),
    `Answer: ${input.answer}`,
    `Extracted slots: ${JSON.stringify(input.extractedSlots)}`
  ].join("\n\n");
}

export function buildSessionSummaryPrompt(input: {
  project: Project;
  previousSummary: string;
  recentTranscript: string;
}): string {
  return [
    ...buildSharedSections(input.project, "summary"),
    "Update the session summary using the recent transcript.",
    "Keep it factual, compact, and cumulative.",
    "Maximum length: 200 Japanese characters or equivalent brevity.",
    `Previous summary: ${input.previousSummary || "none"}`,
    `Recent transcript: ${input.recentTranscript}`,
    "Output summary text only."
  ].join("\n\n");
}

export function buildFinalStructuredSummaryPrompt(input: {
  project: Project;
  sessionSummary: string;
  answers: Array<{
    question_code: string;
    question_text: string;
    answer_text: string;
    normalized_answer: Record<string, unknown> | null;
  }>;
}): string {
  return [
    ...buildSharedSections(input.project, "analysis"),
    "Return JSON only.",
    "Required top-level keys: summary, usage_scene, motive, pain_points, alternatives, desired_state, insight_candidates, user_understanding, structured_answers",
    "Organize the final summary by user understanding unit, not by question order.",
    "user_understanding should be an object that integrates context, behaviors, motivations, blockers, desired outcomes, and notable evidence across all answers.",
    "structured_answers must be an object keyed by question_code.",
    "Each structured_answers item should contain question_text, answer_text, structured_summary, extracted_slots, completion.",
    "Use extracted slots to build comparable qualitative structure.",
    "Do not exaggerate. Prefer patterns supported by the answers.",
    `Session summary: ${input.sessionSummary || "none"}`,
    `Answers: ${JSON.stringify(input.answers)}`
  ].join("\n\n");
}

export function buildProjectAnalysisPrompt(input: {
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
}): string {
  return [
    ...buildSharedSections(input.project, "analysis"),
    "Return JSON only.",
    "Use primary objectives as the main axis of analysis.",
    "Use secondary objectives only as supporting context.",
    "Keep each respondent summary concise.",
    "When comparing multiple respondents, prioritize common viewpoints and repeated patterns.",
    "Do not let unusual or entertaining single responses dominate the conclusion.",
    "Prefer structured comparison units first. Use free-text answers as qualitative support.",
    "Required JSON keys:",
    "executive_summary",
    "overall_trends",
    "primary_objectives",
    "secondary_objectives",
    "comparison_focus",
    "free_answer_policy",
    "respondent_summaries",
    "JSON shape hints:",
    '- overall_trends: string[]',
    '- primary_objectives: [{"objective":"...","summary":"...","evidence":["..."]}]',
    '- secondary_objectives: [{"objective":"...","summary":"...","evidence":["..."]}]',
    '- comparison_focus: [{"unit":"...","summary":"..."}]',
    '- free_answer_policy: {"summary":"...","target_question_codes":["..."]}',
    '- respondent_summaries: [{"respondent_id":"...","summary":"..."}]',
    `Respondent summaries input: ${JSON.stringify(input.respondentSummaries)}`,
    `Comparison units input: ${JSON.stringify(input.comparisonUnits)}`,
    `Free answer policy input: ${JSON.stringify(input.freeAnswerPolicy)}`
  ].join("\n\n");
}

export function buildPostAnalysisPrompt(input: {
  postType: string;
  sourceMode: string | null;
  content: string;
}): string {
  return [
    "You analyze a single user post from a LINE-based research product.",
    "Return JSON only.",
    "Required keys: summary, tags, sentiment, keywords, actionability, insight_type, specificity, novelty",
    "sentiment must be one of: positive, neutral, negative, mixed",
    "actionability must be one of: high, medium, low",
    "insight_type must be one of: issue, request, complaint, praise, other",
    "specificity and novelty must be integers from 0 to 100",
    "tags and keywords must be JSON arrays of short strings.",
    "Do not invent facts outside the text.",
    "summary should be concise and useful for enterprise review.",
    `Post type: ${input.postType}`,
    `Source mode: ${input.sourceMode ?? "none"}`,
    `Content: ${input.content}`
  ].join("\n\n");
}

export function buildProbePrompt(input: {
  project: Project;
  question: string;
  answer: string;
  sessionSummary: string;
}): string {
  return [
    ...buildSharedSections(input.project, "probe_generation"),
    "Write exactly one short follow-up question.",
    "Do not repeat the original question.",
    "Do not ask multiple questions.",
    "Do not change the topic or introduce a different category.",
    `Current question: ${input.question}`,
    `Answer: ${input.answer}`,
    `Session summary: ${input.sessionSummary || "none"}`,
    "Output only the follow-up question text."
  ].join("\n\n");
}

export function buildFinalAnalysisPrompt(input: {
  project: Project;
  sessionSummary: string;
  answers: string;
}): string {
  return [
    ...buildSharedSections(input.project, "analysis"),
    "Return JSON only.",
    "Required keys: summary, usage_scene, motive, pain_points, alternatives, insight_candidates",
    "Do not exaggerate. Prefer patterns that are supported by the answers.",
    `Session summary: ${input.sessionSummary || "none"}`,
    `Answers: ${input.answers}`
  ].join("\n\n");
}
