-- ============================================================
-- 038: Migration 022/023 で欠落していた GRANT を修正
-- attribute_definitions / user_attributes / user_attribute_history /
-- behavior_logs / user_consent / segments / delivery_campaigns (022) +
-- ng_words / post_categories / campaign_assignment_map (023) に権限付与
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'attribute_definitions',
    'user_attributes',
    'user_attribute_history',
    'behavior_logs',
    'user_consent',
    'segments',
    'delivery_campaigns',
    'ng_words',
    'post_categories',
    'campaign_assignment_map'
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
