import { env } from "../config/env";
import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";
import {
  AGE_OPTIONS,
  DEMOGRAPHIC_AGE_CODE,
  DEMOGRAPHIC_GENDER_CODE,
  DEMOGRAPHIC_QUESTION_SPECS,
  type DemographicRespondentInput,
  type DemographicSummary,
  GENDER_OPTIONS,
  demographicAnswerToken,
  isDemographicQuestion,
  summarizeDemographics
} from "../lib/partnerDemographics";
import {
  type PartnerQuestionType,
  type PartnerQuestionView,
  buildPartnerQuestionConfig,
  toInternalQuestionType,
  toPartnerQuestionType
} from "../lib/partnerQuestions";
import { answerRepository } from "../repositories/answerRepository";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import type { Project, Question, QuestionOption } from "../types/domain";

/**
 * partnerSurveyService.ts
 *
 * パートナーAPI（docs/partner-api.md）のユースケース層。
 * 会員ポータル（hibi-portal）が作る「店舗専用アンケート」を、既存の projects /
 * questions の表現のまま作成・更新・公開・集計・締切する。
 *
 * 既存の管理画面フローとの関係:
 * - 案件は既存の店舗専用アンケートと同じ表現（visibility_type='private_store' +
 *   entry_code）で作る。回答導線は既存の /liff/store（storeEntryService）をそのまま使う。
 * - 所有者スコープだけが新しい（projects.partner_store_id・migration 089）。
 *   :id 系は必ず partner_store_id 一致で引き当てる。不一致は「存在しない」として扱う。
 */

// ------------------------------------------------------------------
// 入力型
// ------------------------------------------------------------------

export interface PartnerQuestionInput {
  question_text: string;
  question_type: PartnerQuestionType;
  answer_options: QuestionOption[] | null;
  sort_order: number;
  is_required?: boolean;
}

export interface CreateSurveyInput {
  partnerStoreId: string;
  title: string;
  questions: PartnerQuestionInput[];
  /** 参照したパッケージ ID（任意・記録用）。 */
  packageId?: string | null;
  store: {
    name: string;
    /** 業種コード（任意）。 */
    industry?: string | null;
  };
}

export interface UpdateSurveyInput {
  partnerStoreId: string;
  surveyId: string;
  title?: string;
  questions?: PartnerQuestionInput[];
}

// ------------------------------------------------------------------
// 出力型
// ------------------------------------------------------------------

export interface PartnerSurveyView {
  survey_id: string;
  title: string;
  status: Project["status"];
  store_id: string;
  store_name: string | null;
  package_id: string | null;
  entry_code: string | null;
  answer_url: string | null;
  questions: PartnerQuestionView[];
  created_at: string;
  updated_at: string;
}

export interface PartnerStatsView {
  survey_id: string;
  status: Project["status"];
  total_count: number;
  demographics: DemographicSummary;
}

// ------------------------------------------------------------------
// 内部ヘルパー
// ------------------------------------------------------------------

/** パートナー設問の sort_order の開始値。1,2 は性年代設問が占有する。 */
const PARTNER_QUESTION_SORT_OFFSET = 10;

/** パートナー設問の question_code。sort_order 由来ではなく通し番号で安定させる。 */
function partnerQuestionCode(index: number): string {
  return `pq${index + 1}`;
}

/**
 * 案件を所有者スコープ付きで取得する。
 * 存在しない・他店舗のものはどちらも 404（存在を漏らさない）。
 */
async function loadOwnedProject(surveyId: string, partnerStoreId: string): Promise<Project> {
  const project = await projectRepository.getPartnerProject(surveyId, partnerStoreId);
  if (!project) {
    throw new HttpError(404, "survey not found");
  }
  return project;
}

/**
 * 一意な entry_code を生成する。
 * 既存の管理画面（adminController.generateUniqueEntryCode）と同じ体裁にそろえ、
 * パートナー経由であることが分かる `p-` プレフィックスを付ける。
 */
