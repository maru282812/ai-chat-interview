import { supabase } from "../config/supabase";
import type {
  AIPromptOverrides,
  AIPromptPolicy,
  AIPromptTemplateMap,
  DeliveryType,
  Project,
  ProjectAIState,
  ProjectProbePolicy,
  ProjectResponseStyle,
  ProjectStatus,
  ResearchMode,
  ScreeningConfig
} from "../types/domain";
import { requireData, throwIfError } from "./baseRepository";
import { projectAssignmentRepository } from "./projectAssignmentRepository";
import { FREE_COMMENT_QUESTION_CODE, questionRepository } from "./questionRepository";
import { respondentRepository } from "./respondentRepository";
import { sessionRepository } from "./sessionRepository";

interface ProjectMutationInput {
  name: string;
  user_display_title?: string | null;
  client_name?: string | null;
  objective?: string | null;
  status: ProjectStatus;
  reward_points: number;
  research_mode?: ResearchMode;
  primary_objectives?: string[];
  secondary_objectives?: string[];
  comparison_constraints?: string[];
  prompt_rules?: string[];
  probe_policy?: ProjectProbePolicy | null;
  response_style?: ProjectResponseStyle | null;
  ai_state_json?: ProjectAIState | null;
  ai_state_template_key?: string | null;
  ai_state_generated_at?: string | null;
  screening_config?: ScreeningConfig | null;
  screening_last_question_order?: number | null;
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
        question_config: question.question_config,
        ai_probe_enabled: question.ai_probe_enabled,
        is_system: question.is_system,
        is_hidden: question.is_hidden
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
        question_config: sourceSystemQuestion.question_config,
        ai_probe_enabled: sourceSystemQuestion.ai_probe_enabled,
        is_system: sourceSystemQuestion.is_system,
        is_hidden: sourceSystemQuestion.is_hidden
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
  }
};
