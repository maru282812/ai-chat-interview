import { supabase } from "../config/supabase";
import type { PointTransaction, PointTransactionType } from "../types/domain";
import { throwIfError } from "./baseRepository";

export const pointTransactionRepository = {
  async create(input: {
    respondent_id: string;
    session_id?: string | null;
    project_id?: string | null;
    transaction_type: PointTransactionType;
    points: number;
    reason: string;
  }): Promise<PointTransaction> {
    const { data, error } = await supabase
      .from("point_transactions")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return data as PointTransaction;
  },

  async listByRespondent(respondentId: string): Promise<PointTransaction[]> {
    const { data, error } = await supabase
      .from("point_transactions")
      .select("*")
      .eq("respondent_id", respondentId)
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as PointTransaction[];
  },

  async listAll(): Promise<PointTransaction[]> {
    const { data, error } = await supabase
      .from("point_transactions")
      .select("*")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as PointTransaction[];
  }
};
