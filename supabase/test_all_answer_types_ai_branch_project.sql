-- ============================================================
-- Test project: all answer types + AI probe + branching
--
-- Purpose:
-- - Cover every question_type allowed after migration 021.
-- - Exercise AI probe on low-information / vague free-text answers.
-- - Exercise branch_rule for single_choice, multi_choice, and numeric answers.
--
-- Recommended checks:
-- - Q1 = "prepared" should go to Q2_PREPARED, then merge into Q3.
-- - Q1 = "unprepared" should go to Q2_UNPREPARED, then merge into Q3.
-- - Q3 includes "habit" should go to Q6_HABIT, then merge into Q7.
-- - Q11 <= 2 should go to Q11_LOW; Q11 >= 4 should go to Q11_HIGH; both merge into Q12.
-- - Q2_*, Q6_HABIT, Q7, Q11_*, Q13 with "特になし", "普通", "なんとなく" should trigger AI probe.
-- ============================================================

begin;

-- Recreate this test project from scratch.
-- Delete child rows first because some tables reference projects with on delete set null.
delete from point_transactions
where project_id = '00000000-0000-4000-8000-0000000000b2';

delete from project_assignments
where project_id = '00000000-0000-4000-8000-0000000000b2';

delete from project_analysis_reports
where project_id = '00000000-0000-4000-8000-0000000000b2';

delete from respondents
where project_id = '00000000-0000-4000-8000-0000000000b2';

delete from questions
where project_id = '00000000-0000-4000-8000-0000000000b2';

