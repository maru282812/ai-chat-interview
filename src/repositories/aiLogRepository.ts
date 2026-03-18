import { supabase } from "../config/supabase";
import type { AILog } from "../types/domain";
import { throwIfError } from "./baseRepository";

export const aiLogRepository = {
  async create(input: {
    session_id: string;
    purpose: string;
    prompt: string;
    response: string;
    token_usage?: Record<string, unknown> | null;
  }): Promise<AILog> {
    const { data, error } = await supabase.from("ai_logs").insert(input).select("*").single();
    throwIfError(error);
    return data as AILog;
  }
};
