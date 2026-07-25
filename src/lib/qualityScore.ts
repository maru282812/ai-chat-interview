/**
 * qualityScore.ts — 回答品質による獲得ポイントの重み付け
 *
 * 出典: 品質ファースト・アンケート構想（2026-07-10 壁打ち確定）。
 * 思想は「ポイ活の排除」ではなく **正直が最も得な報酬設計**。罰則（ランク基準の
 * 引き上げ）は不採用とし、**基準固定＋品質係数（誠実ボーナス）** 方式で確定した。
 * ランクのしきい値は動かさないので「次のランクまであと◯pt」は常に成立する。
 *
 * ## 係数の効かせ方（乗算＋絶対キャップのハイブリッド）
 *
 * 乗算「だけ」だと、品質のご褒美と代償が **案件の単価に比例** してしまう:
 *   - 1pt のついでスワイプは ×0.5 でも ×1.2 でも整数丸めで消える＝シグナルが死ぬ
 *   - 500pt の案件は 1 回の手抜きで -250pt ＝ 事実上の罰ゲームになり、
 *     「高い案件だけ丁寧にやる」という本末転倒な最適戦略を生む
 * そこで **係数を掛けたうえで、基準ポイントからの増減幅を絶対値で頭打ち** にする。
 * 「ちゃんと答えれば満額（＋α）」の体験は保ったまま、高単価だけが罰ゲーム化するのを防ぐ。
 *
 *   pt = clamp(round(base × factor), base - maxPenalty, base + maxBonus)
 *
 * ## 判定材料（単発完結シグナル）
 * 信頼スコアエンジン（デイリースワイプと本アンケートの整合性）は別レイヤ。
 * ここでは 1 回の回答だけで判定できるものを見る:
 *   - 回答が速すぎる（設問数 × 最低秒数を下回る）
 *   - 自由記述が極端に短い / 意味を成さない
 *   - 全設問で同一選択肢（ストレートライン）
 * 整合性シグナルは外部（trustScore）で算出し、`consistency` として渡す。
 *
 * 契約: 係数は [QUALITY_MIN, QUALITY_MAX] に収める。付与ポイントは 0 未満にしない。
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
  /** 1回の提出に複数設問がある場合の生回答（デイリー等）。 */
  answers?: Array<{ questionId: string; answerValue: unknown }> | null;
  /**
   * 信頼スコア（整合性）。0〜1。ついでスワイプとの突合など外部で算出して渡す。
   * 未指定＝素材が無い（新規ユーザー等）＝判定に使わない（減点しない）。
   */
  consistency?: number | null;
  /** 追加の任意シグナル（将来拡張用）。 */
  meta?: Record<string, unknown>;
}

/** 品質係数の下限・上限。上限>1＝誠実ボーナス（構想どおり上振れを許す）。 */
export const QUALITY_MIN = 0;
export const QUALITY_MAX = 1.2;
/** 減点も加点もない中立の係数。 */
export const QUALITY_NEUTRAL = 1;

/** 判定パラメータ。管理画面から調整する（app_settings: quality_scoring）。 */
export interface QualityScoringConfig {
  /** 判定そのものを止める緊急スイッチ。false なら常に満額。 */
  enabled: boolean;
  /** 1設問あたりこれ未満の秒数なら「速すぎ」とみなす。 */
  minSecondsPerQuestion: number;
  /** 自由記述がこの文字数未満なら「短すぎ」とみなす。 */
  minTextLength: number;
  /** ストレートライン（全設問同一選択）を検出するか。 */
  detectStraightlining: boolean;
  /** 各違反の減点幅（係数から引く値）。 */
  penaltyTooFast: number;
  penaltyTooShort: number;
  penaltyStraightline: number;
  penaltyInconsistent: number;
  /** 違反ゼロかつ整合性が高いときに足す誠実ボーナス。 */
  bonusHonest: number;
  /** この整合性スコア以上で誠実ボーナスの対象。 */
  consistencyBonusThreshold: number;
  /** この整合性スコア未満で「矛盾」として減点。 */
  consistencyPenaltyThreshold: number;
  /** 基準ポイントからの増減の絶対上限（pt）。単価比例の暴走を止める要。 */
  maxPenaltyPoints: number;
  maxBonusPoints: number;
  /** これ未満の基準ポイントは常に満額（低単価は真値の素材＝削らない）。 */
  minBaseForPenalty: number;
}

