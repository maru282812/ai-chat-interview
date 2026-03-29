create table if not exists user_posts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  respondent_id uuid references respondents(id) on delete set null,
  type text not null,
  project_id uuid references projects(id) on delete set null,
  session_id uuid references sessions(id) on delete set null,
  answer_id uuid references answers(id) on delete set null,
  source_channel text not null default 'line',
  source_mode text,
  menu_action_key text,
  title text,
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  posted_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_posts_type_check
    check (type in ('survey', 'interview', 'rant', 'diary', 'free_comment')),
  constraint user_posts_source_channel_check
    check (source_channel in ('line', 'liff', 'admin', 'system'))
);

create table if not exists post_analysis (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null unique references user_posts(id) on delete cascade,
  analysis_version text not null default 'v1',
  summary text,
  tags jsonb not null default '[]'::jsonb,
  sentiment text not null default 'neutral',
  sentiment_score numeric(5, 4),
  keywords jsonb not null default '[]'::jsonb,
  mentioned_brands jsonb not null default '[]'::jsonb,
  pii_flags jsonb not null default '[]'::jsonb,
  actionability text not null default 'medium',
  personality_signals jsonb not null default '[]'::jsonb,
  behavior_signals jsonb not null default '[]'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  analyzed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint post_analysis_sentiment_check
    check (sentiment in ('positive', 'neutral', 'negative', 'mixed')),
  constraint post_analysis_actionability_check
    check (actionability in ('high', 'medium', 'low'))
);

create table if not exists user_personality_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id text not null,
  respondent_id uuid references respondents(id) on delete set null,
  latest_post_id uuid references user_posts(id) on delete set null,
  summary text,
  traits jsonb not null default '[]'::jsonb,
  segments jsonb not null default '[]'::jsonb,
  confidence numeric(5, 4),
  evidence_post_ids jsonb not null default '[]'::jsonb,
  raw_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists line_menu_actions (
  id uuid primary key default gen_random_uuid(),
  menu_key text not null unique,
  label text not null,
  action_type text not null,
  action_payload jsonb not null default '{}'::jsonb,
  liff_path text,
  icon_key text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  audience_rule jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint line_menu_actions_action_type_check
    check (
      action_type in (
        'start_project_list',
        'resume_project',
        'open_post_mode',
        'open_liff',
        'show_mypage',
        'show_personality'
      )
    )
);

create table if not exists liff_entrypoints (
  id uuid primary key default gen_random_uuid(),
  entry_key text not null unique,
  title text not null,
  path text not null,
  entry_type text not null,
  settings_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint liff_entrypoints_entry_type_check
    check (entry_type in ('rant', 'diary', 'mypage', 'personality', 'survey_support'))
);

create index if not exists idx_user_posts_user_created
  on user_posts(user_id, created_at desc);
create index if not exists idx_user_posts_project_type_created
  on user_posts(project_id, type, created_at desc);
create index if not exists idx_user_posts_session_created
  on user_posts(session_id, created_at desc);
create unique index if not exists idx_user_posts_answer_unique
  on user_posts(answer_id)
  where answer_id is not null;

create index if not exists idx_post_analysis_sentiment_actionability
  on post_analysis(sentiment, actionability, analyzed_at desc);
create index if not exists idx_post_analysis_tags_gin
  on post_analysis using gin (tags);
create index if not exists idx_post_analysis_keywords_gin
  on post_analysis using gin (keywords);

create unique index if not exists idx_user_personality_profiles_user
  on user_personality_profiles(user_id);

create index if not exists idx_line_menu_actions_active_sort
  on line_menu_actions(is_active, sort_order);
create index if not exists idx_liff_entrypoints_active_type
  on liff_entrypoints(is_active, entry_type);

drop trigger if exists trg_user_posts_updated_at on user_posts;
create trigger trg_user_posts_updated_at before update on user_posts
for each row execute function set_updated_at();

drop trigger if exists trg_post_analysis_updated_at on post_analysis;
create trigger trg_post_analysis_updated_at before update on post_analysis
for each row execute function set_updated_at();

drop trigger if exists trg_user_personality_profiles_updated_at on user_personality_profiles;
create trigger trg_user_personality_profiles_updated_at before update on user_personality_profiles
for each row execute function set_updated_at();

drop trigger if exists trg_line_menu_actions_updated_at on line_menu_actions;
create trigger trg_line_menu_actions_updated_at before update on line_menu_actions
for each row execute function set_updated_at();

drop trigger if exists trg_liff_entrypoints_updated_at on liff_entrypoints;
create trigger trg_liff_entrypoints_updated_at before update on liff_entrypoints
for each row execute function set_updated_at();

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
  p.created_at,
  a.summary,
  a.tags,
  a.sentiment,
  a.keywords,
  a.mentioned_brands,
  a.pii_flags,
  a.actionability
from user_posts p
left join post_analysis a on a.post_id = p.id
where p.type in ('free_comment', 'rant', 'diary');
