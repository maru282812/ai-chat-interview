import type { NormalizedProjectResearchSettings } from "./projectResearch";
import { getQuestionScaleRange } from "./questionDesign";
import type { Question } from "../types/domain";

export type ConversationCommand =
  | "help"
  | "start"
  | "resume"
  | "stop"
  | "restart"
  | "rank"
  | "mypage"
  | "points";

export interface ProbeDecision {
  shouldProbe: boolean;
  reason:
    | "short_answer"
    | "abstract_answer"
    | "answer_sufficient"
    | "max_probes_per_answer"
    | "max_probes_per_session"
    | "question_not_target"
    | "question_blocked"
    | "user_declined";
  prompt: string | null;
}

type GenericProbeType =
  | "situation"
  | "reason"
  | "detail"
  | "example"
  | "comparison"
  | "dissatisfaction"
  | "alternative";

const COMMAND_ALIASES: Record<ConversationCommand, string[]> = {
  help: ["help", "ヘルプ"],
  start: ["start", "はじめる", "開始"],
  resume: ["resume", "再開"],
  stop: ["stop", "やめる", "中断"],
  restart: ["restart", "最初から", "リセット"],
  rank: ["rank", "ランク"],
  mypage: ["mypage", "マイページ", "基本情報変更", "基本情報"],
  points: ["point", "points", "ポイント"]
};

const ABSTRACT_PATTERNS = [
  "なんとなく",
  "いろいろ",
  "色々",
  "そのときによる",
  "時と場合",
  "状況による",
  "場合による",
  "ふつう",
  "普通",
  "特に"
];

const DECLINE_PATTERNS = [
  "わからない",
  "覚えていない",
  "思い出せない",
  "思いつかない",
  "特にない",
  "とくにない",
  "ないです",
  "なしです"
];

const GENERIC_FALLBACK_PROMPTS: Record<GenericProbeType, string> = {
  situation: "具体的な場面を1つ教えてください（いつ・どこ・誰と、のうち答えやすいものだけで大丈夫です）。",
  reason: "そう思った理由を具体的に教えてください。",
  detail: "もう少し具体的な内容を教えてください（できれば1つの場面や内容でお願いします）。",
  example: "具体例を1つ教えてください。",
  comparison: "他と比べて、どこが違うと感じるか教えてください。",
  dissatisfaction: "不満に感じた点と、そのときの状況を教えてください。",
  alternative: "代わりに選ぶものと、その理由を教えてください。"
};

function normalizeText(text: string): string {
  return text.trim().toLowerCase();
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[。！？!?])/u)
    .map((part) => collapseWhitespace(part))
    .filter(Boolean);
}

export function detectConversationCommand(text: string): ConversationCommand | null {
  const normalized = normalizeText(text);
  if (!normalized) {
    return null;
  }

  for (const [command, aliases] of Object.entries(COMMAND_ALIASES) as [
    ConversationCommand,
    string[]
  ][]) {
    if (aliases.includes(normalized)) {
      return command;
    }
  }

  return null;
}

export function formatTextForLine(
  text: string,
  responseStyle: NormalizedProjectResearchSettings["response_style"]
): string {
  const collapsed = collapseWhitespace(text);
  const sentences = splitSentences(collapsed);
  const limitedSentences =
    sentences.length > 0
      ? sentences.slice(0, responseStyle.max_sentences)
      : [collapsed.slice(0, responseStyle.max_characters_per_message)];
  const joined = limitedSentences.join(" ");

  if (joined.length <= responseStyle.max_characters_per_message) {
    return joined;
  }

  return `${joined
    .slice(0, Math.max(1, responseStyle.max_characters_per_message - 1))
    .trimEnd()}…`;
}

function getQuestionControl(question: Question) {
  return question.question_config?.conversationControl ?? {};
}

