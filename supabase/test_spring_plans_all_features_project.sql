-- ============================================================
-- Test project: spring plans survey + screening + AI probe + all answer types
--
-- Purpose:
-- - Create a dedicated project for testing a "春にやりたいこと" survey.
-- - Exercise screening pass/fail.
-- - Exercise AI probing on vague free-text answers.
-- - Cover every current question_type:
--   single_choice, multi_choice, matrix_single, matrix_multi, matrix_mixed,
--   free_text_short, free_text_long, numeric, image_upload, hidden_single,
--   hidden_multi, text_with_image, sd.
--
-- Project ID:
--   00000000-0000-4000-8000-0000000000c2
--
-- Assignment IDs:
--   pass:                 00000000-0000-4000-8000-00000000cb01
--   fail by interest:     00000000-0000-4000-8000-00000000cb02
--   fail by availability: 00000000-0000-4000-8000-00000000cb03
-- ============================================================

begin;

delete from point_transactions
where project_id = '00000000-0000-4000-8000-0000000000c2';

delete from project_assignments
where project_id = '00000000-0000-4000-8000-0000000000c2';

delete from project_analysis_reports
where project_id = '00000000-0000-4000-8000-0000000000c2';

delete from respondents
where project_id = '00000000-0000-4000-8000-0000000000c2';

delete from screening_conditions
where project_id = '00000000-0000-4000-8000-0000000000c2';

delete from questions
where project_id = '00000000-0000-4000-8000-0000000000c2';

delete from projects
where id = '00000000-0000-4000-8000-0000000000c2';

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
  screening_config,
  screening_last_question_order,
  ai_state_template_key,
  ai_state_generated_at,
  ai_state_json,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-0000000000c2',
  'テスト用: 春にやりたいこと調査 全機能確認',
  'Internal Test',
  '春にやりたいことをテーマに、スクリーニング、AI深掘り、分岐、全回答形式の入力・保存・表示を確認する。',
  'active',
  10,
  'survey_with_interview_probe',
  'interview_chat',
  '[
    "春にやりたいことテーマで全回答形式の入力と保存を確認する",
    "スクリーニング通過・非通過の制御を確認する",
    "短文・抽象回答に対するAI深掘りを確認する"
  ]'::jsonb,
  '[
    "選択式・数値式の分岐を確認する",
    "matrix系と画像系はLINEテキストフォールバックも確認する",
    "hidden系の保存互換性を確認する"
  ]'::jsonb,
  '[
    "回答者は春の予定や関心を持つ生活者として回答する",
    "やりたいことだけでなく、きっかけ・同行者・不安・期待を具体化する"
  ]'::jsonb,
  '[
    "回答者を責める表現を避ける",
    "一度に複数の論点を聞かず、深掘りは1点に絞る",
    "入力テスト案件なので、回答形式の受理を優先する"
  ]'::jsonb,
  '{
    "enabled": true,
    "conditions": ["short_answer", "abstract_answer"],
    "max_probes_per_answer": 2,
    "max_probes_per_session": 8,
    "require_question_probe_enabled": true,
    "target_question_codes": ["Q3_PLAN_REASON", "Q5_PLAN_DETAIL", "Q8_LOW_REASON", "Q8_HIGH_REASON", "Q10_IMAGE_REACTION", "__free_comment__"],
    "blocked_question_codes": ["S1_INTEREST", "S2_AVAILABILITY", "Q1_PRIORITY", "Q2_ACTIVITIES", "Q4_MATRIX_SINGLE", "Q6_MATRIX_MULTI", "Q7_MATRIX_MIXED", "Q8_SCORE", "Q9_SD", "Q11_IMAGE_UPLOAD", "Q12_HIDDEN_SINGLE", "Q13_HIDDEN_MULTI"],
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
    "max_characters_per_message": 120,
    "max_sentences": 2
  }'::jsonb,
  '{
    "enabled": true,
    "pass_action": "survey",
    "pass_message": "スクリーニングを通過しました。続けて春にやりたいことに関する質問へお進みください。",
    "fail_message": "ご回答ありがとうございます。今回は対象条件と合わないため、ここで終了となります。"
  }'::jsonb,
  2,
  'spring_plans_all_features',
  now(),
  '{
    "version": "v1",
    "template_key": "spring_plans_all_features",
    "project_goal": "春にやりたいことについて、関心領域、予定の具体度、期待、不安、必要な支援を全回答形式で収集し、AI深掘りの挙動を確認する。",
    "user_understanding_goal": "誰が、どんな場面で、春に何をしたいと考え、何が後押しや障壁になっているかを具体的に理解する。",
    "required_slots": [
      { "key": "interest", "label": "春の予定への関心", "required": true },
      { "key": "desired_activity", "label": "やりたいこと", "required": true },
      { "key": "reason", "label": "理由・きっかけ", "required": true }
    ],
    "optional_slots": [
      { "key": "companion", "label": "同行者", "required": false },
      { "key": "budget", "label": "予算感", "required": false }
    ],
    "language": "ja"
  }'::jsonb,
  now(),
  now()
);

