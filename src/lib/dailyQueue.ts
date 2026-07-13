/**
 * dailyQueue.ts
 *
 * デイリーアンケートの「配信キュー × 日付スロット」を解決する純関数群
 * （migration 079 / docs/plan-daily-survey-queue.md）。
 *
 * 配信モデル:
 *   - 朝枠は常にキューの先頭から自動補充する（＝何もしなければ 1 日 1 件）。
 *   - 夜枠は evening_autofill_enabled が true のときだけ補充する（＝1 日 2 件）。
 *   - 日付固定（scheduled_date + slot）があればキューより優先する。
 *   - どちらも無い枠は「何も配信しない」。過去の active を再送しない。
 *
 * 責務外:
 *   - DB アクセス（repository が担う）
 *   - LINE への push（dailySurveyService が担う）
 */

export type DailySlot = "morning" | "evening";

export const DAILY_SLOTS: readonly DailySlot[] = ["morning", "evening"] as const;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 実 UTC 時刻から JST の日付キー（YYYY-MM-DD）を作る。 */
export function jstDateString(at: Date = new Date()): string {
  return new Date(at.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** JST の「その日の終わり」(23:59:59.999) を UTC の ISO 文字列で返す。既定の回答期限に使う。 */
export function jstEndOfDayIso(dateString: string): string {
  const [y, m, d] = dateString.split("-").map(Number);
  const jstEndAsUtc = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
  return new Date(jstEndAsUtc - JST_OFFSET_MS).toISOString();
}

/** YYYY-MM-DD に日数を足す。 */
export function addDays(dateString: string, days: number): string {
  const [y, m, d] = dateString.split("-").map(Number);
  const at = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  at.setUTCDate(at.getUTCDate() + days);
  return at.toISOString().slice(0, 10);
}

// ------------------------------------------------------------------
// 1. スロット配信の判定
// ------------------------------------------------------------------

/** その枠に既に日付固定されているアンケート（無ければ null）。 */
export interface SlotOccupant {
  id: string;
  status: string;
}

export interface SlotDecisionInput {
  slot: DailySlot;
  /** scheduled_date = 当日 かつ slot = この枠 のアンケート。 */
  occupant: SlotOccupant | null;
  /** status='queued' を queue_position 昇順に並べた先頭（無ければ null）。 */
  queueHeadId: string | null;
  /** 夜枠をキューから自動補充するか（朝枠では無視される）。 */
  eveningAutofillEnabled: boolean;
}

export type SlotDecision =
  | { action: "deliver"; surveyId: string; source: "scheduled" | "queue" }
  | { action: "noop"; reason: "already-completed" | "paused" | "queue-empty" | "autofill-disabled" };

/**
 * その枠で何を配信すべきかを決める。
 *
 * 判定順:
 *   1. 日付固定されたものがあればそれ（completed / paused なら何もしない）
 *   2. 無ければキューの先頭（夜枠は autofill が有効なときだけ）
 *   3. どちらも無ければ何もしない
 */
export function decideSlotDelivery(input: SlotDecisionInput): SlotDecision {
  const { slot, occupant, queueHeadId, eveningAutofillEnabled } = input;

  if (occupant) {
    // active は「当日すでに配信済み」。cron_dispatch_runs で二重発火は防がれているので、
    // 取りこぼしのキャッチアップ再実行時に未送信ユーザーへ届くよう deliver を返す
    // （送信済みユーザーは dailySurveyService 側で delivery レコードの有無でスキップされる）。
    if (occupant.status === "completed") return { action: "noop", reason: "already-completed" };
    if (occupant.status === "paused") return { action: "noop", reason: "paused" };
    return { action: "deliver", surveyId: occupant.id, source: "scheduled" };
  }

  const autofill = slot === "morning" ? true : eveningAutofillEnabled;
  if (!autofill) return { action: "noop", reason: "autofill-disabled" };
  if (!queueHeadId) return { action: "noop", reason: "queue-empty" };

  return { action: "deliver", surveyId: queueHeadId, source: "queue" };
}

// ------------------------------------------------------------------
// 2. カレンダーの「自動補充の見込み」予測
// ------------------------------------------------------------------

export interface QueuePreviewInput {
  /** 予測を始める日（通常は JST の今日）。 */
  startDate: string;
  /** 予測する日数。 */
  days: number;
  /** キューの並び（queue_position 昇順の survey id）。 */
  queueIds: string[];
  /** すでに日付固定されている枠。`${date}:${slot}` の集合。 */
  occupiedSlots: Set<string>;
  /** 夜枠の自動補充が有効か。 */
  eveningAutofillEnabled: boolean;
}

/** `${date}:${slot}` → キューから自動で入る見込みの survey id。DB には書かない表示専用の予測。 */
export type QueuePreview = Map<string, string>;

export function slotKey(date: string, slot: DailySlot): string {
  return `${date}:${slot}`;
}

/**
 * 「今のキュー順のままなら、どの日のどの枠に何が入るか」を計算する。
 * 日付固定済みの枠は飛ばす（＝固定分はキューを消費しない）。
 */
export function previewQueueAssignments(input: QueuePreviewInput): QueuePreview {
  const { startDate, days, queueIds, occupiedSlots, eveningAutofillEnabled } = input;
  const preview: QueuePreview = new Map();
  const remaining = [...queueIds];

  for (let i = 0; i < days && remaining.length > 0; i++) {
    const date = addDays(startDate, i);
    const slots: DailySlot[] = eveningAutofillEnabled ? ["morning", "evening"] : ["morning"];

    for (const slot of slots) {
      if (remaining.length === 0) break;
      const key = slotKey(date, slot);
      if (occupiedSlots.has(key)) continue; // 日付固定済みの枠は自動補充の対象外
      const next = remaining.shift();
      if (next) preview.set(key, next);
    }
  }

  return preview;
}

// ------------------------------------------------------------------
// 3. キューの並べ替え
// ------------------------------------------------------------------

/**
 * 並べ替え後の id 配列から、保存すべき queue_position を作る。
 * 途中への挿入に備えて 10 刻みで振る。
 */
export function queuePositions(orderedIds: string[]): Array<{ id: string; queue_position: number }> {
  return orderedIds.map((id, i) => ({ id, queue_position: (i + 1) * 10 }));
}
