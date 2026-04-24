-- ============================================================
-- 018: project_assignments.delivery_channel カラム追加
-- 目的: 案件配信チャネルを記録する。
--      liff = LIFF専用画面で回答、line = LINEトーク上で回答
-- ============================================================

alter table project_assignments
  add column if not exists delivery_channel text not null default 'liff'
  check (delivery_channel in ('liff', 'line'));

comment on column project_assignments.delivery_channel is
  '配信チャネル: liff = LIFF画面から開始、line = LINEトーク上で質問を進める';
