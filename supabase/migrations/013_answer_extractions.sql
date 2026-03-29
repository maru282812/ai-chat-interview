create table if not exists answer_extractions (
  id uuid primary key default gen_random_uuid(),
  source_answer_id uuid not null references answers(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  question_id uuid not null references questions(id) on delete cascade,
  extraction_status text not null default 'pending',
  extraction_method text not null default 'rule_based',
  extracted_json jsonb,
  extracted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(source_answer_id)
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'answer_extractions_status_check'
  ) then
    alter table answer_extractions
      add constraint answer_extractions_status_check
      check (extraction_status in ('pending', 'completed', 'partial', 'failed', 'skipped'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'answer_extractions_method_check'
  ) then
    alter table answer_extractions
      add constraint answer_extractions_method_check
      check (extraction_method in ('rule_based', 'ai_assisted'));
  end if;
end $$;

create index if not exists idx_answer_extractions_project_question
  on answer_extractions(project_id, question_id, extracted_at desc);
create index if not exists idx_answer_extractions_source_answer
  on answer_extractions(source_answer_id);

drop trigger if exists trg_answer_extractions_updated_at on answer_extractions;
create trigger trg_answer_extractions_updated_at before update on answer_extractions
for each row execute function set_updated_at();
