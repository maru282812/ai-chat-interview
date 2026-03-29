alter table project_assignments
  alter column status set default 'pending';

update project_assignments
set status = 'pending'
where status = 'assigned';

alter table project_assignments
  drop constraint if exists project_assignments_status_check;

alter table project_assignments
  add constraint project_assignments_status_check
  check (status in ('pending', 'assigned', 'sent', 'opened', 'started', 'completed', 'expired', 'cancelled'));
