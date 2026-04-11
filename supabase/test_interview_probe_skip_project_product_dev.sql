-- Test interview project focused on:
-- 1. AI probe should trigger on shallow / vague answers
-- 2. Redundant similar follow-up questions should be skipped when the previous answer already filled the needed slots
-- 3. "特になし" / "わからない" style answers should be treated as low-information and probed
--
-- Theme:
--   商品開発向け 間食・小腹満たしインタビュー
--
-- Product development intent:
--   現在の代替手段、選ばれる理由、不満、欲しい仕様を把握して
--   新しい間食商品の企画に使える一次情報を集める
--
-- Recommended checks:
-- - Q2 with a concrete answer:
--   "午後の仕事中にコンビニでプロテインバーを買います。片手で食べられて、たんぱく質が取れて、甘すぎないからです。"
--   => Q3 should be skipped and move to Q4
--
-- - Q2 with a shallow answer:
--   "バーです"
--   => AI probe should ask for scene / product / reason
--
-- - Q4 with a vague answer:
--   "特になし"
--   => AI probe should ask for small dissatisfaction / unmet need / desired spec

insert into projects (
  id,
  name,
  client_name,
  objective,
  status,
  reward_points,
  research_mode,
  primary_objectives,
  secondary_objectives,
  comparison_constraints,
  prompt_rules,
  probe_policy,
  response_style,
  ai_state_template_key,
  ai_state_generated_at,
  ai_state_json
)
values (
  '00000000-0000-4000-8000-000000000005',
  'テスト用インタビュー案件（商品開発・間食ニーズ確認）',
  'Internal Test',
  'AI深掘りの発火、具体回答による重複質問スキップ、曖昧回答への再深掘り挙動を商品開発テーマで確認する。',
  'active',
  10,
  'interview',
  '["商品開発に必要な利用場面と代替手段の確認","前質問で取得済み情報による重複質問スキップの確認"]'::jsonb,
  '["曖昧回答に対する再深掘り確認","軽い不満から商品仕様の示唆を引き出せるか確認"]'::jsonb,
  '[]'::jsonb,
  '[
    "Q2で利用場面と選んだ商品と理由が十分に取得できた場合はQ3の重複確認を避ける",
    "曖昧回答や低情報回答には具体例、理由、代替状況を聞いて具体化する",
    "話題を直近の間食・小腹満たし体験から逸らさない"
  ]'::jsonb,
  '{
    "enabled": true,
    "conditions": ["short_answer", "abstract_answer"],
    "max_probes_per_answer": 2,
    "max_probes_per_session": 3,
    "require_question_probe_enabled": true,
    "target_question_codes": ["Q2", "Q4"],
    "blocked_question_codes": ["Q1", "Q3"],
    "short_answer_min_length": 20,
    "end_conditions": [
      "answer_sufficient",
      "max_probes_per_answer",
      "max_probes_per_session",
      "question_not_target",
      "question_blocked",
      "user_declined"
    ]
  }'::jsonb,
  '{
    "channel": "line",
    "tone": "natural_japanese",
    "max_characters_per_message": 80,
    "max_sentences": 2
  }'::jsonb,
  'ux_research',
  now(),
  '{
    "version": "v1",
    "template_key": "ux_research",
    "project_goal": "深掘り発火、曖昧回答の具体化、重複質問スキップを商品開発テーマで確認できる形で記録する",
    "user_understanding_goal": "間食を取りたい場面、現在選ばれている商品、選択理由、不満点、欲しい仕様を重複なく把握する",
    "required_slots": [
      {
        "key": "usage_scene",
        "label": "利用場面",
        "required": true,
        "description": "どんな場面で間食や小腹満たしが必要になるか",
        "examples": ["午後の仕事中", "移動中", "残業前"]
      },
      {
        "key": "selected_product",
        "label": "選んだ商品",
        "required": true,
        "description": "実際に選んでいる商品やカテゴリ",
        "examples": ["プロテインバー", "おにぎり", "ナッツ"]
      },
      {
        "key": "choice_reason",
        "label": "選んだ理由",
        "required": true,
        "description": "なぜその商品を選んでいるか",
        "examples": ["片手で食べられるから", "甘すぎないから", "腹持ちが良いから"]
      },
      {
        "key": "pain_point",
        "label": "不満点",
        "required": true,
        "description": "今の商品や代替手段に対する不満",
        "examples": ["値段が高い", "食べにくい", "満足感が足りない"]
      }
    ],
    "optional_slots": [
      {
        "key": "pain_scene",
        "label": "不満が出る場面",
        "required": false,
        "description": "その不満を感じる具体場面",
        "examples": ["急いでいるとき", "会議の合間", "車内"]
      },
      {
        "key": "desired_spec",
        "label": "欲しい仕様",
        "required": false,
        "description": "新しい商品に求める条件",
        "examples": ["甘さ控えめ", "手が汚れない", "高たんぱく"]
      },
      {
        "key": "emotion",
        "label": "感情",
        "required": false,
        "description": "そのとき感じていること",
        "examples": ["助かる", "妥協している", "少し物足りない"]
      }
    ],
    "question_categories": ["利用場面", "選んだ商品", "選択理由", "不満点", "欲しい仕様"],
    "probe_policy": {
      "default_max_probes": 2,
      "force_probe_on_bad": true,
      "strict_topic_lock": true,
      "allow_followup_expansion": false
    },
    "completion_rule": {
      "required_slots_needed": ["usage_scene", "selected_product", "choice_reason", "pain_point"],
      "allow_finish_without_optional": true,
      "min_required_slots_to_finish": 4
    },
    "topic_control": {
      "forbidden_topic_shift": true,
      "topic_lock_note": "Q2で取得済みの商品と理由をQ3で重複回収しない"
    },
    "language": "ja",
    "probe_guideline": "理由を聞く。具体例を聞く。不満が弱い場合は困る場面や欲しい条件まで聞いて具体化する。"
  }'::jsonb
)
on conflict (id) do update
set
  name = excluded.name,
  client_name = excluded.client_name,
  objective = excluded.objective,
  status = excluded.status,
  reward_points = excluded.reward_points,
  research_mode = excluded.research_mode,
  primary_objectives = excluded.primary_objectives,
  secondary_objectives = excluded.secondary_objectives,
  comparison_constraints = excluded.comparison_constraints,
  prompt_rules = excluded.prompt_rules,
  probe_policy = excluded.probe_policy,
  response_style = excluded.response_style,
  ai_state_template_key = excluded.ai_state_template_key,
  ai_state_generated_at = excluded.ai_state_generated_at,
  ai_state_json = excluded.ai_state_json;

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
  probe_guideline,
  max_probe_count,
  render_strategy,
  is_system,
  is_hidden
)
values
  (
    '00000000-0000-4000-8000-000000000005',
    'Q1',
    '小腹が空いたときのために、間食や軽食をどれくらいの頻度で買ったり食べたりしますか？',
    'screening',
    'single_select',
    true,
    1,
    null,
    '{
      "options": [
        { "value": "daily", "label": "ほぼ毎日" },
        { "value": "4_6_per_week", "label": "週に4〜6回" },
        { "value": "2_3_per_week", "label": "週に2〜3回" },
        { "value": "once_per_week", "label": "週に1回くらい" },
        { "value": "few_per_month", "label": "月に数回以下" }
      ],
      "helpText": "番号でも回答できます",
      "meta": {
        "research_goal": "間食カテゴリの利用頻度を大まかに把握する",
        "question_goal": "間食利用頻度を比較可能な形で取得する",
        "probe_goal": "この質問では深掘りしない",
        "expected_slots": [
          {
            "key": "snack_frequency",
            "label": "間食利用頻度",
            "description": "間食や軽食を利用する頻度",
            "required": true,
            "examples": ["ほぼ毎日", "週に2〜3回"]
          }
        ],
        "required_slots": ["snack_frequency"],
        "skippable_if_slots_present": ["snack_frequency"],
        "can_prefill_future_slots": false,
        "probe_config": {
          "max_probes": 0,
          "min_probes": 0,
          "force_probe_on_bad": false,
          "allow_followup_expansion": false,
          "strict_topic_lock": true
        },
        "completion_conditions": [{ "type": "required_slots" }],
        "render_style": {
          "mode": "default",
          "connect_from_previous_answer": true,
          "avoid_question_number": false,
          "preserve_options": true
        }
      }
    }'::jsonb,
    false,
    null,
    null,
    'static',
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000005',
    'Q2',
    '最近、小腹が空いた場面で何を選んだかと、なぜそれを選んだかまで具体的に教えてください。',
    'main',
    'text',
    true,
    2,
    null,
    '{
      "helpText": "場面、選んだ商品、選んだ理由がわかると十分です",
      "placeholder": "例: 午後の仕事中にコンビニでプロテインバーを買います。片手で食べられて、たんぱく質が取れて、甘すぎないからです",
      "meta": {
        "research_goal": "具体利用場面を起点に現在の代替手段と選択理由をまとめて回収する",
        "question_goal": "利用場面、選んだ商品、選んだ理由を1回答で取得する",
        "probe_goal": "不足している場面、商品、理由を具体化する",
        "expected_slots": [
          {
            "key": "usage_scene",
            "label": "利用場面",
            "description": "どんな場面で小腹を満たしたかったか",
            "required": true,
            "examples": ["午後の仕事中", "移動中", "残業前"]
          },
          {
            "key": "selected_product",
            "label": "選んだ商品",
            "description": "そのとき選んだ商品やカテゴリ",
            "required": true,
            "examples": ["プロテインバー", "おにぎり", "ナッツ"]
          },
          {
            "key": "choice_reason",
            "label": "選んだ理由",
            "description": "なぜその商品を選んだか",
            "required": true,
            "examples": ["片手で食べられるから", "甘すぎないから", "腹持ちが良いから"]
          },
          {
            "key": "emotion",
            "label": "感情",
            "description": "そのとき感じたこと",
            "required": false,
            "examples": ["助かる", "妥協している", "少し物足りない"]
          }
        ],
        "required_slots": ["usage_scene", "selected_product", "choice_reason"],
        "skippable_if_slots_present": ["selected_product", "choice_reason"],
        "can_prefill_future_slots": true,
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
        "coreInfoPrompt": "どんな場面で何を選び、なぜそれを選んだのかがわかるように具体的に教えてください",
        "answerExample": "午後の仕事中にコンビニでプロテインバーを買います。片手で食べられて、たんぱく質が取れて、甘すぎないからです",
        "shortAnswerMinLength": 20,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '不足している場面・商品・理由を聞く。短答や曖昧回答は具体化する。',
    2,
    'static',
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000005',
    'Q3',
    'そのとき、何を選んで、なぜそれにしましたか？',
    'comparison_core',
    'text',
    true,
    3,
    null,
    '{
      "helpText": "Q2でそこまで書けていれば、ここは自動的に飛ばしたい質問です",
      "placeholder": "例: プロテインバーです。片手で食べられて、甘すぎないからです",
      "meta": {
        "research_goal": "商品と理由の不足時だけ補完する",
        "question_goal": "Q2で取り切れなかった商品と理由を補う",
        "probe_goal": "原則として深掘りしない。Q2の補完用",
        "expected_slots": [
          {
            "key": "selected_product",
            "label": "選んだ商品",
            "description": "そのとき選んだ商品やカテゴリ",
            "required": true,
            "examples": ["プロテインバー", "おにぎり", "ナッツ"]
          },
          {
            "key": "choice_reason",
            "label": "選んだ理由",
            "description": "なぜその商品を選んだか",
            "required": true,
            "examples": ["片手で食べられるから", "甘すぎないから", "腹持ちが良いから"]
          }
        ],
        "required_slots": ["selected_product", "choice_reason"],
        "skippable_if_slots_present": ["selected_product", "choice_reason"],
        "can_prefill_future_slots": true,
        "probe_config": {
          "max_probes": 0,
          "min_probes": 0,
          "force_probe_on_bad": false,
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
        "coreInfoPrompt": "商品と理由を短く具体的に教えてください",
        "answerExample": "プロテインバーです。片手で食べられて、甘すぎないからです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 32
      }
    }'::jsonb,
    false,
    null,
    0,
    'static',
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000005',
    'Q4',
    '今の間食や軽食で不満や改善してほしいことがあれば教えてください。大きな不満がなくても、少し気になる点や「こうだったらいいのに」があれば教えてください。',
    'main',
    'text',
    true,
    4,
    null,
    '{
      "helpText": "「特になし」だけではなく、少し困る点や欲しい条件があれば教えてください",
      "placeholder": "例: 仕事中は手が汚れるものは食べにくいので、片手で食べられて甘さ控えめだとうれしいです",
      "meta": {
        "research_goal": "弱い不満も含めて商品開発につながる改善余地を拾う",
        "question_goal": "不満点と、その場面、欲しい仕様を具体的に知る",
        "probe_goal": "特になし・わからないなどの低情報回答を具体化する",
        "expected_slots": [
          {
            "key": "pain_point",
            "label": "不満点",
            "description": "今の間食や軽食に感じる不満や弱い不便",
            "required": true,
            "examples": ["値段が高い", "食べにくい", "満足感が足りない"]
          },
          {
            "key": "pain_scene",
            "label": "不満が出る場面",
            "description": "その不満を感じる場面",
            "required": true,
            "examples": ["急いでいるとき", "会議前", "移動中"]
          },
          {
            "key": "desired_spec",
            "label": "欲しい仕様",
            "description": "新しい商品に求める条件",
            "required": false,
            "examples": ["甘さ控えめ", "高たんぱく", "手が汚れない"]
          }
        ],
        "required_slots": ["pain_point", "pain_scene"],
        "skippable_if_slots_present": ["pain_point", "pain_scene"],
        "can_prefill_future_slots": true,
        "bad_answer_patterns": [
          { "type": "exact", "value": "特になし", "note": "no_content" },
          { "type": "exact", "value": "特にない", "note": "no_content" },
          { "type": "exact", "value": "ない", "note": "no_content" },
          { "type": "exact", "value": "わからない", "note": "no_content" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" },
          { "type": "contains", "value": "普通", "note": "abstract" }
        ],
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
        "coreInfoPrompt": "大きな不満がなくても、少し困る場面や、こういう商品ならよいという条件があれば具体的に教えてください",
        "answerExample": "移動中は手が汚れるものは食べにくいので、片手で食べられて甘さ控えめだとうれしいです",
        "shortAnswerMinLength": 16,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '「特になし」「わからない」は低情報として扱い、小さな不満や欲しい条件まで聞いて具体化する。',
    2,
    'static',
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000005',
    '__free_comment__',
    '最後に、ここまでで話しきれなかったことがあれば自由に教えてください。',
    'free_comment',
    'text',
    true,
    5,
    null,
    '{
      "placeholder": "自由に入力してください",
      "meta": {
        "research_goal": "最後に補足したい内容を回収する",
        "question_goal": "補足コメントを受け取る",
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
-- Replace YOUR_LINE_USER_ID with the target LINE user id.
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
--     '00000000-0000-4000-8000-000000000005',
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
--   '00000000-0000-4000-8000-000000000005',
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
