-- ============================================================
-- LINE interview test project: 新規チョコ開発 市場調査
-- Purpose: minimal data for interview_chat behavior checks.
--
-- Note:
-- LINE runtime currently handles free-entry interview questions as
-- question_type = 'text'. The DB also accepts free_text_short/free_text_long,
-- but those are not used here because the LINE parser/probe flow checks
-- question_type = 'text'.
-- ============================================================

begin;

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
  display_mode,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-0000000000c1',
  '新規チョコ開発 市場調査',
  'LINE確認用テスト',
  'LINEのインタビュー形式で、新規チョコ開発に向けた利用シーン、求める価値、味・食感、価格許容、購入意向を確認するテスト案件。',
  'active',
  30,
  'interview',
  '[
    "新規チョコ商品の利用シーンを把握する",
    "味・食感・健康感・価格に対する期待を把握する",
    "購入意向とその理由を把握する"
  ]'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb,
  '[
    "LINE上で自然な会話として短く聞く",
    "自由記述では理由・場面・具体例を必要に応じて深掘りする"
  ]'::jsonb,
  '{
    "enabled": true,
    "require_question_probe_enabled": true,
    "target_question_codes": ["Q3", "Q6", "Q8"],
    "max_probes_per_answer": 2,
    "max_probes_per_session": 6,
    "short_answer_min_length": 20
  }'::jsonb,
  '{
    "channel": "line",
    "tone": "natural_japanese",
    "max_sentences": 2,
    "max_characters_per_message": 120
  }'::jsonb,
  'interview_chat',
  now(),
  now()
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
  display_mode = excluded.display_mode,
  updated_at = now();

