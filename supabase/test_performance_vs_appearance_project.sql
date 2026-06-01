-- ============================================================
-- Test project: performance vs appearance preference + screening + AI probe + answer types except hidden
--
-- Purpose:
-- - Create a dedicated project for testing screening pass/fail.
-- - Exercise AI probing on vague free-text answers.
-- - Cover current question_type values except hidden types:
--   single_choice, multi_choice, matrix_single, matrix_multi, matrix_mixed,
--   free_text_short, free_text_long, numeric, image_upload,
--   text_with_image, sd.
--
-- Project ID:
--   00000000-0000-4000-8000-0000000000c4
--
-- Assignment IDs:
--   pass:                 00000000-0000-4000-8000-00000000cd01
--   fail by interest:     00000000-0000-4000-8000-00000000cd02
--   fail by frequency:    00000000-0000-4000-8000-00000000cd03
-- ============================================================

begin;

delete from point_transactions
where project_id = '00000000-0000-4000-8000-0000000000c4';

delete from project_assignments
where project_id = '00000000-0000-4000-8000-0000000000c4';

delete from project_analysis_reports
where project_id = '00000000-0000-4000-8000-0000000000c4';

delete from respondents
where project_id = '00000000-0000-4000-8000-0000000000c4';

delete from screening_conditions
where project_id = '00000000-0000-4000-8000-0000000000c4';

delete from questions
where project_id = '00000000-0000-4000-8000-0000000000c4';

