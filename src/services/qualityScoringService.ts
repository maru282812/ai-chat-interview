import { supabase } from "../config/supabase";
import { throwIfError } from "../repositories/baseRepository";
import {
  QUALITY_SCORING_KEY,
  appSettingsRepository,
} from "../repositories/appSettingsRepository";
import { poolQuestionRepository } from "../repositories/poolQuestionRepository";
import {
  DEFAULT_QUALITY_CONFIG,
  computeQualityWeightedAward,
  resolveQualityConfig,
  type AnswerQualitySignals,
  type QualityScoringConfig,
  type QualityWeightedResult,
} from "../lib/qualityScore";
import { computeTrustScore } from "../lib/trustScore";
import { logger } from "../lib/logger";

/**
 * qualityScoringService — 品質係数の付与時解決（サーバー権威）
 *
 * 出典: 品質ファースト・アンケート構想（2026-07-10）。「正直が最も得な報酬設計」。
 *
 * 責務:
 *   1. 判定パラメータを app_settings('quality_scoring') から解決する（未設定はコード既定）
 *   2. 整合性スコア（ついでスワイプとの突合）を必要なときだけ引く
 *   3. 純関数 computeQualityWeightedAward に渡して付与ポイントを決める
 *
 * 設計上の約束:
 *   - **判定に失敗したら満額**。設定の読み取り失敗・整合性の集計失敗でユーザーの
 *     ポイントを削らない（品質判定は付与を減らす方向にしか働かないので、
 *     こちらの不具合でユーザーが損をするのは許容しない）。
 *   - キャッシュは experienceService と同じ 60 秒のベストエフォート。
 */

/** 品質判定を通した付与 1 件（管理画面の確認用）。 */
export interface QualityAwardRow {
  id: string;
  line_user_id: string;
  transaction_type: string;
  points: number;
  base_points: number | null;
  quality_factor: number | null;
  quality_reasons: string[] | null;
  reason: string;
  created_at: string;
}

/** 効き具合のサマリ。閾値を変えたあと必ずこれを見る。 */
export interface QualityAwardSummary {
  total: number;
  reduced: number;
  bonused: number;
  fullAmount: number;
  reducedRate: number;
  reasonCounts: Record<string, number>;
}

const CACHE_TTL_MS = 60_000;

let cachedRaw: Record<string, unknown> | null = null;
let cachedAt = 0;

function isCacheFresh(): boolean {
  return cachedRaw !== null && Date.now() - cachedAt < CACHE_TTL_MS;
}

/** 管理画面の保存直後に呼ぶ。 */
function invalidateCache(): void {
  cachedRaw = null;
  cachedAt = 0;
}

async function loadRaw(): Promise<Record<string, unknown>> {
  if (isCacheFresh()) return cachedRaw as Record<string, unknown>;
  const raw = (await appSettingsRepository.get(QUALITY_SCORING_KEY)) ?? {};
  cachedRaw = raw;
  cachedAt = Date.now();
  return raw;
}

