-- ============================================================
-- Test project: 人気犬種調査（全回答形式 + AI深掘り + 分岐）
--
-- Purpose:
-- - 犬の人気調査を題材に、13種類の回答形式・AI深掘り・分岐を確認する。
-- - question_type: single_choice / multi_choice / free_text_short / free_text_long /
--                  matrix_single / matrix_multi / matrix_mixed / numeric / sd /
--                  text_with_image / image_upload / hidden_single / hidden_multi
--
-- Recommended checks:
-- - Q1 = "have" → Q2_HAVE → Q3
-- - Q1 = "had"  → Q2_HAD  → Q3
-- - Q1 = other/want → Q2_WANT → Q3
-- - Q3 includes "companion" → Q4_COMPANION → Q5
-- - Q3 に companion なし → Q5 (default)
-- - Q9 <= 2 → Q9_LOW → Q10; Q9 >= 4 → Q9_HIGH → Q10; Q9=3 → Q10 (default)
-- - Q2_*, Q4_COMPANION, Q5, Q9_*, Q11 で短答・曖昧回答 → AI深掘り発動
-- ============================================================

begin;

delete from point_transactions
where project_id = '00000000-0000-4000-8000-0000000000b3';

delete from project_assignments
where project_id = '00000000-0000-4000-8000-0000000000b3';

delete from project_analysis_reports
where project_id = '00000000-0000-4000-8000-0000000000b3';

delete from respondents
where project_id = '00000000-0000-4000-8000-0000000000b3';

delete from questions
where project_id = '00000000-0000-4000-8000-0000000000b3';

