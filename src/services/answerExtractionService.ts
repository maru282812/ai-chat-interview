import { getQuestionExtractionConfig } from "../lib/questionDesign";
import { answerExtractionRepository } from "../repositories/answerExtractionRepository";
import { answerRepository } from "../repositories/answerRepository";
import type {
  Answer,
  ExtractedEntityRecord,
  NormalizedExtractionResult,
  Project,
  Question,
  QuestionExtractionConfig,
  QuestionExtractionField,
  QuestionExtractionFieldOption
} from "../types/domain";
import { aiService } from "./aiService";

type PrimitiveFieldValue = string | number | boolean | null;

interface BuiltExtraction {
  extraction: NormalizedExtractionResult;
  normalizedAnswer: Record<string, unknown>;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function normalizeDigits(text: string): string {
  const ascii = text.replace(/[\uFF10-\uFF19]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));
  return ascii
    .replace(/\u3007|\u96F6/g, "0")
    .replace(/\u4E00/g, "1")
    .replace(/\u4E8C/g, "2")
    .replace(/\u4E09/g, "3")
    .replace(/\u56DB/g, "4")
    .replace(/\u4E94/g, "5")
    .replace(/\u516D/g, "6")
    .replace(/\u4E03/g, "7")
    .replace(/\u516B/g, "8")
    .replace(/\u4E5D/g, "9");
}

function splitNaturalList(value: string): string[] {
  return value
    .split(/[\u3001,\uFF0C/]/)
    .flatMap((part) => part.split(/\u3068/))
    .map((part) =>
      part
        .replace(/^(?:\u306F|\u304C|\u3092|\u3067|\u3067\u3059|\u3067\u3057\u305F)\s*/u, "")
        .replace(/\s*(?:\u3067\u3059|\u3067\u3057\u305F|\u307E\u3059)\s*$/u, "")
        .trim()
    )
    .filter(Boolean);
}

function getField(config: QuestionExtractionConfig, predicate: (field: QuestionExtractionField) => boolean) {
  return config.schema?.fields?.find(predicate) ?? null;
}

function getTypeField(config: QuestionExtractionConfig) {
  return getField(config, (field) => field.type === "enum") ?? getField(config, (field) => field.key === "type");
}

function getAgeField(config: QuestionExtractionConfig) {
  return getField(config, (field) => field.key === "age") ??
    getField(config, (field) => field.type === "number" && field.key.toLowerCase().includes("age"));
}

function getCountField(config: QuestionExtractionConfig) {
  return getField(config, (field) => field.key === "count") ??
    getField(config, (field) => field.type === "number" && field.key.toLowerCase().includes("count"));
}

function getDetailField(config: QuestionExtractionConfig) {
  return (
    getField(config, (field) => field.key === "detail") ??
    getField(config, (field) => field.key === "breed") ??
    getField(config, (field) => field.key === "name") ??
    getField(config, (field) => field.type === "string")
  );
}

function getEntityArrayField(config: QuestionExtractionConfig): string {
  return config.schema?.array_field?.trim() || "entities";
}

function getOptionAliases(option: QuestionExtractionFieldOption): string[] {
  return uniqueStrings([option.label ?? "", option.value, ...(option.aliases ?? [])]);
}

function findOptionByText(field: QuestionExtractionField, text: string): QuestionExtractionFieldOption | null {
  const normalized = text.trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  return (
    field.options?.find((option) =>
      getOptionAliases(option).some((alias) => {
        const normalizedAlias = alias.toLowerCase();
        return normalized === normalizedAlias || normalized.includes(normalizedAlias);
      })
    ) ?? null
  );
}

