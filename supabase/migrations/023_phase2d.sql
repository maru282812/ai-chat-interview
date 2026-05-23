-- Phase2-D: 運用最適化
-- 1. ng_words (NGワード管理)
-- 2. post_categories (投稿カテゴリ管理)
-- 3. campaign_assignment_map (キャンペーン配信トラッキング)

-- ============================================================
-- 1. ng_words — NGワードマスタ
-- ============================================================
CREATE TABLE IF NOT EXISTS ng_words (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  word        TEXT        NOT NULL UNIQUE,
  category    TEXT        NOT NULL DEFAULT 'general'
              CHECK (category IN ('general', 'violence', 'sexual', 'illegal', 'other')),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ng_words_category ON ng_words(category);
CREATE INDEX IF NOT EXISTS idx_ng_words_active   ON ng_words(is_active);

-- ============================================================
-- 2. post_categories — 投稿カテゴリマスタ
-- ============================================================
CREATE TABLE IF NOT EXISTS post_categories (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  category_type TEXT        NOT NULL CHECK (category_type IN ('rant', 'diary')),
  name          TEXT        NOT NULL,
  description   TEXT,
  sort_order    INTEGER     NOT NULL DEFAULT 0,
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_type, name)
);

CREATE INDEX IF NOT EXISTS idx_post_categories_type ON post_categories(category_type);

-- 初期データ
INSERT INTO post_categories (category_type, name, sort_order) VALUES
  ('rant', '仕事',         10),
  ('rant', '人間関係',     20),
  ('rant', '健康',         30),
  ('rant', '消費・お金',   40),
  ('rant', '家庭',         50),
  ('rant', 'その他',       99),
  ('diary','健康',         10),
  ('diary','消費',         20),
  ('diary','仕事',         30),
  ('diary','趣味',         40),
  ('diary','家庭',         50),
  ('diary','その他',       99)
ON CONFLICT (category_type, name) DO NOTHING;

-- ============================================================
-- 3. campaign_assignment_map — キャンペーン配信トラッキング
-- ============================================================
CREATE TABLE IF NOT EXISTS campaign_assignment_map (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    UUID        NOT NULL REFERENCES delivery_campaigns(id) ON DELETE CASCADE,
  assignment_id  UUID        NOT NULL REFERENCES project_assignments(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, assignment_id)
);

CREATE INDEX IF NOT EXISTS idx_campaign_assignment_campaign ON campaign_assignment_map(campaign_id);
CREATE INDEX IF NOT EXISTS idx_campaign_assignment_assign   ON campaign_assignment_map(assignment_id);
