-- -------------------------------------------------------
-- 027: 本音・悩み投稿 感情タグ強化 / AI一言返信
-- -------------------------------------------------------

-- -------------------------------------------------------
-- user_posts: AI返信フィールドを追加
-- -------------------------------------------------------
alter table user_posts
  add column if not exists ai_reply_text         text,
  add column if not exists ai_reply_generated_at timestamptz,
  add column if not exists ai_reply_status       text;

-- -------------------------------------------------------
-- rant_tags: 悩みの場面・対象・テーマタグマスタ
-- -------------------------------------------------------
create table if not exists rant_tags (
  id         uuid     primary key default gen_random_uuid(),
  code       text     not null,
  label      text     not null,
  emoji      text     not null default '',
  category   text,
  sort_order integer  not null default 0,
  is_active  boolean  not null default true,
  created_at timestamptz not null default now(),
  constraint rant_tags_code_unique unique (code)
);

-- -------------------------------------------------------
-- rant_post_tags: 投稿とタグの中間テーブル
-- -------------------------------------------------------
create table if not exists rant_post_tags (
  id           uuid primary key default gen_random_uuid(),
  rant_post_id uuid not null references user_posts(id) on delete cascade,
  rant_tag_id  uuid not null references rant_tags(id)  on delete cascade,
  created_at   timestamptz not null default now(),
  constraint rant_post_tags_unique unique (rant_post_id, rant_tag_id)
);

-- -------------------------------------------------------
-- インデックス
-- -------------------------------------------------------
create index if not exists idx_rant_post_tags_post_id on rant_post_tags(rant_post_id);
create index if not exists idx_rant_post_tags_tag_id  on rant_post_tags(rant_tag_id);
create index if not exists idx_rant_tags_active_order on rant_tags(is_active, sort_order);

-- -------------------------------------------------------
-- 初期データ: 悩みタグ
-- -------------------------------------------------------
insert into rant_tags (code, label, emoji, category, sort_order) values
  ('work',        '仕事',      '💼', 'work',     1),
  ('boss',        '上司',      '👔', 'work',     2),
  ('client',      '取引先',    '🤝', 'work',     3),
  ('colleague',   '同僚',      '🧑‍💼', 'work',  4),
  ('love',        '恋愛',      '❤️', 'personal', 5),
  ('breakup',     '失恋',      '💔', 'personal', 6),
  ('family',      '家族',      '👪', 'personal', 7),
  ('husband',     '夫',        '🧔', 'personal', 8),
  ('wife',        '妻',        '👩', 'personal', 9),
  ('children',    '子ども',    '👶', 'personal', 10),
  ('money',       'お金',      '💰', 'life',     11),
  ('life',        '生活',      '🏠', 'life',     12),
  ('mental',      'メンタル',  '🧠', 'mental',   13),
  ('frustration', '不満',      '😡', 'emotion',  14),
  ('loneliness',  '孤独',      '😢', 'emotion',  15),
  ('no_time',     '時間がない', '🕒', 'life',    16)
on conflict (code) do nothing;
