-- ============================================================
-- Test project: breakfast and health survey + screening + AI probe + all answer types
--
-- Purpose:
-- - Create a dedicated project for testing a "朝食と健康の関係性" survey.
-- - Exercise screening pass/fail.
-- - Exercise AI probing on vague free-text answers.
-- - Cover every current question_type:
--   single_choice, multi_choice, matrix_single, matrix_multi, matrix_mixed,
--   free_text_short, free_text_long, numeric, image_upload, hidden_single,
--   hidden_multi, text_with_image, sd.
--
-- Project ID:
--   00000000-0000-4000-8000-0000000000c3
--
-- Assignment IDs:
--   pass:                 00000000-0000-4000-8000-00000000cc01
--   fail by interest:     00000000-0000-4000-8000-00000000cc02
--   fail by frequency:    00000000-0000-4000-8000-00000000cc03
-- ============================================================

begin;

delete from point_transactions
where project_id = '00000000-0000-4000-8000-0000000000c3';

delete from project_assignments
where project_id = '00000000-0000-4000-8000-0000000000c3';

delete from project_analysis_reports
where project_id = '00000000-0000-4000-8000-0000000000c3';

delete from respondents
where project_id = '00000000-0000-4000-8000-0000000000c3';

delete from screening_conditions
where project_id = '00000000-0000-4000-8000-0000000000c3';

delete from questions
where project_id = '00000000-0000-4000-8000-0000000000c3';

