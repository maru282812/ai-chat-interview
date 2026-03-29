alter table projects
  add column if not exists research_mode text not null default 'survey',
  add column if not exists primary_objectives jsonb not null default '[]'::jsonb,
  add column if not exists secondary_objectives jsonb not null default '[]'::jsonb,
  add column if not exists comparison_constraints jsonb not null default '[]'::jsonb,
  add column if not exists prompt_rules jsonb not null default '[]'::jsonb,
  add column if not exists probe_policy jsonb,
  add column if not exists response_style jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_research_mode_check'
  ) then
    alter table projects
      add constraint projects_research_mode_check
      check (research_mode in ('survey', 'interview', 'survey_with_interview_probe'));
  end if;
end $$;

update projects
set
  primary_objectives = case
    when jsonb_array_length(primary_objectives) = 0 and objective is not null and btrim(objective) <> ''
      then jsonb_build_array(objective)
    else primary_objectives
  end,
  probe_policy = coalesce(probe_policy, '{}'::jsonb),
  response_style = coalesce(
    response_style,
    jsonb_build_object(
      'channel', 'line',
      'tone', 'natural_japanese',
      'max_characters_per_message', 80,
      'max_sentences', 2
    )
  );
