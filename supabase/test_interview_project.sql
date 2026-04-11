ｎでコーヒーを買います。時間がないので早く買えて助かっています",
        "shortAnswerMinLength": 20,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '理由を聞く。具体例を聞く。感情を引き出す。',
    2,
    'static',
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'Q3',
    'コンビニに対して不満や改善してほしい点があれば教えてください。',
    'comparison_core',
    'text',
    true,
    3,
    null,
    '{
      "helpText": "小さなことでも構いません。困る場面や、こうなると良いという希望を教えてください",
      "placeholder": "例: 昼の時間帯はレジ待ちが長くて急いでいると困ります",
      "meta": {
        "research_goal": "コンビニ利用時の不満と改善ニーズを理解する",
        "question_goal": "不満点と、それが起きる場面、改善してほしい内容を具体的に知りたい",
        "probe_goal": "不満の理由、具体例、感情を引き出して改善要望につなげる",
        "expected_slots": [
          {
            "key": "pain_point",
            "label": "不満点",
            "description": "困っていることや嫌だと感じること",
            "required": true,
            "examples": ["レジ待ちが長い", "品切れが多い", "値段が高い"]
          },
          {
            "key": "pain_scene",
            "label": "発生場面",
            "description": "その不満が起きる場面",
            "required": true,
            "examples": ["昼休み", "夜遅い時間", "雨の日"]
          },
          {
            "key": "improvement_request",
            "label": "改善要望",
            "description": "改善してほしいこと",
            "required": false,
            "examples": ["セルフレジを増やしてほしい", "在庫を切らさないでほしい"]
          },
          {
            "key": "emotion",
            "label": "感情",
            "description": "その不満に対して感じること",
            "required": false,
            "examples": ["イライラする", "がっかりする"]
          }
        ],
        "required_slots": ["pain_point", "pain_scene"],
        "probe_config": {
          "max_probes": 2,
          "min_probes": 0,
          "force_probe_on_bad": true,
          "allow_followup_expansion": false,
          "strict_topic_lock": true
        },
        "completion_conditions": [
          { "type": "required_slots" },
          { "type": "no_bad_patterns" }
        ],
        "render_style": {
          "mode": "interview_natural",
          "connect_from_previous_answer": true,
          "avoid_question_number": true,
          "preserve_options": false
        }
      },
      "conversationControl": {
        "coreInfoPrompt": "どんな場面でその不満を感じるのか、なぜ気になるのか、できれば具体例も教えてください",
        "answerExample": "昼休みはレジ待ちが長く、急いでいるときにかなりストレスを感じます。セルフレジが増えると助かります",
        "shortAnswerMinLength": 20,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '理由を聞く。具体例を聞く。感情を引き出す。',
    2,
    'static',
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    '__free_comment__',
    '最後に、ここまでで話しきれなかったことがあれば自由に教えてください。',
    'free_comment',
    'text',
    true,
    4,
    null,
    '{
      "placeholder": "自由に入力してください",
      "meta": {
        "research_goal": "最後に補足したい内容を回収する",
        "question_goal": "これまでの回答で言い足りない点があれば受け取る",
        "probe_goal": "原則として深掘りしない",
        "expected_slots": [],
        "required_slots": [],
        "probe_config": {
          "max_probes": 0,
          "min_probes": 0,
          "force_probe_on_bad": false,
          "allow_followup_expansion": false,
          "strict_topic_lock": true
        },
        "completion_conditions": [],
        "render_style": {
          "mode": "free_comment",
          "connect_from_previous_answer": true,
          "avoid_question_number": true,
          "preserve_options": false
        }
      }
    }'::jsonb,
    false,
    null,
    null,
    'static',
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
  branch_rule = excluded.branch_rule,
  question_config = excluded.question_config,
  ai_probe_enabled = excluded.ai_probe_enabled,
  probe_guideline = excluded.probe_guideline,
  max_probe_count = excluded.max_probe_count,
  render_strategy = excluded.render_strategy,
  is_system = excluded.is_system,
  is_hidden = excluded.is_hidden;

