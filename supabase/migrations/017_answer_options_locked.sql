-- ============================================================
-- 017: answer_options_locked カラム追加
-- 目的: 回答選択肢を固定するフラグを questions テーブルに追加する
--      このフラグが ON の場合、AI候補による自動上書きを行わない
-- ============================================================

alter table questions
  add column if not exists answer_options_locked boolean not null default false;

comment on column questions.answer_options_locked is
  '回答選択肢の固定フラグ。true の場合、AI候補による選択肢の自動上書きを行わない。';
