import type {
  Question,
  QuestionBranchCondition,
  QuestionBranchRoute,
  QuestionBranchRule,
  QuestionBranchSource,
  QuestionConfig,
  QuestionExtractionConfig,
  QuestionExtractionField,
  QuestionExtractionFieldOption,
  QuestionExtractionSchema,
  QuestionOption,
  QuestionType
} from "../types/domain";

type BranchPrimitive = string | number | boolean;

const MANAGED_CONFIG_KEYS = [
  "options",
  "placeholder",
  "max_length",
  "example_answer",
  "min_select",
  "max_select",
  "yes_label",
  "no_label",
  "min",
  "max",
  "min_label",
  "max_label",
  "scaleMin",
  "scaleMax",
  "scaleLabels"
] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.round(value);
  }

  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.round(numeric);
    }
  }

  return null;
}

function normalizePrimitive(value: unknown): BranchPrimitive | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized ? normalized : null;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "boolean") {
    return value;
  }

  return null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map((item) => normalizeString(item)).filter((item): item is string => Boolean(item));
}

function normalizeOptions(options: unknown): QuestionOption[] {
  if (!Array.isArray(options)) {
    return [];
  }

  return options
    .map((option) => {
      if (!isPlainObject(option)) {
        return null;
      }

      const label = normalizeString(option.label);
      const value = normalizeString(option.value);
      if (!label || !value) {
        return null;
      }

      return { label, value };
    })
    .filter((option): option is QuestionOption => Boolean(option));
}

function normalizeExtractionFieldOption(value: unknown): QuestionExtractionFieldOption | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const optionValue = normalizeString(value.value);
  if (!optionValue) {
    return null;
  }

  return {
    value: optionValue,
    label: normalizeString(value.label) ?? undefined,
    aliases: normalizeStringArray(value.aliases)
  };
}

function normalizeExtractionField(value: unknown): QuestionExtractionField | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const key = normalizeString(value.key);
  if (!key) {
    return null;
  }

  const type = normalizeString(value.type);
  const normalizedType =
    type === "string" || type === "number" || type === "enum" || type === "boolean" ? type : undefined;
  const options = Array.isArray(value.options)
    ? value.options
        .map((item) => normalizeExtractionFieldOption(item))
        .filter((item): item is QuestionExtractionFieldOption => Boolean(item))
    : [];

  return {
    key,
    label: normalizeString(value.label) ?? undefined,
    description: normalizeString(value.description) ?? undefined,
    type: normalizedType,
    required: typeof value.required === "boolean" ? value.required : undefined,
    aliases: normalizeStringArray(value.aliases),
    options,
    summary_key: normalizeString(value.summary_key) ?? undefined
  };
}

function normalizeExtractionSchema(value: unknown): QuestionExtractionSchema | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const fields = Array.isArray(value.fields)
    ? value.fields
        .map((item) => normalizeExtractionField(item))
        .filter((item): item is QuestionExtractionField => Boolean(item))
    : [];

  return {
    version: normalizeString(value.version) ?? undefined,
    entity_name: normalizeString(value.entity_name) ?? undefined,
    entity_label: normalizeString(value.entity_label) ?? undefined,
    array_field: normalizeString(value.array_field) ?? undefined,
    fields
  };
}

export function normalizeExtractionConfig(value: unknown): QuestionExtractionConfig | null {
  if (!isPlainObject(value)) {
    return null;
  }

  const mode = normalizeString(value.mode);
  const target = normalizeString(value.target);
  return {
    mode: mode === "none" || mode === "single_object" || mode === "multi_object" ? mode : "none",
    schema: normalizeExtractionSchema(value.schema),
    target: target === "post_answer" || target === "post_session" ? target : "post_answer",
    extracted_branch_enabled: typeof value.extracted_branch_enabled === "boolean" ? value.extracted_branch_enabled : false
  };
}

function removeManagedConfigKeys(config: Record<string, unknown>): Record<string, unknown> {
  const next = { ...config };
  for (const key of MANAGED_CONFIG_KEYS) {
    delete next[key];
  }
  return next;
}

