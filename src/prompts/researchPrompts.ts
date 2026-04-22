import { getProjectResearchSettings } from "../lib/projectResearch";
import { getProjectAIState, type ProjectAIStateTemplateDefinition } from "../lib/projectAiState";
import { normalizeQuestionMeta, resolveAnswerAnalysisContext } from "../lib/questionMetadata";
import type {
  Project,
  ProjectAIState,
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
    default:
      return "survey_interview";
  }
}

function modeInstruction(mode: ResearchMode, purpose: PromptPurpose): string {
  if (purpose === "question_render") {
    switch (mode) {
      case "interview":
        return "Render the next question as a natural interviewer utterance. Do not expose question numbers or internal codes.";
      default:
        return "Keep the question concise and survey-first, but make the wording feel natural.";
    }
  }

  if (purpose === "probe_generation") {
    switch (mode) {
      case "interview":
        return "Ask one natural follow-up that deepens context, motive, or concrete detail.";
      default:
        return "Ask one light follow-up only when it improves comparable insight for the structured flow.";
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
      default:
        return "Summarize the main answer first, then only the useful probe detail.";
    }
  }

  switch (mode) {
    case "interview":
      return "Analyze as an interview: preserve reasoning, context, and decision process.";
    default:
      return "Analyze as survey answers with limited probe detail. Keep common comparisons central.";
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
  ]
    .filter((value): value is string => Boolean(value))
    .join("\n");
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
    "以下を厳守してください:",
    "・目的に関係のない質問は禁止",
    "・新しい話題を出さない",
    "・回答の不足部分のみを深掘りする"
  ];

  if (input.strictTopicLock) {
    rules.push("・現在の質問の research_goal から逸脱してはいけない");
    rules.push("・別ジャンルの話題を出してはいけない");
    rules.push("・例示も同ジャンルのみ許可");
  }

  if (!input.allowFollowupExpansion) {
    rules.push("・話題を広げず、今の質問の不足部分だけを補う");
  }

  return [
    "この質問の目的:",
    input.questionGoal ?? "not set",
    "",
    "調査の目的:",
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

/**
 * 選択肢系・数値系の質問について、利用可能な選択肢をプロンプト用テキストに変換する。
 * 選択肢がない質問タイプや選択肢未設定の場合は null を返す。
 */
function renderAnswerOptionsForPrompt(question: Question): string | null {
  const options = question.question_config?.options ?? [];
  const type = question.question_type;

  if (
    ["single_choice", "multi_choice", "single_select", "multi_select", "text_with_image", "sd"].includes(type) &&
    options.length > 0
  ) {
    return options.map((o, i) => `  ${i + 1}. [${o.value}] ${o.label}`).join("\n");
  }

  if (type === "yes_no") {
    const opts =
      options.length > 0
        ? options
        : [
            { value: "yes", label: "はい" },
            { value: "no", label: "いいえ" }
          ];
    return opts.map((o, i) => `  ${i + 1}. [${o.value}] ${o.label}`).join("\n");
  }

  if (type === "scale") {
    const min = (question.question_config as Record<string, unknown> | null)?.scale_min ?? 1;
    const max = (question.question_config as Record<string, unknown> | null)?.scale_max ?? 5;
    return `  数値スケール: ${min}〜${max}`;
  }

  if (type === "numeric") {
    return `  数値入力`;
  }

  return null;
}

/**
 * 質問タイプに応じた汎用深掘りガイダンスを返す。
 * 特定設問・特定選択肢・特定の回答例に依存したハードコードは含まない。
 */
function buildProbeTypeGuidance(questionType: string, aiProbeEnabled: boolean): string {
  const TEXT_TYPES = new Set(["text", "free_text_short", "free_text_long"]);
  const CHOICE_TYPES = new Set(["single_choice", "multi_choice", "yes_no", "single_select", "multi_select", "text_with_image"]);
  const NUMERIC_TYPES = new Set(["numeric", "scale", "sd"]);

  const commonRules = [
    "深掘り判定の共通ルール（この順序で判断する）:",
    "1. 不足スロット優先: expected_slots に未取得の情報がある場合、そのスロットを埋める質問を最優先する。",
    "2. 「特になし」「ない」「わからない」などの辞退回答: そのまま受け入れず、「強いて言うなら」「少しでも気になる点は」「他と比べてどうか」等で一度だけ再確認する。それでも出ない場合のみ次へ進む。",
    "3. 抽象回答（「便利」「よくない」「なんとなく」等）: 具体化する質問を行う。",
    "4. 十分具体的かつ必要スロットが埋まっている場合: 深掘りせず次の質問へ進む。",
    "深掘り禁止条件: 必須スロットが全て埋まっている / max_probes に到達 / 同一論点で既に深掘り済み / ユーザーが明確に拒否している。"
  ].join("\n");

  if (TEXT_TYPES.has(questionType)) {
    return [
      commonRules,
      "",
      "テキスト回答の深掘りルール:",
      "- 回答に具体的な理由・事例・状況・判断軸が不足している場合にのみ深掘りする。",
      "- 回答で言及された内容に紐づいた1点だけを問う（why / example / scene / impact / comparison のいずれか1つ）。",
      "- 抽象的な問い（「詳しく教えてください」「なぜですか」のみ）は禁止。",
      "- 回答に書かれていない情報を勝手に補って問うことは禁止。"
    ].join("\n");
  }

  if (CHOICE_TYPES.has(questionType)) {
    if (!aiProbeEnabled) {
      return "選択肢回答: ai_probe_enabled が false のため深掘りしない。action は必ず ask_next にする。";
    }
    const isMulti = ["multi_choice", "multi_select"].includes(questionType);
    return [
      commonRules,
      "",
      "【深掘りの目的】",
      "深掘りは「不足情報を埋める」ためではなく、「回答の解像度を上げる」ために行う。",
      "回答が十分に具体的な場合は深掘りしない選択も許可する。",
      "",
      isMulti ? "複数選択回答の深掘りルール:" : "単数選択回答の深掘りルール:",
      "- 回答者が選択した選択肢を必ず取得し、深掘りの起点にする。",
      isMulti
        ? "- 複数選択された場合: 最も重要そうな1つを深掘り対象にする。判断できない場合は最初の選択肢を対象にする。全項目を一気に聞くことは禁止（「それぞれ教えてください」はNG）。"
        : "- 単数選択された場合: その選択肢を深掘り対象にする。",
      "",
      "深掘り内容の方針:",
      "- 選択理由を必ず聞く。抽象回答にならないよう、具体化を促す。",
      "- 以下のいずれか1つの観点を選んで深掘りする（複数観点を同時に聞くことは禁止）:",
      "  * 理由（なぜその選択肢を選んだか）",
      "  * 具体的な体験・場面（その選択肢を感じた具体的な状況）",
      "  * 他との違い・比較（他の選択肢と比べてどう違うか）",
      "  * 判断基準（何を重視してその選択をしたか）",
      "",
      "深掘り文面生成ルール:",
      "- 選択された内容を必ず文中に含める（例：「〇〇を選ばれたとのことですが...」）。",
      "- 「詳しく教えてください」などの抽象的な質問は禁止。",
      "- 1質問で1テーマのみ聞く。回答しやすい自然な会話文にする。",
      "",
      "NGパターン（以下は必ず避ける）:",
      "- 選択内容に触れない深掘り",
      "- 汎用的すぎる質問（例：「詳しく教えてください」「なぜですか」のみ）",
      "- 複数の観点を一度に聞く質問",
      "- 誘導的な質問",
      "- 選択肢を選び直させる質問や、選択結果そのものを再確認する質問"
    ].join("\n");
  }

  if (NUMERIC_TYPES.has(questionType)) {
    if (!aiProbeEnabled) {
      return "数値回答: ai_probe_enabled が false のため深掘りしない。action は必ず ask_next にする。";
    }
    return [
      commonRules,
      "",
      "数値回答の深掘りルール:",
      "- 回答者が入力した数値を踏まえて、その値になった理由・背景・判断軸を1点だけ問う。",
      "- 数値を再入力させる質問や数値の妥当性を問う質問は禁止。",
      "- 回答者が入力した値を必ず参照し、その内容に紐づいた追質問を生成する。"
    ].join("\n");
  }

  return "このタイプは深掘り対象外。action は必ず ask_next にする。";
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
  const contextType =
    input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode;
  const meta = normalizeQuestionMeta(input.question, contextType, {
    projectAiState: input.project.ai_state_json
  });
  const answerOptionsContext = renderAnswerOptionsForPrompt(input.question);

  return [
    ...buildSharedSections(input.project, "probe_generation"),
    "Return JSON only.",
    "Required keys: probe_question, probe_type, focus",
    "Ask exactly one follow-up question.",
    "Do not repeat the original question verbatim.",
    "Do not ask multiple questions.",
    "Do not mention internal codes or slots by name.",
    "Do not ignore the user's answer and jump to a new question.",
    "Do not transform the topic into another category.",
    "CRITICAL: The probe_question MUST be grounded in the actual answer content below. Do not generate a generic question that ignores what the respondent said.",
    `Question code: ${input.question.question_code}`,
    `Question type: ${input.question.question_type}`,
    `Question text: ${input.question.question_text}`,
    answerOptionsContext
      ? `Available answer options:\n${answerOptionsContext}`
      : null,
    `Probe type: ${input.probeType}`,
    `User's answer: ${input.answer}`,
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
    `Session summary: ${input.sessionSummary || "none"}`,
    buildProbeTypeGuidance(input.question.question_type, true)
  ]
    .filter((line): line is string => line !== null)
    .join("\n\n");
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
  const contextType =
    input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode;
  const context = resolveAnswerAnalysisContext({
    project: input.project,
    question: input.question,
    nextQuestion: input.nextQuestion,
    contextType
  });
  const meta = normalizeQuestionMeta(input.question, contextType, {
    projectAiState: input.project.ai_state_json
  });
  const projectAiState = getProjectAIState(input.project);
  const probeGuideline = (input.project.ai_state_json as ProjectAIState)?.probe_guideline;
  const answerOptionsContext = renderAnswerOptionsForPrompt(input.question);
  const freeCommentPolicy =
    input.question.question_role === "free_comment" &&
    (!input.aiProbeEnabled || context.required_slots.length === 0) &&
    input.maxProbes === 0
      ? [
          "Default free_comment policy",
          "- Treat this as optional supplemental input only.",
          "- Do not ask a follow-up unless free comment probing is explicitly enabled by configuration.",
          "- Replies such as 「特になし」 or 「ありません」 are acceptable and should not trigger a probe."
        ].join("\n")
      : null;
  const modeStyleGuide = (() => {
    switch (input.project.research_mode) {
      case "interview":
        return [
          "Mode: interview",
          "- If action is probe, write one natural conversational follow-up in Japanese.",
          "- Do not show question numbers such as Q1/3.",
          "- Phrases like \"もう少し詳しく教えてください\" are acceptable."
        ].join("\n");
      default:
        return [
          "Mode: survey_interview",
          "- Normal survey progression (branch/skip) is handled outside this prompt.",
          "- If action is probe, write one natural interview-style follow-up in Japanese.",
          "- Do not show question numbers in the probe question.",
          "- After probe, flow returns to the structured question sequence."
        ].join("\n");
    }
  })();

  return [
    "Return JSON only.",
    "You are the single decision-maker for one turn of a LINE-based interview or survey.",
    "Decide the next action from the project objective first, not only from the current question text.",
    "",
    "Priority execution context",
    `- project_goal: ${context.project_goal || "not set"}`,
    `- user_understanding_goal: ${context.user_understanding_goal || "not set"}`,
    `- project_language: ${projectAiState.language}`,
    `- strict_topic_lock: ${context.strict_topic_lock}`,
    "",
    renderJapaneseSlotList(
      "Project required slots",
      projectAiState.required_slots,
      "project level required slots are not set"
    ),
    "",
    renderJapaneseSlotList(
      "Current question required slots",
      context.required_slots,
      "current question required slots are not set"
    ),
    "",
    renderJapaneseSlotList(
      "Current question optional slots",
      context.optional_slots,
      "current question optional slots are not set"
    ),
    "",
    renderJapaneseSlotList(
      "Next question required slots",
      context.next_question_required_slots,
      "next question required slots are not set"
    ),
    "",
    "Current turn context",
    `- question_code: ${input.question.question_code}`,
    `- question_type: ${input.question.question_type}`,
    `- question_text: ${input.question.question_text}`,
    `- probe_goal: ${meta.probe_goal ?? "none"}`,
    `- answer: ${input.answer}`,
    answerOptionsContext
      ? `- answer_options:\n${answerOptionsContext}`
      : "- answer_options: none",
    `- existing_slots: ${JSON.stringify(input.existingSlots)}`,
    `- ai_probe_enabled: ${input.aiProbeEnabled}`,
    `- current_probe_count: ${input.currentProbeCount}`,
    `- max_probes: ${input.maxProbes}`,
    `- project_required_slot_keys: ${JSON.stringify(context.project_required_slot_keys)}`,
    "",
    "Decision policy",
    "- Judge sufficiency by whether the essential information has been captured.",
    "- A short but concrete answer can be sufficient.",
    "- A long but abstract answer can still require a probe.",
    "- Probe when required information is still missing, when the answer is abstract, or when the project-level understanding is still weak.",
    "- Do not treat answer length alone as a failure.",
    "- If the current question is sufficiently answered and the next question's required slots are already covered, action can be skip.",
    "- action finish is allowed only when the project-level required information is already captured.",
    "- If you probe, ask exactly one focused follow-up.",
    "- Do not expose internal slot keys such as snake_case names to the respondent.",
    "- If ai_probe_enabled is false, action MUST be ask_next regardless of answer quality.",
    probeGuideline ? `- Custom probe guideline: ${probeGuideline}` : null,
    "",
    buildProbeTypeGuidance(input.question.question_type, input.aiProbeEnabled),
    "",
    "CRITICAL: When action is probe, the question field MUST reference the actual content of the answer above.",
    "Do not generate a generic probe that ignores what the respondent said.",
    "",
    freeCommentPolicy,
    freeCommentPolicy ? "" : null,
    modeStyleGuide,
    "",
    "Output schema",
    "{",
    '  "action": "probe | ask_next | skip | finish",',
    '  "question": "Japanese user-facing text. Empty string unless action is probe.",',
    '  "reason": "short internal reason in English or Japanese",',
    '  "collected_slots": { "slot_key": "value or null" },',
    '  "is_sufficient": true',
    "}",
    "",
    "Output constraints",
    "- question must be Japanese only.",
    "- question must contain a single intent.",
    "- collected_slots must include only grounded information from the answer.",
    "- If action is not probe, return an empty question string.",
    "- Do not wrap JSON in markdown."
  ].filter((line): line is string => line !== null).join("\n");
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
    "Required keys: structured_summary, extracted_slots, comparable_payload",
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
    "Required keys: is_complete, missing_slots, reasons, quality_score",
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
    "CRITICAL: The follow-up question MUST be grounded in the actual answer content below.",
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

export function buildInterviewTurnPrompt(input: {
  project: Project;
  question: Question;
  answer: string;
  nextQuestion?: Question | null;
  existingSlots: Record<string, string | null>;
  currentProbeCount: number;
  maxProbes: number;
  aiProbeEnabled: boolean;
  conversationSummary?: string | null;
}): string {
  const contextType =
    input.question.question_role === "free_comment" ? "free_comment" : input.project.research_mode;
  const meta = normalizeQuestionMeta(input.question, contextType, {
    projectAiState: input.project.ai_state_json
  });
  const aiState = getProjectAIState(input.project);
  const probeGuideline = (input.project.ai_state_json as ProjectAIState)?.probe_guideline;
  const canProbe = input.aiProbeEnabled && input.currentProbeCount < input.maxProbes && input.maxProbes > 0;
  const answerOptionsContext = renderAnswerOptionsForPrompt(input.question);

  return [
    "Return JSON only.",
    "You are an interviewer conducting a LINE-based research interview in Japanese.",
    "You have just received an answer and must decide the next action.",
    "",
    `Project goal: ${aiState.project_goal || "not set"}`,
    `User understanding goal: ${aiState.user_understanding_goal || "not set"}`,
    renderJapaneseSlotList("Required information to collect", aiState.required_slots, "none"),
    "",
    "Current turn",
    `- question: ${input.question.question_text}`,
    `- question_type: ${input.question.question_type}`,
    `- probe_goal: ${meta.probe_goal ?? "none"}`,
    `- answer: ${input.answer}`,
    answerOptionsContext
      ? `- answer_options:\n${answerOptionsContext}`
      : "- answer_options: none",
    `- collected_so_far: ${JSON.stringify(input.existingSlots)}`,
    `- probe_count: ${input.currentProbeCount} / ${input.maxProbes}`,
    input.nextQuestion
      ? `- next_question: ${input.nextQuestion.question_text} (code: ${input.nextQuestion.question_code})`
      : "- next_question: none (this is the last question)",
    "",
    "Probe rules",
    canProbe ? "- Probing is allowed this turn" : "- Probing is NOT allowed this turn (budget exceeded or disabled)",
    probeGuideline ? `- Custom probe guideline: ${probeGuideline}` : null,
    "",
    buildProbeTypeGuidance(input.question.question_type, input.aiProbeEnabled),
    "",
    "CRITICAL: When action is probe, response_text MUST reference the actual content of the answer above.",
    "Do not generate a generic probe that ignores what the respondent said.",
    "",
    "Skip rules",
    "- If next_question asks for information already collected in collected_so_far, action can be skip",
    "- Skip means: skip the next question and advance further",
    "",
    "Response rules",
    "- Write all user-facing text in natural Japanese conversation style",
    "- Do NOT use Q1/Q2 numbers or internal codes",
    "- Keep messages short and suitable for LINE chat",
    "- If action is probe: response_text = one follow-up question grounded in the respondent's answer",
    "- If action is ask_next or skip: response_text = the next question rendered as natural conversation",
    "- If action is finish: response_text = null",
    "",
    "Output schema",
    "{",
    '  "action": "probe | ask_next | skip | finish",',
    '  "response_text": "text to send to user (probe or next question), null if finish",',
    '  "collected_slots": { "slot_key": "extracted value or null" },',
    '  "reason": "short internal reason"',
    "}",
    "",
    "Output constraints",
    "- JSON only, no markdown fences",
    "- response_text must be Japanese",
    "- collected_slots must be grounded in the answer"
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
