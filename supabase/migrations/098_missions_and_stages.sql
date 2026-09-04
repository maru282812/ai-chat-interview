-- 098_missions_and_stages.sql
--
-- ミッション Phase 2: ステージ（段階報酬）とミッション本体。
-- 仕様: docs/plan-mission-phases.md / requirements/requirements.md（D-8/D-13/D-14/D-19）
--
-- 設計判断:
--   - 回答数は**新たに数えない**。正準台帳 point_histories の回答系 transaction_type
--     （daily_survey / pool_question / project_completion / interview_complete）を
--     ミッション期間で COUNT する。既存の全回答経路に配線を足すと影響が読めないため、
--     台帳を読むだけにする（既存機能への影響ゼロ）。
--   - 招待数は mission_invites（097）の registered/answered を COUNT する。
--   - 達成の記録だけを mission_stage_awards に持つ（付与の冪等はこの UNIQUE と
--     awardPoints の idempotency_key の二重で守る）。
--   - reward_points には CHECK で上限 2,000 を張る（D-19。2026-09-04 決定。
--     仮に懸賞と評価されても限度額 100円×20倍 を超えない）。
--   - reward_campaigns は「1キャンペーン=1ボーナス」型でステージを表現できないため
--     拡張せず新設（R-2）。
--
-- 破壊性: なし（新規テーブルのみ）。
-- rollback:
--   DROP TABLE IF EXISTS mission_stage_awards;
--   DROP TABLE IF EXISTS mission_stages;
--   DROP TABLE IF EXISTS missions;

-- ------------------------------------------------------------------
-- 1. ミッション本体
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS missions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  -- 横断型（どの回答もカウント）/ 案件指定型（この案件の回収率を上げる）
  scope       text NOT NULL DEFAULT 'platform' CHECK (scope IN ('platform','project')),
  project_id  uuid REFERENCES projects(id) ON DELETE SET NULL,
  -- 見た目はデータで持つ（15種）。ページ実装は1枚のまま
  theme_key   text NOT NULL DEFAULT 'forest',
  starts_at   timestamptz NOT NULL,
  ends_at     timestamptz NOT NULL,
  is_active   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_missions_period CHECK (starts_at < ends_at),
  CONSTRAINT chk_missions_project_scope
    CHECK (scope <> 'project' OR project_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS ix_missions_active
  ON missions (starts_at, ends_at) WHERE is_active;

-- ------------------------------------------------------------------
-- 2. ステージ定義（条件A: 回答数 OR 条件B: 招待数）
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mission_stages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id    uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  stage_no      int  NOT NULL CHECK (stage_no >= 1),
  need_answers  int  NOT NULL CHECK (need_answers > 0),
  need_invites  int  NOT NULL CHECK (need_invites > 0),
  -- D-19: 1人あたり上限 2,000pt を DB でも強制する
  reward_points int  NOT NULL CHECK (reward_points > 0 AND reward_points <= 2000),
  -- 「??? で隠す」。1段目は公開が原則（アプリ層で警告）
  is_masked     boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_mission_stages UNIQUE (mission_id, stage_no)
);

-- ------------------------------------------------------------------
-- 3. 達成の記録（誰がどの段まで受け取ったか）
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mission_stage_awards (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id   uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  stage_no     int  NOT NULL,
  line_user_id text NOT NULL,
  awarded_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_mission_stage_awards UNIQUE (mission_id, stage_no, line_user_id)
);

CREATE INDEX IF NOT EXISTS ix_mission_stage_awards_user
  ON mission_stage_awards (mission_id, line_user_id);

-- ------------------------------------------------------------------
-- 4. 権限（GRANT 漏れ事故の再発防止）
-- ------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON missions             TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON mission_stages       TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON mission_stage_awards TO service_role;