-- Optional assignment example:
-- 1. Create or update a respondent row for the target LINE user in this project.
-- 2. Create or update the assignment so the project appears in "案件一覧".
--
-- Replace YOUR_LINE_USER_ID with the target user if you want to do this in SQL instead of admin UI.
--
-- with source_profile as (
--   select
--     'YOUR_LINE_USER_ID'::text as line_user_id,
--     max(display_name) as display_name,
--     max(total_points) as total_points,
--     max(current_rank_id) as current_rank_id
--   from respondents
--   where line_user_id = 'YOUR_LINE_USER_ID'
-- ),
-- target_respondent as (
--   insert into respondents (
--     line_user_id,
--     display_name,
--     project_id,
--     status,
--     total_points,
--     current_rank_id
--   )
--   select
--     source_profile.line_user_id,
--     source_profile.display_name,
--     '00000000-0000-4000-8000-000000000002',
--     'invited',
--     coalesce(source_profile.total_points, 0),
--     source_profile.current_rank_id
--   from source_profile
--   on conflict (line_user_id, project_id) do update
--   set
--     display_name = excluded.display_name,
--     total_points = excluded.total_points,
--     current_rank_id = excluded.current_rank_id
--   returning id, line_user_id
-- )
-- insert into project_assignments (
--   user_id,
--   project_id,
--   respondent_id,
--   assignment_type,
--   status,
--   assigned_at,
--   deadline
-- )
-- select
--   line_user_id,
--   '00000000-0000-4000-8000-000000000002',
--   id,
--   'manual',
--   'assigned',
--   now(),
--   null
-- from target_respondent
-- on conflict (project_id, respondent_id) do update
-- set
--   user_id = excluded.user_id,
--   assignment_type = excluded.assignment_type,
--   status = excluded.status,
--   assigned_at = excluded.assigned_at,
--   deadline = excluded.deadline,
--   sent_at = null,
--   opened_at = null,
--   started_at = null,
--   completed_at = null,
--   expired_at = null,
--   reminder_sent_at = null,
--   last_delivery_error = null;
のでコーヒーを買います。時間がないので早く買えて助かっています",
        "shortAnswerMinLength": 20,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '理由を聞く。具体例を聞く。感情を引き出す。',
    2,
    'static',
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'Q3',
    'コンビニに対して不満や改善してほしい点があれば教えてください。',
    'comparison_core',
    'text',
    true,
    3,
    null,
    '{
      "helpText": "小さなことでも構いません。困る場面や、こうなると良いという希望を教えてください",
      "placeholder": "例: 昼の時間帯はレジ待ちが長くて急いでいると困ります",
      "meta": {
        "research_goal": "コンビニ利用時の不満と改善ニーズを理解する",
        "question_goal": "不満点と、それが起きる場面、改善してほしい内容を具体的に知りたい",
        "probe_goal": "不満の理由、具体例、感情を引き出して改善要望につなげる",
        "expected_slots": [
          {
            "key": "pain_point",
            "label": "不満点",
            "description": "困っていることや嫌だと感じること",
            "required": true,
            "examples": ["レジ待ちが長い", "品切れが多い", "値段が高い"]
          },
          {
            "key": "pain_scene",
            "label": "発生場面",
            "description": "その不満が起きる場面",
            "required": true,
            "examples": ["昼休み", "夜遅い時間", "雨の日"]
          },
          {
            "key": "improvement_request",
            "label": "改善要望",
            "description": "改善してほしいこと",
            "required": false,
            "examples": ["セルフレジを増やしてほしい", "在庫を切らさないでほしい"]
          },
          {
            "key": "emotion",
            "label": "感情",
            "description": "その不満に対して感じること",
            "required": false,
            "examples": ["イライラする", "がっかりする"]
          }
        ],
        "required_slots": ["pain_point", "pain_scene"],
        "probe_config": {
          "max_probes": 2,
          "min_probes": 0,
          "force_probe_on_bad": true,
          "allow_followup_expansion": false,
          "strict_topic_lock": true
        },
        "completion_conditions": [
          { "type": "required_slots" },
          { "type": "no_bad_patterns" }
        ],
        "render_style": {
          "mode": "interview_natural",
          "connect_from_previous_answer": true,
          "avoid_question_number": true,
          "preserve_options": false
        }
      },
      "conversationControl": {
        "coreInfoPrompt": "どんな場面でその不満を感じるのか、なぜ気になるのか、できれば具体例も教えてください",
        "answerExample": "昼休みはレジ待ちが長く、急いでいるときにかなりストレスを感じます。セルフレジが増えると助かります",
        "shortAnswerMinLength": 20,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '理由を聞く。具体例を聞く。感情を引き出す。',
    2,
    'static',
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    '__free_comment__',
    '最後に、ここまでで話しきれなかったことがあれば自由に教えてください。',
    'free_comment',
    'text',
    true,
    4,
    null,
    '{
      "placeholder": "自由に入力してください",
      "meta": {
        "research_goal": "最後に補足したい内容を回収する",
        "question_goal": "これまでの回答で言い足りない点があれば受け取る",
        "probe_goal": "原則として深掘りしない",
        "expected_slots": [],
        "required_slots": [],
        "probe_config": {
          "max_probes": 0,
          "min_probes": 0,
          "force_probe_on_bad": false,
          "allow_followup_expansion": false,
          "strict_topic_lock": true
        },
        "completion_conditions": [],
        "render_style": {
          "mode": "free_comment",
          "connect_from_previous_answer": true,
          "avoid_question_number": true,
          "preserve_options": false
        }
      }
    }'::jsonb,
    false,
    null,
    null,
    'static',
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
  branch_rule = excluded.branch_rule,
  question_config = excluded.question_config,
  ai_probe_enabled = excluded.ai_probe_enabled,
  probe_guideline = excluded.probe_guideline,
  max_probe_count = excluded.max_probe_count,
  render_strategy = excluded.render_strategy,
  is_system = excluded.is_system,
  is_hidden = excluded.is_hidden;

