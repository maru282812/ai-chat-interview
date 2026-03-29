alter table project_assignments
  add column if not exists user_id text,
  add column if not exists assigned_at timestamptz,
  add column if not exists deadline timestamptz,
  add column if not exists expired_at timestamptz;

update project_assignments
set
  user_id = respondents.line_user_id,
  assigned_at = coalesce(project_assignments.assigned_at, project_assignments.created_at),
  deadline = coalesce(project_assignments.deadline, project_assignments.due_at),
  expired_at = case
    when project_assignments.status = 'expired'
      then coalesce(project_assignments.expired_at, project_assignments.updated_at, now())
    else project_assignments.expired_at
  end
from respondents
where respondents.id = project_assignments.respondent_id;

update project_assignments
set status = 'assigned'
where status = 'pending';

alter table project_assignments
  alter column status set default 'assigned';

alter table project_assignments
  alter column assigned_at set not null;

alter table project_assignments
  drop constraint if exists project_assignments_status_check;

alter table project_assignments
  add constraint project_assignments_status_check
  check (status in ('assigned', 'sent', 'opened', 'started', 'completed', 'expired', 'cancelled'));

create index if not exists idx_project_assignments_user_status
  on project_assignments(user_id, status, updated_at desc);

create index if not exists idx_project_assignments_deadline_status
  on project_assignments(deadline, status);
