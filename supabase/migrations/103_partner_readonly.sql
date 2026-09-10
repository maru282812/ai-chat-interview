-- 103_partner_readonly.sql
-- 運営が ACI 管理画面で作って回している案件（美容室ABCサイクルの A/B/C 等）を、
-- 会員ポータル（hibi-portal）の店舗に「閲覧専用」で紐づけるためのフラグ。
--
-- 背景:
--   既存の割り当て（POST /api/partner-admin/surveys/:id/assign）は
--   「draft/ready・回答0件・4種に写像できる設問のみ」を条件にしており、
--   稼働中で回答が集まっている案件は載せられない。
--   一方、店舗には回答数・性年代・申し送り（規約 第9条3項）だけ見せたい、という需要がある。
--
-- 何をするか:
--   projects.partner_readonly = true の案件は、partner_store_id で店舗に紐づくが
--   店舗側からの書き込み（PUT / publish / close）は 409 で拒否される。
--   また運営API の unassign（entry_code を落とす）は当てられず、unwatch だけが解除経路になる。
--   → 稼働中の QR（entry_code）を誤って殺さないための分離。
--
-- 追加のみ。既存列の型変更・削除は行わない。

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS partner_readonly boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN projects.partner_readonly IS
  'true なら会員ポータルの店舗に「閲覧専用」で紐づいた案件（partner_store_id と併用）。店舗からの書き込み API は 409。解除は unwatch のみ';