function buildProbeBasePrompt(question: Question): string {
  const control = getQuestionControl(question);

  if (control.coreInfoPrompt?.trim()) {
    return control.coreInfoPrompt.trim();
  }

  const probeType = control.probeType as GenericProbeType | undefined;
  if (probeType && probeType in GENERIC_FALLBACK_PROMPTS) {
    return GENERIC_FALLBACK_PROMPTS[probeType];
  }

  return "差し支えない範囲で、具体的な内容を1つ教えてください。";
}

function matchesPattern(text: string, patterns: string[]): boolean {
  return patterns.some((pattern) => text.includes(pattern));
}

function hasConcreteSignal(text: string): boolean {
  return /(\d+|いつ|どこ|誰|たとえば|例えば|具体|場面|理由|回|円|分|時|日|週|月)/u.test(text);
}

function isAbstractAnswer(text: string): boolean {
  const normalized = collapseWhitespace(text);
  const shortText = normalized.length <= 15;
  const abstractPatternMatched = matchesPattern(normalized, ABSTRACT_PATTERNS);
  const concrete = hasConcreteSignal(normalized);

  return !concrete && (shortText || abstractPatternMatched);
}

function isDeclinedAnswer(text: string): boolean {
  return matchesPattern(text, DECLINE_PATTERNS);
}

export function evaluateProbeDecision(input: {
  question: Question;
  answerText: string;
  projectSettings: NormalizedProjectResearchSettings;
  currentProbeCountForAnswer: number;
  currentProbeCountForSession: number;
  maxProbesPerAnswer: number;
  maxProbesPerSession: number;
}): ProbeDecision {
  const { question, answerText, projectSettings } = input;
  const policy = projectSettings.probe_policy;
  const control = getQuestionControl(question);
  const trimmed = collapseWhitespace(answerText);

  const shortAnswerMinLength =
    control.shortAnswerMinLength ?? policy.short_answer_min_length;

  const sufficientAnswerMinLength =
    control.sufficientAnswerMinLength ??
    Math.max(shortAnswerMinLength + 8, shortAnswerMinLength);

  const isShort =
    policy.conditions.includes("short_answer") &&
    trimmed.length < shortAnswerMinLength;

  const isAbstract =
    policy.conditions.includes("abstract_answer") &&
    !isShort &&
    isAbstractAnswer(trimmed);

  const targetQuestionCodes = policy.target_question_codes;
  const blockedQuestionCodes = policy.blocked_question_codes;

  const isTargetQuestion =
    targetQuestionCodes.length === 0 || targetQuestionCodes.includes(question.question_code);

  const isBlockedQuestion = blockedQuestionCodes.includes(question.question_code);

  if (!policy.enabled) {
    return { shouldProbe: false, reason: "question_not_target", prompt: null };
  }

  if (isBlockedQuestion) {
    return { shouldProbe: false, reason: "question_blocked", prompt: null };
  }

  if (!isTargetQuestion) {
    return { shouldProbe: false, reason: "question_not_target", prompt: null };
  }

  if (policy.require_question_probe_enabled && !question.ai_probe_enabled) {
    return { shouldProbe: false, reason: "question_not_target", prompt: null };
  }

  if (policy.end_conditions.includes("user_declined") && isDeclinedAnswer(trimmed)) {
    return { shouldProbe: false, reason: "user_declined", prompt: null };
  }

  if (
    policy.end_conditions.includes("max_probes_per_session") &&
    input.currentProbeCountForSession >= input.maxProbesPerSession
  ) {
    return { shouldProbe: false, reason: "max_probes_per_session", prompt: null };
  }

  if (
    policy.end_conditions.includes("max_probes_per_answer") &&
    input.currentProbeCountForAnswer >= input.maxProbesPerAnswer
  ) {
    return { shouldProbe: false, reason: "max_probes_per_answer", prompt: null };
  }

  if (
    policy.end_conditions.includes("answer_sufficient") &&
    trimmed.length >= sufficientAnswerMinLength &&
    !isAbstract
  ) {
    return { shouldProbe: false, reason: "answer_sufficient", prompt: null };
  }

  if (!isShort && !isAbstract) {
    return { shouldProbe: false, reason: "answer_sufficient", prompt: null };
  }

  const followUp =
    input.currentProbeCountForAnswer > 0
      ? "直近の具体的な場面を1つだけ教えてください。短くても大丈夫です。"
      : buildProbeBasePrompt(question);

  const example = control.answerExample?.trim()
    ? `例: ${control.answerExample.trim()}`
    : "";

  const prompt = [followUp, example].filter(Boolean).join(" ");

  return {
    shouldProbe: true,
    reason: isShort ? "short_answer" : "abstract_answer",
    prompt: formatTextForLine(prompt, projectSettings.response_style)
  };
}

