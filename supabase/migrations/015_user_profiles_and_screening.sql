-- user_profiles: LINE ユーザー単位の基本情報テーブル
create table if not exists user_profiles (
  id uuid primary key default gen_random_uuid(),
  line_user_id text not null unique,
  nickname text,
  birth_date date,
  prefecture text,
  address_detail text,
  address_registered_at timestamptz,
  address_declined boolean not null default false,
  occupation text,
  occupation_updated_at timestamptz,
  industry text,
  marital_status text,
  has_children boolean,
  children_ages integer[] not null default '{}',
  household_composition text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint user_profiles_marital_status_check
    check (marital_status in ('single', 'married', 'divorced', 'widowed') or marital_status is null)
);

drop trigger if exists trg_user_profiles_updated_at on user_profiles;
create trigger trg_user_profiles_updated_at before update on user_profiles
for each row execute function set_updated_at();

create index if not exists idx_user_profiles_line_user_id on user_profiles(line_user_id);

-- projects: スクリーニング設定を追加
-- screening_config: { pass_message, fail_message, pass_action: 'survey'|'interview'|'manual_hold' }
alter table projects add column if not exists screening_config jsonb;

-- projects: スクリーニング終了質問番号（先頭からこの sort_order までをスクリーニング扱い）
alter table projects add column if not exists screening_last_question_order integer;

-- project_assignments: スクリーニング結果を追加
alter table project_assignments add column if not exists screening_result text;
alter table project_assignments add column if not exists screening_result_at timestamptz;

alter table project_assignments drop constraint if exists project_assignments_screening_result_check;
alter table project_assignments add constraint project_assignments_screening_result_check
  check (screening_result in ('passed', 'failed') or screening_result is null);
