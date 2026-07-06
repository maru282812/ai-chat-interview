import type { QuestionMeta } from "../types/domain";

/**
 * metricCatalog.ts
 *
 * 共通指標コード（canonical metric）の推奨語彙とユーティリティ（純関数）。
 * 複数アンケートを企業（client）単位で横断集計・比較するための「意味の共通キー」を提供する。
 *
 * 設計方針（docs/spec-client-aggregation-foundation.md 土台①）:
 * - コードは固定 enum ではなく「推奨カタログ＋自由入力可」。運用で新種指標を足せる。
 * - 保存前に normalizeMetricCode で `[a-z0-9_]+` に正規化。不正・空は null（＝未設定）。
 * - ラベルはカタログにあればカタログ優先、無ければコード名そのものを表示。
 * - DBマイグレーション不要（QuestionMeta.metric_code / metric_direction は JSONB 拡張）。
 */

export type MetricDirection = NonNullable<QuestionMeta["metric_direction"]>;

export interface MetricCatalogEntry {
  code: string;
  label: string;
  default_direction: MetricDirection;
  note: string;
}

/** 推奨指標カタログ（初期語彙）。運用で追加可。ここに無いコードも自由入力で使える。 */
export const METRIC_CATALOG: MetricCatalogEntry[] = [
  {
    code: "satisfaction",
    label: "満足度",
    default_direction: "higher_is_better",
    note: "総合的な満足度。GT・企業横断平均・店舗間ランキングの中心指標。"
  },
  {
    code: "revisit_intent",
    label: "再来店意向",
    default_direction: "higher_is_better",
    note: "また利用したいか。企業横断・ビフォーアフター比較に使う。"
  },
  {
    code: "nps",
    label: "NPS（推奨度）",
    default_direction: "higher_is_better",
    note: "他者への推奨度（0-10想定）。企業横断・店舗間比較。"
  },
  {
    code: "awareness_channel",
    label: "認知経路",
    default_direction: "neutral",
    note: "どこで知ったか。商圏・流入分析の素地。"
  },
  {
    code: "visit_frequency",
    label: "来店頻度",
    default_direction: "neutral",
    note: "利用頻度。クロス集計の属性軸として使う。"
  },
  {
    code: "price_evaluation",
    label: "価格評価",
    default_direction: "higher_is_better",
    note: "価格の納得感。GT・提案書。"
  }
];

const CATALOG_BY_CODE = new Map(METRIC_CATALOG.map((entry) => [entry.code, entry]));

export const METRIC_DIRECTIONS: MetricDirection[] = ["higher_is_better", "lower_is_better", "neutral"];

const DIRECTION_LABELS: Record<MetricDirection, string> = {
  higher_is_better: "高いほど良い",
  lower_is_better: "低いほど良い",
  neutral: "中立"
};

/**
 * 入力を保存用の metric_code に正規化する。
 * - 小文字化し、英数字とアンダースコア以外はアンダースコアへ。前後・連続アンダースコアを畳む。
 * - 空・記号のみなど有効文字が残らない場合は null（＝未設定として扱う）。
 */
export function normalizeMetricCode(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const normalized = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.length > 0 ? normalized : null;
}

/** metric_code の表示ラベル。カタログ優先、無ければコード名をそのまま返す。 */
export function metricLabel(code: string): string {
  return CATALOG_BY_CODE.get(code)?.label ?? code;
}

/** カタログ既定の集計方向。未知コードは "neutral"。 */
export function defaultMetricDirection(code: string): MetricDirection {
  return CATALOG_BY_CODE.get(code)?.default_direction ?? "neutral";
}

/** metric_direction を検証し、正しくなければ null。 */
export function normalizeMetricDirection(raw: unknown): MetricDirection | null {
  return typeof raw === "string" && (METRIC_DIRECTIONS as string[]).includes(raw)
    ? (raw as MetricDirection)
    : null;
}

/** metric_direction の表示ラベル。 */
export function metricDirectionLabel(direction: MetricDirection): string {
  return DIRECTION_LABELS[direction];
}