function toCanonicalBranchCondition(input: unknown): QuestionBranchCondition | null {
  if (!isPlainObject(input)) {
    return null;
  }

  if ("equals" in input) {
    const equals = normalizePrimitive(input.equals);
    return equals === null ? null : { equals };
  }

  if ("includes" in input) {
    const includes = normalizePrimitive(input.includes);
    return includes === null ? null : { includes };
  }

  if ("any_of" in input && Array.isArray(input.any_of)) {
    const values = input.any_of
      .map((item) => normalizePrimitive(item))
      .filter((item): item is BranchPrimitive => item !== null);
    return values.length > 0 ? { any_of: values } : null;
  }

  if ("gte" in input) {
    const gte = normalizeNumber(input.gte);
    return gte === null ? null : { gte };
  }

  if ("lte" in input) {
    const lte = normalizeNumber(input.lte);
    return lte === null ? null : { lte };
  }

  const operator = normalizeString(input.operator);
  if (!operator) {
    return null;
  }

  if (operator === "gte" || operator === "lte") {
    const numeric = normalizeNumber(input.value);
    return numeric === null ? null : operator === "gte" ? { gte: numeric } : { lte: numeric };
  }

  const legacyValue = normalizePrimitive(input.value);
  if (legacyValue === null) {
    return null;
  }

  switch (operator) {
    case "equals":
      return { equals: legacyValue };
    case "includes":
      return { includes: legacyValue };
    default:
      return null;
  }
}

function normalizeBranchSource(value: unknown): QuestionBranchSource | undefined {
  const normalized = normalizeString(value);
  return normalized === "answer" || normalized === "extracted" ? normalized : undefined;
}

function toCanonicalBranchRoute(input: unknown): QuestionBranchRoute | null {
  if (!isPlainObject(input)) {
    return null;
  }

  const next = normalizeString(input.next) ?? normalizeString(input.targetQuestionCode);
  const when = toCanonicalBranchCondition(input.when ?? input);
  if (!next || !when) {
    return null;
  }

  return {
    source: normalizeBranchSource(input.source),
    field: normalizeString(input.field),
    when,
    next
  };
}

function comparePrimitive(left: BranchPrimitive, right: BranchPrimitive): boolean {
  if (typeof left === "number" || typeof right === "number") {
    return Number(left) === Number(right);
  }

  if (typeof left === "boolean" || typeof right === "boolean") {
    const normalizeBoolean = (value: BranchPrimitive): boolean | null => {
      if (typeof value === "boolean") {
        return value;
      }
      if (typeof value === "string") {
        if (value === "true" || value === "yes") {
          return true;
        }
        if (value === "false" || value === "no") {
          return false;
        }
      }
      return null;
    };

    const leftBoolean = normalizeBoolean(left);
    const rightBoolean = normalizeBoolean(right);
    if (leftBoolean !== null && rightBoolean !== null) {
      return leftBoolean === rightBoolean;
    }
  }

  return left === right;
}

function extractPrimitiveCandidates(value: unknown): BranchPrimitive[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => extractPrimitiveCandidates(item));
  }

  const primitive = normalizePrimitive(value);
  return primitive === null ? [] : [primitive];
}

function resolvePathValues(value: unknown, path: string | null | undefined): unknown[] {
  const segments = String(path ?? "")
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length === 0) {
    return [value];
  }

  const walk = (current: unknown, index: number): unknown[] => {
    if (index >= segments.length) {
      return [current];
    }

    if (Array.isArray(current)) {
      return current.flatMap((item) => walk(item, index));
    }

    if (!isPlainObject(current)) {
      return [];
    }

    const segment = segments[index];
    if (!segment) {
      return [];
    }
    return walk(current[segment], index + 1);
  };

  return walk(value, 0);
}

function collectBranchCandidates(route: QuestionBranchRoute, normalizedAnswer: Record<string, unknown>): BranchPrimitive[] {
  if (route.source === "extracted") {
    const extractionValue = normalizedAnswer.extraction;
    const extractionSummary =
      isPlainObject(extractionValue) && isPlainObject(extractionValue.summary)
        ? (extractionValue.summary as Record<string, unknown>)
        : null;
    const extractedSource = isPlainObject(normalizedAnswer.extracted_branch_payload)
      ? normalizedAnswer.extracted_branch_payload
      : extractionSummary ?? {};
    return resolvePathValues(extractedSource, route.field).flatMap((value) => extractPrimitiveCandidates(value));
  }

  if (route.field) {
    return resolvePathValues(normalizedAnswer, route.field).flatMap((value) => extractPrimitiveCandidates(value));
  }

  return [
    ...extractPrimitiveCandidates(normalizedAnswer.value),
    ...extractPrimitiveCandidates(normalizedAnswer.boolean),
    ...extractPrimitiveCandidates(normalizedAnswer.values)
  ];
}

