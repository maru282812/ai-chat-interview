-- Phase2-A: リサーチプラットフォーム基盤構築
-- 既存テーブルへのカラム追加（削除なし）＋ 新テーブル7件

-- ============================================================
-- 1. user_profiles 拡張
-- ============================================================
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS profile_completed         BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS profile_completed_at      TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notification_ok            BOOLEAN      NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS is_blocked                BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_notification_stopped   BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS fraud_flag                BOOLEAN      NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS quality_score             NUMERIC(5,2) DEFAULT 100,
  ADD COLUMN IF NOT EXISTS ai_eval_score             NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS ai_tags                   TEXT[]       NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ai_persona_summary        TEXT,
  ADD COLUMN IF NOT EXISTS last_login_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS visibility_settings       JSONB        NOT NULL DEFAULT '{}';

-- ============================================================
-- 2. attribute_definitions — 属性定義マスタ
-- ============================================================
CREATE TABLE IF NOT EXISTS attribute_definitions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  attr_key         TEXT        NOT NULL UNIQUE,
  label            TEXT        NOT NULL,
  category         TEXT        NOT NULL CHECK (category IN ('basic', 'lifestyle', 'interest', 'ai_inferred')),
  data_type        TEXT        NOT NULL DEFAULT 'text' CHECK (data_type IN ('text', 'boolean', 'number', 'json', 'tags')),
  is_user_editable  BOOLEAN     NOT NULL DEFAULT true,
  is_admin_only    BOOLEAN     NOT NULL DEFAULT false,
  is_company_visible BOOLEAN   NOT NULL DEFAULT false,
  sort_order       INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 初期属性定義
INSERT INTO attribute_definitions (attr_key, label, category, data_type, is_company_visible, sort_order) VALUES
  ('hobby',               '趣味',           'lifestyle',    'tags',    false, 10),
  ('interest_category',   '興味カテゴリ',   'interest',     'tags',    true,  20),
  ('used_services',       '利用サービス',    'lifestyle',    'tags',    true,  30),
  ('purchase_tendency',   '購買傾向',        'lifestyle',    'text',    true,  40),
  ('sns_usage',           'SNS利用',         'lifestyle',    'tags',    true,  50),
  ('gaming_frequency',    'ゲーム頻度',      'lifestyle',    'text',    true,  60),
  ('beauty_interest',     '美容関心',        'lifestyle',    'text',    true,  70),
  ('food_lifestyle',      '食生活',          'lifestyle',    'text',    true,  80),
  ('values',              '価値観',          'lifestyle',    'tags',    false, 90),
  ('future_anxiety',      '将来不安',        'lifestyle',    'tags',    false, 100),
  ('favorite_category',   '推しカテゴリ',    'interest',     'tags',    false, 110),
  ('spending_tendency',   '消費傾向',        'lifestyle',    'text',    true,  120),
  ('ai_personality_type', 'AI推定性格タイプ','ai_inferred',  'text',    false, 200),
  ('ai_stress_tendency',  'AI推定ストレス傾向','ai_inferred','text',    false, 210),
  ('ai_purchase_signal',  'AI購買シグナル',  'ai_inferred',  'tags',    true,  220)
ON CONFLICT (attr_key) DO NOTHING;

-- ============================================================
-- 3. user_attributes — 柔軟属性ストア
-- ============================================================
CREATE TABLE IF NOT EXISTS user_attributes (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id   TEXT        NOT NULL REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  attr_key       TEXT        NOT NULL REFERENCES attribute_definitions(attr_key),
  value_text     TEXT,
  value_json     JSONB,
  value_number   NUMERIC,
  source         TEXT        NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'admin', 'ai_inferred')),
  confidence     NUMERIC(3,2),
  is_private     BOOLEAN     NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (line_user_id, attr_key)
);

CREATE INDEX IF NOT EXISTS idx_user_attributes_user ON user_attributes(line_user_id);
CREATE INDEX IF NOT EXISTS idx_user_attributes_key  ON user_attributes(attr_key);
CREATE INDEX IF NOT EXISTS idx_user_attributes_src  ON user_attributes(source);

