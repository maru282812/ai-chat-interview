-- 083_experience_settings.sql
-- 若年層体験パック Phase 0: 体験設定の基盤（docs/spec-young-experience-pack.md）
--
-- 決定順: projects.experience_config[key] → app_settings('experience_defaults')[key] → コード内デフォルト。
-- 解決は必ずサーバー（src/lib/experienceConfig.ts の resolveExperience）で行い、LIFF へは解決済み値だけを渡す。
--
-- 破壊性: なし（新規テーブル＋additive カラムのみ）。rollback は drop table / drop column。

-- ── グローバル設定（key-value・サーバー専用）────────────────────────────
create table if not exists app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

comment on table app_settings is
  'サーバー専用のグローバル key-value 設定。現行キー: experience_defaults（若年層体験パックの全体既定）。';

alter table app_settings enable row level security;

-- policy を作らない＝anon / authenticated からは全拒否。読み書きは service_role のみ。
-- （074 の GRANT 漏れ事件の再発防止のため grant を明記する）
grant select, insert, update on app_settings to service_role;

insert into app_settings (key, value) values ('experience_defaults', '{}'::jsonb)
on conflict (key) do nothing;

-- ── プロジェクト単位の上書き ─────────────────────────────────────────
alter table projects
  add column if not exists experience_config jsonb not null default '{}'::jsonb;

comment on column projects.experience_config is
  '若年層体験パックのプロジェクト上書き。キーは src/lib/experienceConfig.ts の EXPERIENCE_KEYS。空={}=全て全体既定に従う';
