insert into projects (
  id,
  name,
  client_name,
  objective,
  status,
  reward_points
) values (
  '00000000-0000-4000-8000-000000000001',
  '飲料利用実態インタビュー',
  'Sample Client',
  '飲料カテゴリの利用シーン、購入動機、不満点を把握する',
  'active',
  30
)
on conflict (id) do update
set
  name = excluded.name,
  client_name = excluded.client_name,
  objective = excluded.objective,
  status = excluded.status,
  reward_points = excluded.reward_points;

insert into ranks (rank_code, rank_name, min_points, sort_order, badge_label)
values
  ('bronze', 'Bronze', 0, 1, 'Starter Researcher'),
  ('silver', 'Silver', 100, 2, 'Steady Contributor'),
  ('gold', 'Gold', 250, 3, 'Insight Hunter'),
  ('platinum', 'Platinum', 500, 4, 'Premium Panelist')
on conflict (rank_code) do update
set
  rank_name = excluded.rank_name,
  min_points = excluded.min_points,
  sort_order = excluded.sort_order,
  badge_label = excluded.badge_label;

insert into reward_rules (rule_code, rule_name, rule_type, project_id, points, is_active, config_json)
values
  ('first_completion_bonus', '初回参加ボーナス', 'global', null, 20, true, '{}'::jsonb),
  ('continuity_completion_bonus', '継続参加ボーナス', 'global', null, 10, true, '{"daysWindow":30}'::jsonb),
  ('project_completion_bonus', '特定案件ボーナス', 'project', '00000000-0000-4000-8000-000000000001', 5, true, '{}'::jsonb)
on conflict (rule_code, project_id) do update
set
  rule_name = excluded.rule_name,
  points = excluded.points,
  is_active = excluded.is_active,
  config_json = excluded.config_json;

delete from questions where project_id = '00000000-0000-4000-8000-000000000001';

insert into questions (
  project_id,
  question_code,
  question_text,
  question_type,
  is_required,
  sort_order,
  branch_rule,
  question_config,
  ai_probe_enabled
)
values
  (
    '00000000-0000-4000-8000-000000000001',
    'Q1',
    '最近よく飲む飲料カテゴリを教えてください。',
    'single_select',
    true,
    1,
    null,
    '{"options":[{"value":"tea","label":"お茶"},{"value":"coffee","label":"コーヒー"},{"value":"water","label":"水"},{"value":"energy","label":"エナジードリンク"},{"value":"other","label":"その他"}]}'::jsonb,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    'Q2',
    'その飲料を飲む主な場面を教えてください。',
    'text',
    true,
    2,
    null,
    '{"helpText":"例: 通勤中、仕事中、家でリラックス時"}'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    'Q3',
    'その飲料を選ぶ一番大きな理由は何ですか。',
    'text',
    true,
    3,
    null,
    '{"helpText":"例: 味、眠気対策、健康、習慣"}'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    'Q4',
    '今使っている商品やブランドに不満はありますか。',
    'yes_no',
    true,
    4,
    '[{"when":{"operator":"equals","value":false},"targetQuestionCode":"Q6"}]'::jsonb,
    null,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    'Q5',
    'どのような不満がありますか。できるだけ具体的に教えてください。',
    'text',
    true,
    5,
    null,
    '{"helpText":"例: 値段、味、容量、買いやすさ"}'::jsonb,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    'Q6',
    '今の選択肢が使えないとき、代わりに何を選びますか。',
    'text',
    true,
    6,
    null,
    null,
    true
  ),
  (
    '00000000-0000-4000-8000-000000000001',
    'Q7',
    '総合満足度を教えてください。',
    'scale',
    true,
    7,
    null,
    '{"scaleMin":1,"scaleMax":5,"scaleLabels":{"1":"不満","5":"満足"}}'::jsonb,
    false
  );