insert into screening_conditions (
  project_id,
  condition_type,
  target_key,
  operator,
  value_json,
  priority
)
values
  (
    '00000000-0000-4000-8000-0000000000c2',
    'question',
    'S1_INTEREST',
    'in',
    '["already_planning", "interested", "researching"]'::jsonb,
    10
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'question',
    'S2_AVAILABILITY',
    'in',
    '["weekend", "weekday", "undecided"]'::jsonb,
    20
  );

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
  is_screening_question,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-0000000000c2',
    'S1_INTEREST',
    'この春にやりたいことや出かけたい予定について、今の気持ちに最も近いものを選んでください。',
    'screening',
    'single_choice',
    true,
    1,
    null,
    '{
      "options": [
        { "value": "already_planning", "label": "具体的に予定を立てている", "isScreeningPass": true },
        { "value": "interested", "label": "やりたいことが少しある", "isScreeningPass": true },
        { "value": "researching", "label": "候補を探している", "isScreeningPass": true },
        { "value": "no_interest", "label": "春に特にやりたいことはない", "isScreeningPass": false }
      ],
      "helpText": "テストでは通過対象と非通過対象の両方を確認します。"
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
    true,
    true,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'S2_AVAILABILITY',
    'この春に予定を入れられそうなタイミングを選んでください。',
    'screening',
    'single_choice',
    true,
    2,
    null,
    '{
      "options": [
        { "value": "weekend", "label": "週末・祝日なら予定を入れられる", "isScreeningPass": true },
        { "value": "weekday", "label": "平日でも予定を入れられる", "isScreeningPass": true },
        { "value": "undecided", "label": "日程は未定だが検討できる", "isScreeningPass": true },
        { "value": "no_time", "label": "この春は予定を入れる余裕がない", "isScreeningPass": false }
      ]
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
    true,
    true,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q1_PRIORITY',
    'この春に最もやってみたいことを1つ選んでください。',
    'main',
    'single_choice',
    true,
    3,
    '{
      "default_next": "Q3_PLAN_REASON",
      "branches": [
        { "field": "value", "when": { "equals": "cherry_blossom" }, "next": "Q3_PLAN_REASON" },
        { "field": "value", "when": { "equals": "travel" }, "next": "Q3_PLAN_REASON" },
        { "field": "value", "when": { "equals": "new_hobby" }, "next": "Q3_PLAN_REASON" }
      ]
    }'::jsonb,
    '{
      "options": [
        { "value": "cherry_blossom", "label": "花見や春の景色を楽しむ" },
        { "value": "travel", "label": "旅行・日帰りのお出かけ" },
        { "value": "new_hobby", "label": "新しい趣味や学びを始める" },
        { "value": "food_event", "label": "春限定の食事やイベントに行く" },
        { "value": "home_refresh", "label": "部屋の整理や模様替えをする" }
      ],
      "helpText": "番号でも回答できます。"
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
    true,
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q2_ACTIVITIES',
    'この春に少しでも気になっていることをすべて選んでください。',
    'main',
    'multi_choice',
    true,
    4,
    null,
    '{
      "min_select": 1,
      "max_select": 6,
      "options": [
        { "value": "park", "label": "公園・自然散策" },
        { "value": "cafe", "label": "カフェ・外食" },
        { "value": "shopping", "label": "買い物" },
        { "value": "travel", "label": "旅行" },
        { "value": "learning", "label": "学び・習い事" },
        { "value": "cleaning", "label": "片付け・模様替え" }
      ],
      "helpText": "複数選択は 1,3 のようにカンマ区切りで入力してください。"
    }'::jsonb,
    false,
    null,
    0,
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
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q3_PLAN_REASON',
    'それをこの春にやってみたい理由を、きっかけがわかるように短く教えてください。',
    'main',
    'free_text_short',
    true,
    5,
    null,
    '{
      "max_length": 160,
      "placeholder": "例: 去年は忙しくて桜を見に行けなかったので、今年は家族と近場の公園でゆっくり過ごしたいです。",
      "helpText": "短文でも入力できます。曖昧な回答ではAI深掘りを確認します。",
      "meta": {
        "research_goal": "春にやりたいことの理由を把握する",
        "required_slots": ["reason", "trigger"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "特になし", "note": "no_content" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" },
          { "type": "contains", "value": "普通", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "force_probe_on_bad": true, "strict_topic_lock": true }
      }
    }'::jsonb,
    true,
    '理由が抽象的な場合は、いつ・誰と・何を期待しているかのうち不足している1点だけ確認する。',
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
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q4_MATRIX_SINGLE',
    '次の項目について、春にやりたい気持ちを1から5で評価してください。入力例: 花見=5, 旅行=4, 新しい趣味=3',
    'main',
    'matrix_single',
    true,
    6,
    null,
    '{
      "matrix_rows": [
        { "value": "cherry_blossom", "label": "花見" },
        { "value": "travel", "label": "旅行" },
        { "value": "new_hobby", "label": "新しい趣味" }
      ],
      "matrix_cols": [
        { "value": "1", "label": "1: 低い" },
        { "value": "2", "label": "2" },
        { "value": "3", "label": "3" },
        { "value": "4", "label": "4" },
        { "value": "5", "label": "5: 高い" }
      ],
      "helpText": "LINEではテキスト回答フォールバックで確認します。"
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
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q5_PLAN_DETAIL',
    '春にやりたいことについて、いつ・誰と・どんな形で実現したいかを教えてください。',
    'main',
    'free_text_long',
    true,
    7,
    null,
    '{
      "placeholder": "例: 4月上旬の週末に友人と近場の公園へ行き、混みすぎない時間帯に散歩と写真を楽しみたいです。",
      "helpText": "「特になし」だけでも入力できますが、AI深掘り確認用に追加質問が出る想定です。",
      "meta": {
        "research_goal": "予定の具体度と実現条件を把握する",
        "required_slots": ["timing", "companion", "desired_activity"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "特になし", "note": "no_content" },
          { "type": "exact", "value": "なし", "note": "no_content" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "force_probe_on_bad": true, "strict_topic_lock": true }
      }
    }'::jsonb,
    true,
    '短文や抽象回答では、時期、同行者、期待している体験のうち不足している1点を確認する。',
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
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q6_MATRIX_MULTI',
    'やりたいことごとに、必要そうな支援を選んでください。入力例: 花見=混雑情報,天気 / 旅行=予算比較',
    'main',
    'matrix_multi',
    true,
    8,
    null,
    '{
      "matrix_rows": [
        { "value": "cherry_blossom", "label": "花見" },
        { "value": "travel", "label": "旅行" },
        { "value": "new_hobby", "label": "新しい趣味" }
      ],
      "matrix_cols": [
        { "value": "weather", "label": "天気" },
        { "value": "crowd", "label": "混雑情報" },
        { "value": "budget", "label": "予算比較" },
        { "value": "reservation", "label": "予約・申込" }
      ],
      "helpText": "LINEではテキスト回答フォールバックで確認します。"
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
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q7_MATRIX_MIXED',
    '春の予定づくりで気になる点ごとに重要度と補足を入力してください。入力例: 予算=高 / 理由=旅行費を抑えたい',
    'main',
    'matrix_mixed',
    true,
    9,
    null,
    '{
      "matrix_rows": [
        { "value": "budget", "label": "予算", "answer_type": "single_choice" },
        { "value": "schedule", "label": "日程調整", "answer_type": "single_choice" },
        { "value": "free_note", "label": "補足理由", "answer_type": "free_text_short" }
      ],
      "matrix_cols": [
        { "value": "low", "label": "低" },
        { "value": "middle", "label": "中" },
        { "value": "high", "label": "高" },
        { "value": "note", "label": "理由" }
      ],
      "helpText": "LINEではテキスト回答フォールバックで確認します。"
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
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q8_SCORE',
    'この春に予定を実行したい気持ちを1から5の数字で教えてください。',
    'main',
    'numeric',
    true,
    10,
    '{
      "default_next": "Q9_SD",
      "branches": [
        { "field": "value", "when": { "lte": 2 }, "next": "Q8_LOW_REASON" },
        { "field": "value", "when": { "gte": 4 }, "next": "Q8_HIGH_REASON" }
      ]
    }'::jsonb,
    '{
      "min": 1,
      "max": 5,
      "min_label": "低い",
      "max_label": "高い",
      "helpText": "1から5の数字で回答してください。"
    }'::jsonb,
    false,
    null,
    0,
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
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q8_LOW_REASON',
    '実行したい気持ちが低い理由を短く教えてください。',
    'main',
    'free_text_short',
    false,
    11,
    '{ "default_next": "Q9_SD" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: 仕事の予定が読めず、春の間に確実に時間を作れるかわからないためです。",
      "meta": {
        "research_goal": "低意向の理由を把握する",
        "bad_answer_patterns": [{ "type": "contains", "value": "なんとなく", "note": "abstract" }],
        "probe_config": { "max_probes": 1, "force_probe_on_bad": true }
      }
    }'::jsonb,
    true,
    '抽象的な場合は、時間、予算、同行者、関心のどれが障壁かを確認する。',
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
    false,
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q8_HIGH_REASON',
    '実行したい気持ちが高い理由を短く教えてください。',
    'main',
    'free_text_short',
    false,
    12,
    '{ "default_next": "Q9_SD" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: 桜の時期に合わせて家族と出かける約束をしていて、今から場所を決めたいからです。",
      "meta": {
        "research_goal": "高意向の理由を把握する",
        "bad_answer_patterns": [{ "type": "contains", "value": "なんとなく", "note": "abstract" }],
        "probe_config": { "max_probes": 1, "force_probe_on_bad": true }
      }
    }'::jsonb,
    true,
    '抽象的な場合は、具体的な予定、同行者、期待している体験のどれかを確認する。',
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
    false,
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q9_SD',
    '春の予定の決め方について、左が「計画重視」、右が「気分重視」として1から5で選んでください。',
    'main',
    'sd',
    true,
    13,
    null,
    '{
      "options": [
        { "value": "1", "label": "計画重視" },
        { "value": "2", "label": "やや計画重視" },
        { "value": "3", "label": "どちらともいえない" },
        { "value": "4", "label": "やや気分重視" },
        { "value": "5", "label": "気分重視" }
      ],
      "helpText": "1から5の数字で回答してください。"
    }'::jsonb,
    false,
    null,
    0,
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
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q10_IMAGE_REACTION',
    '春のお出かけイメージを見た前提で、最も気になる点を選び、理由も短く教えてください。',
    'main',
    'text_with_image',
    true,
    14,
    null,
    '{
      "question_text_image": {
        "url": "https://example.com/test-assets/spring-plans-image.png",
        "alt": "春にやりたいこと調査テスト用の画面イメージ",
        "caption": "テスト用URLです。実画像に差し替えて表示確認できます。"
      },
      "options": [
        { "value": "place", "label": "行き先を決めたい" },
        { "value": "timing", "label": "時期や混雑を知りたい" },
        { "value": "budget", "label": "予算を見積もりたい" },
        { "value": "other", "label": "その他" }
      ],
      "helpText": "番号でも回答できます。理由が曖昧な場合はAI深掘りを確認します。",
      "meta": {
        "research_goal": "画像付き設問とAI深掘りの組み合わせを確認する",
        "required_slots": ["reason"],
        "bad_answer_patterns": [
          { "type": "contains", "value": "なんとなく", "note": "abstract" },
          { "type": "contains", "value": "普通", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 1, "force_probe_on_bad": true, "strict_topic_lock": true }
      }
    }'::jsonb,
    true,
    '抽象的な反応では、画像のどの要素や予定のどの条件が理由かを確認する。',
    1,
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
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q11_IMAGE_UPLOAD',
    '春にやりたいことの参考画像やメモがあれば送ってください。ない場合は「画像なし」と入力してください。',
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
      "helpText": "LINEテキストでは「画像なし」などのフォールバック回答で確認できます。"
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
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q12_HIDDEN_SINGLE',
    'hidden_singleの保存確認です。テスト値として A または B を入力してください。',
    'main',
    'hidden_single',
    false,
    16,
    null,
    '{
      "options": [
        { "value": "A", "label": "テストA" },
        { "value": "B", "label": "テストB" }
      ],
      "default_value": "A",
      "helpText": "hidden系の保存確認用です。通常運用では非表示想定です。"
    }'::jsonb,
    false,
    null,
    0,
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
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    'Q13_HIDDEN_MULTI',
    'hidden_multiの保存確認です。テスト値として A,B のように入力してください。',
    'main',
    'hidden_multi',
    false,
    17,
    null,
    '{
      "options": [
        { "value": "A", "label": "テストA" },
        { "value": "B", "label": "テストB" },
        { "value": "C", "label": "テストC" }
      ],
      "default_values": ["A", "B"],
      "helpText": "hidden系の保存確認用です。通常運用では非表示想定です。"
    }'::jsonb,
    false,
    null,
    0,
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
    false,
    false,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-0000000000c2',
    '__free_comment__',
    '最後に、ここまでで聞けていない春にやりたいことや予定づくりの困りごとがあれば自由に教えてください。',
    'free_comment',
    'free_text_long',
    false,
    18,
    null,
    '{
      "placeholder": "自由に入力してください。",
      "meta": {
        "research_goal": "補足の予定や困りごとを回収する",
        "bad_answer_patterns": [
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 1, "force_probe_on_bad": false, "strict_topic_lock": true }
      }
    }'::jsonb,
    true,
    '内容が抽象的な場合のみ、どの予定・場面に関する話かを確認する。',
    1,
    'static',
    true,
    true,
    null,
    null,
    'text',
    null,
    null,
    null,
    null,
    false,
    false,
    now(),
    now()
  );

