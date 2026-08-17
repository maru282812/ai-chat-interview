-- 093_survey_cycles.sql
--
-- 同じ人が同じ案件群を「繰り返し」回答できるようにし、離脱率を計測する（美容室ABCサイクル）。
--
-- 背景:
--   美容室では A（来店理由）→ B（来店後の満足度）→ C（離脱検証）を1周とし、
--   再来店のたびに A から周回する（A→B→C→A→B…）。
--   従来は project_assignments の unique(project_id, respondent_id) により
--   1案件1回しか回答できず、周回そのものが成立しなかった。
--
-- なぜ assignment に「回次」を持たせないのか:
--   A/B/C は別案件なので、案件ごとの回次では「Aの2周目」と「Bの1周目」が
--   同じ周回なのかを繋げられない。離脱率は案件をまたぐ横串の指標なので、
--   周回（サイクル）そのものを実体化し、assignment をそこへ紐づける。
--
-- 離脱の定義:
--   A の回答日 + A-Q11（来店頻度）の日数 + 猶予 を過ぎても A の再回答が無い ＝ 離脱疑い。
--   → C（離脱検証アンケート）を送付する。
--   次の A が来た時点で「離脱していない」が確定するので、C の送付予定は取り消す。
--   C に来ないこと自体は離脱ではない（C は離脱を「測る」ための調査）。
--
-- 破壊性: **あり**（project_assignments の UNIQUE 制約を張り替える）。
--   既存行は cycle_id = NULL のまま。PostgreSQL の UNIQUE は NULL を重複扱いしないため、
--   サイクルに属さない案件の「1回だけ」はDB制約では守られなくなる。
--   これはアプリ層の status='completed' ゲート（liffController surveyPage）が引き続き守る。
-- rollback: 末尾の ROLLBACK 手順を参照。

-- ------------------------------------------------------------------
-- 1. サイクル定義（どの案件群を1周とするか）
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS cycle_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  client_id uuid REFERENCES clients(id) ON DELETE SET NULL,
  -- 周回の起点となる案件（A）。この案件の完了が新しいサイクルを開始する。
  entry_project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- 離脱検証案件（C）。NULL なら離脱検証を行わない（A→B だけのグループ）。
  followup_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  -- 頻度期間に上乗せする猶予日数。「2か月」の人を61日目に離脱扱いしないための緩衝。
  grace_days int NOT NULL DEFAULT 7,
  -- 来店頻度が「特に決まっていない」(undecided) 場合に使う日数。
  undecided_days int NOT NULL DEFAULT 60,
  -- A の再回答で新サイクルを開始できるようになるまでの最短間隔。
  -- QR連打によるポイント二重取りと、サイクルの水増しを防ぐ。
  restart_cooldown_days int NOT NULL DEFAULT 25,
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE cycle_groups IS
  'A→B→C を1周とする繰り返しアンケートの定義 (Migration 093)。';
COMMENT ON COLUMN cycle_groups.restart_cooldown_days IS
  'A 再回答で新サイクルを開始できる最短間隔（日）。既定25日。'
  'これ未満の A 再訪は新サイクルを作らず、開いているサイクルへの再回答として扱う。';
COMMENT ON COLUMN cycle_groups.undecided_days IS
  '来店頻度が undecided のときに離脱判定へ使う日数。既定60日。';

-- サイクルを構成するステップ（A/B/C）。
-- 案件は複数グループに属さない前提（1案件=1グループ）で UNIQUE を張る。
CREATE TABLE IF NOT EXISTS cycle_group_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_group_id uuid NOT NULL REFERENCES cycle_groups(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  step_order int NOT NULL,
  -- entry=A（起点） / followup=B（来店後） / verify=C（離脱検証）
  step_role text NOT NULL CHECK (step_role IN ('entry', 'followup', 'verify')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_group_id, project_id),
  UNIQUE (cycle_group_id, step_order)
);

-- 1案件が複数グループに属すると「どのサイクルの回答か」が一意に決まらないため禁止する。
CREATE UNIQUE INDEX IF NOT EXISTS ux_cycle_group_steps_project
  ON cycle_group_steps (project_id);

