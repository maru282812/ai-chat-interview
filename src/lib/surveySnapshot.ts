import type { Session } from "../types/domain";

/**
 * surveySnapshot.ts
 *
 * 「締切＝集計の区切り」を担保する純関数。
 *
 * ## なぜ要るか
 * 締切後も回答は受け付ける（QRを読み直した人を 404 にしない）。
 * しかし**店舗に見せる数字と納品物は締切時点で固定**しなければならない。
 * 固定しないと、closeSurvey が「◯件で締め切りました」と返した数と、
 * 後からダッシュボードに出る数が食い違う。集計は毎回ライブで数え直しており、
 * スナップショットが無いため**過去の数字を再現する手段が無い**。
 *
 * もう一つ、GT表の小N マスク（n<10 で % を伏せる）が、締切後に回答が増えて
 * n が 10 を跨ぐと**後から外れる**。一度伏せた数字が事後的に見えるのは
 * 匿名性の前提が変わるということなので、これも締切時点で固定して塞ぐ。
 *
 * ## 切りかた
 * `sessions.completed_at <= projects.closed_at` で切る。
 * 回答データそのものは普通に溜まり続け、集計が見る範囲だけが狭まる。
 *
 * ⚠ 運営側の集計（配信アサイン進捗・行動エビデンス）はこの関数を通さない。
 *   あれは「いま何件あるか」を見るためのもので、店舗に見せる数字ではない。
 */

/**
 * 締切時点までの完了セッションを返す。
 *
 * @param sessions  対象案件の全セッション（`sessionRepository.listByProject` の戻り）
 * @param closedAt  締切時刻。**null なら回収中**＝全ての完了セッションを数える
 *
 * `completed_at` が入っていない完了セッションは、締切前からあったものとして**残す**。
 * 落とすと、時刻を記録していなかった時代のデータが集計から消えて件数が減る
 * （＝納品済みの数字が動く）。本番では該当0件だが、fail-safe 側に倒しておく。
 */
export function selectCountedSessions(sessions: Session[], closedAt: string | null): Session[] {
  const completed = sessions.filter((session) => session.status === "completed");
  if (!closedAt) return completed;

  const cutoff = Date.parse(closedAt);
  // 締切時刻が壊れている（パースできない）ときは絞らない。
  // ここで空を返すと、集計が丸ごと 0 件になって納品物が消える。
  if (Number.isNaN(cutoff)) return completed;

  return completed.filter((session) => {
    if (!session.completed_at) return true;
    const completedAt = Date.parse(session.completed_at);
    if (Number.isNaN(completedAt)) return true;
    return completedAt <= cutoff;
  });
}

/**
 * 締切**後**に完了したセッション数（＝「次回ぶん」として店舗に件数だけ見せる）。
 *
 * 回収中（closedAt が null）は概念として存在しないので 0。
 */
export function countPostCloseSessions(sessions: Session[], closedAt: string | null): number {
  if (!closedAt) return 0;
  const completed = sessions.filter((session) => session.status === "completed");
  return completed.length - selectCountedSessions(sessions, closedAt).length;
}
