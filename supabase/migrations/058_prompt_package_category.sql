-- ============================================================
-- 058: プロンプトパッケージ カテゴリ追加
-- 目的: パッケージの用途分類（インタビュー/アンケート等）を持たせ
--       一覧フィルタリングや視認性を向上させる
-- ============================================================

ALTER TABLE prompt_packages
  ADD COLUMN IF NOT EXISTS category text;

COMMENT ON COLUMN prompt_packages.category IS
  'パッケージカテゴリ（interview / survey / diary / analysis / chat / other）。null = 未分類';
