-- ============================================================
-- 036: 通知スケジューラ設定テーブル
-- ============================================================

CREATE TABLE IF NOT EXISTS notification_scheduler_settings (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  morning_enabled  BOOLEAN     NOT NULL DEFAULT false,
  morning_time     TEXT        NOT NULL DEFAULT '08:00',
  evening_enabled  BOOLEAN     NOT NULL DEFAULT false,
  evening_time     TEXT        NOT NULL DEFAULT '18:00',
  reminder_enabled BOOLEAN     NOT NULL DEFAULT false,
  reminder_time    TEXT        NOT NULL DEFAULT '20:00',
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 初期設定行（常に1行のみ運用）
INSERT INTO notification_scheduler_settings DEFAULT VALUES;

-- RLS 設定（管理サービスロールのみ操作可能）
ALTER TABLE notification_scheduler_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON notification_scheduler_settings
  FOR ALL USING (true) WITH CHECK (true);
