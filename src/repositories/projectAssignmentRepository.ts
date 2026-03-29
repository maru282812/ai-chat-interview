import { supabase } from "../config/supabase";
import type {
  ProjectAssignment,
  ProjectAssignmentStatus,
  ProjectAssignmentType,
  Rank,
  Respondent
} from "../types/domain";
import { requireData, throwIfError } from "./baseRepository";

export interface ProjectAssignmentRecord extends ProjectAssignment {
  respondent?: Respondent & { current_rank?: Rank | null };
}

interface ProjectAssignmentCreateInput {
  user_id?: string;
  project_id: string;
  respondent_id: string;
  assignment_type: ProjectAssignmentType;
  status?: ProjectAssignmentStatus;
  filter_snapshot?: Record<string, unknown> | null;
  assigned_at?: string;
  deadline?: string | null;
  due_at?: string | null;
}

type ProjectAssignmentUpdateInput = Partial<
  Pick<
    ProjectAssignment,
    | "user_id"
    | "assignment_type"
    | "status"
    | "filter_snapshot"
    | "assigned_at"
    | "deadline"
    | "due_at"
    | "sent_at"
    | "opened_at"
    | "started_at"
    | "completed_at"
    | "expired_at"
    | "reminder_sent_at"
    | "last_delivery_error"
    | "delivery_log"
  >
>;

const ACTIVE_STATUSES: ProjectAssignmentStatus[] = ["assigned", "sent", "opened", "started"];

export const projectAssignmentRepository = {
  activeStatuses: ACTIVE_STATUSES,

  async listAll(): Promise<ProjectAssignment[]> {
    const { data, error } = await supabase
      .from("project_assignments")
      .select("*")
      .order("updated_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as ProjectAssignment[];
  },

  async listByProject(projectId: string): Promise<ProjectAssignmentRecord[]> {
    const { data, error } = await supabase
      .from("project_assignments")
      .select("*, respondent:respondents(*, current_rank:ranks(*))")
      .eq("project_id", projectId)
      .order("updated_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as ProjectAssignmentRecord[];
  },

  async listByRespondentIds(respondentIds: string[]): Promise<ProjectAssignment[]> {
    if (respondentIds.length === 0) {
      return [];
    }

    const { data, error } = await supabase
      .from("project_assignments")
      .select("*")
      .in("respondent_id", respondentIds)
      .order("updated_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as ProjectAssignment[];
  },

  async listActiveByRespondentIds(respondentIds: string[]): Promise<ProjectAssignment[]> {
    if (respondentIds.length === 0) {
      return [];
    }

    const { data, error } = await supabase
      .from("project_assignments")
      .select("*")
      .in("respondent_id", respondentIds)
      .in("status", ACTIVE_STATUSES)
      .order("updated_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as ProjectAssignment[];
  },

  async listActiveByUserId(userId: string): Promise<ProjectAssignment[]> {
    const { data, error } = await supabase
      .from("project_assignments")
      .select("*")
      .eq("user_id", userId)
      .in("status", ACTIVE_STATUSES)
      .order("updated_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as ProjectAssignment[];
  },

  async listActionableByUserId(userId: string): Promise<ProjectAssignment[]> {
    const { data, error } = await supabase
      .from("project_assignments")
      .select("*")
      .eq("user_id", userId)
      .in("status", ACTIVE_STATUSES)
      .order("updated_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as ProjectAssignment[];
  },

  async getById(id: string): Promise<ProjectAssignment> {
    const { data, error } = await supabase
      .from("project_assignments")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return requireData(data as ProjectAssignment | null, "Assignment not found");
  },

  async getByProjectAndRespondent(
    projectId: string,
    respondentId: string
  ): Promise<ProjectAssignment | null> {
    const { data, error } = await supabase
      .from("project_assignments")
      .select("*")
      .eq("project_id", projectId)
      .eq("respondent_id", respondentId)
      .maybeSingle();
    throwIfError(error);
    return (data as ProjectAssignment | null) ?? null;
  },

  async create(input: ProjectAssignmentCreateInput): Promise<ProjectAssignment> {
    const nowIso = input.assigned_at ?? new Date().toISOString();
    const { data, error } = await supabase
      .from("project_assignments")
      .insert({
        ...input,
        status: input.status ?? "assigned",
        assigned_at: nowIso,
        deadline: input.deadline ?? input.due_at ?? null
      })
      .select("*")
      .single();
    throwIfError(error);
    return data as ProjectAssignment;
  },

  async update(id: string, input: ProjectAssignmentUpdateInput): Promise<ProjectAssignment> {
    const payload = {
      ...input,
      deadline: input.deadline ?? input.due_at ?? undefined
    };
    const { data, error } = await supabase
      .from("project_assignments")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as ProjectAssignment;
  },

  async expireOverdueAssignments(nowIso: string, projectId?: string): Promise<void> {
    let query = supabase
      .from("project_assignments")
      .update({
        status: "expired",
        expired_at: nowIso,
        updated_at: nowIso
      })
      .not("deadline", "is", null)
      .lt("deadline", nowIso)
      .in("status", ACTIVE_STATUSES);

    if (projectId) {
      query = query.eq("project_id", projectId);
    }

    const { error } = await query;
    throwIfError(error);
  },

  async countByProject(projectId: string): Promise<number> {
    const { count, error } = await supabase
      .from("project_assignments")
      .select("*", { count: "exact", head: true })
      .eq("project_id", projectId);
    throwIfError(error);
    return count ?? 0;
  }
};
