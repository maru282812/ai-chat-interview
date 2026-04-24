-- ============================================================
-- 019: answers.free_text_answer カラム追加
-- 目的: LIFF アンケート/インタビューの自由記述回答を格納する。
--      アプリ側で必須入力・定型文禁止を制御する。
-- ============================================================

alter table answers
  add column if not exists free_text_answer text;

comment on column answers.free_text_answer is
  '自由記述回答。LIFF 経由回答では必須（アプリ側制御）。空文字・定型文は不可。';
