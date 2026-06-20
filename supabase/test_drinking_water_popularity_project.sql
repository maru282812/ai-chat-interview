-- ============================================================
-- Test project: 飲料水人気調査（通常回答形式 + AI深掘り + 分岐）
--
-- Purpose:
-- - 飲料水としての人気・選好・購入理由を題材に、隠し項目以外の回答形式を確認する。
-- - question_type: single_choice / multi_choice / free_text_short / free_text_long /
--                  matrix_single / matrix_multi / matrix_mixed / numeric / sd /
--                  text_with_image / image_upload
-- - hidden_single / hidden_multi / hidden system question は作成しない。
--
-- Recommended checks:
-- - Q1 = "daily" → Q2_DAILY → Q3
-- - Q1 = "rare"  → Q2_RARE  → Q3
-- - Q1 = other   → Q3
-- - Q3 includes "taste" → Q4_TASTE → Q5
-- - Q3 に taste なし → Q5 (default)
-- - Q9 <= 2 → Q9_LOW → Q10; Q9 >= 4 → Q9_HIGH → Q10; Q9=3 → Q10 (default)
-- - Q2_DAILY, Q2_RARE, Q4_TASTE, Q5, Q9_LOW, Q9_HIGH, Q11 で短答・曖昧回答 → AI深掘り発動
-- ============================================================

begin;

delete from point_transactions
where project_id = '00000000-0000-4000-8000-0000000000c5';

delete from project_assignments
where project_id = '00000000-0000-4000-8000-0000000000c5';

delete from project_analysis_reports
where project_id = '00000000-0000-4000-8000-0000000000c5';

delete from respondents
where project_id = '00000000-0000-4000-8000-0000000000c5';

delete from questions
where project_id = '00000000-0000-4000-8000-0000000000c5';

delete from projects
where id = '00000000-0000-4000-8000-0000000000c5';

