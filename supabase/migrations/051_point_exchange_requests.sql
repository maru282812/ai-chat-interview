-- ============================================================
-- Migration 051: point_exchange_requests テーブル
--
-- ユーザーが 500pt 単位で交換申請し、管理者が承認・eGift URL を
-- 登録してユーザーへ送付するまでのライフサイクルを管理する。
--
-- ステータス遷移:
--   pending → approved → fulfilled
--   pending → rejected  （ポイント返還）
--   pending → canceled  （ポイント返還）
-- ============================================================

CREATE TABLE IF NOT EXISTS point_exchange_requests (
  id                    UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ユーザー
  line_user_id          TEXT        NOT NULL
    REFERENCES user_profiles(line_user_id) ON DELETE RESTRICT,

  -- 交換内容
  requested_points      INTEGER     NOT NULL
    CHECK (requested_points > 0 AND requested_points % 500 = 0),
  gift_amount_jpy       INTEGER     NOT NULL,                -- 500pt = 500円相当

  -- ステータス
  status                TEXT        NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'fulfilled', 'canceled')),

  -- eGift情報（手動登録フェーズ / 将来API連携拡張を考慮）
  gift_provider         TEXT,                               -- 'anatc', 'amazon', 'quocard' 等
  gift_code             TEXT,                               -- ギフトコード（ログ・照合用）
  gift_url              TEXT,                               -- ギフトURL（要 RLS 保護）
  provider_request_id   TEXT,                               -- 将来 API 連携時のリクエスト ID
  provider_status       TEXT,                               -- 将来 API 連携時のプロバイダ側ステータス
  expires_at            TIMESTAMPTZ,                        -- ギフト有効期限

  -- 管理情報
  admin_memo            TEXT,
  handled_by            TEXT,                               -- 対応した管理者 ID / 名前
  failed_reason         TEXT,                               -- 却下・失敗理由

  -- LINE通知
  notification_sent     BOOLEAN     NOT NULL DEFAULT false,
  notification_sent_at  TIMESTAMPTZ,
  notification_error    TEXT,                               -- 通知失敗理由（再送用）

  -- タイムスタンプ
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at           TIMESTAMPTZ,
  rejected_at           TIMESTAMPTZ,
  fulfilled_at          TIMESTAMPTZ,
  canceled_at           TIMESTAMPTZ,
  sent_at               TIMESTAMPTZ,                        -- eGift 送付（LINE通知）日時
  delivered_at          TIMESTAMPTZ,                        -- ユーザー確認日時（将来用）

  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================
-- インデックス
-- ============================================================

-- 申請中の二重申請防止: 同一ユーザーに pending は 1 件のみ
CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_requests_pending_unique
  ON point_exchange_requests(line_user_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_exchange_requests_user
  ON point_exchange_requests(line_user_id, requested_at DESC);

CREATE INDEX IF NOT EXISTS idx_exchange_requests_status
  ON point_exchange_requests(status, requested_at DESC);

-- ============================================================
-- updated_at 自動更新トリガー
-- ============================================================
DROP TRIGGER IF EXISTS trg_exchange_requests_updated_at ON point_exchange_requests;
CREATE TRIGGER trg_exchange_requests_updated_at
  BEFORE UPDATE ON point_exchange_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- RLS: ギフト URL をユーザー本人以外に見せない
--
-- gift_url / gift_code は本人のみ参照可能。
-- 管理操作は service_role（RLS バイパス）で行う。
-- ============================================================
ALTER TABLE point_exchange_requests ENABLE ROW LEVEL SECURITY;

-- ユーザー本人は自分の申請を参照・作成可能（gift_url 含む全カラム）
CREATE POLICY exchange_requests_select_own
  ON point_exchange_requests
  FOR SELECT
  USING (line_user_id = current_setting('app.line_user_id', true));

CREATE POLICY exchange_requests_insert_own
  ON point_exchange_requests
  FOR INSERT
  WITH CHECK (line_user_id = current_setting('app.line_user_id', true));

-- ============================================================
-- GRANT
-- ============================================================
GRANT SELECT, INSERT, UPDATE ON point_exchange_requests TO service_role;
GRANT SELECT, INSERT         ON point_exchange_requests TO authenticated;