function detectTypeCounts(text: string, field: QuestionExtractionField): Array<{ option: QuestionExtractionFieldOption; count: number }> {
  const normalizedText = normalizeDigits(text);
  const results: Array<{ option: QuestionExtractionFieldOption; count: number }> = [];

  for (const option of field.options ?? []) {
    let count = 0;
    for (const alias of getOptionAliases(option)) {
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const patterns = [
        new RegExp(`${escaped}\\s*(\\d+)\\s*(?:\\u5339|\\u7FBD|\\u982D|\\u4EBA|\\u500B|\\u3064|\\u540D)?`, "gu"),
        new RegExp(`(\\d+)\\s*(?:\\u5339|\\u7FBD|\\u982D|\\u4EBA|\\u500B|\\u3064|\\u540D)?\\s*${escaped}`, "gu")
      ];

      for (const pattern of patterns) {
        for (const match of normalizedText.matchAll(pattern)) {
          const numeric = Number(match[1]);
          if (Number.isFinite(numeric) && numeric > 0) {
            count += numeric;
          }
        }
      }

      if (count === 0 && normalizedText.includes(alias)) {
        count = 1;
      }
    }

    if (count > 0) {
      results.push({ option, count });
    }
  }

  return results;
}

function extractAges(text: string): number[] {
  return Array.from(normalizeDigits(text).matchAll(/(\d+)\s*(?:\u6B73|\u624D)/gu))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value));
}

function extractGroupedDetails(text: string, field: QuestionExtractionField): Map<string, string[]> {
  const result = new Map<string, string[]>();

  for (const option of field.options ?? []) {
    const marker = getOptionAliases(option)
      .map((alias) => `${alias}\u306F`)
      .find((candidate) => text.includes(candidate));
    if (!marker) {
      continue;
    }

    const start = text.indexOf(marker);
    const nextStarts = (field.options ?? [])
      .flatMap((other) => getOptionAliases(other).map((alias) => text.indexOf(`${alias}\u306F`, start + marker.length)))
      .filter((index) => index >= 0);
    const sentenceEnds = [text.indexOf("\u3002", start + marker.length), text.length].filter((index) => index >= 0);
    const end = Math.min(...[...nextStarts, ...sentenceEnds]);
    const raw = text.slice(start + marker.length, end);
    const details = splitNaturalList(raw).filter((item) => !/\d+\s*(?:\u6B73|\u624D|\u5339|\u7FBD|\u982D|\u4EBA)/u.test(item));
    if (details.length > 0) {
      result.set(option.value, details);
    }
  }

  return result;
}

function setFieldValue(entity: ExtractedEntityRecord, key: string, value: PrimitiveFieldValue): void {
  entity.fields[key] = value;
}

function buildMultiObjectRuleExtraction(answerText: string, config: QuestionExtractionConfig): NormalizedExtractionResult {
  const typeField = getTypeField(config);
  const ageField = getAgeField(config);
  const countField = getCountField(config);
  const detailField = getDetailField(config);
  const entities: ExtractedEntityRecord[] = [];

  if (typeField) {
    for (const { option, count } of detectTypeCounts(answerText, typeField)) {
      for (let index = 0; index < count; index += 1) {
        const entity: ExtractedEntityRecord = { index: entities.length, fields: {} };
        setFieldValue(entity, typeField.key, option.value);
        if (countField) {
          setFieldValue(entity, countField.key, 1);
        }
        entities.push(entity);
      }
    }
  }

  const ages = ageField ? extractAges(answerText) : [];
  ages.forEach((age, index) => {
    if (ageField && entities[index]) {
      setFieldValue(entities[index], ageField.key, age);
    }
  });

  if (typeField && detailField && entities.length > 0) {
    const detailsByType = extractGroupedDetails(answerText, typeField);
    for (const entity of entities) {
      const typeValue = normalizeString(entity.fields[typeField.key]);
      if (!typeValue) {
        continue;
      }
      const queue = detailsByType.get(typeValue);
      if (queue && queue.length > 0) {
        setFieldValue(entity, detailField.key, queue.shift() ?? null);
      }
    }
  }

  const summary: Record<string, unknown> = {
    [getEntityArrayField(config)]: entities.map((entity) => entity.fields)
  };
  for (const field of config.schema?.fields ?? []) {
    if (!field.summary_key) {
      continue;
    }
    summary[field.summary_key] = uniqueStrings(
      entities
        .map((entity) => normalizeString(entity.fields[field.key]))
        .filter((value): value is string => Boolean(value))
    );
  }

  const missingFields = (config.schema?.fields ?? [])
    .filter((field) => field.required)
    .flatMap((field) =>
      entities.some((entity) => entity.fields[field.key] === undefined || entity.fields[field.key] === null)
        ? [field.key]
        : []
    );

  return {
    mode: "multi_object",
    status: entities.length === 0 ? "pending" : missingFields.length === 0 ? "completed" : "partial",
    method: "rule_based",
    target: config.target ?? "post_answer",
    schema_version: config.schema?.version ?? null,
    summary,
    entities,
    missing_fields: uniqueStrings(missingFields),
    needs_ai_assist: entities.length === 0 || missingFields.length > 0,
    extracted_at: new Date().toISOString()
  };
}

