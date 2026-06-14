-- ============================================================
-- 055: プロジェクト AIプロンプトパッケージ変更履歴ログ
-- 目的: プロジェクトに設定されているAIプロンプトパッケージ・バージョンの
--       変更履歴を残す監査ログテーブル
-- 設計方針:
--   - FKなし・スナップショット方式（パッケージ削除後も履歴を保持）
--   - changed_by は将来の管理者認証導入時に活用
-- ============================================================

CREATE TABLE IF NOT EXISTS project_prompt_package_change_logs (
  id                              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id                      uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  old_prompt_package_version_id   uuid,
  new_prompt_package_version_id   uuid,
  old_package_slug                text,
  new_package_slug                text,
  old_version_no                  integer,
  new_version_no                  integer,
  old_mode                        text,
  new_mode                        text,
  change_reason                   text,
  changed_at                      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  project_prompt_package_change_logs IS 'プロジェクトのAIプロンプトパッケージ設定変更履歴。FKなしスナップショット方式';
COMMENT ON COLUMN project_prompt_package_change_logs.old_prompt_package_version_id IS '変更前バージョンID（FKなし。パッケージ削除後も追跡可能）';
COMMENT ON COLUMN project_prompt_package_change_logs.new_prompt_package_version_id IS '変更後バージョンID（FKなし）';
COMMENT ON COLUMN project_prompt_package_change_logs.old_package_slug             IS '変更前パッケージslugのスナップショット';
COMMENT ON COLUMN project_prompt_package_change_logs.new_package_slug             IS '変更後パッケージslugのスナップショット';
COMMENT ON COLUMN project_prompt_package_change_logs.old_mode                     IS '変更前の ai_prompt_mode（custom | package）';
COMMENT ON COLUMN project_prompt_package_change_logs.new_mode                     IS '変更後の ai_prompt_mode（custom | package）';
COMMENT ON COLUMN project_prompt_package_change_logs.change_reason                IS '変更理由・メモ（管理者が任意で入力）';

CREATE INDEX IF NOT EXISTS project_prompt_package_change_logs_project_id_idx
  ON project_prompt_package_change_logs (project_id, changed_at DESC);

GRANT SELECT, INSERT ON project_prompt_package_change_logs TO service_role;

ALTER TABLE project_prompt_package_change_logs DISABLE ROW LEVEL SECURITY;
