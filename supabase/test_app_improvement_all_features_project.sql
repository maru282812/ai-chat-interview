-- ============================================================
-- Test project: current app improvement + screening + AI probe + all answer types
--
-- Purpose:
-- - Create a dedicated project for testing screening pass/fail.
-- - Exercise AI probing on vague free-text answers.
-- - Cover every current question_type:
--   single_choice, multi_choice, matrix_single, matrix_multi, matrix_mixed,
--   free_text_short, free_text_long, numeric, image_upload, hidden_single,
--   hidden_multi, text_with_image, sd.
--
-- Project ID:
--   00000000-0000-4000-8000-0000000000c1
--
-- Assignment IDs:
--   pass:             00000000-0000-4000-8000-00000000ca01
--   fail by role:     00000000-0000-4000-8000-00000000ca02
--   fail by usage:    00000000-0000-4000-8000-00000000ca03
-- ============================================================

begin;

delete from point_transactions
where project_id = '00000000-0000-4000-8000-0000000000c1';

delete from project_assignments
where project_id = '00000000-0000-4000-8000-0000000000c1';

delete from project_analysis_reports
where project_id = '00000000-0000-4000-8000-0000000000c1';

delete from respondents
where project_id = '00000000-0000-4000-8000-0000000000c1';

delete from screening_conditions
where project_id = '00000000-0000-4000-8000-0000000000c1';

delete from questions
where project_id = '00000000-0000-4000-8000-0000000000c1';