export const qualityScoringService = {
  invalidateCache,

  /** 判定パラメータ。読み取り失敗はコード既定に落とす（付与を止めない）。 */
  async getConfig(): Promise<QualityScoringConfig> {
    try {
      return resolveQualityConfig(await loadRaw());
    } catch (e) {
      logger.warn("qualityScoring.config.fallback", { error: String(e) });
      return { ...DEFAULT_QUALITY_CONFIG };
    }
  },

  /** 管理画面の保存。丸ごと置き換え＋キャッシュ破棄。 */
  async saveConfig(config: QualityScoringConfig): Promise<void> {
    const safe = resolveQualityConfig(config as unknown);
    await appSettingsRepository.upsert(
      QUALITY_SCORING_KEY,
      safe as unknown as Record<string, unknown>,
    );
    invalidateCache();
  },

  /**
   * 整合性スコア（0〜1）。素材不足・失敗は null（＝判定に使わない＝減点しない）。
   * ついでスワイプの回答が素材。構想の核である「平常時≒真値との突合」の簡易版。
   */
  async getConsistency(lineUserId: string): Promise<number | null> {
    try {
      const rows = await poolQuestionRepository.listTrustSamples(lineUserId);
      const result = computeTrustScore(
        rows.map((r) => ({
          questionId: r.question_id,
          answerValue: r.answer_value,
          answerMs: r.answer_ms,
          answeredAt: r.answered_at,
        })),
        Date.now(),
      );
      return result.score;
    } catch (e) {
      logger.warn("qualityScoring.consistency.skip", { lineUserId, error: String(e) });
      return null;
    }
  },

  /**
   * 品質判定を通した直近の付与（管理画面の確認用）。
   * quality_factor が NULL の行＝判定を通していない付与は除く。
   */
  async listRecentAwards(limit = 200): Promise<QualityAwardRow[]> {
    const { data, error } = await supabase
      .from("point_histories")
      .select(
        "id, line_user_id, transaction_type, points, base_points, quality_factor, quality_reasons, reason, created_at",
      )
      .not("quality_factor", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
    throwIfError(error);
    return (data ?? []) as QualityAwardRow[];
  },

  /** 効き具合のサマリ。減額が多すぎないかを見るための集計。 */
  summarizeAwards(rows: QualityAwardRow[]): QualityAwardSummary {
    const reasonCounts: Record<string, number> = {};
    let reduced = 0;
    let bonused = 0;

    for (const row of rows) {
      const base = row.base_points;
      if (typeof base === "number") {
        if (row.points < base) reduced += 1;
        else if (row.points > base) bonused += 1;
      }
      for (const code of row.quality_reasons ?? []) {
        reasonCounts[code] = (reasonCounts[code] ?? 0) + 1;
      }
    }

    const total = rows.length;
    return {
      total,
      reduced,
      bonused,
      fullAmount: total - reduced,
      reducedRate: total > 0 ? reduced / total : 0,
      reasonCounts,
    };
  },

  /**
   * 回答者に見せる「誠実度」。5 段階に丸めた粗い指標だけを返す。
   *
   * 構想では **判定の詳細は回答者へ非公開が原則**（式や閾値が見えると対策され、
   * ついでスワイプの「平常時≒真値」という前提が壊れる）。一方で
   * 「ちゃんと答えるほど得」を実感させるには手応えが要る。
   * その折衷として、生の係数や理由コードは出さず星の数だけを返す。
   *
   * 素材不足（判定できない）は null＝画面側は何も出さない。
   */
  async getHonestyDisplay(lineUserId: string): Promise<{ stars: number; label: string } | null> {
    const consistency = await this.getConsistency(lineUserId);
    if (consistency === null) return null;

    // 0.4 未満＝減点閾値。0.8 以上＝ボーナス閾値。境界を跨いだことだけが伝わればよい。
    if (consistency >= 0.9) return { stars: 5, label: "とても安定しています" };
    if (consistency >= 0.8) return { stars: 4, label: "安定しています" };
    if (consistency >= 0.6) return { stars: 3, label: "おおむね安定しています" };
    if (consistency >= 0.4) return { stars: 2, label: "ばらつきがあります" };
    return { stars: 1, label: "回答がばらついています" };
  },

  /**
   * 付与ポイントを品質で重み付けして返す。付与経路（daily / pool / 案件本編）の共通入口。
   *
   * @param lineUserId 整合性スコアを引く対象。null なら整合性は判定に使わない。
   */
  async resolveAward(input: {
    basePoints: number;
    lineUserId: string | null;
    signals: AnswerQualitySignals;
  }): Promise<QualityWeightedResult> {
    const config = await this.getConfig();

    // 判定が無効、または低単価で常に満額になるケースは整合性を引かない（無駄なクエリを避ける）。
    const base = Math.max(0, Math.round(input.basePoints));
    if (!config.enabled || base < config.minBaseForPenalty) {
      return computeQualityWeightedAward(input.basePoints, input.signals, config);
    }

    const consistency = input.lineUserId
      ? await this.getConsistency(input.lineUserId)
      : null;

    return computeQualityWeightedAward(
      input.basePoints,
      { ...input.signals, consistency },
      config,
    );
  },
};
