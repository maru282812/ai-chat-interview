import { supabase } from "../config/supabase";
import type {
  AIPromptOverrides,
  AIPromptPolicy,
  AIPromptTemplateMap,
  DeliveryType,
  DisplayMode,
  Project,
  ProjectAIState,
  ProjectProbePolicy,
  ProjectResponseStyle,
  ProjectStatus,
  Question,
  ResearchHypothesis,
  ResearchMode,
  ScreeningConfig
} from "../types/domain";
import { requireData, throwIfError } from "./baseRepository";
import { projectAssignmentRepository } from "./projectAssignmentRepository";
import { FREE_COMMENT_QUESTION_CODE, questionRepository } from "./questionRepository";
import { respondentRepository } from "./respondentRepository";
import { sessionRepository } from "./sessionRepository";

/**
 * 複製時に必ず引き継ぐ「表示制御」項目。
 *
 * copyProject はもともと question_config と branch_rule しか写しておらず、
 * display_tags_parsed / visibility_conditions / comment_top / comment_bottom が
 * 落ちていた。この4つが落ちると、複製先の設問は「選択肢は全部あるのに
 * 前問の回答で絞られない」状態になる（carry-forward = display_tags_parsed.optionSource、
 * <disable> = display_tags_parsed.disableRules、表示条件 = visibility_conditions）。
 *
 * 店舗展開（storeProvisioningService）はこの copyProject を通るため、
 * 落ちたまま本番の店舗アンケートが作られていた。
 *
 * page_group_id は意図的に写さない。複製元の page_groups の行を指しており、
 * そのまま持ち越すと別案件のブロックを参照する不整合になるため。
 */
function copiedDisplayControlFields(question: Question) {
  return {
    comment_top: question.comment_top ?? null,
    comment_bottom: question.comment_bottom ?? null,
    display_tags_raw: question.display_tags_raw ?? null,
    display_tags_parsed: question.display_tags_parsed ?? null,
    visibility_conditions: question.visibility_conditions ?? null
  };
}

/**
 * 複製時に「店舗への開示設定」を必ず落とす。
 *
 * copyProject は question_config をまるごと写すため、そのままだと複製元の
 * share_with_store（利用規約 第9条3項の開示フラグ）が引き継がれる。
 * 案件複製は店舗展開の主要経路（storeProvisioningService）なので、
 * 引き継ぐと「新しく作った店舗の設問が、誰も設定していないのに開示される」事故になる。
 * 開示は店舗ごとに管理画面で明示的に有効化させる（安全側に倒す）。
 */
export function stripStoreDisclosureOnCopy(
  config: Question["question_config"]
): Question["question_config"] {
  if (!config) {
    return config;
  }
  const next = { ...config };
  if (next.meta && typeof next.meta === "object" && !Array.isArray(next.meta)) {
    const nextMeta = { ...next.meta };
    delete nextMeta.share_with_store;
    next.meta = nextMeta;
  }
  return next;
}


