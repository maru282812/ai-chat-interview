-- -------------------------------------------------------
-- 030: スクリーニング設問・通過対象回答フラグ追加
-- questions テーブルに is_screening_question を追加する。
-- 回答選択肢の isScreeningPass は question_config JSON 内で管理する（別テーブル不要）。
-- -------------------------------------------------------

alter table questions
  add column if not exists is_screening_question boolean not null default false;

-- question_role = 'screening' の既存設問を is_screening_question = true に揃える
update questions
  set is_screening_question = true
  where question_role = 'screening';
