-- 064_store_survey_entry.sql
-- 単発・店舗向けアンケート導線: 案件の公開区分と店舗流入キーを追加する。
-- visibility_type='private_store' の案件は公開一覧(探す)に出さず、
-- entry_code に紐づく専用URL/QRからのみ回答へ到達できる。

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS visibility_type text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS entry_code      text,
  ADD COLUMN IF NOT EXISTS client_id       uuid;

-- 既存案件は DEFAULT 'public' により後方互換（公開一覧に従来どおり表示）
ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_visibility_type_check;
ALTER TABLE projects
  ADD CONSTRAINT projects_visibility_type_check
    CHECK (visibility_type IN ('public', 'private_store'));

-- entry_code は店舗流入キー。NULL 許容・非 NULL は一意。
CREATE UNIQUE INDEX IF NOT EXISTS ux_projects_entry_code
  ON projects(entry_code) WHERE entry_code IS NOT NULL;

-- 企業/店舗マスタ（任意・単発運用では未使用でよい。複数店舗を1企業で束ねる将来拡張用）
CREATE TABLE IF NOT EXISTS clients (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text        NOT NULL,
  contact    text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- アプリは service_role キーで接続するため service_role への付与が必須
-- （抜けると「permission denied for table clients」になる）
GRANT SELECT, INSERT, UPDATE, DELETE ON clients TO service_role, authenticated, anon;
