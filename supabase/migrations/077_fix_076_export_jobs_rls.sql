-- 077_fix_076_export_jobs_rls.sql
-- 076 適用当初、export_jobs へ anon/authenticated にも GRANT され RLS も未有効だったため、
-- anon キーで監査ログの読取・偽挿入が可能だった不備の是正（2026-07-11 本番適用・pg_policies 検証済）。
-- 以後の新テーブルは 053/066 の型（service_role のみ or RLS+service_role ポリシー）に従うこと。

REVOKE ALL ON export_jobs FROM anon, authenticated;

ALTER TABLE export_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON export_jobs;
CREATE POLICY service_role_all ON export_jobs
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
