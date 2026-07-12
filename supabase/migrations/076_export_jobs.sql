-- 076_export_jobs.sql
-- 統計エクスポートの監査ログ（改修指示_集計アプリ連携 指示④）。
-- 誰が・いつ・どのプロジェクトの・何を・どのフィルタで出力したかを記録する。
--
-- 注意: 本番には 2026-07-11 に適用済み（_app_migrations に記録あり）。
-- このファイルはコード消失後の復旧再作成（本番DDLと一致・冪等）。
-- RLS/GRANT の最終状態は 077 参照（適用当初 anon/authenticated に GRANT していた不備を 077 で是正）。

CREATE TABLE IF NOT EXISTS export_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  export_type text NOT NULL,
  filters_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  exported_by text,
  exported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_export_jobs_project_exported
  ON export_jobs (project_id, exported_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON export_jobs TO service_role;
