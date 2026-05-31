-- 040_project_discovery.sql
-- 案件一覧・保存機能のためのDB拡張

-- projects テーブルに公開・表示用カラム追加
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS is_discoverable boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS display_thumbnail_url text,
  ADD COLUMN IF NOT EXISTS estimated_minutes integer,
  ADD COLUMN IF NOT EXISTS max_respondents integer;

-- ユーザーの案件保存（お気に入り）テーブル
CREATE TABLE IF NOT EXISTS project_favorites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id text NOT NULL,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(line_user_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_project_favorites_user    ON project_favorites(line_user_id);
CREATE INDEX IF NOT EXISTS idx_project_favorites_project ON project_favorites(project_id);

-- anon / authenticated ロールへの権限付与
GRANT SELECT, INSERT, DELETE ON project_favorites TO anon, authenticated;