delete from projects
where id = '00000000-0000-4000-8000-0000000000c4';

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
  '00000000-0000-4000-8000-0000000000c4',
  'テスト用: 性能と見た目の重視度調査 回答形式確認',
  'Internal Test',
  '性能と見た目のどちらを重視するかをテーマに、スクリーニング、AI深掘り、分岐、隠し項目を除く回答形式の入力・保存・表示を確認する。',
  'published',
  10,
  'survey_with_interview_probe',
  'interview_chat',
  '[
    "性能と見た目の重視度テーマで隠し項目を除く回答形式の入力と保存を確認する",
    "スクリーニング通過・非通過の制御を確認する",
    "短文・抽象回答に対するAI深掘りを確認する"
  ]'::jsonb,
  '[
    "選択式・数値式の分岐を確認する",
    "matrix系と画像系はLINEテキストフォールバックも確認する"
  ]'::jsonb,
  '[
    "回答者は製品やサービスを選ぶ・使う立場として回答する",
    "感想だけでなく、利用場面・重視理由・妥協できる条件を具体化する"
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
    "target_question_codes": ["Q3_PRIORITY_REASON", "Q5_DECISION_DETAIL", "Q8_LOW_REASON", "Q8_HIGH_REASON", "Q10_DESIGN_REACTION", "__free_comment__"],
    "blocked_question_codes": ["S1_PURCHASE_INTEREST", "S2_SELECTION_FREQUENCY", "Q1_PRIORITY", "Q2_USED_AREAS", "Q4_MATRIX_SINGLE", "Q6_MATRIX_MULTI", "Q7_MATRIX_MIXED", "Q8_SCORE", "Q9_SD", "Q11_IMAGE_UPLOAD"],
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
    "pass_message": "スクリーニングを通過しました。続けて性能と見た目に関する質問へお進みください。",
    "fail_message": "ご回答ありがとうございます。今回は対象条件と合わないため、ここで終了となります。"
  }'::jsonb,
  2,
  'performance_vs_appearance',
  now(),
  '{
    "version": "v1",
    "template_key": "performance_vs_appearance",
    "project_goal": "製品やサービスを選ぶときに性能と見た目のどちらを重視するか、判断場面、理由、許容できる妥協点を隠し項目を除く回答形式で収集し、AI深掘りの挙動を確認する。",
    "user_understanding_goal": "回答者がどの場面で性能または見た目を優先し、その理由や妥協できる条件を具体的に理解する。",
    "required_slots": [
      { "key": "role", "label": "回答者の利用場面", "required": true },
      { "key": "pain_point", "label": "重視ポイント", "required": true },
      { "key": "improvement_reason", "label": "判断理由", "required": true }
    ],
    "optional_slots": [
      { "key": "desired_feature", "label": "妥協できる条件", "required": false },
      { "key": "priority", "label": "重視度", "required": false }
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
    '00000000-0000-4000-8000-0000000000c4',
    'question',
    'S1_PURCHASE_INTEREST',
    'in',
    '["performance_first", "appearance_first", "balanced", "depends_on_context"]'::jsonb,
    10
  ),
  (
    '00000000-0000-4000-8000-0000000000c4',
    'question',
    'S2_SELECTION_FREQUENCY',
    'in',
    '["within_1_month", "within_3_months", "within_6_months"]'::jsonb,
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
    '00000000-0000-4000-8000-0000000000c4',
    'S1_PURCHASE_INTEREST',
    '製品やサービスを選ぶときの関心に最も近いものを選んでください。',
    'screening',
    'single_choice',
    true,
    1,
    null,
    '{
      "options": [
        { "value": "performance_first", "label": "性能を重視して選ぶことが多い", "isScreeningPass": true },
        { "value": "appearance_first", "label": "見た目を重視して選ぶことが多い", "isScreeningPass": true },
        { "value": "balanced", "label": "性能と見た目のバランスを重視する", "isScreeningPass": true },
        { "value": "depends_on_context", "label": "用途によって重視点が変わる", "isScreeningPass": true },
        { "value": "not_involved", "label": "このテーマにはあまり関心がない", "isScreeningPass": false }
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
    '00000000-0000-4000-8000-0000000000c4',
    'S2_SELECTION_FREQUENCY',
    '直近半年で、製品やサービスを比較・選定した頻度に最も近いものを選んでください。',
    'screening',
    'single_choice',
    true,
    2,
    null,
    '{
      "options": [
        { "value": "within_1_month", "label": "1か月以内に選んだ・比較した", "isScreeningPass": true },
        { "value": "within_3_months", "label": "3か月以内に選んだ・比較した", "isScreeningPass": true },
        { "value": "within_6_months", "label": "半年以内に選んだ・比較した", "isScreeningPass": true },
        { "value": "not_used", "label": "半年以内には選定していない", "isScreeningPass": false }
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
    '00000000-0000-4000-8000-0000000000c4',
    'Q1_PRIORITY',
    '製品やサービスを選ぶとき、最も重視しやすい要素を1つ選んでください。',
    'main',
    'single_choice',
    true,
    3,
    '{
      "default_next": "Q3_PRIORITY_REASON",
      "branches": [
        { "field": "value", "when": { "equals": "admin_ui" }, "next": "Q3_PRIORITY_REASON" },
        { "field": "value", "when": { "equals": "ai_answer" }, "next": "Q3_PRIORITY_REASON" },
        { "field": "value", "when": { "equals": "screening" }, "next": "Q3_PRIORITY_REASON" }
      ]
    }'::jsonb,
    '{
      "options": [
        { "value": "admin_ui", "label": "動作の速さ・反応のよさ" },
        { "value": "liff_flow", "label": "画面や外観の美しさ" },
        { "value": "ai_answer", "label": "使いやすさ・迷わなさ" },
        { "value": "screening", "label": "信頼性・壊れにくさ" },
        { "value": "reporting", "label": "価格やコストとのバランス" }
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
    '00000000-0000-4000-8000-0000000000c4',
    'Q2_USED_AREAS',
    '性能や見た目を意識して比較したことがある対象をすべて選んでください。',
    'main',
    'multi_choice',
    true,
    4,
    null,
    '{
      "min_select": 1,
      "max_select": 6,
      "options": [
        { "value": "project_settings", "label": "スマホアプリ" },
        { "value": "question_editor", "label": "Webサービス" },
        { "value": "flow_canvas", "label": "家電・ガジェット" },
        { "value": "liff_answer", "label": "日用品・生活用品" },
        { "value": "ai_probe", "label": "店舗・施設" },
        { "value": "exports", "label": "業務ツール" }
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
    '00000000-0000-4000-8000-0000000000c4',
    'Q3_PRIORITY_REASON',
    'その要素を重視する理由を、選ぶ場面がわかるように短く教えてください。',
    'main',
    'free_text_short',
    true,
    5,
    null,
    '{
      "max_length": 160,
      "placeholder": "例: 毎日使うものは反応が遅いとストレスが大きいので、見た目より性能を優先します。",
      "helpText": "短文でも入力できます。曖昧な回答ではAI深掘りを確認します。",
      "meta": {
        "research_goal": "性能と見た目の重視理由を把握する",
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
    '理由が抽象的な場合は、どの製品・利用場面でそう感じたかを1点だけ確認する。',
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
    '00000000-0000-4000-8000-0000000000c4',
    'Q4_MATRIX_SINGLE',
    '次の項目について、現状の満足度を1から5で評価してください。入力例: 設問作成=3, 分岐設定=2, デザイン=4',
    'main',
    'matrix_single',
    true,
    6,
    null,
    '{
      "matrix_rows": [
        { "value": "question_creation", "label": "設問作成" },
        { "value": "branch_setting", "label": "分岐設定" },
        { "value": "preview", "label": "デザイン" }
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
    '00000000-0000-4000-8000-0000000000c4',
    'Q5_DECISION_DETAIL',
    '性能と見た目のどちらを優先するか迷った経験を、場面がわかるように教えてください。',
    'main',
    'free_text_long',
    true,
    7,
    null,
    '{
      "placeholder": "例: スマホで回答形式を変更した後、選択肢の通過対象チェックが残っているのか判断しづらく、保存前に何度もデザイン確認しました。",
      "helpText": "「特になし」だけでも入力できますが、AI深掘り確認用に追加質問が出る想定です。",
      "meta": {
        "research_goal": "優先判断の具体場面と理由を把握する",
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
    '短文や抽象回答では、場面、対象、迷った理由のうち不足している1点を確認する。',
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
    '00000000-0000-4000-8000-0000000000c4',
    'Q6_MATRIX_MULTI',
    '対象ごとに重視したい要素を選んでください。入力例: スマホ=動作速度,デザイン / 家電=耐久性',
    'main',
    'matrix_multi',
    true,
    8,
    null,
    '{
      "matrix_rows": [
        { "value": "admin", "label": "スマホ" },
        { "value": "liff", "label": "日用品・生活用品" },
        { "value": "analysis", "label": "家電" }
      ],
      "matrix_cols": [
        { "value": "input_help", "label": "動作速度" },
        { "value": "preview", "label": "デザイン" },
        { "value": "error_message", "label": "耐久性" },
        { "value": "ai_suggestion", "label": "価格" }
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
    '00000000-0000-4000-8000-0000000000c4',
    'Q7_MATRIX_MIXED',
    '改善案ごとに期待度と補足を入力してください。入力例: 速度・反応=高 / 理由=意図しない質問を減らしたい',
    'main',
    'matrix_mixed',
    true,
    9,
    null,
    '{
      "matrix_rows": [
        { "value": "ai_probe_control", "label": "速度・反応", "answer_type": "single_choice" },
        { "value": "screening_debug", "label": "外観・質感", "answer_type": "single_choice" },
        { "value": "free_note", "label": "理由", "answer_type": "free_text_short" }
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
    '00000000-0000-4000-8000-0000000000c4',
    'Q8_SCORE',
    '性能をどれくらい重視するか、1から5の数字で教えてください。',
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
    '00000000-0000-4000-8000-0000000000c4',
    'Q8_LOW_REASON',
    '重視度が低い理由を短く教えてください。',
    'main',
    'free_text_short',
    false,
    11,
    '{ "default_next": "Q9_SD" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: 見た目や持った時の印象で満足度が大きく変わる商品を選ぶことが多いためです。",
      "meta": {
        "research_goal": "低重視度の理由を把握する",
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
    '00000000-0000-4000-8000-0000000000c4',
    'Q8_HIGH_REASON',
    '重視度が高い理由を短く教えてください。',
    'main',
    'free_text_short',
    false,
    12,
    '{ "default_next": "Q9_SD" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: 毎日使うものは少しの遅さでもストレスになるため、見た目より性能を優先します。",
      "meta": {
        "research_goal": "高重視度の理由を把握する",
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
    '00000000-0000-4000-8000-0000000000c4',
    'Q9_SD',
    '性能と見た目について、左が「性能重視」、右が「見た目重視」として1から5で選んでください。',
    'main',
    'sd',
    true,
    13,
    null,
    '{
      "options": [
        { "value": "1", "label": "性能重視" },
        { "value": "2", "label": "やや性能重視" },
        { "value": "3", "label": "どちらともいえない" },
        { "value": "4", "label": "やや見た目重視" },
        { "value": "5", "label": "見た目重視" }
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
    '00000000-0000-4000-8000-0000000000c4',
    'Q10_DESIGN_REACTION',
    '製品イメージを見た前提で、選ぶ時に気になる点に最も近いものを選び、理由も短く教えてください。',
    'main',
    'text_with_image',
    true,
    14,
    null,
    '{
      "question_text_image": {
        "url": "https://example.com/test-assets/performance-vs-appearance-sample.png",
        "alt": "性能と見た目テスト用の製品イメージ",
        "caption": "テスト用URLです。実画像に差し替えて表示確認できます。"
      },
      "options": [
        { "value": "layout", "label": "動作が速そうか" },
        { "value": "wording", "label": "見た目が好みに合うか" },
        { "value": "state", "label": "長く使っても飽きなさそうか" },
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
    '抽象的な反応では、見た目や印象のどの部分が理由かを確認する。',
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
    '00000000-0000-4000-8000-0000000000c4',
    'Q11_IMAGE_UPLOAD',
    '性能や見た目の判断に関係する画像やメモがあれば送ってください。ない場合は「画像なし」と入力してください。',
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
    '00000000-0000-4000-8000-0000000000c4',
    '__free_comment__',
    '最後に、性能と見た目の重視度について補足があれば自由に教えてください。',
    'free_comment',
    'free_text_long',
    false,
    16,
    null,
    '{
      "placeholder": "自由に入力してください。",
      "meta": {
        "research_goal": "補足の判断理由を回収する",
        "bad_answer_patterns": [
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 1, "force_probe_on_bad": false, "strict_topic_lock": true }
      }
    }'::jsonb,
    true,
    '補足が抽象的な場合のみ、どの製品や利用場面に関する話かを確認する。',
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
    'line_test_perf_visual_pass',
    '性能見た目テスト_通過',
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
    '{performance_vs_appearance,screening_pass}',
    '性能と見た目の比較に関心がある回答者。隠し項目を除く回答形式の通過確認用。',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'line_test_perf_visual_fail_interest',
    '性能見た目テスト_関心なし',
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
    '{performance_vs_appearance,screening_fail_interest}',
    'S1で関心なしを選ぶ想定のスクリーニング失敗確認用。',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'line_test_perf_visual_fail_usage',
    '性能見た目テスト_利用頻度外',
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
    '{performance_vs_appearance,screening_fail_frequency}',
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
    '00000000-0000-4000-8000-00000000e401',
    'line_test_perf_visual_pass',
    '性能見た目テスト_通過',
    '00000000-0000-4000-8000-0000000000c4',
    'invited',
    0,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000e402',
    'line_test_perf_visual_fail_interest',
    '性能見た目テスト_関心なし',
    '00000000-0000-4000-8000-0000000000c4',
    'invited',
    0,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000e403',
    'line_test_perf_visual_fail_usage',
    '性能見た目テスト_利用頻度外',
    '00000000-0000-4000-8000-0000000000c4',
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
    '00000000-0000-4000-8000-00000000cd01',
    '00000000-0000-4000-8000-0000000000c4',
    '00000000-0000-4000-8000-00000000e401',
    'manual',
    'assigned',
    'line_test_perf_visual_pass',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "performance_vs_appearance", "expected": "pass if S1 has interest and S2 has recent selection experience"}'::jsonb,
    'liff',
    '[]'::jsonb,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000cd02',
    '00000000-0000-4000-8000-0000000000c4',
    '00000000-0000-4000-8000-00000000e402',
    'manual',
    'assigned',
    'line_test_perf_visual_fail_interest',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "performance_vs_appearance", "expected": "fail if S1=no_interest"}'::jsonb,
    'liff',
    '[]'::jsonb,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000cd03',
    '00000000-0000-4000-8000-0000000000c4',
    '00000000-0000-4000-8000-00000000e403',
    'manual',
    'assigned',
    'line_test_perf_visual_fail_usage',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "performance_vs_appearance", "expected": "fail if S2=not_used"}'::jsonb,
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
