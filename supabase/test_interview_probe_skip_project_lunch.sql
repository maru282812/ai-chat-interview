-- Test interview project focused on:
-- 1. AI probe should trigger on shallow / vague answers
-- 2. Redundant similar follow-up questions should be skipped when the previous answer already filled the needed slots
-- 3. "特になし" / "わからない" style answers should be treated as low-information and probed
--
-- Theme:
--   平日のランチ選択インタビュー
--
-- Recommended checks:
-- - Q2 with a concrete answer:
--   "会社の近くの定食屋で唐揚げ定食を食べます。すぐ入れて量が多く、昼休みに収まりやすいからです。"
--   => Q3 should be skipped and move to Q4
--
-- - Q2 with a shallow answer:
--   "近くの店です"
--   => AI probe should ask for place / what was ordered / why it was chosen
--
-- - Q4 with a vague answer:
--   "特になし"
--   => AI probe should ask for small frustrations / edge cases / slight dissatisfaction

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
  '00000000-0000-4000-8000-000000000004',
  'テスト用インタビュー案件（ランチ選択・深掘り確認）',
  'Internal Test',
  'AI深掘りの発火、具体回答による重複質問スキップ、曖昧回答への再深掘り挙動をランチ選択テーマで確認する。',
  'active',
  10,
  'interview',
  '["AI深掘りが必要な回答パターンの確認","前質問で取得済み情報による重複質問スキップの確認"]'::jsonb,
  '["曖昧回答に対する再深掘り確認","不満が薄い回答でも具体化できるか確認"]'::jsonb,
  '[]'::jsonb,
  '[
    "Q2で店・注文内容・選択理由が十分に取得できた場合はQ3の重複確認を避ける",
    "曖昧回答や低情報回答には理由・具体例・例外ケースを聞いて具体化する",
    "話題を直近のランチ選択体験から逸らさない"
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
    "project_goal": "深掘り発火、曖昧回答の具体化、重複質問スキップをランチ選択テーマで挙動確認できる形で記録する",
    "user_understanding_goal": "直近の具体ランチ場面・行った店・注文内容・選択理由・不満点を重複なく把握する",
    "required_slots": [
      {
        "key": "lunch_scene",
        "label": "ランチ場面",
        "required": true,
        "description": "どんな日のどんな場面でランチを選んだか",
        "examples": ["出社日の昼休み", "外出先の移動中", "会議前の短時間"]
      },
      {
        "key": "restaurant_name",
        "label": "行った店",
        "required": true,
        "description": "選んだ店や購入先",
        "examples": ["近くの定食屋", "コンビニ", "キッチンカー"]
      },
      {
        "key": "ordered_item",
        "label": "注文内容",
        "required": true,
        "description": "実際に食べたものや買ったもの",
        "examples": ["唐揚げ定食", "サンドイッチ", "パスタ"]
      },
      {
        "key": "choice_reason",
        "label": "選んだ理由",
        "required": true,
        "description": "なぜその店やメニューを選んだか",
        "examples": ["早いから", "安いから", "量が多いから"]
      },
      {
        "key": "pain_point",
        "label": "不満点",
        "required": true,
        "description": "気になる点や改善してほしい点",
        "examples": ["混雑", "価格", "提供が遅い"]
      }
    ],
    "optional_slots": [
      {
        "key": "pain_scene",
        "label": "不満が出る場面",
        "required": false,
        "description": "その不満を感じる場面",
        "examples": ["昼休みのピーク時", "雨の日", "急いでいるとき"]
      },
      {
        "key": "emotion",
        "label": "感情",
        "required": false,
        "description": "そのとき感じたこと",
        "examples": ["助かる", "焦る", "少しイライラする"]
      },
      {
        "key": "improvement_request",
        "label": "改善要望",
        "required": false,
        "description": "どう変わると良いか",
        "examples": ["回転を早くしてほしい", "席数を増やしてほしい"]
      }
    ],
    "question_categories": ["利用場面", "店", "注文内容", "選択理由", "不満点", "改善要望"],
    "probe_policy": {
      "default_max_probes": 2,
      "force_probe_on_bad": true,
      "strict_topic_lock": true,
      "allow_followup_expansion": false
    },
    "completion_rule": {
      "required_slots_needed": ["lunch_scene", "restaurant_name", "ordered_item", "choice_reason", "pain_point"],
      "allow_finish_without_optional": true,
      "min_required_slots_to_finish": 5
    },
    "topic_control": {
      "forbidden_topic_shift": true,
      "topic_lock_note": "Q2で取得済みの店・注文内容・理由をQ3で重複回収しない"
    },
    "language": "ja",
    "probe_guideline": "理由を聞く。具体例を聞く。例外ケースを聞く。曖昧回答は具体化する。"
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
    '00000000-0000-4000-8000-000000000004',
    'Q1',
    '平日はどれくらいの頻度で外でランチを選びますか？',
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
        "research_goal": "外食ランチ頻度を大まかに把握する",
        "question_goal": "平日のランチ選択頻度を比較可能な形で取得する",
        "probe_goal": "この質問では深掘りしない",
        "expected_slots": [
          {
            "key": "lunch_frequency",
            "label": "ランチ頻度",
            "description": "平日のランチ選択頻度",
            "required": true,
            "examples": ["ほぼ毎日", "週に2〜3回"]
          }
        ],
        "required_slots": ["lunch_frequency"],
        "skippable_if_slots_present": ["lunch_frequency"],
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
    '00000000-0000-4000-8000-000000000004',
    'Q2',
    '最近の平日ランチで、どこで何を食べたかと、なぜそれを選んだかまで含めて教えてください。',
    'main',
    'text',
    true,
    2,
    null,
    '{
      "helpText": "場面、店、注文内容、選んだ理由がわかると十分です",
      "placeholder": "例: 会社の近くの定食屋で唐揚げ定食を食べました。すぐ入れて量が多いからです",
      "meta": {
        "research_goal": "具体ランチ場面を起点に店・注文内容・選択理由をまとめて回収する",
        "question_goal": "場面・店・注文内容・理由を1回答で取得する",
        "probe_goal": "不足している場面、店、注文内容、理由を具体化する",
        "expected_slots": [
          {
            "key": "lunch_scene",
            "label": "ランチ場面",
            "description": "どんな日のどんな場面だったか",
            "required": true,
            "examples": ["出社日の昼休み", "外出先での昼食"]
          },
          {
            "key": "restaurant_name",
            "label": "行った店",
            "description": "選んだ店や購入先",
            "required": true,
            "examples": ["近くの定食屋", "コンビニ", "カフェ"]
          },
          {
            "key": "ordered_item",
            "label": "注文内容",
            "description": "実際に食べたものや買ったもの",
            "required": true,
            "examples": ["唐揚げ定食", "サンドイッチ", "パスタ"]
          },
          {
            "key": "choice_reason",
            "label": "選んだ理由",
            "description": "なぜその店やメニューを選んだか",
            "required": true,
            "examples": ["早いから", "安いから", "量が多いから"]
          },
          {
            "key": "emotion",
            "label": "感情",
            "description": "そのとき感じたこと",
            "required": false,
            "examples": ["満足", "助かる", "妥協した"]
          }
        ],
        "required_slots": ["lunch_scene", "restaurant_name", "ordered_item", "choice_reason"],
        "skippable_if_slots_present": ["restaurant_name", "ordered_item", "choice_reason"],
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
        "coreInfoPrompt": "どこで何を食べて、なぜそれを選んだのかがわかるように具体的に教えてください",
        "answerExample": "会社の近くの定食屋で唐揚げ定食を食べました。すぐ入れて量が多いので選びました",
        "shortAnswerMinLength": 20,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '不足している場面・店・注文内容・理由を聞く。短答や曖昧回答は具体化する。',
    2,
    'static',
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000004',
    'Q3',
    'そのとき、どの店で何を注文して、なぜそこを選びましたか？',
    'comparison_core',
    'text',
    true,
    3,
    null,
    '{
      "helpText": "Q2でそこまで書けていれば、ここは自動的に飛ばしたい質問です",
      "placeholder": "例: 近くの定食屋で唐揚げ定食です。早くて量が多いからです",
      "meta": {
        "research_goal": "店・注文内容・理由の不足時だけ補完する",
        "question_goal": "Q2で取り切れなかった店・注文内容・理由を補う",
        "probe_goal": "原則として深掘りしない。Q2の補完用",
        "expected_slots": [
          {
            "key": "restaurant_name",
            "label": "行った店",
            "description": "選んだ店や購入先",
            "required": true,
            "examples": ["近くの定食屋", "カフェ"]
          },
          {
            "key": "ordered_item",
            "label": "注文内容",
            "description": "実際に食べたもの",
            "required": true,
            "examples": ["唐揚げ定食", "サラダランチ"]
          },
          {
            "key": "choice_reason",
            "label": "選んだ理由",
            "description": "なぜその店やメニューを選んだか",
            "required": true,
            "examples": ["早いから", "安いから"]
          }
        ],
        "required_slots": ["restaurant_name", "ordered_item", "choice_reason"],
        "skippable_if_slots_present": ["restaurant_name", "ordered_item", "choice_reason"],
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
        "coreInfoPrompt": "店と注文内容と理由を短く具体的に教えてください",
        "answerExample": "近くの定食屋で唐揚げ定食です。早くて量が多いからです",
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
    '00000000-0000-4000-8000-000000000004',
    'Q4',
    'そのランチ選択で不満や改善してほしいことがあれば教えてください。大きな不満がなくても、少し気になる点があれば教えてください。',
    'main',
    'text',
    true,
    4,
    null,
    '{
      "helpText": "「特になし」だけではなく、少しでも気になることがあればその内容を教えてください",
      "placeholder": "例: 昼の混雑で提供が遅いときだけ少し困ります",
      "meta": {
        "research_goal": "不満が弱い場合も含めて具体的な改善余地を拾う",
        "question_goal": "不満点と、その場面を具体的に知る",
        "probe_goal": "特になし・わからないなどの低情報回答を具体化する",
        "expected_slots": [
          {
            "key": "pain_point",
            "label": "不満点",
            "description": "気になること、不満、改善してほしい点",
            "required": true,
            "examples": ["混雑", "価格", "提供が遅い"]
          },
          {
            "key": "pain_scene",
            "label": "不満が出る場面",
            "description": "その不満を感じる場面",
            "required": true,
            "examples": ["昼休みのピーク時", "急いでいる日"]
          },
          {
            "key": "improvement_request",
            "label": "改善要望",
            "description": "どう変わるとよいか",
            "required": false,
            "examples": ["提供を早くしてほしい", "席数を増やしてほしい"]
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
        "coreInfoPrompt": "大きな不満がなくても、少し困る場面や気になる瞬間があれば具体的に教えてください",
        "answerExample": "昼休みのピーク時だけ混んでいて、提供が遅いと少し困ります",
        "shortAnswerMinLength": 16,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '「特になし」「わからない」は低情報として扱い、例外ケースや小さな不満を聞いて具体化する。',
    2,
    'static',
    false,
    false
  ),
  (
    '00000000-0000-4000-8000-000000000004',
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
--     '00000000-0000-4000-8000-000000000004',
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
--   '00000000-0000-4000-8000-000000000004',
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