-- Optional assignment example:
-- 1. Create or update a respondent row for the target LINE user in this project.
-- 2. Create or update the assignment so the project appears in "案件一覧".
--
-- Replace YOUR_LINE_USER_ID with the target user if you want to do this in SQL instead of admin UI.
--
-- with source_profile as (
--   select
--     'YOUR_LINE_USER_ID'::text as line_user_id,
--     max(display_name) as display_name,
--     max(total_points) as total_points,
--     max(current_rank_id) as current_rank_id
--   from respondents
--   where line_user_id = 'YOUR_LINE_USER_ID'
-- ),
-- target_respondent as (
--   insert into respondents (
--     line_user_id,
--     display_name,
--     project_id,
--     status,
--     total_points,
--     current_rank_id
--   )
--   select
--     source_profile.line_user_id,
--     source_profile.display_name,
--     '00000000-0000-4000-8000-000000000002',
--     'invited',
--     coalesce(source_profile.total_points, 0),
--     source_profile.current_rank_id
--   from source_profile
--   on conflict (line_user_id, project_id) do update
--   set
--     display_name = excluded.display_name,
--     total_points = excluded.total_points,
--     current_rank_id = excluded.current_rank_id
--   returning id, line_user_id
-- )
-- insert into project_assignments (
--   user_id,
--   project_id,
--   respondent_id,
--   assignment_type,
--   status,
--   assigned_at,
--   deadline
-- )
-- select
--   line_user_id,
--   '00000000-0000-4000-8000-000000000002',
--   id,
--   'manual',
--   'assigned',
--   now(),
--   null
-- from target_respondent
-- on conflict (project_id, respondent_id) do update
-- set
--   user_id = excluded.user_id,
--   assignment_type = excluded.assignment_type,
--   status = excluded.status,
--   assigned_at = excluded.assigned_at,
--   deadline = excluded.deadline,
--   sent_at = null,
--   opened_at = null,
--   started_at = null,
--   completed_at = null,
--   expired_at = null,
--   reminder_sent_at = null,
--   last_delivery_error = null;
でコーヒーを買います。時間がないので早く買えて助かっています",
        "shortAnswerMinLength": 20,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '理由を聞く。具体例を聞く。感情を引き出す。',
    2,
    'static',
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    'Q3',
    'コンビニに対して不満や改善してほしい点があれば教えてください。',
    'comparison_core',
    'text',
    true,
    3,
    null,
    '{
      "helpText": "小さなことでも構いません。困る場面や、こうなると良いという希望を教えてください",
      "placeholder": "例: 昼の時間帯はレジ待ちが長くて急いでいると困ります",
      "meta": {
        "research_goal": "コンビニ利用時の不満と改善ニーズを理解する",
        "question_goal": "不満点と、それが起きる場面、改善してほしい内容を具体的に知りたい",
        "probe_goal": "不満の理由、具体例、感情を引き出して改善要望につなげる",
        "expected_slots": [
          {
            "key": "pain_point",
            "label": "不満点",
            "description": "困っていることや嫌だと感じること",
            "required": true,
            "examples": ["レジ待ちが長い", "品切れが多い", "値段が高い"]
          },
          {
            "key": "pain_scene",
            "label": "発生場面",
            "description": "その不満が起きる場面",
            "required": true,
            "examples": ["昼休み", "夜遅い時間", "雨の日"]
          },
          {
            "key": "improvement_request",
            "label": "改善要望",
            "description": "改善してほしいこと",
            "required": false,
            "examples": ["セルフレジを増やしてほしい", "在庫を切らさないでほしい"]
          },
          {
            "key": "emotion",
            "label": "感情",
            "description": "その不満に対して感じること",
            "required": false,
            "examples": ["イライラする", "がっかりする"]
          }
        ],
        "required_slots": ["pain_point", "pain_scene"],
        "probe_config": {
          "max_probes": 2,
          "min_probes": 0,
          "force_probe_on_bad": true,
          "allow_followup_expansion": false,
          "strict_topic_lock": true
        },
        "completion_conditions": [
          { "type": "required_slots" },
          { "type": "no_bad_patterns" }
        ],
        "render_style": {
          "mode": "interview_natural",
          "connect_from_previous_answer": true,
          "avoid_question_number": true,
          "preserve_options": false
        }
      },
      "conversationControl": {
        "coreInfoPrompt": "どんな場面でその不満を感じるのか、なぜ気になるのか、できれば具体例も教えてください",
        "answerExample": "昼休みはレジ待ちが長く、急いでいるときにかなりストレスを感じます。セルフレジが増えると助かります",
        "shortAnswerMinLength": 20,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '理由を聞く。具体例を聞く。感情を引き出す。',
    2,
    'static',
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000002',
    '__free_comment__',
    '最後に、ここまでで話しきれなかったことがあれば自由に教えてください。',
    'free_comment',
    'text',
    true,
    4,
    null,
    '{
      "placeholder": "自由に入力してください",
      "meta": {
        "research_goal": "最後に補足したい内容を回収する",
        "question_goal": "これまでの回答で言い足りない点があれば受け取る",
        "probe_goal": "原則として深掘りしない",
        "expected_slots": [],
        "required_slots": [],
        "probe_config": {
          "max_probes": 0,
          "min_probes": 0,
          "force_probe_on_bad": false,
          "allow_followup_expansion": false,
          "strict_topic_lock": true
        },
        "completion_conditions": [],
        "render_style": {
          "mode": "free_comment",
          "connect_from_previous_answer": true,
          "avoid_question_number": true,
          "preserve_options": false
        }
      }
    }'::jsonb,
    false,
    null,
    null,
    'static',
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
  branch_rule = excluded.branch_rule,
  question_config = excluded.question_config,
  ai_probe_enabled = excluded.ai_probe_enabled,
  probe_guideline = excluded.probe_guideline,
  max_probe_count = excluded.max_probe_count,
  render_strategy = excluded.render_strategy,
  is_system = excluded.is_system,
  is_hidden = excluded.is_hidden;

