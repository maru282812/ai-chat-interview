-- 120_projects_is_demo.sql
-- 案件に「デモ」フラグを追加する。
--
-- 背景:
--   営業・説明の場で同じアンケートを何度も回答して体験を見せたい。
--   本番案件の二重回答防止を緩めると、ポイント付与・ABCサイクルの B/C 予約・
--   キャンペーン完了数・集計がすべて連動して壊れるため、案件単位で切り分ける。
--
-- 方針（is_demo = true の案件）:
--   - 何度でも 1 問目から回答し直せる（完了済みでも次回は新しいセッション）
--   - ポイントは必ず 0（付与処理の側で止める＝設定ミスでも付与されない）
--   - ABC サイクルに属していても周を作らない＝ A だけで完結（B/C は予約されない）
--   - 完了の LINE 通知・キャンペーン完了数を動かさない
--   - 統計・エクスポート・店舗開示・公開一覧には出さない
--   - デモの回答は 30 日で自動削除（cron）
--
-- GRANT: 列の追加はテーブルの権限を引き継ぐので個別の GRANT は不要
--        （117_projects_admin_memo.sql と同じ）。
-- 冪等: add column if not exists。
-- rollback: ALTER TABLE projects DROP COLUMN IF EXISTS is_demo;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN projects.is_demo IS
  'デモ案件。true なら繰り返し回答可・ポイント0・サイクル不参加・統計/開示/公開一覧から除外・回答は30日で自動削除。';
