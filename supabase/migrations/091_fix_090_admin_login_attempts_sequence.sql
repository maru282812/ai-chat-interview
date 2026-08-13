-- 091_fix_090_admin_login_attempts_sequence.sql
-- 090 の REVOKE がシーケンスの権限を service_role からも奪っていた不備の是正。
--
-- 症状: 失敗の記録（INSERT）が毎回
--   `permission denied for sequence admin_login_attempts_id_seq`
-- で落ち、**カウンタが常に 0 のままレート制限が全く効かない**。
-- recordFailure は例外を投げず error ログだけ出す設計なので、
-- ログイン自体は成功し続け、画面上は何も壊れて見えない（実測で確認）。
--
-- 原因: `REVOKE ALL ON SEQUENCE ... FROM anon, authenticated` は対象ロールを
-- 限定しているが、BIGSERIAL のシーケンスはそもそも service_role へ明示 GRANT
-- されておらず、テーブルへの GRANT だけでは nextval() を実行できない。
--
-- 対処: シーケンスの USAGE/SELECT を service_role に明示的に与える。
-- anon/authenticated は 090 の REVOKE のまま（触らせない）。

GRANT USAGE, SELECT ON SEQUENCE admin_login_attempts_id_seq TO service_role;
