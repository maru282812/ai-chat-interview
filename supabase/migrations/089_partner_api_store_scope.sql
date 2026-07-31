-- 089_partner_api_store_scope.sql
-- パートナーAPI（/api/partner/*・docs/partner-api.md）向けの所有者スコープ列を追加する。
--
-- 背景:
--   会員ポータル（hibi-portal / X-Partner-Key 認証）から作成されたアンケートは、
--   「どの店舗のものか」をサーバー側で持たないと、:id 指定の更新/公開/集計/締切で
--   他店舗のアンケートを触れてしまう。partner_store_id にポータル側の stores.id を
--   記録し、パートナーAPI の全 :id 系エンドポイントで一致検証する。
--
-- 既存 clients.id とは別軸で持つ理由:
--   clients は ai-chat-interview 側の企業/店舗マスタ（管理画面が手動で作る）で、
--   ポータル側 Supabase の stores.id とは別の DB・別の採番。既存列の意味を変えず
--   （破壊的変更をせず）ポータル起点の所有者だけを新列で表現する。
--
-- 追加のみ。既存列の型変更・削除は行わない。

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS partner_store_id text;

COMMENT ON COLUMN projects.partner_store_id IS
  'パートナーAPI（hibi-portal）経由で作成された案件の所有店舗ID。ポータル側 stores.id。NULL は非パートナー案件。';

-- 所有者スコープでの一覧・所有チェックの索引。パートナー案件のみを対象にする部分index。
CREATE INDEX IF NOT EXISTS ix_projects_partner_store_id
  ON projects(partner_store_id)
  WHERE partner_store_id IS NOT NULL;
