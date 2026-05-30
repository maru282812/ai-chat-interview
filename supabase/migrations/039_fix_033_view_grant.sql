-- ============================================================
-- 039: Migration 033 で欠落していた GRANT を修正
-- v_user_point_summary ビューへ SELECT 権限を付与
-- ============================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'v_user_point_summary'
  ) THEN
    GRANT SELECT ON v_user_point_summary TO service_role, authenticated, anon;
  END IF;
END $$;