insert into questions (
  id,
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
  is_hidden,
  comment_top,
  comment_bottom,
  answer_output_type,
  display_tags_raw,
  display_tags_parsed,
  visibility_conditions,
  page_group_id,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-00000000c101',
    '00000000-0000-4000-8000-0000000000c1',
    'Q1',
    '普段、チョコレートを食べる頻度を教えてください。',
    'main',
    'single_select',
    true,
    1,
    null,
    '{
      "options": [
        { "label": "ほぼ毎日", "value": "daily" },
        { "label": "週に数回", "value": "few_per_week" },
        { "label": "週に1回くらい", "value": "weekly" },
        { "label": "月に数回", "value": "monthly" },
        { "label": "ほとんど食べない", "value": "rarely" }
      ]
    }'::jsonb,
    false,
    null,
    null,
    'static',
    false,
    false,
    null,
    null,
    'object',
    null,
    null,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000c102',
    '00000000-0000-4000-8000-0000000000c1',
    'Q2',
    'チョコを食べる場面として近いものをすべて選んでください。',
    'main',
    'multi_select',
    true,
    2,
    null,
    '{
      "min_select": 1,
      "max_select": 3,
      "options": [
        { "label": "仕事・勉強の合間", "value": "work_study_break" },
        { "label": "食後", "value": "after_meal" },
        { "label": "気分転換したい時", "value": "refresh" },
        { "label": "自分へのごほうび", "value": "reward" },
        { "label": "コーヒーやお酒と一緒に", "value": "with_drink" },
        { "label": "家族・友人と分ける時", "value": "share" },
        { "label": "ギフト・手土産", "value": "gift" },
        { "label": "その他", "value": "other" }
      ],
      "helpText": "最大3つまで選んでください。"
    }'::jsonb,
    false,
    null,
    null,
    'static',
    false,
    false,
    null,
    null,
    'array',
    null,
    null,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000c103',
    '00000000-0000-4000-8000-0000000000c1',
    'Q3',
    'その場面で、今のチョコに足りないと感じることや、もっと良くなってほしいことを教えてください。',
    'comparison_core',
    'text',
    true,
    3,
    null,
    '{
      "placeholder": "例: 甘さは好きだけど重いので、仕事中でも食べやすい軽さがほしい",
      "meta": {
        "research_goal": "既存チョコへの不満と改善ニーズを把握する",
        "question_goal": "不満点、発生場面、改善要望を具体的に聞く",
        "probe_goal": "理由・場面・具体例が不足している場合だけ深掘りする",
        "expected_slots": [
          { "key": "pain_point", "label": "不満点", "required": true },
          { "key": "scene", "label": "発生場面", "required": true },
          { "key": "desired_change", "label": "改善要望", "required": false }
        ],
        "required_slots": ["pain_point", "scene"],
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
        "coreInfoPrompt": "どんな場面で、何が足りないと感じるのかを聞いてください。",
        "answerExample": "仕事中に少し食べたい時、甘さが強すぎて口に残るのが気になります。",
        "shortAnswerMinLength": 20,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '不満点だけで終わらせず、いつ・なぜ・どうなれば良いかを短く深掘りする。',
    2,
    'static',
    false,
    false,
    null,
    null,
    'text',
    null,
    null,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000c104',
    '00000000-0000-4000-8000-0000000000c1',
    'Q4',
    '新しいチョコに期待する方向性として、一番近いものを選んでください。',
    'main',
    'single_select',
    true,
    4,
    null,
    '{
      "options": [
        { "label": "濃厚で満足感がある", "value": "rich_satisfying" },
        { "label": "軽くて毎日食べやすい", "value": "light_daily" },
        { "label": "健康感・罪悪感の少なさ", "value": "healthier" },
        { "label": "食感が楽しい", "value": "texture" },
        { "label": "香りや素材感が強い", "value": "aroma_ingredient" },
        { "label": "季節限定・特別感がある", "value": "seasonal_special" }
      ]
    }'::jsonb,
    false,
    null,
    null,
    'static',
    false,
    false,
    null,
    null,
    'object',
    null,
    null,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000c105',
    '00000000-0000-4000-8000-0000000000c1',
    'Q5',
    'コンビニで買える40g前後の新しいチョコなら、いくらくらいまでなら買ってみたいですか。',
    'main',
    'single_select',
    true,
    5,
    null,
    '{
      "options": [
        { "label": "150円未満", "value": "under_150" },
        { "label": "150円から199円", "value": "150_199" },
        { "label": "200円から249円", "value": "200_249" },
        { "label": "250円から299円", "value": "250_299" },
        { "label": "300円以上でも内容次第", "value": "300_plus" },
        { "label": "価格に関わらずあまり買わない", "value": "unlikely_any_price" }
      ]
    }'::jsonb,
    false,
    null,
    null,
    'static',
    false,
    false,
    null,
    null,
    'object',
    null,
    null,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000c106',
    '00000000-0000-4000-8000-0000000000c1',
    'Q6',
    'その価格を選んだ理由を教えてください。どんな中身なら納得できそうですか。',
    'comparison_core',
    'text',
    true,
    6,
    null,
    '{
      "placeholder": "例: 200円台なら、ナッツ入りで満足感があると納得できます",
      "meta": {
        "research_goal": "価格許容の理由と価値条件を把握する",
        "question_goal": "許容価格の根拠、期待する品質、割高/割安の判断軸を聞く",
        "probe_goal": "価格理由が抽象的な場合に、中身・量・品質・比較対象を深掘りする",
        "expected_slots": [
          { "key": "price_reason", "label": "価格理由", "required": true },
          { "key": "value_condition", "label": "納得条件", "required": true },
          { "key": "comparison", "label": "比較対象", "required": false }
        ],
        "required_slots": ["price_reason", "value_condition"],
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
        "coreInfoPrompt": "その価格が高い/安いと感じる理由と、納得できる商品条件を聞いてください。",
        "answerExample": "250円くらいなら、素材が良くて少量でも満足できるなら買いたいです。",
        "shortAnswerMinLength": 20,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '価格帯の理由に加えて、納得できる品質・量・素材・比較対象を確認する。',
    2,
    'static',
    false,
    false,
    null,
    null,
    'text',
    null,
    null,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000c107',
    '00000000-0000-4000-8000-0000000000c1',
    'Q7',
    'ここまでの条件に近い新商品が出たら、買ってみたい気持ちはどのくらいですか。',
    'main',
    'scale',
    true,
    7,
    null,
    '{
      "min": 1,
      "max": 5,
      "min_label": "買いたいと思わない",
      "max_label": "ぜひ買ってみたい"
    }'::jsonb,
    false,
    null,
    null,
    'static',
    false,
    false,
    null,
    null,
    'number',
    null,
    null,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000c108',
    '00000000-0000-4000-8000-0000000000c1',
    'Q8',
    '最後に、理想の新しいチョコを一言でいうとどんな商品ですか。理由もあれば教えてください。',
    'main',
    'text',
    false,
    8,
    null,
    '{
      "placeholder": "例: 仕事中に少しだけ気分転換できる、軽いけど香りが残るチョコ",
      "meta": {
        "research_goal": "理想商品の表現と購入動機を把握する",
        "question_goal": "ユーザー自身の言葉で、欲しい商品のコンセプトを聞く",
        "probe_goal": "商品像だけで理由がない場合に、なぜ欲しいかを1回だけ深掘りする",
        "expected_slots": [
          { "key": "ideal_concept", "label": "理想コンセプト", "required": true },
          { "key": "reason", "label": "理由", "required": false }
        ],
        "required_slots": ["ideal_concept"],
        "probe_config": {
          "max_probes": 1,
          "min_probes": 0,
          "force_probe_on_bad": false,
          "allow_followup_expansion": false,
          "strict_topic_lock": true
        },
        "completion_conditions": [
          { "type": "any_slot_filled" }
        ],
        "render_style": {
          "mode": "interview_natural",
          "connect_from_previous_answer": true,
          "avoid_question_number": true,
          "preserve_options": false
        }
      },
      "conversationControl": {
        "coreInfoPrompt": "理想の商品像をユーザー自身の言葉で受け取り、理由がなければ軽く聞いてください。",
        "answerExample": "少し高くても、夜に一粒で満足できる香りの良いチョコがほしいです。",
        "shortAnswerMinLength": 12,
        "sufficientAnswerMinLength": 35
      }
    }'::jsonb,
    true,
    '理想商品像が短すぎる場合のみ、欲しい理由や使う場面を1回だけ聞く。',
    1,
    'static',
    false,
    false,
    null,
    null,
    'text',
    null,
    null,
    null,
    null,
    now(),
    now()
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
  is_hidden = excluded.is_hidden,
  comment_top = excluded.comment_top,
  comment_bottom = excluded.comment_bottom,
  answer_output_type = excluded.answer_output_type,
  display_tags_raw = excluded.display_tags_raw,
  display_tags_parsed = excluded.display_tags_parsed,
  visibility_conditions = excluded.visibility_conditions,
  page_group_id = excluded.page_group_id,
  updated_at = now();

