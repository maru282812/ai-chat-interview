-- ============================================================
-- 070: コンセプト・ローテーション（統計エクスポート §3 L1・ラテン方格）
-- 複数コンセプト（例: おいしさ重視P / 品質重視Q / 価格重視R）＝同一アンケートを
-- 1人が全部回答し、提示順を回答者ごとにラテン方格でローテーションする。
--
-- 後方互換: project_concepts が無い案件は従来どおり（単一コンセプト）。
-- answers.concept_code が NULL の回答は単一コンセプト扱い。
-- ============================================================

CREATE TABLE IF NOT EXISTS project_concepts (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  concept_code text        NOT NULL,
  title        text,
  description  text,
  master_order integer     NOT NULL DEFAULT 0,
  is_active    boolean     NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, concept_code)
);

CREATE INDEX IF NOT EXISTS idx_project_concepts_project_order
  ON project_concepts(project_id, master_order);

-- ローテーション方式: off=単一 / latin=ラテン方格 / full=全順列
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS concept_rotation_mode text NOT NULL DEFAULT 'off';
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_concept_rotation_mode_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_concept_rotation_mode_check
    CHECK (concept_rotation_mode IN ('off', 'latin', 'full'));

-- 回答がどのコンセプトに対するものか
ALTER TABLE answers
  ADD COLUMN IF NOT EXISTS concept_code text;

-- 回答者(セッション)に割り当てたコンセプト提示順（["P","Q","R"] 等）
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS concept_order_json jsonb;

DROP TRIGGER IF EXISTS trg_project_concepts_updated_at ON project_concepts;
CREATE TRIGGER trg_project_concepts_updated_at BEFORE UPDATE ON project_concepts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON project_concepts TO service_role, authenticated, anon;