insert into user_profiles (
  line_user_id,
  nickname,
  birth_date,
  gender,
  prefecture,
  address_registered_at,
  occupation,
  occupation_updated_at,
  industry,
  marital_status,
  has_children,
  children_ages,
  household_composition,
  profile_completed,
  profile_completed_at,
  notification_ok,
  ai_tags,
  ai_persona_summary,
  last_login_at,
  visibility_settings,
  created_at,
  updated_at
)
values
  (
    'line_test_spring_plans_pass',
    '春やりたいことテスト_通過',
    '1992-03-15',
    'female',
    '東京都',
    now(),
    '会社員',
    now(),
    'サービス',
    'single',
    false,
    '{}',
    '{一人暮らし}',
    true,
    now(),
    true,
    '{spring_plans,screening_pass}',
    '春の予定に関心があり、全回答形式の通過確認用。',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'line_test_spring_plans_fail_interest',
    '春やりたいことテスト_関心なし',
    '1987-11-20',
    'male',
    '神奈川県',
    now(),
    '会社員',
    now(),
    'IT',
    'married',
    false,
    '{}',
    '{夫婦}',
    true,
    now(),
    true,
    '{spring_plans,screening_fail_interest}',
    'S1で春に特にやりたいことはないを選ぶ想定のスクリーニング失敗確認用。',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'line_test_spring_plans_fail_availability',
    '春やりたいことテスト_予定余裕なし',
    '1996-06-01',
    'other',
    '埼玉県',
    now(),
    '学生',
    now(),
    '教育',
    'single',
    false,
    '{}',
    '{家族と同居}',
    true,
    now(),
    true,
    '{spring_plans,screening_fail_availability}',
    'S1は通過、S2で予定を入れる余裕がないを選ぶ想定のスクリーニング失敗確認用。',
    now(),
    '{}'::jsonb,
    now(),
    now()
  )
