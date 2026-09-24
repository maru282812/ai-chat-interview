import { HttpError } from "../lib/http";
import { logger } from "../lib/logger";
import { isDemographicQuestion } from "../lib/partnerDemographics";
import {
  isPartnerMatrixType,
  type PartnerAnswerOption,
  type PartnerQuestionType,
  partnerTypeRequiresOptions,
  toPartnerOptions,
  toPartnerQuestionType
} from "../lib/partnerQuestions";
import { cycleGroupRepository } from "../repositories/cycleRepository";
import { projectRepository } from "../repositories/projectRepository";
import { questionRepository } from "../repositories/questionRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { industryTemplateRepository, storeRepository } from "../repositories/storeRepository";
import type { CycleGroup, CycleStepRole, Project, Question, Store } from "../types/domain";
import { buildStoreEntryLiffUrl } from "./liffService";
import { PORTAL_CLIENT_ID, storeProvisioningService } from "./storeProvisioningService";

/**
 * partnerSurveySetService.ts
 *
 * 会員ポータル（hibi-portal）からの「セット注文」のユースケース層。
 * セット = サイクル定義（cycle_groups）1件 ＝ A/B/C の3案件をひとまとまりにしたもの。
 *
 * 既存の partnerSurveyService（案件1件）との関係:
 *   あちらは店舗が設問を自分で作る単発アンケート。こちらは運営が用意した業種テンプレの
 *   原本から A/B/C を丸ごと複製して回すサイクル調査で、**店舗は設問を編集できない**
 *   （partner_readonly=true・migration 103）。パートナー設問の編集は4種への全置換なので、
 *   B のマトリクスや A-Q11 の分岐が壊れるため。
 *
 * 公開の入口を1つに絞る:
 *   生成は draft。published にできるのは publishSet（＝ポータルが QR 発行のチケットを
 *   消費した直後に呼ぶ）だけ。draft のままなら storeEntryService が回答を止めるので、
 *   チケットを払わずに調査が回ることはない。
 *
 * 所有者スコープ:
 *   cycle_groups.store_id → stores.partner_store_id が X-Partner-Store-Id と一致すること。
 *   不一致・不在はどちらも 404（他店のセットの存在を漏らさない）。
 */

// ------------------------------------------------------------------
// 出力型
// ------------------------------------------------------------------

/** セット内の1ステップ（A/B/C のどれか）。 */
export interface PartnerSetSurveyView {
  role: CycleStepRole;
  survey_id: string;
  title: string;
  status: Project["status"];
  entry_code: string | null;
  /** 回答URL。QR にするのは entry（A）だけ。B/C は LINE 配信で届く。 */
  answer_url: string | null;
  /** 完了セッション数。ポータルの回答状況表示に使う。 */
  completed_count: number;
}

export interface PartnerSurveySetView {
  set_id: string;
  title: string;
  store_id: string;
  store_name: string;
  package_id: string | null;
  /** すべてのステップが published かどうか（＝QR 発行済み）。 */
  published: boolean;
  /** entry（A）の回答URL。未公開なら null。 */
  answer_url: string | null;
  surveys: PartnerSetSurveyView[];
  created_at: string;
}

/** 業種テンプレ1件（ポータルのパッケージ編集で選ばせる）。 */
export interface IndustryTemplateView {
  industry_template_id: string;
  name: string;
  industry_code: string;
  description: string | null;
  /** 展示用に平坦化した設問（A→B→C の順）。**回答の保存には使わない**。 */
  questions: FlattenedTemplateQuestion[];
}

/**
 * 展示用に平坦化した設問1件。
 *
 * ⚠ これは hibi のパッケージ紹介ページに「どんなことを聞くか」を見せるためだけのもの。
 * 実際に回るのは ACI 側の原本そのもので、ここでの写像の粗さは回答画面に影響しない
 * （だからパートナー種別に落ちない設問も `note` を付けて残す。黙って消すと展示が
 * 実物より痩せる）。
 */
