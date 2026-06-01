-- 042_project_delivery_system.sql
-- 案件配信システム: delivery_enabled / delivery_type / delivered_at の追加
-- 配信テンプレート管理テーブル・配信ログテーブルの新設

-- ============================================================
-- projects テーブルに配信制御カラムを追加
-- ============================================================

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS delivery_enabled  boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_type     text,
  ADD COLUMN IF NOT EXISTS delivered_at      timestamptz;

ALTER TABLE projects
  ADD CONSTRAINT projects_delivery_type_check
    CHECK (delivery_type IN (
      'new_project',   -- 新着案件
      'interview',     -- インタビュー
      'survey',        -- アンケート
      'daily_survey',  -- デイリーアンケート
      'high_point',    -- 高ポイント案件
      'urgent'         -- 緊急募集
    ) OR delivery_type IS NULL);

-- ============================================================
-- delivery_templates テーブル（配信テンプレート管理）
-- ============================================================

CREATE TABLE IF NOT EXISTS delivery_templates (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name                      text        NOT NULL,
  is_enabled                boolean     NOT NULL DEFAULT true,

  -- スケジュール種別と設定
  -- daily:    {hour: 9, minute: 0}
  -- weekly:   {weekday: 1, hour: 9, minute: 0}   (0=日, 1=月, ..., 6=土)
  -- interval: {interval_minutes: 30}
  schedule_type             text        NOT NULL
    CHECK (schedule_type IN ('daily', 'weekly', 'interval')),
  schedule_config           jsonb       NOT NULL DEFAULT '{}',

  -- 対象条件
  target_types              text[]      NOT NULL DEFAULT '{}',    -- delivery_type の複数指定
  require_status            text        NOT NULL DEFAULT 'ready', -- 対象ステータス
  require_delivery_enabled  boolean     NOT NULL DEFAULT true,    -- delivery_enabled=true 必須
  created_within_hours      integer,                              -- NULL=制限なし

  -- 通知設定
  notification_template_id  uuid        REFERENCES notification_templates(id) ON DELETE SET NULL,

  -- 将来拡張（セグメント・属性・AIマッチング）
  -- {type: 'all' | 'attribute' | 'rank' | 'badge' | 'ai', ...}
  segment_config            jsonb,

  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE TRIGGER set_delivery_templates_updated_at
  BEFORE UPDATE ON delivery_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- delivery_logs テーブル（配信履歴）
-- ============================================================

CREATE TABLE IF NOT EXISTS delivery_logs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id       uuid        NOT NULL REFERENCES delivery_templates(id) ON DELETE CASCADE,
  executed_at       timestamptz NOT NULL DEFAULT now(),
  project_ids       uuid[]      NOT NULL DEFAULT '{}',
  target_user_count integer     NOT NULL DEFAULT 0,
  success_count     integer     NOT NULL DEFAULT 0,
  fail_count        integer     NOT NULL DEFAULT 0,
  error_detail      jsonb,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ============================================================
-- インデックス
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_delivery_logs_template_id  ON delivery_logs(template_id);
CREATE INDEX IF NOT EXISTS idx_delivery_logs_executed_at  ON delivery_logs(executed_at DESC);
CREATE INDEX IF NOT EXISTS idx_projects_ready_delivery    ON projects(status, delivery_enabled)
  WHERE status = 'ready';

-- ============================================================
-- 権限付与
-- ============================================================

GRANT SELECT, INSERT, UPDATE, DELETE ON delivery_templates TO anon, authenticated;
GRANT SELECT, INSERT                  ON delivery_logs       TO anon, authenticated;
