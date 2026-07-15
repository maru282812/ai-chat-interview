/**
 * qualityScore.ts — 回答品質による獲得ポイントの重み付け（受け皿 / seam）
 *
 * ランク体系の核は「有効回答数 × 品質」の quality-weighted ポイント。
 * その“品質”をポイントに効かせるための入口をここに一本化する。
 *
 *   ★ 品質判定ロジック本体は後日ちゃんと設計する（文字数・具体性・素通り検出・
 *     AI 誠実度スコア・矛盾チェック等）。現状は「仮＝係数 1.0（減点なし）」の受け皿。
 *   ★ 将来は computeQualityFactor の中身だけ差し替えれば、全呼び出し元
 *     （qualityWeightedPoints を通すポイント付与）に一斉に効く。挙動を変えるのはその時。
 *
 * 契約: 係数は必ず [QUALITY_MIN, QUALITY_MAX] に収める。付与ポイントは 0 未満にしない。
 */

export interface AnswerQualitySignals {
  /** 回答本文（テキスト設問）。選択式は空でよい。 */
  text?: string | null;
  /** 設問タイプ（text / choice_single / choice_multi / numeric 等）。 */
  questionType?: string | null;
  /** 選択された選択肢コード（選択式）。 */
  selectedCodes?: string[] | null;
  /** 回答に要した秒数（取得できれば）。 */
  timeSec?: number | null;
  /** 1回の提出に複数設問がある場合の生回答（デイリー等）。将来の判定材料。 */
  answers?: Array<{ questionId: string; answerValue: unknown }> | null;
  /** 追加の任意シグナル（将来拡張用）。 */
  meta?: Record<string, unknown>;
}

/** 品質係数の下限・上限。仮の中身でもこの範囲に収める。 */
export const QUALITY_MIN = 0;
export const QUALITY_MAX = 1;

export function clampQuality(n: number): number {
  if (!Number.isFinite(n)) return QUALITY_MAX;
  return Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, n));
}

/**
 * 品質係数（0〜1）。
 * ★仮実装＝常に 1.0（減点なし）。後日、本設計でここだけ差し替える。
 */
export function computeQualityFactor(_signals: AnswerQualitySignals): number {
  // TODO(quality): 本設計で置き換える。今は受け皿（ニュートラル）。
  return QUALITY_MAX;
}

/**
 * 品質で重み付けした獲得ポイント。basePoints × 品質係数（四捨五入・0未満なし）。
 * 仮実装（係数 1.0）の間は basePoints と一致する＝挙動不変。
 */
export function qualityWeightedPoints(basePoints: number, signals: AnswerQualitySignals): number {
  const base = Math.max(0, Math.round(basePoints));
  const factor = clampQuality(computeQualityFactor(signals));
  return Math.max(0, Math.round(base * factor));
}
