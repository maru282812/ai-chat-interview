-- 既存の active → published に移行
UPDATE projects
SET status = 'published'
WHERE status = 'active';

-- 既存制約が存在する場合は事前に削除
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_status_check;

-- 新しい6状態制約を追加
ALTER TABLE projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('draft', 'ready', 'published', 'paused', 'closed', 'archived'));

-- anon / authenticated ロールへのアクセス権は既存の grant 設定を継承するため追加不要
