import { supabase } from "../config/supabase";
import type {
  Project,
  ProjectAIState,
  ProjectProbePolicy,
  ProjectResponseStyle,
  ProjectStatus,
  ResearchMode
} from "../types/domain";
import { requireData, throwIfError } from "./baseRepository";
import { projectAssignmentRepository } from "./projectAssignmentRepository";
import { FREE_COMMENT_QUESTION_CODE, questionRepository } from "./questionRepository";
import { respondentRepository } from "./respondentRepository";
import { sessionRepository } from "./sessionRepository";

interface ProjectMutationInput {
  name: string;
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
      .eq("status", "active")
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
      ai_state_generated_at: source.ai_state_generated_at
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
      project.status === "active" || respondentCount > 0 || sessionCount > 0 || assignmentCount > 0;

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
  }
};
