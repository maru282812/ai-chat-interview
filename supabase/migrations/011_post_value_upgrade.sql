alter table user_posts
  add column if not exists quality_score integer not null default 0,
  add column if not exists quality_label text not null default 'low';

alter table post_analysis
  add column if not exists insight_type text not null default 'other',
  add column if not exists specificity integer not null default 0,
  add column if not exists novelty integer not null default 0;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_posts_quality_score_range'
  ) then
    alter table user_posts
      add constraint user_posts_quality_score_range
      check (quality_score between 0 and 100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'user_posts_quality_label_check'
  ) then
    alter table user_posts
      add constraint user_posts_quality_label_check
      check (quality_label in ('low', 'medium', 'high'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'post_analysis_insight_type_check'
  ) then
    alter table post_analysis
      add constraint post_analysis_insight_type_check
      check (insight_type in ('issue', 'request', 'complaint', 'praise', 'other'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'post_analysis_specificity_range'
  ) then
    alter table post_analysis
      add constraint post_analysis_specificity_range
      check (specificity between 0 and 100);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'post_analysis_novelty_range'
  ) then
    alter table post_analysis
      add constraint post_analysis_novelty_range
      check (novelty between 0 and 100);
  end if;
end $$;

create index if not exists idx_user_posts_quality_score
  on user_posts(quality_score desc, created_at desc);

create index if not exists idx_post_analysis_insight_type
  on post_analysis(insight_type, sentiment, analyzed_at desc);

create or replace view project_high_value_posts as
select
  p.id,
  p.user_id,
  p.respondent_id,
  p.project_id,
  p.session_id,
  p.answer_id,
  p.type,
  p.source_channel,
  p.source_mode,
  p.menu_action_key,
  p.title,
  p.content,
  p.metadata,
  p.posted_on,
  p.quality_score,
  p.quality_label,
  p.created_at,
  a.summary,
  a.tags,
  a.sentiment,
  a.keywords,
  a.mentioned_brands,
  a.pii_flags,
  a.actionability,
  a.insight_type,
  a.specificity,
  a.novelty
from user_posts p
left join post_analysis a on a.post_id = p.id
where p.type in ('free_comment', 'rant', 'diary');
