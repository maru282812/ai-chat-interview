-- ============================================================
-- 060: ai_prompt_mode の既定値を 'custom' → 'package' に変更（Phase G）
-- 目的: 「Package First」方針に DB 既定値を揃える。
--   - Migration 054 で既定値は 'custom' だったが、UI（researchForm Phase 8）の
--     新規プロジェクト既定は 'package'。フォーム外（API/スクリプト/シード）経路の
--     不整合を解消する。
-- 影響:
--   - 既存行は不変（DEFAULT は新規 INSERT のみに適用）。
--   - CHECK 制約・列定義は変更しない（'custom' は後方互換として温存）。
--   - version_id を伴わず package 既定になった行は実行時に BASE/legacy へ
--     フォールバックする（aiService.resolveEffectiveProjectConfig）。
--     ai_logs.template_mode で追跡可能（Phase F）。
-- ============================================================

ALTER TABLE projects
  ALTER COLUMN ai_prompt_mode SET DEFAULT 'package';

COMMENT ON COLUMN projects.ai_prompt_mode IS
  'package = パッケージバージョン適用（既定・推奨） / custom = プロジェクト個別設定（後方互換・非推奨）';