export interface FlattenedTemplateQuestion {
  role: CycleStepRole;
  question_text: string;
  /** パートナーが表現できる種別（`PARTNER_QUESTION_TYPES`）。 */
  question_type: PartnerQuestionType;
  /** 選択肢。マトリクス系ではここが「行」。 */
  answer_options: PartnerAnswerOption[] | null;
  /**
   * マトリクス系の「列」。それ以外の種別では null。
   *
   * これが無いと、受け取った側（hibi の紹介ページ）はマトリクスを表として
   * 描けず「実際には『マトリクスシングル』の形式でお聞きします」という
   * 注記付きの単一選択に落とすしかなかった。展示でも実物と同じ表を見せる。
   */
  matrix_cols: PartnerAnswerOption[] | null;
  sort_order: number;
  /** パートナー種別にそのまま落ちなかった設問への注記。落ちたものは null。 */
  note: string | null;
}

/** 割り当て候補のセット1件（運営画面用）。設問本文は含めない。 */
export interface AssignableSetSummary {
  set_id: string;
  title: string;
  store_id: string;
  store_name: string;
  /** ステップ数（通常3）。 */
  step_count: number;
  /** どれか1件でも回答があるか。割り当て後に他店の回答が見えるのを防ぐ判断材料。 */
  completed_count: number;
  created_at: string;
  assignable: boolean;
  blocked_reason: string | null;
}

// ------------------------------------------------------------------
// 純関数（テストから直接検証する）
// ------------------------------------------------------------------

/**
 * 原本の設問をパートナー種別へ「展示用に」落とす。
 *
 * `toPartnerQuestionType()` が null を返す設問（`ranking_top_n` 等、まだパートナーに
 * 出していない種別）は捨てずに `single_choice` 相当の見出しとして残し、選択肢は
 * 省いて note を付ける。展示なので、実物より設問数が少なく見えるほうが害が大きい。
 *
 * マトリクス系は**行（answer_options）と列（matrix_cols）の両方**を返す。
 * 列を返さないと受け取った側が表を描けず、注記付きの単一選択に落とすしかない。
 */
export function flattenTemplateQuestion(
  question: Question,
  role: CycleStepRole
): FlattenedTemplateQuestion {
  const mapped = toPartnerQuestionType(question);
  // ⚠ マトリクスの行は `matrix_rows` に入っていることも `options` に入っていることもある。
  //   回答UI（survey.ejs:1476）が `matrix_rows || options` の順で読むので、ここも同じ順で読む。
  //   `options` だけを見ていたため、行が `matrix_rows` の設問は行が null で返っていた
  //   （＝受け取った側が表を描けなかった）。
  const options =
    question.question_config?.matrix_rows ?? question.question_config?.options ?? null;

  if (mapped) {
    return {
      role,
      question_text: question.question_text,
      question_type: mapped,
      answer_options: partnerTypeRequiresOptions(mapped) ? toPartnerOptions(options) : null,
      // 列はマトリクス系だけ。ほかの種別に付けると
      // 「マトリクスでないのに列がある」形になり、受け取った側が誤解する。
      // ⚠ sd は行×列ではないのでここには入らない（`isPartnerMatrixType` が false）。
      matrix_cols: isPartnerMatrixType(mapped)
        ? toPartnerOptions(question.question_config?.matrix_cols ?? null)
        : null,
      sort_order: question.sort_order,
      note: null,
    };
  }

  return {
    role,
    question_text: question.question_text,
    question_type: "single_choice",
    answer_options: null,
    matrix_cols: null,
    sort_order: question.sort_order,
    note: `この設問は実際には「${question.question_type}」形式で出題されます（展示用の簡略表示）`,
  };
}

/** 展示に出す設問だけを残す（システム設問・非表示・性年代の固定2問は除く）。 */
export function selectShowcaseQuestions(questions: Question[]): Question[] {
  return questions.filter(
    (question) => !question.is_system && !question.is_hidden && !isDemographicQuestion(question)
  );
}

