-- 085_admin_ai_pending_actions.sql
-- 管理画面AIチャット Phase 4: Tier C（不可逆・対外）操作の承認待ち台帳
-- （docs/impl-admin-ai-chat.md / docs/plan-admin-ai-chat.md）
--
-- 設計の要点:
-- - AI は Tier C を実行できない。実行できるのは「人間がチャット内の承認カードを押したとき」だけ。
--   そのための承認トークン＝この行の id。**id は AI に渡さず、API レスポンスの封筒に載せて
--   ブラウザにだけ返す**（AI の出力に承認トークンを含められない構造にする）。
-- - impact_json / target_count は AI の申告値ではなく、prepare() がサーバー側で計算した値。
--   承認実行時にも再計算して突き合わせる（P0-3: 推定と実行対象がロジック分離していた事故の再発防止）。
-- - 使い捨て: consumed_at が入った行は再実行できない（承認カードの二度押し・リプレイ防止）。
--
-- 破壊性: なし（新規テーブルのみ）。rollback は drop table。

create table if not exists admin_ai_pending_actions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  -- 有効期限。切れた承認カードは押しても実行されない（画面を放置したまま押す事故を防ぐ）
  expires_at timestamptz not null default now() + interval '30 minutes',
  screen_key text not null,
  entity_id text,
  -- 承認カードを出すきっかけになったユーザー指示（先頭500字）
  instruction text not null,
  tool_name text not null,
  tool_args_json jsonb not null default '{}'::jsonb,
  -- prepare() がサーバー側で作った確認内容
  summary text not null,
  impact_json jsonb not null default '[]'::jsonb,
  target_count integer,
  -- 承認して実行した時刻。入っている行は再実行不可
  consumed_at timestamptz,
  consumed_result text
);

comment on table admin_ai_pending_actions is
  '管理画面AIチャットの Tier C 操作の承認待ち。id が承認トークンを兼ねるため AI には渡さない。consumed_at 済みは再実行不可。';

create index if not exists idx_admin_ai_pending_actions_created_at
  on admin_ai_pending_actions (created_at desc);

alter table admin_ai_pending_actions enable row level security;

-- policy を作らない＝anon / authenticated からは全拒否。読み書きは service_role のみ。
-- （074 の GRANT 漏れ事件の再発防止のため grant を明記する）
grant select, insert, update on admin_ai_pending_actions to service_role;