function matchesCanonicalCondition(condition: QuestionBranchCondition, candidates: BranchPrimitive[]): boolean {
  if ("equals" in condition && condition.equals !== undefined) {
    const expected = condition.equals;
    return candidates.some((candidate) => comparePrimitive(candidate, expected));
  }

  if ("includes" in condition && condition.includes !== undefined) {
    const expected = condition.includes;
    return candidates.some((candidate) => comparePrimitive(candidate, expected));
  }

  if ("any_of" in condition && Array.isArray(condition.any_of)) {
    return condition.any_of.some((expected) => candidates.some((candidate) => comparePrimitive(candidate, expected)));
  }

  if ("gte" in condition && typeof condition.gte === "number") {
    const expected = condition.gte;
    return candidates.some((candidate) => Number(candidate) >= expected);
  }

  if ("lte" in condition && typeof condition.lte === "number") {
    const expected = condition.lte;
    return candidates.some((candidate) => Number(candidate) <= expected);
  }

  return false;
}

function matchesLegacyRoute(route: Record<string, unknown>, normalizedAnswer: Record<string, unknown>): boolean {
  const when = isPlainObject(route.when) ? route.when : null;
  const operator = normalizeString(when?.operator);
  const expected = normalizePrimitive(when?.value);
  const scalarCandidates = [
    normalizePrimitive(normalizedAnswer.value),
    normalizePrimitive(normalizedAnswer.boolean)
  ].filter((item): item is BranchPrimitive => item !== null);
  const arrayValues = Array.isArray(normalizedAnswer.values)
    ? normalizedAnswer.values
        .map((item) => normalizePrimitive(item))
        .filter((item): item is BranchPrimitive => item !== null)
    : [];

  if (!operator || expected === null) {
    return false;
  }

  switch (operator) {
    case "equals":
      return scalarCandidates.some((candidate) => comparePrimitive(candidate, expected));
    case "not_equals":
      return scalarCandidates.every((candidate) => !comparePrimitive(candidate, expected));
    case "includes":
      return arrayValues.some((candidate) => comparePrimitive(candidate, expected));
    case "gte":
      return scalarCandidates.some((candidate) => Number(candidate) >= Number(expected));
    case "lte":
      return scalarCandidates.some((candidate) => Number(candidate) <= Number(expected));
    default:
      return false;
  }
}

export function normalizeQuestionConfig(
  questionType: QuestionType,
  value: Question["question_config"] | unknown
): Question["question_config"] {
  if (!isPlainObject(value)) {
    return null;
  }

  const normalized = removeManagedConfigKeys(value);

  switch (questionType) {
    case "text": {
      const placeholder = normalizeString(value.placeholder);
      const maxLength = normalizeNumber(value.max_length);
      const exampleAnswer = normalizeString(value.example_answer);

      if (placeholder) {
        normalized.placeholder = placeholder;
      }
      if (maxLength !== null) {
        normalized.max_length = maxLength;
      }
      if (exampleAnswer) {
        normalized.example_answer = exampleAnswer;
      }
      break;
    }
    case "single_select": {
      const options = normalizeOptions(value.options);
      if (options.length > 0) {
        normalized.options = options;
      }
      break;
    }
    case "multi_select": {
      const options = normalizeOptions(value.options);
      const minSelect = normalizeNumber(value.min_select);
      const maxSelect = normalizeNumber(value.max_select);

      if (options.length > 0) {
        normalized.options = options;
      }
      if (minSelect !== null) {
        normalized.min_select = minSelect;
      }
      if (maxSelect !== null) {
        normalized.max_select = maxSelect;
      }
      break;
    }
    case "yes_no": {
      const yesLabel = normalizeString(value.yes_label);
      const noLabel = normalizeString(value.no_label);

      if (yesLabel) {
        normalized.yes_label = yesLabel;
      }
      if (noLabel) {
        normalized.no_label = noLabel;
      }
      break;
    }
    case "scale": {
      const min = normalizeNumber(value.min ?? value.scaleMin);
      const max = normalizeNumber(value.max ?? value.scaleMax);
      const scaleLabels = isPlainObject(value.scaleLabels) ? value.scaleLabels : null;
      const minLabel =
        normalizeString(value.min_label) ??
        (scaleLabels && min !== null ? normalizeString(scaleLabels[String(min)]) : null);
      const maxLabel =
        normalizeString(value.max_label) ??
        (scaleLabels && max !== null ? normalizeString(scaleLabels[String(max)]) : null);

      if (min !== null) {
        normalized.min = min;
      }
      if (max !== null) {
        normalized.max = max;
      }
      if (minLabel) {
        normalized.min_label = minLabel;
      }
      if (maxLabel) {
        normalized.max_label = maxLabel;
      }
      break;
    }
    default:
      break;
  }

  return Object.keys(normalized).length > 0 ? (normalized as QuestionConfig) : null;
}

