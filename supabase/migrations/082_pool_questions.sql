-- 082_pool_questions.sql
-- ついでスワイプ（設問プール）: 案件一覧に埋め込む低ステークス2択の
-- 出題プール・出題ログ・回答。信頼スコア（整合性判定）の素材置き場。
-- 判定エンジンは未実装。answers は削除せず貯める前提。

CREATE TABLE IF NOT EXISTS pool_questions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_text    TEXT        NOT NULL,
  question_type    TEXT        NOT NULL DEFAULT 'single_choice'
                               CHECK (question_type IN ('single_choice', 'scale')),
  answer_options   JSONB       NOT NULL DEFAULT '[]',
  topic_tag        TEXT,
  client_id        UUID        REFERENCES clients(id) ON DELETE SET NULL,
  attribute_key    TEXT        REFERENCES attribute_definitions(attr_key) ON DELETE SET NULL,
  status           TEXT        NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  priority         INTEGER     NOT NULL DEFAULT 0,
  reward_points    INTEGER     NOT NULL DEFAULT 1 CHECK (reward_points BETWEEN 0 AND 3),
  reask_after_days INTEGER     CHECK (reask_after_days IS NULL OR reask_after_days >= 1),
  starts_at        TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pool_questions_serving
  ON pool_questions(status, priority DESC, created_at ASC);

-- 出題ログ。回答APIの所有者検証の要（daily_survey_deliveries と同じ役割）。
-- 同じ設問でも日が変われば再出題できるよう exposure_date を一意キーに含める
-- （reask_after_days による test-retest 再出題のため）。
CREATE TABLE IF NOT EXISTS pool_question_exposures (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id   UUID        NOT NULL REFERENCES pool_questions(id) ON DELETE CASCADE,
  line_user_id  TEXT        NOT NULL REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  exposure_date DATE        NOT NULL,
  position      INTEGER     NOT NULL DEFAULT 0,
  status        TEXT        NOT NULL DEFAULT 'served'
                            CHECK (status IN ('served', 'answered', 'skipped')),
  served_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at   TIMESTAMPTZ,
  UNIQUE (question_id, line_user_id, exposure_date)
);

CREATE INDEX IF NOT EXISTS idx_pool_exposures_user_date
  ON pool_question_exposures(line_user_id, exposure_date);
CREATE INDEX IF NOT EXISTS idx_pool_exposures_user_question
  ON pool_question_exposures(line_user_id, question_id, status);
CREATE INDEX IF NOT EXISTS idx_pool_exposures_question
  ON pool_question_exposures(question_id, status);

-- 回答＝信頼スコアの素材。topic_tag / client_id は回答時点のスナップショット
-- （設問側を後から編集しても素材の意味が変わらないように焼き付ける）。
CREATE TABLE IF NOT EXISTS pool_question_answers (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  exposure_id  UUID        NOT NULL REFERENCES pool_question_exposures(id) ON DELETE CASCADE,
  question_id  UUID        NOT NULL REFERENCES pool_questions(id) ON DELETE CASCADE,
  line_user_id TEXT        NOT NULL REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  answer_value JSONB       NOT NULL,
  answer_ms    INTEGER,
  topic_tag    TEXT,
  client_id    UUID,
  answered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exposure_id)
);

CREATE INDEX IF NOT EXISTS idx_pool_answers_user
  ON pool_question_answers(line_user_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_pool_answers_topic
  ON pool_question_answers(line_user_id, topic_tag, answered_at DESC);

-- RLS: アプリは service_role で接続する。anon / authenticated には出さない
-- （076→077 の是正と同じ教訓。GRANT は 074 の DEFAULT PRIVILEGES でも付くが明示する）。
ALTER TABLE pool_questions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_question_exposures ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_question_answers   ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON pool_questions          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON pool_question_exposures TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON pool_question_answers   TO service_role;

-- point_histories の CHECK に pool_question / pool_question_answer を追加。
-- 下のリストは 050 時点の全値（050 が最後にこの CHECK を再構築した migration。
-- grep で確認済み: 032→050 の順で、050 の全値が最新）＋今回の追加。
ALTER TABLE point_histories
  DROP CONSTRAINT IF EXISTS point_histories_transaction_type_check;
ALTER TABLE point_histories
  ADD CONSTRAINT point_histories_transaction_type_check
  CHECK (transaction_type IN (
    'daily_survey', 'interview_complete', 'project_completion', 'streak_bonus',
    'birthday_bonus', 'campaign_bonus', 'attribute_update', 'first_bonus',
    'continuity_bonus', 'project_bonus', 'manual_adjustment', 'redemption',
    'exchange_request', 'exchange_cancel', 'exchange_refund',
    'pool_question'
  ));

ALTER TABLE point_histories
  DROP CONSTRAINT IF EXISTS point_histories_reference_type_check;
ALTER TABLE point_histories
  ADD CONSTRAINT point_histories_reference_type_check
  CHECK (reference_type IN (
    'daily_survey_answer', 'project_assignment', 'campaign', 'session', 'manual',
    'exchange_request',
    'pool_question_answer'
  ));
