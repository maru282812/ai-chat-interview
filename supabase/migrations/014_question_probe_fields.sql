-- Add probe_guideline, max_probe_count, render_strategy columns to questions table
alter table questions
  add column if not exists probe_guideline text,
  add column if not exists max_probe_count integer,
  add column if not exists render_strategy text not null default 'static';

-- Update research_mode constraint to allow 'survey_interview'
do $$
begin
  if exists (
    select 1 from information_schema.table_constraints
    where table_name = 'projects' and conname = 'projects_research_mode_check'
  ) then
    alter table projects drop constraint projects_research_mode_check;
  end if;
end $$;

alter table projects
  add constraint projects_research_mode_check
    check (research_mode in ('survey', 'interview', 'survey_with_interview_probe', 'survey_interview'));