commit;

-- ------------------------------------------------------------
-- Optional: assign this project to a real LINE user.
-- Replace YOUR_LINE_USER_ID and run after the project/questions insert.
-- ------------------------------------------------------------
-- with target_respondent as (
--   insert into respondents (
--     line_user_id,
--     display_name,
--     project_id,
--     status,
--     total_points
--   )
--   values (
--     'YOUR_LINE_USER_ID',
--     'チョコ調査LINE確認ユーザー',
--     '00000000-0000-4000-8000-0000000000c1',
--     'invited',
--     0
--   )
--   on conflict (line_user_id, project_id) do update
--   set display_name = excluded.display_name
--   returning id, line_user_id
-- )
-- insert into project_assignments (
--   project_id,
--   respondent_id,
--   user_id,
--   assignment_type,
--   status,
--   assigned_at,
--   deadline,
--   delivery_log
-- )
-- select
--   '00000000-0000-4000-8000-0000000000c1',
--   id,
--   line_user_id,
--   'manual',
--   'assigned',
--   now(),
--   now() + interval '7 days',
--   '[]'::jsonb
-- from target_respondent
-- on conflict (project_id, respondent_id) do update
-- set
--   user_id = excluded.user_id,
--   assignment_type = excluded.assignment_type,
--   status = 'assigned',
--   assigned_at = now(),
--   deadline = excluded.deadline,
--   sent_at = null,
--   opened_at = null,
--   started_at = null,
--   completed_at = null,
--   expired_at = null,
--   reminder_sent_at = null,
--   last_delivery_error = null;

