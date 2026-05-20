-- ============================================================
-- Realistic interview project:
--   共働き家庭の平日夕食準備インタビュー
--
-- Purpose:
--   interview_chat 形式で、実案件に近い生活者インタビューを作成する。
--   冷凍ミールキット/時短夕食サービスの企画検討を想定。
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
  screening_config,
  screening_last_question_order,
  ai_state_template_key,
  ai_state_generated_at,
  ai_state_json,
  created_at,
  updated_at
)
values (
  '00000000-0000-4000-8000-0000000000d1',
  '共働き家庭の平日夕食準備インタビュー',
  '冷凍ミールキット検討チーム',
  '共働き家庭が平日の夕食準備で感じている負担、現在の工夫、冷凍ミールキットへの期待と不安、価格許容を把握する。',
  'active',
  50,
  'interview',
  $$[
    "平日夕食準備で負担が大きくなる具体場面を把握する",
    "既存の代替手段や工夫と、その限界を把握する",
    "冷凍ミールキット案への期待、不安、購入意向、価格許容を把握する"
  ]$$::jsonb,
  $$[
    "子ども有無や帰宅時間によるニーズ差を把握する",
    "継続利用の阻害要因を把握する"
  ]$$::jsonb,
  $$[
    "単なる好意度だけでなく、直近の実体験に基づいて回答してもらう",
    "宅配弁当、惣菜、外食、既存ミールキットとの違いが分かるように聞く"
  ]$$::jsonb,
  $$[
    "LINE上で自然な会話として短く聞く",
    "自由記述では場面、理由、具体例が不足している場合だけ深掘りする",
    "回答者を責める表現を避け、生活実態を聞く"
  ]$$::jsonb,
  $${
    "enabled": true,
    "require_question_probe_enabled": true,
    "target_question_codes": ["Q3", "Q5", "Q8"],
    "max_probes_per_answer": 2,
    "max_probes_per_session": 6,
    "short_answer_min_length": 24,
    "conditions": ["short_answer", "abstract_answer", "missing_required_slot"],
    "end_conditions": [
      "answer_sufficient",
      "max_probes_per_answer",
      "max_probes_per_session",
      "user_declined"
    ]
  }$$::jsonb,
  $${
    "channel": "line",
    "tone": "natural_japanese",
    "max_sentences": 2,
    "max_characters_per_message": 120
  }$$::jsonb,
  'interview_chat',
  $${
    "pass_message": "ありがとうございます。続いて、平日の夕食準備について少し詳しく伺います。",
    "fail_message": "ありがとうございます。今回は対象条件と少し異なるため、ここで終了です。",
    "pass_action": "interview"
  }$$::jsonb,
  2,
  'meal_kit_interview',
  now(),
  $${
    "version": "v1",
    "template_key": "meal_kit_interview",
    "project_goal": "共働き家庭の平日夕食準備における負担、代替行動、冷凍ミールキットの受容性を把握する",
    "user_understanding_goal": "直近の夕食準備場面、困りごと、現在の工夫、購入判断条件を具体的に理解する",
    "required_slots": [
      {
        "key": "household_context",
        "label": "世帯状況",
        "required": true,
        "description": "同居家族や子どもの有無など、夕食準備に影響する背景",
        "examples": ["夫婦のみ", "未就学児がいる", "小学生の子どもがいる"]
      },
      {
        "key": "weekday_dinner_scene",
        "label": "直近の夕食準備場面",
        "required": true,
        "description": "いつ、どんな状況で夕食準備が大変だったか",
        "examples": ["残業後の20時", "子どもの習い事後", "買い物に行けなかった日"]
      },
      {
        "key": "pain_point",
        "label": "負担・不満",
        "required": true,
        "description": "夕食準備で具体的に負担になっていること",
        "examples": ["献立を考えるのがつらい", "調理時間が足りない", "栄養バランスが不安"]
      },
      {
        "key": "current_workaround",
        "label": "現在の対処法",
        "required": true,
        "description": "惣菜、外食、作り置き、既存サービスなど現在の工夫",
        "examples": ["スーパーの惣菜", "週末の作り置き", "冷凍食品"]
      },
      {
        "key": "purchase_barrier",
        "label": "購入障壁",
        "required": true,
        "description": "冷凍ミールキットを使う際の不安やためらい",
        "examples": ["価格", "味", "冷凍庫の容量", "子どもが食べるか"]
      }
    ],
    "optional_slots": [
      {
        "key": "expected_value",
        "label": "期待価値",
        "required": false,
        "description": "サービスに期待する良さ",
        "examples": ["献立を考えなくていい", "野菜が取れる", "洗い物が少ない"]
      },
      {
        "key": "acceptable_price",
        "label": "価格許容",
        "required": false,
        "description": "1食あたり、または家族分で許容できる価格帯",
        "examples": ["1人前600円まで", "家族4人で2500円まで"]
      }
    ],
    "question_categories": ["対象条件", "利用場面", "負担", "代替行動", "コンセプト評価", "価格"],
    "probe_policy": {
      "default_max_probes": 2,
      "force_probe_on_bad": true,
      "strict_topic_lock": true,
      "allow_followup_expansion": false
    },
    "completion_rule": {
      "required_slots_needed": [
        "household_context",
        "weekday_dinner_scene",
        "pain_point",
        "current_workaround",
        "purchase_barrier"
      ],
      "allow_finish_without_optional": true,
      "min_required_slots_to_finish": 5
    },
    "language": "ja",
    "probe_guideline": "直近の具体場面、理由、困った度合い、現在の対処法を聞く。抽象的な回答は生活場面に戻して具体化する。"
  }$$::jsonb,
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
  screening_config = excluded.screening_config,
  screening_last_question_order = excluded.screening_last_question_order,
  ai_state_template_key = excluded.ai_state_template_key,
  ai_state_generated_at = excluded.ai_state_generated_at,
  ai_state_json = excluded.ai_state_json,
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
    '00000000-0000-4000-8000-00000000d101',
    '00000000-0000-4000-8000-0000000000d1',
    'Q1',
    '現在のご家庭に近いものを教えてください。',
    'screening',
    'single_choice',
    true,
    1,
    null,
    $${
      "options": [
        { "label": "夫婦・パートナーと同居", "value": "couple" },
        { "label": "子どもと同居", "value": "with_children" },
        { "label": "親と同居", "value": "with_parents" },
        { "label": "一人暮らし", "value": "single" },
        { "label": "その他", "value": "other" }
      ],
      "helpText": "夕食準備の状況を理解するための質問です。"
    }$$::jsonb,
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
    '00000000-0000-4000-8000-00000000d102',
    '00000000-0000-4000-8000-0000000000d1',
    'Q2',
    '平日の夕食を自宅で準備する頻度はどれくらいですか？',
    'screening',
    'single_choice',
    true,
    2,
    null,
    $${
      "options": [
        { "label": "週5日以上", "value": "5_or_more" },
        { "label": "週3〜4日", "value": "3_4_days" },
        { "label": "週1〜2日", "value": "1_2_days" },
        { "label": "月に数回程度", "value": "few_per_month" },
        { "label": "ほとんど準備しない", "value": "rarely" }
      ],
      "helpText": "ご自身で調理する日だけでなく、惣菜や冷凍食品を組み合わせる日も含めて構いません。"
    }$$::jsonb,
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
    '00000000-0000-4000-8000-00000000d103',
    '00000000-0000-4000-8000-0000000000d1',
    'Q3',
    '直近で「今日の夕食準備は大変だった」と感じた日のことを教えてください。',
    'main',
    'free_text_long',
    true,
    3,
    null,
    $${
      "placeholder": "例: 残業で帰宅が20時を過ぎ、子どももお腹を空かせていて、献立を考える余裕がありませんでした",
      "meta": {
        "research_goal": "夕食準備の負担が発生する具体場面を把握する",
        "question_goal": "時間帯、家族状況、何が大変だったかを具体化する",
        "probe_goal": "場面、制約、感情が不足している場合だけ深掘りする",
        "expected_slots": [
          { "key": "scene", "label": "具体場面", "required": true },
          { "key": "time_constraint", "label": "時間制約", "required": true },
          { "key": "household_context", "label": "家族状況", "required": false },
          { "key": "emotion", "label": "感情", "required": false }
        ],
        "required_slots": ["scene", "time_constraint"],
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
        "coreInfoPrompt": "いつ、どんな状況で、何が一番大変だったかを具体的に聞いてください。",
        "answerExample": "残業で帰宅が20時ごろになり、子どもがすぐ食べたがっていたので、献立を考える時間も調理する気力もありませんでした。",
        "shortAnswerMinLength": 24,
        "sufficientAnswerMinLength": 55
      }
    }$$::jsonb,
    true,
    '直近の具体場面、時間制約、家族状況、気持ちを聞く。抽象的なら「その日は何時ごろで、何に一番困りましたか」と確認する。',
    2,
    'static',
    false,
    false,
    null,
    null,
    'free_text_long',
    null,
    null,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000d104',
    '00000000-0000-4000-8000-0000000000d1',
    'Q4',
    '忙しい日の夕食では、普段どんな方法で乗り切ることが多いですか？',
    'main',
    'multi_choice',
    true,
    4,
    null,
    $${
      "min_select": 1,
      "max_select": 4,
      "options": [
        { "label": "スーパーやコンビニの惣菜", "value": "ready_meal" },
        { "label": "冷凍食品", "value": "frozen_food" },
        { "label": "週末の作り置き", "value": "meal_prep" },
        { "label": "外食・テイクアウト", "value": "takeout" },
        { "label": "宅配・デリバリー", "value": "delivery" },
        { "label": "簡単な麺類や丼もの", "value": "simple_cooking" },
        { "label": "家族に任せる", "value": "family_help" },
        { "label": "特に決まっていない", "value": "no_fixed_way" }
      ],
      "helpText": "よく使うものを最大4つまで選んでください。"
    }$$::jsonb,
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
    '00000000-0000-4000-8000-00000000d105',
    '00000000-0000-4000-8000-0000000000d1',
    'Q5',
    'その方法で助かっている点と、まだ不満に感じる点を教えてください。',
    'comparison_core',
    'free_text_long',
    true,
    5,
    null,
    $${
      "placeholder": "例: 惣菜は早くて助かる一方、揚げ物に偏りやすく、子どもに出すには少し罪悪感があります",
      "meta": {
        "research_goal": "現行代替手段の価値と未充足ニーズを把握する",
        "question_goal": "助かっている点、不満点、使い続けにくい理由を聞く",
        "probe_goal": "不満点や理由が曖昧な場合だけ深掘りする",
        "expected_slots": [
          { "key": "current_workaround", "label": "現在の対処法", "required": true },
          { "key": "benefit", "label": "助かっている点", "required": true },
          { "key": "pain_point", "label": "不満点", "required": true },
          { "key": "reason", "label": "理由", "required": false }
        ],
        "required_slots": ["current_workaround", "benefit", "pain_point"],
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
        "coreInfoPrompt": "現在の対処法で助かる点と、残っている不満を対比して聞いてください。",
        "answerExample": "冷凍食品はすぐ出せるので助かりますが、野菜が少なくなりがちで、毎回だと手抜き感が気になります。",
        "shortAnswerMinLength": 24,
        "sufficientAnswerMinLength": 60
      }
    }$$::jsonb,
    true,
    '助かっている点と不満点の両方を聞く。どちらかしかない場合は、もう片方を自然に確認する。',
    2,
    'static',
    false,
    false,
    null,
    null,
    'free_text_long',
    null,
    null,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000d106',
    '00000000-0000-4000-8000-0000000000d1',
    'Q6',
    '「主菜と副菜がセットになった、10分で出せる冷凍ミールキット」があったら、使ってみたいと思いますか？',
    'main',
    'numeric',
    true,
    6,
    null,
    $${
      "min": 1,
      "max": 5,
      "minLabel": "まったく使いたくない",
      "maxLabel": "とても使いたい",
      "helpText": "1〜5の気持ちに近い数字で教えてください。"
    }$$::jsonb,
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
    '00000000-0000-4000-8000-00000000d107',
    '00000000-0000-4000-8000-0000000000d1',
    'Q7',
    'そのサービスで魅力に感じる点があるとしたら、どれですか？',
    'main',
    'multi_choice',
    true,
    7,
    null,
    $${
      "min_select": 1,
      "max_select": 3,
      "options": [
        { "label": "献立を考えなくていい", "value": "no_menu_planning" },
        { "label": "短時間で出せる", "value": "quick" },
        { "label": "野菜や栄養バランスが取りやすい", "value": "nutrition" },
        { "label": "買い物に行かなくていい", "value": "no_shopping" },
        { "label": "洗い物が少なそう", "value": "less_cleanup" },
        { "label": "子どもにも出しやすそう", "value": "kid_friendly" },
        { "label": "特に魅力は感じない", "value": "not_attractive" }
      ],
      "helpText": "近いものを最大3つまで選んでください。"
    }$$::jsonb,
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
    '00000000-0000-4000-8000-00000000d108',
    '00000000-0000-4000-8000-0000000000d1',
    'Q8',
    '逆に、使う前に気になりそうなことや、購入をためらいそうな理由を教えてください。',
    'comparison_core',
    'free_text_long',
    true,
    8,
    null,
    $${
      "placeholder": "例: 味が家族に合うか分からないのと、冷凍庫に常に入れておけるかが少し不安です",
      "meta": {
        "research_goal": "冷凍ミールキットの購入障壁を把握する",
        "question_goal": "価格、味、保存、家族受容、継続利用の不安を聞く",
        "probe_goal": "障壁と理由が不足している場合だけ深掘りする",
        "expected_slots": [
          { "key": "purchase_barrier", "label": "購入障壁", "required": true },
          { "key": "reason", "label": "理由", "required": true },
          { "key": "condition_to_try", "label": "試す条件", "required": false }
        ],
        "required_slots": ["purchase_barrier", "reason"],
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
        "coreInfoPrompt": "何が不安か、その理由、どんな条件なら試せそうかを聞いてください。",
        "answerExample": "1食あたりの価格が高いと続けにくいです。あと、子どもが食べない味だと無駄になるので、最初は少量で試せると安心です。",
        "shortAnswerMinLength": 24,
        "sufficientAnswerMinLength": 60
      }
    }$$::jsonb,
    true,
    '購入をためらう理由を具体化する。価格、味、保存、家族受容のどれに近いかが曖昧なら確認する。',
    2,
    'static',
    false,
    false,
    null,
    null,
    'free_text_long',
    null,
    null,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000d109',
    '00000000-0000-4000-8000-0000000000d1',
    'Q9',
    '主菜と副菜のセット1人前として、無理なく買えそうな価格帯はどれに近いですか？',
    'main',
    'single_choice',
    true,
    9,
    null,
    $${
      "options": [
        { "label": "400円未満", "value": "under_400" },
        { "label": "400〜599円", "value": "400_599" },
        { "label": "600〜799円", "value": "600_799" },
        { "label": "800〜999円", "value": "800_999" },
        { "label": "1000円以上でも内容次第", "value": "1000_or_more" },
        { "label": "価格に関わらず買わなさそう", "value": "would_not_buy" }
      ]
    }$$::jsonb,
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
    '00000000-0000-4000-8000-00000000d110',
    '00000000-0000-4000-8000-0000000000d1',
    '__free_comment__',
    '最後に、平日の夕食準備やこうしたサービスについて、ここまでで話しきれなかったことがあれば自由に教えてください。',
    'free_comment',
    'free_text_long',
    false,
    10,
    null,
    $${
      "placeholder": "自由に入力してください",
      "meta": {
        "research_goal": "設問で拾いきれなかった補足意見を回収する",
        "question_goal": "追加の不満、期待、利用条件を自由に聞く",
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
    }$$::jsonb,
    false,
    null,
    null,
    'static',
    true,
    true,
    null,
    null,
    'free_text_long',
    null,
    null,
    null,
    null,
    now(),
    now()
  )
on conflict (project_id, question_code) do update
set
  id = excluded.id,
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
--     '夕食準備インタビュー確認ユーザー',
--     '00000000-0000-4000-8000-0000000000d1',
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
--   '00000000-0000-4000-8000-0000000000d1',
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
