-- Test seed for screening flow: new fitness membership project.
-- Run after migrations 028, 029, and 030 have been applied.
--
-- Example:
--   supabase db execute --file supabase/fitness_screening_test_seed.sql
--   psql "$DATABASE_URL" -f supabase/fitness_screening_test_seed.sql

begin;

-- Stable test project.
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
  '00000000-0000-4000-8000-0000000000f1',
  '新規フィットネス加入者スクリーニング',
  'フィットネス新規加入テスト',
  '一度もフィットネスジムに加入したことがない20代から70歳までの関東圏在住者を対象に、新規加入意向と不安要因を把握する。',
  'published',
  50,
  'survey_interview',
  'survey_question',
  $$[
    "フィットネスジム未加入者の加入検討理由を把握する",
    "入会前の不安、障壁、期待するサポートを把握する",
    "関東圏の20代から70歳までを対象にスクリーニング判定を検証する"
  ]$$::jsonb,
  $$[
    "年代や生活スタイルによる不安の違いを確認する",
    "初回体験や料金プランへの反応を確認する"
  ]$$::jsonb,
  $$[
    "既存ジム会員ではなく、未加入者の視点として回答してもらう",
    "具体的な生活場面、運動経験、検討理由に基づいて回答してもらう"
  ]$$::jsonb,
  $$[
    "回答者を責める表現を避ける",
    "フィットネス経験の有無を決めつけない",
    "短い回答には具体的な場面を一つだけ深掘りする"
  ]$$::jsonb,
  $${
    "enabled": true,
    "require_question_probe_enabled": true,
    "target_question_codes": ["Q4", "Q5"],
    "max_probes_per_answer": 1,
    "max_probes_per_session": 3,
    "short_answer_min_length": 18,
    "conditions": ["short_answer", "abstract_answer"],
    "end_conditions": ["answer_sufficient", "max_probes_per_answer", "max_probes_per_session", "user_declined"]
  }$$::jsonb,
  $${
    "channel": "line",
    "tone": "natural_japanese",
    "max_sentences": 2,
    "max_characters_per_message": 140
  }$$::jsonb,
  $${
    "enabled": true,
    "pass_action": "survey",
    "pass_message": "スクリーニングを通過しました。続けてフィットネス加入に関する質問へお進みください。",
    "fail_message": "ご回答ありがとうございます。今回は対象条件と合わないため、ここで終了となります。"
  }$$::jsonb,
  3,
  'fitness_new_member_screening',
  now(),
  $${
    "version": "v1",
    "template_key": "fitness_new_member_screening",
    "project_goal": "関東圏の20代から70歳までのフィットネスジム未加入者について、新規加入の動機、障壁、期待するサポートを把握する。",
    "user_understanding_goal": "未加入の背景、運動習慣、加入時の不安、初回体験への期待を具体的に理解する。",
    "required_slots": [
      {
        "key": "interest_trigger",
        "label": "加入を考えるきっかけ",
        "required": true,
        "description": "健康、体型、リハビリ、友人の影響など、フィットネスに興味を持った理由"
      },
      {
        "key": "barrier",
        "label": "加入前の障壁",
        "required": true,
        "description": "料金、通いやすさ、初心者不安、続けられるかなどの懸念"
      },
      {
        "key": "support_expectation",
        "label": "期待するサポート",
        "required": true,
        "description": "初回案内、トレーナー、プログラム、設備、アプリなど期待する支援"
      }
    ],
    "optional_slots": [
      {
        "key": "preferred_plan",
        "label": "希望プラン",
        "required": false,
        "description": "都度払い、月額、短期プラン、オンライン併用など"
      }
    ],
    "language": "ja"
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
  display_mode = excluded.display_mode,
  primary_objectives = excluded.primary_objectives,
  secondary_objectives = excluded.secondary_objectives,
  comparison_constraints = excluded.comparison_constraints,
  prompt_rules = excluded.prompt_rules,
  probe_policy = excluded.probe_policy,
  response_style = excluded.response_style,
  screening_config = excluded.screening_config,
  screening_last_question_order = excluded.screening_last_question_order,
  ai_state_template_key = excluded.ai_state_template_key,
  ai_state_generated_at = excluded.ai_state_generated_at,
  ai_state_json = excluded.ai_state_json,
  updated_at = now();

-- Screening/profile conditions.
delete from screening_conditions
where project_id = '00000000-0000-4000-8000-0000000000f1';

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
    '00000000-0000-4000-8000-0000000000f1',
    'profile',
    'age',
    'between',
    '[20, 70]'::jsonb,
    10
  ),
  (
    '00000000-0000-4000-8000-0000000000f1',
    'profile',
    'prefecture',
    'in',
    '["東京都", "神奈川県", "埼玉県", "千葉県", "茨城県", "栃木県", "群馬県"]'::jsonb,
    20
  );

