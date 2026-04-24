import { supabase } from "../config/supabase";
import type { Answer, AnswerRole } from "../types/domain";
import { throwIfError } from "./baseRepository";

export const answerRepository = {
  async create(input: {
    session_id: string;
    question_id: string;
    answer_text: string;
    free_text_answer?: string | null;
    answer_role?: AnswerRole;
    parent_answer_id?: string | null;
    normalized_answer?: Record<string, unknown> | null;
  }): Promise<Answer> {
    const { data, error } = await supabase.from("answers").insert(input).select("*").single();
    throwIfError(error);
    return data as Answer;
  },

  async listBySession(sessionId: string): Promise<Answer[]> {
    const { data, error } = await supabase
      .from("answers")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as Answer[];
  },

  async getById(id: string): Promise<Answer | null> {
    const { data, error } = await supabase.from("answers").select("*").eq("id", id).maybeSingle();
    throwIfError(error);
    return (data as Answer | null) ?? null;
  },

  async update(
    id: string,
    input: Partial<Pick<Answer, "answer_text" | "normalized_answer" | "parent_answer_id">>
  ): Promise<Answer> {
    const { data, error } = await supabase.from("answers").update(input).eq("id", id).select("*").single();
    throwIfError(error);
    return data as Answer;
  },

  async listBySessions(sessionIds: string[]): Promise<Answer[]> {
    if (sessionIds.length === 0) {
      return [];
    }

    const { data, error } = await supabase
      .from("answers")
      .select("*")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as Answer[];
  },

  async listAll(): Promise<Answer[]> {
    const { data, error } = await supabase
      .from("answers")
      .select("*")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as Answer[];
  }
};