export function getQuestionExtractionConfig(config: Question["question_config"] | null): QuestionExtractionConfig | null {
  const extraction = normalizeExtractionConfig(config?.extraction);
  if (!extraction || extraction.mode === "none") {
    return null;
  }
  return extraction;
}

export function normalizeBranchRule(value: Question["branch_rule"] | unknown): QuestionBranchRule | null {
  if (Array.isArray(value)) {
    const branches = value
      .map((item) => toCanonicalBranchRoute(item))
      .filter((item): item is QuestionBranchRoute => Boolean(item));
    return branches.length > 0 ? { branches } : null;
  }

  if (!isPlainObject(value)) {
    return null;
  }

  const defaultNext = normalizeString(value.default_next);
  const mergeQuestionCode = normalizeString(value.merge_question_code);
  const branches = Array.isArray(value.branches)
    ? value.branches
        .map((item) => toCanonicalBranchRoute(item))
        .filter((item): item is QuestionBranchRoute => Boolean(item))
    : [];

  if (!defaultNext && !mergeQuestionCode && branches.length === 0) {
    return null;
  }

  return {
    default_next: defaultNext,
    merge_question_code: mergeQuestionCode,
    branches
  };
}

export function getQuestionScaleRange(config: Question["question_config"] | null): {
  min: number;
  max: number;
  minLabel: string;
  maxLabel: string;
} {
  const min = normalizeNumber(config?.min ?? config?.scaleMin) ?? 1;
  const max = normalizeNumber(config?.max ?? config?.scaleMax) ?? 5;
  const minLabel =
    normalizeString(config?.min_label) ??
    (isPlainObject(config?.scaleLabels) ? normalizeString(config?.scaleLabels[String(min)]) : null) ??
    "";
  const maxLabel =
    normalizeString(config?.max_label) ??
    (isPlainObject(config?.scaleLabels) ? normalizeString(config?.scaleLabels[String(max)]) : null) ??
    "";

  return { min, max, minLabel, maxLabel };
}

export function getYesNoLabels(config: Question["question_config"] | null): {
  yesLabel: string;
  noLabel: string;
} {
  return {
    yesLabel: normalizeString(config?.yes_label) ?? "\u306F\u3044",
    noLabel: normalizeString(config?.no_label) ?? "\u3044\u3044\u3048"
  };
}

export function describeBranchRule(rule: Question["branch_rule"] | null): {
  hasBranches: boolean;
  branchCount: number;
  defaultNext: string | null;
  mergeQuestionCode: string | null;
} {
  const normalized = normalizeBranchRule(rule);
  return {
    hasBranches: Boolean(normalized?.branches?.length),
    branchCount: normalized?.branches?.length ?? 0,
    defaultNext: normalized?.default_next ?? null,
    mergeQuestionCode: normalized?.merge_question_code ?? null
  };
}

export function listBranchTargetCodes(rule: Question["branch_rule"] | null): string[] {
  const normalized = normalizeBranchRule(rule);
  const targets = [
    normalized?.default_next ?? null,
    normalized?.merge_question_code ?? null,
    ...(normalized?.branches?.map((branch) => branch.next) ?? [])
  ].filter((item): item is string => Boolean(item));

  return Array.from(new Set(targets));
}

export function resolveNextQuestionCode(
  rule: Question["branch_rule"] | null,
  normalizedAnswer: Record<string, unknown>
): string | null {
  const normalized = normalizeBranchRule(rule);

  for (const branch of normalized?.branches ?? []) {
    if (matchesCanonicalCondition(branch.when, collectBranchCandidates(branch, normalizedAnswer))) {
      return branch.next;
    }
  }

  if (normalized?.default_next) {
    return normalized.default_next;
  }

  if (normalized?.merge_question_code) {
    return normalized.merge_question_code;
  }

  if (Array.isArray(rule)) {
    for (const branch of rule) {
      if (isPlainObject(branch) && matchesLegacyRoute(branch, normalizedAnswer)) {
        return normalizeString(branch.targetQuestionCode);
      }
    }
  }

  return null;
}

