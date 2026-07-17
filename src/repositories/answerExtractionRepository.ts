import { supabase } from "../config/supabase";
import type { AnswerExtraction } from "../types/domain";
import { throwIfError } from "./baseRepository";

/** .in() の URL 長制限（PostgREST は GET クエリに ID を並べる）を超えないための分割単位。 */
const ANSWER_ID_IN_CHUNK_SIZE = 100;

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

    const rows: AnswerExtraction[] = [];
    for (let i = 0; i < answerIds.length; i += ANSWER_ID_IN_CHUNK_SIZE) {
      const chunk = answerIds.slice(i, i + ANSWER_ID_IN_CHUNK_SIZE);
      const { data, error } = await supabase
        .from("answer_extractions")
        .select("*")
        .in("source_answer_id", chunk)
        .order("extracted_at", { ascending: false });
      throwIfError(error);
      rows.push(...((data ?? []) as AnswerExtraction[]));
    }
    return rows;
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