delete from projects
where id = '00000000-0000-4000-8000-0000000000c3';

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
  '00000000-0000-4000-8000-0000000000c3',
  'テスト用: 朝食と健康の関係性調査 全機能確認',
  'Internal Test',
  '朝食と健康の関係性をテーマに、スクリーニング、AI深掘り、分岐、全回答形式の入力・保存・表示を確認する。',
  'active',
  10,
  'survey_with_interview_probe',
  'interview_chat',
  '[
    "朝食と健康の関係性テーマで全回答形式の入力と保存を確認する",
    "スクリーニング通過・非通過の制御を確認する",
    "短文・抽象回答に対するAI深掘りを確認する"
  ]'::jsonb,
  '[
    "選択式・数値式の分岐を確認する",
    "matrix系と画像系はLINEテキストフォールバックも確認する",
    "hidden系の保存互換性を確認する"
  ]'::jsonb,
  '[
    "回答者は朝食習慣や健康意識を持つ生活者として回答する",
    "食べる頻度だけでなく、体調実感・理由・困りごと・改善意向を具体化する"
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
    "target_question_codes": ["Q3_HEALTH_REASON", "Q5_BREAKFAST_DETAIL", "Q8_LOW_REASON", "Q8_HIGH_REASON", "Q10_IMAGE_REACTION", "__free_comment__"],
    "blocked_question_codes": ["S1_BREAKFAST_INTEREST", "S2_BREAKFAST_FREQUENCY", "Q1_PRIORITY", "Q2_BREAKFAST_TYPES", "Q4_MATRIX_SINGLE", "Q6_MATRIX_MULTI", "Q7_MATRIX_MIXED", "Q8_SCORE", "Q9_SD", "Q11_IMAGE_UPLOAD", "Q12_HIDDEN_SINGLE", "Q13_HIDDEN_MULTI"],
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
    "pass_message": "スクリーニングを通過しました。続けて朝食と健康に関する質問へお進みください。",
    "fail_message": "ご回答ありがとうございます。今回は対象条件と合わないため、ここで終了となります。"
  }'::jsonb,
  2,
  'breakfast_health_all_features',
  now(),
  '{
    "version": "v1",
    "template_key": "breakfast_health_all_features",
    "project_goal": "朝食と健康の関係性について、朝食頻度、食べる内容、体調実感、障壁、改善意向を全回答形式で収集し、AI深掘りの挙動を確認する。",
    "user_understanding_goal": "誰が、どんな生活リズムで、朝食をどう食べ、健康面で何を感じ、何が継続や改善の障壁になっているかを具体的に理解する。",
    "required_slots": [
      { "key": "interest", "label": "朝食と健康への関心", "required": true },
      { "key": "breakfast_habit", "label": "朝食習慣", "required": true },
      { "key": "reason", "label": "理由・体調実感", "required": true }
    ],
    "optional_slots": [
      { "key": "timing", "label": "食べる時間帯", "required": false },
      { "key": "nutrition", "label": "栄養意識", "required": false }
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
    '00000000-0000-4000-8000-0000000000c3',
    'question',
    'S1_BREAKFAST_INTEREST',
    'in',
    '["high_interest", "some_interest", "want_to_improve"]'::jsonb,
    10
  ),
  (
    '00000000-0000-4000-8000-0000000000c3',
    'question',
    'S2_BREAKFAST_FREQUENCY',
    'in',
    '["daily", "several_times", "sometimes"]'::jsonb,
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
    '00000000-0000-4000-8000-0000000000c3',
    'S1_BREAKFAST_INTEREST',
    '朝食と健康の関係について、今の気持ちに最も近いものを選んでください。',
    'screening',
    'single_choice',
    true,
    1,
    null,
    '{
      "options": [
        { "value": "high_interest", "label": "朝食と健康の関係に強く関心がある", "isScreeningPass": true },
        { "value": "some_interest", "label": "少し関心がある", "isScreeningPass": true },
        { "value": "want_to_improve", "label": "朝食習慣を改善したいと思っている", "isScreeningPass": true },
        { "value": "no_interest", "label": "朝食や健康には特に関心がない", "isScreeningPass": false }
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
    '00000000-0000-4000-8000-0000000000c3',
    'S2_BREAKFAST_FREQUENCY',
    '普段の朝食頻度に最も近いものを選んでください。',
    'screening',
    'single_choice',
    true,
    2,
    null,
    '{
      "options": [
        { "value": "daily", "label": "ほぼ毎日食べる", "isScreeningPass": true },
        { "value": "several_times", "label": "週に数回食べる", "isScreeningPass": true },
        { "value": "sometimes", "label": "たまに食べる", "isScreeningPass": true },
        { "value": "rarely_or_never", "label": "ほとんど食べない・まったく食べない", "isScreeningPass": false }
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
    '00000000-0000-4000-8000-0000000000c3',
    'Q1_PRIORITY',
    '朝食で最も意識したいことを1つ選んでください。',
    'main',
    'single_choice',
    true,
    3,
    '{
      "default_next": "Q3_HEALTH_REASON",
      "branches": [
        { "field": "value", "when": { "equals": "balanced_meal" }, "next": "Q3_HEALTH_REASON" },
        { "field": "value", "when": { "equals": "protein" }, "next": "Q3_HEALTH_REASON" },
        { "field": "value", "when": { "equals": "quick_meal" }, "next": "Q3_HEALTH_REASON" }
      ]
    }'::jsonb,
    '{
      "options": [
        { "value": "balanced_meal", "label": "主食・主菜・副菜のバランスを整える" },
        { "value": "protein", "label": "たんぱく質をしっかり取る" },
        { "value": "quick_meal", "label": "短時間で食べられる朝食にする" },
        { "value": "skip_breakfast", "label": "朝食を抜く頻度を減らす" },
        { "value": "supplements", "label": "サプリや栄養補助食品を活用する" }
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
    '00000000-0000-4000-8000-0000000000c3',
    'Q2_BREAKFAST_TYPES',
    '朝食で普段取り入れているものをすべて選んでください。',
    'main',
    'multi_choice',
    true,
    4,
    null,
    '{
      "min_select": 1,
      "max_select": 6,
      "options": [
        { "value": "rice_bread", "label": "ごはん・パンなどの主食" },
        { "value": "eggs_meat_fish", "label": "卵・肉・魚・豆類などのたんぱく質" },
        { "value": "fruit_yogurt", "label": "果物・ヨーグルト" },
        { "value": "protein", "label": "プロテイン・栄養補助食品" },
        { "value": "coffee_only", "label": "コーヒーや飲み物だけ" },
        { "value": "nothing", "label": "特に食べない" }
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
    '00000000-0000-4000-8000-0000000000c3',
    'Q3_HEALTH_REASON',
    '朝食でそれを意識したい理由を、体調や生活リズムがわかるように短く教えてください。',
    'main',
    'free_text_short',
    true,
    5,
    null,
    '{
      "max_length": 160,
      "placeholder": "例: 午前中に集中力が落ちやすいので、朝にたんぱく質を取ると体調が安定するか試したいです。",
      "helpText": "短文でも入力できます。曖昧な回答ではAI深掘りを確認します。",
      "meta": {
        "research_goal": "朝食で意識したいことの理由を把握する",
        "required_slots": ["reason", "health_feeling"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "特になし", "note": "no_content" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" },
          { "type": "contains", "value": "普通", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "force_probe_on_bad": true, "strict_topic_lock": true }
      }
    }'::jsonb,
    true,
    '理由が抽象的な場合は、体調・生活リズム・続けにくい理由のうち不足している1点だけ確認する。',
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
    '00000000-0000-4000-8000-0000000000c3',
    'Q4_MATRIX_SINGLE',
    '次の項目について、朝食で意識している度合いを1から5で評価してください。入力例: 栄養バランス=5, たんぱく質=4, 時短=3',
    'main',
    'matrix_single',
    true,
    6,
    null,
    '{
      "matrix_rows": [
        { "value": "balanced_meal", "label": "栄養バランス" },
        { "value": "protein", "label": "たんぱく質" },
        { "value": "quick_meal", "label": "時短" }
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
    '00000000-0000-4000-8000-0000000000c3',
    'Q5_BREAKFAST_DETAIL',
    '朝食習慣について、普段いつ・何を・どのくらい食べているかを教えてください。',
    'main',
    'free_text_long',
    true,
    7,
    null,
    '{
      "placeholder": "例: 平日は出勤前の7時頃に、ヨーグルトとバナナだけを食べることが多く、休日はごはんと卵を食べます。",
      "helpText": "「特になし」だけでも入力できますが、AI深掘り確認用に追加質問が出る想定です。",
      "meta": {
        "research_goal": "朝食習慣の具体度と健康実感を把握する",
        "required_slots": ["timing", "food", "health_feeling"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "特になし", "note": "no_content" },
          { "type": "exact", "value": "なし", "note": "no_content" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "force_probe_on_bad": true, "strict_topic_lock": true }
      }
    }'::jsonb,
    true,
    '短文や抽象回答では、食べる時間、内容、体調実感のうち不足している1点を確認する。',
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
    '00000000-0000-4000-8000-0000000000c3',
    'Q6_MATRIX_MULTI',
    '朝食の課題ごとに、必要そうな支援を選んでください。入力例: 栄養バランス=買い物,レシピ / たんぱく質=価格',
    'main',
    'matrix_multi',
    true,
    8,
    null,
    '{
      "matrix_rows": [
        { "value": "balanced_meal", "label": "栄養バランス" },
        { "value": "protein", "label": "たんぱく質" },
        { "value": "quick_meal", "label": "時短" }
      ],
      "matrix_cols": [
        { "value": "recipe", "label": "レシピ" },
        { "value": "shopping", "label": "買い物" },
        { "value": "price", "label": "価格" },
        { "value": "prep", "label": "作り置き" }
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
    '00000000-0000-4000-8000-0000000000c3',
    'Q7_MATRIX_MIXED',
    '朝食習慣で気になる点ごとに重要度と補足を入力してください。入力例: 栄養=高 / 理由=午前中の集中力を上げたい',
    'main',
    'matrix_mixed',
    true,
    9,
    null,
    '{
      "matrix_rows": [
        { "value": "nutrition", "label": "栄養", "answer_type": "single_choice" },
        { "value": "time_saving", "label": "時短", "answer_type": "single_choice" },
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
    '00000000-0000-4000-8000-0000000000c3',
    'Q8_SCORE',
    '朝食習慣を改善したい気持ちを1から5の数字で教えてください。',
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
    '00000000-0000-4000-8000-0000000000c3',
    'Q8_LOW_REASON',
    '改善したい気持ちが低い理由を短く教えてください。',
    'main',
    'free_text_short',
    false,
    11,
    '{ "default_next": "Q9_SD" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: 今の生活では朝に空腹を感じにくく、無理に食べる必要性をあまり感じていないためです。",
      "meta": {
        "research_goal": "低い改善意向の理由を把握する",
        "bad_answer_patterns": [{ "type": "contains", "value": "なんとなく", "note": "abstract" }],
        "probe_config": { "max_probes": 1, "force_probe_on_bad": true }
      }
    }'::jsonb,
    true,
    '抽象的な場合は、時間、食欲、準備負担、健康実感のどれが障壁かを確認する。',
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
    '00000000-0000-4000-8000-0000000000c3',
    'Q8_HIGH_REASON',
    '改善したい気持ちが高い理由を短く教えてください。',
    'main',
    'free_text_short',
    false,
    12,
    '{ "default_next": "Q9_SD" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: 朝食を食べた日は午前中の集中力が続きやすいので、平日も続けられる形に整えたいからです。",
      "meta": {
        "research_goal": "高い改善意向の理由を把握する",
        "bad_answer_patterns": [{ "type": "contains", "value": "なんとなく", "note": "abstract" }],
        "probe_config": { "max_probes": 1, "force_probe_on_bad": true }
      }
    }'::jsonb,
    true,
    '抽象的な場合は、改善したい食事内容、体調実感、継続したい頻度のどれかを確認する。',
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
    '00000000-0000-4000-8000-0000000000c3',
    'Q9_SD',
    '朝食の考え方について、左が「栄養重視」、右が「手軽さ重視」として1から5で選んでください。',
    'main',
    'sd',
    true,
    13,
    null,
    '{
      "options": [
        { "value": "1", "label": "栄養重視" },
        { "value": "2", "label": "やや栄養重視" },
        { "value": "3", "label": "どちらともいえない" },
        { "value": "4", "label": "やや手軽さ重視" },
        { "value": "5", "label": "手軽さ重視" }
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
    '00000000-0000-4000-8000-0000000000c3',
    'Q10_IMAGE_REACTION',
    '朝食のメニューイメージを見た前提で、最も気になる点を選び、理由も短く教えてください。',
    'main',
    'text_with_image',
    true,
    14,
    null,
    '{
      "question_text_image": {
        "url": "https://example.com/test-assets/breakfast-health-image.png",
        "alt": "朝食と健康調査テスト用の画面イメージ",
        "caption": "テスト用URLです。実画像に差し替えて表示確認できます。"
      },
      "options": [
        { "value": "place", "label": "栄養バランスを整えたい" },
        { "value": "timing", "label": "準備時間を短くしたい" },
        { "value": "budget", "label": "栄養を見積もりたい" },
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
    '抽象的な反応では、画像のどの食品や健康面のどの条件が理由かを確認する。',
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
    '00000000-0000-4000-8000-0000000000c3',
    'Q11_IMAGE_UPLOAD',
    '朝食内容や健康メモの参考画像があれば送ってください。ない場合は「画像なし」と入力してください。',
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
    '00000000-0000-4000-8000-0000000000c3',
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
    '00000000-0000-4000-8000-0000000000c3',
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
    '00000000-0000-4000-8000-0000000000c3',
    '__free_comment__',
    '最後に、ここまでで聞けていない朝食と健康の関係や困りごとがあれば自由に教えてください。',
    'free_comment',
    'free_text_long',
    false,
    18,
    null,
    '{
      "placeholder": "自由に入力してください。",
      "meta": {
        "research_goal": "補足の朝食習慣や健康面の困りごとを回収する",
        "bad_answer_patterns": [
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 1, "force_probe_on_bad": false, "strict_topic_lock": true }
      }
    }'::jsonb,
    true,
    '内容が抽象的な場合のみ、どの食事場面・体調に関する話かを確認する。',
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
    'line_test_breakfast_health_pass',
    '朝食健康テスト_通過',
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
    '{breakfast_health,screening_pass}',
    '朝食と健康に関心があり、全回答形式の通過確認用。',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'line_test_breakfast_health_fail_interest',
    '朝食健康テスト_関心なし',
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
    '{breakfast_health,screening_fail_interest}',
    'S1で朝食や健康には特に関心がないを選ぶ想定のスクリーニング失敗確認用。',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'line_test_breakfast_health_fail_frequency',
    '朝食健康テスト_朝食頻度低',
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
    '{breakfast_health,screening_fail_frequency}',
    'S1は通過、S2でほとんど食べない・まったく食べないを選ぶ想定のスクリーニング失敗確認用。',
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
    '00000000-0000-4000-8000-00000000c401',
    'line_test_breakfast_health_pass',
    '朝食健康テスト_通過',
    '00000000-0000-4000-8000-0000000000c3',
    'invited',
    0,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000c402',
    'line_test_breakfast_health_fail_interest',
    '朝食健康テスト_関心なし',
    '00000000-0000-4000-8000-0000000000c3',
    'invited',
    0,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000c403',
    'line_test_breakfast_health_fail_frequency',
    '朝食健康テスト_朝食頻度低',
    '00000000-0000-4000-8000-0000000000c3',
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
    '00000000-0000-4000-8000-00000000cc01',
    '00000000-0000-4000-8000-0000000000c3',
    '00000000-0000-4000-8000-00000000c401',
    'manual',
    'assigned',
    'line_test_breakfast_health_pass',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "breakfast_health_all_features", "expected": "pass if S1 has breakfast health interest and S2 has breakfast frequency"}'::jsonb,
    'liff',
    '[]'::jsonb,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000cc02',
    '00000000-0000-4000-8000-0000000000c3',
    '00000000-0000-4000-8000-00000000c402',
    'manual',
    'assigned',
    'line_test_breakfast_health_fail_interest',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "breakfast_health_all_features", "expected": "fail if S1=no_interest"}'::jsonb,
    'liff',
    '[]'::jsonb,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000cc03',
    '00000000-0000-4000-8000-0000000000c3',
    '00000000-0000-4000-8000-00000000c403',
    'manual',
    'assigned',
    'line_test_breakfast_health_fail_frequency',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "breakfast_health_all_features", "expected": "fail if S2=rarely_or_never"}'::jsonb,
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



