-- ============================================================
-- Migration 050: ポイント交換基盤
--
-- 変更内容:
--   1. user_points に pending_points カラム追加
--   2. point_histories に idempotency_key カラム追加（二重付与防止）
--   3. point_histories の transaction_type / reference_type CHECK 拡張
--   4. v_user_point_summary ビューを pending_points 対応で更新
--   5. sync_user_points_on_history トリガーを pending_points 対応に更新
-- ============================================================

-- ============================================================
-- 1. user_points — pending_points カラム追加
--    申請中でユーザーが使えないポイントを分離して管理
-- ============================================================
ALTER TABLE user_points
  ADD COLUMN IF NOT EXISTS pending_points INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 2. point_histories — idempotency_key カラム追加
--    同一 session + transaction_type の二重付与を防止
-- ============================================================
ALTER TABLE point_histories
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_point_histories_idempotency
  ON point_histories(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

-- ============================================================
-- 3. transaction_type CHECK 拡張
--    交換フロー用の 3 種別を追加
-- ============================================================
ALTER TABLE point_histories
  DROP CONSTRAINT IF EXISTS point_histories_transaction_type_check;

ALTER TABLE point_histories
  ADD CONSTRAINT point_histories_transaction_type_check
  CHECK (transaction_type IN (
    'daily_survey',
    'interview_complete',
    'project_completion',
    'streak_bonus',
    'birthday_bonus',
    'campaign_bonus',
    'attribute_update',
    'first_bonus',
    'continuity_bonus',
    'project_bonus',
    'manual_adjustment',
    'redemption',
    'exchange_request',   -- 交換申請（available から pending へ）
    'exchange_cancel',    -- 申請キャンセル（pending を available に戻す）
    'exchange_refund'     -- 却下による返還（pending を available に戻す）
  ));

-- ============================================================
-- 4. reference_type CHECK 拡張
-- ============================================================
ALTER TABLE point_histories
  DROP CONSTRAINT IF EXISTS point_histories_reference_type_check;

ALTER TABLE point_histories
  ADD CONSTRAINT point_histories_reference_type_check
  CHECK (reference_type IN (
    'daily_survey_answer',
    'project_assignment',
    'campaign',
    'session',
    'manual',
    'exchange_request'
  ));

-- ============================================================
-- 5. sync_user_points_on_history トリガー関数更新
--    exchange_request / exchange_cancel / exchange_refund を
--    available_points / pending_points に正しく反映する
--
--    通常付与（正値）:
--      total_points   += points
--      available_points += points
--      lifetime_points += points
--
--    exchange_request（available → pending、points は負値として記録）:
--      available_points += points  （減算）
--      pending_points   -= points  （増算：負値なのでマイナスのマイナス）
--
--    exchange_cancel / exchange_refund（pending → available、正値として記録）:
--      available_points += points  （増算）
--      pending_points   -= points  （減算）
--      ※ total_points / lifetime_points は変更しない
-- ============================================================
CREATE OR REPLACE FUNCTION sync_user_points_on_history()
RETURNS TRIGGER AS $$
BEGIN
  -- 交換申請: available → pending へ移動（points は負値）
  IF NEW.transaction_type = 'exchange_request' THEN
    INSERT INTO user_points (line_user_id, total_points, available_points, pending_points, lifetime_points, updated_at)
    VALUES (
      NEW.line_user_id,
      0,
      GREATEST(0, NEW.points),
      GREATEST(0, -NEW.points),
      0,
      now()
    )
    ON CONFLICT (line_user_id) DO UPDATE SET
      available_points = GREATEST(0, user_points.available_points + NEW.points),
      pending_points   = GREATEST(0, user_points.pending_points   - NEW.points),
      updated_at       = now();

  -- 申請キャンセル / 却下返還: pending → available へ戻す（points は正値）
  ELSIF NEW.transaction_type IN ('exchange_cancel', 'exchange_refund') THEN
    INSERT INTO user_points (line_user_id, total_points, available_points, pending_points, lifetime_points, updated_at)
    VALUES (
      NEW.line_user_id,
      0,
      GREATEST(0, NEW.points),
      0,
      0,
      now()
    )
    ON CONFLICT (line_user_id) DO UPDATE SET
      available_points = GREATEST(0, user_points.available_points + NEW.points),
      pending_points   = GREATEST(0, user_points.pending_points   - NEW.points),
      updated_at       = now();

  -- 通常付与 / 調整（正負どちらも total / available に反映）
  ELSE
    INSERT INTO user_points (line_user_id, total_points, available_points, pending_points, lifetime_points, updated_at)
    VALUES (
      NEW.line_user_id,
      GREATEST(0, NEW.points),
      GREATEST(0, NEW.points),
      0,
      GREATEST(0, NEW.points),
      now()
    )
    ON CONFLICT (line_user_id) DO UPDATE SET
      total_points     = GREATEST(0, user_points.total_points     + NEW.points),
      available_points = GREATEST(0, user_points.available_points + NEW.points),
      lifetime_points  = user_points.lifetime_points + GREATEST(0, NEW.points),
      updated_at       = now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_point_histories_sync ON point_histories;
CREATE TRIGGER trg_point_histories_sync
  AFTER INSERT ON point_histories
  FOR EACH ROW EXECUTE FUNCTION sync_user_points_on_history();

-- ============================================================
-- 6. v_user_point_summary ビュー更新（pending_points 追加）
--    CREATE OR REPLACE では列の追加・順序変更が不可のため DROP して再作成
-- ============================================================
DROP VIEW IF EXISTS v_user_point_summary;
CREATE VIEW v_user_point_summary AS
SELECT
  up.line_user_id,
  up.nickname                            AS display_name,
  COALESCE(upt.total_points,     0)      AS total_points,
  COALESCE(upt.available_points, 0)      AS available_points,
  COALESCE(upt.pending_points,   0)      AS pending_points,
  COALESCE(upt.lifetime_points,  0)      AS lifetime_points,
  r.rank_code,
  r.rank_name,
  r.badge_label                          AS rank_badge,
  COALESCE(us.current_streak,  0)        AS current_streak,
  COALESCE(us.longest_streak,  0)        AS longest_streak,
  COALESCE(us.total_answer_days, 0)      AS total_answer_days,
  us.last_answered_date,
  upt.updated_at                         AS points_updated_at
FROM user_profiles up
LEFT JOIN user_points  upt ON upt.line_user_id = up.line_user_id
LEFT JOIN user_ranks   ur  ON ur.line_user_id  = up.line_user_id
LEFT JOIN ranks        r   ON r.id             = ur.rank_id
LEFT JOIN user_streaks us  ON us.line_user_id  = up.line_user_id;

GRANT SELECT ON v_user_point_summary TO service_role, authenticated, anon;

-- ============================================================
-- GRANT
-- ============================================================
GRANT SELECT, INSERT, UPDATE ON user_points TO service_role, authenticated;
