import {
  LIFF_BEHAVIOR_EVENT_TYPES,
  insertLiffBehaviorEvents,
  type LiffBehaviorEventInput,
  type LiffBehaviorEventType,
} from "../repositories/liffBehaviorEventRepository";

/**
 * LIFF 行動計測の受け口。クライアントから届いた生JSONを検証して保存形に正規化する。
 *
 * 方針: **信用しない・落とさない**。
 * ビーコンは認証なしで受けるため、不正な形は静かに捨てる（例外は投げない）。
 * 1リクエストあたりの件数と文字列長に上限を設け、ログ肥大と悪用を防ぐ。
 */

/** 1リクエストで受け付けるイベント数の上限。超過分は捨てる。 */
const MAX_EVENTS_PER_REQUEST = 20;
/** 文字列フィールドの最大長。target に長い文字列を入れられても切り詰める。 */
const MAX_TEXT_LEN = 120;

const EVENT_TYPE_SET = new Set<string>(LIFF_BEHAVIOR_EVENT_TYPES);

function toCleanText(value: unknown, maxLen = MAX_TEXT_LEN): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, maxLen);
}

function toCleanInt(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  // 負値・非現実的な巨大値は計測ミスなので捨てる（スクロール量・経過msを想定）。
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > 10_000_000) return null;
  return rounded;
}

/**
 * 生の配列を検証済みイベントに変換する。
 * 検証に通らなかった要素は黙って除外する（1件の不正で全体を捨てない）。
 */
export function normalizeBehaviorEvents(
  rawEvents: unknown,
  lineUserId: string | null,
): LiffBehaviorEventInput[] {
  if (!Array.isArray(rawEvents)) return [];

  const result: LiffBehaviorEventInput[] = [];

  for (const raw of rawEvents.slice(0, MAX_EVENTS_PER_REQUEST)) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Record<string, unknown>;

    // event_type と page は必須。どちらかが欠けると集計時に意味を持たないため捨てる。
    const eventType = typeof item.event_type === "string" ? item.event_type : "";
    if (!EVENT_TYPE_SET.has(eventType)) continue;

    const page = toCleanText(item.page, 40);
    if (!page) continue;

    result.push({
      event_type: eventType as LiffBehaviorEventType,
      page,
      target: toCleanText(item.target),
      value_num: toCleanInt(item.value_num),
      session_key: toCleanText(item.session_key, 40),
      line_user_id: lineUserId,
    });
  }

  return result;
}

/**
 * 受信したイベントを記録する。保存失敗は repository 側で握りつぶされる。
 * 呼び出し側（ルート）は常に 204 を返してよい。
 */
export async function recordBehaviorEvents(
  rawEvents: unknown,
  lineUserId: string | null,
): Promise<number> {
  const events = normalizeBehaviorEvents(rawEvents, lineUserId);
  if (events.length === 0) return 0;

  await insertLiffBehaviorEvents(events);
  return events.length;
}
