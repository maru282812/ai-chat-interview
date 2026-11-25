-- 122_security_events.sql
-- 攻撃に気づくための記録（セキュリティイベント）。2026-11-25。
--
-- 残すもの: 管理画面ログインの成功・失敗・ロック、API キーの拒否、
--           管理画面での変更操作（POST 等）、サーバーエラー（5xx）、送った通知。
-- 各行に「いつ・どこから（IP と国）・誰が」を持つ。
--
-- IP について: admin_login_attempts（090）は判定にしか使わないためハッシュにしたが、
-- こちらは「攻撃元を Cloudflare で止める」ための調査用なので生 IP を残す。
-- 代わりに 90 日で消す（securityEventService の purge）。回答者が通るエラーの行には
-- IP を入れない（国だけ）。
--
-- GRANT/RLS は 090 と同じく service_role のみ。

CREATE TABLE IF NOT EXISTS security_events (
  id BIGSERIAL PRIMARY KEY,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  kind TEXT NOT NULL,
  actor TEXT,
  ip TEXT,
  country TEXT,
  method TEXT,
  path TEXT,
  user_agent TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_security_events_kind_time
  ON security_events (kind, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_security_events_time
  ON security_events (occurred_at);

REVOKE ALL ON security_events FROM anon, authenticated;
REVOKE ALL ON SEQUENCE security_events_id_seq FROM anon, authenticated;
GRANT ALL ON security_events TO service_role;
GRANT USAGE, SELECT ON SEQUENCE security_events_id_seq TO service_role;

ALTER TABLE security_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON security_events;
CREATE POLICY service_role_all ON security_events
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
