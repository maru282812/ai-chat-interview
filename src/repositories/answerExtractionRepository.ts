import { supabase } from "../config/supabase";
import type { AnswerExtraction } from "../types/domain";
import { throwIfError } from "./baseRepository";

export const answerExtractionRepository = {
  async upsert(
    input: Omit<AnswerExtraction, "id" | "created_at" | "updated_at"> & { id?: string }
  ): Promise<AnswerExtraction> {
    const { data, error } = await supabase
      .from("answer_extractions")
      .upsert(input, { onConflict: "source_answer_id" })
      .select("*")
      .single();
    throwIfError(error);
    return data as AnswerExtraction;
  },

  async getByAnswerId(answerId: string): Promise<AnswerExtraction | null> {
    const { data, error } = await supabase
      .from("answer_extractions")
      .select("*")
      .eq("source_answer_id", answerId)
      .maybeSingle();
    throwIfError(error);
    return (data as AnswerExtraction | null) ?? null;
  },

  async listByAnswerIds(answerIds: string[]): Promise<AnswerExtraction[]> {
    if (answerIds.length === 0) {
      return [];
    }

    const { data, error } = await supabase
      .from("answer_extractions")
      .select("*")
      .in("source_answer_id", answerIds)
      .order("extracted_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as AnswerExtraction[];
  },

  async listAll(): Promise<AnswerExtraction[]> {
    const { data, error } = await supabase
      .from("answer_extractions")
      .select("*")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as AnswerExtraction[];
  }
};
