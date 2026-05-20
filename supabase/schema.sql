-- ============================================================
-- schema.sql  –  統合スキーマ (001〜021 + seed)
-- 001_init ～ 021_remove_legacy_question_types を全て統合
-- ============================================================

create extension if not exists pgcrypto;

-- ============================================================
-- Utility
-- ============================================================

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- Tables
-- ============================================================

create table if not exists ranks (
  id          uuid primary key default gen_random_uuid(),
  rank_code   text not null unique,
  rank_name   text not null,
  min_points  integer not null,
  sort_order  integer not null,
  badge_label text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists projects (
  id                           uuid primary key default gen_random_uuid(),
  name                         text not null,
  client_name                  text,
  objective                    text,
  status                       text not null default 'draft',
  reward_points                integer not null default 30,
  research_mode                text not null default 'survey',
  primary_objectives           jsonb not null default '[]'::jsonb,
  secondary_objectives         jsonb not null default '[]'::jsonb,
  comparison_constraints       jsonb not null default '[]'::jsonb,
  prompt_rules                 jsonb not null default '[]'::jsonb,
  probe_policy                 jsonb,
  response_style               jsonb,
  ai_state_json                jsonb,
  ai_state_template_key        text,
  ai_state_generated_at        timestamptz,
  display_mode                 text not null default 'survey_question',
  screening_config             jsonb,
  screening_last_question_order integer,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now(),
  constraint projects_research_mode_check
    check (research_mode in ('survey', 'interview', 'survey_with_interview_probe', 'survey_interview')),
  constraint projects_display_mode_check
    check (display_mode in ('survey_page', 'survey_question', 'interview_chat'))
);

comment on column projects.display_mode is
  'アンケート/インタビューの表示モード: survey_page | survey_question | interview_chat';

create table if not exists question_page_groups (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references projects(id) on delete cascade,
  page_number integer not null,
  title       text,
  description text,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (project_id, page_number)
);

create table if not exists questions (
  id                   uuid primary key default gen_random_uuid(),
  project_id           uuid not null references projects(id) on delete cascade,
  question_code        text not null,
  question_text        text not null,
  question_role        text not null default 'main',
  question_type        text not null,
  is_required          boolean not null default true,
  sort_order           integer not null,
  branch_rule          jsonb,
  question_config      jsonb,
  ai_probe_enabled     boolean not null default false,
  is_system            boolean not null default false,
  is_hidden            boolean not null default false,
  probe_guideline      text,
  max_probe_count      integer,
  render_strategy      text not null default 'static',
  comment_top          text,
  comment_bottom       text,
  answer_output_type   text,
  display_tags_raw     text,
  display_tags_parsed  jsonb,
  visibility_conditions jsonb,
  page_group_id        uuid references question_page_groups(id) on delete set null,
  answer_options_locked boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (project_id, question_code),
  constraint questions_question_role_check
    check (question_role in ('screening', 'main', 'probe_trigger', 'attribute', 'comparison_core', 'free_comment')),
  constraint questions_question_type_check
    check (question_type in (
      'single_choice', 'multi_choice',
      'matrix_single', 'matrix_multi', 'matrix_mixed',
      'free_text_short', 'free_text_long',
      'numeric',
      'image_upload',
      'hidden_single', 'hidden_multi',
      'text_with_image',
      'sd'
    )),
  constraint questions_answer_output_type_check
    check (answer_output_type in ('text','number','boolean','array','object','none') or answer_output_type is null)
);

comment on column questions.display_tags_raw is
  'PDFタグ仕様に基づく生タグ文字列（例: <size=20><must><pipe q1=1>）';
comment on column questions.display_tags_parsed is
  '構造化タグJSON。tagParser が raw から生成。アプリ内部ではこちらを正とする。';
comment on column questions.visibility_conditions is
  '設問の表示条件。<pipe> の表示制御用途を構造化保存する。';
comment on column questions.page_group_id is
  'survey_page モード時のページグループ。null = 未割当。';
comment on column questions.answer_options_locked is
  '回答選択肢の固定フラグ。true の場合、AI候補による選択肢の自動上書きを行わない。';

create table if not exists respondents (
  id               uuid primary key default gen_random_uuid(),
  line_user_id     text not null,
  display_name     text,
  project_id       uuid not null references projects(id) on delete cascade,
  status           text not null default 'invited',
  total_points     integer not null default 0,
  current_rank_id  uuid references ranks(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (line_user_id, project_id)
);

create table if not exists sessions (
  id                  uuid primary key default gen_random_uuid(),
  respondent_id       uuid not null references respondents(id) on delete cascade,
  project_id          uuid not null references projects(id) on delete cascade,
  current_question_id uuid references questions(id),
  current_phase       text not null default 'question',
  status              text not null default 'pending',
  summary             text,
  state_json          jsonb not null default '{}'::jsonb,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  last_activity_at    timestamptz not null default now()
);

create table if not exists messages (
  id           uuid primary key default gen_random_uuid(),
  session_id   uuid not null references sessions(id) on delete cascade,
  sender_type  text not null,
  message_text text not null,
  raw_payload  jsonb,
  created_at   timestamptz not null default now()
);

create table if not exists answers (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references sessions(id) on delete cascade,
  question_id      uuid not null references questions(id) on delete cascade,
  answer_text      text not null,
  answer_role      text not null default 'primary',
  parent_answer_id uuid references answers(id) on delete set null,
  normalized_answer jsonb,
  free_text_answer text,
  created_at       timestamptz not null default now(),
  constraint answers_answer_role_check
    check (answer_role in ('primary', 'ai_probe'))
);

comment on column answers.free_text_answer is
  '自由記述回答。LIFF 経由回答では必須（アプリ側制御）。空文字・定型文は不可。';

create table if not exists answer_extractions (
  id                uuid primary key default gen_random_uuid(),
  source_answer_id  uuid not null references answers(id) on delete cascade,
  project_id        uuid not null references projects(id) on delete cascade,
  question_id       uuid not null references questions(id) on delete cascade,
  extraction_status text not null default 'pending',
  extraction_method text not null default 'rule_based',
  extracted_json    jsonb,
  extracted_at      timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (source_answer_id),
  constraint answer_extractions_status_check
    check (extraction_status in ('pending', 'completed', 'partial', 'failed', 'skipped')),
  constraint answer_extractions_method_check
    check (extraction_method in ('rule_based', 'ai_assisted'))
);

create table if not exists ai_analysis_results (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null unique references sessions(id) on delete cascade,
  summary           text,
  usage_scene       text,
  motive            text,
  pain_points       text,
  alternatives      text,
  insight_candidates text,
  raw_json          jsonb,
  created_at        timestamptz not null default now()
);

create table if not exists ai_logs (
  id          uuid primary key default gen_random_uuid(),
  session_id  uuid not null references sessions(id) on delete cascade,
  purpose     text not null,
  prompt      text not null,
  response    text not null,
  token_usage jsonb,
  created_at  timestamptz not null default now()
);

create table if not exists project_analysis_reports (
  id                      uuid primary key default gen_random_uuid(),
  project_id              uuid not null references projects(id) on delete cascade,
  respondent_count        integer not null default 0,
  completed_session_count integer not null default 0,
  report_json             jsonb not null default '{}'::jsonb,
  created_at              timestamptz not null default now()
);

create table if not exists point_transactions (
  id               uuid primary key default gen_random_uuid(),
  respondent_id    uuid not null references respondents(id) on delete cascade,
  session_id       uuid references sessions(id) on delete set null,
  project_id       uuid references projects(id) on delete set null,
  transaction_type text not null,
  points           integer not null,
  reason           text not null,
  created_at       timestamptz not null default now()
);

create table if not exists reward_rules (
  id          uuid primary key default gen_random_uuid(),
  rule_code   text not null,
  rule_name   text not null,
  rule_type   text not null default 'global',
  project_id  uuid references projects(id) on delete cascade,
  points      integer not null,
  is_active   boolean not null default true,
  config_json jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (rule_code, project_id)
);

create table if not exists respondent_rank_histories (
  id               uuid primary key default gen_random_uuid(),
  respondent_id    uuid not null references respondents(id) on delete cascade,
  previous_rank_id uuid references ranks(id),
  new_rank_id      uuid not null references ranks(id),
  reason           text not null,
  created_at       timestamptz not null default now()
);

create table if not exists project_assignments (
  id                  uuid primary key default gen_random_uuid(),
  project_id          uuid not null references projects(id) on delete cascade,
  respondent_id       uuid not null references respondents(id) on delete cascade,
  assignment_type     text not null default 'manual',
  status              text not null default 'assigned',
  user_id             text,
  assigned_at         timestamptz not null default now(),
  deadline            timestamptz,
  expired_at          timestamptz,
  filter_snapshot     jsonb,
  due_at              timestamptz,
  sent_at             timestamptz,
  opened_at           timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  reminder_sent_at    timestamptz,
  last_delivery_error text,
  delivery_log        jsonb not null default '[]'::jsonb,
  screening_result    text,
  screening_result_at timestamptz,
  delivery_channel    text not null default 'liff',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint project_assignments_project_respondent_unique
    unique (project_id, respondent_id),
  constraint project_assignments_assignment_type_check
    check (assignment_type in ('manual', 'rule_based')),
  constraint project_assignments_status_check
    check (status in ('assigned', 'sent', 'opened', 'started', 'completed', 'expired', 'cancelled')),
  constraint project_assignments_screening_result_check
    check (screening_result in ('passed', 'failed') or screening_result is null),
  constraint project_assignments_delivery_channel_check
    check (delivery_channel in ('liff', 'line'))
);

comment on column project_assignments.delivery_channel is
  '配信チャネル: liff = LIFF画面から開始、line = LINEトーク上で質問を進める';

create table if not exists user_posts (
  id              uuid primary key default gen_random_uuid(),
  user_id         text not null,
  respondent_id   uuid references respondents(id) on delete set null,
  type            text not null,
  project_id      uuid references projects(id) on delete set null,
  session_id      uuid references sessions(id) on delete set null,
  answer_id       uuid references answers(id) on delete set null,
  source_channel  text not null default 'line',
  source_mode     text,
  menu_action_key text,
  title           text,
  content         text not null,
  metadata        jsonb not null default '{}'::jsonb,
  posted_on       date,
  quality_score   integer not null default 0,
  quality_label   text not null default 'low',
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint user_posts_type_check
    check (type in ('survey', 'interview', 'rant', 'diary', 'free_comment')),
  constraint user_posts_source_channel_check
    check (source_channel in ('line', 'liff', 'admin', 'system')),
  constraint user_posts_quality_score_range
    check (quality_score between 0 and 100),
  constraint user_posts_quality_label_check
    check (quality_label in ('low', 'medium', 'high'))
);

create table if not exists post_analysis (
  id                  uuid primary key default gen_random_uuid(),
  post_id             uuid not null unique references user_posts(id) on delete cascade,
  analysis_version    text not null default 'v1',
  summary             text,
  tags                jsonb not null default '[]'::jsonb,
  sentiment           text not null default 'neutral',
  sentiment_score     numeric(5, 4),
  keywords            jsonb not null default '[]'::jsonb,
  mentioned_brands    jsonb not null default '[]'::jsonb,
  pii_flags           jsonb not null default '[]'::jsonb,
  actionability       text not null default 'medium',
  personality_signals jsonb not null default '[]'::jsonb,
  behavior_signals    jsonb not null default '[]'::jsonb,
  insight_type        text not null default 'other',
  specificity         integer not null default 0,
  novelty             integer not null default 0,
  raw_json            jsonb not null default '{}'::jsonb,
  analyzed_at         timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint post_analysis_sentiment_check
    check (sentiment in ('positive', 'neutral', 'negative', 'mixed')),
  constraint post_analysis_actionability_check
    check (actionability in ('high', 'medium', 'low')),
  constraint post_analysis_insight_type_check
    check (insight_type in ('issue', 'request', 'complaint', 'praise', 'other')),
  constraint post_analysis_specificity_range
    check (specificity between 0 and 100),
  constraint post_analysis_novelty_range
    check (novelty between 0 and 100)
);

create table if not exists user_personality_profiles (
  id               uuid primary key default gen_random_uuid(),
  user_id          text not null,
  respondent_id    uuid references respondents(id) on delete set null,
  latest_post_id   uuid references user_posts(id) on delete set null,
  summary          text,
  traits           jsonb not null default '[]'::jsonb,
  segments         jsonb not null default '[]'::jsonb,
  confidence       numeric(5, 4),
  evidence_post_ids jsonb not null default '[]'::jsonb,
  raw_json         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists line_menu_actions (
  id             uuid primary key default gen_random_uuid(),
  menu_key       text not null unique,
  label          text not null,
  action_type    text not null,
  action_payload jsonb not null default '{}'::jsonb,
  liff_path      text,
  icon_key       text,
  sort_order     integer not null default 0,
  is_active      boolean not null default true,
  audience_rule  jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint line_menu_actions_action_type_check
    check (action_type in (
      'start_project_list', 'resume_project', 'open_post_mode',
      'open_liff', 'show_mypage', 'show_personality'
    ))
);

create table if not exists liff_entrypoints (
  id            uuid primary key default gen_random_uuid(),
  entry_key     text not null unique,
  title         text not null,
  path          text not null,
  entry_type    text not null,
  settings_json jsonb not null default '{}'::jsonb,
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint liff_entrypoints_entry_type_check
    check (entry_type in ('rant', 'diary', 'mypage', 'personality', 'survey_support'))
);

create table if not exists user_profiles (
  id                      uuid primary key default gen_random_uuid(),
  line_user_id            text not null unique,
  nickname                text,
  birth_date              date,
  prefecture              text,
  address_detail          text,
  address_registered_at   timestamptz,
  address_declined        boolean not null default false,
  occupation              text,
  occupation_updated_at   timestamptz,
  industry                text,
  marital_status          text,
  has_children            boolean,
  children_ages           integer[] not null default '{}',
  household_composition   text[] not null default '{}',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint user_profiles_marital_status_check
    check (marital_status in ('single', 'married', 'divorced', 'widowed') or marital_status is null)
);

-- ============================================================
-- Indexes
-- ============================================================

create index if not exists idx_questions_project_sort
  on questions(project_id, sort_order);
create index if not exists idx_questions_project_visible_sort
  on questions(project_id, is_hidden, sort_order);
create index if not exists idx_questions_page_group
  on questions(page_group_id) where page_group_id is not null;

create index if not exists idx_question_page_groups_project
  on question_page_groups(project_id);

create index if not exists idx_sessions_respondent_status
  on sessions(respondent_id, status);

create index if not exists idx_messages_session_created
  on messages(session_id, created_at);

create index if not exists idx_answers_session_created
  on answers(session_id, created_at);
create index if not exists idx_answers_parent
  on answers(parent_answer_id);

create index if not exists idx_answer_extractions_project_question
  on answer_extractions(project_id, question_id, extracted_at desc);
create index if not exists idx_answer_extractions_source_answer
  on answer_extractions(source_answer_id);

create index if not exists idx_point_transactions_respondent
  on point_transactions(respondent_id, created_at);

create index if not exists idx_project_analysis_reports_project_created
  on project_analysis_reports(project_id, created_at desc);

create index if not exists idx_project_assignments_project_status
  on project_assignments(project_id, status, updated_at desc);
create index if not exists idx_project_assignments_respondent_status
  on project_assignments(respondent_id, status, updated_at desc);
create index if not exists idx_project_assignments_due_status
  on project_assignments(due_at, status);
create index if not exists idx_project_assignments_user_status
  on project_assignments(user_id, status, updated_at desc);
create index if not exists idx_project_assignments_deadline_status
  on project_assignments(deadline, status);

create index if not exists idx_user_posts_user_created
  on user_posts(user_id, created_at desc);
create index if not exists idx_user_posts_project_type_created
  on user_posts(project_id, type, created_at desc);
create index if not exists idx_user_posts_session_created
  on user_posts(session_id, created_at desc);
create unique index if not exists idx_user_posts_answer_unique
  on user_posts(answer_id) where answer_id is not null;
create index if not exists idx_user_posts_quality_score
  on user_posts(quality_score desc, created_at desc);

create index if not exists idx_post_analysis_sentiment_actionability
  on post_analysis(sentiment, actionability, analyzed_at desc);
create index if not exists idx_post_analysis_tags_gin
  on post_analysis using gin (tags);
create index if not exists idx_post_analysis_keywords_gin
  on post_analysis using gin (keywords);
create index if not exists idx_post_analysis_insight_type
  on post_analysis(insight_type, sentiment, analyzed_at desc);

create unique index if not exists idx_user_personality_profiles_user
  on user_personality_profiles(user_id);

create index if not exists idx_line_menu_actions_active_sort
  on line_menu_actions(is_active, sort_order);
create index if not exists idx_liff_entrypoints_active_type
  on liff_entrypoints(is_active, entry_type);

create index if not exists idx_user_profiles_line_user_id
  on user_profiles(line_user_id);

-- ============================================================
-- Triggers
-- ============================================================

drop trigger if exists trg_projects_updated_at on projects;
create trigger trg_projects_updated_at before update on projects
  for each row execute function set_updated_at();

drop trigger if exists trg_question_page_groups_updated_at on question_page_groups;
create trigger trg_question_page_groups_updated_at before update on question_page_groups
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

drop trigger if exists trg_project_assignments_updated_at on project_assignments;
create trigger trg_project_assignments_updated_at before update on project_assignments
  for each row execute function set_updated_at();

drop trigger if exists trg_user_posts_updated_at on user_posts;
create trigger trg_user_posts_updated_at before update on user_posts
  for each row execute function set_updated_at();

drop trigger if exists trg_post_analysis_updated_at on post_analysis;
create trigger trg_post_analysis_updated_at before update on post_analysis
  for each row execute function set_updated_at();

drop trigger if exists trg_user_personality_profiles_updated_at on user_personality_profiles;
create trigger trg_user_personality_profiles_updated_at before update on user_personality_profiles
  for each row execute function set_updated_at();

drop trigger if exists trg_answer_extractions_updated_at on answer_extractions;
create trigger trg_answer_extractions_updated_at before update on answer_extractions
  for each row execute function set_updated_at();

drop trigger if exists trg_line_menu_actions_updated_at on line_menu_actions;
create trigger trg_line_menu_actions_updated_at before update on line_menu_actions
  for each row execute function set_updated_at();

drop trigger if exists trg_liff_entrypoints_updated_at on liff_entrypoints;
create trigger trg_liff_entrypoints_updated_at before update on liff_entrypoints
  for each row execute function set_updated_at();

drop trigger if exists trg_user_profiles_updated_at on user_profiles;
create trigger trg_user_profiles_updated_at before update on user_profiles
  for each row execute function set_updated_at();

-- ============================================================
-- Views
-- ============================================================

create or replace view project_high_value_posts as
select
  p.id,
  p.user_id,
  p.respondent_id,
  p.project_id,
  p.session_id,
  p.answer_id,
  p.type,
  p.source_channel,
  p.source_mode,
  p.menu_action_key,
  p.title,
  p.content,
  p.metadata,
  p.posted_on,
  p.quality_score,
  p.quality_label,
  p.created_at,
  a.summary,
  a.tags,
  a.sentiment,
  a.keywords,
  a.mentioned_brands,
  a.pii_flags,
  a.actionability,
  a.insight_type,
  a.specificity,
  a.novelty
from user_posts p
left join post_analysis a on a.post_id = p.id
where p.type in ('free_comment', 'rant', 'diary');

-- ============================================================
-- Storage (手動設定)
-- ============================================================
-- Supabase ダッシュボード → Storage → New bucket:
--   Name: respondent-uploads
--   Public: false
-- RLS: サービスロールキー経由のアップロード/参照のみ許可

-- ============================================================
-- Seed data
-- ============================================================

insert into ranks (rank_code, rank_name, min_points, sort_order, badge_label)
values
  ('bronze',   'Bronze',   0,   1, 'Starter Researcher'),
  ('silver',   'Silver',   100, 2, 'Steady Contributor'),
  ('gold',     'Gold',     250, 3, 'Insight Hunter'),
  ('platinum', 'Platinum', 500, 4, 'Premium Panelist')
on conflict (rank_code) do update set
  rank_name   = excluded.rank_name,
  min_points  = excluded.min_points,
  sort_order  = excluded.sort_order,
  badge_label = excluded.badge_label;

insert into line_menu_actions (menu_key, label, action_type, action_payload, liff_path, sort_order, is_active)
values
  ('participate_research', '調査に参加',      'start_project_list', '{"aliases":["案件一覧"]}'::jsonb,                                                             null,         10, true),
  ('share_rant',           '本音・悩み',       'open_post_mode',     '{"postType":"rant","prompt":"本音や悩みがあれば、そのまま送ってください。長文でも大丈夫です。"}'::jsonb, 'rant',       20, true),
  ('today_feeling',        '今日の気持ち',     'open_post_mode',     '{"postType":"diary","prompt":"今日の気持ちや出来事を自由に送ってください。短くても大丈夫です。"}'::jsonb, 'diary',      30, true),
  ('mypage',               'マイページ',       'show_mypage',        '{"aliases":["mypage"]}'::jsonb,                                                               null,         40, true),
  ('personality',          '性格診断',         'show_personality',   '{}'::jsonb,                                                                                   'personality', 50, true)
on conflict (menu_key) do update set
  label          = excluded.label,
  action_type    = excluded.action_type,
  action_payload = excluded.action_payload,
  liff_path      = excluded.liff_path,
  sort_order     = excluded.sort_order,
  is_active      = excluded.is_active;

insert into liff_entrypoints (entry_key, title, path, entry_type, settings_json, is_active)
values
  ('rant',        '本音・悩み',    '/liff/rant',        'rant',        '{}'::jsonb, true),
  ('diary',       '今日の気持ち',  '/liff/diary',       'diary',       '{}'::jsonb, true),
  ('personality', '性格診断',      '/liff/personality', 'personality', '{}'::jsonb, true)
on conflict (entry_key) do update set
  title         = excluded.title,
  path          = excluded.path,
  entry_type    = excluded.entry_type,
  settings_json = coalesce(liff_entrypoints.settings_json, '{}'::jsonb),
  is_active     = excluded.is_active;

insert into projects (
  id, name, client_name, objective, status, reward_points,
  research_mode, primary_objectives, secondary_objectives,
  comparison_constraints, prompt_rules, probe_policy, response_style,
  ai_state_template_key, ai_state_generated_at, ai_state_json
) values (
  '00000000-0000-4000-8000-000000000001',
  '飲料利用実態インタビュー',
  'Sample Client',
  '飲料カテゴリの利用シーン、購入動機、不満点を把握する',
  'active',
  30,
  'survey_with_interview_probe',
  '["飲用シーンごとの選択理由","継続利用を左右する決定要因"]'::jsonb,
  '["ブランド想起","代替候補との関係"]'::jsonb,
  '["最初に選ぶ飲料カテゴリ","主な利用シーン","継続理由","不満の有無","総合満足度"]'::jsonb,
  '["1回の質問で論点は1つまで","回答者が迷いやすい専門用語は避ける","比較可能な観点から脱線しない"]'::jsonb,
  '{
    "enabled": true,
    "conditions": ["short_answer", "abstract_answer"],
    "max_probes_per_answer": 1,
    "max_probes_per_session": 2,
    "require_question_probe_enabled": true,
    "target_question_codes": ["Q2", "Q3", "Q5", "Q6"],
    "blocked_question_codes": ["Q1", "Q4", "Q7"],
    "short_answer_min_length": 10,
    "end_conditions": [
      "answer_sufficient",
      "max_probes_per_answer",
      "max_probes_per_session",
      "question_not_target",
      "question_blocked",
      "user_declined"
    ]
  }'::jsonb,
  '{
    "channel": "line",
    "tone": "natural_japanese",
    "max_characters_per_message": 80,
    "max_sentences": 2
  }'::jsonb,
  'product_feedback',
  now(),
  '{
    "version": "v1",
    "template_key": "product_feedback",
    "project_goal": "20代女性の飲料利用体験と不満を理解する",
    "user_understanding_goal": "利用シーン、評価、不満、改善要望を把握する",
    "required_slots": [
      {"key":"product_name","label":"商品名","required":true,"description":"話題にしている飲料名","examples":["午後の紅茶","無糖アイスコーヒー"]},
      {"key":"usage_scene","label":"利用シーン","required":true,"description":"どんな場面で飲むか","examples":["通勤中","仕事の休憩中"]},
      {"key":"good_point","label":"良かった点","required":true,"description":"満足している点","examples":["飲みやすい","気分転換になる"]}
    ],
    "optional_slots": [
      {"key":"bad_point","label":"不満点","required":false,"description":"不便や不満","examples":["甘すぎる","量が少ない"]},
      {"key":"improvement_request","label":"改善要望","required":false,"description":"改善してほしいこと","examples":["甘さ控えめ","持ち運びしやすい容器"]}
    ],
    "question_categories": ["事実確認","利用状況","評価","不満","改善要望"],
    "probe_policy": {
      "default_max_probes": 1,
      "force_probe_on_bad": true,
      "strict_topic_lock": true,
      "allow_followup_expansion": false
    },
    "completion_rule": {
      "required_slots_needed": ["product_name","usage_scene","good_point"],
      "allow_finish_without_optional": true,
      "min_required_slots_to_finish": 3
    },
    "topic_control": {
      "forbidden_topic_shift": true,
      "topic_lock_note": "飲料利用体験から逸脱しない"
    },
    "language": "ja"
  }'::jsonb
)
on conflict (id) do update set
  name                  = excluded.name,
  client_name           = excluded.client_name,
  objective             = excluded.objective,
  status                = excluded.status,
  reward_points         = excluded.reward_points,
  research_mode         = excluded.research_mode,
  primary_objectives    = excluded.primary_objectives,
  secondary_objectives  = excluded.secondary_objectives,
  comparison_constraints = excluded.comparison_constraints,
  prompt_rules          = excluded.prompt_rules,
  probe_policy          = excluded.probe_policy,
  response_style        = excluded.response_style,
  ai_state_template_key = excluded.ai_state_template_key,
  ai_state_generated_at = excluded.ai_state_generated_at,
  ai_state_json         = excluded.ai_state_json;

