import { supabase } from "../config/supabase";
import { throwIfError } from "../repositories/baseRepository";
import type { UserStreak } from "../types/domain";

export interface StreakRecordResult {
  streak: UserStreak;
  bonusEarned: boolean;
  bonusMilestone: number | null;
}

const STREAK_BONUS_MILESTONES = [7, 14, 30, 60, 100];

export const userStreakService = {
  async getStreak(lineUserId: string): Promise<UserStreak> {
    const { data, error } = await supabase
      .from("user_streaks")
      .select("*")
      .eq("line_user_id", lineUserId)
      .single();
    if (error?.code === "PGRST116") {
      return {
        line_user_id:       lineUserId,
        current_streak:     0,
        longest_streak:     0,
        last_answered_date: null,
        total_answer_days:  0,
        streak_updated_at:  new Date().toISOString()
      };
    }
    throwIfError(error);
    return data as UserStreak;
  },

  async recordAnswer(lineUserId: string, dateStr?: string): Promise<StreakRecordResult> {
    const today = dateStr ?? new Date().toISOString().slice(0, 10);
    const existing = await this.getStreak(lineUserId);

    const last = existing.last_answered_date;
    let newStreak = existing.current_streak;
    let newTotal  = existing.total_answer_days;

    if (last === today) {
      // 当日すでに記録済み → 変更なし
      return {
        streak: existing,
        bonusEarned: false,
        bonusMilestone: null
      };
    }

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    if (last === yesterdayStr) {
      newStreak += 1;
    } else {
      newStreak = 1;
    }
    newTotal += 1;

    const newLongest = Math.max(existing.longest_streak, newStreak);

    const { data, error } = await supabase
      .from("user_streaks")
      .upsert(
        {
          line_user_id:       lineUserId,
          current_streak:     newStreak,
          longest_streak:     newLongest,
          last_answered_date: today,
          total_answer_days:  newTotal,
          streak_updated_at:  new Date().toISOString()
        },
        { onConflict: "line_user_id" }
      )
      .select("*")
      .single();
    throwIfError(error);

    const updated = data as UserStreak;

    // ストリークマイルストーンに達したか判定
    const prevStreak = existing.current_streak;
    const hitMilestone = STREAK_BONUS_MILESTONES.find(
      (m) => newStreak >= m && prevStreak < m
    ) ?? null;

    return {
      streak: updated,
      bonusEarned: hitMilestone !== null,
      bonusMilestone: hitMilestone
    };
  },

  streakBonusPoints(milestone: number): number {
    const table: Record<number, number> = {
      7:   20,
      14:  30,
      30:  80,
      60: 150,
      100: 300
    };
    return table[milestone] ?? 0;
  }
};
