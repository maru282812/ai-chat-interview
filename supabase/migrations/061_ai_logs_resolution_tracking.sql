-- ============================================================
-- 061: ai_logs に実行時プロンプト解決状態スナップショットを追加（Phase A）
-- 目的: 管理主体を Project から PromptPackageVersion へ寄せるにあたり、
--   実行時にどちらの真実が使われたか（package_version 主体か / project fallback か /
--   project override が使われたか）を後から追跡できるようにする。
-- 設計:
--   - FKなし・スナップショット方式（package_* 同様、削除・変更の影響を受けない監査ログ）
--   - aiService.resolveEffectiveProjectConfig の解決結果を resolvePromptMeta 経由で記録
-- 形式（resolution_json の主なキー）:
--   source                         : 'package_version' | 'project_legacy'
--   used_package_version           : boolean（package version を主データに使ったか）
--   used_project_template_fallback : boolean（version に templates_json が無く project へ fallback）
--   used_project_policy_fallback   : boolean（version に policy_json が無く project へ fallback）
--   used_project_fallback          : boolean（上記いずれかの project fallback が発生したか）
--   used_project_override          : boolean（ai_prompt_overrides_json.policy が使われたか・deprecated）
--   warnings                       : text[]（silent fallback を避けるための追跡メッセージ）
-- 影響:
--   - 既存行は NULL（後方互換）。
-- ============================================================

ALTER TABLE ai_logs
  ADD COLUMN IF NOT EXISTS resolution_json jsonb;

COMMENT ON COLUMN ai_logs.resolution_json IS
  '実行時プロンプト解決状態スナップショット（source / project fallback / override 有無・warnings）。Phase A';