export function buildHelpText(
  responseStyle: NormalizedProjectResearchSettings["response_style"]
): string {
  return formatTextForLine(
    "使えるコマンド: start / resume / やめる / 最初から / points / rank / mypage（基本情報） / help",
    responseStyle
  );
}

export function buildEmptyAnswerText(
  responseStyle: NormalizedProjectResearchSettings["response_style"]
): string {
  return formatTextForLine(
    "空欄だと進められません。短くて大丈夫なので文字で教えてください。",
    responseStyle
  );
}

export function buildNoActiveSessionText(
  responseStyle: NormalizedProjectResearchSettings["response_style"]
): string {
  return formatTextForLine(
    "進行中のインタビューはありません。start と送ると開始できます。",
    responseStyle
  );
}

export function buildCompletedSessionText(
  responseStyle: NormalizedProjectResearchSettings["response_style"]
): string {
  return formatTextForLine(
    "このインタビューは完了済みです。再開はできません。",
    responseStyle
  );
}

export function buildRestartAfterCompletionText(
  responseStyle: NormalizedProjectResearchSettings["response_style"]
): string {
  return formatTextForLine(
    "完了済みのため、最初からの再作成は停止しています。必要なら管理側でリセットしてください。",
    responseStyle
  );
}

export function buildResumeExistingSessionText(
  responseStyle: NormalizedProjectResearchSettings["response_style"]
): string {
  return formatTextForLine(
    "進行中のセッションがあります。続きの質問を表示します。",
    responseStyle
  );
}

export function buildStoppedSessionText(
  responseStyle: NormalizedProjectResearchSettings["response_style"]
): string {
  return formatTextForLine(
    "中断しました。続きは resume、やり直しは 最初から でできます。",
    responseStyle
  );
}

export function buildRestartedSessionText(
  responseStyle: NormalizedProjectResearchSettings["response_style"]
): string {
  return formatTextForLine(
    "最初からやり直します。Q1 から再開します。",
    responseStyle
  );
}

export function buildNonTextInputText(input: {
  responseStyle: NormalizedProjectResearchSettings["response_style"];
  messageType: string;
  hasActiveSession: boolean;
}): string {
  const lead = (() => {
    switch (input.messageType) {
      case "image":
        return "画像は回答として読めません。";
      case "sticker":
        return "スタンプは回答として保存できません。";
      default:
        return "その形式のメッセージは回答として扱えません。";
    }
  })();

  const tail = input.hasActiveSession
    ? "今の質問には文字で短く答えてください。"
    : "文字で start と送ると開始できます。";

  return formatTextForLine(`${lead} ${tail}`, input.responseStyle);
}

export function buildInvalidAnswerText(input: {
  question: Question;
  responseStyle: NormalizedProjectResearchSettings["response_style"];
}): string {
  const { question, responseStyle } = input;

  const guide = (() => {
    switch (question.question_type) {
      case "single_select":
        return "番号か選択肢名で1つだけ返信してください。";
      case "multi_select":
        return "番号か選択肢名をカンマ区切りで返信してください。";
      case "yes_no":
        return "1 が はい、2 が いいえ です。";
      case "scale": {
        const { min, max } = getQuestionScaleRange(question.question_config);
        return `${min}〜${max} の数字で返信してください。`;
      }
      default:
        return "文字で短く教えてください。";
    }
  })();

  return formatTextForLine(guide, responseStyle);
}