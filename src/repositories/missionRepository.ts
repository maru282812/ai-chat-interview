import { supabase } from "../config/supabase";
import { throwIfError } from "./baseRepository";
import { ANSWER_TRANSACTION_TYPES } from "../lib/missionStage";

/**
 * ミッション（Phase 2）の永続化層（migration 098）。
 *
 * 進捗は専用テーブルで増分せず、正準台帳 point_histories と mission_invites を
 * COUNT する（数え漏れ・二重計上・既存回答経路への配線を全部避けるため）。
 */

export interface Mission {
  id: string;
  name: string;
  scope: "platform" | "project";
  project_id: string | null;
  theme_key: string;
  starts_at: string;
  ends_at: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface MissionStageRow {
  id: string;
  mission_id: string;
  stage_no: number;
  need_answers: number;
  need_invites: number;
  reward_points: number;
  is_masked: boolean;
}

export const missionRepository = {
  /**
   * いまユーザーに見せる横断型ミッション。
   * ⚠ 同時に2つ返さない（Hick: 同じ人に横断型を2つ見せない）。開始日の新しい方を採る。
   *
   * 終了後も RESULT_GRACE_DAYS の間はページに残す:
   * 山分け・抽選の結果はミッション終了後の settle バッチで確定するため、
   * 終了と同時に消すと「結果を画面で確認する」導線が存在しなくなる
   * （LINE通知は届くが、通知を見逃した人が確かめる場所が要る）。
   * 期間中の付与ロジックは getPageData 側の inPeriod 判定が守っているので、
   * 猶予中に段の新規付与は起きない。
   */
  async getActivePlatformMission(now: Date = new Date()): Promise<Mission | null> {
    const RESULT_GRACE_DAYS = 7;
    const iso = now.toISOString();
    const graceIso = new Date(now.getTime() - RESULT_GRACE_DAYS * 86400000).toISOString();
    const { data, error } = await supabase
      .from("missions")
      .select("*")
      .eq("is_active", true)
      .eq("scope", "platform")
      .lte("starts_at", iso)
      .gte("ends_at", graceIso)
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    throwIfError(error);
    return (data as Mission) ?? null;
  },

  async getById(id: string): Promise<Mission | null> {
    const { data, error } = await supabase.from("missions").select("*").eq("id", id).maybeSingle();
    throwIfError(error);
    return (data as Mission) ?? null;
  },

  async list(): Promise<Mission[]> {
    const { data, error } = await supabase
      .from("missions")
      .select("*")
      .order("starts_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as Mission[];
  },

  async create(input: Omit<Mission, "id" | "created_at" | "updated_at">): Promise<Mission> {
    const { data, error } = await supabase.from("missions").insert(input).select("*").single();
    throwIfError(error);
    return data as Mission;
  },

  async update(id: string, input: Partial<Omit<Mission, "id">>): Promise<Mission> {
    const { data, error } = await supabase
      .from("missions")
      .update({ ...input, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select("*")
      .single();
    throwIfError(error);
    return data as Mission;
  },

  async listStages(missionId: string): Promise<MissionStageRow[]> {
    const { data, error } = await supabase
      .from("mission_stages")
      .select("*")
      .eq("mission_id", missionId)
      .order("stage_no", { ascending: true });
    throwIfError(error);
    return (data ?? []) as MissionStageRow[];
  },

  /** ステージ定義の総入れ替え（管理画面の保存）。 */
  async replaceStages(
    missionId: string,
    stages: Array<Omit<MissionStageRow, "id" | "mission_id">>
  ): Promise<void> {
    const { error: delErr } = await supabase.from("mission_stages").delete().eq("mission_id", missionId);
    throwIfError(delErr);
    if (stages.length === 0) return;
    const { error } = await supabase
      .from("mission_stages")
      .insert(stages.map((s) => ({ ...s, mission_id: missionId })));
    throwIfError(error);
  },

  async listAwardedStageNos(missionId: string, lineUserId: string): Promise<number[]> {
    const { data, error } = await supabase
      .from("mission_stage_awards")
      .select("stage_no")
      .eq("mission_id", missionId)
      .eq("line_user_id", lineUserId);
    throwIfError(error);
    return (data ?? []).map((r) => (r as { stage_no: number }).stage_no);
  },

  /**
   * 達成の記録。UNIQUE 制約で二重記録を防ぐ（23505 は「すでに記録済み」として無視）。
   * true = 今回新規に記録できた（＝付与してよい）。
   */
  async recordAward(missionId: string, stageNo: number, lineUserId: string): Promise<boolean> {
    const { error } = await supabase
      .from("mission_stage_awards")
      .insert({ mission_id: missionId, stage_no: stageNo, line_user_id: lineUserId });
    if (error?.code === "23505") return false;
    throwIfError(error);
    return true;
  },

  /** ミッション期間内の回答数（正準台帳を数える）。 */
  async countAnswers(lineUserId: string, sinceIso: string, untilIso: string): Promise<number> {
    const { count, error } = await supabase
      .from("point_histories")
      .select("id", { count: "exact", head: true })
      .eq("line_user_id", lineUserId)
      .in("transaction_type", [...ANSWER_TRANSACTION_TYPES])
      .gte("created_at", sinceIso)
      .lte("created_at", untilIso);
    throwIfError(error);
    return count ?? 0;
  },

  /** ミッション期間内の招待成立数（登録以上）。 */
  async countInvites(inviterId: string, sinceIso: string, untilIso: string): Promise<number> {
    const { count, error } = await supabase
      .from("mission_invites")
      .select("id", { count: "exact", head: true })
      .eq("inviter_id", inviterId)
      .in("status", ["registered", "answered"])
      .gte("registered_at", sinceIso)
      .lte("registered_at", untilIso);
    throwIfError(error);
    return count ?? 0;
  },

  /** 部屋の進捗用: 自分が回答完了した案件ID（is_test を除く）。 */
  async listCompletedProjectIds(lineUserId: string): Promise<Set<string>> {
    const { data, error } = await supabase
      .from("respondents")
      .select("project_id")
      .eq("line_user_id", lineUserId)
      .eq("status", "completed")
      .neq("is_test", true);
    throwIfError(error);
    return new Set(((data ?? []) as Array<{ project_id: string }>).map((r) => r.project_id));
  },

  /** 案件指定型のゲージ分子: 完了した回答者数（is_test を除く）。 */
  async countProjectCompleted(projectId: string): Promise<number> {
    const { count, error } = await supabase
      .from("respondents")
      .select("id", { count: "exact", head: true })
      .eq("project_id", projectId)
      .eq("status", "completed")
      .neq("is_test", true);
    throwIfError(error);
    return count ?? 0;
  },
};
