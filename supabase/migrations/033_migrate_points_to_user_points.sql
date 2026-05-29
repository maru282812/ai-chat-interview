-- ============================================================
-- Migration 033: 既存ポイント・ランクデータを user_points / user_ranks へ移行
--
-- 移行対象:
--   respondents.total_points       → user_points (line_user_id で集計)
--   respondents.current_rank_id    → user_ranks
--   point_transactions             → point_histories
--   respondent_rank_histories は参照用として残す（削除しない）
--
-- 方針:
--   同一 line_user_id が複数 respondent を持つ場合は合計値で集計
--   既存 point_transactions は transaction_type をマッピングして移行
-- ============================================================

-- ============================================================
-- Step 1: user_points バックフィル
--   respondents の total_points を line_user_id 単位で合計
--   user_profiles に存在するユーザーのみ対象
-- ============================================================
INSERT INTO user_points (line_user_id, total_points, available_points, lifetime_points, updated_at)
SELECT
  r.line_user_id,
  SUM(r.total_points)  AS total_points,
  SUM(r.total_points)  AS available_points,
  SUM(r.total_points)  AS lifetime_points,
  MAX(r.updated_at)    AS updated_at
FROM respondents r
INNER JOIN user_profiles up ON up.line_user_id = r.line_user_id
GROUP BY r.line_user_id
ON CONFLICT (line_user_id) DO UPDATE SET
  total_points     = EXCLUDED.total_points,
  available_points = EXCLUDED.available_points,
  lifetime_points  = EXCLUDED.lifetime_points,
  updated_at       = EXCLUDED.updated_at;

-- ============================================================
-- Step 2: user_ranks バックフィル
--   同一 line_user_id の最新ランク（最もポイントが多い respondent）を採用
-- ============================================================
INSERT INTO user_ranks (line_user_id, rank_id, updated_at)
SELECT DISTINCT ON (r.line_user_id)
  r.line_user_id,
  r.current_rank_id  AS rank_id,
  r.updated_at
FROM respondents r
INNER JOIN user_profiles up ON up.line_user_id = r.line_user_id
WHERE r.current_rank_id IS NOT NULL
ORDER BY r.line_user_id, r.total_points DESC
ON CONFLICT (line_user_id) DO UPDATE SET
  rank_id    = EXCLUDED.rank_id,
  updated_at = EXCLUDED.updated_at;

-- ============================================================
-- Step 3: point_histories バックフィル
--   point_transactions を respondents 経由で line_user_id に紐付けて移行
--   user_profiles に存在するユーザーのみ対象
-- ============================================================
INSERT INTO point_histories (
  id,
  line_user_id,
  transaction_type,
  points,
  reason,
  reference_type,
  reference_id,
  created_at
)
SELECT
  pt.id,
  r.line_user_id,
  -- transaction_type マッピング
  CASE pt.transaction_type
    WHEN 'project_completion' THEN 'project_completion'
    WHEN 'first_bonus'        THEN 'first_bonus'
    WHEN 'continuity_bonus'   THEN 'continuity_bonus'
    WHEN 'project_bonus'      THEN 'project_bonus'
    WHEN 'manual_adjustment'  THEN 'manual_adjustment'
    ELSE 'manual_adjustment'
  END  AS transaction_type,
  pt.points,
  pt.reason,
  CASE
    WHEN pt.session_id IS NOT NULL  THEN 'session'
    WHEN pt.project_id IS NOT NULL  THEN 'project_assignment'
    ELSE 'manual'
  END  AS reference_type,
  COALESCE(pt.session_id, pt.project_id) AS reference_id,
  pt.created_at
FROM point_transactions pt
INNER JOIN respondents r ON r.id = pt.respondent_id
INNER JOIN user_profiles up ON up.line_user_id = r.line_user_id
ON CONFLICT DO NOTHING;

-- ============================================================
-- Step 4: user_streaks 初期化
--   全 user_profiles にストリーク行を作成（ゼロスタート）
-- ============================================================
INSERT INTO user_streaks (line_user_id, current_streak, longest_streak, total_answer_days)
SELECT line_user_id, 0, 0, 0
FROM user_profiles
ON CONFLICT (line_user_id) DO NOTHING;

-- ============================================================
-- Step 5: user_points 初期化（user_profiles にいてまだ行がない場合）
-- ============================================================
INSERT INTO user_points (line_user_id, total_points, available_points, lifetime_points)
SELECT line_user_id, 0, 0, 0
FROM user_profiles
ON CONFLICT (line_user_id) DO NOTHING;

-- ============================================================
-- Step 6: user_ranks 初期化（ランク未設定のユーザーはブロンズ）
-- ============================================================
INSERT INTO user_ranks (line_user_id, rank_id)
SELECT
  up.line_user_id,
  r.id AS rank_id
FROM user_profiles up
CROSS JOIN ranks r
WHERE r.rank_code = 'bronze'
ON CONFLICT (line_user_id) DO NOTHING;

-- ============================================================
-- ビュー: v_user_point_summary
-- ユーザーごとのポイント・ランク・ストリーク統合ビュー
-- ============================================================
CREATE OR REPLACE VIEW v_user_point_summary AS
SELECT
  up.line_user_id,
  up.nickname AS display_name,
  COALESCE(upt.total_points, 0)      AS total_points,
  COALESCE(upt.available_points, 0)  AS available_points,
  COALESCE(upt.lifetime_points, 0)   AS lifetime_points,
  r.rank_code,
  r.rank_name,
  r.badge_label                      AS rank_badge,
  COALESCE(us.current_streak, 0)     AS current_streak,
  COALESCE(us.longest_streak, 0)     AS longest_streak,
  COALESCE(us.total_answer_days, 0)  AS total_answer_days,
  us.last_answered_date,
  upt.updated_at                     AS points_updated_at
FROM user_profiles up
LEFT JOIN user_points upt ON upt.line_user_id = up.line_user_id
LEFT JOIN user_ranks ur   ON ur.line_user_id  = up.line_user_id
LEFT JOIN ranks r         ON r.id             = ur.rank_id
LEFT JOIN user_streaks us ON us.line_user_id  = up.line_user_id;
