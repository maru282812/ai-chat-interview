-- ============================================================
-- Migration 032: デイリーアンケート・通知・ポイント統合基盤
--
-- 追加テーブル（14件）:
--   user_points, point_histories, user_ranks,
--   user_badges, user_badge_awards, user_streaks,
--   daily_surveys, daily_survey_questions,
--   daily_survey_deliveries, daily_survey_answers,
--   notification_templates, notification_logs,
--   daily_question_priorities, reward_campaigns
--
-- 既存ポイント/ランク（respondentsベース）との統合:
--   user_points は line_user_id ベースに統一
--   point_histories に既存 point_transactions を移行
--   user_ranks に既存 respondents.current_rank_id を移行
-- ============================================================

-- ============================================================
-- 1. user_points — ユーザーポイント残高（line_user_id ベース）
-- ============================================================
CREATE TABLE IF NOT EXISTS user_points (
  line_user_id     TEXT        PRIMARY KEY REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  total_points     INTEGER     NOT NULL DEFAULT 0,
  available_points INTEGER     NOT NULL DEFAULT 0,
  lifetime_points  INTEGER     NOT NULL DEFAULT 0,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 2. point_histories — ポイント明細（line_user_id ベース、既存を統合）
-- ============================================================
CREATE TABLE IF NOT EXISTS point_histories (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id     TEXT        NOT NULL REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  transaction_type TEXT        NOT NULL CHECK (transaction_type IN (
    'daily_survey',
    'interview_complete',
    'project_completion',
    'streak_bonus',
    'birthday_bonus',
    'campaign_bonus',
    'attribute_update',
    'first_bonus',
    'continuity_bonus',
    'project_bonus',
    'manual_adjustment',
    'redemption'
  )),
  points           INTEGER     NOT NULL,
  reason           TEXT        NOT NULL,
  reference_type   TEXT        CHECK (reference_type IN (
    'daily_survey_answer', 'project_assignment', 'campaign', 'session', 'manual'
  )),
  reference_id     UUID,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_point_histories_user ON point_histories(line_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_point_histories_type ON point_histories(transaction_type, created_at DESC);

-- ============================================================
-- 3. user_ranks — ユーザーランク（line_user_id ベース）
-- ============================================================
CREATE TABLE IF NOT EXISTS user_ranks (
  line_user_id  TEXT        PRIMARY KEY REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  rank_id       UUID        NOT NULL REFERENCES ranks(id),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_ranks_rank ON user_ranks(rank_id);

-- ============================================================
-- 4. user_badges — バッジ定義マスタ
-- ============================================================
CREATE TABLE IF NOT EXISTS user_badges (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  badge_code       TEXT        NOT NULL UNIQUE,
  badge_name       TEXT        NOT NULL,
  description      TEXT,
  icon_emoji       TEXT        NOT NULL DEFAULT '🏅',
  condition_type   TEXT        NOT NULL CHECK (condition_type IN (
    'first_answer',
    'streak_7', 'streak_30', 'streak_100',
    'answers_10', 'answers_50', 'answers_100', 'answers_300',
    'profile_complete',
    'interview_complete',
    'project_complete',
    'rank_silver', 'rank_gold', 'rank_platinum', 'rank_diamond',
    'manual'
  )),
  condition_value  JSONB       NOT NULL DEFAULT '{}',
  sort_order       INTEGER     NOT NULL DEFAULT 0,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 5. user_badge_awards — バッジ獲得履歴
-- ============================================================
CREATE TABLE IF NOT EXISTS user_badge_awards (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id TEXT        NOT NULL REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  badge_code   TEXT        NOT NULL REFERENCES user_badges(badge_code),
  awarded_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (line_user_id, badge_code)
);

CREATE INDEX IF NOT EXISTS idx_badge_awards_user ON user_badge_awards(line_user_id);

-- ============================================================
-- 6. user_streaks — 連続回答ストリーク
-- ============================================================
CREATE TABLE IF NOT EXISTS user_streaks (
  line_user_id       TEXT        PRIMARY KEY REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  current_streak     INTEGER     NOT NULL DEFAULT 0,
  longest_streak     INTEGER     NOT NULL DEFAULT 0,
  last_answered_date DATE,
  total_answer_days  INTEGER     NOT NULL DEFAULT 0,
  streak_updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 7. daily_surveys — デイリーアンケートマスタ
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_surveys (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  title             TEXT        NOT NULL,
  description       TEXT,
  status            TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN (
    'draft', 'scheduled', 'active', 'paused', 'completed'
  )),
  reward_type       TEXT        NOT NULL DEFAULT 'fixed' CHECK (reward_type IN ('fixed', 'random')),
  reward_points     INTEGER     NOT NULL DEFAULT 5,
  reward_min_points INTEGER     NOT NULL DEFAULT 3,
  reward_max_points INTEGER     NOT NULL DEFAULT 20,
  target_segment_id UUID        REFERENCES segments(id) ON DELETE SET NULL,
  scheduled_at      TIMESTAMPTZ,
  expires_at        TIMESTAMPTZ,
  notification_template_id UUID,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_surveys_status    ON daily_surveys(status);
CREATE INDEX IF NOT EXISTS idx_daily_surveys_scheduled ON daily_surveys(scheduled_at);

-- ============================================================
-- 8. daily_survey_questions — デイリーアンケート設問
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_survey_questions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id       UUID        NOT NULL REFERENCES daily_surveys(id) ON DELETE CASCADE,
  question_text   TEXT        NOT NULL,
  question_type   TEXT        NOT NULL DEFAULT 'single_choice' CHECK (question_type IN (
    'single_choice', 'multiple_choice', 'text', 'scale'
  )),
  answer_options  JSONB       NOT NULL DEFAULT '[]',
  attribute_key   TEXT        REFERENCES attribute_definitions(attr_key) ON DELETE SET NULL,
  sort_order      INTEGER     NOT NULL DEFAULT 0,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_survey_questions_survey ON daily_survey_questions(survey_id);

-- ============================================================
-- 9. daily_survey_deliveries — デイリーアンケート配信記録
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_survey_deliveries (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id                UUID        NOT NULL REFERENCES daily_surveys(id) ON DELETE CASCADE,
  line_user_id             TEXT        NOT NULL REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  status                   TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'sent', 'opened', 'answered', 'expired', 'failed'
  )),
  points_awarded           INTEGER,
  sent_at                  TIMESTAMPTZ,
  opened_at                TIMESTAMPTZ,
  answered_at              TIMESTAMPTZ,
  expired_at               TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (survey_id, line_user_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_survey_deliveries_survey ON daily_survey_deliveries(survey_id);
CREATE INDEX IF NOT EXISTS idx_daily_survey_deliveries_user   ON daily_survey_deliveries(line_user_id);
CREATE INDEX IF NOT EXISTS idx_daily_survey_deliveries_status ON daily_survey_deliveries(status, created_at DESC);

-- ============================================================
-- 10. daily_survey_answers — デイリーアンケート回答
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_survey_answers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id    UUID        NOT NULL REFERENCES daily_survey_deliveries(id) ON DELETE CASCADE,
  survey_id      UUID        NOT NULL REFERENCES daily_surveys(id) ON DELETE CASCADE,
  question_id    UUID        NOT NULL REFERENCES daily_survey_questions(id) ON DELETE CASCADE,
  line_user_id   TEXT        NOT NULL REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  answer_value   JSONB       NOT NULL DEFAULT '{}',
  answered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (delivery_id, question_id)
);

CREATE INDEX IF NOT EXISTS idx_daily_survey_answers_delivery ON daily_survey_answers(delivery_id);
CREATE INDEX IF NOT EXISTS idx_daily_survey_answers_user     ON daily_survey_answers(line_user_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_daily_survey_answers_survey   ON daily_survey_answers(survey_id);

-- ============================================================
-- 11. notification_templates — 通知テンプレートマスタ
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_templates (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category      TEXT        NOT NULL CHECK (category IN (
    'daily_survey',
    'answer_complete',
    'unanswered_reminder',
    'bonus_achieved',
    'rank_up',
    'point_grant',
    'project_intro',
    'attribute_update_request',
    'birthday',
    'dormancy_recovery',
    'system'
  )),
  name          TEXT        NOT NULL,
  description   TEXT,
  message_type  TEXT        NOT NULL DEFAULT 'text' CHECK (message_type IN ('text', 'flex')),
  title_text    TEXT,
  body_text     TEXT        NOT NULL,
  action_label  TEXT,
  action_url    TEXT,
  flex_template JSONB,
  variables     TEXT[]      NOT NULL DEFAULT '{}',
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  is_default    BOOLEAN     NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_templates_category ON notification_templates(category);
CREATE INDEX IF NOT EXISTS idx_notification_templates_active   ON notification_templates(is_active);

-- ============================================================
-- 12. notification_logs — 通知送信履歴
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_logs (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id    TEXT        NOT NULL REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  template_id     UUID        REFERENCES notification_templates(id) ON DELETE SET NULL,
  category        TEXT        NOT NULL,
  rendered_title  TEXT,
  rendered_body   TEXT        NOT NULL,
  variables_used  JSONB       NOT NULL DEFAULT '{}',
  status          TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'sent', 'failed', 'delivered'
  )),
  line_message_id TEXT,
  error_message   TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_user     ON notification_logs(line_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_category ON notification_logs(category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status   ON notification_logs(status);

-- ============================================================
-- 13. daily_question_priorities — 自動出題優先ルール
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_question_priorities (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  priority_type   TEXT        NOT NULL CHECK (priority_type IN (
    'admin',
    'missing_attribute',
    'high_value_attribute',
    'recent_gap',
    'project_useful'
  )),
  attr_key        TEXT        REFERENCES attribute_definitions(attr_key) ON DELETE CASCADE,
  question_text   TEXT        NOT NULL,
  question_type   TEXT        NOT NULL DEFAULT 'single_choice' CHECK (question_type IN (
    'single_choice', 'multiple_choice', 'text', 'scale'
  )),
  answer_options  JSONB       NOT NULL DEFAULT '[]',
  sort_order      INTEGER     NOT NULL DEFAULT 0,
  weight          INTEGER     NOT NULL DEFAULT 10,
  is_active       BOOLEAN     NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_daily_question_priorities_type   ON daily_question_priorities(priority_type);
CREATE INDEX IF NOT EXISTS idx_daily_question_priorities_active ON daily_question_priorities(is_active, sort_order);

-- ============================================================
-- 14. reward_campaigns — ボーナスキャンペーン定義
-- ============================================================
CREATE TABLE IF NOT EXISTS reward_campaigns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT        NOT NULL,
  description      TEXT,
  campaign_type    TEXT        NOT NULL CHECK (campaign_type IN (
    'streak_bonus',
    'birthday',
    'seasonal',
    'referral',
    'dormancy_recovery',
    'manual'
  )),
  bonus_points     INTEGER     NOT NULL DEFAULT 0,
  condition_type   TEXT        NOT NULL DEFAULT 'manual' CHECK (condition_type IN (
    'streak_days',
    'birthday_month',
    'date_range',
    'manual'
  )),
  condition_value  JSONB       NOT NULL DEFAULT '{}',
  target_segment_id UUID       REFERENCES segments(id) ON DELETE SET NULL,
  start_at         TIMESTAMPTZ,
  end_at           TIMESTAMPTZ,
  is_active        BOOLEAN     NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_reward_campaigns_type   ON reward_campaigns(campaign_type);
CREATE INDEX IF NOT EXISTS idx_reward_campaigns_active ON reward_campaigns(is_active);

-- ============================================================
-- daily_surveys.notification_template_id の FK を後から追加
-- (notification_templates 作成後)
-- ============================================================
ALTER TABLE daily_surveys
  ADD CONSTRAINT fk_daily_surveys_notification_template
  FOREIGN KEY (notification_template_id)
  REFERENCES notification_templates(id)
  ON DELETE SET NULL;

-- ============================================================
-- updatedAt 自動更新トリガー（共通関数が既にある場合は再利用）
-- ============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_daily_surveys_updated_at ON daily_surveys;
CREATE TRIGGER trg_daily_surveys_updated_at
  BEFORE UPDATE ON daily_surveys
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_notification_templates_updated_at ON notification_templates;
CREATE TRIGGER trg_notification_templates_updated_at
  BEFORE UPDATE ON notification_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_daily_question_priorities_updated_at ON daily_question_priorities;
CREATE TRIGGER trg_daily_question_priorities_updated_at
  BEFORE UPDATE ON daily_question_priorities
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_reward_campaigns_updated_at ON reward_campaigns;
CREATE TRIGGER trg_reward_campaigns_updated_at
  BEFORE UPDATE ON reward_campaigns
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- user_points 自動更新トリガー
-- point_histories INSERT 時に user_points を自動集計
-- ============================================================
CREATE OR REPLACE FUNCTION sync_user_points_on_history()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_points (line_user_id, total_points, available_points, lifetime_points, updated_at)
  VALUES (
    NEW.line_user_id,
    GREATEST(0, NEW.points),
    GREATEST(0, NEW.points),
    GREATEST(0, NEW.points),
    now()
  )
  ON CONFLICT (line_user_id) DO UPDATE SET
    total_points     = GREATEST(0, user_points.total_points + NEW.points),
    available_points = GREATEST(0, user_points.available_points + NEW.points),
    lifetime_points  = user_points.lifetime_points + GREATEST(0, NEW.points),
    updated_at       = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_point_histories_sync ON point_histories;
CREATE TRIGGER trg_point_histories_sync
  AFTER INSERT ON point_histories
  FOR EACH ROW EXECUTE FUNCTION sync_user_points_on_history();

-- ============================================================
-- バッジ定義 初期データ
-- ============================================================
INSERT INTO user_badges (badge_code, badge_name, description, icon_emoji, condition_type, condition_value, sort_order)
VALUES
  ('first_answer',       '初回回答',           '初めてアンケートに回答した',                '🌟', 'first_answer',       '{}',                   10),
  ('streak_7',           '7日連続',             '7日連続でアンケートに回答した',              '🔥', 'streak_7',           '{"days": 7}',          20),
  ('streak_30',          '30日連続',            '30日連続でアンケートに回答した',             '🔥', 'streak_30',          '{"days": 30}',         30),
  ('streak_100',         '100日連続',           '100日連続でアンケートに回答した',            '💥', 'streak_100',         '{"days": 100}',        40),
  ('answers_10',         '10回答達成',          '累計10回アンケートに回答した',               '📊', 'answers_10',         '{"count": 10}',        50),
  ('answers_50',         '50回答達成',          '累計50回アンケートに回答した',               '📊', 'answers_50',         '{"count": 50}',        60),
  ('answers_100',        '100回答達成',         '累計100回アンケートに回答した',              '🎯', 'answers_100',        '{"count": 100}',       70),
  ('answers_300',        '300回答達成',         '累計300回アンケートに回答した',              '👑', 'answers_300',        '{"count": 300}',       80),
  ('profile_complete',   'プロフィール完成',    'プロフィールを全て入力した',                 '✅', 'profile_complete',   '{}',                   90),
  ('interview_complete', 'AIインタビュー参加',  'AIインタビューに参加した',                   '🤖', 'interview_complete', '{}',                  100),
  ('project_complete',   '案件参加',            '調査案件に参加した',                         '📋', 'project_complete',   '{}',                  110),
  ('rank_silver',        'シルバー達成',        'ランクがシルバーに到達した',                 '🥈', 'rank_silver',        '{}',                  120),
  ('rank_gold',          'ゴールド達成',        'ランクがゴールドに到達した',                 '🥇', 'rank_gold',          '{}',                  130),
  ('rank_platinum',      'プラチナ達成',        'ランクがプラチナに到達した',                 '💎', 'rank_platinum',      '{}',                  140),
  ('rank_diamond',       'ダイヤモンド達成',    'ランクがダイヤモンドに到達した',             '💍', 'rank_diamond',       '{}',                  150)
ON CONFLICT (badge_code) DO NOTHING;

-- ============================================================
-- ranks テーブルを5段階に更新（既存の初期データに合わせて UPSERT）
-- ============================================================
INSERT INTO ranks (rank_code, rank_name, min_points, sort_order, badge_label)
VALUES
  ('bronze',   'ブロンズ',     0,    1, '🥉'),
  ('silver',   'シルバー',   200,    2, '🥈'),
  ('gold',     'ゴールド',   500,    3, '🥇'),
  ('platinum', 'プラチナ',  1000,    4, '💎'),
  ('diamond',  'ダイヤモンド', 2000, 5, '💍')
ON CONFLICT (rank_code) DO UPDATE SET
  rank_name   = excluded.rank_name,
  min_points  = excluded.min_points,
  sort_order  = excluded.sort_order,
  badge_label = excluded.badge_label;
