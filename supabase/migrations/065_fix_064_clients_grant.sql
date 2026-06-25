-- ============================================================
-- 065: Migration 064 で欠落していた clients テーブルの GRANT を修正
-- アプリは SUPABASE_SERVICE_ROLE_KEY（= service_role ロール）で接続するため、
-- service_role への権限付与が無いと「permission denied for table clients」になる。
-- 064 は anon/authenticated にしか付与していなかったため本マイグレーションで補う。
-- （047_fix_045_grants.sql と同じ冪等パターン）
-- ============================================================

DO $$
DECLARE
  tbl TEXT := 'clients';
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = tbl
  ) THEN
    -- 権限付与（service_role を含める）
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO service_role, authenticated, anon',
      tbl
    );

    -- RLS 有効化
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

    -- service_role バイパスポリシー（未作成の場合のみ）
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = tbl
        AND policyname = 'service_role_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY "service_role_all" ON %I AS PERMISSIVE FOR ALL TO service_role USING (true) WITH CHECK (true)',
        tbl
      );
    END IF;
  END IF;
END $$;