export const DEFAULT_QUALITY_CONFIG: QualityScoringConfig = {
  enabled: true,
  minSecondsPerQuestion: 3,
  minTextLength: 8,
  detectStraightlining: true,
  penaltyTooFast: 0.3,
  penaltyTooShort: 0.25,
  penaltyStraightline: 0.2,
  penaltyInconsistent: 0.25,
  bonusHonest: 0.1,
  consistencyBonusThreshold: 0.8,
  consistencyPenaltyThreshold: 0.4,
  // 既定は控えめ。案件本編（数百pt）でも体感が「罰」にならない幅にしておく。
  maxPenaltyPoints: 30,
  maxBonusPoints: 20,
  minBaseForPenalty: 5,
};

export function clampQuality(n: number): number {
  if (!Number.isFinite(n)) return QUALITY_NEUTRAL;
  return Math.min(QUALITY_MAX, Math.max(QUALITY_MIN, n));
}

/** 各設定キーの許容範囲。管理画面の入力を現実的な幅に閉じ込める。 */
const CONFIG_BOUNDS: Record<keyof Omit<QualityScoringConfig, "enabled" | "detectStraightlining">, [number, number]> = {
  minSecondsPerQuestion: [0, 120],
  minTextLength: [0, 200],
  penaltyTooFast: [0, 1],
  penaltyTooShort: [0, 1],
  penaltyStraightline: [0, 1],
  penaltyInconsistent: [0, 1],
  bonusHonest: [0, QUALITY_MAX - QUALITY_NEUTRAL],
  consistencyBonusThreshold: [0, 1],
  consistencyPenaltyThreshold: [0, 1],
  maxPenaltyPoints: [0, 100_000],
  maxBonusPoints: [0, 100_000],
  minBaseForPenalty: [0, 100_000],
};

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * app_settings に入っている生値をコード既定にマージして、安全な設定に解決する。
 * 未知キー・型不一致・範囲外は落として既定にフォールバックする（管理画面の誤入力で
 * 付与が壊れないように、ここで必ず正規化してから使う）。
 */
export function resolveQualityConfig(raw: unknown): QualityScoringConfig {
  const src = asRecord(raw);
  const out: QualityScoringConfig = { ...DEFAULT_QUALITY_CONFIG };

  if (typeof src.enabled === "boolean") out.enabled = src.enabled;
  if (typeof src.detectStraightlining === "boolean") {
    out.detectStraightlining = src.detectStraightlining;
  }

  for (const [key, [min, max]] of Object.entries(CONFIG_BOUNDS)) {
    const value = src[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    (out as unknown as Record<string, number>)[key] = Math.min(max, Math.max(min, value));
  }

  return out;
}

/** 品質判定の内訳。UI（回答直後の表示・管理画面）と監査のために理由を残す。 */
export interface QualityBreakdown {
  factor: number;
  /** 減点/加点の理由コード。UI 文言はコード→表示名で引く。 */
  reasons: QualityReasonCode[];
}

export type QualityReasonCode =
  | "too_fast"
  | "too_short"
  | "straightline"
  | "inconsistent"
  | "honest_bonus";

function collectAnswerValues(signals: AnswerQualitySignals): unknown[] {
  if (Array.isArray(signals.answers) && signals.answers.length > 0) {
    return signals.answers.map((a) => a.answerValue);
  }
  return [];
}

/** 選択式の値を比較可能な文字列に潰す（配列は結合）。 */
function normalizeChoice(value: unknown): string | null {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map((v) => normalizeChoice(v)).filter((v): v is string => v !== null);
    return parts.length > 0 ? parts.sort().join("|") : null;
  }
  return null;
}

/** 自由記述らしき値だけを拾う（選択式のコードは対象にしない）。 */
function collectFreeTexts(signals: AnswerQualitySignals): string[] {
  const out: string[] = [];
  if (typeof signals.text === "string" && signals.text.trim().length > 0) {
    out.push(signals.text.trim());
  }
  for (const value of collectAnswerValues(signals)) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    // 選択肢コード（英数字・アンダースコアだけの短い値）は自由記述として扱わない。
    if (trimmed.length === 0) continue;
    if (/^[a-z0-9_\-]+$/i.test(trimmed) && trimmed.length <= 24) continue;
    out.push(trimmed);
  }
  return out;
}

/**
 * 「意味を成さない」テキストの雑な検出。
 * 同一文字の連打・キーボード的な無意味文字列を弾く。誤検出を避けるため保守的に。
 */
function isGibberish(text: string): boolean {
  const t = text.trim();
  if (t.length === 0) return true;
  // 同じ文字の繰り返しだけ（「ああああ」「aaaa」「ーーー」）
  if (/^(.)\1*$/u.test(t)) return true;
  // 句読点・記号だけ
  if (/^[\s\p{P}\p{S}]+$/u.test(t)) return true;
  return false;
}

/**
 * 品質係数を算出する。違反ごとに中立 1.0 から減点し、無違反かつ整合性が高ければ加点。
 * シグナルが取れない場合は減点しない（＝計測漏れでユーザーが損をしない側に倒す）。
 */
