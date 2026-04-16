-- ============================================================
-- 016: Question Schema Redesign (Phase 1)
-- 目的: アンケート/インタビュー共通の質問定義基盤を整備する
-- ============================================================

-- ----------------------------------------------------------
-- 1. projects: display_mode を追加
-- ----------------------------------------------------------
alter table projects
  add column if not exists display_mode text not null default 'survey_question';

alter table projects
  drop constraint if exists projects_display_mode_check;
alter table projects
  add constraint projects_display_mode_check
  check (display_mode in ('survey_page', 'survey_question', 'interview_chat'));

-- 既存データの移行:
--   research_mode='interview' → interview_chat
--   それ以外                  → survey_question (default)
update projects
  set display_mode = 'interview_chat'
  where research_mode = 'interview'
    and display_mode = 'survey_question';

-- ----------------------------------------------------------
-- 2. question_page_groups: survey_page モード用ページ管理
-- ----------------------------------------------------------
create table if not exists question_page_groups (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  page_number   integer not null,
  title         text,
  description   text,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (project_id, page_number)
);

create index if not exists idx_question_page_groups_project
  on question_page_groups(project_id);

drop trigger if exists trg_question_page_groups_updated_at on question_page_groups;
create trigger trg_question_page_groups_updated_at
  before update on question_page_groups
  for each row execute function set_updated_at();

-- ----------------------------------------------------------
-- 3. questions: question_type の制約を拡張
-- ----------------------------------------------------------
alter table questions
  drop constraint if exists questions_question_type_check;
alter table questions
  add constraint questions_question_type_check
  check (question_type in (
    -- 既存（後方互換）
    'text', 'single_select', 'multi_select', 'yes_no', 'scale',
    -- 新規: 選択系
    'single_choice', 'multi_choice',
    -- 新規: マトリクス系
    'matrix_single', 'matrix_multi', 'matrix_mixed',
    -- 新規: テキスト系
    'free_text_short', 'free_text_long',
    -- 新規: 数値
    'numeric',
    -- 新規: 画像
    'image_upload',
    -- 新規: 隠し項目
    'hidden_single', 'hidden_multi',
    -- 新規: 画像付きテキスト
    'text_with_image',
    -- 新規: SD法
    'sd'
  ));

-- ----------------------------------------------------------
-- 4. questions: 新カラム追加
-- ----------------------------------------------------------

-- コメント上下
alter table questions add column if not exists comment_top    text;
alter table questions add column if not exists comment_bottom text;

-- 回答出力タイプ
alter table questions add column if not exists answer_output_type text;
alter table questions
  drop constraint if exists questions_answer_output_type_check;
alter table questions
  add constraint questions_answer_output_type_check
  check (answer_output_type in ('text','number','boolean','array','object','none')
         or answer_output_type is null);

-- タグ系（raw 文字列 + 構造化 JSON）
alter table questions add column if not exists display_tags_raw    text;
alter table questions add column if not exists display_tags_parsed jsonb;

-- 表示条件（<pipe> を表示制御として使う場合の保存先）
alter table questions add column if not exists visibility_conditions jsonb;

-- ページグループ（survey_page モード用）
alter table questions
  add column if not exists page_group_id uuid
  references question_page_groups(id) on delete set null;

create index if not exists idx_questions_page_group
  on questions(page_group_id) where page_group_id is not null;

-- ----------------------------------------------------------
-- 5. 既存タグ未設定データの初期値
--    display_tags_raw と display_tags_parsed は null のまま許容
--    visibility_conditions は null のまま許容
-- ----------------------------------------------------------

-- 既存の branch_rule.default_next を next_rule_default として
-- question_config に重複なく入れることは Phase2 以降で対応。
-- 今は構造を変えずに新カラムを追加するのみ。

comment on column projects.display_mode is
  'アンケート/インタビューの表示モード: survey_page | survey_question | interview_chat';

comment on column questions.display_tags_raw is
  'PDFタグ仕様に基づく生タグ文字列（例: <size=20><must><pipe q1=1>）';

comment on column questions.display_tags_parsed is
  '構造化タグJSON。tagParser が raw から生成。アプリ内部ではこちらを正とする。';

comment on column questions.visibility_conditions is
  '設問の表示条件。<pipe> の表示制御用途を構造化保存する。';

comment on column questions.page_group_id is
  'survey_page モード時のページグループ。null = 未割当。';
