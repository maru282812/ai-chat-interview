import { supabase } from "../config/supabase";
import type { Message, SenderType } from "../types/domain";
import { throwIfError } from "./baseRepository";

export const messageRepository = {
  async create(input: {
    session_id: string;
    sender_type: SenderType;
    message_text: string;
    raw_payload?: Record<string, unknown> | null;
  }): Promise<Message> {
    const { data, error } = await supabase.from("messages").insert(input).select("*").single();
    throwIfError(error);
    return data as Message;
  },

  async listBySession(sessionId: string): Promise<Message[]> {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as Message[];
  },

  async listAll(): Promise<Message[]> {
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .order("created_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as Message[];
  }
};
