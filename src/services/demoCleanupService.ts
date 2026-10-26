import { supabase } from "../config/supabase";
import { DEMO_RETENTION_DAYS } from "../lib/demoProject";
import { logger } from "../lib/logger";

export interface DemoCleanupResult {
  demoProjects: number;
  deletedSessions: number;
}

/**
 * デモ案件 (Migration 120) の古い回答を消す。cronDispatchService から日次で呼ばれる。
 *
 * セッションを消せば answers / messages / ai_logs / ai_analysis_results は FK の
 * ON DELETE CASCADE で一緒に消える（point_transactions は SET NULL だが、デモは付与しないので行が無い）。
 * assignment / respondent は残す: 同じ人が次に開いたとき再利用され、survey ページで started に戻る。
 */
export const demoCleanupService = {
  async purgeExpired(now: Date = new Date()): Promise<DemoCleanupResult> {
    const { data: projects, error: projectError } = await supabase
      .from("projects")
      .select("id")
      .eq("is_demo", true);
    if (projectError) throw new Error(projectError.message);

    const projectIds = (projects ?? []).map((p) => (p as { id: string }).id);
    if (projectIds.length === 0) return { demoProjects: 0, deletedSessions: 0 };

    const cutoff = new Date(now.getTime() - DEMO_RETENTION_DAYS * 24 * 3600_000).toISOString();
    const { data: deleted, error } = await supabase
      .from("sessions")
      .delete()
      .in("project_id", projectIds)
      .lt("started_at", cutoff)
      .select("id");
    if (error) throw new Error(error.message);

    const result = { demoProjects: projectIds.length, deletedSessions: (deleted ?? []).length };
    if (result.deletedSessions > 0) logger.info("demoCleanup.purged", { ...result, cutoff });
    return result;
  },
};