async function generatePartnerEntryCode(): Promise<string> {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  for (let attempt = 0; attempt < 8; attempt++) {
    let suffix = "";
    for (let i = 0; i < 6; i++) {
      suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    const code = `p-${suffix}`;
    const existing = await projectRepository.findAnyByEntryCode(code);
    if (!existing) {
      return code;
    }
  }
  return `p-${Date.now().toString(36)}`;
}

/**
 * 回答URL。既存の店舗流入導線（/liff/store?entry_code=...）と同じ形にする。
 * LIFF ID が設定されていれば LIFF 恒久URLを優先する（adminController と同じ理由:
 * LINE の QR リーダーから開いたときに in-app ブラウザのログインループを踏まない）。
 */
export function buildPartnerAnswerUrl(entryCode: string | null | undefined): string | null {
  if (!entryCode) {
    return null;
  }
  const liffId = env.LINE_LIFF_ID_SURVEY ?? env.LINE_LIFF_ID;
  if (liffId) {
    return `https://liff.line.me/${liffId}?entry_code=${encodeURIComponent(entryCode)}`;
  }
  return `${env.APP_BASE_URL}/liff/store?entry_code=${encodeURIComponent(entryCode)}`;
}

/** 性年代設問（サーバー固定）を、この案件に対して常に正しい形へそろえる。 */
async function ensureDemographicQuestions(projectId: string): Promise<void> {
  for (const [index, spec] of DEMOGRAPHIC_QUESTION_SPECS.entries()) {
    const sortOrder = index + 1;
    const existing = await questionRepository.getByProjectAndCode(projectId, spec.question_code);
    const config = buildPartnerQuestionConfig("single_choice", [...spec.options]);
    if (existing) {
      // パートナーが update で壊せない不変条件をここで必ず戻す。
      await questionRepository.update(existing.id, {
        question_text: spec.question_text,
        question_role: "attribute",
        question_type: "single_choice",
        is_required: true,
        sort_order: sortOrder,
        question_config: config,
        answer_options_locked: true,
        ai_probe_enabled: false,
        is_system: true,
        is_hidden: false
      });
      continue;
    }
    await questionRepository.create({
      project_id: projectId,
      question_code: spec.question_code,
      question_text: spec.question_text,
      question_role: "attribute",
      question_type: "single_choice",
      is_required: true,
      sort_order: sortOrder,
      question_config: config,
      answer_options_locked: true,
      ai_probe_enabled: false,
      is_system: true,
      is_hidden: false
    });
  }
}

/** パートナー設問を全置換する（性年代設問とシステム設問は触らない）。 */
async function replacePartnerQuestions(
  projectId: string,
  questions: PartnerQuestionInput[]
): Promise<void> {
  // 生きているパートナー設問だけを再利用対象にする。
  // is_hidden=true は「過去に削られて退避済み」の行で、回答の参照を残すためだけに置いてある
  // （includeHidden:false で除外する）。システム設問（free_comment）と性年代設問は触らない。
  const existing = await questionRepository.listByProject(projectId, { includeHidden: false });
  const editable = existing.filter(
    (question) => !question.is_system && !isDemographicQuestion(question)
  );

  // 入力の sort_order 昇順で採番し直す（欠番・重複を含む入力でも決定的な並びにする）。
  const ordered = [...questions].sort((left, right) => left.sort_order - right.sort_order);

  for (const [index, input] of ordered.entries()) {
    const questionCode = partnerQuestionCode(index);
    const internalType = toInternalQuestionType(input.question_type);
    const config = buildPartnerQuestionConfig(input.question_type, input.answer_options);
    const payload = {
      question_text: input.question_text,
      question_role: "main" as const,
      question_type: internalType,
      is_required: input.is_required ?? true,
      sort_order: PARTNER_QUESTION_SORT_OFFSET + index,
      question_config: config,
      ai_probe_enabled: false,
      is_system: false,
      is_hidden: false
    };
    const reusable = editable[index];
    if (reusable) {
      await questionRepository.update(reusable.id, { question_code: questionCode, ...payload });
      continue;
    }
    await questionRepository.create({
      project_id: projectId,
      question_code: questionCode,
      ...payload
    });
  }

  // 余った既存設問は非表示にする。物理削除しないのは、既に回答が付いている場合に
  // answers.question_id の参照を壊さないため（公開後の編集でも安全に縮められる）。
  //
  // question_code は退避させる。設問を減らして再び増やしたとき、生きている設問へ
  // 同じ `pq{n}` を再採番するため、非表示のまま残った行とコードが衝突するのを避ける
  // （question_code は project 内で一意に扱われ、getByProjectAndCode が別行を引き当ててしまう）。
  for (const [offset, leftover] of editable.slice(ordered.length).entries()) {
    await questionRepository.update(leftover.id, {
      question_code: `${leftover.question_code}_retired${ordered.length + offset}`,
      is_hidden: true
    });
  }
}

/** パートナーに見せる設問一覧（性年代設問を先頭・固定として含む）。 */
async function loadPartnerQuestionViews(projectId: string): Promise<PartnerQuestionView[]> {
  const questions = await questionRepository.listByProject(projectId, { includeHidden: false });
  const views: PartnerQuestionView[] = [];
  for (const question of questions) {
    // free_comment 等のシステム設問（is_hidden=true）は listByProject で既に除外される。
    // 念のため、パートナー種別に写像できないものはレスポンスから落とす。
    const partnerType = toPartnerQuestionType(question);
    if (!partnerType) {
      continue;
    }
    views.push({
      question_code: question.question_code,
      question_text: question.question_text,
      question_type: partnerType,
      answer_options: question.question_config?.options ?? null,
      sort_order: question.sort_order,
      is_required: question.is_required,
      is_fixed: isDemographicQuestion(question)
    });
  }
  return views.sort((left, right) => left.sort_order - right.sort_order);
}

function toSurveyView(project: Project, questions: PartnerQuestionView[]): PartnerSurveyView {
  return {
    survey_id: project.id,
    title: project.user_display_title || project.name,
    status: project.status,
    store_id: project.partner_store_id ?? "",
    store_name: project.client_name,
    package_id: parsePackageId(project),
    entry_code: project.entry_code,
    answer_url: project.status === "published" ? buildPartnerAnswerUrl(project.entry_code) : null,
    questions,
    created_at: project.created_at,
    updated_at: project.updated_at
  };
}

/**
 * 参照パッケージ ID の保存先。
 * 専用列を足さずに済むよう projects.objective に `package:<id>` の形で残す
 * （objective は自由記述の目的欄で、パートナー案件では他用途に使っていない）。
 */
const PACKAGE_MARKER_PREFIX = "package:";

function buildObjective(packageId: string | null | undefined): string | null {
  const id = (packageId ?? "").trim();
  return id ? `${PACKAGE_MARKER_PREFIX}${id}` : null;
}

function parsePackageId(project: Project): string | null {
  const objective = project.objective ?? "";
  return objective.startsWith(PACKAGE_MARKER_PREFIX)
    ? objective.slice(PACKAGE_MARKER_PREFIX.length) || null
    : null;
}

// ------------------------------------------------------------------
// ユースケース
// ------------------------------------------------------------------

export const partnerSurveyService = {
  /** draft を作成する。性年代設問は必ずサーバーが自動付与する。 */
  async createSurvey(input: CreateSurveyInput): Promise<PartnerSurveyView> {
    const entryCode = await generatePartnerEntryCode();
    const project = await projectRepository.create({
      name: input.title,
      user_display_title: input.title,
      client_name: input.store.name,
      objective: buildObjective(input.packageId),
      status: "draft",
      reward_points: 0,
      research_mode: "survey_interview",
      // 店舗QRからの単発回答。既存の店舗専用アンケートと同じ導線に乗せる。
      visibility_type: "private_store",
      entry_code: entryCode,
      partner_store_id: input.partnerStoreId,
      // 一般の「探す」一覧には出さない（QR/URL 経由のみ）。
      is_discoverable: false,
      delivery_enabled: false
    });

    // projectRepository.create が付ける free_comment システム設問はそのまま残す
    // （既存の会話フローが前提にしているため）。パートナーには見せない。
    await ensureDemographicQuestions(project.id);
    await replacePartnerQuestions(project.id, input.questions);

    logger.info("partnerSurvey.created", {
      surveyId: project.id,
      storeId: input.partnerStoreId,
      questionCount: input.questions.length
    });

    const questions = await loadPartnerQuestionViews(project.id);
    return toSurveyView(project, questions);
  },

  /** 所有者スコープ付きで1件取得する。 */
  async getSurvey(partnerStoreId: string, surveyId: string): Promise<PartnerSurveyView> {
    const project = await loadOwnedProject(surveyId, partnerStoreId);
    const questions = await loadPartnerQuestionViews(project.id);
    return toSurveyView(project, questions);
  },

  /**
   * draft を更新する。
   * 性年代設問はここでも必ず再構築するため、パートナーからは消せない/変更できない。
   */
  async updateSurvey(input: UpdateSurveyInput): Promise<PartnerSurveyView> {
    const project = await loadOwnedProject(input.surveyId, input.partnerStoreId);
    if (project.status === "closed" || project.status === "archived") {
      throw new HttpError(409, "closed survey cannot be updated");
    }

    if (input.title !== undefined) {
      await projectRepository.update(project.id, {
        name: input.title,
        user_display_title: input.title
      });
    }
    if (input.questions !== undefined) {
      await replacePartnerQuestions(project.id, input.questions);
    }
    // 順序・必須・選択肢を含めて固定設問の不変条件を毎回戻す。
    await ensureDemographicQuestions(project.id);

    const updated = await projectRepository.getById(project.id);
    const questions = await loadPartnerQuestionViews(updated.id);
    return toSurveyView(updated, questions);
  },

  /** 公開して回答URLを返す。既に公開済みなら同じURLを冪等に返す。 */
  async publishSurvey(
    partnerStoreId: string,
    surveyId: string
  ): Promise<{ survey_id: string; status: Project["status"]; answer_url: string; entry_code: string }> {
    const project = await loadOwnedProject(surveyId, partnerStoreId);
    if (project.status === "closed" || project.status === "archived") {
      throw new HttpError(409, "closed survey cannot be published");
    }

    // 公開前に固定設問をそろえる（draft 中に何が起きていても性年代は必ず入る）。
    await ensureDemographicQuestions(project.id);

    const entryCode = project.entry_code?.trim() || (await generatePartnerEntryCode());
    const published =
      project.status === "published" && project.entry_code
        ? project
        : await projectRepository.update(project.id, {
            status: "published",
            visibility_type: "private_store",
            entry_code: entryCode
          });

    const answerUrl = buildPartnerAnswerUrl(published.entry_code);
    if (!answerUrl) {
      throw new HttpError(500, "failed to build answer url");
    }

    logger.info("partnerSurvey.published", { surveyId: published.id, storeId: partnerStoreId });
    return {
      survey_id: published.id,
      status: published.status,
      answer_url: answerUrl,
      entry_code: published.entry_code ?? entryCode
    };
  },

  /**
   * 回答件数と性年代集計を返す。
   *
   * total_count は「完了セッション数」。URLを開いただけの流入は含めない
   * （既存の管理画面「回答数」の定義に合わせる）。
   * demographics も完了セッションの回答のみを対象にする。
   */
  async getStats(partnerStoreId: string, surveyId: string): Promise<PartnerStatsView> {
    const project = await loadOwnedProject(surveyId, partnerStoreId);

    const [sessions, questions] = await Promise.all([
      sessionRepository.listByProject(project.id),
      questionRepository.listByProject(project.id, { includeHidden: true })
    ]);
    const completedSessions = sessions.filter((session) => session.status === "completed");

    const genderQuestion = questions.find((q) => q.question_code === DEMOGRAPHIC_GENDER_CODE);
    const ageQuestion = questions.find((q) => q.question_code === DEMOGRAPHIC_AGE_CODE);

    const answers = await answerRepository.listBySessions(
      completedSessions.map((session) => session.id)
    );
    const primaryAnswers = answers.filter((answer) => answer.answer_role === "primary");

    const bySession = new Map<string, DemographicRespondentInput>();
    for (const session of completedSessions) {
      bySession.set(session.id, { genderRaw: null, ageRaw: null });
    }
    for (const answer of primaryAnswers) {
      const entry = bySession.get(answer.session_id);
      if (!entry) {
        continue;
      }
      if (genderQuestion && answer.question_id === genderQuestion.id) {
        entry.genderRaw = demographicAnswerToken(answer);
      } else if (ageQuestion && answer.question_id === ageQuestion.id) {
        entry.ageRaw = demographicAnswerToken(answer);
      }
    }

    return {
      survey_id: project.id,
      status: project.status,
      total_count: completedSessions.length,
      demographics: summarizeDemographics([...bySession.values()])
    };
  },

  /**
   * 締め切る。
   *
   * データセット生成のキックは行わない。ai-chat-interview の統計エクスポート
   * （statExportService / rawdataExport）は「管理画面から明示的にダウンロードする」
   * 同期生成の仕組みで、非同期のジョブキュー（生成をキックして後で取りに行く仕組み）は
   * 存在しない。したがってここは締切のみを行い、納品物の生成は運営が管理画面から行う。
   */
  async closeSurvey(
    partnerStoreId: string,
    surveyId: string
  ): Promise<{ survey_id: string; status: Project["status"]; closed_at: string; total_count: number }> {
    const project = await loadOwnedProject(surveyId, partnerStoreId);
    const closed =
      project.status === "closed"
        ? project
        : await projectRepository.update(project.id, { status: "closed" });

    const sessions = await sessionRepository.listByProject(closed.id);
    const totalCount = sessions.filter((session) => session.status === "completed").length;

    logger.info("partnerSurvey.closed", {
      surveyId: closed.id,
      storeId: partnerStoreId,
      totalCount
    });

    return {
      survey_id: closed.id,
      status: closed.status,
      closed_at: closed.updated_at,
      total_count: totalCount
    };
  }
};

/** テスト・ドキュメント生成から参照するための再エクスポート。 */
export const PARTNER_DEMOGRAPHIC_OPTIONS = {
  gender: GENDER_OPTIONS,
  age: AGE_OPTIONS
};

export type { Question as InternalQuestion };