export function resolveMatchedBranchCode(
  rule: Question["branch_rule"] | null,
  normalizedAnswer: Record<string, unknown>
): string | null {
  const normalized = normalizeBranchRule(rule);

  for (const branch of normalized?.branches ?? []) {
    if (matchesCanonicalCondition(branch.when, collectBranchCandidates(branch, normalizedAnswer))) {
      return branch.next;
    }
  }

  if (Array.isArray(rule)) {
    for (const branch of rule) {
      if (isPlainObject(branch) && matchesLegacyRoute(branch, normalizedAnswer)) {
        return normalizeString(branch.targetQuestionCode);
      }
    }
  }

  return null;
}

export function validateQuestionConfig(questionType: QuestionType, config: Question["question_config"] | null): string[] {
  const errors: string[] = [];
  const normalized = normalizeQuestionConfig(questionType, config);

  if (questionType === "text") {
    const maxLength = normalizeNumber(normalized?.max_length);
    if (maxLength !== null && maxLength <= 0) {
      errors.push("text question max_length must be at least 1.");
    }
  }

  if (questionType === "single_select" || questionType === "multi_select") {
    const options = normalized?.options ?? [];
    if (options.length === 0) {
      errors.push(`${questionType} requires at least one option.`);
    }

    const values = options.map((option) => option.value);
    if (values.length !== new Set(values).size) {
      errors.push("Option values must be unique.");
    }

    if (questionType === "multi_select") {
      const minSelect = normalizeNumber(normalized?.min_select);
      const maxSelect = normalizeNumber(normalized?.max_select);
      if (minSelect !== null && minSelect < 0) {
        errors.push("multi_select min_select must be 0 or greater.");
      }
      if (maxSelect !== null && maxSelect <= 0) {
        errors.push("multi_select max_select must be 1 or greater.");
      }
      if (minSelect !== null && maxSelect !== null && minSelect > maxSelect) {
        errors.push("multi_select min_select must not exceed max_select.");
      }
      if (maxSelect !== null && options.length > 0 && maxSelect > options.length) {
        errors.push("multi_select max_select must not exceed option count.");
      }
    }
  }

  if (questionType === "yes_no" && Array.isArray(config?.options) && config.options.length > 0) {
    errors.push("yes_no cannot define options. Use yes_label / no_label.");
  }

  if (questionType === "scale") {
    const { min, max } = getQuestionScaleRange(config);
    if (min >= max) {
      errors.push("scale min must be smaller than max.");
    }
  }

  const extractionConfig = normalizeExtractionConfig(config?.extraction);
  if (extractionConfig && extractionConfig.mode !== "none") {
    if (questionType !== "text") {
      errors.push("extraction is available only for text questions.");
    }

    if (!extractionConfig.schema || (extractionConfig.schema.fields?.length ?? 0) === 0) {
      errors.push("extraction_schema.fields must contain at least one field.");
    }
  }

  return errors;
}

export function validateBranchRule(
  rule: Question["branch_rule"] | null,
  allowedQuestionCodes: Set<string>
): string[] {
  const errors: string[] = [];
  const normalized = normalizeBranchRule(rule);
  if (!normalized) {
    return errors;
  }

  if (normalized.default_next && !allowedQuestionCodes.has(normalized.default_next)) {
    errors.push(`default_next points to an unknown question_code: ${normalized.default_next}`);
  }

  if (normalized.merge_question_code && !allowedQuestionCodes.has(normalized.merge_question_code)) {
    errors.push(`merge_question_code points to an unknown question_code: ${normalized.merge_question_code}`);
  }

  for (const branch of normalized.branches ?? []) {
    if (!allowedQuestionCodes.has(branch.next)) {
      errors.push(`branch.next points to an unknown question_code: ${branch.next}`);
    }

    if (branch.source === "extracted" && !branch.field) {
      errors.push("branch field is required when source=extracted.");
    }

    const conditionKeys = ["equals", "includes", "any_of", "gte", "lte"].filter((key) =>
      Object.prototype.hasOwnProperty.call(branch.when, key)
    );
    if (conditionKeys.length !== 1) {
      errors.push("branch.when must define exactly one operator.");
    }

    if ("any_of" in branch.when && (!Array.isArray(branch.when.any_of) || branch.when.any_of.length === 0)) {
      errors.push("branch.when.any_of must contain at least one value.");
    }
  }

  return errors;
}
