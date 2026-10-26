/**
 * デモ案件 (Migration 120) の判定と、デモで止める処理の一覧。
 *
 * デモ案件 = 何度でも 1 問目から回答し直せる、体験を見せるためだけの案件。
 * 次の処理はデモでは動かさない（どこで止めているかの索引も兼ねる）:
 *   - ポイント付与 …… pointService.awardCompletionPoints（全完了経路が通る1か所で 0 にする）
 *   - ABC サイクル …… 入口（storeEntryService / applicationService）で周を作らない＝A だけで完結
 *   - 完了の LINE 通知・キャンペーン完了数 …… completeSurveyByAssignment / runPostCompleteProcess
 *   - 公開一覧・統計・店舗開示 …… 各集計の入口で isDemoProject を見て除外
 *   - 回答の保持 …… demoCleanupService が DEMO_RETENTION_DAYS 日で削除
 */

/** デモ回答の保持日数。これより古いデモのセッション・回答は cron で消す。 */
export const DEMO_RETENTION_DAYS = 30;

export function isDemoProject(project: { is_demo?: boolean | null } | null | undefined): boolean {
  return project?.is_demo === true;
}
