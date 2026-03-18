import { supabase } from "../config/supabase";
import type { Answer } from "../types/domain";
import { throwIfError } from "./baseRepository";

export const answerRepository = {
  async create(input: {
    session_id: string;
    question_id: string;
    answer_text: string;
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

  async listAll(): Promise<Answer[]> {
    const { data, error } = await supabase
      .from("answers")
      .select("*")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as Answer[];
  }
};
