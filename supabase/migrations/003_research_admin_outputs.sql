alter table questions
  add column if not exists question_role text not null default 'main';

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

alter table answers
  add column if not exists answer_role text not null default 'primary',
  add column if not exists parent_answer_id uuid references answers(id) on delete set null;

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

create index if not exists idx_answers_parent on answers(parent_answer_id);

create table if not exists project_analysis_reports (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  respondent_count integer not null default 0,
  completed_session_count integer not null default 0,
  report_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_project_analysis_reports_project_created
  on project_analysis_reports(project_id, created_at desc);
