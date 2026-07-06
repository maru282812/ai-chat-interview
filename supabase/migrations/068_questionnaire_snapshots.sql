-- ============================================================
-- 068: 調査票スナップショット（統計エクスポート §1 / §14）
-- 送付/公開時点の設問構成（順序・選択肢・分岐・依存・クリーニング定義）を
-- バージョンつきで凍結保存する。回答後に管理画面で設問を変えても、
-- 出力・集計は回答時点のスナップショットを基準にできる。
--
-- definition_json には buildSnapshotDefinition() の出力（codebook 込み）を保存する。
-- snapshot_hash は内容ハッシュ。同一内容なら版を増やさず再利用する。
-- sessions.snapshot_id は任意（NULL 可）。未設定時は export 側で
-- 「started_at 時点で有効なスナップショット」に時刻解決する（後方互換）。
-- ============================================================

CREATE TABLE IF NOT EXISTS questionnaire_snapshots (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version         integer     NOT NULL,
  wave_code       text,
  snapshot_hash   text        NOT NULL,
  definition_json jsonb       NOT NULL,
  is_active       boolean     NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, version)
);

CREATE INDEX IF NOT EXISTS idx_questionnaire_snapshots_project_created
  ON questionnaire_snapshots(project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS ux_questionnaire_snapshots_project_hash
  ON questionnaire_snapshots(project_id, snapshot_hash);

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS snapshot_id uuid REFERENCES questionnaire_snapshots(id) ON DELETE SET NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON questionnaire_snapshots TO service_role, authenticated, anon;
