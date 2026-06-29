-- ============================================================
-- 067: 回答の有効性フラグ（統計エクスポート §17）
-- テスト回答を本番集計から除外できるよう respondents に is_test を追加する。
-- DEFAULT false により既存回答は全て本番扱い（後方互換）。
-- 重複・無効回答の判定は将来拡張（exclude_from_analysis 等）。
-- ============================================================

ALTER TABLE respondents
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_respondents_project_is_test
  ON respondents(project_id, is_test);
