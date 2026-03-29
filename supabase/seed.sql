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

update projects
set
  research_mode = 'survey_with_interview_probe',
  primary_objectives = '["飲用シーンごとの選択理由","継続利用を左右する決定要因"]'::jsonb,
  secondary_objectives = '["ブランド想起","代替候補との関係"]'::jsonb,
  comparison_constraints = '["最初に選ぶ飲料カテゴリ","主な利用シーン","継続理由","不満の有無","総合満足度"]'::jsonb,
  prompt_rules = '["1回の質問で論点は1つまで","回答者が迷いやすい専門用語は避ける","比較可能な観点から脱線しない"]'::jsonb,
  probe_policy = '{
    "enabled": true,
    "conditions": ["short_answer", "abstract_answer"],
    "max_probes_per_answer": 1,
    "max_probes_per_session": 2,
    "require_question_probe_enabled": true,
    "target_question_codes": ["Q2", "Q3", "Q5", "Q6"],
    "blocked_question_codes": ["Q1", "Q4", "Q7"],
    "short_answer_min_length": 10,
    "end_conditions": [
      "answer_sufficient",
      "max_probes_per_answer",
      "max_probes_per_session",
      "question_not_target",
      "question_blocked",
      "user_declined"
    ]
  }'::jsonb,
  response_style = '{
    "channel": "line",
    "tone": "natural_japanese",
    "max_characters_per_message": 80,
    "max_sentences": 2
  }'::jsonb,
  ai_state_template_key = 'product_feedback',
  ai_state_generated_at = now(),
  ai_state_json = '{
    "version": "v1",
    "template_key": "product_feedback",
    "project_goal": "20代女性の飲料利用体験と不満を理解する",
    "user_understanding_goal": "利用シーン、評価、不満、改善要望を把握する",
    "required_slots": [
      {
        "key": "product_name",
        "label": "商品名",
        "required": true,
        "description": "話題にしている飲料名",
        "examples": ["午後の紅茶", "無糖アイスコーヒー"]
      },
      {
        "key": "usage_scene",
        "label": "利用シーン",
        "required": true,
        "description": "どんな場面で飲むか",
        "examples": ["通勤中", "仕事の休憩中"]
      },
      {
        "key": "good_point",
        "label": "良かった点",
        "required": true,
        "description": "満足している点",
        "examples": ["飲みやすい", "気分転換になる"]
      }
    ],
    "optional_slots": [
      {
        "key": "bad_point",
        "label": "不満点",
        "required": false,
        "description": "不便や不満",
        "examples": ["甘すぎる", "量が少ない"]
      },
      {
        "key": "improvement_request",
        "label": "改善要望",
        "required": false,
        "description": "改善してほしいこと",
        "examples": ["甘さ控えめ", "持ち運びしやすい容器"]
      }
    ],
    "question_categories": ["事実確認", "利用状況", "評価", "不満", "改善要望"],
    "probe_policy": {
      "default_max_probes": 1,
      "force_probe_on_bad": true,
      "strict_topic_lock": true,
      "allow_followup_expansion": false
    },
    "completion_rule": {
      "required_slots_needed": ["product_name", "usage_scene", "good_point"],
      "allow_finish_without_optional": true,
      "min_required_slots_to_finish": 3
    },
    "topic_control": {
      "forbidden_topic_shift": true,
      "topic_lock_note": "飲料利用体験から逸脱しない"
    },
    "language": "ja"
  }'::jsonb
where id = '00000000-0000-4000-8000-000000000001';

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

update questions
set question_role = 'screening'
where project_id = '00000000-0000-4000-8000-000000000001'
  and question_code = 'Q1';

update questions
set question_role = 'main'
where project_id = '00000000-0000-4000-8000-000000000001'
  and question_code in ('Q2', 'Q6');

update questions
set question_role = 'comparison_core'
where project_id = '00000000-0000-4000-8000-000000000001'
  and question_code in ('Q3', 'Q7');

update questions
set question_role = 'attribute'
where project_id = '00000000-0000-4000-8000-000000000001'
  and question_code = 'Q4';

update questions
set question_role = 'probe_trigger'
where project_id = '00000000-0000-4000-8000-000000000001'
  and question_code = 'Q5';

update questions
set question_config = coalesce(question_config, '{}'::jsonb) || '{
  "conversationControl": {
    "probeIntent": "飲用シーンを比較可能な形でそろえる",
    "coreInfoPrompt": "比較のため、よく飲む場面を いつ・どこで のどちらかで教えてください。",
    "answerExample": "平日の午後に職場で飲みます",
    "shortAnswerMinLength": 10,
    "sufficientAnswerMinLength": 20
  }
}'::jsonb
where project_id = '00000000-0000-4000-8000-000000000001'
  and question_code = 'Q2';

