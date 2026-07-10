-- 075: 回答UIプリセット（casual/standard/formal）＋新設問形式4型
--   - projects.answer_ui_preset を追加（プロジェクト単位の回答UIプリセット）
--   - questions.question_type CHECK 制約に新4型を追加
--     （pairwise / ranking_top_n / point_allocation / image_heatmap）
-- 設問単位の presentation 上書き・新型の config は既存 question_config(JSONB) に格納するため DDL 不要。
-- 新テーブルなし → service_role GRANT の追加は不要。

-- 1. プロジェクト単位の回答UIプリセット
alter table projects
  add column if not exists answer_ui_preset text not null default 'standard'
  check (answer_ui_preset in ('casual','standard','formal'));

comment on column projects.answer_ui_preset is
  '回答UIプリセット casual=A(スワイプ)/standard=B(タップ)/formal=C(従来型)。設問単位 question_config.presentation.pattern で上書き可。';

-- 2. question_type CHECK 制約に新4型を追加（021 で定義済みの制約を差し替え）
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
      'sd',
      -- 075: 新設問形式
      'pairwise',
      'ranking_top_n',
      'point_allocation',
      'image_heatmap'
    )
  );
