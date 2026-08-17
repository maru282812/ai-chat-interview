/**
 * cycleRules.ts
 *
 * 繰り返しアンケート（サイクル）の判定ルール（純関数・Migration 093）。
 *
 * DB を触らないロジックだけをここに集める。理由:
 *   - 離脱判定は「日付の計算」が本体で、取り違えるとデータが静かに歪む
 *   - 実LLM・実DBなしでテストできる状態を保ちたい
 *
 * サイクルの考え方:
 *   A（来店理由）の完了で1周が始まり、次の A の完了で次の周が始まる。
 *   A で答えた来店頻度から「次に来るはずの日」を出し、それを過ぎても
 *   A が来なければ離脱疑い ＝ C（離脱検証）の送付対象。
 *   次の A が来た時点で「離脱していない」が確定するので C は送らない。
 */

/** A-Q11「普段どのくらいの頻度で美容室を利用しますか？」の選択肢コード → 日数。 */
export const VISIT_FREQUENCY_DAYS: Readonly<Record<string, number>> = Object.freeze({
  within_3w: 21,
  about_1m: 30,
  about_1_5m: 45,
  about_2m: 60,
  about_3m: 90,
  over_4m: 120,
});

/** 頻度が未定（undecided）のときに使う既定日数。cycle_groups.undecided_days で上書きされる。 */
export const DEFAULT_UNDECIDED_DAYS = 60;

/** A 再回答で新サイクルを開始できるようになるまでの既定日数。 */
export const DEFAULT_RESTART_COOLDOWN_DAYS = 25;

/** 頻度期間に上乗せする既定の猶予日数。 */
export const DEFAULT_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export function addDays(base: Date, days: number): Date {
  return new Date(base.getTime() + days * DAY_MS);
}

export function diffInDays(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / DAY_MS;
}

/**
 * 来店頻度コードから日数を引く。
 *
 * - 既知コード → その日数
 * - "undecided" → undecidedDays（既定60日）
 * - 未知コード / 空 → null（＝離脱判定できない。C は送らない）
 *
 * 未知コードを既定値に丸めないのは、設問の選択肢が変わったことに
 * 気づかないまま誤った離脱率が出るのを避けるため。
 */
export function resolveFrequencyDays(
  frequencyCode: string | null | undefined,
  undecidedDays: number = DEFAULT_UNDECIDED_DAYS
): number | null {
  if (!frequencyCode) return null;
  const code = frequencyCode.trim();
  if (!code) return null;
  if (code === "undecided") return undecidedDays;
  return VISIT_FREQUENCY_DAYS[code] ?? null;
}

/**
 * 「次に来るはずの日」を算出する。これを過ぎたら離脱疑い。
 * 頻度が引けない場合は null（＝そのサイクルは離脱判定の対象外）。
 */
export function computeExpectedReturnAt(params: {
  answeredAt: Date;
  frequencyCode: string | null | undefined;
  graceDays?: number;
  undecidedDays?: number;
}): Date | null {
  const days = resolveFrequencyDays(params.frequencyCode, params.undecidedDays ?? DEFAULT_UNDECIDED_DAYS);
  if (days === null) return null;
  const grace = params.graceDays ?? DEFAULT_GRACE_DAYS;
  return addDays(params.answeredAt, days + grace);
}

/**
 * A の再回答で「新しいサイクルを開始してよいか」を判定する。
 *
 * クールダウンの目的は2つ:
 *   1. QR 連打によるポイント二重取りの防止
 *   2. サイクル数の水増し防止（離脱率の分母が壊れる）
 *
 * クールダウン内の再訪は新サイクルを作らず、開いているサイクルへの
 * 再回答として扱う（＝回答は受け付けるが周回は進めない）。
 */
export function canStartNewCycle(params: {
  lastCycleStartedAt: Date | null;
  now: Date;
  cooldownDays?: number;
}): boolean {
  if (!params.lastCycleStartedAt) return true;
  const cooldown = params.cooldownDays ?? DEFAULT_RESTART_COOLDOWN_DAYS;
  return diffInDays(params.lastCycleStartedAt, params.now) >= cooldown;
}

/**
 * サイクルが C（離脱検証）の送付対象かを判定する。
 *
 * 送付するのは「期限を過ぎても再来店していない」場合だけ。
 * 既に送付済み・再来店済み・クローズ済み・期限未設定は対象外。
 */
export function isFollowupDue(
  cycle: {
    expected_return_at: string | null;
    followup_sent_at: string | null;
    returned_at: string | null;
    closed_at: string | null;
  },
  now: Date
): boolean {
  if (cycle.closed_at) return false;
  if (cycle.followup_sent_at) return false;
  if (cycle.returned_at) return false;
  if (!cycle.expected_return_at) return false;
  return new Date(cycle.expected_return_at).getTime() <= now.getTime();
}
