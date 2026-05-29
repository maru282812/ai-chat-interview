import { supabase } from "../config/supabase";
import { throwIfError } from "../repositories/baseRepository";
import type { UserBadge, UserBadgeAward } from "../types/domain";

export interface BadgeCheckResult {
  newlyAwarded: UserBadgeAward[];
  allEarned: UserBadgeAward[];
}

export const userBadgeService = {
  async listBadgeDefinitions(): Promise<UserBadge[]> {
    const { data, error } = await supabase
      .from("user_badges")
      .select("*")
      .eq("is_active", true)
      .order("sort_order");
    throwIfError(error);
    return (data ?? []) as UserBadge[];
  },

  async listAllDefinitions(): Promise<UserBadge[]> {
    const { data, error } = await supabase
      .from("user_badges")
      .select("*")
      .order("sort_order");
    throwIfError(error);
    return (data ?? []) as UserBadge[];
  },

  async listEarned(lineUserId: string): Promise<UserBadgeAward[]> {
    const { data, error } = await supabase
      .from("user_badge_awards")
      .select("*")
      .eq("line_user_id", lineUserId)
      .order("awarded_at", { ascending: false });
    throwIfError(error);
    return (data ?? []) as UserBadgeAward[];
  },

  async awardBadge(lineUserId: string, badgeCode: string): Promise<UserBadgeAward | null> {
    const { data, error } = await supabase
      .from("user_badge_awards")
      .upsert(
        { line_user_id: lineUserId, badge_code: badgeCode, awarded_at: new Date().toISOString() },
        { onConflict: "line_user_id,badge_code", ignoreDuplicates: true }
      )
      .select("*")
      .single();
    if (error?.code === "23505" || error?.code === "PGRST116") return null;
    throwIfError(error);
    return data as UserBadgeAward;
  },

  async checkAndAward(lineUserId: string): Promise<BadgeCheckResult> {
    // respondent_ids を先に取得（サブクエリは型不一致のため2段階で）
    const { data: respondentRows } = await supabase
      .from("respondents")
      .select("id")
      .eq("line_user_id", lineUserId);
    const respondentIds = ((respondentRows ?? []) as Array<{ id: string }>).map((r) => r.id);

    const [badges, earnedAwards, pointSummary, streakRow, profileRow, sessionRow, assignmentRow] =
      await Promise.all([
        this.listBadgeDefinitions(),
        this.listEarned(lineUserId),
        supabase.from("v_user_point_summary").select("*").eq("line_user_id", lineUserId).single(),
        supabase.from("user_streaks").select("*").eq("line_user_id", lineUserId).single(),
        supabase.from("user_profiles").select("profile_completed").eq("line_user_id", lineUserId).single(),
        respondentIds.length > 0
          ? supabase.from("sessions").select("id", { count: "exact", head: true })
              .eq("status", "completed")
              .in("respondent_id", respondentIds)
          : Promise.resolve({ count: 0 }),
        supabase.from("project_assignments").select("id", { count: "exact", head: true })
          .eq("status", "completed")
          .eq("line_user_id", lineUserId)
      ]);

    const earnedCodes = new Set(earnedAwards.map((a) => a.badge_code));
    const summary     = pointSummary.data as { total_answer_days: number; lifetime_points: number; rank_code: string | null } | null;
    const streak      = streakRow.data as { current_streak: number; longest_streak: number; total_answer_days: number } | null;
    const profileCompleted = (profileRow.data as { profile_completed: boolean } | null)?.profile_completed ?? false;
    const hasCompletedSession    = (sessionRow.count ?? 0) > 0;
    const hasCompletedAssignment = (assignmentRow.count ?? 0) > 0;
    const totalAnswerDays = streak?.total_answer_days ?? summary?.total_answer_days ?? 0;
    const longestStreak   = streak?.longest_streak ?? 0;

    const RANK_ORDER: Record<string, number> = { bronze: 1, silver: 2, gold: 3, platinum: 4, diamond: 5 };
    const userRankOrder = RANK_ORDER[summary?.rank_code ?? "bronze"] ?? 1;

    const newlyAwarded: UserBadgeAward[] = [];

    for (const badge of badges) {
      if (earnedCodes.has(badge.badge_code)) continue;

      let qualified = false;
      switch (badge.condition_type) {
        case "first_answer":        qualified = totalAnswerDays >= 1; break;
        case "streak_7":            qualified = longestStreak >= 7; break;
        case "streak_30":           qualified = longestStreak >= 30; break;
        case "streak_100":          qualified = longestStreak >= 100; break;
        case "answers_10":          qualified = totalAnswerDays >= 10; break;
        case "answers_50":          qualified = totalAnswerDays >= 50; break;
        case "answers_100":         qualified = totalAnswerDays >= 100; break;
        case "answers_300":         qualified = totalAnswerDays >= 300; break;
        case "profile_complete":    qualified = profileCompleted; break;
        case "interview_complete":  qualified = hasCompletedSession; break;
        case "project_complete":    qualified = hasCompletedAssignment; break;
        case "rank_silver":         qualified = userRankOrder >= 2; break;
        case "rank_gold":           qualified = userRankOrder >= 3; break;
        case "rank_platinum":       qualified = userRankOrder >= 4; break;
        case "rank_diamond":        qualified = userRankOrder >= 5; break;
      }

      if (qualified) {
        const award = await this.awardBadge(lineUserId, badge.badge_code);
        if (award) newlyAwarded.push(award);
      }
    }

    const allEarned = newlyAwarded.length > 0
      ? await this.listEarned(lineUserId)
      : earnedAwards;

    return { newlyAwarded, allEarned };
  },

  async getAwardCounts(): Promise<Record<string, number>> {
    const { data, error } = await supabase
      .from("user_badge_awards")
      .select("badge_code");
    throwIfError(error);
    const counts: Record<string, number> = {};
    for (const row of (data ?? []) as Array<{ badge_code: string }>) {
      counts[row.badge_code] = (counts[row.badge_code] ?? 0) + 1;
    }
    return counts;
  },

  async listUserBadgeSummary(): Promise<Array<{
    line_user_id: string;
    display_name: string | null;
    badge_count: number;
    latest_badge_at: string | null;
  }>> {
    const { data, error } = await supabase
      .from("user_badge_awards")
      .select("line_user_id, awarded_at, user_profiles!inner(display_name)")
      .order("awarded_at", { ascending: false });
    throwIfError(error);

    const map = new Map<string, { display_name: string | null; count: number; latest: string | null }>();
    type AwardRow = { line_user_id: string; awarded_at: string; user_profiles: { display_name: string | null } | Array<{ display_name: string | null }> };
    for (const row of (data ?? []) as unknown as AwardRow[]) {
      const profile = Array.isArray(row.user_profiles) ? row.user_profiles[0] : row.user_profiles;
      const existing = map.get(row.line_user_id);
      if (existing) {
        existing.count++;
        if (!existing.latest || row.awarded_at > existing.latest) existing.latest = row.awarded_at;
      } else {
        map.set(row.line_user_id, {
          display_name: profile?.display_name ?? null,
          count: 1,
          latest: row.awarded_at
        });
      }
    }

    return [...map.entries()]
      .map(([line_user_id, v]) => ({
        line_user_id,
        display_name: v.display_name,
        badge_count: v.count,
        latest_badge_at: v.latest
      }))
      .sort((a, b) => b.badge_count - a.badge_count);
  }
};
