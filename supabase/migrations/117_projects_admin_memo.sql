-- 117_projects_admin_memo.sql
-- 案件に運営者用のメモ欄を追加する。
--
-- 背景:
--   店舗展開で案件が「店舗数 × A/B/C」＋コピーで増え、一覧に同名の案件が並ぶ
--   （例:「【コーヒー】店舗アンケート (Copy)」が draft と published で2件）。
--   どれが何のための案件か（検証用・差し替え前・先方確認待ち 等）を残す場所が無かった。
--
-- 方針:
--   運営だけが見る自由テキスト。回答者・店舗（パートナーAPI）には一切出さない。
--   copyProject は列を明示列挙しているので、コピー先には引き継がれない（意図どおり）。
--
-- GRANT: 列の追加はテーブルの権限を引き継ぐので個別の GRANT は不要
--        （108_project_completion_message.sql と同じ）。
-- 冪等: add column if not exists。
-- rollback: ALTER TABLE projects DROP COLUMN IF EXISTS admin_memo;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS admin_memo text;

COMMENT ON COLUMN projects.admin_memo IS
  '運営者メモ（管理画面の案件一覧でのみ表示・編集）。回答者や店舗には出さない。NULL はメモなし。';