insert into projects (
  id,
  name,
  client_name,
  objective,
  status,
  reward_points,
  research_mode,
  display_mode,
  primary_objectives,
  secondary_objectives,
  comparison_constraints,
  prompt_rules,
  probe_policy,
  response_style,
  ai_state_template_key,
  ai_state_generated_at,
  ai_state_json,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-0000000000c5',
  'テスト用調査（飲料水人気調査・通常回答形式確認）',
  'Internal Test',
  '飲料水としての人気、飲用シーン、選好理由、購入時の重視点を題材に、通常回答形式・AI深掘り・分岐動作を確認する。',
  'published',
  10,
  'interview',
  'interview_chat',
  '[
    "飲料水人気調査として隠し項目以外のquestion_typeの入力・保存・表示を確認する",
    "短い回答や曖昧回答に対するAI深掘りを複数設問で確認する",
    "飲用頻度・重視点・購入意向による分岐を確認する"
  ]'::jsonb,
  '[
    "画像系はLINEテキストフォールバックで確認する",
    "matrix系はテキスト回答フォールバックで確認する",
    "hidden_single / hidden_multi は含めない"
  ]'::jsonb,
  '[]'::jsonb,
  '[
    "テスト案件なので通常回答形式の入力互換性を優先する",
    "AI深掘りでは理由、飲用シーン、具体例、購入障壁を1つずつ確認する",
    "分岐先の質問後は共通質問に戻す"
  ]'::jsonb,
  '{
    "enabled": true,
    "conditions": ["short_answer", "abstract_answer"],
    "max_probes_per_answer": 2,
    "max_probes_per_session": 6,
    "require_question_probe_enabled": true,
    "target_question_codes": ["Q2_DAILY", "Q2_RARE", "Q4_TASTE", "Q5", "Q9_LOW", "Q9_HIGH", "Q11"],
    "blocked_question_codes": ["Q1", "Q3", "Q6", "Q7", "Q8", "Q9", "Q10", "Q12"],
    "short_answer_min_length": 18,
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
    "max_characters_per_message": 100,
    "max_sentences": 2
  }'::jsonb,
  'ux_research',
  now(),
  '{
    "version": "v1",
    "template_key": "ux_research",
    "project_goal": "飲料水人気調査で通常回答形式、分岐、AI深掘りの実行確認",
    "user_understanding_goal": "ふだん飲む水の種類、選ぶ理由、飲用シーン、購入時の重視点を多様な回答形式で取得する",
    "required_slots": [
      {
        "key": "usage_scene",
        "label": "飲用シーン",
        "required": true,
        "description": "どんな場面で飲料水を飲むか",
        "examples": ["朝起きた後", "運動後", "仕事中", "外出先"]
      },
      {
        "key": "preferred_water_type",
        "label": "好みの水のタイプ",
        "required": true,
        "description": "ミネラルウォーター、天然水、浄水、炭酸水など",
        "examples": ["軟水の天然水", "炭酸水", "浄水器の水"]
      },
      {
        "key": "reason",
        "label": "選ぶ理由",
        "required": true,
        "description": "味、価格、安心感、入手しやすさなどの理由",
        "examples": ["飲みやすい", "安い", "持ち歩きやすい", "硬度が合う"]
      }
    ],
    "optional_slots": [
      {
        "key": "purchase_barrier",
        "label": "購入障壁・不満",
        "required": false,
        "examples": ["重い", "価格が高い", "味の違いがわかりにくい"]
      }
    ],
    "question_categories": ["飲用頻度", "選好理由", "評価", "購入意向", "コンセプト反応"],
    "probe_policy": {
      "default_max_probes": 2,
      "force_probe_on_bad": true,
      "strict_topic_lock": true,
      "allow_followup_expansion": false
    },
    "completion_rule": {
      "required_slots_needed": ["usage_scene", "preferred_water_type", "reason"],
      "allow_finish_without_optional": true,
      "min_required_slots_to_finish": 3
    },
    "language": "ja",
    "probe_guideline": "短答・抽象回答・特になし系の回答では、飲用シーン、選ぶ理由、味や価格への評価、購入時の障壁を1つずつ聞いて具体化する。"
  }'::jsonb,
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
  display_mode = excluded.display_mode,
  primary_objectives = excluded.primary_objectives,
  secondary_objectives = excluded.secondary_objectives,
  comparison_constraints = excluded.comparison_constraints,
  prompt_rules = excluded.prompt_rules,
  probe_policy = excluded.probe_policy,
  response_style = excluded.response_style,
  ai_state_template_key = excluded.ai_state_template_key,
  ai_state_generated_at = excluded.ai_state_generated_at,
  ai_state_json = excluded.ai_state_json,
  updated_at = now();

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
  is_hidden,
  comment_top,
  comment_bottom,
  answer_output_type,
  display_tags_raw,
  display_tags_parsed,
  visibility_conditions,
  page_group_id,
  answer_options_locked,
  created_at,
  updated_at
)
values
  -- Q1: single_choice（飲用頻度→分岐）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q1',
    'ふだん、飲料水として水をどれくらい飲みますか？',
    'screening',
    'single_choice',
    true,
    1,
    '{
      "default_next": "Q3",
      "branches": [
        { "field": "value", "when": { "equals": "daily" }, "next": "Q2_DAILY" },
        { "field": "value", "when": { "equals": "rare" }, "next": "Q2_RARE" }
      ]
    }'::jsonb,
    '{
      "options": [
        { "value": "daily", "label": "ほぼ毎日飲む" },
        { "value": "weekly", "label": "週に数回飲む" },
        { "value": "rare", "label": "あまり飲まない" },
        { "value": "none", "label": "ほとんど飲まない" }
      ],
      "helpText": "番号でも回答できます",
      "meta": {
        "research_goal": "飲料水の飲用頻度で分岐を確認する",
        "question_goal": "単一選択の入力とbranch_ruleを確認する",
        "probe_goal": "この質問では深掘りしない",
        "required_slots": ["drinking_frequency"],
        "completion_conditions": [{ "type": "required_slots" }],
        "render_style": { "mode": "default", "preserve_options": true }
      }
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
    true,
    now(),
    now()
  ),
  -- Q2_DAILY: free_text_short（よく飲む理由）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q2_DAILY',
    'よく飲む水のタイプと、その水を選んでいる理由を短く教えてください。',
    'main',
    'free_text_short',
    true,
    2,
    '{ "default_next": "Q3" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: コンビニで買う天然水です。クセがなく、仕事中に飲みやすいからです",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "高頻度飲用者の水タイプと選択理由を把握する",
        "question_goal": "飲んでいる水の種類と理由を取得する",
        "probe_goal": "水のタイプだけの回答から、飲用シーンや理由を聞く",
        "required_slots": ["preferred_water_type", "reason"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "特になし", "note": "no_content" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "どんな水を飲んでいて、なぜその水を選んでいるかを教えてください",
        "answerExample": "コンビニで買う天然水です。クセがなく、仕事中に飲みやすいからです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '水の種類だけの回答では、飲む場面、味・価格・安心感などの理由を1つ確認する。',
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
    false,
    now(),
    now()
  ),
  -- Q2_RARE: free_text_short（あまり飲まない理由）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q2_RARE',
    '水をあまり飲まない理由や、代わりによく飲むものを短く教えてください。',
    'main',
    'free_text_short',
    true,
    3,
    '{ "default_next": "Q3" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: 味が物足りなくて、普段はお茶を飲むことが多いです",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "低頻度飲用者の障壁と代替飲料を把握する",
        "question_goal": "水を飲まない理由と代替飲料を取得する",
        "probe_goal": "抽象的な理由から、味・習慣・価格・入手性のどれが障壁か聞く",
        "required_slots": ["reason", "alternative_drink"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "わからない", "note": "no_content" },
          { "type": "contains", "value": "普通", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "水を飲まない理由と、代わりによく飲むものを教えてください",
        "answerExample": "味が物足りなくて、普段はお茶を飲むことが多いです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '理由が短い場合は、味、習慣、価格、持ち歩きやすさ、代替飲料のどれに近いか確認する。',
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
    false,
    now(),
    now()
  ),
  -- Q3: multi_choice（重視点→分岐）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q3',
    '飲料水を選ぶときに重視することをすべて選んでください。',
    'main',
    'multi_choice',
    true,
    4,
    '{
      "default_next": "Q5",
      "branches": [
        { "field": "values", "when": { "includes": "taste" }, "next": "Q4_TASTE" }
      ]
    }'::jsonb,
    '{
      "min_select": 1,
      "max_select": 5,
      "options": [
        { "value": "taste", "label": "味・飲みやすさ" },
        { "value": "price", "label": "価格" },
        { "value": "safety", "label": "安全性・信頼感" },
        { "value": "mineral", "label": "ミネラル成分・硬度" },
        { "value": "package", "label": "ボトルの持ちやすさ・デザイン" },
        { "value": "availability", "label": "買いやすさ" },
        { "value": "other", "label": "その他" }
      ],
      "helpText": "複数選択は 1,3 のように入力してください"
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
    true,
    now(),
    now()
  ),
  -- Q4_TASTE: free_text_short（味の好み）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q4_TASTE',
    '「味・飲みやすさ」で、どんな水がおいしい・飲みやすいと感じますか？',
    'main',
    'free_text_short',
    false,
    5,
    '{ "default_next": "Q5" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: クセがなくて少し甘みを感じる軟水が、常温でも飲みやすいです",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "味・飲みやすさの具体的な評価軸を把握する",
        "question_goal": "好みの味や硬度感を取得する",
        "probe_goal": "味の表現が抽象的な場合に、常温・冷水・食事中などの場面を聞く",
        "required_slots": ["taste_preference", "reason"],
        "bad_answer_patterns": [
          { "type": "contains", "value": "普通", "note": "abstract" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "どんな味や口当たりが飲みやすいか、場面も含めて教えてください",
        "answerExample": "クセがなくて少し甘みを感じる軟水が、常温でも飲みやすいです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '味の表現が短い場合は、どんな温度や場面で飲みやすいと感じるかを確認する。',
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
    false,
    now(),
    now()
  ),
  -- Q5: free_text_long（理想の飲料水）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q5',
    'あなたにとって理想的な飲料水を、飲む場面・味・価格・ボトルなどを含めて具体的に教えてください。',
    'main',
    'free_text_long',
    true,
    6,
    null,
    '{
      "placeholder": "例: 仕事中に常温で飲んでもクセがなく、500mlで100円前後、バッグに入れてもかさばらないボトルが理想です",
      "helpText": "「特になし」だけでも入力できますが、AI深掘り確認用に追加質問が出る想定です",
      "meta": {
        "research_goal": "理想の飲料水像と購入条件を具体化する",
        "question_goal": "飲用シーン、味、価格、パッケージ条件を取得する",
        "probe_goal": "短答・曖昧回答から場面、理由、購入条件を引き出す",
        "expected_slots": [
          { "key": "usage_scene", "label": "飲用シーン", "required": true, "examples": ["仕事中", "運動後", "朝", "外出先"] },
          { "key": "taste_preference", "label": "味の好み", "required": true, "examples": ["クセがない", "すっきり", "硬水感がある"] },
          { "key": "purchase_condition", "label": "購入条件", "required": true, "examples": ["100円前後", "持ちやすい", "まとめ買いしやすい"] }
        ],
        "required_slots": ["usage_scene", "taste_preference", "purchase_condition"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "特になし", "note": "no_content" },
          { "type": "exact", "value": "特にない", "note": "no_content" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" },
          { "type": "contains", "value": "普通", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "どんな場面で、どんな味・価格・ボトルなら選びたいかを具体的に教えてください",
        "answerExample": "仕事中に常温で飲んでもクセがなく、500mlで100円前後、バッグに入れてもかさばらないボトルが理想です",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 50
      }
    }'::jsonb,
    true,
    '短答や「特になし」は、飲む場面、味、価格またはボトル条件のうち不足している1点を確認する。',
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
    false,
    now(),
    now()
  ),
  -- Q6: matrix_single（タイプ別の飲みやすさ評価）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q6',
    '次の水タイプについて、飲みやすさの印象を5段階で評価してください。入力例: 天然水=5, 炭酸水=3, 硬水=2',
    'main',
    'matrix_single',
    true,
    7,
    null,
    '{
      "matrix_rows": [
        { "value": "natural", "label": "天然水" },
        { "value": "purified", "label": "浄水・ピュアウォーター" },
        { "value": "sparkling", "label": "炭酸水" },
        { "value": "hard", "label": "硬水" }
      ],
      "matrix_cols": [
        { "value": "1", "label": "1: 飲みにくい" },
        { "value": "2", "label": "2" },
        { "value": "3", "label": "3" },
        { "value": "4", "label": "4" },
        { "value": "5", "label": "5: 飲みやすい" }
      ],
      "helpText": "LINEではテキスト回答フォールバックで確認します"
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
    false,
    now(),
    now()
  ),
  -- Q7: matrix_multi（場面別に飲みたい水タイプ）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q7',
    '各場面で飲みたい水のタイプを選んでください。入力例: 仕事中=天然水,浄水 / 運動後=炭酸水',
    'main',
    'matrix_multi',
    true,
    8,
    null,
    '{
      "matrix_rows": [
        { "value": "work", "label": "仕事・勉強中" },
        { "value": "exercise", "label": "運動後" },
        { "value": "meal", "label": "食事中" },
        { "value": "outing", "label": "外出先" }
      ],
      "matrix_cols": [
        { "value": "natural", "label": "天然水" },
        { "value": "purified", "label": "浄水" },
        { "value": "sparkling", "label": "炭酸水" },
        { "value": "flavored", "label": "フレーバーウォーター" }
      ],
      "helpText": "LINEではテキスト回答フォールバックで確認します"
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
    false,
    now(),
    now()
  ),
  -- Q8: matrix_mixed（購入時の重視点）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q8',
    '購入時の条件について答えてください。入力例: 価格帯=100円前後 / 容量=500ml / 自由コメント=ラベルが剥がしやすいと助かる',
    'main',
    'matrix_mixed',
    true,
    9,
    null,
    '{
      "matrix_rows": [
        { "value": "price_range", "label": "価格帯", "answer_type": "single_choice" },
        { "value": "volume", "label": "容量", "answer_type": "single_choice" },
        { "value": "free_comment", "label": "自由コメント", "answer_type": "free_text_short" }
      ],
      "matrix_cols": [
        { "value": "under_100", "label": "100円未満" },
        { "value": "around_100", "label": "100円前後" },
        { "value": "around_150", "label": "150円前後" },
        { "value": "350ml", "label": "350ml" },
        { "value": "500ml", "label": "500ml" },
        { "value": "1l", "label": "1L以上" }
      ],
      "helpText": "LINEではテキスト回答フォールバックで確認します"
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
    false,
    now(),
    now()
  ),
  -- Q9: numeric（購入意向1〜5 → 分岐）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q9',
    '新しい飲料水ブランドが出たら、試してみたい気持ちは1〜5でどれくらいですか？',
    'main',
    'numeric',
    true,
    10,
    '{
      "default_next": "Q10",
      "branches": [
        { "field": "value", "when": { "lte": 2 }, "next": "Q9_LOW" },
        { "field": "value", "when": { "gte": 4 }, "next": "Q9_HIGH" }
      ]
    }'::jsonb,
    '{
      "min": 1,
      "max": 5,
      "min_label": "試したくない",
      "max_label": "ぜひ試したい",
      "helpText": "1〜5の数字で回答してください"
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
    false,
    now(),
    now()
  ),
  -- Q9_LOW: free_text_short（試したくない理由）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q9_LOW',
    '試してみたい気持ちが低い理由を短く教えてください。',
    'main',
    'free_text_short',
    false,
    11,
    '{ "default_next": "Q10" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: 水はいつも同じもので十分で、新ブランドだと価格や味がわからないからです",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "低購入意向の理由と障壁を把握する",
        "question_goal": "試したくない理由を取得する",
        "probe_goal": "低評価理由が抽象的な場合に価格・味・信頼性・習慣のどれが障壁か聞く",
        "required_slots": ["reason", "purchase_barrier"],
        "bad_answer_patterns": [
          { "type": "contains", "value": "なんとなく", "note": "abstract" },
          { "type": "contains", "value": "普通", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "試したくない理由を、価格・味・信頼性・習慣のどれに近いか含めて教えてください",
        "answerExample": "水はいつも同じもので十分で、新ブランドだと価格や味がわからないからです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '低評価理由が短い場合は、価格、味、信頼性、習慣のどれが障壁か確認する。',
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
    false,
    now(),
    now()
  ),
  -- Q9_HIGH: free_text_short（試したい理由）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q9_HIGH',
    '試してみたい気持ちが高い理由を短く教えてください。',
    'main',
    'free_text_short',
    false,
    12,
    '{ "default_next": "Q10" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: クセが少ない天然水で、持ち歩きやすいボトルなら仕事中に試してみたいです",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "高購入意向の理由と期待価値を把握する",
        "question_goal": "試したい理由と利用場面を取得する",
        "probe_goal": "魅力の理由が抽象的な場合に具体的な価値や利用場面を聞く",
        "required_slots": ["reason", "usage_scene"],
        "bad_answer_patterns": [
          { "type": "contains", "value": "便利", "note": "abstract" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "どんな特徴が、どんな場面で試したい理由になるかを教えてください",
        "answerExample": "クセが少ない天然水で、持ち歩きやすいボトルなら仕事中に試してみたいです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '高評価理由が短い場合は、どの特徴がどんな場面で魅力になるか確認する。',
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
    false,
    now(),
    now()
  ),
  -- Q10: sd（天然感 ↔ クリア感）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q10',
    '好みの飲料水の印象を、左を1・右を5として数字で教えてください。',
    'main',
    'sd',
    true,
    13,
    null,
    '{
      "options": [
        { "value": "1", "label": "自然なミネラル感がある" },
        { "value": "2", "label": "やや自然なミネラル感" },
        { "value": "3", "label": "どちらともいえない" },
        { "value": "4", "label": "ややクリアでクセがない" },
        { "value": "5", "label": "クリアでクセがない" }
      ],
      "helpText": "1〜5の数字で回答してください"
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
    false,
    now(),
    now()
  ),
  -- Q11: text_with_image（新ブランド画像への反応 + AI深掘り）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q11',
    '飲料水の新ブランド画像を見た前提で、気になった点や試したい理由・試したくない理由を具体的に教えてください。',
    'main',
    'text_with_image',
    true,
    14,
    null,
    '{
      "question_text_image": {
        "url": "https://example.com/test-assets/drinking-water-brand-concept.png",
        "alt": "飲料水新ブランドのコンセプト画像",
        "caption": "テスト用の画像URLです。実画像に差し替えて確認してください。"
      },
      "options": [
        { "value": "fresh", "label": "さわやか・清潔感がある" },
        { "value": "premium", "label": "高品質そう" },
        { "value": "cheap", "label": "手に取りやすそう" },
        { "value": "unclear", "label": "特徴がわかりにくい" },
        { "value": "other", "label": "その他" }
      ],
      "helpText": "番号でも回答できます。画像付き設問の表示確認用です。",
      "meta": {
        "research_goal": "飲料水新ブランドの画像付き設問とAI深掘りを確認する",
        "question_goal": "画像への反応、試用意向、理由を取得する",
        "probe_goal": "抽象的な反応から、どの部分がなぜそう感じたかを聞く",
        "required_slots": ["reason"],
        "bad_answer_patterns": [
          { "type": "contains", "value": "なんとなく", "note": "abstract" },
          { "type": "contains", "value": "普通", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": true }
      },
      "conversationControl": {
        "coreInfoPrompt": "どの部分が気になったか、なぜ試したい・試したくないと感じたかを教えてください",
        "answerExample": "清潔感はありますが、味や硬度の特徴が見えないので、他の商品との違いがわかりにくいです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '画像への反応が抽象的な場合は、気になった箇所と理由、試用意向への影響を確認する。',
    2,
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
    false,
    now(),
    now()
  ),
  -- Q12: image_upload（飲料水写真・任意）
  (
    '00000000-0000-4000-8000-0000000000c5',
    'Q12',
    '画像アップロード設問の確認です。よく買う水や気になる水のボトル写真があれば送ってください。ない場合は「画像なし」と入力してください。',
    'main',
    'image_upload',
    false,
    15,
    null,
    '{
      "image_upload_config": {
        "max_files": 1,
        "accepted_types": ["image/png", "image/jpeg"],
        "max_size_mb": 5
      },
      "helpText": "LINEテキストでは「画像なし」などのフォールバック回答で確認できます"
    }'::jsonb,
    false,
    null,
    0,
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
    false,
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
  answer_options_locked = excluded.answer_options_locked,
  updated_at = now();

commit;

-- ------------------------------------------------------------
-- Optional: assign this project to a real LINE user.
-- Replace YOUR_LINE_USER_ID and run after the project/questions insert.
-- ------------------------------------------------------------
-- with target_respondent as (
--   insert into respondents (
--     line_user_id, display_name, project_id, status, total_points
--   )
--   values (
--     'YOUR_LINE_USER_ID', '飲料水調査テストユーザー',
--     '00000000-0000-4000-8000-0000000000c5', 'invited', 0
--   )
--   on conflict (line_user_id, project_id) do update
--   set display_name = excluded.display_name
--   returning id, line_user_id
-- )
-- insert into project_assignments (
--   project_id, respondent_id, user_id, assignment_type, status,
--   assigned_at, deadline, delivery_log
-- )
-- select
--   '00000000-0000-4000-8000-0000000000c5', id, line_user_id,
--   'manual', 'assigned', now(), now() + interval '7 days', '[]'::jsonb
-- from target_respondent
-- on conflict (project_id, respondent_id) do update
-- set
--   user_id = excluded.user_id, assignment_type = excluded.assignment_type,
--   status = 'assigned', assigned_at = now(), deadline = excluded.deadline,
--   sent_at = null, opened_at = null, started_at = null, completed_at = null,
--   expired_at = null, reminder_sent_at = null, last_delivery_error = null;
