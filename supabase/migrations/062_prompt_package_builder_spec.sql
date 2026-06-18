-- ============================================================
-- 062: prompt_package_versions に プロンプトビルダー方針 を追加（Phase F）
-- 目的: パッケージ Version を「方針管理」主体にする。運用者が AI の振る舞い方針
--   （用途 / 目的 / 質問スタイル / 深掘り方針 / 完了条件 / 曖昧回答対応 /
--    回答なし対応 / 禁止事項 / 出力形式 / AI人格 / 対象ユーザー）を構造化して保持し、
--   その方針から Version 作成時に一度だけ AI が templates_json（会話系10キー）を生成する。
-- 設計:
--   - 追加のみ・後方互換（既存行は NULL）。
--   - builder_spec_json は「生成の入力 兼 再編集用ソース」。実行時には参照しない
--     （実行時は従来どおり templates_json を解決する）。
-- 形式（builder_spec_json の主なキー・すべて任意）:
--   purpose / goal / targetUser / aiPersona / questionStyle / probePolicy /
--   completionCondition / ambiguousAnswer / noneAnswer / outputFormatNote : text
--   prohibitions : text[]
-- 影響:
--   - 既存行は NULL（後方互換）。runtime のプロンプト解決には影響しない。
-- ============================================================

ALTER TABLE prompt_package_versions
  ADD COLUMN IF NOT EXISTS builder_spec_json jsonb;

COMMENT ON COLUMN prompt_package_versions.builder_spec_json IS
  'プロンプトビルダー方針スナップショット（AI生成の入力／再編集用ソース）。実行時には参照しない。Phase F';