update questions
set question_config = coalesce(question_config, '{}'::jsonb) || '{
  "conversationControl": {
    "probeIntent": "選択理由の比較用コア情報をそろえる",
    "coreInfoPrompt": "比較のため、一番重視する点を一言で教えてください。",
    "answerExample": "味が好みに合うからです",
    "shortAnswerMinLength": 8,
    "sufficientAnswerMinLength": 18
  }
}'::jsonb
where project_id = '00000000-0000-4000-8000-000000000001'
  and question_code = 'Q3';

update questions
set question_config = coalesce(question_config, '{}'::jsonb) || '{
  "conversationControl": {
    "probeIntent": "不満の比較軸をそろえる",
    "coreInfoPrompt": "比較のため、どの点がいちばん不満か一言で教えてください。",
    "answerExample": "甘すぎるところです",
    "shortAnswerMinLength": 8,
    "sufficientAnswerMinLength": 18
  }
}'::jsonb
where project_id = '00000000-0000-4000-8000-000000000001'
  and question_code = 'Q5';

update questions
set question_config = coalesce(question_config, '{}'::jsonb) || '{
  "conversationControl": {
    "probeIntent": "代替選択肢の比較用コア情報を取る",
    "coreInfoPrompt": "比較のため、代わりに選ぶものを一つ教えてください。",
    "answerExample": "無糖の炭酸水です",
    "shortAnswerMinLength": 8,
    "sufficientAnswerMinLength": 16
  }
}'::jsonb
where project_id = '00000000-0000-4000-8000-000000000001'
  and question_code = 'Q6';

insert into questions (
  project_id,
  question_code,
  question_text,
  question_role,
  question_type,
  is_required,
  sort_order,
  branch_rule,
  question_config,
  ai_probe_enabled,
  is_system,
  is_hidden
)
values (
  '00000000-0000-4000-8000-000000000001',
  '__free_comment__',
  '最後に、設問に入っていないことでも、感じたことや伝えておきたいことがあれば自由に教えてください。短くても大丈夫です。',
  'free_comment',
  'text',
  true,
  8,
  null,
  '{"placeholder":"自由に入力してください"}'::jsonb,
  false,
  true,
  true
)
on conflict (project_id, question_code) do update
set
  question_text = excluded.question_text,
  question_role = excluded.question_role,
  question_type = excluded.question_type,
  is_required = excluded.is_required,
  sort_order = excluded.sort_order,
  question_config = excluded.question_config,
  ai_probe_enabled = excluded.ai_probe_enabled,
  is_system = excluded.is_system,
  is_hidden = excluded.is_hidden;

insert into line_menu_actions (
  menu_key,
  label,
  action_type,
  action_payload,
  sort_order,
  is_active
)
values
  ('participate_research', '調査に参加', 'start_project_list', '{"aliases":["案件一覧"]}'::jsonb, 10, true),
  ('share_rant', '本音・悩み', 'open_post_mode', '{"postType":"rant","prompt":"本音や悩みがあれば、そのまま送ってください。長文でも大丈夫です。"}'::jsonb, 20, true),
  ('today_feeling', '今日の気持ち', 'open_post_mode', '{"postType":"diary","prompt":"今日の気持ちや出来事を自由に送ってください。短くても大丈夫です。"}'::jsonb, 30, true),
  ('mypage', 'マイページ', 'show_mypage', '{"aliases":["mypage"]}'::jsonb, 40, true),
  ('personality', '性格診断', 'show_personality', '{}'::jsonb, 50, true)
on conflict (menu_key) do update
set
  label = excluded.label,
  action_type = excluded.action_type,
  action_payload = excluded.action_payload,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

insert into liff_entrypoints (
  entry_key,
  title,
  path,
  entry_type,
  settings_json,
  is_active
)
values
  ('rant', '本音・悩み', '/liff/rant', 'rant', '{}'::jsonb, true),
  ('diary', '今日の気持ち', '/liff/diary', 'diary', '{}'::jsonb, true),
  ('personality', '性格診断', '/liff/personality', 'personality', '{}'::jsonb, true)
on conflict (entry_key) do update
set
  title = excluded.title,
  path = excluded.path,
  entry_type = excluded.entry_type,
  settings_json = excluded.settings_json,
  is_active = excluded.is_active;

update line_menu_actions
set liff_path = 'rant'
where menu_key = 'share_rant';

update line_menu_actions
set liff_path = 'diary'
where menu_key = 'today_feeling';

update line_menu_actions
set liff_path = 'personality'
where menu_key = 'personality';