interface ProjectMutationInput {
  name: string;
  user_display_title?: string | null;
  client_name?: string | null;
  objective?: string | null;
  status: ProjectStatus;
  reward_points: number;
  research_mode?: ResearchMode;
  display_mode?: DisplayMode;
  primary_objectives?: string[];
  secondary_objectives?: string[];
  comparison_constraints?: string[];
  prompt_rules?: string[];
  probe_policy?: ProjectProbePolicy | null;
  response_style?: ProjectResponseStyle | null;
  ai_state_json?: ProjectAIState | null;
  ai_state_template_key?: string | null;
  ai_state_generated_at?: string | null;
  /** 調査仮説シート（P13・Migration 088） */
  research_hypothesis_json?: ResearchHypothesis | null;
  screening_config?: ScreeningConfig | null;
  screening_last_question_order?: number | null;
  /** 送信完了画面のお礼文 (Migration 108)。 */
  completion_message?: string | null;
  is_discoverable?: boolean;
  category?: string | null;
  display_thumbnail_url?: string | null;
  estimated_minutes?: number | null;
  max_respondents?: number | null;
  tags?: string[];
  ng_conditions?: string | null;
  recruit_deadline?: string | null;
  apply_mode?: import("../types/domain").ProjectApplyMode;
  interview_format?: string | null;
  delivery_enabled?: boolean;
  delivery_type?: DeliveryType | null;
  delivered_at?: string | null;
  ai_prompt_policy_json?: AIPromptPolicy | null;
  ai_prompt_templates_json?: AIPromptTemplateMap | null;
  ai_prompt_mode?: 'custom' | 'package';
  ai_prompt_package_version_id?: string | null;
  ai_prompt_overrides_json?: AIPromptOverrides | null;
  visibility_type?: 'public' | 'private_store';
  entry_code?: string | null;
  client_id?: string | null;
  /** パートナーAPI経由案件の所有店舗ID（Migration 089）。 */
  partner_store_id?: string | null;
  concept_rotation_mode?: 'off' | 'latin' | 'full';
  randomize_question_order?: boolean;
  answer_ui_preset?: import("../types/domain").AnswerUiPreset;
  /** 若年層体験パックのプロジェクト上書き (Migration 083)。 */
  experience_config?: Record<string, unknown>;
}

type ProjectUpdateInput = Partial<ProjectMutationInput>;

function buildCopiedProjectName(name: string): string {
  return name.endsWith("のコピー") ? `${name} 2` : `${name}のコピー`;
}