on conflict (line_user_id) do update
set
  nickname = excluded.nickname,
  birth_date = excluded.birth_date,
  gender = excluded.gender,
  prefecture = excluded.prefecture,
  address_registered_at = excluded.address_registered_at,
  occupation = excluded.occupation,
  occupation_updated_at = excluded.occupation_updated_at,
  industry = excluded.industry,
  marital_status = excluded.marital_status,
  has_children = excluded.has_children,
  children_ages = excluded.children_ages,
  household_composition = excluded.household_composition,
  profile_completed = excluded.profile_completed,
  profile_completed_at = excluded.profile_completed_at,
  notification_ok = excluded.notification_ok,
  ai_tags = excluded.ai_tags,
  ai_persona_summary = excluded.ai_persona_summary,
  last_login_at = excluded.last_login_at,
  visibility_settings = excluded.visibility_settings,
  updated_at = now();

insert into respondents (
  id,
  line_user_id,
  display_name,
  project_id,
  status,
  total_points,
  current_rank_id,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-00000000c301',
    'line_test_spring_plans_pass',
    '春やりたいことテスト_通過',
    '00000000-0000-4000-8000-0000000000c2',
    'invited',
    0,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000c302',
    'line_test_spring_plans_fail_interest',
    '春やりたいことテスト_関心なし',
    '00000000-0000-4000-8000-0000000000c2',
    'invited',
    0,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000c303',
    'line_test_spring_plans_fail_availability',
    '春やりたいことテスト_予定余裕なし',
    '00000000-0000-4000-8000-0000000000c2',
    'invited',
    0,
    null,
    now(),
    now()
  )
