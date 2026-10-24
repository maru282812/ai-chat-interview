-- 119_test_operators.sql
--
-- テスト運営者（同じアンケートを何度でも通しで回答し直せる LINE アカウント）。
--
-- 背景:
--   本番と同じ経路（LINE → LIFF）で最後まで回答すると assignment が completed になり、
--   アンケートを修正しても同じアカウントでは二度と回答検証できなかった。
--   管理画面のプレビューは保存しないので、完了処理・ポイント・集計までの通し確認には使えない。
--
-- 方針:
--   ここに載った LINE userId だけ、完了済み画面に「もう一度回答する（テスト）」が出る。
--   載った人の respondents は is_test=true（067）にし、エクスポート・ミッション・店舗開示の
--   集計から外す。ポイントとキャンペーン件数も付与・加算しない。
--   管理画面の共通パスワードには個人の区別が無いため、運営者は LINE アカウントで識別する。
--
-- 破壊性: なし（新規テーブルのみ）。
-- rollback: DROP TABLE IF EXISTS test_operators;

CREATE TABLE IF NOT EXISTS test_operators (
  line_user_id text PRIMARY KEY,
  -- 管理画面で誰か分かるようにするための呼び名（例: 篠原）。LINE の表示名とは別に持つ。
  label        text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE test_operators IS
  'テスト運営者。完了済みのアンケートを何度でも回答し直せ、回答は is_test として集計から外れる。';

GRANT SELECT, INSERT, UPDATE, DELETE ON test_operators TO service_role;
