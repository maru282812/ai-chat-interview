-- ============================================================
-- 057: プロジェクト個別オーバーライド層（Phase 6-B）
-- 目的: package モードを基本としつつ、プロジェクトごとに
--       AIプロンプト方針（policy）の一部だけを上書きできるようにする
-- 設計方針:
--   - 解決優先順位: ai_prompt_overrides_json.policy
--                   > prompt_package_versions.policy_json / templates_json
--                   > projects.ai_prompt_policy_json / ai_prompt_templates_json（custom モード）
--                   > legacy ハードコード
--   - 初期実装では policy の上書きのみ許可（テンプレート本文の上書きは
--     パッケージ中心管理を崩すリスクがあるため、必要性が明確になってから後続対応）
--   - custom モードのプロジェクトには影響しない（package モード時のみ参照）
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ai_prompt_overrides_json jsonb;

COMMENT ON COLUMN projects.ai_prompt_overrides_json IS
  'package モード時の個別オーバーライド。形式: { "policy": { 部分上書きする AIPromptPolicy キーのみ } }。設定キーのみパッケージ policy に deep-merge される。templates の上書きは初期実装では未対応';
