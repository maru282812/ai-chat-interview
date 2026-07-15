/**
 * poolQuestionSelection.ts
 *
 * 「ついでスワイプ（設問プール）」で、今この人に出す設問をサーバー権威で選ぶ純関数。
 * docs/spec-pool-swipe-questions.md の選定ルールの実装。
 *
 * DB アクセスは持たない（テスト容易性のため。probePlaygroundService の純関数分離と同じ流儀）。
 * 呼び出し側（poolQuestionService）が候補・本人の履歴・今日の日付を集めて渡す。
 *
 * 選定ルール（優先順）:
 *   1. 候補 = status='active' かつ掲載期間内
 *   2. 除外 = 本人が回答済みで、reask_after_days が NULL または前回回答から未経過
 *   3. 除外 = 本人が過去 POOL_SKIP_COOLDOWN_DAYS 日以内にスキップした
 *   4. 除外 = 今日すでに answered / skipped の exposure がある
 *   5. 今日 served のまま残っている exposure を最優先で再掲（冪等）
 *   6. 残枠を priority DESC, created_at ASC で補充。今日の exposure 総数が CAP に達したら補充しない
 */

/** 1日あたりの出題上限（served+answered+skipped の合計）。 */
export const POOL_DAILY_CAP = 3;
/** スキップした設問を再出題しないクールダウン日数。 */
export const POOL_SKIP_COOLDOWN_DAYS = 14;

/** 候補設問（active/期間フィルタは本関数内で行う）。 */
export interface PoolQuestionCandidate {
  id: string;
  status: "draft" | "active" | "paused" | "archived";
  priority: number;
  /** ISO 文字列。並び順（priority 同着時の created_at ASC）に使う。 */
  created_at: string;
  /** ISO 文字列 or null。掲載開始。 */
  starts_at: string | null;
  /** ISO 文字列 or null。掲載終了。 */
  ends_at: string | null;
  /** N日後に再出題（test-retest）。null = 一度回答したら再出題しない。 */
  reask_after_days: number | null;
}

/** 本人の出題ログ（exposure_date は JST の YYYY-MM-DD）。 */
export interface PoolExposureRecord {
  question_id: string;
  exposure_date: string;
  status: "served" | "answered" | "skipped";
  position: number;
}

/** 本人の回答（answered_date は JST の YYYY-MM-DD へ丸めたもの）。 */
export interface PoolAnswerRecord {
  question_id: string;
  answered_date: string;
}

export interface SelectPoolQuestionsInput {
  candidates: PoolQuestionCandidate[];
  /** 本人の exposure（少なくとも直近 COOLDOWN 日ぶん＋今日を含むこと）。 */
  exposures: PoolExposureRecord[];
  /** 本人の全回答（reask 判定のため古いものも含む）。 */
  answers: PoolAnswerRecord[];
  /** JST の今日（YYYY-MM-DD）。 */
  today: string;
  /** 掲載期間の判定に使う現在時刻（既定 = new Date()）。 */
  now?: Date;
}

/** 出す設問1件。isNew=true は exposure をこれから作る、false は今日の served を再掲。 */
export interface SelectedPoolQuestion {
  questionId: string;
  position: number;
  isNew: boolean;
}

/** YYYY-MM-DD 同士の日数差（b - a）。両方 JST の暦日なので TZ を挟まず計算できる。 */
function dayDiff(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  if (pa.length !== 3 || pb.length !== 3) return Number.NaN;
  const ua = Date.UTC(pa[0] ?? 0, (pa[1] ?? 1) - 1, pa[2] ?? 1);
  const ub = Date.UTC(pb[0] ?? 0, (pb[1] ?? 1) - 1, pb[2] ?? 1);
  return Math.round((ub - ua) / 86_400_000);
}

/** 掲載期間内か（starts_at/ends_at が NULL または now を包含）。 */
function isWithinPeriod(c: PoolQuestionCandidate, now: Date): boolean {
  if (c.starts_at) {
    const s = new Date(c.starts_at).getTime();
    if (!Number.isNaN(s) && now.getTime() < s) return false;
  }
  if (c.ends_at) {
    const e = new Date(c.ends_at).getTime();
    if (!Number.isNaN(e) && now.getTime() > e) return false;
  }
  return true;
}

/**
 * 今この人に出す設問を最大 POOL_DAILY_CAP 件返す。
 * 返り値の順序が表示順（再掲 → 新規補充）。
 */
export function selectPoolQuestions(input: SelectPoolQuestionsInput): SelectedPoolQuestion[] {
  const { candidates, exposures, answers, today } = input;
  const now = input.now ?? new Date();

  // 今日の exposure（状態別）。
  const todayExposures = exposures.filter((e) => e.exposure_date === today);
  const servedToday = todayExposures
    .filter((e) => e.status === "served")
    .sort((a, b) => a.position - b.position);
  const todayQuestionIds = new Set(todayExposures.map((e) => e.question_id));

  const result: SelectedPoolQuestion[] = servedToday.map((e) => ({
    questionId: e.question_id,
    position: e.position,
    isNew: false,
  }));

  // 今日の exposure 総数（served+answered+skipped）が CAP に達していたら補充しない（ルール6）。
  const remainingSlots = POOL_DAILY_CAP - todayExposures.length;
  if (remainingSlots <= 0) return result;

  // reask 判定用: 設問ごとの最新回答日。
  const latestAnswerDate = new Map<string, string>();
  for (const a of answers) {
    const prev = latestAnswerDate.get(a.question_id);
    if (!prev || a.answered_date > prev) latestAnswerDate.set(a.question_id, a.answered_date);
  }

  // スキップ・クールダウン用: 設問ごとの最新スキップ日。
  const latestSkipDate = new Map<string, string>();
  for (const e of exposures) {
    if (e.status !== "skipped") continue;
    const prev = latestSkipDate.get(e.question_id);
    if (!prev || e.exposure_date > prev) latestSkipDate.set(e.question_id, e.exposure_date);
  }

  const eligible = candidates.filter((c) => {
    // ルール1: active かつ掲載期間内
    if (c.status !== "active") return false;
    if (!isWithinPeriod(c, now)) return false;
    // ルール4: 今日すでに exposure（served 再掲は上で処理済み・answered/skipped は除外）
    if (todayQuestionIds.has(c.id)) return false;
    // ルール2: 回答済みで reask 未経過/なし
    const answeredOn = latestAnswerDate.get(c.id);
    if (answeredOn) {
      if (c.reask_after_days == null) return false;
      if (dayDiff(answeredOn, today) < c.reask_after_days) return false;
    }
    // ルール3: 直近 COOLDOWN 日以内にスキップ
    const skippedOn = latestSkipDate.get(c.id);
    if (skippedOn && dayDiff(skippedOn, today) < POOL_SKIP_COOLDOWN_DAYS) return false;
    return true;
  });

  // ルール6: priority DESC, created_at ASC で補充。
  eligible.sort((a, b) => {
    if (b.priority !== a.priority) return b.priority - a.priority;
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });

  // 新規 exposure の position は今日の通し順（既存 exposure の最大 position の次から）。
  let nextPos = todayExposures.reduce((max, e) => Math.max(max, e.position), -1) + 1;
  for (const c of eligible.slice(0, remainingSlots)) {
    result.push({ questionId: c.id, position: nextPos, isNew: true });
    nextPos += 1;
  }

  return result;
}