-- Optional assignment example:
-- 1. Create or update a respondent row for the target LINE user in this project.
-- 2. Create or update the assignment so the project appears in "案件一覧".
--
-- Replace YOUR_LINE_USER_ID with the target user if you want to do this in SQL instead of admin UI.
--
-- with source_profile as (
--   select
--     'YOUR_LINE_USER_ID'::text as line_user_id,
--     max(display_name) as display_name,
--     max(total_points) as total_points,
--     max(current_rank_id) as current_rank_id
--   from respondents
--   where line_user_id = 'YOUR_LINE_USER_ID'
-- ),
-- target_respondent as (
--   insert into respondents (
--     line_user_id,
--     display_name,
--     project_id,
--     status,
--     total_points,
--     current_rank_id
--   )
--   select
--     source_profile.line_user_id,
--     source_profile.display_name,
--     '00000000-0000-4000-8000-000000000002',
--     'invited',
--     coalesce(source_profile.total_points, 0),
--     source_profile.current_rank_id
--   from source_profile
--   on conflict (line_user_id, project_id) do update
--   set
--     display_name = excluded.display_name,
--     total_points = excluded.total_points,
--     current_rank_id = excluded.current_rank_id
--   returning id, line_user_id
-- )
-- insert into project_assignments (
--   user_id,
--   project_id,
--   respondent_id,
--   assignment_type,
--   status,
--   assigned_at,
--   deadline
-- )
-- select
--   line_user_id,
--   '00000000-0000-4000-8000-000000000002',
--   id,
--   'manual',
--   'assigned',
--   now(),
--   null
-- from target_respondent
-- on conflict (project_id, respondent_id) do update
-- set
--   user_id = excluded.user_id,
--   assignment_type = excluded.assignment_type,
--   status = excluded.status,
--   assigned_at = excluded.assigned_at,
--   deadline = excluded.deadline,
--   sent_at = null,
--   opened_at = null,
--   started_at = null,
--   completed_at = null,
--   expired_at = null,
--   reminder_sent_at = null,
--   last_delivery_error = null;
