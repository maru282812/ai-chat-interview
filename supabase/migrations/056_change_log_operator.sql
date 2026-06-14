-- ============================================================
-- 056: AIプロンプトパッケージ変更履歴に操作者情報を追加
-- 目的: 「誰が」変更したかを追跡できるようにする（Phase 5-C）
-- 設計方針:
--   - Basic 認証のユーザー名をスナップショットとして記録
--   - 将来の管理者認証導入時もそのまま利用可能（text 型）
-- ============================================================

ALTER TABLE project_prompt_package_change_logs
  ADD COLUMN IF NOT EXISTS changed_by text;

COMMENT ON COLUMN project_prompt_package_change_logs.changed_by IS '操作者情報（Basic認証ユーザー名のスナップショット。取得できない場合は NULL）';
