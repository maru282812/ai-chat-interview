import { supabase } from "../config/supabase";
import { throwIfError } from "./baseRepository";

/**
 * 招待・ペアの永続化層（migration 097）。
 * 判定ロジックは持たない（src/lib/missionInvite.ts の純関数が担当）。
 */

export interface MissionInvite {
  id: string;
  token: string;
  inviter_id: string;
  invitee_id: string | null;
  status: "issued" | "registered" | "answered" | "expired" | "revoked";
  registered_at: string | null;
  answered_at: string | null;
  expires_at: string;
  signup_ua: string | null;
  signup_ip: string | null;
  created_at: string;
  updated_at: string;
}

export interface SurveyPair {
  id: string;
  invite_id: string;
  user_a: string;
  user_b: string;
  expires_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface PairQuestion {
  id: string;
  sort_order: number;
  question_text: string;
  choices: Array<{ code: string; label: string }>;
  is_active: boolean;
}

export interface PairAnswer {
  id: string;
  pair_id: string;
  line_user_id: string;
  question_id: string;
  choice_code: string;
  answered_at: string;
}

export const missionInviteRepository = {
  async create(input: {
    token: string;
    inviter_id: string;
    expires_at: string;
  }): Promise<MissionInvite> {
    const { data, error } = await supabase
      .from("mission_invites")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return data as MissionInvite;
  },

  async getByToken(token: string): Promise<MissionInvite | null> {
    const { data, error } = await supabase
      .from("mission_invites")
      .select("*")
      .eq("token", token)
      .maybeSingle();
    throwIfError(error);
    return (data as MissionInvite) ?? null;
  },

  async getById(id: string): Promise<MissionInvite | null> {
    const { data, error } = await supabase
      .from("mission_invites")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return (data as MissionInvite) ?? null;
  },

  /** 発行済み（失効・取消を除く）の件数。上限判定に使う。 */
  async countActiveByInviter(inviterId: string): Promise<number> {
    const { count, error } = await supabase
      .from("mission_invites")
      .select("id", { count: "exact", head: true })
      .eq("inviter_id", inviterId)
      .in("status", ["issued", "registered", "answered"]);
    throwIfError(error);
    return count ?? 0;
  },

  /**
   * 受諾（登録）を記録する。
   * status='issued' かつ invitee 未設定の行だけを対象にした条件付き UPDATE。
   * 同時アクセスでも二重受諾にならない（0行更新なら null を返す）。
   */
  async markRegistered(input: {
    id: string;
    invitee_id: string;
    signup_ua: string | null;
    signup_ip: string | null;
  }): Promise<MissionInvite | null> {
    const { data, error } = await supabase
      .from("mission_invites")
      .update({
        invitee_id: input.invitee_id,
        status: "registered",
        registered_at: new Date().toISOString(),
        signup_ua: input.signup_ua,
        signup_ip: input.signup_ip,
        updated_at: new Date().toISOString(),
      })
      .eq("id", input.id)
      .eq("status", "issued")
      .is("invitee_id", null)
      .select("*")
      .maybeSingle();
    throwIfError(error);
    return (data as MissionInvite) ?? null;
  },

  async markAnswered(id: string): Promise<void> {
    const { error } = await supabase
      .from("mission_invites")
      .update({
        status: "answered",
        answered_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("status", "registered");
    throwIfError(error);
  },

  async revoke(id: string): Promise<void> {
    const { error } = await supabase
      .from("mission_invites")
      .update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("id", id);
    throwIfError(error);
  },

  /** 管理画面: 一覧（新しい順）。 */
  async listRecent(limit = 100): Promise<MissionInvite[]> {
    const { data, error } = await supabase
      .from("mission_invites")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    throwIfError(error);
    return (data ?? []) as MissionInvite[];
  },
};

export const surveyPairRepository = {
  async createForInvite(input: {
    invite_id: string;
    user_a: string;
    user_b: string;
    expires_at: string;
  }): Promise<SurveyPair> {
    const { data, error } = await supabase
      .from("survey_pairs")
      .insert(input)
      .select("*")
      .single();
    throwIfError(error);
    return data as SurveyPair;
  },

  async getById(id: string): Promise<SurveyPair | null> {
    const { data, error } = await supabase
      .from("survey_pairs")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return (data as SurveyPair) ?? null;
  },

  /**
   * ペア完了を記録する。completed_at が NULL の行だけを対象にした条件付き UPDATE。
   * 両者が同時に最終回答を送っても、完了処理（＝本命報酬の付与）は1回しか通らない。
   */
  async markCompleted(id: string): Promise<SurveyPair | null> {
    const { data, error } = await supabase
      .from("survey_pairs")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", id)
      .is("completed_at", null)
      .select("*")
      .maybeSingle();
    throwIfError(error);
    return (data as SurveyPair) ?? null;
  },

  async listActiveQuestions(): Promise<PairQuestion[]> {
    const { data, error } = await supabase
      .from("pair_questions")
      .select("*")
      .eq("is_active", true)
      .order("sort_order", { ascending: true });
    throwIfError(error);
    return (data ?? []) as PairQuestion[];
  },

  async listAnswers(pairId: string): Promise<PairAnswer[]> {
    const { data, error } = await supabase
      .from("pair_answers")
      .select("*")
      .eq("pair_id", pairId);
    throwIfError(error);
    return (data ?? []) as PairAnswer[];
  },

  /** 回答を保存する。同一設問への再回答は上書き（UNIQUE + upsert）。 */
  async upsertAnswer(input: {
    pair_id: string;
    line_user_id: string;
    question_id: string;
    choice_code: string;
  }): Promise<void> {
    const { error } = await supabase
      .from("pair_answers")
      .upsert(input, { onConflict: "pair_id,line_user_id,question_id" });
    throwIfError(error);
  },
};
