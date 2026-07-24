-- 084_admin_ai_actions.sql
-- 管理画面AIチャット Phase 1: AI が実行したツール操作の監査台帳
-- （docs/impl-admin-ai-chat.md / docs/plan-admin-ai-chat.md）
--
-- 目的: チャットから AI がツールを実行する構成では「誰の指示で・どのツールが・何を返したか」が
-- 残らないと事故時に追跡できない。管理画面には元々操作者記録が無い（レビュー P1-7）ため、
-- AI 経由の操作から先に記録を整える。
--
-- tier は実行時の危険度ゲート（A=読み取り / B=戻せる書き込み / C=不可逆・対外）。
-- Phase 1 では A のみ実行され、B/C は result_status='blocked' で記録される。
--
-- 破壊性: なし（新規テーブルのみ）。rollback は drop table。

create table if not exists admin_ai_actions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- どの画面のチャットから実行されたか（toolRegistry の screenKey）
  screen_key text not null,
  -- 画面が対象にしているレコード（案件ID / セッションID 等・画面により意味が変わるため text）
  entity_id text,
  -- 実行の発端になったユーザー指示（先頭500字にトリムして保存）
  instruction text not null,
  tool_name text not null,
  tool_args_json jsonb not null default '{}'::jsonb,
  tier text not null check (tier in ('A', 'B', 'C')),
  -- Tier C の承認カード経由なら true / A・B は null
  approved boolean,
  result_status text not null check (result_status in ('ok', 'error', 'blocked')),
  -- 結果またはエラーの要約（先頭500字）
  result_summary text,
  -- 同一チャット応答の ai_logs 行との突合用
  ai_log_id uuid
);

comment on table admin_ai_actions is
  '管理画面AIチャットが実行したツール操作の監査台帳。tier=危険度ゲート、result_status=blocked は Tier ゲートで拒否された実行。';

create index if not exists idx_admin_ai_actions_created_at
  on admin_ai_actions (created_at desc);
create index if not exists idx_admin_ai_actions_screen_key
  on admin_ai_actions (screen_key, created_at desc);

alter table admin_ai_actions enable row level security;

-- policy を作らない＝anon / authenticated からは全拒否。読み書きは service_role のみ。
-- （074 の GRANT 漏れ事件の再発防止のため grant を明記する）
grant select, insert on admin_ai_actions to service_role;
