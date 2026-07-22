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

  /**
   * 同一 session×question の primary 回答を1件に収束させる（フォームでの再回答は上書き）。
   * 既存 primary があれば update-in-place（answer.id を保持し probe の parent_answer_id 参照を壊さない）、
   * なければ新規作成。answerRepository.create を毎回呼ぶと再回答で重複行が増える問題への対処。
   */
  async upsertPrimary(input: {
    session_id: string;
    question_id: string;
    answer_text: string;
    free_text_answer?: string | null;
    normalized_answer?: Record<string, unknown> | null;
  }): Promise<Answer> {
    const { data: existingRows, error: selErr } = await supabase
      .from("answers")
      .select("id")
      .eq("session_id", input.session_id)
      .eq("question_id", input.question_id)
      .eq("answer_role", "primary")
      .order("created_at", { ascending: true })
      .limit(1);
    throwIfError(selErr);
    const existing = (existingRows ?? [])[0] as { id: string } | undefined;

    if (existing) {
      const { data, error } = await supabase
        .from("answers")
        .update({
          answer_text: input.answer_text,
          free_text_answer: input.free_text_answer ?? null,
          normalized_answer: input.normalized_answer ?? null,
        })
        .eq("id", existing.id)
        .select("*")
        .single();
      throwIfError(error);
      return data as Answer;
    }

    return this.create({ ...input, answer_role: "primary" });
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

  /** 設問に紐づく回答件数（公開後の編集・削除ガード用） */
  async countByQuestion(questionId: string): Promise<number> {
    const { count, error } = await supabase
      .from("answers")
      .select("id", { count: "exact", head: true })
      .eq("question_id", questionId);
    throwIfError(error);
    return count ?? 0;
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
