-- ============================================================
-- 049: ai_logs にプロンプト追跡フィールドを追加
-- 目的: どのテンプレート・どの方針で生成されたか後から追跡できるようにする
-- ============================================================

alter table ai_logs
  add column if not exists prompt_key      text,
  add column if not exists template_key    text,
  add column if not exists template_mode   text,
  add column if not exists policy_snapshot jsonb,
  add column if not exists rendered_prompt text;

-- template_mode の許容値コメント: 'legacy' | 'base_template' | 'custom_template'
comment on column ai_logs.prompt_key      is 'buildXxxPrompt 関数名 (例: buildInterviewTurnPrompt)';
comment on column ai_logs.template_key    is 'テンプレートキー (ai_prompt_templates_json != null のとき promptKey と同じ値)';
comment on column ai_logs.template_mode   is 'legacy | base_template | custom_template';
comment on column ai_logs.policy_snapshot is 'プロンプト生成時の ai_prompt_policy_json スナップショット';
comment on column ai_logs.rendered_prompt is 'buildXxxPrompt の出力（システム指示文追記前の最終レンダリング結果）';
