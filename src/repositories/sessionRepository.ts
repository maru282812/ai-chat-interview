import { supabase } from "../config/supabase";
import type { Session, SessionPhase, SessionState, SessionStatus } from "../types/domain";
import { requireData, throwIfError } from "./baseRepository";

export const sessionRepository = {
  async getActiveByRespondent(respondentId: string, projectId: string): Promise<Session | null> {
    const { data, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("respondent_id", respondentId)
      .eq("project_id", projectId)
      .in("status", ["pending", "active"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return (data as Session | null) ?? null;
  },

  async create(input: {
    respondent_id: string;
    project_id: string;
    current_question_id: string | null;
    current_phase: SessionPhase;
    status: SessionStatus;
    summary?: string | null;
    state_json?: SessionState | null;
  }): Promise<Session> {
    const { data, error } = await supabase.from("sessions").insert(input).select("*").single();
    throwIfError(error);
    return data as Session;
  },

  async update(
    id: string,
    input: Partial<
      Pick<
        Session,
        | "current_question_id"
        | "current_phase"
        | "status"
        | "summary"
        | "state_json"
        | "completed_at"
        | "last_activity_at"
      >
    >
  ): Promise<Session> {
    const payload = {
      ...input,
      last_activity_at: input.last_activity_at ?? new Date().toISOString()
    };
    const { data, error } = await supabase
      .from("sessions")
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as Session;
  },

  async getById(id: string): Promise<Session> {
    const { data, error } = await supabase.from("sessions").select("*").eq("id", id).maybeSingle();
    throwIfError(error);
    return requireData(data as Session | null, "Session not found");
  },

  async countByStatus(status: SessionStatus): Promise<number> {
    const { count, error } = await supabase
      .from("sessions")
      .select("*", { count: "exact", head: true })
      .eq("status", status);
    throwIfError(error);
    return count ?? 0;
  },

  async listByRespondent(respondentId: string): Promise<Session[]> {
    const { data, error } = await supabase
      .from("sessions")
      .select("*")
      .eq("respondent_id", respondentId)
      .order("started_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as Session[];
  }
};