-- Questions. Q1-Q3 are screening questions. Q1 has pass options.
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
  answer_options_locked,
  is_screening_question,
  created_at,
  updated_at
)
values
  (
    '00000000-0000-4000-8000-00000000f101',
    '00000000-0000-4000-8000-0000000000f1',
    'Q1',
    'これまでにフィットネスジム、スポーツクラブ、24時間ジムなどへ加入したことはありますか？',
    'screening',
    'single_choice',
    true,
    1,
    null,
    $${
      "options": [
        { "label": "一度も加入したことがない", "value": "never_joined", "isScreeningPass": true },
        { "label": "過去に加入していたことがある", "value": "joined_before", "isScreeningPass": false },
        { "label": "現在加入している", "value": "current_member", "isScreeningPass": false },
        { "label": "体験利用だけしたことがある", "value": "trial_only", "isScreeningPass": true }
      ],
      "helpText": "今回の対象は、継続的なジム加入経験がない方です。"
    }$$::jsonb,
    false,
    null,
    null,
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
    true,
    true,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000f102',
    '00000000-0000-4000-8000-0000000000f1',
    'Q2',
    '現在お住まいの都道府県を選んでください。',
    'screening',
    'single_choice',
    true,
    2,
    null,
    $${
      "options": [
        { "label": "東京都", "value": "東京都" },
        { "label": "神奈川県", "value": "神奈川県" },
        { "label": "埼玉県", "value": "埼玉県" },
        { "label": "千葉県", "value": "千葉県" },
        { "label": "茨城県", "value": "茨城県" },
        { "label": "栃木県", "value": "栃木県" },
        { "label": "群馬県", "value": "群馬県" },
        { "label": "その他", "value": "other" }
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
    'text',
    null,
    null,
    null,
    null,
    false,
    true,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000f103',
    '00000000-0000-4000-8000-0000000000f1',
    'Q3',
    '現在の年齢を選んでください。',
    'screening',
    'single_choice',
    true,
    3,
    null,
    $${
      "options": [
        { "label": "19歳以下", "value": "under_20" },
        { "label": "20代", "value": "20s" },
        { "label": "30代", "value": "30s" },
        { "label": "40代", "value": "40s" },
        { "label": "50代", "value": "50s" },
        { "label": "60代", "value": "60s" },
        { "label": "70歳", "value": "70" },
        { "label": "71歳以上", "value": "over_70" }
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
    'text',
    null,
    null,
    null,
    null,
    false,
    true,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000f104',
    '00000000-0000-4000-8000-0000000000f1',
    'Q4',
    'フィットネスジムへの加入を考えるとしたら、どのようなきっかけがありそうですか？',
    'main',
    'free_text_long',
    true,
    4,
    null,
    $${
      "placeholder": "健康診断、運動不足、体型、リフレッシュなど、思いつくきっかけを書いてください。",
      "meta": {
        "research_goal": "加入検討のきっかけを把握する",
        "expected_slots": ["interest_trigger"],
        "required_slots": ["interest_trigger"]
      }
    }$$::jsonb,
    true,
    '具体的な生活場面や最近気になった出来事を一つだけ深掘りする。',
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
    '00000000-0000-4000-8000-00000000f105',
    '00000000-0000-4000-8000-0000000000f1',
    'Q5',
    '初めてジムに入会するとき、不安や迷いになりそうなことを教えてください。',
    'main',
    'multi_choice',
    true,
    5,
    null,
    $${
      "options": [
        { "label": "料金が続けられるか", "value": "price" },
        { "label": "通う時間を作れるか", "value": "time" },
        { "label": "初心者でも使えるか", "value": "beginner" },
        { "label": "混雑や人目が気になる", "value": "crowd" },
        { "label": "効果が出るか分からない", "value": "effect" },
        { "label": "その他", "value": "other" }
      ]
    }$$::jsonb,
    true,
    '選択理由が薄い場合は、最も大きい不安を一つだけ聞く。',
    1,
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
    '00000000-0000-4000-8000-00000000f106',
    '00000000-0000-4000-8000-0000000000f1',
    'Q6',
    '入会前にあると安心できるサポートを選んでください。',
    'main',
    'multi_choice',
    true,
    6,
    null,
    $${
      "options": [
        { "label": "初心者向けの初回案内", "value": "orientation" },
        { "label": "トレーナーによるメニュー提案", "value": "trainer_plan" },
        { "label": "混雑状況が分かるアプリ", "value": "crowd_app" },
        { "label": "短期お試しプラン", "value": "trial_plan" },
        { "label": "家族や友人と使えるプラン", "value": "group_plan" },
        { "label": "特にない", "value": "none" }
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
    'array',
    null,
    null,
    null,
    null,
    false,
    false,
    now(),
    now()
  )
on conflict (id) do update
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
  is_screening_question = excluded.is_screening_question,
  updated_at = now();

-- Virtual users. These are assigned to the project so LIFF can open by assignment_id.
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
    'line_test_fit_pass_28_tokyo',
    'テスト通過_28歳東京',
    '1998-05-01',
    'female',
    '東京都',
    now(),
    '会社員',
    now(),
    'IT',
    'single',
    false,
    '{}',
    '{一人暮らし}',
    true,
    now(),
    true,
    '{fitness_interest,screening_pass_candidate}',
    '関東在住の20代。ジム加入歴なし想定の通過確認用ユーザー。',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'line_test_fit_pass_69_saitama',
    'テスト通過_69歳埼玉',
    '1956-09-15',
    'male',
    '埼玉県',
    now(),
    '自営業',
    now(),
    'サービス',
    'married',
    true,
    '{35}',
    '{夫婦}',
    true,
    now(),
    true,
    '{fitness_interest,senior}',
    '関東在住の69歳。上限年齢付近の通過確認用ユーザー。',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'line_test_fit_fail_age_19_tokyo',
    'テスト失敗_19歳東京',
    '2007-05-01',
    'other',
    '東京都',
    now(),
    '学生',
    now(),
    '教育',
    'single',
    false,
    '{}',
    '{家族同居}',
    true,
    now(),
    true,
    '{screening_fail_age}',
    '年齢条件で落ちる確認用ユーザー。',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'line_test_fit_fail_region_osaka',
    'テスト失敗_35歳大阪',
    '1991-03-20',
    'female',
    '大阪府',
    now(),
    '会社員',
    now(),
    'メーカー',
    'single',
    false,
    '{}',
    '{一人暮らし}',
    true,
    now(),
    true,
    '{screening_fail_region}',
    '居住地条件で落ちる確認用ユーザー。',
    now(),
    '{}'::jsonb,
    now(),
    now()
  ),
  (
    'line_test_fit_fail_history_35_chiba',
    'テスト失敗_加入歴あり想定',
    '1991-11-10',
    'male',
    '千葉県',
    now(),
    '会社員',
    now(),
    '金融',
    'married',
    false,
    '{}',
    '{夫婦}',
    true,
    now(),
    true,
    '{screening_fail_question}',
    'プロフィール条件は通過し、Q1で加入歴ありを選ぶと落ちる確認用ユーザー。',
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
    '00000000-0000-4000-8000-00000000f201',
    'line_test_fit_pass_28_tokyo',
    'テスト通過_28歳東京',
    '00000000-0000-4000-8000-0000000000f1',
    'invited',
    0,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000f202',
    'line_test_fit_pass_69_saitama',
    'テスト通過_69歳埼玉',
    '00000000-0000-4000-8000-0000000000f1',
    'invited',
    0,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000f203',
    'line_test_fit_fail_age_19_tokyo',
    'テスト失敗_19歳東京',
    '00000000-0000-4000-8000-0000000000f1',
    'invited',
    0,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000f204',
    'line_test_fit_fail_region_osaka',
    'テスト失敗_35歳大阪',
    '00000000-0000-4000-8000-0000000000f1',
    'invited',
    0,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000f205',
    'line_test_fit_fail_history_35_chiba',
    'テスト失敗_加入歴あり想定',
    '00000000-0000-4000-8000-0000000000f1',
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
    '00000000-0000-4000-8000-00000000fa01',
    '00000000-0000-4000-8000-0000000000f1',
    '00000000-0000-4000-8000-00000000f201',
    'manual',
    'assigned',
    'line_test_fit_pass_28_tokyo',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "fitness_screening_test", "expected": "pass if Q1=never_joined or trial_only"}'::jsonb,
    'liff',
    '[]'::jsonb,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000fa02',
    '00000000-0000-4000-8000-0000000000f1',
    '00000000-0000-4000-8000-00000000f202',
    'manual',
    'assigned',
    'line_test_fit_pass_69_saitama',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "fitness_screening_test", "expected": "pass boundary age if Q1=never_joined or trial_only"}'::jsonb,
    'liff',
    '[]'::jsonb,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000fa03',
    '00000000-0000-4000-8000-0000000000f1',
    '00000000-0000-4000-8000-00000000f203',
    'manual',
    'assigned',
    'line_test_fit_fail_age_19_tokyo',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "fitness_screening_test", "expected": "fail by age profile condition"}'::jsonb,
    'liff',
    '[]'::jsonb,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000fa04',
    '00000000-0000-4000-8000-0000000000f1',
    '00000000-0000-4000-8000-00000000f204',
    'manual',
    'assigned',
    'line_test_fit_fail_region_osaka',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "fitness_screening_test", "expected": "fail by prefecture profile condition"}'::jsonb,
    'liff',
    '[]'::jsonb,
    null,
    null,
    now(),
    now()
  ),
  (
    '00000000-0000-4000-8000-00000000fa05',
    '00000000-0000-4000-8000-0000000000f1',
    '00000000-0000-4000-8000-00000000f205',
    'manual',
    'assigned',
    'line_test_fit_fail_history_35_chiba',
    now(),
    now() + interval '14 days',
    now() + interval '14 days',
    '{"seed": "fitness_screening_test", "expected": "fail if Q1=joined_before or current_member"}'::jsonb,
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

-- Assignment IDs for quick LIFF testing:
--   pass 28 Tokyo:          00000000-0000-4000-8000-00000000fa01
--   pass 69 Saitama:        00000000-0000-4000-8000-00000000fa02
--   fail age 19 Tokyo:      00000000-0000-4000-8000-00000000fa03
--   fail region Osaka:      00000000-0000-4000-8000-00000000fa04
--   fail Q1 history Chiba:  00000000-0000-4000-8000-00000000fa05