/**
 * セットを会員店舗へ割り当てられるかを判定する。妥当なら null、駄目ならその理由。
 * 一覧（表示）と割り当て（実行）で同じ判定を使い、画面と挙動をずらさない。
 */
export function setAssignmentBlockedReason(store: Store, completedCount: number): string | null {
  if (store.partner_store_id) {
    return "already linked to a portal store";
  }
  if (completedCount > 0) {
    // 既に回答が入っているセットを店舗に渡すと、その店舗の画面に
    // 他所で集めた回答者データが見えてしまう。
    return `set already has ${completedCount} completed session(s)`;
  }
  return null;
}

/** 店舗コード slug を hibi の会員番号（無ければ店舗ID）から作る。 */
export function buildPortalStoreSlug(input: {
  memberNo?: string | null;
  partnerStoreId: string;
}): string {
  const memberNo = (input.memberNo ?? "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  if (memberNo) return `m${memberNo}`;
  // 会員番号が無いときは店舗IDの先頭8桁。UUID なので英数字だけになる。
  const fallback = input.partnerStoreId.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 8);
  return `m${fallback || "store"}`;
}

// ------------------------------------------------------------------
// 内部ヘルパー
// ------------------------------------------------------------------

/** 役割順（A→B→C）。表示順を1か所に固定する。 */
const ROLE_ORDER: CycleStepRole[] = ["entry", "followup", "verify"];

function sortByRole<T extends { role: CycleStepRole }>(items: T[]): T[] {
  return [...items].sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
}

/** objective に埋めたパッケージ参照を読み戻す（partnerSurveyService と同じ表現）。 */
function parsePackageId(project: Project | undefined): string | null {
  const objective = project?.objective ?? "";
  return objective.startsWith("package:") ? objective.slice("package:".length) || null : null;
}

/**
 * セット（cycle_group）を所有者スコープ付きで引く。
 * 存在しない・他店舗のものはどちらも 404（存在を漏らさない）。
 */
async function loadOwnedSet(
  setId: string,
  partnerStoreId: string
): Promise<{ group: CycleGroup; store: Store }> {
  const group = await cycleGroupRepository.getById(setId);
  if (!group?.store_id) {
    throw new HttpError(404, "survey set not found");
  }
  const store = await storeRepository.getById(group.store_id);
  if (!store || store.partner_store_id !== partnerStoreId) {
    throw new HttpError(404, "survey set not found");
  }
  return { group, store };
}

/** セットのステップを案件ごと読み、表示用に組み立てる。 */
async function buildSetView(
  group: CycleGroup,
  store: Store,
  options: { includeCounts?: boolean } = {}
): Promise<PartnerSurveySetView> {
  const steps = await cycleGroupRepository.listSteps(group.id);

  const surveys: PartnerSetSurveyView[] = [];
  for (const step of steps) {
    const project = await projectRepository.getById(step.project_id).catch(() => null);
    if (!project) continue;

    let completedCount = 0;
    if (options.includeCounts) {
      const sessions = await sessionRepository.listByProject(project.id);
      completedCount = sessions.filter((session) => session.status === "completed").length;
    }

    surveys.push({
      role: step.step_role,
      survey_id: project.id,
      title: project.user_display_title || project.name,
      status: project.status,
      entry_code: project.entry_code,
      // QR にするのは A だけ。B/C はサイクルの LINE 配信で届くので URL は返さない。
      answer_url:
        step.step_role === "entry" && project.status === "published" && project.entry_code
          ? buildStoreEntryLiffUrl(project.entry_code)
          : null,
      completed_count: completedCount,
    });
  }

  const ordered = sortByRole(surveys);
  const entry = ordered.find((survey) => survey.role === "entry");
  const entryProject = entry ? await projectRepository.getById(entry.survey_id).catch(() => null) : null;

  return {
    set_id: group.id,
    title: group.name,
    store_id: store.partner_store_id ?? "",
    store_name: store.name,
    package_id: parsePackageId(entryProject ?? undefined),
    // 「公開済み」は全ステップが published のときだけ。1本でも draft が残っていたら
    // B/C が届かないまま A だけ回るので、ポータルには未完了として見せる。
    published: ordered.length > 0 && ordered.every((survey) => survey.status === "published"),
    answer_url: entry?.answer_url ?? null,
    surveys: ordered,
    created_at: group.created_at,
  };
}

