-- 078_rawdata_phase2_ua_ip_income.sql
-- ロウデータ出力 Phase2（docs/plan-rawdata-export.md）
-- ① UA/IP のセッション単位収集: 不正回答検出用。LIFF アンケートのセッション作成時に記録し、
--    rawdata.csv の UserAgent / IPAddress 列に出力する（LINEチャット経由のセッションは null のまま）。
-- ② 世帯年収プロフィール項目: user_profiles.household_income（コード文字列・選択肢は
--    lib/rawdataExport.ts の INCOME_CODES が正）。rawdata.csv の INC 列に出力する。
-- 既存テーブルへの nullable 追加のみ（後方互換・GRANT/RLS 変更不要）。

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_agent text;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS ip_address text;

ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS household_income text;
