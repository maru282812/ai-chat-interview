import { logger } from "../lib/logger";
import { projectAssignmentRepository } from "../repositories/projectAssignmentRepository";
import { projectRepository } from "../repositories/projectRepository";
import { screeningConditionRepository } from "../repositories/screeningConditionRepository";
import { userProfileRepository } from "../repositories/userProfileRepository";
import type {
  Question,
  ScreeningCondition,
  ScreeningJudgement,
  ScreeningOperator,
  ScreeningPassAction,
  ScreeningResult,
  UserProfile
} from "../types/domain";
import { lineMessagingService } from "./lineMessagingService";

const DEFAULT_PASS_MESSAGE = "スクリーニングを通過しました。次のステップへお進みください。";
const DEFAULT_FAIL_MESSAGE = "今回はご参加いただけませんでした。またの機会にご協力をお願いします。";

export interface ScreeningResultOutput {
  result: ScreeningResult;
  pass_action: ScreeningPassAction;
  message_sent: boolean;
}

export interface ScreeningJudgementOutput {
  judgement: ScreeningJudgement;
  failed_conditions: string[];
}

// ------------------------------------------------------------------
// 条件評価ヘルパー
// ------------------------------------------------------------------

function toNumber(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeValue(v: unknown): string {
  return String(v ?? "").toLowerCase().trim();
}

function evaluateOperator(
  rawValue: unknown,
  operator: ScreeningOperator,
  condValue: unknown
): boolean {
  switch (operator) {
    case "equals":
      return normalizeValue(rawValue) === normalizeValue(condValue);
    case "not_equals":
      return normalizeValue(rawValue) !== normalizeValue(condValue);
    case "in": {
      const list = Array.isArray(condValue) ? condValue : [condValue];
      if (list.length === 0) return true; // 値未選択 = フィルタなし（全員通過）
      const normalized = normalizeValue(rawValue);
      return list.map(normalizeValue).includes(normalized);
    }
    case "not_in": {
      const list = Array.isArray(condValue) ? condValue : [condValue];
      const normalized = normalizeValue(rawValue);
      return !list.map(normalizeValue).includes(normalized);
    }
    case "gte": {
      const n = toNumber(rawValue);
      const threshold = toNumber(condValue);
      if (n === null || threshold === null) return false;
      return n >= threshold;
    }
    case "lte": {
      const n = toNumber(rawValue);
      const threshold = toNumber(condValue);
      if (n === null || threshold === null) return false;
      return n <= threshold;
    }
    case "between": {
      const n = toNumber(rawValue);
      const range = Array.isArray(condValue) ? condValue : [];
      const min = toNumber(range[0]);
      const max = toNumber(range[1]);
      if (n === null || min === null || max === null) return false;
      return n >= min && n <= max;
    }
    default:
      return false;
  }
}

/** プロフィールから指定フィールドの値を取り出す */
function extractProfileValue(profile: UserProfile | null, key: string): unknown {
  if (!profile) return null;
  if (key === "age") {
    if (!profile.birth_date) return null;
    const birth = new Date(profile.birth_date);
    const today = new Date();
    let age = today.getFullYear() - birth.getFullYear();
    const m = today.getMonth() - birth.getMonth();
    if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
    return age;
  }
  return (profile as unknown as Record<string, unknown>)[key] ?? null;
}

/** 回答マップから指定question_codeの回答を取り出す */
function extractAnswerValue(
  answerMap: Record<string, string>,
  questionCode: string
): unknown {
  return answerMap[questionCode] ?? null;
}

/** 単一の条件を評価して合否と説明文を返す */
function evaluateCondition(
  cond: ScreeningCondition,
  profile: UserProfile | null,
  answerMap: Record<string, string>
): { pass: boolean; description: string } {
  let rawValue: unknown;
  if (cond.condition_type === "profile") {
    rawValue = extractProfileValue(profile, cond.target_key);
  } else {
    rawValue = extractAnswerValue(answerMap, cond.target_key);
  }

  // 配列値（in / not_in）は各要素を個別に評価
  if (Array.isArray(rawValue)) {
    // 配列の場合: in/not_in は「いずれかの要素が条件を満たす」
    const anyPass = rawValue.some(v =>
      evaluateOperator(v, cond.operator, cond.value_json)
    );
    const pass = cond.operator === "not_in" ? rawValue.every(v => evaluateOperator(v, cond.operator, cond.value_json)) : anyPass;
    return {
      pass,
      description: `${cond.condition_type}:${cond.target_key} ${cond.operator} ${JSON.stringify(cond.value_json)}`
    };
  }

  const pass = evaluateOperator(rawValue, cond.operator, cond.value_json);
  return {
    pass,
    description: `${cond.condition_type}:${cond.target_key} ${cond.operator} ${JSON.stringify(cond.value_json)}`
  };
}

// ------------------------------------------------------------------
// 設問ベースのスクリーニング判定
// ------------------------------------------------------------------

const SCREENING_SUPPORTED_TYPES = new Set([
  "single_choice",
  "multi_choice",
  "hidden_single",
  "hidden_multi",
]);

export interface QuestionScreeningJudgementOutput {
  judgement: ScreeningJudgement;
  failed_question_codes: string[];
}

/**
 * スクリーニング設問の回答を通過対象選択肢と照合して pass/fail を返す。
 * is_screening_question=true かつ SCREENING_SUPPORTED_TYPES の設問のみ評価する。
 */
function judgeQuestionScreening(
  screeningQuestions: Question[],
  answerMap: Record<string, string>
): QuestionScreeningJudgementOutput {
  const failedCodes: string[] = [];

  for (const q of screeningQuestions) {
    if (!q.is_screening_question) continue;
    if (!SCREENING_SUPPORTED_TYPES.has(q.question_type)) continue;

    const options = q.question_config?.options ?? [];
    const passValues = new Set(
      options.filter(o => o.isScreeningPass).map(o => String(o.value))
    );
    if (passValues.size === 0) continue; // pass対象未設定 = 全員通過

    const raw = answerMap[q.question_code] ?? null;
    if (raw === null) {
      failedCodes.push(q.question_code);
      continue;
    }

    let passes = false;
    if (q.question_type === "multi_choice" || q.question_type === "hidden_multi") {
      let selected: string[] = [];
      try { selected = JSON.parse(raw); } catch { selected = [raw]; }
      passes = selected.some(v => passValues.has(String(v)));
    } else {
      passes = passValues.has(String(raw));
    }

    if (!passes) failedCodes.push(q.question_code);
  }

  return {
    judgement: failedCodes.length === 0 ? "pass" : "fail",
    failed_question_codes: failedCodes,
  };
}

// ------------------------------------------------------------------
// screeningService
// ------------------------------------------------------------------

export const screeningService = {
  /**
   * スクリーニング結果を記録し、通過/非通過に応じたメッセージを送信する。
   * 非通過者には必ず終了案内を送信する。
   * 通過者の pass_action に応じて次工程を返す。
   */
  async recordResult(input: {
    assignmentId: string;
    result: ScreeningResult;
    lineUserId: string;
  }): Promise<ScreeningResultOutput> {
    const assignment = await projectAssignmentRepository.getById(input.assignmentId);
    const project = await projectRepository.getById(assignment.project_id);
    const config = project.screening_config ?? {};

    // pass_action は research_mode から自動判定（設定済みの場合はそちらを優先）
    const passAction: ScreeningPassAction =
      config.pass_action ?? (project.research_mode === "interview" ? "interview" : "survey");

    await projectAssignmentRepository.update(input.assignmentId, {
      screening_result: input.result,
      screening_result_at: new Date().toISOString()
    } as Parameters<typeof projectAssignmentRepository.update>[1]);

    let messageSent = false;

    const messageText =
      input.result === "failed"
        ? config.fail_message?.trim() || DEFAULT_FAIL_MESSAGE
        : config.pass_message?.trim() || DEFAULT_PASS_MESSAGE;

    try {
      await lineMessagingService.push(input.lineUserId, [{ type: "text", text: messageText }]);
      messageSent = true;
    } catch (error) {
      logger.error("Failed to send screening message", {
        assignmentId: input.assignmentId,
        result: input.result,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return { result: input.result, pass_action: passAction, message_sent: messageSent };
  },

  /**
   * プロフィール条件 + 設問通過対象回答をもとに合否を判定して pass/fail を返す。
   * 1) プロフィール条件（screening_conditions テーブル）を評価
   * 2) is_screening_question=true の設問回答を isScreeningPass オプションと照合
   * 両方 pass した場合のみ通過。条件・設問ともに 0 件なら無条件 pass。
   */
  async judgeScreening(input: {
    projectId: string;
    lineUserId: string | null;
    /** is_screening_question=true の設問オブジェクト（question_config付き） */
    screeningQuestions: Question[];
    /** sessionId に紐づく screening 質問の回答マップ {question_code: answer_text} */
    screeningAnswers: Record<string, string>;
  }): Promise<ScreeningJudgementOutput> {
    const [conditions, profile] = await Promise.all([
      screeningConditionRepository.listByProject(input.projectId),
      input.lineUserId
        ? userProfileRepository.getByLineUserId(input.lineUserId).catch(() => null)
        : Promise.resolve(null)
    ]);

    const failedConditions: string[] = [];

    // プロフィール条件評価
    for (const cond of conditions) {
      const { pass, description } = evaluateCondition(cond, profile, input.screeningAnswers);
      if (!pass) failedConditions.push(description);
    }

    // 設問通過対象回答評価
    const qResult = judgeQuestionScreening(input.screeningQuestions, input.screeningAnswers);
    for (const code of qResult.failed_question_codes) {
      failedConditions.push(`question:${code}`);
    }

    const judgement: ScreeningJudgement = failedConditions.length === 0 ? "pass" : "fail";

    logger.info("screeningService.judgeScreening", {
      projectId: input.projectId,
      conditionCount: conditions.length,
      judgement,
      failedCount: failedConditions.length
    });

    return { judgement, failed_conditions: failedConditions };
  },

  /**
   * プロジェクトのスクリーニング設定を更新する。
   */
  async updateScreeningConfig(
    projectId: string,
    config: {
      pass_message?: string | null;
      fail_message?: string | null;
      pass_action?: ScreeningPassAction;
    }
  ): Promise<void> {
    await projectRepository.update(projectId, { screening_config: config });
  }
};