on conflict (line_user_id, project_id) do update
set
  display_name = excluded.display_name,
  status = excluded.status,
  total_points = excluded.total_points,
  current_rank_id = excluded.current_rank_id,
  updated_at = now();

insert into project_assignments (
  id,
  project_id,
  respondent_id,
  assignment_type,
  status,
  user_id,
  assigned_at,
  deadline,
  due_at,
  filter_snapshot,
  delivery_channel,
  delivery_log,
  screening_result,
  screening_result_at,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-00000000cb01',
    '00000000-0000-4000-8000-0000000000c2',
    '00000000-0000-4000-8000-00000000c301',
    'manual',
    'assigned',
    'line_test_spring_plans_pass',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "spring_plans_all_features", "expected": "pass if S1 has interest and S2 has availability"}'::jsonb,
    'liff',
    '[]'::jsonb,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000cb02',
    '00000000-0000-4000-8000-0000000000c2',
    '00000000-0000-4000-8000-00000000c302',
    'manual',
    'assigned',
    'line_test_spring_plans_fail_interest',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "spring_plans_all_features", "expected": "fail if S1=no_interest"}'::jsonb,
    'liff',
    '[]'::jsonb,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000cb03',
    '00000000-0000-4000-8000-0000000000c2',
    '00000000-0000-4000-8000-00000000c303',
    'manual',
    'assigned',
    'line_test_spring_plans_fail_availability',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "spring_plans_all_features", "expected": "fail if S2=no_time"}'::jsonb,
    'liff',
    '[]'::jsonb,
    null,
    null,
    now(),
    now()
  )
on conflict (project_id, respondent_id) do update
set
  assignment_type = excluded.assignment_type,
  status = excluded.status,
  user_id = excluded.user_id,
  assigned_at = excluded.assigned_at,
  deadline = excluded.deadline,
  due_at = excluded.due_at,
  filter_snapshot = excluded.filter_snapshot,
  delivery_channel = excluded.delivery_channel,
  delivery_log = excluded.delivery_log,
  screening_result = null,
  screening_result_at = null,
  updated_at = now();

commit;
