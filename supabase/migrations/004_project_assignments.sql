create table if not exists project_assignments (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  respondent_id uuid not null references respondents(id) on delete cascade,
  assignment_type text not null default 'manual',
  status text not null default 'assigned',
  filter_snapshot jsonb,
  due_at timestamptz,
  sent_at timestamptz,
  opened_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  reminder_sent_at timestamptz,
  last_delivery_error text,
  delivery_log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_assignments_assignment_type_check
    check (assignment_type in ('manual', 'rule_based')),
  constraint project_assignments_status_check
    check (status in ('assigned', 'sent', 'opened', 'started', 'completed', 'expired', 'cancelled')),
  constraint project_assignments_project_respondent_unique
    unique(project_id, respondent_id)
);

create index if not exists idx_project_assignments_project_status
  on project_assignments(project_id, status, updated_at desc);

create index if not exists idx_project_assignments_respondent_status
  on project_assignments(respondent_id, status, updated_at desc);

create index if not exists idx_project_assignments_due_status
  on project_assignments(due_at, status);

drop trigger if exists trg_project_assignments_updated_at on project_assignments;
create trigger trg_project_assignments_updated_at before update on project_assignments
for each row execute function set_updated_at();