delete from projects
where id = '00000000-0000-4000-8000-0000000000b2';

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
  '00000000-0000-4000-8000-0000000000b2',
  'テスト用調査（防災備蓄サービス・全回答形式確認）',
  'Internal Test',
  '防災備蓄・非常時サポートサービスを題材に、13種類の回答形式、AI深掘り、分岐動作を確認する。',
  'active',
  10,
  'interview',
  'interview_chat',
  '[
    "防災備蓄サービス調査として全question_typeの入力・保存・表示を確認する",
    "短い回答や曖昧回答に対するAI深掘りを複数設問で確認する",
    "備蓄状況・関心機能・利用意向による分岐を確認する"
  ]'::jsonb,
  '[
    "hidden系と画像系はLINEテキストフォールバックで確認する",
    "matrix系はテキスト回答フォールバックで確認する",
    "分岐後の理由質問でもAI深掘りが動くか確認する"
  ]'::jsonb,
  '[]'::jsonb,
  '[
    "テスト案件なので各回答形式の入力互換性を優先する",
    "AI深掘りでは理由、場面、具体例、購入・準備の障壁を1つずつ確認する",
    "分岐先の質問後は共通質問に戻す"
  ]'::jsonb,
  '{
    "enabled": true,
    "conditions": ["short_answer", "abstract_answer"],
    "max_probes_per_answer": 2,
    "max_probes_per_session": 6,
    "require_question_probe_enabled": true,
    "target_question_codes": ["Q2_PREPARED", "Q2_UNPREPARED", "Q2_OTHER", "Q6_HABIT", "Q7", "Q11_LOW", "Q11_HIGH", "Q13"],
    "blocked_question_codes": ["Q1", "Q3", "Q8", "Q9", "Q10", "Q11", "Q12", "Q14", "Q15", "Q16"],
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
    "project_goal": "防災備蓄サービス調査で全回答形式、分岐、AI深掘りの実行確認",
    "user_understanding_goal": "家庭の防災備蓄状況、不安、準備の障壁、サービスへの反応を多様な回答形式で取得する",
    "required_slots": [
      {
        "key": "usage_scene",
        "label": "備蓄場面",
        "required": true,
        "description": "どんなきっかけや生活場面で防災備蓄を考えるか",
        "examples": ["地震のニュースを見た後", "台風前", "引っ越し後"]
      },
      {
        "key": "pain_point",
        "label": "不安・障壁",
        "required": true,
        "description": "防災備蓄で不安なことや準備を妨げていること",
        "examples": ["何を買えばよいかわからない", "置き場所がない", "賞味期限管理が面倒"]
      },
      {
        "key": "reason",
        "label": "理由",
        "required": true,
        "description": "選択や評価の理由",
        "examples": ["期限管理を任せたい", "家族分を計算してほしい"]
      }
    ],
    "optional_slots": [
      {
        "key": "desired_feature",
        "label": "欲しい支援",
        "required": false,
        "examples": ["必要量の自動計算", "期限通知", "補充リスト"]
      }
    ],
    "question_categories": ["備蓄状況", "準備の障壁", "欲しい支援", "コンセプト評価"],
    "probe_policy": {
      "default_max_probes": 2,
      "force_probe_on_bad": true,
      "strict_topic_lock": true,
      "allow_followup_expansion": false
    },
    "completion_rule": {
      "required_slots_needed": ["usage_scene", "pain_point", "reason"],
      "allow_finish_without_optional": true,
      "min_required_slots_to_finish": 3
    },
    "language": "ja",
    "probe_guideline": "短答、抽象回答、特になし系の回答では、直近のきっかけ、不安、準備の障壁、欲しい支援を1つずつ聞いて具体化する。"
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q1',
    'ご家庭の防災備蓄の状態として、今いちばん近いものを選んでください。',
    'screening',
    'single_choice',
    true,
    1,
    '{
      "default_next": "Q2_OTHER",
      "branches": [
        { "field": "value", "when": { "equals": "prepared" }, "next": "Q2_PREPARED" },
        { "field": "value", "when": { "equals": "unprepared" }, "next": "Q2_UNPREPARED" }
      ]
    }'::jsonb,
    '{
      "options": [
        { "value": "prepared", "label": "ある程度そろえている" },
        { "value": "partial", "label": "少しだけ用意している" },
        { "value": "unprepared", "label": "ほとんど用意していない" },
        { "value": "other", "label": "わからない・その他" }
      ],
      "helpText": "番号でも回答できます",
      "meta": {
        "research_goal": "備蓄状況で分岐を確認する",
        "question_goal": "単一選択の入力とbranch_ruleを確認する",
        "probe_goal": "この質問では深掘りしない",
        "required_slots": ["preparedness_status"],
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q2_PREPARED',
    '今そろえている備蓄品の中で、特に役立ちそうだと思うものと理由を短く教えてください。',
    'main',
    'free_text_short',
    true,
    2,
    '{ "default_next": "Q3" }'::jsonb,
    '{
      "max_length": 120,
      "placeholder": "例: 水とレトルト食品です。停電してもすぐ食べられるからです",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "既に準備している人の重視品目と理由を把握する",
        "question_goal": "役立ちそうな備蓄品と理由を取得する",
        "probe_goal": "品目だけの回答から理由や利用場面を聞く",
        "required_slots": ["prepared_item", "reason"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "特になし", "note": "no_content" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "何を用意していて、なぜ役立ちそうだと思うかを教えてください",
        "answerExample": "水とレトルト食品です。停電してもすぐ食べられるからです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '品目だけの回答では、なぜそれを重視しているか、どんな場面で使う想定かを聞く。',
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q2_UNPREPARED',
    'まだ備蓄できていない理由や、準備しにくいと感じることを短く教えてください。',
    'main',
    'free_text_short',
    true,
    3,
    '{ "default_next": "Q3" }'::jsonb,
    '{
      "max_length": 120,
      "placeholder": "例: 何をどれだけ買えばよいかわからず、置き場所も足りないからです",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "未準備層の障壁を把握する",
        "question_goal": "準備できていない理由を取得する",
        "probe_goal": "抽象的な理由から具体的な障壁を聞く",
        "required_slots": ["barrier", "reason"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "わからない", "note": "no_content" },
          { "type": "contains", "value": "面倒", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "準備しにくい理由を、買うもの・量・置き場所・期限管理などのどれに近いか含めて教えてください",
        "answerExample": "何をどれだけ買えばよいかわからず、置き場所も足りないからです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '未準備の理由が曖昧な場合は、買うもの、量、置き場所、期限管理のどれが障壁か確認する。',
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q2_OTHER',
    '防災備蓄について、今の率直な状態や迷っていることを短く教えてください。',
    'main',
    'free_text_short',
    true,
    4,
    '{ "default_next": "Q3" }'::jsonb,
    '{
      "max_length": 120,
      "placeholder": "例: 少しは用意していますが、何が足りないか判断できていません",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "判断保留層の状態を把握する",
        "question_goal": "現状と迷いを取得する",
        "probe_goal": "不明点や判断できない理由を具体化する",
        "required_slots": ["current_status", "uncertainty"],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "今の状態と、何を迷っているかを教えてください",
        "answerExample": "少しは用意していますが、何が足りないか判断できていません",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '状態が曖昧な場合は、何を用意済みで何が判断できないかを確認する。',
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q3',
    '防災備蓄サービスに欲しい支援をすべて選んでください。',
    'main',
    'multi_choice',
    true,
    5,
    '{
      "default_next": "Q7",
      "branches": [
        { "field": "values", "when": { "includes": "habit" }, "next": "Q6_HABIT" }
      ]
    }'::jsonb,
    '{
      "min_select": 1,
      "max_select": 4,
      "options": [
        { "value": "checklist", "label": "必要品チェックリスト" },
        { "value": "quantity", "label": "家族人数に合わせた必要量計算" },
        { "value": "expiry", "label": "賞味期限リマインド" },
        { "value": "shopping", "label": "補充用の買い物リスト" },
        { "value": "habit", "label": "定期的な見直しサポート" },
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q6_HABIT',
    '定期的な見直しサポートについて、あるとうれしい仕組みを1つ短く教えてください。',
    'main',
    'free_text_short',
    false,
    6,
    '{ "default_next": "Q7" }'::jsonb,
    '{
      "max_length": 120,
      "placeholder": "例: 半年ごとに足りないものと期限切れが近いものを通知してほしいです",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "定期見直し支援への期待を把握する",
        "question_goal": "欲しい仕組みと理由を取得する",
        "probe_goal": "機能名だけの回答から具体的な通知タイミングや理由を聞く",
        "required_slots": ["desired_feature", "reason"],
        "bad_answer_patterns": [
          { "type": "contains", "value": "普通", "note": "abstract" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "どんなタイミングで何を知らせてほしいか、理由も含めて教えてください",
        "answerExample": "半年ごとに足りないものと期限切れが近いものを通知してほしいです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '仕組み名だけの回答では、通知タイミング、知らせてほしい内容、理由を確認する。',
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q7',
    '防災備蓄で不安なことや準備しにくいことを、場面と理由がわかるように具体的に教えてください。',
    'main',
    'free_text_long',
    true,
    7,
    null,
    '{
      "placeholder": "例: 台風前に慌てて買いに行くことが多く、何をどれだけ買えばよいかわからないのが不安です",
      "helpText": "「特になし」だけでも入力できますが、AI深掘り確認用に追加質問が出る想定です",
      "meta": {
        "research_goal": "防災備蓄の不安と準備障壁を具体化する",
        "question_goal": "不安、発生場面、理由を取得する",
        "probe_goal": "短答・曖昧回答から場面、障壁、理由を引き出す",
        "expected_slots": [
          { "key": "pain_point", "label": "不安・障壁", "required": true, "examples": ["何を買えばよいかわからない", "置き場所がない", "期限管理が面倒"] },
          { "key": "usage_scene", "label": "場面", "required": true, "examples": ["台風前", "地震のニュースを見た後", "買い物前"] },
          { "key": "reason", "label": "理由", "required": true, "examples": ["必要量がわからない", "家族分を計算できない"] }
        ],
        "required_slots": ["pain_point", "usage_scene", "reason"],
        "bad_answer_patterns": [
          { "type": "exact", "value": "特になし", "note": "no_content" },
          { "type": "exact", "value": "特にない", "note": "no_content" },
          { "type": "exact", "value": "ない", "note": "no_content" },
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
        "coreInfoPrompt": "どんな場面で何が不安か、なぜ準備しにくいかを具体的に教えてください",
        "answerExample": "台風前に慌てて買いに行くことが多く、何をどれだけ買えばよいかわからないのが不安です",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '短答や「特になし」は、場面、不安、準備しにくい理由を1つずつ聞いて具体化する。',
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q8',
    '次の項目について、5段階で評価してください。入力例: 必要量がわかりそう=4, 続けやすそう=3, 通知が役立ちそう=5',
    'main',
    'matrix_single',
    true,
    8,
    null,
    '{
      "matrix_rows": [
        { "value": "quantity", "label": "必要量がわかりそう" },
        { "value": "continue", "label": "続けやすそう" },
        { "value": "notice", "label": "通知が役立ちそう" }
      ],
      "matrix_cols": [
        { "value": "1", "label": "1: 低い" },
        { "value": "2", "label": "2" },
        { "value": "3", "label": "3" },
        { "value": "4", "label": "4" },
        { "value": "5", "label": "5: 高い" }
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q9',
    '各場面で使いたい支援を選んでください。入力例: 台風前=通知,買い物リスト / 見直し時=期限管理',
    'main',
    'matrix_multi',
    true,
    9,
    null,
    '{
      "matrix_rows": [
        { "value": "before_typhoon", "label": "台風前" },
        { "value": "after_news", "label": "災害ニュースを見た後" },
        { "value": "review", "label": "備蓄見直し時" }
      ],
      "matrix_cols": [
        { "value": "checklist", "label": "チェックリスト" },
        { "value": "quantity", "label": "必要量計算" },
        { "value": "reminder", "label": "通知" },
        { "value": "shopping_list", "label": "買い物リスト" }
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q10',
    '次の表を想定して回答してください。入力例: 通知頻度=少なめ / 補充提案=必要 / 共有範囲=家族全員',
    'main',
    'matrix_mixed',
    true,
    10,
    null,
    '{
      "matrix_rows": [
        { "value": "notification_frequency", "label": "通知頻度", "answer_type": "single_choice" },
        { "value": "restock_suggestion", "label": "補充提案", "answer_type": "single_choice" },
        { "value": "share_scope", "label": "共有範囲", "answer_type": "free_text_short" }
      ],
      "matrix_cols": [
        { "value": "low", "label": "少なめ" },
        { "value": "middle", "label": "普通" },
        { "value": "high", "label": "多め" },
        { "value": "needed", "label": "必要" },
        { "value": "not_needed", "label": "不要" }
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q11',
    '防災備蓄サービスの利用意向を1〜5で教えてください。',
    'main',
    'numeric',
    true,
    11,
    '{
      "default_next": "Q12",
      "branches": [
        { "field": "value", "when": { "lte": 2 }, "next": "Q11_LOW" },
        { "field": "value", "when": { "gte": 4 }, "next": "Q11_HIGH" }
      ]
    }'::jsonb,
    '{
      "min": 1,
      "max": 5,
      "min_label": "使いたくない",
      "max_label": "ぜひ使いたい",
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q11_LOW',
    '利用意向が低い理由を短く教えてください。',
    'main',
    'free_text_short',
    false,
    12,
    '{ "default_next": "Q12" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: 防災用品は自分で買えばよく、アプリに入力するのが面倒そうだからです",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "低利用意向の理由を把握する",
        "question_goal": "使いたくない理由と障壁を取得する",
        "probe_goal": "低評価理由が抽象的な場合に具体的な懸念を聞く",
        "required_slots": ["reason", "barrier"],
        "bad_answer_patterns": [
          { "type": "contains", "value": "なんとなく", "note": "abstract" },
          { "type": "contains", "value": "普通", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "使いたくない理由を、手間・価格・信頼性・必要性のどれに近いか含めて教えてください",
        "answerExample": "防災用品は自分で買えばよく、アプリに入力するのが面倒そうだからです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '低評価理由が短い場合は、手間、価格、信頼性、必要性のどれが懸念かを聞く。',
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q11_HIGH',
    '利用意向が高い理由を短く教えてください。',
    'main',
    'free_text_short',
    false,
    13,
    '{ "default_next": "Q12" }'::jsonb,
    '{
      "max_length": 160,
      "placeholder": "例: 家族分の必要量と賞味期限を自動で管理できるなら、買い忘れを減らせそうだからです",
      "helpText": "短くても構いません。AI深掘り確認用の対象設問です",
      "meta": {
        "research_goal": "高利用意向の理由を把握する",
        "question_goal": "魅力に感じた点と利用場面を取得する",
        "probe_goal": "魅力の理由が抽象的な場合に具体的な価値を聞く",
        "required_slots": ["reason", "value_condition"],
        "bad_answer_patterns": [
          { "type": "contains", "value": "便利", "note": "abstract" },
          { "type": "contains", "value": "なんとなく", "note": "abstract" }
        ],
        "probe_config": { "max_probes": 2, "min_probes": 0, "force_probe_on_bad": true, "allow_followup_expansion": false, "strict_topic_lock": true },
        "completion_conditions": [{ "type": "required_slots" }, { "type": "no_bad_patterns" }],
        "render_style": { "mode": "interview_natural", "connect_from_previous_answer": true, "avoid_question_number": true, "preserve_options": false }
      },
      "conversationControl": {
        "coreInfoPrompt": "どの機能が、どんな場面で役立ちそうかを教えてください",
        "answerExample": "家族分の必要量と賞味期限を自動で管理できるなら、買い忘れを減らせそうだからです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 45
      }
    }'::jsonb,
    true,
    '高評価理由が短い場合は、どの機能がどんな場面で役立つかを確認する。',
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q12',
    'この防災備蓄サービスの印象を、左を1・右を5として数字で教えてください。',
    'main',
    'sd',
    true,
    14,
    null,
    '{
      "options": [
        { "value": "1", "label": "続かなさそう" },
        { "value": "2", "label": "やや続かなさそう" },
        { "value": "3", "label": "どちらともいえない" },
        { "value": "4", "label": "やや続けやすそう" },
        { "value": "5", "label": "続けやすそう" }
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q13',
    '防災備蓄サービスの画面イメージを見た前提で、気になった点や改善してほしい点を具体的に教えてください。',
    'main',
    'text_with_image',
    true,
    15,
    null,
    '{
      "question_text_image": {
        "url": "https://example.com/test-assets/emergency-stockpile-service-concept.png",
        "alt": "防災備蓄サービスの画面イメージ",
        "caption": "テスト用の画像URLです。実画像に差し替えて確認してください。"
      },
      "options": [
        { "value": "easy", "label": "わかりやすい" },
        { "value": "too_much", "label": "情報量が多い" },
        { "value": "not_clear", "label": "使い方がわかりにくい" },
        { "value": "other", "label": "その他" }
      ],
      "helpText": "番号でも回答できます。画像付き設問の表示確認用です。",
      "meta": {
        "research_goal": "防災備蓄サービスの画像付き設問とAI深掘りの確認",
        "question_goal": "画面イメージへの反応と改善点を取得する",
        "probe_goal": "抽象的な反応から、どの部分がなぜそう感じたかを聞く",
        "required_slots": ["reason"],
        "bad_answer_patterns": [
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
        "completion_conditions": [{ "type": "no_bad_patterns" }],
        "render_style": {
          "mode": "interview_natural",
          "connect_from_previous_answer": true,
          "avoid_question_number": true,
          "preserve_options": true
        }
      },
      "conversationControl": {
        "coreInfoPrompt": "どの部分が気になったか、なぜそう感じたかを教えてください",
        "answerExample": "情報量が多いです。必要量、期限、買い物リストが同じ画面にあると最初に何を見ればよいか迷いそうです",
        "shortAnswerMinLength": 18,
        "sufficientAnswerMinLength": 40
      }
    }'::jsonb,
    true,
    '画像への反応が抽象的な場合は、気になった箇所と理由を確認する。',
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q14',
    '画像アップロード設問の確認です。備蓄棚やメモ画像がある場合は送ってください。ない場合は「画像なし」と入力してください。',
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q15',
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
  (
    '00000000-0000-4000-8000-0000000000b2',
    'Q16',
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
  (
    '00000000-0000-4000-8000-0000000000b2',
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
--     line_user_id,
--     display_name,
--     project_id,
--     status,
--     total_points
--   )
--   values (
--     'YOUR_LINE_USER_ID',
--     '全回答形式テストユーザー',
--     '00000000-0000-4000-8000-0000000000b2',
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
--   '00000000-0000-4000-8000-0000000000b2',
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
