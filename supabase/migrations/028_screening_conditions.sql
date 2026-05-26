-- -------------------------------------------------------
-- 028: スクリーニング条件テーブル追加
-- -------------------------------------------------------

-- screening_conditions: プロフィール条件・回答条件を柔軟に定義するテーブル
create table if not exists screening_conditions (
  id             uuid        primary key default gen_random_uuid(),
  project_id     uuid        not null references projects(id) on delete cascade,
  condition_type text        not null check (condition_type in ('profile', 'question')),
  target_key     text        not null,  -- profile: フィールド名, question: question_code
  operator       text        not null check (operator in ('equals', 'not_equals', 'in', 'not_in', 'gte', 'lte', 'between')),
  value_json     jsonb       not null default '{}',  -- 比較値（単値 or 配列 or [min,max]）
  priority       integer     not null default 0,
  created_at     timestamptz not null default now()
);

create index if not exists idx_screening_conditions_project on screening_conditions(project_id);

-- RLS 有効化（service_role は bypass するが明示的に設定）
alter table screening_conditions enable row level security;

-- service_role / authenticated / anon への権限付与
grant select, insert, update, delete on table screening_conditions to service_role, authenticated, anon;

-- service_role bypass policy
create policy "service_role_all" on screening_conditions
  as permissive for all
  to service_role
  using (true)
  with check (true);

-- -------------------------------------------------------
-- sessions.state_json に screening フィールドを追加する
-- （state_json は JSONB なので migration 不要、TypeScript 型のみ更新）
-- -------------------------------------------------------
-- screening_result: 'pass' | 'fail'
-- screening_failed_conditions: string[]（失敗した条件の説明）
-- screening_judged_at: timestamptz
-- mypage_confirmed_at: timestamptz