function buildSingleObjectRuleExtraction(answerText: string, config: QuestionExtractionConfig): NormalizedExtractionResult {
  const fields = config.schema?.fields ?? [];
  const entity: ExtractedEntityRecord = { index: 0, fields: {} };

  for (const field of fields) {
    let value: PrimitiveFieldValue = null;
    if (field.type === "enum") {
      value = findOptionByText(field, answerText)?.value ?? null;
    } else if (field.type === "number") {
      value = field.key === "age" ? extractAges(answerText)[0] ?? null : Number(normalizeDigits(answerText).match(/\d+/u)?.[0] ?? NaN);
      if (!Number.isFinite(value as number)) {
        value = null;
      }
    } else if (fields.length === 1 || field.key === "detail") {
      value = answerText.trim();
    }
    setFieldValue(entity, field.key, value);
  }

  const summary: Record<string, unknown> = {
    [getEntityArrayField(config)]: [entity.fields]
  };
  for (const field of fields) {
    if (field.summary_key && entity.fields[field.key] !== undefined && entity.fields[field.key] !== null) {
      summary[field.summary_key] = [entity.fields[field.key]];
    }
  }

  const missingFields = fields
    .filter((field) => field.required && (entity.fields[field.key] === undefined || entity.fields[field.key] === null))
    .map((field) => field.key);

  return {
    mode: "single_object",
    status: missingFields.length === 0 ? "completed" : "partial",
    method: "rule_based",
    target: config.target ?? "post_answer",
    schema_version: config.schema?.version ?? null,
    summary,
    entities: [entity],
    missing_fields: missingFields,
    needs_ai_assist: missingFields.length > 0,
    extracted_at: new Date().toISOString()
  };
}

function buildRuleExtraction(answerText: string, config: QuestionExtractionConfig): NormalizedExtractionResult {
  return config.mode === "single_object"
    ? buildSingleObjectRuleExtraction(answerText, config)
    : buildMultiObjectRuleExtraction(answerText, config);
}

function scoreExtraction(result: NormalizedExtractionResult): number {
  const filledFields = result.entities.reduce((total, entity) => {
    return total + Object.values(entity.fields).filter((value) => value !== null && value !== undefined && value !== "").length;
  }, 0);
  const statusScore = result.status === "completed" ? 100 : result.status === "partial" ? 60 : result.status === "pending" ? 20 : 0;
  return statusScore + filledFields;
}

function mergeExtractionIntoAnswer(baseNormalized: Record<string, unknown> | null | undefined, extraction: NormalizedExtractionResult): Record<string, unknown> {
  return {
    ...(baseNormalized ?? {}),
    extraction,
    extracted_branch_payload: extraction.summary,
    extraction_status: extraction.status,
    extraction_method: extraction.method
  };
}

function shouldRunAiDuringConversation(config: QuestionExtractionConfig, extraction: NormalizedExtractionResult, requireForBranching: boolean): boolean {
  return config.mode === "multi_object" && extraction.needs_ai_assist === true && (requireForBranching || config.extracted_branch_enabled === true);
}