// ------------------------------------------------------------------
// ユースケース
// ------------------------------------------------------------------

export const partnerSurveySetService = {
  /**
   * 業種テンプレから A/B/C のセットを draft で作る。
   *
   * 同じ会員店舗からの再注文は**新しいセットを作らず既存セットを返す**
   * （storeProvisioningService が partner_store_id で冪等に収束する）。
   * ポータル側は作成失敗時にそのまま再試行してよい。
   */
  async createSet(input: {
    partnerStoreId: string;
    industryTemplateId: string;
    storeName: string;
    memberNo?: string | null;
    packageId?: string | null;
  }): Promise<PartnerSurveySetView> {
    const template = await industryTemplateRepository.getById(input.industryTemplateId);
    if (!template) {
      throw new HttpError(404, "industry template not found");
    }
    if (!template.is_enabled) {
      throw new HttpError(409, "industry template is disabled");
    }

    const slug = buildPortalStoreSlug({
      memberNo: input.memberNo,
      partnerStoreId: input.partnerStoreId,
    });

    let result: Awaited<ReturnType<typeof storeProvisioningService.provisionStore>>;
    try {
      result = await storeProvisioningService.provisionStore(
        {
          clientId: PORTAL_CLIENT_ID,
          industryTemplateId: template.id,
          name: input.storeName,
          codeSlug: slug,
        },
        {
          // 公開はチケットを消費する publishSet からだけ。ここでは絶対に published にしない。
          initialStatus: "draft",
          partnerStoreId: input.partnerStoreId,
          packageId: input.packageId ?? null,
        }
      );
    } catch (error) {
      // 店舗コードの衝突（別会員が同じ slug を使っている）は 409 で返す。
      // それ以外は想定外なのでそのまま投げて 500 にする。
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("別の会員店舗")) {
        throw new HttpError(409, "store code already used by another portal store");
      }
      throw error;
    }

    if (!result.cycleGroupId) {
      throw new HttpError(500, "failed to create survey set");
    }

    logger.info("partnerSurveySet.created", {
      setId: result.cycleGroupId,
      partnerStoreId: input.partnerStoreId,
      storeId: result.store.id,
      created: result.created,
    });

    const group = await cycleGroupRepository.getById(result.cycleGroupId);
    if (!group) {
      throw new HttpError(500, "failed to create survey set");
    }
    return buildSetView(group, result.store);
  },

  /** 所有者スコープ付きで1件取得する。 */
  async getSet(partnerStoreId: string, setId: string): Promise<PartnerSurveySetView> {
    const { group, store } = await loadOwnedSet(setId, partnerStoreId);
    return buildSetView(group, store, { includeCounts: true });
  },

  /**
   * セット全体を公開する。**冪等**（既に公開済みなら同じ結果を返す）。
   *
   * ポータルは QR 発行でチケットを消費した直後にこれを呼ぶ。
   * `partner_readonly` でも通す（単発 publish が readonly を 409 にするのとは逆）:
   * セットは店舗が設問を編集できない代わりに、公開だけはできないと QR が出せない。
   */
  async publishSet(partnerStoreId: string, setId: string): Promise<PartnerSurveySetView> {
    const { group, store } = await loadOwnedSet(setId, partnerStoreId);
    const steps = await cycleGroupRepository.listSteps(group.id);
    if (steps.length === 0) {
      throw new HttpError(409, "survey set has no steps");
    }

    for (const step of steps) {
      const project = await projectRepository.getById(step.project_id).catch(() => null);
      if (!project) continue;
      // 締切・アーカイブ済みを published へ戻さない（終わった調査を勝手に再開しない）。
      if (project.status === "closed" || project.status === "archived") {
        throw new HttpError(409, "closed survey set cannot be published");
      }
      if (project.status === "published") continue;
      await projectRepository.updateStatus(project.id, "published");
    }

    logger.info("partnerSurveySet.published", {
      setId: group.id,
      partnerStoreId,
      stepCount: steps.length,
    });

    return buildSetView(group, store);
  },

  // ----------------------------------------------------------------
  // 運営専用（/api/partner-admin/*）
  // ----------------------------------------------------------------

  /**
   * 業種テンプレの一覧＋展示用の平坦化設問。
   * hibi のパッケージ編集で「どのテンプレから作るか」を選び、
   * 紹介ページの設問例を原本から取り込むために使う。
   */
  async listIndustryTemplates(): Promise<{ templates: IndustryTemplateView[] }> {
    const templates = await industryTemplateRepository.list();
    const views: IndustryTemplateView[] = [];

    for (const template of templates) {
      if (!template.is_enabled) continue;

      const steps: { role: CycleStepRole; projectId: string | null }[] = [
        { role: "entry", projectId: template.entry_template_project_id },
        { role: "followup", projectId: template.followup_template_project_id },
        { role: "verify", projectId: template.verify_template_project_id },
      ];

      const questions: FlattenedTemplateQuestion[] = [];
      for (const step of steps) {
        if (!step.projectId) continue;
        const list = await questionRepository.listByProject(step.projectId, {
          includeHidden: false,
        });
        for (const question of selectShowcaseQuestions(list)) {
          questions.push(flattenTemplateQuestion(question, step.role));
        }
      }

      views.push({
        industry_template_id: template.id,
        name: template.name,
        industry_code: template.industry_code,
        description: template.description,
        questions,
      });
    }

    return { templates: views };
  },

  /**
   * 会員店舗へ割り当てられるセットの候補（運営が ACI 店舗マスタで先に作ったもの）。
   * **設問本文は含めない**（一覧は「どのセットか」を選ぶためだけのもの）。
   */
  async listAssignableSets(): Promise<{ sets: AssignableSetSummary[] }> {
    const stores = await storeRepository.listUnlinkedToPartner();
    const groups = await cycleGroupRepository.listByStores(stores.map((store) => store.id));
    const storeById = new Map(stores.map((store) => [store.id, store]));

    const sets: AssignableSetSummary[] = [];
    for (const group of groups) {
      const store = group.store_id ? storeById.get(group.store_id) : undefined;
      if (!store) continue;

      const steps = await cycleGroupRepository.listSteps(group.id);
      let completedCount = 0;
      for (const step of steps) {
        const sessions = await sessionRepository.listByProject(step.project_id);
        completedCount += sessions.filter((session) => session.status === "completed").length;
      }

      const reason = setAssignmentBlockedReason(store, completedCount);
      sets.push({
        set_id: group.id,
        title: group.name,
        store_id: store.id,
        store_name: store.name,
        step_count: steps.length,
        completed_count: completedCount,
        created_at: group.created_at,
        assignable: reason === null,
        blocked_reason: reason,
      });
    }
    return { sets };
  },

  /**
   * セットを会員店舗へ割り当てる（相談経路の合流点）。
   *
   * 店舗マスタ行と A/B/C の3案件に同じ hibi 店舗IDを書き、案件は閲覧専用にする。
   * ここでも **published にはしない**。公開は店舗の QR 発行（publishSet）だけ。
   */
  async assignSetToStore(setId: string, partnerStoreId: string): Promise<PartnerSurveySetView> {
    const group = await cycleGroupRepository.getById(setId);
    if (!group?.store_id) {
      throw new HttpError(404, "survey set not found");
    }
    const store = await storeRepository.getById(group.store_id);
    if (!store) {
      throw new HttpError(404, "survey set not found");
    }

    const steps = await cycleGroupRepository.listSteps(group.id);
    if (steps.length === 0) {
      throw new HttpError(409, "survey set has no steps");
    }

    let completedCount = 0;
    for (const step of steps) {
      const sessions = await sessionRepository.listByProject(step.project_id);
      completedCount += sessions.filter((session) => session.status === "completed").length;
    }
    const reason = setAssignmentBlockedReason(store, completedCount);
    if (reason) {
      throw new HttpError(409, reason);
    }

    // 同じ会員店舗が既に別のセットを持っていたら止める（1店舗1セット）。
    const alreadyLinked = await storeRepository.getByPartnerStoreId(partnerStoreId);
    if (alreadyLinked && alreadyLinked.id !== store.id) {
      throw new HttpError(409, "portal store already has a survey set");
    }

    // 条件付きUPDATE（where partner_store_id is null）。同時実行の後勝ちを DB で防ぐ。
    const linkedStore = await storeRepository.linkPartnerStore(store.id, partnerStoreId);
    if (!linkedStore) {
      throw new HttpError(409, "already linked to a portal store");
    }

    const projectIds = steps.map((step) => step.project_id);
    const linkedProjects = await projectRepository.linkPartnerStoreForProjects(
      projectIds,
      partnerStoreId
    );
    if (linkedProjects.length !== projectIds.length) {
      // 片側だけ書けた状態で放置すると、店舗から一部の案件しか見えない。
      // 店舗行の紐づけごと巻き戻して「割り当てられていない」状態に戻す。
      //
      // ⚠ 巻き戻すのは **今まさに自分が書けた案件だけ**（projectIds 全部ではない）。
      // link が落ちた案件は「既に別の店舗に紐づいている」もので、その紐づけが
      // watch（partner_readonly=true・migration 103）だと、全件 unlink が
      // 無関係な店舗の閲覧専用紐づけまで剥がしてしまう。
      await projectRepository.unlinkPartnerStoreForProjects(
        linkedProjects.map((project) => project.id)
      );
      await storeRepository.unlinkPartnerStore(store.id);
      throw new HttpError(409, "some surveys in the set are already assigned to a store");
    }

    logger.info("partnerSurveySet.assigned", {
      setId: group.id,
      storeId: store.id,
      partnerStoreId,
    });

    return buildSetView(group, linkedStore);
  },

  /**
   * 割り当てを取り消す（ポータル側の書き込み失敗時の巻き戻しにも使う）。
   * **冪等**: 既に外れていれば何もせず 200。
   * 回答が1件でもあれば 409（回答を集め始めたセットは外させない）。
   */
  async unassignSet(setId: string): Promise<PartnerSurveySetView> {
    const group = await cycleGroupRepository.getById(setId);
    if (!group?.store_id) {
      throw new HttpError(404, "survey set not found");
    }
    const store = await storeRepository.getById(group.store_id);
    if (!store) {
      throw new HttpError(404, "survey set not found");
    }
    if (!store.partner_store_id) {
      return buildSetView(group, store);
    }

    const steps = await cycleGroupRepository.listSteps(group.id);
    let completedCount = 0;
    for (const step of steps) {
      const sessions = await sessionRepository.listByProject(step.project_id);
      completedCount += sessions.filter((session) => session.status === "completed").length;
    }
    if (completedCount > 0) {
      throw new HttpError(409, `set already has ${completedCount} completed session(s)`);
    }

    await projectRepository.unlinkPartnerStoreForProjects(steps.map((step) => step.project_id));
    const unlinked = await storeRepository.unlinkPartnerStore(store.id);

    logger.info("partnerSurveySet.unassigned", {
      setId: group.id,
      storeId: store.id,
      partnerStoreId: store.partner_store_id,
    });

    return buildSetView(group, unlinked ?? store);
  },
};
