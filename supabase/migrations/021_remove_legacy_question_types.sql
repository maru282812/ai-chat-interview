-- 021: 旧型式 (text, single_select, multi_select, yes_no, scale) を question_type 制約から除外
-- 手順: 既存データを新型式に変換 → 制約を差し替え

-- 1. 既存データの旧型式を新型式に変換
update questions set question_type = 'free_text_long'  where question_type = 'text';
update questions set question_type = 'single_choice'   where question_type = 'single_select';
update questions set question_type = 'multi_choice'    where question_type = 'multi_select';
update questions set question_type = 'single_choice'   where question_type = 'yes_no';
update questions set question_type = 'numeric'         where question_type = 'scale';

-- 2. 016 で追加した制約を削除して新制約に差し替え
alter table questions
  drop constraint if exists questions_question_type_check;

alter table questions
  add constraint questions_question_type_check check (
    question_type in (
      'single_choice',
      'multi_choice',
      'matrix_single',
      'matrix_multi',
      'matrix_mixed',
      'free_text_short',
      'free_text_long',
      'numeric',
      'image_upload',
      'hidden_single',
      'hidden_multi',
      'text_with_image',
      'sd'
    )
  );
