-- 073_fix_project_favorites_grant.sql
-- 040_project_discovery.sql で作成した project_favorites に GRANT が無く、
-- 「permission denied for table project_favorites」で探す一覧APIが落ちる問題の修正。
-- （065 の clients と同類。アプリは service_role キーで接続するため付与が必須）

GRANT SELECT, INSERT, UPDATE, DELETE ON project_favorites TO service_role, authenticated, anon;
