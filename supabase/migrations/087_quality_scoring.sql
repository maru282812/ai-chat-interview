-- 087_quality_scoring.sql
-- 品質係数（quality-weighted ポイント）の永続化。
--
-- 出典: 品質ファースト・アンケート構想（2026-07-10）。「正直が最も得な報酬設計」。
-- 付与ポイントに品質係数を掛けるようになったので、
--   ①なぜその点数になったか（係数と理由）を明細に残す＝ユーザー問い合わせと監査に必要
--   ②回答所要時間を保存する＝「速すぎ」判定の材料であり、後から判定を作り直すためのログ
-- を足す。DB 側で計算はしない（判定はすべて src/lib/qualityScore.ts のサーバー権威）。
--
-- 既存行は NULL のまま＝「品質判定を通していない付与」を意味する。
-- NULL と 1.0 を区別できるようにするため、あえて DEFAULT を置かない。

-- 1. ポイント明細に品質の内訳を残す
ALTER TABLE point_histories
  ADD COLUMN IF NOT EXISTS quality_factor NUMERIC(4, 3),
  ADD COLUMN IF NOT EXISTS base_points    INTEGER,
  ADD COLUMN IF NOT EXISTS quality_reasons JSONB;

COMMENT ON COLUMN point_histories.quality_factor IS
  '適用した品質係数（0〜1.2）。NULL＝品質判定を通していない付与。';
COMMENT ON COLUMN point_histories.base_points IS
  '係数を掛ける前の基準ポイント。points との差が品質による増減。';
COMMENT ON COLUMN point_histories.quality_reasons IS
  '減点/加点の理由コード配列（too_fast / too_short / straightline / inconsistent / honest_bonus）。';

-- 減額が発生した付与を管理画面から追えるようにする（部分インデックス＝既存行を膨らませない）
CREATE INDEX IF NOT EXISTS idx_point_histories_quality
  ON point_histories(created_at DESC)
  WHERE quality_factor IS NOT NULL AND quality_factor < 1;

-- 2. デイリー回答の所要時間。「速すぎ」判定の材料。
--    クライアントから送られる自己申告値なので、判定は必ずサーバー側の閾値で行う。
ALTER TABLE daily_survey_deliveries
  ADD COLUMN IF NOT EXISTS answer_ms INTEGER;

COMMENT ON COLUMN daily_survey_deliveries.answer_ms IS
  '回答に要したミリ秒（クライアント計測）。NULL＝未計測。品質判定の材料。';

-- 3. 品質判定パラメータの初期値を app_settings に置く。
--    値は src/lib/qualityScore.ts の DEFAULT_QUALITY_CONFIG と一致させること。
--    行が無くてもコード既定で動くので、これは管理画面に初期表示を出すための種。
INSERT INTO app_settings (key, value)
VALUES (
  'quality_scoring',
  jsonb_build_object(
    'enabled',                     true,
    'minSecondsPerQuestion',       3,
    'minTextLength',               8,
    'detectStraightlining',        true,
    'penaltyTooFast',              0.3,
    'penaltyTooShort',             0.25,
    'penaltyStraightline',         0.2,
    'penaltyInconsistent',         0.25,
    'bonusHonest',                 0.1,
    'consistencyBonusThreshold',   0.8,
    'consistencyPenaltyThreshold', 0.4,
    'maxPenaltyPoints',            30,
    'maxBonusPoints',              20,
    'minBaseForPenalty',           5
  )
)
ON CONFLICT (key) DO NOTHING;