-- ------------------------------------------------------------------
-- 2. サイクル実体（誰の・第何周か）
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS survey_cycles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_group_id uuid NOT NULL REFERENCES cycle_groups(id) ON DELETE CASCADE,
  -- respondent は案件ごとに別レコードなので、周回の主体は line_user_id で持つ。
  line_user_id text NOT NULL,
  cycle_no int NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),

  -- 離脱判定（A 完了時に確定する）
  frequency_code text,               -- A-Q11 の選択肢コード（within_3w 等）
  expected_return_at timestamptz,    -- A完了日 + 頻度日数 + grace_days
  followup_sent_at timestamptz,      -- C を送付した時刻
  returned_at timestamptz,           -- 次の A が来た時刻（= 離脱していない証拠）

  closed_at timestamptz,
  -- returned=再来店で確定 / churn_confirmed=期間超過で離脱 / restarted=途中でA再訪 / completed=定義の最終ステップ完了
  close_reason text CHECK (
    close_reason IS NULL
    OR close_reason IN ('returned', 'churn_confirmed', 'restarted', 'completed')
  ),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cycle_group_id, line_user_id, cycle_no)
);

COMMENT ON TABLE survey_cycles IS
  '1人の1周分のサイクル (Migration 093)。離脱率はこのテーブルの集計で出す。';
COMMENT ON COLUMN survey_cycles.expected_return_at IS
  'この日を過ぎて A の再回答が無ければ離脱疑い＝C の送付対象。';
COMMENT ON COLUMN survey_cycles.returned_at IS
  '次サイクルの A が開始された時刻。非NULL＝離脱していない。';

-- C 送付バッチが毎分引くための部分インデックス（送付待ちだけを見る）。
CREATE INDEX IF NOT EXISTS ix_survey_cycles_followup_due
  ON survey_cycles (expected_return_at)
  WHERE closed_at IS NULL
    AND followup_sent_at IS NULL
    AND returned_at IS NULL
    AND expected_return_at IS NOT NULL;

-- 「この人の開いているサイクル」を引くための索引。
CREATE INDEX IF NOT EXISTS ix_survey_cycles_open_by_user
  ON survey_cycles (cycle_group_id, line_user_id)
  WHERE closed_at IS NULL;

CREATE INDEX IF NOT EXISTS ix_survey_cycles_user
  ON survey_cycles (line_user_id);

-- ------------------------------------------------------------------
-- 3. assignment をサイクルへ紐づけ、「1案件1回」を解除する
-- ------------------------------------------------------------------

ALTER TABLE project_assignments
  ADD COLUMN IF NOT EXISTS cycle_id uuid REFERENCES survey_cycles(id) ON DELETE SET NULL;

COMMENT ON COLUMN project_assignments.cycle_id IS
  '所属サイクル (Migration 093)。NULL は従来どおりの単発案件。';

CREATE INDEX IF NOT EXISTS ix_project_assignments_cycle
  ON project_assignments (cycle_id)
  WHERE cycle_id IS NOT NULL;

-- 旧: unique(project_id, respondent_id) ＝ 1案件1回
-- 新: unique(project_id, respondent_id, cycle_id) ＝ サイクルごとに1回
--
-- ⚠ NULL は重複扱いされないため、cycle_id IS NULL の行は無制限に作れる。
--   サイクル外案件の「1回だけ」はアプリ層のゲートで維持する（本ファイル冒頭の注記参照）。
ALTER TABLE project_assignments
  DROP CONSTRAINT IF EXISTS project_assignments_project_respondent_unique;

ALTER TABLE project_assignments
  DROP CONSTRAINT IF EXISTS project_assignments_project_respondent_cycle_unique;

ALTER TABLE project_assignments
  ADD CONSTRAINT project_assignments_project_respondent_cycle_unique
  UNIQUE (project_id, respondent_id, cycle_id);

-- ------------------------------------------------------------------
-- 4. 権限（service_role 経由でのみ触るため GRANT 漏れを防ぐ）
--    ※ 074 で GRANT 漏れによる 500 を一括是正した経緯があるため明示的に付与する。
-- ------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON cycle_groups TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON cycle_group_steps TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON survey_cycles TO service_role;

-- ------------------------------------------------------------------
-- ROLLBACK 手順（手動）
-- ------------------------------------------------------------------
-- ALTER TABLE project_assignments
--   DROP CONSTRAINT IF EXISTS project_assignments_project_respondent_cycle_unique;
-- -- ⚠ 復元前に重複行の掃除が必要（周回で複数行が入っているため）:
-- --   DELETE FROM project_assignments a USING project_assignments b
-- --   WHERE a.ctid < b.ctid AND a.project_id = b.project_id AND a.respondent_id = b.respondent_id;
-- ALTER TABLE project_assignments
--   ADD CONSTRAINT project_assignments_project_respondent_unique UNIQUE (project_id, respondent_id);
-- ALTER TABLE project_assignments DROP COLUMN IF EXISTS cycle_id;
-- DROP TABLE IF EXISTS survey_cycles;
-- DROP TABLE IF EXISTS cycle_group_steps;
-- DROP TABLE IF EXISTS cycle_groups;