async function maybeEnhanceWithAi(input: {
  sessionId: string;
  project: Project;
  question: Question;
  answerText: string;
  config: QuestionExtractionConfig;
  extraction: NormalizedExtractionResult;
  force: boolean;
}): Promise<NormalizedExtractionResult> {
  if (!input.force && !shouldRunAiDuringConversation(input.config, input.extraction, false)) {
    return input.extraction;
  }

  const aiExtraction = await aiService.extractAnswerEntities({
    sessionId: input.sessionId,
    project: input.project,
    question: input.question,
    answer: input.answerText,
    extractionConfig: input.config,
    ruleResult: input.extraction
  });

  if (!aiExtraction) {
    return input.extraction;
  }

  return scoreExtraction(aiExtraction) >= scoreExtraction(input.extraction) ? aiExtraction : input.extraction;
}

export const answerExtractionService = {
  getExtractionConfig(question: Question): QuestionExtractionConfig | null {
    return getQuestionExtractionConfig(question.question_config);
  },

  async enrichAnswerForConversation(input: {
    sessionId: string;
    project: Project;
    question: Question;
    answerText: string;
    baseNormalized: Record<string, unknown> | null;
    requireForBranching?: boolean;
  }): Promise<BuiltExtraction | null> {
    const config = this.getExtractionConfig(input.question);
    if (!config) {
      return null;
    }

    let extraction = buildRuleExtraction(input.answerText, config);
    if (shouldRunAiDuringConversation(config, extraction, input.requireForBranching ?? false)) {
      extraction = await maybeEnhanceWithAi({
        sessionId: input.sessionId,
        project: input.project,
        question: input.question,
        answerText: input.answerText,
        config,
        extraction,
        force: true
      });
    }

    return {
      extraction,
      normalizedAnswer: mergeExtractionIntoAnswer(input.baseNormalized, extraction)
    };
  },

  async persistForAnswer(answer: Answer, projectId: string): Promise<void> {
    if (!isPlainObject(answer.normalized_answer)) {
      return;
    }

    const extractionValue = answer.normalized_answer.extraction;
    if (!isPlainObject(extractionValue)) {
      return;
    }

    const extraction = extractionValue as unknown as NormalizedExtractionResult;
    await answerExtractionRepository.upsert({
      source_answer_id: answer.id,
      project_id: projectId,
      question_id: answer.question_id,
      extraction_status: extraction.status,
      extraction_method: extraction.method,
      extracted_json: extraction,
      extracted_at: extraction.extracted_at ?? new Date().toISOString()
    });
  },

  async reprocessAnswer(input: {
    sessionId: string;
    project: Project;
    question: Question;
    answer: Answer;
    forceAi?: boolean;
  }): Promise<NormalizedExtractionResult | null> {
    const config = this.getExtractionConfig(input.question);
    if (!config) {
      return null;
    }

    let extraction = buildRuleExtraction(input.answer.answer_text, config);
    const shouldUseAi = Boolean(
      input.forceAi || config.target === "post_session" || extraction.needs_ai_assist === true || config.extracted_branch_enabled === true
    );
    if (shouldUseAi) {
      extraction = await maybeEnhanceWithAi({
        sessionId: input.sessionId,
        project: input.project,
        question: input.question,
        answerText: input.answer.answer_text,
        config,
        extraction,
        force: true
      });
    }

    const normalizedAnswer = mergeExtractionIntoAnswer(input.answer.normalized_answer, extraction);
    await answerRepository.update(input.answer.id, {
      normalized_answer: normalizedAnswer
    });
    await answerExtractionRepository.upsert({
      source_answer_id: input.answer.id,
      project_id: input.project.id,
      question_id: input.question.id,
      extraction_status: extraction.status,
      extraction_method: extraction.method,
      extracted_json: extraction,
      extracted_at: extraction.extracted_at ?? new Date().toISOString()
    });
    return extraction;
  }
};
