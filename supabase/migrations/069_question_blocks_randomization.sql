-- ============================================================
-- 069: ブロックとランダム化（統計エクスポート §3 / §22）
-- 設問をブロック単位で管理し、ブロック単位/ブロック内のランダム化を可能にする。
-- ランダム化の再現性のため、回答者(セッション)ごとに乱数シードと実表示順を保存する。
--
-- 後方互換: question_blocks が未設定なら従来どおりマスター順（sort_order）。
-- sessions.display_order_json が NULL のセッションは export でマスター順にフォールバック。
-- ============================================================

CREATE TABLE IF NOT EXISTS question_blocks (
  id                       uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id               uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  block_code               text        NOT NULL,
  title                    text,
  master_order             integer     NOT NULL DEFAULT 0,
  -- このブロック自体をブロック間ランダム化の対象にするか
  is_randomizable          boolean     NOT NULL DEFAULT false,
  -- ブロック内の設問順をランダム化するか
  randomize_within         boolean     NOT NULL DEFAULT false,
  -- ブロック内の設問順を固定する（randomize_within より優先）
  fix_within               boolean     NOT NULL DEFAULT false,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, block_code)
);

CREATE INDEX IF NOT EXISTS idx_question_blocks_project_order
  ON question_blocks(project_id, master_order);

-- 設問→ブロック紐づけ（NULL = 未割当。question_page_groups を初期ブロック候補として扱える §12）
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS block_id uuid REFERENCES question_blocks(id) ON DELETE SET NULL;

-- 再現性（§22）と実表示順の記録（§3）。display_order_json は { question_id: position }。
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS randomization_seed text,
  ADD COLUMN IF NOT EXISTS display_order_json jsonb;

DROP TRIGGER IF EXISTS trg_question_blocks_updated_at ON question_blocks;
CREATE TRIGGER trg_question_blocks_updated_at BEFORE UPDATE ON question_blocks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

GRANT SELECT, INSERT, UPDATE, DELETE ON question_blocks TO service_role, authenticated, anon;
