-- ============================================================
-- 066: Vercel Cron ディスパッチャ用の発火履歴テーブル
-- Vercel のサーバーレス環境では node-cron が常駐できないため、
-- Vercel Cron Jobs が毎分 /api/cron/dispatch を叩き、その中で
-- 「今が発火時刻のジョブ」だけを実行する（ディスパッチャ方式）。
-- このテーブルは各ジョブの最終発火時刻を保持し、
--   - 日次/週次ジョブの「当日二重実行」防止
--   - interval ジョブの「前回からの経過時間」判定
-- に使う。
-- job_key の例: 'survey_morning' / 'survey_evening' / 'survey_reminder'
--               / 'template:<delivery_templates.id>'
-- ============================================================

CREATE TABLE IF NOT EXISTS public.cron_dispatch_runs (
  id        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  job_key   text        NOT NULL,
  fired_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cron_dispatch_runs_job_fired
  ON public.cron_dispatch_runs (job_key, fired_at DESC);

-- アプリは SUPABASE_SERVICE_ROLE_KEY（= service_role ロール）で接続するため、
-- service_role への GRANT が無いと permission denied になる（065 と同じ理由）。
DO $$
DECLARE
  tbl TEXT := 'cron_dispatch_runs';
BEGIN
  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO service_role, authenticated, anon',
    tbl
  );

  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);

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
END $$;
