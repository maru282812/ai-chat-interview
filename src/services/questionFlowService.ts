import { HttpError } from "../lib/http";
import { getQuestionScaleRange, getYesNoLabels, resolveNextQuestionCode } from "../lib/questionDesign";
import { questionRepository } from "../repositories/questionRepository";
import type { ParsedAnswer, Question, QuestionOption } from "../types/domain";

function findOption(input: string, options: QuestionOption[]): QuestionOption | null {
  const normalized = input.trim().toLowerCase();
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
            ? "\n複数選択は「1,3」のように入力してください。"
            : "";
        return `${header}${question.question_text}\n${optionsText}${multiHint}${help}`;
      }
      case "yes_no":
        return `${header}${question.question_text}\n1. はい\n2. いいえ${help}`;
      case "scale": {
        const min = question.question_config?.scaleMin ?? 1;
        const max = question.question_config?.scaleMax ?? 5;
        return `${header}${question.question_text}\n${min}〜${max} の数字で入力してください。${help}`;
      }
      default:
        return `${header}${question.question_text}${help}`;
    }
  },

  parseAnswer(question: Question, rawText: string): ParsedAnswer {
    const text = rawText.trim();
    if (!text) {
      throw new HttpError(400, "回答が空です");
    }

    switch (question.question_type) {
      case "text":
        return { answerText: text, normalizedAnswer: { value: text } };
      case "yes_no": {
        const lower = text.toLowerCase();
        if (["1", "はい", "yes", "y"].includes(lower)) {
          return { answerText: "はい", normalizedAnswer: { value: true } };
        }
        if (["2", "いいえ", "no", "n"].includes(lower)) {
          return { answerText: "いいえ", normalizedAnswer: { value: false } };
        }
        throw new HttpError(400, "はい / いいえ で回答してください");
      }
      case "single_select": {
        const options = question.question_config?.options ?? [];
        const option = findOption(text, options);
        if (!option) {
          throw new HttpError(400, "候補から1つ選択してください");
        }
        return {
          answerText: option.label,
          normalizedAnswer: { value: option.value, label: option.label }
        };
      }
      case "multi_select": {
        const options = question.question_config?.options ?? [];
        const parts = text
          .split(/[,、\n]/)
          .map((part) => part.trim())
          .filter(Boolean);
        const matched = parts.map((part) => findOption(part, options));
        if (matched.some((item) => !item)) {
          throw new HttpError(400, "候補から選んでください。複数選択は「1,3」のように入力できます");
        }
        const unique = Array.from(new Map(matched.map((item) => [item!.value, item!])).values());
        return {
          answerText: unique.map((option) => option.label).join(", "),
          normalizedAnswer: {
            values: unique.map((option) => option.value),
            labels: unique.map((option) => option.label)
          }
        };
      }
      case "scale": {
        const value = Number(text);
        const min = question.question_config?.scaleMin ?? 1;
        const max = question.question_config?.scaleMax ?? 5;
        if (Number.isNaN(value) || value < min || value > max) {
          throw new HttpError(400, `${min}〜${max} の数字で入力してください`);
        }
        return { answerText: String(value), normalizedAnswer: { value } };
      }
      default:
        throw new HttpError(400, "未対応の質問タイプです");
    }
  },

  async determineNextQuestion(
    projectId: string,
    question: Question,
    normalizedAnswer: Record<string, unknown>
  ): Promise<Question | null> {
    const nextQuestionCode = resolveNextQuestionCode(question.branch_rule, normalizedAnswer);
    if (nextQuestionCode) {
      return questionRepository.getByProjectAndCode(projectId, nextQuestionCode);
    }

    return questionRepository.getNextBySortOrder(projectId, question.sort_order);
  }
};