-- ============================================================
-- 4. user_attribute_history — 属性変化履歴
-- ============================================================
CREATE TABLE IF NOT EXISTS user_attribute_history (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id   TEXT        NOT NULL,
  attr_key       TEXT        NOT NULL,
  old_value_text TEXT,
  old_value_json JSONB,
  new_value_text TEXT,
  new_value_json JSONB,
  source         TEXT,
  changed_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_attr_history_user ON user_attribute_history(line_user_id, changed_at DESC);

-- user_attributes 更新時に履歴を自動記録するトリガー
CREATE OR REPLACE FUNCTION log_user_attribute_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.value_text IS DISTINCT FROM NEW.value_text
     OR OLD.value_json IS DISTINCT FROM NEW.value_json
     OR OLD.value_number IS DISTINCT FROM NEW.value_number THEN
    INSERT INTO user_attribute_history(
      line_user_id, attr_key,
      old_value_text, old_value_json,
      new_value_text, new_value_json,
      source
    ) VALUES (
      OLD.line_user_id, OLD.attr_key,
      OLD.value_text, OLD.value_json,
      NEW.value_text, NEW.value_json,
      NEW.source
    );
  END IF;
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_attributes_history ON user_attributes;
CREATE TRIGGER trg_user_attributes_history
  BEFORE UPDATE ON user_attributes
  FOR EACH ROW EXECUTE FUNCTION log_user_attribute_change();

-- ============================================================
-- 5. behavior_logs — 行動ログ
-- ============================================================
CREATE TABLE IF NOT EXISTS behavior_logs (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id   TEXT        NOT NULL,
  event_type     TEXT        NOT NULL CHECK (event_type IN (
    'liff_open', 'mypage_view', 'profile_setup_complete',
    'survey_start', 'survey_complete',
    'rant_post', 'diary_post',
    'personality_view'
  )),
  source         TEXT        CHECK (source IN ('liff', 'line', 'webhook')),
  metadata       JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_behavior_logs_user   ON behavior_logs(line_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_behavior_logs_type   ON behavior_logs(event_type, created_at DESC);

-- ============================================================
-- 6. user_consent — 同意管理
-- ============================================================
CREATE TABLE IF NOT EXISTS user_consent (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id   TEXT        NOT NULL,
  consent_type   TEXT        NOT NULL CHECK (consent_type IN (
    'terms', 'privacy', 'ai_analysis', 'company_data_share', 'ai_learning'
  )),
  consented      BOOLEAN     NOT NULL,
  version        TEXT,
  consented_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (line_user_id, consent_type)
);

CREATE INDEX IF NOT EXISTS idx_user_consent_user ON user_consent(line_user_id);

-- ============================================================
-- 7. segments — セグメント定義
-- ============================================================
CREATE TABLE IF NOT EXISTS segments (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT        NOT NULL,
  description       TEXT,
  conditions        JSONB       NOT NULL DEFAULT '{"operator":"AND","conditions":[]}',
  estimated_count   INTEGER,
  last_evaluated_at TIMESTAMPTZ,
  created_by        TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- 8. delivery_campaigns — セグメント配信キャンペーン
-- ============================================================
CREATE TABLE IF NOT EXISTS delivery_campaigns (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id       UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  segment_id       UUID        REFERENCES segments(id) ON DELETE SET NULL,
  name             TEXT        NOT NULL,
  status           TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'sent', 'cancelled')),
  delivery_channel TEXT        NOT NULL DEFAULT 'liff' CHECK (delivery_channel IN ('liff', 'line')),
  scheduled_at     TIMESTAMPTZ,
  sent_at          TIMESTAMPTZ,
  sent_count       INTEGER     NOT NULL DEFAULT 0,
  opened_count     INTEGER     NOT NULL DEFAULT 0,
  started_count    INTEGER     NOT NULL DEFAULT 0,
  completed_count  INTEGER     NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_campaigns_project ON delivery_campaigns(project_id);
CREATE INDEX IF NOT EXISTS idx_delivery_campaigns_status  ON delivery_campaigns(status);