delete from projects
where id = '00000000-0000-4000-8000-0000000000b3';

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
  '00000000-0000-4000-8000-0000000000b3',
  'テスト用調査（人気犬種調査・全回答形式確認）',
  'Internal Test',
  '犬の人気と飼育意向を題材に、13種類の回答形式・AI深掘り・分岐動作を確認する。',
  'published',
  10,
  'interview',
  'interview_chat',
  '[
    "人気犬種調査として全question_typeの入力・保存・表示を確認する",
    "短い回答や曖昧回答に対するAI深掘りを複数設問で確認する",
    "飼育状況・惹かれる理由・関心度による分岐を確認する"
  ]'::jsonb,
  '[
    "hidden系と画像系はLINEテキストフォールバックで確認する",
    "matrix系はテキスト回答フォールバックで確認する",
    "分岐後の理由質問でもAI深掘りが動くか確認する"
  ]'::jsonb,
  '[]'::jsonb,
  '[
    "テスト案件なので各回答形式の入力互換性を優先する",
    "AI深掘りでは品種の理由、場面、具体例、障壁を1つずつ確認する",
    "分岐先の質問後は共通質問に戻す"
  ]'::jsonb,
  '{
    "enabled": true,
    "conditions": ["short_answer", "abstract_answer"],
    "max_probes_per_answer": 2,
    "max_probes_per_session": 6,
    "require_question_probe_enabled": true,
    "target_question_codes": ["Q2_HAVE", "Q2_HAD", "Q2_WANT", "Q4_COMPANION", "Q5", "Q9_LOW", "Q9_HIGH", "Q11"],
    "blocked_question_codes": ["Q1", "Q3", "Q6", "Q7", "Q8", "Q9", "Q10", "Q12", "Q13", "Q14"],
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
    "project_goal": "人気犬種調査で全回答形式、分岐、AI深掘りの実行確認",
    "user_understanding_goal": "犬への関心・飼育経験・好みの犬種とその理由を多様な回答形式で取得する",
    "required_slots": [
      {
        "key": "dog_experience",
        "label": "犬との関係",
        "required": true,
        "description": "現在飼っている・飼ったことがある・飼いたいなど",
        "examples": ["柴犬を飼っています", "子供の頃ラブラドールを飼っていた", "トイプードルが気になっています"]
      },
      {
        "key": "reason",
        "label": "理由・魅力",
        "required": true,
        "description": "その犬種・選択・評価の理由",
        "examples": ["賢くて飼いやすい", "一緒に走れるから", "抜け毛が少ない"]
      },
      {
        "key": "ideal_trait",
        "label": "理想の犬の特徴",
        "required": true,
        "description": "一緒にいたい犬のタイプや生活スタイル",
        "examples": ["散歩が好き", "室内でのんびりできる", "子供に優しい"]
      }
    ],
    "optional_slots": [
      {
        "key": "concern",
        "label": "懸念・障壁",
        "required": false,
        "examples": ["飼育費用", "毛が抜ける", "運動量が多い"]
      }
    ],
    "question_categories": ["飼育経験", "好みの犬種", "評価", "コンセプト反応"],
    "probe_policy": {
      "default_max_probes": 2,
      "force_probe_on_bad": true,
      "strict_topic_lock": true,
      "allow_followup_expansion": false
    },
    "completion_rule": {
      "required_slots_needed": ["dog_experience", "reason", "ideal_trait"],
      "allow_finish_without_optional": true,
      "min_required_slots_to_finish": 3
    },
    "language": "ja",
    "probe_guideline": "短答・抽象回答・特になし系の回答では、犬種の理由、場面、具体的な魅力や障壁を1つずつ聞いて具体化する。"
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
  -- Q1: single_choice（飼育状況→分岐）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q1',
    '犬との関係として、今いちばん近いものを選んでください。',
    'screening',
    'single_choice',
    true,
    1,
    '{
      "default_next": "Q2_WANT",
      "branches": [
        { "field": "value", "when": { "equals": "have" }, "next": "Q2_HAVE" },
        { "field": "value", "when": { "equals": "had" }, "next": "Q2_HAD" }
      ]
    }'::jsonb,
    '{
      "options": [
        { "value": "have", "label": "現在犬を飼っている" },
        { "value": "had",  "label": "以前飼っていたが今はいない" },
        { "value": "want", "label": "飼ったことはないが興味がある" },
        { "value": "none", "label": "特に関心はない" }
      ],
      "helpText": "番号でも回答できます",
      "meta": {
        "research_goal": "飼育状況で分岐を確認する",
        "question_goal": "単一選択の入力とbranch_ruleを確認する",
        "probe_goal": "この質問では深掘りしない",
        "required_slots": ["dog_experience"],
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
  -- Q2_HAVE: free_text_short（飼っている犬の品種と魅力）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q2_HAVE',
    '今飼っている犬の品種と、いちばんの魅力を短く教えてください。',
    'main',
    'free_text_short',
    true,
    2,
    '{ "default_next": "Q3" }'::jsonb,
    '{
      "max_length": 120,
      "placeholder": "例: 柴犬を飼っています。独立心があるのに甘えてくる瞬間がたまらないです",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "現飼育者の犬種と魅力を把握する",
        "question_goal": "品種と魅力ポイントを取得する",
        "probe_goal": "品種だけの回答から魅力や場面を聞く",
        "required_slots": ["dog_experience", "reason"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "特になし", "note": "no_content" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "品種と、その犬のどんなところが魅力か教えてください",
        "answerExample": "柴犬を飼っています。独立心があるのに甘えてくる瞬間がたまらないです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '品種だけの回答では、どんな場面で魅力を感じるか、なぜその品種を選んだかを確認する。',
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
  -- Q2_HAD: free_text_short（かつて飼っていた犬の思い出）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q2_HAD',
    'かつて飼っていた犬の品種と、一番印象に残っていることを短く教えてください。',
    'main',
    'free_text_short',
    true,
    3,
    '{ "default_next": "Q3" }'::jsonb,
    '{
      "max_length": 120,
      "placeholder": "例: ゴールデンレトリバーを飼っていました。子供の頃、一緒に走り回った記憶が今も鮮明です",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "元飼育者の思い出と犬への感情を把握する",
        "question_goal": "品種と印象的な思い出を取得する",
        "probe_goal": "思い出が抽象的な場合に具体的な場面や理由を聞く",
        "required_slots": ["dog_experience", "reason"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "特にない", "note": "no_content" },
          { "type": "contains", "value": "普通", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "品種と、その犬との一番の思い出や印象を教えてください",
        "answerExample": "ゴールデンレトリバーを飼っていました。子供の頃、一緒に走り回った記憶が今も鮮明です",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '思い出が短い場合は、具体的な場面・行動・感情を1つ確認する。',
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
  -- Q2_WANT: free_text_short（飼ってみたい犬の品種と理由）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q2_WANT',
    '飼ってみたい犬の品種と、その理由を短く教えてください。',
    'main',
    'free_text_short',
    true,
    4,
    '{ "default_next": "Q3" }'::jsonb,
    '{
      "max_length": 120,
      "placeholder": "例: トイプードルです。賢くて抜け毛が少なく、マンションでも飼いやすそうだからです",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "未飼育者の希望犬種と選択理由を把握する",
        "question_goal": "希望品種と理由を取得する",
        "probe_goal": "品種だけの回答から理由や生活場面を聞く",
        "required_slots": ["dog_experience", "reason"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "わからない", "note": "no_content" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "品種と、その犬を選んだ理由や、どんな生活を想像しているかを教えてください",
        "answerExample": "トイプードルです。賢くて抜け毛が少なく、マンションでも飼いやすそうだからです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '品種だけの回答では、なぜその品種か、どんな生活シーンを想像しているかを確認する。',
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
  -- Q3: multi_choice（犬に惹かれる理由→分岐）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q3',
    '犬に惹かれる理由をすべて選んでください。',
    'main',
    'multi_choice',
    true,
    5,
    '{
      "default_next": "Q5",
      "branches": [
        { "field": "values", "when": { "includes": "companion" }, "next": "Q4_COMPANION" }
      ]
    }'::jsonb,
    '{
      "min_select": 1,
      "max_select": 4,
      "options": [
        { "value": "companion", "label": "一緒にいると癒される・寂しくない" },
        { "value": "active",    "label": "散歩や運動の動機になる" },
        { "value": "child",     "label": "子供や家族との絆が深まる" },
        { "value": "guard",     "label": "防犯・番犬になる" },
        { "value": "social",    "label": "犬友達や地域とのつながりができる" },
        { "value": "other",     "label": "その他" }
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
  -- Q4_COMPANION: free_text_short（一緒にいる時間の魅力）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q4_COMPANION',
    '犬と一緒にいる中で、いちばん好きな時間や場面を1つ短く教えてください。',
    'main',
    'free_text_short',
    false,
    6,
    '{ "default_next": "Q5" }'::jsonb,
    '{
      "max_length": 120,
      "placeholder": "例: 帰宅したときに尻尾を振って迎えてくれる瞬間が一日の疲れを忘れさせてくれます",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "犬との同伴価値の具体的な場面を把握する",
        "question_goal": "好きな場面と理由を取得する",
        "probe_goal": "場面が抽象的な場合に具体的な行動や感情を聞く",
        "required_slots": ["ideal_trait", "reason"],
        "bad_answer_patterns": [
          { "type": "contains", "value": "普通", "note": "abstract" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "どんな場面で、なぜその時間が好きなのかを教えてください",
        "answerExample": "帰宅したときに尻尾を振って迎えてくれる瞬間が一日の疲れを忘れさせてくれます",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '場面が短い場合は、そのときの具体的な行動や感情を1つ確認する。',
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
  -- Q5: free_text_long（理想の犬の特徴）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q5',
    'あなたが一緒に暮らしたい犬の特徴や、理想の生活スタイルを具体的に教えてください。',
    'main',
    'free_text_long',
    true,
    7,
    null,
    '{
      "placeholder": "例: 活発で散歩が大好きな犬がいいです。週末に公園でフリスビーをしたり、夜は一緒にソファでのんびりできる犬が理想です",
      "helpText": "「特になし」だけでも入力できますが、AI深掘り確認用に追加質問が出る想定です",
      "meta": {
        "research_goal": "理想の犬像と生活スタイルを具体化する",
        "question_goal": "特徴・場面・理由を取得する",
        "probe_goal": "短答・曖昧回答から場面や理由を引き出す",
        "expected_slots": [
          { "key": "ideal_trait", "label": "理想の犬の特徴", "required": true, "examples": ["活発", "おとなしい", "賢い", "子供に優しい"] },
          { "key": "usage_scene", "label": "一緒にしたいこと", "required": true, "examples": ["散歩", "公園遊び", "家でのんびり"] },
          { "key": "reason", "label": "理由", "required": true, "examples": ["運動不足解消", "家族が喜ぶ", "癒しが欲しい"] }
        ],
        "required_slots": ["ideal_trait", "usage_scene", "reason"],
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
        "coreInfoPrompt": "どんな特徴の犬と、どんな場面で過ごしたいか、なぜそう思うかを教えてください",
        "answerExample": "活発で散歩が大好きな犬がいいです。週末に公園でフリスビーをしたり、夜は一緒にソファでのんびりできる犬が理想です",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '短答や「特になし」は、どんな犬と何をしたいか、なぜそう思うかを1つずつ聞いて具体化する。',
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
  -- Q6: matrix_single（犬種ごとの印象評価）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q6',
    '次の犬種について、飼いやすさの印象を5段階で評価してください。入力例: 柴犬=4, トイプードル=5, ラブラドール=3',
    'main',
    'matrix_single',
    true,
    8,
    null,
    '{
      "matrix_rows": [
        { "value": "shiba",     "label": "柴犬" },
        { "value": "poodle",    "label": "トイプードル" },
        { "value": "labrador",  "label": "ラブラドール" }
      ],
      "matrix_cols": [
        { "value": "1", "label": "1: 難しそう" },
        { "value": "2", "label": "2" },
        { "value": "3", "label": "3" },
        { "value": "4", "label": "4" },
        { "value": "5", "label": "5: 飼いやすそう" }
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
  -- Q7: matrix_multi（シーン別・一緒にいたい犬のタイプ）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q7',
    '各シーンで一緒にいたい犬のタイプを選んでください。入力例: 朝の散歩=活発,大型 / 休日=おとなしい',
    'main',
    'matrix_multi',
    true,
    9,
    null,
    '{
      "matrix_rows": [
        { "value": "morning_walk", "label": "朝の散歩" },
        { "value": "holiday",      "label": "休日のお出かけ" },
        { "value": "home_relax",   "label": "家でのリラックス" }
      ],
      "matrix_cols": [
        { "value": "active",   "label": "活発" },
        { "value": "calm",     "label": "おとなしい" },
        { "value": "small",    "label": "小型" },
        { "value": "large",    "label": "大型" }
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
  -- Q8: matrix_mixed（犬種選びの重視点）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q8',
    '犬種を選ぶときに重視することを答えてください。入力例: 体の大きさ=小型 / 毛の抜けやすさ=少ない / 好みのコメント=抜け毛が気になります',
    'main',
    'matrix_mixed',
    true,
    10,
    null,
    '{
      "matrix_rows": [
        { "value": "size",        "label": "体の大きさ",     "answer_type": "single_choice" },
        { "value": "shedding",    "label": "毛の抜けやすさ", "answer_type": "single_choice" },
        { "value": "free_comment","label": "好みのコメント", "answer_type": "free_text_short" }
      ],
      "matrix_cols": [
        { "value": "small",    "label": "小型" },
        { "value": "medium",   "label": "中型" },
        { "value": "large",    "label": "大型" },
        { "value": "less",     "label": "少ない" },
        { "value": "moderate", "label": "普通" },
        { "value": "much",     "label": "多い" }
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
  -- Q9: numeric（関心度1〜5 → 分岐）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q9',
    '犬を飼うことへの関心度を1〜5で教えてください。',
    'main',
    'numeric',
    true,
    11,
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
      "min_label": "全く興味ない",
      "max_label": "ぜひ飼いたい",
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
  -- Q9_LOW: free_text_short（関心が低い理由）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q9_LOW',
    '犬への関心が低い理由を短く教えてください。',
    'main',
    'free_text_short',
    false,
    12,
    '{ "default_next": "Q10" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: 毎日の散歩や世話をする時間がなく、旅行にも行けなくなりそうで踏み切れません",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "飼育躊躇層の障壁を把握する",
        "question_goal": "関心が低い理由と障壁を取得する",
        "probe_goal": "抽象的な理由から具体的な障壁を聞く",
        "required_slots": ["reason", "concern"],
        "bad_answer_patterns": [
          { "type": "contains", "value": "なんとなく", "note": "abstract" },
          { "type": "contains", "value": "普通", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "飼えない理由を、時間・費用・住環境・アレルギーなどのどれに近いか含めて教えてください",
        "answerExample": "毎日の散歩や世話をする時間がなく、旅行にも行けなくなりそうで踏み切れません",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '理由が短い場合は、時間・費用・住環境・アレルギーのどれが障壁かを確認する。',
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
  -- Q9_HIGH: free_text_short（関心が高い理由）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q9_HIGH',
    '犬への関心が高い理由を短く教えてください。',
    'main',
    'free_text_short',
    false,
    13,
    '{ "default_next": "Q10" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: 一人暮らしで寂しく、帰宅したときに出迎えてくれる存在が欲しいと思い始めました",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "高関心層の動機と生活イメージを把握する",
        "question_goal": "飼いたい理由と場面を取得する",
        "probe_goal": "動機が抽象的な場合に具体的な場面や背景を聞く",
        "required_slots": ["reason", "ideal_trait"],
        "bad_answer_patterns": [
          { "type": "contains", "value": "かわいい", "note": "abstract" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "なぜ今飼いたいと思っているか、どんな生活を想像しているかを教えてください",
        "answerExample": "一人暮らしで寂しく、帰宅したときに出迎えてくれる存在が欲しいと思い始めました",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '「かわいい」だけの場合は、どんな場面で・なぜ飼いたいかを確認する。',
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
  -- Q10: sd（おとなしい ↔ 活発）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q10',
    '理想の犬のタイプを、左を1・右を5として数字で教えてください。',
    'main',
    'sd',
    true,
    14,
    null,
    '{
      "options": [
        { "value": "1", "label": "おとなしい" },
        { "value": "2", "label": "どちらかといえばおとなしい" },
        { "value": "3", "label": "どちらともいえない" },
        { "value": "4", "label": "どちらかといえば活発" },
        { "value": "5", "label": "活発" }
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
  -- Q11: text_with_image（犬コンセプト画像への反応 + AI深掘り）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q11',
    '犬のコンセプト画像を見た前提で、気になった点や感想を具体的に教えてください。',
    'main',
    'text_with_image',
    true,
    15,
    null,
    '{
      "question_text_image": {
        "url": "https://example.com/test-assets/dog-popularity-concept.png",
        "alt": "人気犬種コンセプト画像",
        "caption": "テスト用の画像URLです。実画像に差し替えて確認してください。"
      },
      "options": [
        { "value": "cute",       "label": "かわいい・癒される" },
        { "value": "active",     "label": "活発そうで一緒に動きたい" },
        { "value": "difficult",  "label": "世話が大変そう" },
        { "value": "other",      "label": "その他" }
      ],
      "helpText": "番号でも回答できます。画像付き設問の表示確認用です。",
      "meta": {
        "research_goal": "犬コンセプト画像へのAI深掘りを確認する",
        "question_goal": "画像への反応と理由を取得する",
        "probe_goal": "抽象的な反応からどの部分がなぜそう感じたかを聞く",
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
        "coreInfoPrompt": "どの部分が気になったか、なぜそう感じたかを教えてください",
        "answerExample": "活発そうで一緒に動きたいと思いました。週末に公園で走り回れそうなイメージが湧きました",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '画像への反応が抽象的な場合は、気になった犬の特徴と理由を確認する。',
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
  -- Q12: image_upload（愛犬の写真・任意）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q12',
    '画像アップロード設問の確認です。愛犬や気になる犬の写真があれば送ってください。ない場合は「画像なし」と入力してください。',
    'main',
    'image_upload',
    false,
    16,
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
  ),
  -- Q13: hidden_single（テスト用）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q13',
    'hidden_singleの確認です。テスト値として「A」または「B」を入力してください。',
    'main',
    'hidden_single',
    false,
    17,
    null,
    '{
      "options": [
        { "value": "A", "label": "テストA" },
        { "value": "B", "label": "テストB" }
      ],
      "default_value": "A",
      "helpText": "hidden系の保存確認用。通常運用では非表示想定です。"
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
    now(),
    now()
  ),
  -- Q14: hidden_multi（テスト用）
  (
    '00000000-0000-4000-8000-0000000000b3',
    'Q14',
    'hidden_multiの確認です。テスト値として「A,B」のように入力してください。',
    'main',
    'hidden_multi',
    false,
    18,
    null,
    '{
      "options": [
        { "value": "A", "label": "テストA" },
        { "value": "B", "label": "テストB" },
        { "value": "C", "label": "テストC" }
      ],
      "default_values": ["A", "B"],
      "helpText": "hidden系の保存確認用。通常運用では非表示想定です。"
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
    now(),
    now()
  ),
  -- __free_comment__（システム設問・非表示）
  (
    '00000000-0000-4000-8000-0000000000b3',
    '__free_comment__',
    '最後に、ここまでで話しきれなかったことがあれば自由に教えてください。',
    'free_comment',
    'free_text_long',
    true,
    19,
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
    true,
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
--     'YOUR_LINE_USER_ID', '犬調査テストユーザー',
--     '00000000-0000-4000-8000-0000000000b3', 'invited', 0
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
--   '00000000-0000-4000-8000-0000000000b3', id, line_user_id,
--   'manual', 'assigned', now(), now() + interval '7 days', '[]'::jsonb
-- from target_respondent
-- on conflict (project_id, respondent_id) do update
-- set
--   user_id = excluded.user_id, assignment_type = excluded.assignment_type,
--   status = 'assigned', assigned_at = now(), deadline = excluded.deadline,
--   sent_at = null, opened_at = null, started_at = null, completed_at = null,
--   expired_at = null, reminder_sent_at = null, last_delivery_error = null;
