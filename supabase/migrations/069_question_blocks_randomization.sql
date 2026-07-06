-- ============================================================
-- 069: ブロック＝ページグループ拡張 + ランダム化（統計エクスポート §3 / §22）
-- §12 方針に従い、既存の question_page_groups を「ブロック」として扱う。
-- ページ単位のランダム化・ページ内ランダム化・ページ内順序固定をフラグで制御する。
-- ランダム化の再現性のため、回答者(セッション)ごとに乱数シードと実表示順を保存する。
--
-- 後方互換: フラグ未設定なら従来どおりマスター順（sort_order）。
-- sessions.display_order_json が NULL のセッションは export でマスター順にフォールバック。
-- ============================================================

ALTER TABLE question_page_groups
  -- このページ(ブロック)自体をページ間ランダム化の対象にするか
  ADD COLUMN IF NOT EXISTS is_randomizable  boolean NOT NULL DEFAULT false,
  -- ページ(ブロック)内の設問順をランダム化するか
  ADD COLUMN IF NOT EXISTS randomize_within boolean NOT NULL DEFAULT false,
  -- ページ(ブロック)内の設問順を固定する（randomize_within より優先）
  ADD COLUMN IF NOT EXISTS fix_within       boolean NOT NULL DEFAULT false;

-- 再現性（§22）と実表示順の記録（§3）。display_order_json は { question_id: position }。
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS randomization_seed text,
  ADD COLUMN IF NOT EXISTS display_order_json jsonb;
