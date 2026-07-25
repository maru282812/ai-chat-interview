/**
 * trustScore.ts — ついでスワイプを素材にした整合性スコア（信頼スコア簡易版）の純関数
 *
 * 出典: 品質ファースト・アンケート構想（2026-07-10）。核は
 * **「デイリースワイプ（低ステークス＝平常時≒真値）と本アンケート（報酬が掛かる）の整合性」**。
 * ついでスワイプ（docs/spec-pool-swipe-questions.md）が低報酬 +1pt で真値性を担保しているのは
 * このためで、素材は pool_question_answers に既に貯まっている。
 *
 * ## 本実装のスコープ（簡易版）
 * 構想の完全版は二層（トピック別＋総合）・指数減衰・個人ベースライン・方向性判定を含むが、
 * ここでは集計基盤を増やさずに出せる 2 つだけを見る:
 *   (a) test-retest 一致率 … reask_after_days による同一設問の再出題で答えがブレていないか
 *   (b) 即答すぎ率      … answer_ms が異常に短い回答の割合
 * 指数減衰（半減期）は入れる。古い素材ほど効かなくする＝嗜好の変化を矛盾と誤認しない。
 *
 * ## 設計上の約束
 * - **素材が少なければ判定しない**（null を返す）。新規ユーザーが不利にならない側に倒す。
 * - 個人ベースライン・方向性判定は未実装。よって「答えが変わった＝即減点」ではなく、
 *   一致率という緩い指標に留める（嘘と嗜好変化を区別できないうちは強く減点しない）。
 */

/** 判定に使う 1 回分の素材。DB 行から必要な列だけを写したもの。 */
export interface TrustSample {
  questionId: string;
  /** 回答値。再出題時の一致判定に使う。 */
  answerValue: unknown;
  /** 回答に要したミリ秒。null＝未計測。 */
  answerMs: number | null;
  /** 回答日時（ISO）。減衰の計算に使う。 */
  answeredAt: string;
}

export interface TrustScoreConfig {
  /** 減衰の半減期（日）。構想の仮値は 90 日。 */
  halfLifeDays: number;
  /** これ未満の素材数ならスコアを出さない（null）。 */
  minSamples: number;
  /** これ未満のミリ秒は「即答すぎ」。 */
  instantAnswerMs: number;
  /** test-retest 一致率の重み。 */
  retestWeight: number;
  /** 即答すぎ率の重み。 */
  speedWeight: number;
}

export const DEFAULT_TRUST_CONFIG: TrustScoreConfig = {
  halfLifeDays: 90,
  minSamples: 5,
  instantAnswerMs: 800,
  retestWeight: 0.7,
  speedWeight: 0.3,
};

export interface TrustScoreResult {
  /** 0〜1 の整合性スコア。素材不足なら null。 */
  score: number | null;
  /** 判定に使った素材数（減衰前の実数）。 */
  sampleCount: number;
  /** 再出題ペアの数。0 なら test-retest は判定材料に入っていない。 */
  retestPairs: number;
  /** 即答すぎと判定された回答の割合（0〜1）。素材が無ければ null。 */
  instantRate: number | null;
}

/** 選択値を比較可能な文字列に潰す。 */
function normalize(value: unknown): string | null {
  if (typeof value === "string") return value.trim().toLowerCase();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(normalize).filter((v): v is string => v !== null);
    return parts.length > 0 ? parts.sort().join("|") : null;
  }
  if (value !== null && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    // { value: "a" } / { values: [...] } のような包み方に対応する
    if ("value" in rec) return normalize(rec.value);
    if ("values" in rec) return normalize(rec.values);
  }
  return null;
}

/**
 * 減衰後に残った証拠の重み（totalWeight）を 0〜1 の「判定の強さ」に変える。
 * 比（一致率・即答率）は分子分母で減衰が相殺するため、これを掛けて中立側へ引き戻す。
 * 重みが 1 件ぶん（=1.0）で約 0.5、増えるほど 1 に漸近する。
 */
function evidenceStrength(totalWeight: number): number {
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return 0;
  return totalWeight / (totalWeight + 1);
}

