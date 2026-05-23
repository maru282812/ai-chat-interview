-- -------------------------------------------------------
-- 026: 日記・本音投稿の感情ログ・構造化入力・AI対応・機能フラグ
-- -------------------------------------------------------

-- -------------------------------------------------------
-- user_posts: 感情・構造化入力・AI予備フィールドを追加
-- -------------------------------------------------------
alter table user_posts
  add column if not exists emotion_tags         jsonb    not null default '[]'::jsonb,
  add column if not exists mood_score           integer,
  add column if not exists good_thing           text,
  add column if not exists bad_thing            text,
  add column if not exists selected_prompt_id   uuid,
  add column if not exists selected_one_line_id uuid,
  add column if not exists ai_summary           text,
  add column if not exists ai_feedback          text,
  add column if not exists ai_sentiment_score   numeric(5, 4),
  add column if not exists ai_stress_score      numeric(5, 4),
  add column if not exists ai_detected_topics   jsonb    not null default '[]'::jsonb,
  add column if not exists ai_enabled           boolean  not null default false,
  add column if not exists ai_visible_to_user   boolean  not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'user_posts_mood_score_range'
  ) then
    alter table user_posts add constraint user_posts_mood_score_range
      check (mood_score between 1 and 5);
  end if;
end $$;

-- -------------------------------------------------------
-- 感情タグマスタ
-- -------------------------------------------------------
create table if not exists emotion_tag_master (
  id           uuid     primary key default gen_random_uuid(),
  code         text     not null,
  label        text     not null,
  emoji        text     not null default '',
  display_order integer not null default 0,
  is_active    boolean  not null default true,
  created_at   timestamptz not null default now(),
  constraint emotion_tag_master_code_unique unique (code)
);

-- -------------------------------------------------------
-- 一言選択マスタ
-- -------------------------------------------------------
create table if not exists one_line_prompt_master (
  id           uuid     primary key default gen_random_uuid(),
  text         text     not null,
  category     text,
  display_order integer not null default 0,
  is_active    boolean  not null default true,
  created_at   timestamptz not null default now()
);

-- -------------------------------------------------------
-- 日記話題提供マスタ
-- -------------------------------------------------------
create table if not exists diary_topic_master (
  id           uuid     primary key default gen_random_uuid(),
  text         text     not null,
  category     text,
  display_order integer not null default 0,
  is_active    boolean  not null default true,
  created_at   timestamptz not null default now()
);

-- -------------------------------------------------------
-- 機能フラグ（AI機能の段階解禁用）
-- -------------------------------------------------------
create table if not exists feature_flags (
  id                 uuid     primary key default gen_random_uuid(),
  feature_key        text     not null,
  is_enabled         boolean  not null default false,
  min_plan           text,
  min_revenue_stage  text,
  description        text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint feature_flags_key_unique unique (feature_key)
);

-- -------------------------------------------------------
-- AI利用ログ（コスト計測・利用制限用）
-- -------------------------------------------------------
create table if not exists ai_usage_logs (
  id             uuid     primary key default gen_random_uuid(),
  user_id        text     not null,
  feature_type   text     not null,
  input_tokens   integer  not null default 0,
  output_tokens  integer  not null default 0,
  estimated_cost numeric(10, 6) not null default 0,
  used_at        timestamptz not null default now()
);

-- -------------------------------------------------------
-- インデックス
-- -------------------------------------------------------
create index if not exists idx_user_posts_user_type_posted_on
  on user_posts(user_id, type, posted_on desc);

create index if not exists idx_user_posts_emotion_tags
  on user_posts using gin (emotion_tags);

create index if not exists idx_ai_usage_logs_user_feature
  on ai_usage_logs(user_id, feature_type, used_at desc);

create index if not exists idx_emotion_tag_master_active_order
  on emotion_tag_master(is_active, display_order);

create index if not exists idx_one_line_prompt_master_active_order
  on one_line_prompt_master(is_active, display_order);

create index if not exists idx_diary_topic_master_active_order
  on diary_topic_master(is_active, display_order);

create index if not exists idx_feature_flags_key
  on feature_flags(feature_key, is_enabled);

-- -------------------------------------------------------
-- トリガー
-- -------------------------------------------------------
drop trigger if exists trg_feature_flags_updated_at on feature_flags;
create trigger trg_feature_flags_updated_at before update on feature_flags
for each row execute function set_updated_at();

-- -------------------------------------------------------
-- 初期データ: 感情タグ
-- -------------------------------------------------------
insert into emotion_tag_master (code, label, emoji, display_order) values
  ('happy',     '嬉しい',         '😊', 1),
  ('fun',       '楽しい',         '😄', 2),
  ('calm',      '落ち着いてる',    '😌', 3),
  ('motivated', 'やる気がある',    '💪', 4),
  ('proud',     '自分を褒めたい',  '⭐', 5),
  ('tired',     '疲れた',         '😩', 6),
  ('sleepy',    '眠い',           '😴', 7),
  ('anxious',   '不安',           '😰', 8),
  ('moody',     'モヤモヤ',       '🌫', 9),
  ('irritated', 'イライラ',       '😠', 10),
  ('sad',       '悲しい',         '😢', 11)
on conflict (code) do nothing;

-- -------------------------------------------------------
-- 初期データ: 一言選択
-- -------------------------------------------------------
insert into one_line_prompt_master (text, display_order) values
  ('今日は少し疲れた',             1),
  ('今日は気持ちが軽い',           2),
  ('今日は誰かに話を聞いてほしい', 3),
  ('今日は何もしたくない',         4),
  ('今日は少し前向きになれた',     5),
  ('今日はイライラしやすかった',   6),
  ('今日は安心できる時間があった', 7),
  ('今日は自分を褒めたい',         8),
  ('今日はモヤモヤが残っている',   9),
  ('今日はよく頑張った',          10);

-- -------------------------------------------------------
-- 初期データ: 日記話題提供
-- -------------------------------------------------------
insert into diary_topic_master (text, display_order) values
  ('今日一番印象に残ったことは？',           1),
  ('最近少し気になっていることは？',         2),
  ('今日、自分を褒めるなら？',              3),
  ('誰かに言いたかったことは？',             4),
  ('最近不安に感じていることは？',           5),
  ('今日うれしかったことは？',              6),
  ('最近ハマっていることは？',              7),
  ('今週、ちょっと頑張ったことは？',         8),
  ('最近、誰かに感謝したいと思ったことは？', 9),
  ('今日の自分に一言かけるとしたら？',      10);

-- -------------------------------------------------------
-- 初期データ: 機能フラグ（すべて無効 = 初期リリースはAI非表示）
-- -------------------------------------------------------
insert into feature_flags (feature_key, is_enabled, min_revenue_stage, description) values
  ('ai_post_summary',       false, 'stage2', 'AI要約：投稿本文の自動要約（管理者のみ確認可）'),
  ('ai_sentiment_analysis', false, 'stage2', 'AI感情スコア・ストレス推定'),
  ('ai_feedback',           false, 'stage3', 'AIフィードバック：投稿後1回のみ'),
  ('ai_chat',               false, 'stage5', 'カウンセラーAIチャット（有料機能）'),
  ('voice_input',           false, 'stage4', '音声入力・文字起こし（有料ユーザー限定）')
on conflict (feature_key) do nothing;
