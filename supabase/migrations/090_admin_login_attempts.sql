-- 090_admin_login_attempts.sql
-- 管理画面ログイン（/admin/login）の総当たり対策カウンタ。
--
-- Vercel サーバーレスではプロセスが毎リクエスト異なるため、失敗回数をメモリに持てない。
-- 2要素認証を使わない運用なので、守りはパスワード強度とこのレート制限に一本化される。
--
-- 記録するのは「失敗」だけ。成功時は該当 IP の行を削除してカウンタを戻す。
-- ip_hash は生 IP ではなく SHA-256 ダイジェスト（16進64文字）を入れる。
-- ロック中かどうかの判定に生 IP を保持する必要はなく、
-- 万一この表が漏れても訪問元 IP の一覧にはならないようにするため。
--
-- GRANT/RLS は 053/066/077 の型に従い service_role のみ。

CREATE TABLE IF NOT EXISTS admin_login_attempts (
  id BIGSERIAL PRIMARY KEY,
  ip_hash TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 「直近N分間に、このIPが何回失敗したか」を引くための複合インデックス。
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_ip_time
  ON admin_login_attempts (ip_hash, attempted_at DESC);

-- 古い行の掃除用（ロック窓を過ぎた行は判定に使わない）。
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_time
  ON admin_login_attempts (attempted_at);

REVOKE ALL ON admin_login_attempts FROM anon, authenticated;
REVOKE ALL ON SEQUENCE admin_login_attempts_id_seq FROM anon, authenticated;

ALTER TABLE admin_login_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON admin_login_attempts;
CREATE POLICY service_role_all ON admin_login_attempts
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);