export function computeQualityBreakdown(
  signals: AnswerQualitySignals,
  config: QualityScoringConfig = DEFAULT_QUALITY_CONFIG,
): QualityBreakdown {
  if (!config.enabled) return { factor: QUALITY_NEUTRAL, reasons: [] };

  const reasons: QualityReasonCode[] = [];
  let factor = QUALITY_NEUTRAL;

  const answerValues = collectAnswerValues(signals);
  const questionCount = Math.max(1, answerValues.length);

  // ① 速すぎる回答。timeSec が無い（未計測）なら判定しない。
  if (typeof signals.timeSec === "number" && Number.isFinite(signals.timeSec) && signals.timeSec >= 0) {
    if (signals.timeSec < config.minSecondsPerQuestion * questionCount) {
      factor -= config.penaltyTooFast;
      reasons.push("too_fast");
    }
  }

  // ② 自由記述が短すぎる / 意味を成さない。自由記述が無い回答は対象外。
  const texts = collectFreeTexts(signals);
  if (texts.length > 0) {
    const hasBadText = texts.some(
      (t) => t.length < config.minTextLength || isGibberish(t),
    );
    if (hasBadText) {
      factor -= config.penaltyTooShort;
      reasons.push("too_short");
    }
  }

  // ③ ストレートライン。選択式が 3 問以上あり、全て同じ選択のとき。
  if (config.detectStraightlining) {
    const choices = answerValues
      .map((v) => normalizeChoice(v))
      .filter((v): v is string => v !== null);
    if (choices.length >= 3 && new Set(choices).size === 1) {
      factor -= config.penaltyStraightline;
      reasons.push("straightline");
    }
  }

  // ④ 整合性（信頼スコア）。素材が無ければ判定しない。
  const consistency = signals.consistency;
  const hasConsistency = typeof consistency === "number" && Number.isFinite(consistency);
  if (hasConsistency && (consistency as number) < config.consistencyPenaltyThreshold) {
    factor -= config.penaltyInconsistent;
    reasons.push("inconsistent");
  }

  // ⑤ 誠実ボーナス。違反ゼロが前提。整合性の素材があるならそれも高いこと。
  const noViolation = reasons.length === 0;
  const consistencyOk = !hasConsistency || (consistency as number) >= config.consistencyBonusThreshold;
  if (noViolation && consistencyOk && config.bonusHonest > 0) {
    factor += config.bonusHonest;
    reasons.push("honest_bonus");
  }

  return { factor: clampQuality(factor), reasons };
}

/** 後方互換: 係数だけが欲しい呼び出し向け。 */
export function computeQualityFactor(
  signals: AnswerQualitySignals,
  config: QualityScoringConfig = DEFAULT_QUALITY_CONFIG,
): number {
  return computeQualityBreakdown(signals, config).factor;
}

/** 付与ポイントの算出結果。内訳を UI と監査に渡す。 */
export interface QualityWeightedResult {
  points: number;
  basePoints: number;
  factor: number;
  reasons: QualityReasonCode[];
  /** 満額（基準ポイント以上）を獲得したか。UI の「満額獲得」表示に使う。 */
  isFullAmount: boolean;
}

/**
 * 品質で重み付けした獲得ポイント。
 *   pt = clamp(round(base × factor), base - maxPenalty, base + maxBonus)
 * 低単価（minBaseForPenalty 未満）は常に満額＝ついでスワイプの真値性を守る。
 */
export function computeQualityWeightedAward(
  basePoints: number,
  signals: AnswerQualitySignals,
  config: QualityScoringConfig = DEFAULT_QUALITY_CONFIG,
): QualityWeightedResult {
  const base = Math.max(0, Math.round(basePoints));

  if (!config.enabled || base < config.minBaseForPenalty) {
    return { points: base, basePoints: base, factor: QUALITY_NEUTRAL, reasons: [], isFullAmount: true };
  }

  const { factor, reasons } = computeQualityBreakdown(signals, config);
  const raw = Math.round(base * factor);
  const floor = Math.max(0, base - Math.max(0, config.maxPenaltyPoints));
  const ceil = base + Math.max(0, config.maxBonusPoints);
  const points = Math.max(0, Math.min(ceil, Math.max(floor, raw)));

  return { points, basePoints: base, factor, reasons, isFullAmount: points >= base };
}

/**
 * 従来シグネチャ（ポイント数だけを返す）。既存呼び出し元の互換のために残す。
 */
export function qualityWeightedPoints(
  basePoints: number,
  signals: AnswerQualitySignals,
  config: QualityScoringConfig = DEFAULT_QUALITY_CONFIG,
): number {
  return computeQualityWeightedAward(basePoints, signals, config).points;
}
