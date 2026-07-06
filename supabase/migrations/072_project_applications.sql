-- 072_project_applications.sql
-- 案件検索サイト化 Phase 1: 応募モデル（docs/plan-site-implementation.md）
-- ユーザーが「探す」から自分で応募できるようにする。応募＝assignment発行のリクエストであり、
-- assignment の発行判断は常にサーバー側（apply_mode='auto' は即時発行、'manual' は管理者選考）。

-- ---- projects: 検索サイト表示・応募制御用カラム ----
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS tags             text[]      NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ng_conditions    text,
  ADD COLUMN IF NOT EXISTS recruit_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS apply_mode       text        NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS interview_format text;

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_apply_mode_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_apply_mode_check
    CHECK (apply_mode IN ('manual', 'auto'));

-- ---- project_applications: 応募 ----
-- line_user_id と respondent_id を併記する（将来の非LINE認証移行時に uuid 側だけで辿れるようにする規律）。
-- respondent_id は auto 応募で assignment 発行時に埋まる。manual は当選時に埋まる。
CREATE TABLE IF NOT EXISTS project_applications (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  line_user_id   text        NOT NULL,
  respondent_id  uuid        REFERENCES respondents(id) ON DELETE SET NULL,
  status         text        NOT NULL DEFAULT 'applied',
  assignment_id  uuid        REFERENCES project_assignments(id) ON DELETE SET NULL,
  note           text,
  applied_at     timestamptz NOT NULL DEFAULT now(),
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT project_applications_status_check
    CHECK (status IN ('applied', 'accepted', 'rejected', 'withdrawn', 'expired')),
  -- 重複応募の最終防衛線（rejected 後の再応募も不可＝仕様）
  CONSTRAINT ux_project_applications_project_user UNIQUE (project_id, line_user_id)
);

-- 当月応募数（n/10件表示）・ユーザー別一覧用
CREATE INDEX IF NOT EXISTS ix_project_applications_user_applied
  ON project_applications(line_user_id, applied_at DESC);
-- 案件別の応募一覧・枠数カウント用
CREATE INDEX IF NOT EXISTS ix_project_applications_project_status
  ON project_applications(project_id, status);

-- アプリは service_role キーで接続するため service_role への付与が必須
GRANT SELECT, INSERT, UPDATE, DELETE ON project_applications TO service_role, authenticated, anon;
