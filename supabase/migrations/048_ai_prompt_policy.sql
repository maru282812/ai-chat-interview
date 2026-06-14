-- 048: AIプロンプトポリシー管理
-- projects テーブルに ai_prompt_policy_json と ai_prompt_templates_json を追加

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ai_prompt_policy_json    jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS ai_prompt_templates_json jsonb DEFAULT NULL;

-- RLS 既存ポリシーは projects テーブル全体に適用済みのため追加不要
-- service role は引き続きフルアクセス可
