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

  /**
   * 設問単位の集計用サンプル取得（管理画面AIチャットの aggregate_answers）。
   *
   * 総数は必ず DB 側の count で取り、値の取得は上限付きにする。
   * 「打ち切った母集団で集計して総数として出す」を避けるため、返り値では
   * total（真の件数）と sampled（実際に読んだ件数）を分けて返す。
   */
  async sampleForAggregate(
    questionId: string,
    limit: number
  ): Promise<{ total: number; rows: Array<Pick<Answer, "answer_text" | "free_text_answer">> }> {
    const { count, error: countError } = await supabase
      .from("answers")
      .select("id", { count: "exact", head: true })
      .eq("question_id", questionId)
      .eq("answer_role", "primary");
    throwIfError(countError);

    const { data, error } = await supabase
      .from("answers")
      .select("answer_text, free_text_answer")
      .eq("question_id", questionId)
      .eq("answer_role", "primary")
      .order("created_at", { ascending: false })
      .limit(limit);
    throwIfError(error);

    return {
      total: count ?? 0,
      rows: (data ?? []) as Array<Pick<Answer, "answer_text" | "free_text_answer">>
    };
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
