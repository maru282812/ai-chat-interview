/**
 * 「すきま時間に」枠（案Q2）の抽出ロジック。
 *
 * 電車の中など短時間で開いた人に、その場で終わる案件だけを差し出すための選抜。
 * 画面から切り離した純関数にしてあるのは、下の NULL 除外規則をテストで固定するため。
 *
 * ⚠ 最重要の規則: `estimated_minutes` が未設定(null)の案件は**絶対に入れない**。
 *    「3分で終わるつもりが終わらない」が回答者の信頼を最も損なうため、
 *    「短いと分かっているもの」だけを枠に入れる（短いかもしれないものは入れない）。
 */

/** 抽出に必要な最小の形。projects の実データ・保存案件のどちらも満たす。 */
export interface QuickPickCandidate {
  estimated_minutes?: number | null;
  reward_points?: number | null;
  [key: string]: unknown;
}

/** 「すきま時間」とみなす所要時間の上限（分）。ユーザー指定: 3〜5分以内。 */
export const QUICK_PICK_MAX_MINUTES = 5;

/** 横帯に並べる最大件数。多すぎると「選ぶ」作業になり、すきま時間に合わない。 */
export const QUICK_PICK_LIMIT = 8;

/**
 * その案件が「すきま時間枠」に入る資格を持つか。
 * 未設定・0以下・上限超過はすべて false（判定を1箇所に閉じ込める）。
 */
export function isQuickPick(project: QuickPickCandidate): boolean {
  const minutes = project.estimated_minutes;
  if (typeof minutes !== "number" || !Number.isFinite(minutes)) return false;
  if (minutes <= 0) return false;
  return minutes <= QUICK_PICK_MAX_MINUTES;
}

/**
 * すきま時間枠に出す案件を選ぶ。
 * 並びは「短い順 → 同着なら報酬が高い順」。すきま時間に開いた人の関心は
 * 報酬額より「これは今すぐ終わるか」なので、所要時間を第1キーにする。
 */
export function selectQuickPicks<T extends QuickPickCandidate>(
  projects: T[],
  limit: number = QUICK_PICK_LIMIT,
): T[] {
  if (!Array.isArray(projects)) return [];

  return projects
    .filter(isQuickPick)
    .sort((a, b) => {
      const minuteDiff = (a.estimated_minutes ?? 0) - (b.estimated_minutes ?? 0);
      if (minuteDiff !== 0) return minuteDiff;
      return (b.reward_points ?? 0) - (a.reward_points ?? 0);
    })
    .slice(0, Math.max(0, limit));
}
