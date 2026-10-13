-- 118: 日付・時刻・期間の回答形式（docs/plan-datetime-answer-types.md）
--
-- question_type に date / time / datetime / period を追加する。
-- 075 で定義した制約を同じ一覧＋新4型で差し替えるだけ（許容値を広げるのみ＝既存行に影響しない）。
-- 設定は questions.config の任意キー（date_min_offset / date_max_offset / time_step_minutes /
-- time_min / time_max / period_unit）で持つため、列の追加は無い。

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
      'image_heatmap',
      -- 118: 日付・時刻・期間
      'date',
      'time',
      'datetime',
      'period'
    )
  );
