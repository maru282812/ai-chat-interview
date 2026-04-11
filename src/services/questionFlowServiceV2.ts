import { HttpError } from "../lib/http";
import {
  getQuestionScaleRange,
  getYesNoLabels,
  normalizeBranchRule,
  resolveMatchedBranchCode
} from "../lib/questionDesign";
import { questionRepository } from "../repositories/questionRepository";
import type { ParsedAnswer, Question, QuestionOption } from "../types/domain";

function normalizeOptionInput(input: string): string {
  return input
    .trim()
    .replace(/[\uFF10-\uFF19]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
}

function findOption(input: string, options: QuestionOption[]): QuestionOption | null {
  const normalized = normalizeOptionInput(input).toLowerCase();
  const numbered = Number(normalized);
  if (!Number.isNaN(numbered) && options[numbered - 1]) {
    return options[numbered - 1] ?? null;
  }

  return (
    options.find((option) => {
      const label = option.label.trim().toLowerCase();
      const value = option.value.trim().toLowerCase();
      return normalized === label || normalized === value;
    }) ?? null
  );
}

export const questionFlowService = {
  async listByProject(projectId: string): Promise<Question[]> {
    return questionRepository.listByProject(projectId);
  },

  async getFirstQuestion(projectId: string): Promise<Question | null> {
    return questionRepository.getFirstByProject(projectId);
  },

  async getQuestion(questionId: string): Promise<Question> {
    return questionRepository.getById(questionId);
  },

  renderQuestion(question: Question, progressLabel?: string): string {
    const header = progressLabel ? `${progressLabel}\n\n` : "";
    const help = question.question_config?.helpText ? `\n${question.question_config.helpText}` : "";

    switch (question.question_type) {
      case "single_select":
      case "multi_select": {
        const options = question.question_config?.options ?? [];
        const optionsText = options.map((option, index) => `${index + 1}. ${option.label}`).join("\n");
        const multiHint =
          question.question_type === "multi_select"
            ? "\n複数選択の場合は 1,3 のようにカンマ区切りで入力してください。"
            : "";
        return `${header}${question.question_text}\n${optionsText}${multiHint}${help}`;
      }
      case "yes_no": {
        const { yesLabel, noLabel } = getYesNoLabels(question.question_config);
        return `${header}${question.question_text}\n1. ${yesLabel}\n2. ${noLabel}${help}`;
      }
      case "scale": {
        const { min, max, minLabel, maxLabel } = getQuestionScaleRange(question.question_config);
        const labels =
          minLabel || maxLabel ? `\n${min}: ${minLabel || "-"} / ${max}: ${maxLabel || "-"}` : "";
        return `${header}${question.question_text}\n${min}〜${max} の数字で入力してください。${labels}${help}`;
      }
      default:
        return `${header}${question.question_text}${help}`;
    }
  },

  parseAnswer(question: Question, rawText: string): ParsedAnswer {
    const text = rawText.trim();
    const configuredOptions = question.question_config?.options ?? [];
    const numericOption =
      question.question_type === "text" && configuredOptions.length > 0 ? findOption(text, configuredOptions) : null;
    if (!text) {
      throw new HttpError(400, "回答が空です。");
    }

    switch (question.question_type) {
      case "text": {
        const maxLength = question.question_config?.max_length ?? null;
        if (maxLength !== null && text.length > maxLength) {
          throw new HttpError(400, `${maxLength}文字以内で入力してください。`);
        }
        if (numericOption) {
          const optionIndex = configuredOptions.findIndex((option) => option.value === numericOption.value) + 1;
          return {
            answerText: numericOption.label,
            normalizedAnswer: {
              value: numericOption.value,
              label: numericOption.label,
              option_index: optionIndex > 0 ? optionIndex : null,
              selection_source: "option_number"
            }
          };
        }
        return { answerText: text, normalizedAnswer: { value: text } };
      }
      case "yes_no": {
        const { yesLabel, noLabel } = getYesNoLabels(question.question_config);
        const lower = text.toLowerCase();

        if (["1", yesLabel.toLowerCase(), "yes", "y", "true"].includes(lower)) {
          return { answerText: yesLabel, normalizedAnswer: { value: "yes", boolean: true, label: yesLabel } };
        }

        if (["2", noLabel.toLowerCase(), "no", "n", "false"].includes(lower)) {
          return { answerText: noLabel, normalizedAnswer: { value: "no", boolean: false, label: noLabel } };
        }

        throw new HttpError(400, `${yesLabel} / ${noLabel} のいずれかで回答してください。`);
      }
      case "single_select": {
        const options = question.question_config?.options ?? [];
        const option = findOption(text, options);
        if (!option) {
          throw new HttpError(400, "選択肢から回答してください。");
        }

        return {
          answerText: option.label,
          normalizedAnswer: { value: option.value, label: option.label }
        };
      }
      case "multi_select": {
        const options = question.question_config?.options ?? [];
        const parts = text
          .split(/[,\n、]/)
          .map((part) => part.trim())
          .filter(Boolean);
        const matched = parts.map((part) => findOption(part, options));
        if (matched.some((item) => !item)) {
          throw new HttpError(400, "選択肢から回答してください。複数選択は 1,3 のように入力できます。");
        }

        const unique = Array.from(new Map(matched.map((item) => [item!.value, item!])).values());
        const minSelect = question.question_config?.min_select ?? null;
        const maxSelect = question.question_config?.max_select ?? null;

        if (minSelect !== null && unique.length < minSelect) {
          throw new HttpError(400, `${minSelect}件以上選択してください。`);
        }
        if (maxSelect !== null && unique.length > maxSelect) {
          throw new HttpError(400, `${maxSelect}件以下で選択してください。`);
        }

        return {
          answerText: unique.map((option) => option.label).join(", "),
          normalizedAnswer: {
            values: unique.map((option) => option.value),
            labels: unique.map((option) => option.label)
          }
        };
      }
      case "scale": {
        const { min, max } = getQuestionScaleRange(question.question_config);
        const value = Number(text);
        if (Number.isNaN(value) || value < min || value > max) {
          throw new HttpError(400, `${min}〜${max} の数字で入力してください。`);
        }

        return { answerText: String(value), normalizedAnswer: { value } };
      }
      default:
        throw new HttpError(400, "未対応の質問タイプです。");
    }
  },

  async determineNextQuestion(
    projectId: string,
    question: Question,
    normalizedAnswer: Record<string, unknown>
  ): Promise<Question | null> {
    const matchedBranchCode = resolveMatchedBranchCode(question.branch_rule, normalizedAnswer);
    if (matchedBranchCode) {
      const matchedBranchQuestion = await questionRepository.getByProjectAndCode(projectId, matchedBranchCode);
      if (matchedBranchQuestion && !matchedBranchQuestion.is_hidden) {
        return matchedBranchQuestion;
      }
    }

    const normalizedBranchRule = normalizeBranchRule(question.branch_rule);
    for (const fallbackCode of [
      normalizedBranchRule?.default_next ?? null,
      normalizedBranchRule?.merge_question_code ?? null
    ]) {
      if (!fallbackCode) {
        continue;
      }

      const fallbackQuestion = await questionRepository.getByProjectAndCode(projectId, fallbackCode);
      if (fallbackQuestion && !fallbackQuestion.is_hidden) {
        return fallbackQuestion;
      }
    }

    return questionRepository.getNextBySortOrder(projectId, question.sort_order);
  }
};
