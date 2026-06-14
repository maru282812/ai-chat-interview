-- ============================================================
-- Migration 053: point_exchange_audit_logs テーブル
--
-- 管理者による交換申請操作を記録する監査ログ。
-- 承認・却下・送付済み変更・通知送受の履歴を保持し、
-- 操作の追跡と不正検知に使用する。
-- ============================================================

CREATE TABLE IF NOT EXISTS point_exchange_audit_logs (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id  UUID        NOT NULL
    REFERENCES point_exchange_requests(id) ON DELETE CASCADE,
  action      TEXT        NOT NULL
    CHECK (action IN (
      'approved',
      'rejected',
      'fulfilled',
      'canceled_by_user',
      'notify_sent',
      'notify_failed'
    )),
  admin_id    TEXT,                                       -- 操作した管理者 ID（将来的な認証強化を想定）
  detail      JSONB       NOT NULL DEFAULT '{}',          -- 却下理由・ギフトプロバイダ等の補足情報
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- request_id で絞り込む用（申請詳細画面のログ表示）
CREATE INDEX IF NOT EXISTS idx_exchange_audit_logs_request_id
  ON point_exchange_audit_logs(request_id);

-- 直近の操作を時系列で取得する用（集計・不正検知）
CREATE INDEX IF NOT EXISTS idx_exchange_audit_logs_created_at
  ON point_exchange_audit_logs(created_at DESC);

-- ============================================================
-- RLS: 管理画面は service_role でアクセスするためポリシー不要
-- ============================================================
ALTER TABLE point_exchange_audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- GRANT
-- ============================================================
GRANT SELECT, INSERT ON point_exchange_audit_logs TO service_role;