delete from projects
where id = '00000000-0000-4000-8000-0000000000c1';

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
  '00000000-0000-4000-8000-0000000000c1',
  'テスト用: 現状のアプリ改善 全機能確認',
  'Internal Test',
  '現状のアプリ改善をテーマに、スクリーニング、AI深掘り、分岐、全回答形式の入力・保存・表示を確認する。',
  'published',
  10,
  'survey_with_interview_probe',
  'interview_chat',
  '[
    "現状のアプリ改善テーマで全回答形式の入力と保存を確認する",
    "スクリーニング通過・非通過の制御を確認する",
    "短文・抽象回答に対するAI深掘りを確認する"
  ]'::jsonb,
  '[
    "選択式・数値式の分岐を確認する",
    "matrix系と画像系はLINEテキストフォールバックも確認する",
    "hidden系の保存互換性を確認する"
  ]'::jsonb,
  '[
    "回答者はアプリの改善対象を知っている利用者または関係者として回答する",
    "感想だけでなく、発生場面・困った理由・期待する改善を具体化する"
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
    "target_question_codes": ["Q3_ROLE_REASON", "Q5_PAIN_DETAIL", "Q8_LOW_REASON", "Q8_HIGH_REASON", "Q10_IMAGE_REACTION", "__free_comment__"],
    "blocked_question_codes": ["S1_ROLE", "S2_USAGE", "Q1_PRIORITY", "Q2_USED_AREAS", "Q4_MATRIX_SINGLE", "Q6_MATRIX_MULTI", "Q7_MATRIX_MIXED", "Q8_SCORE", "Q9_SD", "Q11_IMAGE_UPLOAD", "Q12_HIDDEN_SINGLE", "Q13_HIDDEN_MULTI"],
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
    "pass_message": "スクリーニングを通過しました。続けてアプリ改善に関する質問へお進みください。",
    "fail_message": "ご回答ありがとうございます。今回は対象条件と合わないため、ここで終了となります。"
  }'::jsonb,
  2,
  'app_improvement_all_features',
  now(),
  '{
    "version": "v1",
    "template_key": "app_improvement_all_features",
    "project_goal": "現状のアプリについて、利用者や運用者が感じる改善点、つまずき、優先度を全回答形式で収集し、AI深掘りの挙動を確認する。",
    "user_understanding_goal": "誰が、どの場面で、どの機能に困り、どんな改善を期待しているかを具体的に理解する。",
    "required_slots": [
      { "key": "role", "label": "回答者の関わり方", "required": true },
      { "key": "pain_point", "label": "困りごと", "required": true },
      { "key": "improvement_reason", "label": "改善理由", "required": true }
    ],
    "optional_slots": [
      { "key": "desired_feature", "label": "欲しい改善", "required": false },
      { "key": "priority", "label": "優先度", "required": false }
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
    '00000000-0000-4000-8000-0000000000c1',
    'question',
    'S1_ROLE',
    'in',
    '["product_manager", "operator", "researcher", "engineer"]'::jsonb,
    10
  ),
  (
    '00000000-0000-4000-8000-0000000000c1',
    'question',
    'S2_USAGE',
    'in',
    '["daily", "weekly", "monthly"]'::jsonb,
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
    '00000000-0000-4000-8000-0000000000c1',
    'S1_ROLE',
    'このアプリとの関わり方に最も近いものを選んでください。',
    'screening',
    'single_choice',
    true,
    1,
    null,
    '{
      "options": [
        { "value": "product_manager", "label": "改善方針や要件を考える立場", "isScreeningPass": true },
        { "value": "operator", "label": "管理画面や配信運用を行う立場", "isScreeningPass": true },
        { "value": "researcher", "label": "調査設計や回答分析を行う立場", "isScreeningPass": true },
        { "value": "engineer", "label": "開発・検証を行う立場", "isScreeningPass": true },
        { "value": "not_involved", "label": "現状このアプリには関わっていない", "isScreeningPass": false }
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
    '00000000-0000-4000-8000-0000000000c1',
    'S2_USAGE',
    '直近30日で、このアプリや検証環境をどれくらい触りましたか。',
    'screening',
    'single_choice',
    true,
    2,
    null,
    '{
      "options": [
        { "value": "daily", "label": "ほぼ毎日", "isScreeningPass": true },
        { "value": "weekly", "label": "週に1回以上", "isScreeningPass": true },
        { "value": "monthly", "label": "月に数回", "isScreeningPass": true },
        { "value": "not_used", "label": "直近30日は触っていない", "isScreeningPass": false }
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
    '00000000-0000-4000-8000-0000000000c1',
    'Q1_PRIORITY',
    '現状のアプリで、最も優先して改善したい領域を1つ選んでください。',
    'main',
    'single_choice',
    true,
    3,
    '{
      "default_next": "Q3_ROLE_REASON",
      "branches": [
        { "field": "value", "when": { "equals": "admin_ui" }, "next": "Q3_ROLE_REASON" },
        { "field": "value", "when": { "equals": "ai_answer" }, "next": "Q3_ROLE_REASON" },
        { "field": "value", "when": { "equals": "screening" }, "next": "Q3_ROLE_REASON" }
      ]
    }'::jsonb,
    '{
      "options": [
        { "value": "admin_ui", "label": "管理画面の設問作成・編集" },
        { "value": "liff_flow", "label": "回答者側のLIFF/LINE回答体験" },
        { "value": "ai_answer", "label": "AI深掘り・AI回答制御" },
        { "value": "screening", "label": "スクリーニング判定" },
        { "value": "reporting", "label": "集計・CSV・分析レポート" }
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
    '00000000-0000-4000-8000-0000000000c1',
    'Q2_USED_AREAS',
    '直近で触ったことがある機能をすべて選んでください。',
    'main',
    'multi_choice',
    true,
    4,
    null,
    '{
      "min_select": 1,
      "max_select": 6,
      "options": [
        { "value": "project_settings", "label": "プロジェクト基本設定" },
        { "value": "question_editor", "label": "設問エディタ" },
        { "value": "flow_canvas", "label": "フロー設計" },
        { "value": "liff_answer", "label": "LIFF回答画面" },
        { "value": "ai_probe", "label": "AI深掘り" },
        { "value": "exports", "label": "CSV/集計出力" }
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
    '00000000-0000-4000-8000-0000000000c1',
    'Q3_ROLE_REASON',
    'その領域を優先して改善したい理由を、発生場面がわかるように短く教えてください。',
    'main',
    'free_text_short',
    true,
    5,
    null,
    '{
      "max_length": 160,
      "placeholder": "例: 設問タイプを切り替えた時に設定項目の意味が迷いやすく、確認に時間がかかるためです。",
      "helpText": "短文でも入力できます。曖昧な回答ではAI深掘りを確認します。",
      "meta": {
        "research_goal": "改善優先度の理由を把握する",
        "required_slots": ["improvement_reason", "usage_scene"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "特になし", "note": "no_content" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" },
          { "type": "contains", "value": "普通", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "force_probe_on_bad": true, "strict_topic_lock": true }
      }
    }'::jsonb,
    true,
    '理由が抽象的な場合は、どの画面・操作・判断で困ったかを1点だけ確認する。',
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
    '00000000-0000-4000-8000-0000000000c1',
    'Q4_MATRIX_SINGLE',
    '次の項目について、現状の満足度を1から5で評価してください。入力例: 設問作成=3, 分岐設定=2, プレビュー=4',
    'main',
    'matrix_single',
    true,
    6,
    null,
    '{
      "matrix_rows": [
        { "value": "question_creation", "label": "設問作成" },
        { "value": "branch_setting", "label": "分岐設定" },
        { "value": "preview", "label": "プレビュー" }
      ],
      "matrix_cols": [
        { "value": "1", "label": "1: 不満" },
        { "value": "2", "label": "2" },
        { "value": "3", "label": "3" },
        { "value": "4", "label": "4" },
        { "value": "5", "label": "5: 満足" }
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
    '00000000-0000-4000-8000-0000000000c1',
    'Q5_PAIN_DETAIL',
    '特に困ったことを、いつ・どの画面で・何が起きたかがわかるように教えてください。',
    'main',
    'free_text_long',
    true,
    7,
    null,
    '{
      "placeholder": "例: 管理画面で回答形式を変更した後、選択肢の通過対象チェックが残っているのか判断しづらく、保存前に何度もプレビュー確認しました。",
      "helpText": "「特になし」だけでも入力できますが、AI深掘り確認用に追加質問が出る想定です。",
      "meta": {
        "research_goal": "具体的なつまずきと原因を把握する",
        "required_slots": ["pain_point", "usage_scene", "reason"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "特になし", "note": "no_content" },
          { "type": "exact", "value": "なし", "note": "no_content" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "force_probe_on_bad": true, "strict_topic_lock": true }
      }
    }'::jsonb,
    true,
    '短文や抽象回答では、場面、画面、困った理由のうち不足している1点を確認する。',
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
    '00000000-0000-4000-8000-0000000000c1',
    'Q6_MATRIX_MULTI',
    '各画面で欲しい支援を選んでください。入力例: 管理画面=入力補助,プレビュー / LIFF=エラー表示',
    'main',
    'matrix_multi',
    true,
    8,
    null,
    '{
      "matrix_rows": [
        { "value": "admin", "label": "管理画面" },
        { "value": "liff", "label": "LIFF回答画面" },
        { "value": "analysis", "label": "分析画面" }
      ],
      "matrix_cols": [
        { "value": "input_help", "label": "入力補助" },
        { "value": "preview", "label": "プレビュー" },
        { "value": "error_message", "label": "エラー表示" },
        { "value": "ai_suggestion", "label": "AI候補" }
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
    '00000000-0000-4000-8000-0000000000c1',
    'Q7_MATRIX_MIXED',
    '改善案ごとに期待度と補足を入力してください。入力例: AI深掘り制御=高 / 理由=意図しない質問を減らしたい',
    'main',
    'matrix_mixed',
    true,
    9,
    null,
    '{
      "matrix_rows": [
        { "value": "ai_probe_control", "label": "AI深掘り制御", "answer_type": "single_choice" },
        { "value": "screening_debug", "label": "スクリーニング判定ログ", "answer_type": "single_choice" },
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
    '00000000-0000-4000-8000-0000000000c1',
    'Q8_SCORE',
    '現状のアプリ改善優先度を1から5の数字で教えてください。',
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
    '00000000-0000-4000-8000-0000000000c1',
    'Q8_LOW_REASON',
    '優先度が低い理由を短く教えてください。',
    'main',
    'free_text_short',
    false,
    11,
    '{ "default_next": "Q9_SD" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: 先に検証したい業務課題が別にあり、現状の操作でも回避できているためです。",
      "meta": {
        "research_goal": "低優先度の理由を把握する",
        "bad_answer_patterns": [{ "type": "contains", "value": "なんとなく", "note": "abstract" }],
        "probe_config": { "max_probes": 1, "force_probe_on_bad": true }
      }
    }'::jsonb,
    true,
    '抽象的な場合は、代替手段や今困っていない理由を確認する。',
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
    '00000000-0000-4000-8000-0000000000c1',
    'Q8_HIGH_REASON',
    '優先度が高い理由を短く教えてください。',
    'main',
    'free_text_short',
    false,
    12,
    '{ "default_next": "Q9_SD" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: 設問設計のたびに確認コストが高く、案件作成のリードタイムに影響しているためです。",
      "meta": {
        "research_goal": "高優先度の理由を把握する",
        "bad_answer_patterns": [{ "type": "contains", "value": "なんとなく", "note": "abstract" }],
        "probe_config": { "max_probes": 1, "force_probe_on_bad": true }
      }
    }'::jsonb,
    true,
    '抽象的な場合は、影響している業務・画面・頻度のどれかを確認する。',
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
    '00000000-0000-4000-8000-0000000000c1',
    'Q9_SD',
    'このアプリの改善方針について、左が「自由度重視」、右が「迷わない標準化重視」として1から5で選んでください。',
    'main',
    'sd',
    true,
    13,
    null,
    '{
      "options": [
        { "value": "1", "label": "自由度重視" },
        { "value": "2", "label": "やや自由度重視" },
        { "value": "3", "label": "どちらともいえない" },
        { "value": "4", "label": "やや標準化重視" },
        { "value": "5", "label": "迷わない標準化重視" }
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
    '00000000-0000-4000-8000-0000000000c1',
    'Q10_IMAGE_REACTION',
    '画面イメージを見た前提で、改善したい点に最も近いものを選び、理由も短く教えてください。',
    'main',
    'text_with_image',
    true,
    14,
    null,
    '{
      "question_text_image": {
        "url": "https://example.com/test-assets/app-improvement-screen.png",
        "alt": "アプリ改善テスト用の画面イメージ",
        "caption": "テスト用URLです。実画像に差し替えて表示確認できます。"
      },
      "options": [
        { "value": "layout", "label": "レイアウトを整理したい" },
        { "value": "wording", "label": "文言をわかりやすくしたい" },
        { "value": "state", "label": "保存状態やエラー状態を見やすくしたい" },
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
    '抽象的な反応では、画面のどの部分が理由かを確認する。',
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
    '00000000-0000-4000-8000-0000000000c1',
    'Q11_IMAGE_UPLOAD',
    '改善メモやスクリーンショットがあれば送ってください。ない場合は「画像なし」と入力してください。',
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
    '00000000-0000-4000-8000-0000000000c1',
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
    '00000000-0000-4000-8000-0000000000c1',
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
    '00000000-0000-4000-8000-0000000000c1',
    '__free_comment__',
    '最後に、ここまでで聞けていないアプリ改善案があれば自由に教えてください。',
    'free_comment',
    'free_text_long',
    false,
    18,
    null,
    '{
      "placeholder": "自由に入力してください。",
      "meta": {
        "research_goal": "補足の改善案を回収する",
        "bad_answer_patterns": [
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 1, "force_probe_on_bad": false, "strict_topic_lock": true }
      }
    }'::jsonb,
    true,
    '改善案が抽象的な場合のみ、どの画面・操作に関する話かを確認する。',
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
    'line_test_app_improve_pass',
    'アプリ改善テスト_通過',
    '1990-01-01',
    'female',
    '東京都',
    now(),
    'プロダクト担当',
    now(),
    'IT',
    'single',
    false,
    '{}',
    '{一人暮らし}',
    true,
    now(),
    true,
    '{app_improvement,screening_pass}',
    '現状アプリを頻繁に触る改善担当。全回答形式の通過確認用。',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'line_test_app_improve_fail_role',
    'アプリ改善テスト_非関与',
    '1988-04-01',
    'male',
    '東京都',
    now(),
    '会社員',
    now(),
    'サービス',
    'married',
    false,
    '{}',
    '{夫婦}',
    true,
    now(),
    true,
    '{app_improvement,screening_fail_role}',
    'S1で非関与を選ぶ想定のスクリーニング失敗確認用。',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'line_test_app_improve_fail_usage',
    'アプリ改善テスト_未利用',
    '1995-08-01',
    'other',
    '神奈川県',
    now(),
    '調査担当',
    now(),
    'リサーチ',
    'single',
    false,
    '{}',
    '{一人暮らし}',
    true,
    now(),
    true,
    '{app_improvement,screening_fail_usage}',
    'S1は通過、S2で直近未利用を選ぶ想定のスクリーニング失敗確認用。',
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
    '00000000-0000-4000-8000-00000000c201',
    'line_test_app_improve_pass',
    'アプリ改善テスト_通過',
    '00000000-0000-4000-8000-0000000000c1',
    'invited',
    0,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000c202',
    'line_test_app_improve_fail_role',
    'アプリ改善テスト_非関与',
    '00000000-0000-4000-8000-0000000000c1',
    'invited',
    0,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000c203',
    'line_test_app_improve_fail_usage',
    'アプリ改善テスト_未利用',
    '00000000-0000-4000-8000-0000000000c1',
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
    '00000000-0000-4000-8000-00000000ca01',
    '00000000-0000-4000-8000-0000000000c1',
    '00000000-0000-4000-8000-00000000c201',
    'manual',
    'assigned',
    'line_test_app_improve_pass',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "app_improvement_all_features", "expected": "pass if S1 is involved and S2 is used recently"}'::jsonb,
    'liff',
    '[]'::jsonb,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000ca02',
    '00000000-0000-4000-8000-0000000000c1',
    '00000000-0000-4000-8000-00000000c202',
    'manual',
    'assigned',
    'line_test_app_improve_fail_role',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "app_improvement_all_features", "expected": "fail if S1=not_involved"}'::jsonb,
    'liff',
    '[]'::jsonb,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000ca03',
    '00000000-0000-4000-8000-0000000000c1',
    '00000000-0000-4000-8000-00000000c203',
    'manual',
    'assigned',
    'line_test_app_improve_fail_usage',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "app_improvement_all_features", "expected": "fail if S2=not_used"}'::jsonb,
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
