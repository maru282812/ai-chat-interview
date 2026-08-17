/**
 * cycleFunnel.ts
 *
 * 離脱率の集計（純関数・Migration 093）。
 *
 * 「離脱」の定義（この計算の前提）:
 *   A で答えた来店頻度の期間（＋猶予）を過ぎても、A の再回答が無い ＝ 離脱。
 *   次の A が来た時点で returned_at が入り「離脱していない」が確定する。
 *   C（離脱検証アンケート）に答えたかどうかは離脱の判定に使わない。
 *   C は離脱者に「なぜ来なくなったか」を聞くための調査であって、判定材料ではない。
 *
 * 分母に入れてよいのは「判定が確定した周」だけ:
 *   まだ期限が来ていない周は、離脱したかどうか分からない（pending）。
 *   これを分母に入れると離脱率が過小に出るので必ず除外する。
 */

export interface CycleFunnelInput {
  id: string;
  cycle_no: number;
  expected_return_at: string | null;
  returned_at: string | null;
  followup_sent_at: string | null;
  closed_at: string | null;
  close_reason: string | null;
}

export type CycleOutcome = "returned" | "churned" | "pending" | "unknown";

export interface CycleFunnelSummary {
  /** 判定が確定した周の数（＝離脱率の分母） */
  decided: number;
  /** 再来店が確認できた周 */
  returned: number;
  /** 期限を過ぎても再来店が無かった周 */
  churned: number;
  /** まだ期限が来ていない＝判定できない周（分母から除く） */
  pending: number;
  /** 頻度が取れず判定不能な周（分母から除く） */
  unknown: number;
  /** churned / decided。分母0なら null（0%ではない） */
  churnRate: number | null;
}

/**
 * 1周の判定。
 *
 * - returned_at がある → 再来店（離脱していない）
 * - 期限を過ぎている → 離脱
 * - 期限前 → 未確定
 * - 期限が立っていない（頻度不明）→ 判定不能
 */
export function classifyCycle(cycle: CycleFunnelInput, now: Date): CycleOutcome {
  if (cycle.returned_at) return "returned";
  // 再来店以外の理由で閉じた周も、期限判定に従う（下へ流す）。
  if (!cycle.expected_return_at) return "unknown";
  return new Date(cycle.expected_return_at).getTime() <= now.getTime() ? "churned" : "pending";
}

/** 周の集合から離脱率を出す。 */
export function summarizeCycles(cycles: CycleFunnelInput[], now: Date): CycleFunnelSummary {
  const summary: CycleFunnelSummary = {
    decided: 0,
    returned: 0,
    churned: 0,
    pending: 0,
    unknown: 0,
    churnRate: null,
  };

  for (const cycle of cycles) {
    const outcome = classifyCycle(cycle, now);
    summary[outcome] += 1;
  }

  summary.decided = summary.returned + summary.churned;
  summary.churnRate = summary.decided > 0 ? summary.churned / summary.decided : null;
  return summary;
}

/**
 * 周回ごとの離脱率。「2周目以降は定着して離脱しにくい」といった傾向を見る。
 * cycle_no の昇順で返す。
 */
export function summarizeByCycleNo(
  cycles: CycleFunnelInput[],
  now: Date
): { cycleNo: number; summary: CycleFunnelSummary }[] {
  const buckets = new Map<number, CycleFunnelInput[]>();
  for (const cycle of cycles) {
    const list = buckets.get(cycle.cycle_no) ?? [];
    list.push(cycle);
    buckets.set(cycle.cycle_no, list);
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([cycleNo, list]) => ({ cycleNo, summary: summarizeCycles(list, now) }));
}

/** 表示用の百分率（小数1桁）。分母0なら "—"。 */
export function formatChurnRate(rate: number | null): string {
  return rate === null ? "—" : `${(rate * 100).toFixed(1)}%`;
}
