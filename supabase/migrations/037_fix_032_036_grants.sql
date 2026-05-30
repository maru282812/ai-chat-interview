-- ============================================================
-- 037: Migration 032/036 で欠落していた GRANT を修正
-- daily_surveys / notification_templates など 032 の全テーブル +
-- notification_scheduler_settings (036) に権限付与
-- ============================================================

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'user_points',
    'point_histories',
    'user_ranks',
    'user_badges',
    'user_badge_awards',
    'user_streaks',
    'daily_surveys',
    'daily_survey_questions',
    'daily_survey_deliveries',
    'daily_survey_answers',
    'notification_templates',
    'notification_logs',
    'daily_question_priorities',
    'reward_campaigns',
    'notification_scheduler_settings'
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
