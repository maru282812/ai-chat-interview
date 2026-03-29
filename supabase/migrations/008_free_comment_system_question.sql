alter table questions
  add column if not exists is_system boolean not null default false,
  add column if not exists is_hidden boolean not null default false;

do $$
begin
  if exists (
    select 1
    from pg_constraint
    where conname = 'questions_question_role_check'
  ) then
    alter table questions drop constraint questions_question_role_check;
  end if;
end $$;

alter table questions
  add constraint questions_question_role_check
  check (question_role in ('screening', 'main', 'probe_trigger', 'attribute', 'comparison_core', 'free_comment'));

create index if not exists idx_questions_project_visible_sort
  on questions(project_id, is_hidden, sort_order);
create unique index if not exists idx_questions_project_free_comment_unique
  on questions(project_id, question_code);

insert into questions (
  project_id,
  question_code,
  question_text,
  question_role,
  question_type,
  is_required,
  sort_order,
  branch_rule,
  question_config,
  ai_probe_enabled,
  is_system,
  is_hidden
)
select
  p.id,
  '__free_comment__',
  '最後に、設問に入っていないことでも、感じたことや伝えておきたいことがあれば自由に教えてください。短くても大丈夫です。',
  'free_comment',
  'text',
  true,
  coalesce((
    select max(q.sort_order) + 1
    from questions q
    where q.project_id = p.id
  ), 1),
  null,
  '{"placeholder":"自由に入力してください"}'::jsonb,
  false,
  true,
  true
from projects p
where not exists (
  select 1
  from questions q
  where q.project_id = p.id
    and q.question_code = '__free_comment__'
);

insert into line_menu_actions (
  menu_key,
  label,
  action_type,
  action_payload,
  sort_order,
  is_active
)
values
  ('participate_research', '調査に参加', 'start_project_list', '{"aliases":["案件一覧"]}'::jsonb, 10, true),
  ('share_rant', '本音・悩み', 'open_post_mode', '{"postType":"rant","prompt":"本音や悩みがあれば、そのまま送ってください。長文でも大丈夫です。"}'::jsonb, 20, true),
  ('today_feeling', '今日の気持ち', 'open_post_mode', '{"postType":"diary","prompt":"今日の気持ちや出来事を自由に送ってください。短くても大丈夫です。"}'::jsonb, 30, true),
  ('mypage', 'マイページ', 'show_mypage', '{"aliases":["mypage"]}'::jsonb, 40, true),
  ('personality', '性格診断', 'show_personality', '{}'::jsonb, 50, true)
on conflict (menu_key) do update
set
  label = excluded.label,
  action_type = excluded.action_type,
  action_payload = excluded.action_payload,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;
