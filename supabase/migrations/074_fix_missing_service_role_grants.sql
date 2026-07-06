-- 074_fix_missing_service_role_grants.sql
-- 系統的バグの一括是正: マイグレーションで作成した一部テーブルに service_role の
-- GRANT が欠落しており、「permission denied for table ...」で機能が落ちる／サイレントに
-- 劣化する問題を解消する。（029/037/038/047/065/066/073 と同じ根本原因）
--
-- 本アプリは SUPABASE_SERVICE_ROLE_KEY（= service_role ロール）でのみ接続する。
-- service_role は RLS をバイパスするが、テーブルレベルの GRANT は別途必要。
-- 個別修正の取りこぼしを無くすため、public スキーマの全基底テーブルへ冪等に付与する。
--
-- 付与漏れが確認されていた例（診断時 2026-07-06）:
--   ai_usage_logs / contact_messages / delivery_logs / delivery_templates /
--   diary_topic_master / emotion_tag_master / feature_flags / one_line_prompt_master /
--   rant_tags / rant_post_tags /
--   point_exchange_audit_logs(UD欠落) / point_exchange_requests(D欠落) /
--   project_prompt_package_change_logs(UD欠落)
--
-- 注意: anon / authenticated には付与しない。監査ログ・交換申請など、意図的に
--       権限を絞っているテーブルのセキュリティ設計を崩さないため。

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOR tbl IN
    SELECT tablename
    FROM pg_catalog.pg_tables
    WHERE schemaname = 'public'
      AND tablename <> '_app_migrations'
  LOOP
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      tbl
    );
  END LOOP;
END $$;

-- 今後 public に作られるテーブルにも自動で付与されるよう、既定権限も設定する。
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO service_role;
