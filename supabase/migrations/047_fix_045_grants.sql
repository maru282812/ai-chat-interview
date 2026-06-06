-- ============================================================
-- 047: Migration 045 で欠落していた GRANT / RLS 設定を修正
-- documents / document_versions / user_consent_records /
-- project_document_requirements に権限付与
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'documents',
    'document_versions',
    'user_consent_records',
    'project_document_requirements'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = tbl
    ) THEN
      -- 権限付与
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
  END LOOP;
END $$;