export const projectRepository = {
  async list(): Promise<Project[]> {
    const { data, error } = await supabase.from("projects").select("*").order("created_at", {
      ascending: false
    });
    throwIfError(error);
    return (data ?? []) as Project[];
  },

  async listActive(): Promise<Project[]> {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("status", "published")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as Project[];
  },

  async getById(id: string): Promise<Project> {
    const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
    throwIfError(error);
    return requireData(data as Project | null, "Project not found");
  },

  async create(input: ProjectMutationInput): Promise<Project> {
    const { data, error } = await supabase.from("projects").insert(input).select("*").single();
    throwIfError(error);
    const project = data as Project;
    await questionRepository.ensureSystemFreeCommentQuestion(project.id);
    return project;
  },

  async update(id: string, input: ProjectUpdateInput): Promise<Project> {
    const { data, error } = await supabase
      .from("projects")
      .update(input)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as Project;
  },

  async copyProject(projectId: string): Promise<Project> {
    const source = await this.getById(projectId);
    const sourceQuestions = await questionRepository.listByProject(projectId, { includeHidden: true });
    const copiedProject = await this.create({
      name: `${source.name}_コピー`,
      client_name: source.client_name,
      objective: source.objective,
      status: "draft",
      reward_points: source.reward_points,
      // 送信完了画面のお礼文 (Migration 108)。copyProject は明示列挙なので、
      // ここに足さないとコピーした案件だけお礼が消える（share_with_store と違い、
      // これは開示フラグではなく文言なので引き継ぐのが正しい）。
      completion_message: source.completion_message ?? null,
      research_mode: source.research_mode,
      primary_objectives: source.primary_objectives,
      secondary_objectives: source.secondary_objectives,
      comparison_constraints: source.comparison_constraints,
      prompt_rules: source.prompt_rules,
      probe_policy: source.probe_policy,
      response_style: source.response_style,
      ai_state_json: source.ai_state_json,
      ai_state_template_key: source.ai_state_template_key,
      ai_state_generated_at: source.ai_state_generated_at,
      ai_prompt_policy_json: source.ai_prompt_policy_json ?? null,
      ai_prompt_templates_json: source.ai_prompt_templates_json ?? null,
      ai_prompt_mode: source.ai_prompt_mode ?? 'custom',
      ai_prompt_package_version_id: source.ai_prompt_package_version_id ?? null,
      ai_prompt_overrides_json: source.ai_prompt_overrides_json ?? null
    });
    const normalizedCopiedProject = await this.update(copiedProject.id, {
      name: source.name.endsWith(" (Copy)") ? `${source.name} 2` : `${source.name} (Copy)`,
      status: "draft"
    });

    const copiedSystemQuestion = await questionRepository.getSystemFreeCommentQuestion(normalizedCopiedProject.id);

    for (const question of sourceQuestions) {
      if (question.question_code === FREE_COMMENT_QUESTION_CODE) {
        continue;
      }

      await questionRepository.create({
        project_id: normalizedCopiedProject.id,
        question_code: question.question_code,
        question_text: question.question_text,
        question_role: question.question_role,
        question_type: question.question_type,
        is_required: question.is_required,
        sort_order: question.sort_order,
        branch_rule: question.branch_rule,
        question_config: stripStoreDisclosureOnCopy(question.question_config),
        ai_probe_enabled: question.ai_probe_enabled,
        is_system: question.is_system,
        is_hidden: question.is_hidden,
        ...copiedDisplayControlFields(question)
      });
    }

    const sourceSystemQuestion = sourceQuestions.find(
      (question) => question.question_code === FREE_COMMENT_QUESTION_CODE
    );
    if (sourceSystemQuestion && copiedSystemQuestion) {
      await questionRepository.update(copiedSystemQuestion.id, {
        question_text: sourceSystemQuestion.question_text,
        question_role: sourceSystemQuestion.question_role,
        question_type: sourceSystemQuestion.question_type,
        is_required: sourceSystemQuestion.is_required,
        sort_order: sourceSystemQuestion.sort_order,
        branch_rule: sourceSystemQuestion.branch_rule,
        question_config: stripStoreDisclosureOnCopy(sourceSystemQuestion.question_config),
        ai_probe_enabled: sourceSystemQuestion.ai_probe_enabled,
        is_system: sourceSystemQuestion.is_system,
        is_hidden: sourceSystemQuestion.is_hidden,
        ...copiedDisplayControlFields(sourceSystemQuestion)
      });
    }

    return normalizedCopiedProject;
  },

  async deleteById(id: string): Promise<{ mode: "deleted" | "archived"; project: Project }> {
    const project = await this.getById(id);
    const [respondentCount, sessionCount, assignmentCount] = await Promise.all([
      respondentRepository.countByProject(id),
      sessionRepository.countByProject(id),
      projectAssignmentRepository.countByProject(id)
    ]);

    const hasExecutionHistory =
      project.status === "published" || respondentCount > 0 || sessionCount > 0 || assignmentCount > 0;

    if (hasExecutionHistory) {
      const archivedProject = await this.update(id, { status: "archived" });
      return {
        mode: "archived",
        project: archivedProject
      };
    }

    const { error } = await supabase.from("projects").delete().eq("id", id);
    throwIfError(error);
    return {
      mode: "deleted",
      project
    };
  },

  async countByStatus(status: ProjectStatus): Promise<number> {
    const { count, error } = await supabase
      .from("projects")
      .select("*", { count: "exact", head: true })
      .eq("status", status);
    throwIfError(error);
    return count ?? 0;
  },

  async listDiscoverable(): Promise<Project[]> {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, user_display_title, category, delivery_type, display_thumbnail_url, estimated_minutes, max_respondents, reward_points, status, created_at, tags, ng_conditions, recruit_deadline, apply_mode, interview_format")
      .eq("status", "published")
      .eq("visibility_type", "public")
      // 管理画面の「一覧に出す」チェック（is_discoverable）を尊重する。
      // これが無いと published × public というだけでテスト・デモ案件まで露出する。
      .eq("is_discoverable", true)
      // 募集期限切れは一覧に出さない（recruit_deadline 未設定は常に表示）
      .or(`recruit_deadline.is.null,recruit_deadline.gte.${new Date().toISOString()}`)
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as unknown as Project[];
  },

  async getDiscoverableById(id: string): Promise<Project | null> {
    const { data, error } = await supabase
      .from("projects")
      .select("id, name, user_display_title, category, delivery_type, display_thumbnail_url, estimated_minutes, max_respondents, reward_points, status, created_at, objective, screening_config, tags, ng_conditions, recruit_deadline, apply_mode, interview_format")
      .eq("id", id)
      .eq("status", "published")
      .eq("visibility_type", "public")
      // 一覧と同条件。一覧に出していない案件へ直リンク／応募で入れる穴を塞ぐ
      // （応募検証 applicationService もこの関数を通る）。
      .eq("is_discoverable", true)
      .maybeSingle();
    throwIfError(error);
    return data as Project | null;
  },

  /**
   * 企業（client_id）配下の案件を全ステータスで一覧。企業まとめ画面用。
   * 並び順は created_at 昇順（将来の wave/シリーズ列を差し込める自然順・★予約③）。
   */
  /** 店舗に属する案件（Migration 096）。役割順ではなく作成順。 */
  async listByStore(storeId: string): Promise<Project[]> {
    const id = storeId.trim();
    if (!id) return [];
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("store_id", id)
      .order("created_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as Project[];
  },

  /** 業種テンプレの原本案件（template_step_role='template'）。 */
  async listTemplateProjects(): Promise<Project[]> {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("template_step_role", "template")
      .order("created_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as Project[];
  },

  async listByClient(clientId: string): Promise<Project[]> {
    const id = clientId.trim();
    if (!id) return [];
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("client_id", id)
      .order("created_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as Project[];
  },

  /** 店舗専用アンケート（visibility_type='private_store'）を全ステータスで一覧。管理画面用。 */
  async listStoreProjects(): Promise<Project[]> {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("visibility_type", "private_store")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as Project[];
  },

  /**
   * entry_code の重複チェック用。ステータス/公開区分を問わず entry_code 一致案件を1件返す。
   * （getStoreProjectByEntryCode は published×private_store に限定するため、入力検証には使えない）
   */
  async findAnyByEntryCode(entryCode: string): Promise<Project | null> {
    const code = entryCode.trim();
    if (!code) return null;
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("entry_code", code)
      .maybeSingle();
    throwIfError(error);
    return (data as Project | null) ?? null;
  },

  async getStoreProjectByEntryCode(entryCode: string): Promise<Project | null> {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("entry_code", entryCode)
      .eq("visibility_type", "private_store")
      .eq("status", "published")
      .maybeSingle();
    throwIfError(error);
    return (data as Project | null) ?? null;
  },

  /**
   * パートナーAPI（Migration 089）の所有チェック付き取得。
   * partner_store_id が一致する案件のみ返す。存在しない・他店舗のものはどちらも null
   * （呼び出し側で 404 に丸め、他店舗案件の存在を漏らさない）。
   */
  async getPartnerProject(id: string, partnerStoreId: string): Promise<Project | null> {
    const projectId = id.trim();
    const storeId = partnerStoreId.trim();
    if (!projectId || !storeId) return null;
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .eq("id", projectId)
      .eq("partner_store_id", storeId)
      .maybeSingle();
    throwIfError(error);
    return (data as Project | null) ?? null;
  },

  async listReadyForDelivery(targetTypes: string[], createdWithinHours?: number | null): Promise<Project[]> {
    let query = supabase
      .from("projects")
      .select("*")
      .eq("status", "ready")
      .eq("delivery_enabled", true);

    if (targetTypes.length > 0) {
      query = query.in("delivery_type", targetTypes);
    }
    if (createdWithinHours != null) {
      const cutoff = new Date(Date.now() - createdWithinHours * 60 * 60 * 1000).toISOString();
      query = query.gte("created_at", cutoff);
    }

    query = query.order("created_at", { ascending: true });
    const { data, error } = await query;
    throwIfError(error);
    return (data ?? []) as Project[];
  },

  async markAsDelivered(id: string): Promise<Project> {
    const { data, error } = await supabase
      .from("projects")
      .update({
        status: "published",
        delivery_enabled: false,
        delivered_at: new Date().toISOString()
      })
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as Project;
  },

  /**
   * 運営専用API（/api/partner-admin/*）の「店舗へ割り当てられる候補」一覧。
   *
   * listStoreProjects() とは別関数にする。あちらは管理画面 /admin/store-surveys の
   * 表示条件（visibility_type='private_store'）で、こちらは「まだどこにも属していない
   * 案件」を探すため条件がまったく違う。
   *
   * 抽出条件:
   * - partner_store_id is null … まだ店舗に割り当てられていない
   * - client_id is null … 他社クライアントの案件を候補に出さない
   * - status in ('draft','ready') … 公開済み/締切済みは割り当てさせない
   * - is_discoverable = false … 一般の「探す」一覧に出している案件は店舗専用に転用しない
   */
  async listAssignableForPartner(): Promise<Project[]> {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .is("partner_store_id", null)
      .is("client_id", null)
      .in("status", ["draft", "ready"])
      .eq("is_discoverable", false)
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as Project[];
  },

  /**
   * 既に店舗へ割り当て済みの案件一覧（運営の整合性チェック用）。
   * ポータル側に対応行が無い＝片側だけ書けた状態を /ops から検出できるようにする。
   */
  async listAssignedToPartner(): Promise<Project[]> {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .not("partner_store_id", "is", null)
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as Project[];
  },

  /**
   * 未割り当ての案件だけを店舗に割り当てる**条件付きUPDATE**。
   *
   * `where id = ? and partner_store_id is null` を DB に評価させることで、
   * 同時に2つの運営操作が走っても後勝ちで上書きされない（二重割り当てを DB で防ぐ）。
   * migration を増やさずに済ませるための作法。
   *
   * 更新行が0件のとき null を返す。呼び出し側は「既に割り当て済み」として 409 にする
   * （例外にしないのは、正常な競合と DB エラーを区別したいため）。
   */
  async assignPartnerStore(
    projectId: string,
    storeId: string,
    patch: {
      visibility_type: 'public' | 'private_store';
      is_discoverable: boolean;
      entry_code: string;
    }
  ): Promise<Project | null> {
    const id = projectId.trim();
    const store = storeId.trim();
    if (!id || !store) return null;
    const { data, error } = await supabase
      .from("projects")
      .update({ partner_store_id: store, ...patch })
      .eq("id", id)
      .is("partner_store_id", null)
      .select("*");
    throwIfError(error);
    const rows = (data ?? []) as Project[];
    return rows[0] ?? null;
  },

  /**
   * 割り当てを取り消して未割り当てへ戻す。
   * ポータル側の INSERT が失敗したときの巻き戻し（補償トランザクション）にも使う。
   * 安全側に倒すため entry_code も落とす（古いQRで回答が入り続けるのを防ぐ）。
   */
  async unassignPartnerStore(projectId: string): Promise<Project | null> {
    const id = projectId.trim();
    if (!id) return null;
    const { data, error } = await supabase
      .from("projects")
      .update({
        partner_store_id: null,
        visibility_type: "public",
        entry_code: null,
        is_discoverable: false
      })
      .eq("id", id)
      .select("*");
    throwIfError(error);
    const rows = (data ?? []) as Project[];
    return rows[0] ?? null;
  },

  /**
   * 「閲覧専用」で紐づけられる候補（migration 103・docs/partner-api.md §8.8）。
   *
   * assign と違い、稼働中（published / paused）や締切済み（closed）でもよい。
   * 「まだ誰のものでもない」「他社クライアントの案件でない」「archived でない」だけを条件にする。
   */
  async listWatchableForPartner(): Promise<Project[]> {
    const { data, error } = await supabase
      .from("projects")
      .select("*")
      .is("partner_store_id", null)
      .is("client_id", null)
      .neq("status", "archived")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as Project[];
  },

  /**
   * 閲覧専用で店舗に紐づける**条件付きUPDATE**（`where partner_store_id is null`）。
   *
   * assignPartnerStore と違い、**partner_store_id と partner_readonly しか触らない**。
   * visibility_type / entry_code / is_discoverable は稼働中の案件の生命線なので変えない。
   * 更新行が0件なら null（呼び出し側は「既に紐づけ済み」として 409 にする）。
   */
  async watchPartnerStore(projectId: string, storeId: string): Promise<Project | null> {
    const id = projectId.trim();
    const store = storeId.trim();
    if (!id || !store) return null;
    const { data, error } = await supabase
      .from("projects")
      .update({ partner_store_id: store, partner_readonly: true })
      .eq("id", id)
      .is("partner_store_id", null)
      .select("*");
    throwIfError(error);
    const rows = (data ?? []) as Project[];
    return rows[0] ?? null;
  },

  /**
   * セット（A/B/C）を会員店舗へ閲覧専用で一括紐づけする (Migration 104)。
   *
   * watchPartnerStore と同じく **partner_store_id と partner_readonly しか触らない**
   * （entry_code / visibility_type は稼働中の QR の生命線なので変えない）。
   * 未紐づけの案件だけを対象にする条件付きUPDATE で、既に別店舗のものは黙って対象外になる。
   * 返り値は実際に更新できた案件。呼び出し側が「3件そろったか」を判定する。
   */
  async linkPartnerStoreForProjects(
    projectIds: string[],
    storeId: string
  ): Promise<Project[]> {
    const ids = projectIds.map((id) => id.trim()).filter((id) => id.length > 0);
    const store = storeId.trim();
    if (ids.length === 0 || !store) return [];
    const { data, error } = await supabase
      .from("projects")
      .update({ partner_store_id: store, partner_readonly: true })
      .in("id", ids)
      .is("partner_store_id", null)
      .select("*");
    throwIfError(error);
    return (data ?? []) as Project[];
  },

  /**
   * セットの紐づけを一括で外す (Migration 104)。
   * 巻き戻しにも使うので、閲覧専用（partner_readonly=true）の行だけを対象にする
   * ＝通常の割り当て案件を巻き添えで外さない。
   */
  async unlinkPartnerStoreForProjects(projectIds: string[]): Promise<Project[]> {
    const ids = projectIds.map((id) => id.trim()).filter((id) => id.length > 0);
    if (ids.length === 0) return [];
    const { data, error } = await supabase
      .from("projects")
      .update({ partner_store_id: null, partner_readonly: false })
      .in("id", ids)
      .eq("partner_readonly", true)
      .select("*");
    throwIfError(error);
    return (data ?? []) as Project[];
  },

  /**
   * 案件のステータスだけを更新する（セットの一括公開に使う）。
   * update() は巨大な部分更新で使い回しにくいので、公開経路を1本に絞るための薄い口。
   */
  async updateStatus(projectId: string, status: Project["status"]): Promise<Project | null> {
    const id = projectId.trim();
    if (!id) return null;
    const { data, error } = await supabase
      .from("projects")
      .update({ status })
      .eq("id", id)
      .select("*");
    throwIfError(error);
    return ((data ?? []) as Project[])[0] ?? null;
  },

  /**
   * 閲覧専用の紐づけを外す。**partner_store_id と partner_readonly を戻すだけ**。
   * entry_code / visibility_type には触らない（unassign と決定的に違う点。QR を殺さない）。
   * `partner_readonly = true` の行にしか当たらないので、通常の割り当て案件を誤って外せない。
   */
  async unwatchPartnerStore(projectId: string): Promise<Project | null> {
    const id = projectId.trim();
    if (!id) return null;
    const { data, error } = await supabase
      .from("projects")
      .update({ partner_store_id: null, partner_readonly: false })
      .eq("id", id)
      .eq("partner_readonly", true)
      .select("*");
    throwIfError(error);
    const rows = (data ?? []) as Project[];
    return rows[0] ?? null;
  }
};