/** 指数減衰の重み。now から d 日前の素材の効き目。 */
function decayWeight(answeredAt: string, nowMs: number, halfLifeDays: number): number {
  const t = Date.parse(answeredAt);
  if (!Number.isFinite(t)) return 1;
  const ageDays = Math.max(0, (nowMs - t) / 86_400_000);
  if (halfLifeDays <= 0) return 1;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * 整合性スコアを算出する。
 *
 * @param samples ついでスワイプの回答（新しい順・古い順どちらでもよい）
 * @param nowMs   現在時刻（テスト可能にするため注入する）
 */
export function computeTrustScore(
  samples: TrustSample[],
  nowMs: number,
  config: TrustScoreConfig = DEFAULT_TRUST_CONFIG,
): TrustScoreResult {
  const list = Array.isArray(samples) ? samples : [];
  const sampleCount = list.length;

  if (sampleCount < config.minSamples) {
    return { score: null, sampleCount, retestPairs: 0, instantRate: null };
  }

  // --- (a) test-retest 一致率 ---
  // 同一 questionId が複数回あるものを再出題ペアとして扱う（時系列で隣接する2件を比較）。
  const byQuestion = new Map<string, TrustSample[]>();
  for (const s of list) {
    const arr = byQuestion.get(s.questionId);
    if (arr) arr.push(s);
    else byQuestion.set(s.questionId, [s]);
  }

  let agreeWeight = 0;
  let pairWeight = 0;
  let retestPairs = 0;
  for (const group of byQuestion.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => Date.parse(a.answeredAt) - Date.parse(b.answeredAt));
    for (let i = 1; i < sorted.length; i += 1) {
      const before = sorted[i - 1];
      const after = sorted[i];
      if (!before || !after) continue;
      const prev = normalize(before.answerValue);
      const curr = normalize(after.answerValue);
      if (prev === null || curr === null) continue;
      // 新しい方の日時で減衰させる（古いペアほど効き目を落とす）
      const w = decayWeight(after.answeredAt, nowMs, config.halfLifeDays);
      pairWeight += w;
      if (prev === curr) agreeWeight += w;
      retestPairs += 1;
    }
  }
  // 一致率そのものは比なので、減衰の重みが分子分母で相殺してしまう
  // （400日前の1回のブレが、昨日の1回と同じ打撃になる）。
  // そこで「減衰後にどれだけ証拠が残っているか」で中立(1.0)側へ引き戻す。
  // 素材が古い/薄いほど判定を弱める＝嗜好の変化を矛盾と決めつけない。
  const retestScore =
    pairWeight > 0
      ? 1 - (1 - agreeWeight / pairWeight) * evidenceStrength(pairWeight)
      : null;

  // --- (b) 即答すぎ率 ---
  let instantWeight = 0;
  let timedWeight = 0;
  for (const s of list) {
    if (typeof s.answerMs !== "number" || !Number.isFinite(s.answerMs) || s.answerMs < 0) continue;
    const w = decayWeight(s.answeredAt, nowMs, config.halfLifeDays);
    timedWeight += w;
    if (s.answerMs < config.instantAnswerMs) instantWeight += w;
  }
  const instantRate = timedWeight > 0 ? instantWeight / timedWeight : null;
  // 一致率と同じ理由で、残った証拠の重みで中立側へ引き戻す。
  const speedScore =
    instantRate === null ? null : 1 - instantRate * evidenceStrength(timedWeight);

  // --- 合成。取れた指標だけを重み付き平均する ---
  const parts: Array<{ value: number; weight: number }> = [];
  if (retestScore !== null) parts.push({ value: retestScore, weight: config.retestWeight });
  if (speedScore !== null) parts.push({ value: speedScore, weight: config.speedWeight });

  if (parts.length === 0) {
    return { score: null, sampleCount, retestPairs, instantRate };
  }

  const totalWeight = parts.reduce((sum, p) => sum + p.weight, 0);
  const score = totalWeight > 0
    ? parts.reduce((sum, p) => sum + p.value * p.weight, 0) / totalWeight
    : null;

  return {
    score: score === null ? null : Math.min(1, Math.max(0, score)),
    sampleCount,
    retestPairs,
    instantRate,
  };
}