insert into reward_rules (rule_code, rule_name, rule_type, project_id, points, is_active, config_json)
values
  ('first_completion_bonus',    '初回参加ボーナス',   'global',  null,                                     20, true, '{}'::jsonb),
  ('continuity_completion_bonus','継続参加ボーナス',  'global',  null,                                     10, true, '{"daysWindow":30}'::jsonb),
  ('project_completion_bonus',  '特定案件ボーナス',   'project', '00000000-0000-4000-8000-000000000001',  5,  true, '{}'::jsonb)
on conflict (rule_code, project_id) do update set
  rule_name   = excluded.rule_name,
  points      = excluded.points,
  is_active   = excluded.is_active,
  config_json = excluded.config_json;

delete from questions where project_id = '00000000-0000-4000-8000-000000000001';

insert into questions (
  project_id, question_code, question_text, question_role, question_type,
  is_required, sort_order, branch_rule, question_config, ai_probe_enabled
) values
  (
    '00000000-0000-4000-8000-000000000001', 'Q1',
    '最近よく飲む飲料カテゴリを教えてください。',
    'screening', 'single_choice', true, 1, null,
    '{"options":[{"value":"tea","label":"お茶"},{"value":"coffee","label":"コーヒー"},{"value":"water","label":"水"},{"value":"energy","label":"エナジードリンク"},{"value":"other","label":"その他"}]}'::jsonb,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000001', 'Q2',
    'その飲料を飲む主な場面を教えてください。',
    'main', 'free_text_long', true, 2, null,
    '{"helpText":"例: 通勤中、仕事中、家でリラックス時","conversationControl":{"probeIntent":"飲用シーンを比較可能な形でそろえる","coreInfoPrompt":"比較のため、よく飲む場面を いつ・どこで のどちらかで教えてください。","answerExample":"平日の午後に職場で飲みます","shortAnswerMinLength":10,"sufficientAnswerMinLength":20}}'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000001', 'Q3',
    'その飲料を選ぶ一番大きな理由は何ですか。',
    'comparison_core', 'free_text_long', true, 3, null,
    '{"helpText":"例: 味、眠気対策、健康、習慣","conversationControl":{"probeIntent":"選択理由の比較用コア情報をそろえる","coreInfoPrompt":"比較のため、一番重視する点を一言で教えてください。","answerExample":"味が好みに合うからです","shortAnswerMinLength":8,"sufficientAnswerMinLength":18}}'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000001', 'Q4',
    '今使っている商品やブランドに不満はありますか。',
    'attribute', 'single_choice', true, 4,
    '[{"when":{"operator":"equals","value":false},"targetQuestionCode":"Q6"}]'::jsonb,
    null, false
  ),
  (
    '00000000-0000-4000-8000-000000000001', 'Q5',
    'どのような不満がありますか。できるだけ具体的に教えてください。',
    'probe_trigger', 'free_text_long', true, 5, null,
    '{"helpText":"例: 値段、味、容量、買いやすさ","conversationControl":{"probeIntent":"不満の比較軸をそろえる","coreInfoPrompt":"比較のため、どの点がいちばん不満か一言で教えてください。","answerExample":"甘すぎるところです","shortAnswerMinLength":8,"sufficientAnswerMinLength":18}}'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000001', 'Q6',
    '今の選択肢が使えないとき、代わりに何を選びますか。',
    'main', 'free_text_long', true, 6, null,
    '{"conversationControl":{"probeIntent":"代替選択肢の比較用コア情報を取る","coreInfoPrompt":"比較のため、代わりに選ぶものを一つ教えてください。","answerExample":"無糖の炭酸水です","shortAnswerMinLength":8,"sufficientAnswerMinLength":16}}'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000001', 'Q7',
    '総合満足度を教えてください。',
    'comparison_core', 'numeric', true, 7, null,
    '{"scaleMin":1,"scaleMax":5,"scaleLabels":{"1":"不満","5":"満足"}}'::jsonb,
    false
  );

insert into questions (
  project_id, question_code, question_text, question_role, question_type,
  is_required, sort_order, branch_rule, question_config,
  ai_probe_enabled, is_system, is_hidden
) values (
  '00000000-0000-4000-8000-000000000001',
  '__free_comment__',
  '最後に、設問に入っていないことでも、感じたことや伝えておきたいことがあれば自由に教えてください。短くても大丈夫です。',
  'free_comment', 'free_text_long', true, 8,
  null, '{"placeholder":"自由に入力してください"}'::jsonb,
  false, true, true
)
on conflict (project_id, question_code) do update set
  question_text    = excluded.question_text,
  question_role    = excluded.question_role,
  question_type    = excluded.question_type,
  is_required      = excluded.is_required,
  sort_order       = excluded.sort_order,
  question_config  = excluded.question_config,
  ai_probe_enabled = excluded.ai_probe_enabled,
  is_system        = excluded.is_system,
  is_hidden        = excluded.is_hidden;
