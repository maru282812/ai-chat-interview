alter table projects
  add column if not exists ai_state_json jsonb,
  add column if not exists ai_state_template_key text,
  add column if not exists ai_state_generated_at timestamptz;

