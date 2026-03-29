create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_name text,
  objective text,
  status text not null default 'draft',
  reward_points integer not null default 30,
  research_mode text not null default 'survey',
  primary_objectives jsonb not null default '[]'::jsonb,
  secondary_objectives jsonb not null default '[]'::jsonb,
  comparison_constraints jsonb not null default '[]'::jsonb,
  prompt_rules jsonb not null default '[]'::jsonb,
  probe_policy jsonb,
  response_style jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_research_mode_check
    check (research_mode in ('survey', 'interview', 'survey_with_interview_probe'))
);

create table if not exists questions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  question_code text not null,
  question_text text not null,
  question_role text not null default 'main',
  question_type text not null,
  is_required boolean not null default true,
  sort_order integer not null,
  branch_rule jsonb,
  question_config jsonb,
  ai_probe_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, question_code)
);

create table if not exists ranks (
  id uuid primary key default gen_random_uuid(),
  rank_code text not null unique,
  rank_name text not null,
  min_points integer not null,
  sort_order integer not null,
  badge_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists respondents (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null,
  display_name text,
  project_id uuid not null references projects(id) on delete cascade,
  status text not null default 'invited',
  total_points integer not null default 0,
  current_rank_id uuid references ranks(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(line_user_id, project_id)
);

create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  respondent_id uuid not null references respondents(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  current_question_id uuid references questions(id),
  current_phase text not null default 'question',
  status text not null default 'pending',
  summary text,
  state_json jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  last_activity_at timestamptz not null default now()
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  sender_type text not null,
  message_text text not null,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);

create table if not exists answers (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  answer_text text not null,
  answer_role text not null default 'primary',
  parent_answer_id uuid references answers(id) on delete set null,
  normalized_answer jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ai_analysis_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references sessions(id) on delete cascade,
  summary text,
  usage_scene text,
  motive text,
  pain_points text,
  alternatives text,
  insight_candidates text,
  raw_json jsonb,
  created_at timestamptz not null default now()
);

create table if not exists ai_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id) on delete cascade,
  purpose text not null,
  prompt text not null,
  response text not null,
  token_usage jsonb,
  created_at timestamptz not null default now()
);

create table if not exists project_analysis_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  respondent_count integer not null default 0,
  completed_session_count integer not null default 0,
  report_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists point_transactions (
  id uuid primary key default gen_random_uuid(),
  respondent_id uuid not null references respondents(id) on delete cascade,
  session_id uuid references sessions(id) on delete set null,
  project_id uuid references projects(id) on delete set null,
  transaction_type text not null,
  points integer not null,
  reason text not null,
  created_at timestamptz not null default now()
);

create table if not exists reward_rules (
  id uuid primary key default gen_random_uuid(),
  rule_code text not null,
  rule_name text not null,
  rule_type text not null default 'global',
  project_id uuid references projects(id) on delete cascade,
  points integer not null,
  is_active boolean not null default true,
  config_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(rule_code, project_id)
);

create table if not exists respondent_rank_histories (
  id uuid primary key default gen_random_uuid(),
  respondent_id uuid not null references respondents(id) on delete cascade,
  previous_rank_id uuid references ranks(id),
  new_rank_id uuid not null references ranks(id),
  reason text not null,
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'questions_question_role_check'
  ) then
    alter table questions
      add constraint questions_question_role_check
      check (question_role in ('screening', 'main', 'probe_trigger', 'attribute', 'comparison_core'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'answers_answer_role_check'
  ) then
    alter table answers
      add constraint answers_answer_role_check
      check (answer_role in ('primary', 'ai_probe'));
  end if;
end $$;

create index if not exists idx_questions_project_sort on questions(project_id, sort_order);
create index if not exists idx_sessions_respondent_status on sessions(respondent_id, status);
create index if not exists idx_messages_session_created on messages(session_id, created_at);
create index if not exists idx_answers_session_created on answers(session_id, created_at);
create index if not exists idx_answers_parent on answers(parent_answer_id);
create index if not exists idx_point_transactions_respondent on point_transactions(respondent_id, created_at);
create index if not exists idx_project_analysis_reports_project_created
  on project_analysis_reports(project_id, created_at desc);

drop trigger if exists trg_projects_updated_at on projects;
create trigger trg_projects_updated_at before update on projects
for each row execute function set_updated_at();

drop trigger if exists trg_questions_updated_at on questions;
create trigger trg_questions_updated_at before update on questions
for each row execute function set_updated_at();

drop trigger if exists trg_ranks_updated_at on ranks;
create trigger trg_ranks_updated_at before update on ranks
for each row execute function set_updated_at();

drop trigger if exists trg_respondents_updated_at on respondents;
create trigger trg_respondents_updated_at before update on respondents
for each row execute function set_updated_at();

drop trigger if exists trg_reward_rules_updated_at on reward_rules;
create trigger trg_reward_rules_updated_at before update on reward_rules
for each row execute function set_updated_at();
