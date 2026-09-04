import { supabase } from "../config/supabase";
import { throwIfError } from "./baseRepository";
import type { HiddenAwardMode, HiddenOpenMode } from "../lib/missionRooms";

/**
 * 隠し部屋（Phase 3・migration 099）の永続化層。
 *
 * 冪等の構え（missionRepository.recordAward と同じ流儀）:
 *   入室・付与とも UNIQUE 制約に当てて 23505 を「すでに存在」として false で返す。
 *   付与の二重目のガードは awardPoints の idempotency_key。
 */

export interface HiddenRoomRow {
  id: string;
  mission_id: string;
  category: string;
  open_mode: HiddenOpenMode;
  rooms_needed: number | null;
  opens_at: string | null;
  closes_at: string | null;
  first_n: number | null;
  award_mode: HiddenAwardMode;
  pot_points: number | null;
  flat_points: number | null;
  prize_points: number | null;
  winners_count: number | null;
  settled_at: string | null;
  is_active: boolean;
}

export interface HiddenRoomWithMission extends HiddenRoomRow {
  missions: { id: string; name: string; ends_at: string; is_active: boolean };
}

export type HiddenRoomInput = Omit<HiddenRoomRow, "id" | "settled_at" | "is_active">;

export const missionHiddenRoomRepository = {
  async getByMissionId(missionId: string): Promise<HiddenRoomRow | null> {
    const { data, error } = await supabase
      .from("mission_hidden_rooms")
      .select("*")
      .eq("mission_id", missionId)
      .eq("is_active", true)
      .maybeSingle();
    throwIfError(error);
    return (data as HiddenRoomRow) ?? null;
  },

  async getById(id: string): Promise<HiddenRoomRow | null> {
    const { data, error } = await supabase
      .from("mission_hidden_rooms")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    throwIfError(error);
    return (data as HiddenRoomRow) ?? null;
  },

  /**
   * 管理画面の保存。ミッションに1部屋（UNIQUE mission_id）なので upsert。
   * ⚠ settled_at は触らない（確定済みの結果を編集で消さない）。
   */
  async upsertForMission(input: HiddenRoomInput): Promise<HiddenRoomRow> {
    const { data, error } = await supabase
      .from("mission_hidden_rooms")
      .upsert(
        { ...input, is_active: true, updated_at: new Date().toISOString() },
        { onConflict: "mission_id" }
      )
      .select("*")
      .single();
    throwIfError(error);
    return data as HiddenRoomRow;
  },

  /** 管理画面で「隠し部屋なし」に戻したとき。行は消さず無効化（入室・付与の履歴を守る）。 */
  async deactivateForMission(missionId: string): Promise<void> {
    const { error } = await supabase
      .from("mission_hidden_rooms")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("mission_id", missionId);
    throwIfError(error);
  },

  // ---- 入室 ----

  async countEntries(roomId: string): Promise<number> {
    const { count, error } = await supabase
      .from("mission_hidden_entries")
      .select("id", { count: "exact", head: true })
      .eq("hidden_room_id", roomId);
    throwIfError(error);
    return count ?? 0;
  },

  async getEntry(roomId: string, lineUserId: string): Promise<{ entered_at: string } | null> {
    const { data, error } = await supabase
      .from("mission_hidden_entries")
      .select("entered_at")
      .eq("hidden_room_id", roomId)
      .eq("line_user_id", lineUserId)
      .maybeSingle();
    throwIfError(error);
    return (data as { entered_at: string }) ?? null;
  },

  /** true = 今回新規に入室記録できた。23505（既入室）は false。 */
  async addEntry(roomId: string, lineUserId: string): Promise<boolean> {
    const { error } = await supabase
      .from("mission_hidden_entries")
      .insert({ hidden_room_id: roomId, line_user_id: lineUserId });
    if (error?.code === "23505") return false;
    throwIfError(error);
    return true;
  },

  async listEntries(roomId: string): Promise<Array<{ line_user_id: string; entered_at: string }>> {
    const { data, error } = await supabase
      .from("mission_hidden_entries")
      .select("line_user_id, entered_at")
      .eq("hidden_room_id", roomId)
      .order("entered_at", { ascending: true });
    throwIfError(error);
    return (data ?? []) as Array<{ line_user_id: string; entered_at: string }>;
  },

  // ---- 付与 ----

  async getAward(
    roomId: string,
    lineUserId: string
  ): Promise<{ points: number; kind: string } | null> {
    const { data, error } = await supabase
      .from("mission_hidden_awards")
      .select("points, kind")
      .eq("hidden_room_id", roomId)
      .eq("line_user_id", lineUserId)
      .maybeSingle();
    throwIfError(error);
    return (data as { points: number; kind: string }) ?? null;
  },

  /** true = 今回新規に記録できた（＝払ってよい）。23505 は false。 */
  async recordAward(
    roomId: string,
    lineUserId: string,
    points: number,
    kind: HiddenAwardMode
  ): Promise<boolean> {
    const { error } = await supabase
      .from("mission_hidden_awards")
      .insert({ hidden_room_id: roomId, line_user_id: lineUserId, points, kind });
    if (error?.code === "23505") return false;
    throwIfError(error);
    return true;
  },

  // ---- settle ----

  /** 終了済み・未確定の split/raffle 部屋（settle バッチの対象）。 */
  async listUnsettledEnded(nowIso: string): Promise<HiddenRoomWithMission[]> {
    const { data, error } = await supabase
      .from("mission_hidden_rooms")
      .select("*, missions!inner(id, name, ends_at, is_active)")
      .eq("is_active", true)
      .is("settled_at", null)
      .in("award_mode", ["split", "raffle"])
      .lt("missions.ends_at", nowIso);
    throwIfError(error);
    return (data ?? []) as HiddenRoomWithMission[];
  },

  async markSettled(roomId: string): Promise<void> {
    const { error } = await supabase
      .from("mission_hidden_rooms")
      .update({ settled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", roomId)
      .is("settled_at", null);
    throwIfError(error);
  },

  // ---- 資格判定（部屋カテゴリの案件を回答完了したか）----

  async listProjectIdsByCategory(category: string): Promise<string[]> {
    const { data, error } = await supabase
      .from("projects")
      .select("id")
      .eq("category", category);
    throwIfError(error);
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  },

  /**
   * 入室後に部屋の案件を回答完了したか。
   * respondents に完了時刻の専用列が無いため updated_at >= 入室時刻 で近似する
   * （入室前の古い回答を資格にしない方向の安全側）。
   */
  async hasCompletedInProjects(
    lineUserId: string,
    projectIds: readonly string[],
    sinceIso: string
  ): Promise<boolean> {
    if (projectIds.length === 0) return false;
    const { count, error } = await supabase
      .from("respondents")
      .select("id", { count: "exact", head: true })
      .eq("line_user_id", lineUserId)
      .eq("status", "completed")
      .neq("is_test", true)
      .in("project_id", [...projectIds])
      .gte("updated_at", sinceIso);
    throwIfError(error);
    return (count ?? 0) > 0;
  },
};
