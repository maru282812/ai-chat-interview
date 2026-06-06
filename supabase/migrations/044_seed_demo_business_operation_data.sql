-- 044_seed_demo_business_operation_data.sql
-- 管理画面の業務運用確認用デモデータ
-- 既存の本番データと混ざらないように、名称先頭に必ず [デモ] を付ける。

BEGIN;

-- 再実行時は、この migration が作成するデモデータだけを入れ替える。
DELETE FROM delivery_logs
WHERE template_id IN (SELECT id FROM delivery_templates WHERE name LIKE '[デモ]%');

DELETE FROM notification_logs
WHERE line_user_id LIKE 'demo_user_%'
   OR rendered_title LIKE '[デモ]%'
   OR rendered_body LIKE '[デモ]%';

DELETE FROM delivery_campaigns
WHERE name LIKE '[デモ]%';

DELETE FROM daily_surveys
WHERE title LIKE '[デモ]%';

DELETE FROM notification_templates
WHERE name LIKE '[デモ]%';

DELETE FROM delivery_templates
WHERE name LIKE '[デモ]%';

DELETE FROM reward_campaigns
WHERE name LIKE '[デモ]%';

DELETE FROM projects
WHERE name LIKE '[デモ]%';

DELETE FROM user_profiles
WHERE line_user_id LIKE 'demo_user_%';

DELETE FROM segments
WHERE name LIKE '[デモ]%';

DELETE FROM ng_words
WHERE word LIKE '[デモ]%';

DELETE FROM post_categories
WHERE name LIKE '[デモ]%';

-- ランク表示に必要な最低限のマスタ。既存値があれば変更しない。
INSERT INTO ranks (rank_code, rank_name, min_points, sort_order, badge_label)
VALUES
  ('bronze',   'ブロンズ',       0,    1, 'BRONZE'),
  ('silver',   'シルバー',     200,    2, 'SILVER'),
  ('gold',     'ゴールド',     500,    3, 'GOLD'),
  ('platinum', 'プラチナ',    1000,    4, 'PLATINUM'),
  ('diamond',  'ダイヤモンド', 2000,    5, 'DIAMOND')
ON CONFLICT (rank_code) DO NOTHING;

-- セグメント管理: 有効/無効相当、条件あり/なし、対象人数の多寡、配信対象利用済みを確認できる。
INSERT INTO segments (
  id, name, description, conditions, estimated_count, last_evaluated_at, created_by, created_at, updated_at
)
VALUES
  ('10000000-0000-0000-0000-000000000001', '[デモ] 20代女性', '20代女性。美容・日用品案件の基本ターゲット。',
   '{"operator":"AND","conditions":[{"field":"gender","op":"eq","value":"female"},{"field":"age","op":"gte","value":20},{"field":"age","op":"lte","value":29}]}'::jsonb,
   428, now() - interval '2 hours', 'demo', now() - interval '9 days', now() - interval '2 hours'),
  ('10000000-0000-0000-0000-000000000002', '[デモ] 30代女性', '30代女性。美容室・健康意識案件向け。',
   '{"operator":"AND","conditions":[{"field":"gender","op":"eq","value":"female"},{"field":"age","op":"gte","value":30},{"field":"age","op":"lte","value":39}]}'::jsonb,
   315, now() - interval '3 hours', 'demo', now() - interval '9 days', now() - interval '3 hours'),
  ('10000000-0000-0000-0000-000000000003', '[デモ] 40代以上', '健康食品・保険・家計意識調査向け。',
   '{"operator":"AND","conditions":[{"field":"age","op":"gte","value":40}]}'::jsonb,
   221, now() - interval '1 day', 'demo', now() - interval '8 days', now() - interval '1 day'),
  ('10000000-0000-0000-0000-000000000004', '[デモ] 美容関心層', '美容関心が高い、または美容カテゴリ回答が多いユーザー。',
   '{"operator":"OR","conditions":[{"field":"attr.beauty_interest","op":"in","value":["高い","非常に高い"]},{"field":"attr.interest_category","op":"contains","value":"美容"}]}'::jsonb,
   184, now() - interval '90 minutes', 'demo', now() - interval '7 days', now() - interval '90 minutes'),
  ('10000000-0000-0000-0000-000000000005', '[デモ] 健康意識高め', '健康食品・運動・睡眠改善に関心があるユーザー。',
   '{"operator":"OR","conditions":[{"field":"attr.food_lifestyle","op":"contains","value":"健康"},{"field":"attr.interest_category","op":"contains","value":"健康"}]}'::jsonb,
   146, now() - interval '4 hours', 'demo', now() - interval '7 days', now() - interval '4 hours'),
  ('10000000-0000-0000-0000-000000000006', '[デモ] 子育て世帯', '子どもあり、または子育て関連の回答傾向があるユーザー。',
   '{"operator":"AND","conditions":[{"field":"has_children","op":"eq","value":true}]}'::jsonb,
   92, now() - interval '5 hours', 'demo', now() - interval '6 days', now() - interval '5 hours'),
  ('10000000-0000-0000-0000-000000000007', '[デモ] 会社員', '職業が会社員のユーザー。',
   '{"operator":"AND","conditions":[{"field":"occupation","op":"eq","value":"会社員"}]}'::jsonb,
   506, now() - interval '1 hour', 'demo', now() - interval '6 days', now() - interval '1 hour'),
  ('10000000-0000-0000-0000-000000000008', '[デモ] 直近30日以内回答者', '最近回答があり、配信反応を確認しやすいユーザー。',
   '{"operator":"AND","conditions":[{"field":"last_answered_days","op":"lte","value":30}]}'::jsonb,
   267, now() - interval '30 minutes', 'demo', now() - interval '5 days', now() - interval '30 minutes'),
  ('10000000-0000-0000-0000-000000000009', '[デモ] 未回答リマインド対象', '配信済みだが回答が未完了のユーザー。',
   '{"operator":"AND","conditions":[{"field":"assignment_status","op":"in","value":["sent","opened","started"]}]}'::jsonb,
   58, now() - interval '20 minutes', 'demo', now() - interval '4 days', now() - interval '20 minutes'),
  ('10000000-0000-0000-0000-000000000010', '[デモ] 条件なし全体配信', '条件なし。全体配信や動作確認用。',
   '{"operator":"AND","conditions":[]}'::jsonb,
   1240, now() - interval '15 minutes', 'demo', now() - interval '3 days', now() - interval '15 minutes');

-- ユーザー属性・回答者・ポイント履歴確認用のユーザー。
INSERT INTO user_profiles (
  line_user_id, nickname, birth_date, prefecture, address_detail, address_registered_at,
  occupation, occupation_updated_at, industry, marital_status, has_children, children_ages,
  household_composition, gender, profile_completed, profile_completed_at, notification_ok,
  is_blocked, is_notification_stopped, fraud_flag, quality_score, ai_eval_score, ai_tags,
  ai_persona_summary, last_login_at, visibility_settings, created_at, updated_at
)
VALUES
  ('demo_user_001', 'デモ 山田花子', '1998-04-12', '東京都', '世田谷区', now() - interval '20 days',
   '会社員', now() - interval '12 days', 'IT・通信', 'single', false, '{}',
   ARRAY['一人暮らし'], 'female', true, now() - interval '18 days', true,
   false, false, false, 96.50, 88.00, ARRAY['美容','新商品好き','高反応'],
   '美容と時短サービスに反応しやすい20代会社員。', now() - interval '2 hours', '{"company_visible":true}'::jsonb, now() - interval '30 days', now() - interval '2 hours'),
  ('demo_user_002', 'デモ 佐藤美咲', '1991-09-08', '神奈川県', '横浜市', now() - interval '18 days',
   '会社員', now() - interval '10 days', 'サービス', 'married', true, ARRAY[4],
   ARRAY['配偶者','子ども'], 'female', true, now() - interval '17 days', true,
   false, false, false, 91.00, 82.00, ARRAY['子育て','美容','節約'],
   '子育て世帯向け案件で回答完了率が高い。', now() - interval '1 day', '{"company_visible":true}'::jsonb, now() - interval '28 days', now() - interval '1 day'),
  ('demo_user_003', 'デモ 鈴木健太', '1987-01-22', '埼玉県', 'さいたま市', now() - interval '30 days',
   '会社員', now() - interval '8 days', 'メーカー', 'married', true, ARRAY[7, 10],
   ARRAY['配偶者','子ども'], 'male', true, now() - interval '25 days', true,
   false, false, false, 87.00, 74.00, ARRAY['健康','家計','コンビニ'],
   '健康食品やコンビニ新商品への関心が高い。', now() - interval '3 days', '{"company_visible":true}'::jsonb, now() - interval '35 days', now() - interval '3 days'),
  ('demo_user_004', 'デモ 田中彩', '1978-11-30', '千葉県', '船橋市', now() - interval '33 days',
   '自営業', now() - interval '16 days', '美容', 'divorced', false, '{}',
   ARRAY['一人暮らし'], 'female', true, now() - interval '27 days', true,
   false, false, false, 93.00, 91.00, ARRAY['美容','健康','高ポイント'],
   '美容室利用調査や健康意識調査で深い自由記述が多い。', now() - interval '4 hours', '{"company_visible":true}'::jsonb, now() - interval '40 days', now() - interval '4 hours'),
  ('demo_user_005', 'デモ 伊藤直樹', '2002-06-05', '東京都', NULL, NULL,
   '学生', now() - interval '4 days', '学生', 'single', false, '{}',
   ARRAY['実家'], 'male', false, NULL, true,
   false, false, false, 78.00, 62.00, ARRAY['ゲーム','スマホ決済'],
   'プロフィール未完了。属性更新依頼の確認対象。', now() - interval '12 hours', '{}'::jsonb, now() - interval '21 days', now() - interval '12 hours'),
  ('demo_user_006', 'デモ 高橋恵', '1982-03-17', '大阪府', '大阪市', now() - interval '45 days',
   '会社員', now() - interval '20 days', '小売', 'married', false, '{}',
   ARRAY['配偶者'], 'female', true, now() - interval '40 days', false,
   false, true, false, 84.00, 70.00, ARRAY['休眠','未回答多め'],
   '通知停止中。配信失敗・対象外確認用。', now() - interval '46 days', '{"company_visible":false}'::jsonb, now() - interval '60 days', now() - interval '46 days'),
  ('demo_user_007', 'デモ 渡辺亮', '1995-12-03', '福岡県', '福岡市', now() - interval '12 days',
   '会社員', now() - interval '9 days', '飲食', 'single', false, '{}',
   ARRAY['一人暮らし'], 'male', true, now() - interval '11 days', true,
   false, false, false, 89.00, 77.00, ARRAY['外食','コンビニ','即時回答'],
   '夜間のアンケート反応が速い。', now() - interval '40 minutes', '{"company_visible":true}'::jsonb, now() - interval '22 days', now() - interval '40 minutes'),
  ('demo_user_008', 'デモ 中村葵', '1999-08-19', '北海道', '札幌市', now() - interval '7 days',
   'アルバイト', now() - interval '6 days', '接客', 'single', false, '{}',
   ARRAY['実家'], 'female', true, now() - interval '6 days', true,
   false, false, false, 81.00, 66.00, ARRAY['ペット','日用品'],
   '新規登録直後で回答傾向を確認中。', now() - interval '5 hours', '{"company_visible":true}'::jsonb, now() - interval '8 days', now() - interval '5 hours'),
  ('demo_user_009', 'デモ 小林真理', '1972-02-14', '愛知県', '名古屋市', now() - interval '80 days',
   '会社員', now() - interval '50 days', '医療', 'widowed', false, '{}',
   ARRAY['一人暮らし'], 'female', true, now() - interval '78 days', true,
   false, false, false, 72.00, 58.00, ARRAY['健康','休眠復帰'],
   '休眠復帰キャンペーンの確認対象。', now() - interval '70 days', '{"company_visible":true}'::jsonb, now() - interval '90 days', now() - interval '70 days'),
  ('demo_user_010', 'デモ 森翔太', '1990-10-28', '京都府', '京都市', now() - interval '25 days',
   '会社員', now() - interval '24 days', '金融', 'married', false, '{}',
   ARRAY['配偶者'], 'male', true, now() - interval '23 days', true,
   true, false, false, 65.00, 49.00, ARRAY['ブロック済み','対象外'],
   'ブロック済み。配信ログの失敗理由確認用。', now() - interval '20 days', '{"company_visible":false}'::jsonb, now() - interval '55 days', now() - interval '20 days');

INSERT INTO user_attributes (line_user_id, attr_key, value_text, value_json, value_number, source, confidence, is_private)
VALUES
  ('demo_user_001', 'interest_category', NULL, '["美容","日用品","スマホ決済"]'::jsonb, NULL, 'user', 0.95, false),
  ('demo_user_001', 'beauty_interest', '非常に高い', NULL, NULL, 'ai_inferred', 0.91, false),
  ('demo_user_001', 'favorite_category', NULL, '["スキンケア","カフェ"]'::jsonb, NULL, 'user', 0.88, false),
  ('demo_user_002', 'interest_category', NULL, '["子育て","美容","節約"]'::jsonb, NULL, 'user', 0.92, false),
  ('demo_user_002', 'food_lifestyle', '時短と健康を両立したい', NULL, NULL, 'user', 0.83, false),
  ('demo_user_003', 'interest_category', NULL, '["健康","コンビニ","家計"]'::jsonb, NULL, 'user', 0.87, false),
  ('demo_user_004', 'beauty_interest', '高い', NULL, NULL, 'ai_inferred', 0.94, false),
  ('demo_user_004', 'purchase_tendency', '体験価値が明確なら購入する', NULL, NULL, 'ai_inferred', 0.82, false),
  ('demo_user_005', 'interest_category', NULL, '["ゲーム","スマホ決済"]'::jsonb, NULL, 'user', 0.76, false),
  ('demo_user_006', 'interest_category', NULL, '["未回答多め"]'::jsonb, NULL, 'ai_inferred', 0.55, true),
  ('demo_user_007', 'used_services', NULL, '["コンビニアプリ","QR決済"]'::jsonb, NULL, 'user', 0.90, false),
  ('demo_user_008', 'interest_category', NULL, '["ペット","日用品"]'::jsonb, NULL, 'user', 0.79, false),
  ('demo_user_009', 'food_lifestyle', '健康食品を継続購入している', NULL, NULL, 'user', 0.86, false),
  ('demo_user_010', 'interest_category', NULL, '["対象外確認"]'::jsonb, NULL, 'admin', 1.00, true)
ON CONFLICT (line_user_id, attr_key) DO UPDATE SET
  value_text = EXCLUDED.value_text,
  value_json = EXCLUDED.value_json,
  value_number = EXCLUDED.value_number,
  source = EXCLUDED.source,
  confidence = EXCLUDED.confidence,
  is_private = EXCLUDED.is_private,
  updated_at = now();

INSERT INTO user_streaks (line_user_id, current_streak, longest_streak, last_answered_date, total_answer_days)
VALUES
  ('demo_user_001', 8, 14, current_date - 1, 34),
  ('demo_user_002', 3, 9, current_date - 2, 21),
  ('demo_user_003', 1, 6, current_date - 4, 18),
  ('demo_user_004', 12, 30, current_date, 72),
  ('demo_user_005', 0, 2, current_date - 15, 4),
  ('demo_user_006', 0, 5, current_date - 45, 9),
  ('demo_user_007', 5, 11, current_date, 27),
  ('demo_user_008', 2, 2, current_date - 1, 5),
  ('demo_user_009', 0, 12, current_date - 70, 16),
  ('demo_user_010', 0, 1, current_date - 20, 3)
ON CONFLICT (line_user_id) DO UPDATE SET
  current_streak = EXCLUDED.current_streak,
  longest_streak = EXCLUDED.longest_streak,
  last_answered_date = EXCLUDED.last_answered_date,
  total_answer_days = EXCLUDED.total_answer_days,
  streak_updated_at = now();

INSERT INTO user_ranks (line_user_id, rank_id)
SELECT v.line_user_id, r.id
FROM (VALUES
  ('demo_user_001', 'gold'),
  ('demo_user_002', 'silver'),
  ('demo_user_003', 'silver'),
  ('demo_user_004', 'platinum'),
  ('demo_user_005', 'bronze'),
  ('demo_user_006', 'bronze'),
  ('demo_user_007', 'gold'),
  ('demo_user_008', 'bronze'),
  ('demo_user_009', 'silver'),
  ('demo_user_010', 'bronze')
) AS v(line_user_id, rank_code)
JOIN ranks r ON r.rank_code = v.rank_code
ON CONFLICT (line_user_id) DO UPDATE SET
  rank_id = EXCLUDED.rank_id,
  updated_at = now();

-- 案件/プロジェクト: 未配信、予約、配信中、完了、一時停止、アーカイブを確認できる。
INSERT INTO projects (
  id, name, user_display_title, client_name, objective, status, reward_points, research_mode,
  display_mode, primary_objectives, secondary_objectives, comparison_constraints, prompt_rules,
  screening_config, category, is_discoverable, display_thumbnail_url, estimated_minutes,
  max_respondents, delivery_enabled, delivery_type, delivered_at, created_at, updated_at
)
VALUES
  ('20000000-0000-0000-0000-000000000001', '[デモ] デイリーチョコアイス購入実態調査', 'チョコアイス購入実態調査', 'デモ食品株式会社',
   '新作チョコアイスの購入理由と比較対象を確認する。', 'published', 80, 'survey', 'survey_question',
   '["購入理由","競合比較","再購入意向"]'::jsonb, '["価格感度","購入場所"]'::jsonb, '["コンビニアイスとの比較"]'::jsonb,
   '["自由記述では具体的な利用場面を聞く"]'::jsonb,
   '{"pass_message":"対象条件を満たしています。","fail_message":"今回は対象外です。","pass_action":"survey"}'::jsonb,
   'food', true, NULL, 6, 500, true, 'new_project', now() - interval '2 days', now() - interval '18 days', now() - interval '2 days'),
  ('20000000-0000-0000-0000-000000000002', '[デモ] 美容室利用実態アンケート', '美容室利用実態アンケート', 'デモビューティー株式会社',
   '美容室選定理由と予約サービス利用実態を把握する。', 'ready', 120, 'survey_with_interview_probe', 'survey_page',
   '["美容室選定理由","予約体験","不満点"]'::jsonb, '["価格帯","来店頻度"]'::jsonb, '[]'::jsonb,
   '["回答理由を短く追加確認する"]'::jsonb,
   '{"pass_message":"回答に進めます。","fail_message":"条件に合わないため終了します。","pass_action":"survey"}'::jsonb,
   'beauty', true, NULL, 8, 300, true, 'survey', NULL, now() - interval '15 days', now() - interval '1 day'),
  ('20000000-0000-0000-0000-000000000003', '[デモ] 子どもの習い事事前調査', '子どもの習い事事前調査', 'デモ教育サービス',
   '子育て世帯の習い事検討状況と費用感を確認する。', 'draft', 100, 'survey', 'survey_question',
   '["習い事検討状況","費用感"]'::jsonb, '["送迎負担"]'::jsonb, '[]'::jsonb,
   '[]'::jsonb, '{"pass_action":"manual_hold"}'::jsonb,
   'education', false, NULL, 7, 200, false, NULL, NULL, now() - interval '10 days', now() - interval '10 days'),
  ('20000000-0000-0000-0000-000000000004', '[デモ] 会社員ランチ実態調査', '会社員ランチ実態調査', 'デモ外食チェーン',
   '会社員の平日ランチ選択理由を把握する。', 'paused', 60, 'survey', 'survey_question',
   '["ランチ選択理由","予算","不満点"]'::jsonb, '[]'::jsonb, '[]'::jsonb,
   '[]'::jsonb, '{"pass_action":"survey"}'::jsonb,
   'food', true, NULL, 5, 400, true, 'survey', NULL, now() - interval '12 days', now() - interval '3 days'),
  ('20000000-0000-0000-0000-000000000005', '[デモ] 健康食品に関する意識調査', '健康食品に関する意識調査', 'デモヘルス株式会社',
   '健康食品の継続購入理由と不安点を確認する。', 'closed', 150, 'survey_with_interview_probe', 'survey_question',
   '["継続購入理由","不安点","情報源"]'::jsonb, '["購入チャネル"]'::jsonb, '[]'::jsonb,
   '["深掘り質問を有効にする"]'::jsonb, '{"pass_action":"survey"}'::jsonb,
   'health', false, NULL, 10, 250, false, 'high_point', now() - interval '20 days', now() - interval '35 days', now() - interval '20 days'),
  ('20000000-0000-0000-0000-000000000006', '[デモ] 休眠ユーザー復帰アンケート', '休眠ユーザー復帰アンケート', 'デモ運営事務局',
   '休眠ユーザーの復帰理由と通知許容度を確認する。', 'archived', 50, 'survey', 'survey_question',
   '["休眠理由","復帰条件"]'::jsonb, '[]'::jsonb, '[]'::jsonb,
   '[]'::jsonb, '{"pass_action":"survey"}'::jsonb,
   'system', false, NULL, 4, 100, false, 'urgent', now() - interval '50 days', now() - interval '90 days', now() - interval '50 days');

INSERT INTO question_page_groups (id, project_id, page_number, title, description, sort_order)
VALUES
  ('21000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', 1, '利用状況', '美容室の利用頻度を確認します。', 10),
  ('21000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', 2, '予約体験', '予約方法と不満点を確認します。', 20)
ON CONFLICT (project_id, page_number) DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();

INSERT INTO questions (
  id, project_id, question_code, question_text, question_role, question_type, is_required,
  sort_order, branch_rule, question_config, answer_output_type, page_group_id
)
VALUES
  ('22000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'q1', '直近1か月でチョコアイスを購入しましたか？', 'screening', 'single_choice', true, 10, NULL,
   '{"options":[{"label":"購入した","value":"yes"},{"label":"購入していない","value":"no"}]}'::jsonb, 'text', NULL),
  ('22000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'q2', '購入した場所を教えてください。', 'main', 'single_choice', true, 20, NULL,
   '{"options":[{"label":"コンビニ","value":"convenience"},{"label":"スーパー","value":"supermarket"},{"label":"ドラッグストア","value":"drugstore"}]}'::jsonb, 'text', NULL),
  ('22000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000001', 'q3', '購入理由を具体的に教えてください。', 'main', 'free_text_long', true, 30, NULL,
   '{}'::jsonb, 'text', NULL),
  ('22000000-0000-0000-0000-000000000004', '20000000-0000-0000-0000-000000000002', 'beauty_q1', '美容室はどのくらいの頻度で利用しますか？', 'main', 'single_choice', true, 10, NULL,
   '{"options":[{"label":"月1回以上","value":"monthly"},{"label":"2〜3か月に1回","value":"quarterly"},{"label":"半年に1回以下","value":"rarely"}]}'::jsonb, 'text', '21000000-0000-0000-0000-000000000001'),
  ('22000000-0000-0000-0000-000000000005', '20000000-0000-0000-0000-000000000002', 'beauty_q2', '予約時に困ることを教えてください。', 'main', 'free_text_long', false, 20, NULL,
   '{}'::jsonb, 'text', '21000000-0000-0000-0000-000000000002'),
  ('22000000-0000-0000-0000-000000000006', '20000000-0000-0000-0000-000000000005', 'health_q1', '健康食品を継続して購入していますか？', 'main', 'single_choice', true, 10, NULL,
   '{"options":[{"label":"継続中","value":"continue"},{"label":"過去に購入","value":"past"},{"label":"購入なし","value":"none"}]}'::jsonb, 'text', NULL)
ON CONFLICT (project_id, question_code) DO UPDATE SET
  question_text = EXCLUDED.question_text,
  question_role = EXCLUDED.question_role,
  question_type = EXCLUDED.question_type,
  is_required = EXCLUDED.is_required,
  sort_order = EXCLUDED.sort_order,
  question_config = EXCLUDED.question_config,
  answer_output_type = EXCLUDED.answer_output_type,
  page_group_id = EXCLUDED.page_group_id,
  updated_at = now();

-- 回答者・案件配信・回答履歴。
INSERT INTO respondents (id, line_user_id, display_name, project_id, status, total_points, current_rank_id, created_at, updated_at)
SELECT v.id::uuid, v.line_user_id, v.display_name, v.project_id::uuid, v.status, v.total_points, r.id, v.created_at::timestamptz, v.updated_at::timestamptz
FROM (VALUES
  ('30000000-0000-0000-0000-000000000001','demo_user_001','デモ 山田花子','20000000-0000-0000-0000-000000000001','completed',780,'gold',now() - interval '12 days',now() - interval '2 days'),
  ('30000000-0000-0000-0000-000000000002','demo_user_002','デモ 佐藤美咲','20000000-0000-0000-0000-000000000001','in_progress',340,'silver',now() - interval '12 days',now() - interval '1 day'),
  ('30000000-0000-0000-0000-000000000003','demo_user_003','デモ 鈴木健太','20000000-0000-0000-0000-000000000001','invited',260,'silver',now() - interval '12 days',now() - interval '4 days'),
  ('30000000-0000-0000-0000-000000000004','demo_user_004','デモ 田中彩','20000000-0000-0000-0000-000000000002','completed',1260,'platinum',now() - interval '9 days',now() - interval '1 day'),
  ('30000000-0000-0000-0000-000000000005','demo_user_005','デモ 伊藤直樹','20000000-0000-0000-0000-000000000002','screening_failed',80,'bronze',now() - interval '9 days',now() - interval '3 days'),
  ('30000000-0000-0000-0000-000000000006','demo_user_006','デモ 高橋恵','20000000-0000-0000-0000-000000000004','invited',120,'bronze',now() - interval '8 days',now() - interval '7 days'),
  ('30000000-0000-0000-0000-000000000007','demo_user_007','デモ 渡辺亮','20000000-0000-0000-0000-000000000004','in_progress',620,'gold',now() - interval '8 days',now() - interval '2 hours'),
  ('30000000-0000-0000-0000-000000000008','demo_user_009','デモ 小林真理','20000000-0000-0000-0000-000000000005','completed',420,'silver',now() - interval '30 days',now() - interval '20 days'),
  ('30000000-0000-0000-0000-000000000009','demo_user_010','デモ 森翔太','20000000-0000-0000-0000-000000000001','cancelled',40,'bronze',now() - interval '12 days',now() - interval '10 days')
) AS v(id,line_user_id,display_name,project_id,status,total_points,rank_code,created_at,updated_at)
JOIN ranks r ON r.rank_code = v.rank_code
ON CONFLICT (line_user_id, project_id) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  status = EXCLUDED.status,
  total_points = EXCLUDED.total_points,
  current_rank_id = EXCLUDED.current_rank_id,
  updated_at = EXCLUDED.updated_at;

INSERT INTO project_assignments (
  id, project_id, respondent_id, assignment_type, status, filter_snapshot, due_at,
  sent_at, opened_at, started_at, completed_at, reminder_sent_at, last_delivery_error,
  delivery_log, assigned_at, user_id, deadline, expired_at, screening_result, screening_result_at,
  created_at, updated_at
)
VALUES
  ('31000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','rule_based','completed',
   '{"segment":"[デモ] 20代女性","channel":"line"}'::jsonb, now() + interval '5 days',
   now() - interval '2 days', now() - interval '2 days' + interval '10 minutes', now() - interval '2 days' + interval '15 minutes', now() - interval '2 days' + interval '40 minutes', NULL, NULL,
   '[{"status":"sent","at":"demo"},{"status":"completed","at":"demo"}]'::jsonb, now() - interval '3 days','demo_user_001',now() + interval '5 days',NULL,'passed',now() - interval '2 days' + interval '12 minutes',
   now() - interval '3 days',now() - interval '2 days'),
  ('31000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','rule_based','started',
   '{"segment":"[デモ] 子育て世帯","channel":"line"}'::jsonb, now() + interval '4 days',
   now() - interval '1 day', now() - interval '1 day' + interval '30 minutes', now() - interval '1 day' + interval '50 minutes', NULL, now() - interval '6 hours', NULL,
   '[{"status":"sent","at":"demo"},{"status":"reminder","at":"demo"}]'::jsonb, now() - interval '2 days','demo_user_002',now() + interval '4 days',NULL,'passed',now() - interval '1 day' + interval '40 minutes',
   now() - interval '2 days',now() - interval '6 hours'),
  ('31000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000003','manual','sent',
   '{"segment":"[デモ] 健康意識高め","channel":"line"}'::jsonb, now() + interval '2 days',
   now() - interval '3 hours', NULL, NULL, NULL, NULL, NULL,
   '[{"status":"sent","at":"demo"}]'::jsonb, now() - interval '4 hours','demo_user_003',now() + interval '2 days',NULL,NULL,NULL,
   now() - interval '4 hours',now() - interval '3 hours'),
  ('31000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000004','rule_based','completed',
   '{"segment":"[デモ] 美容関心層","channel":"liff"}'::jsonb, now() + interval '7 days',
   now() - interval '1 day', now() - interval '23 hours', now() - interval '22 hours', now() - interval '21 hours', NULL, NULL,
   '[{"status":"sent","at":"demo"},{"status":"completed","at":"demo"}]'::jsonb, now() - interval '2 days','demo_user_004',now() + interval '7 days',NULL,'passed',now() - interval '22 hours',
   now() - interval '2 days',now() - interval '21 hours'),
  ('31000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000005','rule_based','cancelled',
   '{"segment":"[デモ] 20代女性","channel":"liff"}'::jsonb, now() + interval '7 days',
   now() - interval '3 days', now() - interval '3 days' + interval '10 minutes', NULL, NULL, NULL, 'screening failed',
   '[{"status":"sent","at":"demo"},{"status":"screening_failed","at":"demo"}]'::jsonb, now() - interval '4 days','demo_user_005',now() + interval '7 days',NULL,'failed',now() - interval '3 days' + interval '20 minutes',
   now() - interval '4 days',now() - interval '3 days'),
  ('31000000-0000-0000-0000-000000000006','20000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000006','rule_based','expired',
   '{"segment":"[デモ] 会社員","channel":"line"}'::jsonb, now() - interval '1 day',
   now() - interval '7 days', NULL, NULL, NULL, now() - interval '4 days', 'LINE未連携または通知停止',
   '[{"status":"failed","reason":"notification_stopped"}]'::jsonb, now() - interval '8 days','demo_user_006',now() - interval '1 day',now() - interval '1 day',NULL,NULL,
   now() - interval '8 days',now() - interval '1 day'),
  ('31000000-0000-0000-0000-000000000007','20000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000007','manual','opened',
   '{"segment":"[デモ] 会社員","channel":"line"}'::jsonb, now() + interval '1 day',
   now() - interval '2 hours', now() - interval '90 minutes', NULL, NULL, NULL, NULL,
   '[{"status":"sent","at":"demo"},{"status":"opened","at":"demo"}]'::jsonb, now() - interval '3 hours','demo_user_007',now() + interval '1 day',NULL,NULL,NULL,
   now() - interval '3 hours',now() - interval '90 minutes'),
  ('31000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000005','30000000-0000-0000-0000-000000000008','rule_based','completed',
   '{"segment":"[デモ] 健康意識高め","channel":"liff"}'::jsonb, now() - interval '15 days',
   now() - interval '25 days', now() - interval '25 days' + interval '1 hour', now() - interval '25 days' + interval '2 hours', now() - interval '25 days' + interval '3 hours', NULL, NULL,
   '[{"status":"sent","at":"demo"},{"status":"completed","at":"demo"}]'::jsonb, now() - interval '26 days','demo_user_009',now() - interval '15 days',NULL,'passed',now() - interval '25 days' + interval '2 hours',
   now() - interval '26 days',now() - interval '25 days')
ON CONFLICT (project_id, respondent_id) DO UPDATE SET
  assignment_type = EXCLUDED.assignment_type,
  status = EXCLUDED.status,
  filter_snapshot = EXCLUDED.filter_snapshot,
  due_at = EXCLUDED.due_at,
  sent_at = EXCLUDED.sent_at,
  opened_at = EXCLUDED.opened_at,
  started_at = EXCLUDED.started_at,
  completed_at = EXCLUDED.completed_at,
  reminder_sent_at = EXCLUDED.reminder_sent_at,
  last_delivery_error = EXCLUDED.last_delivery_error,
  delivery_log = EXCLUDED.delivery_log,
  assigned_at = EXCLUDED.assigned_at,
  user_id = EXCLUDED.user_id,
  deadline = EXCLUDED.deadline,
  expired_at = EXCLUDED.expired_at,
  screening_result = EXCLUDED.screening_result,
  screening_result_at = EXCLUDED.screening_result_at,
  updated_at = EXCLUDED.updated_at;

INSERT INTO sessions (id, respondent_id, project_id, current_question_id, current_phase, status, summary, state_json, started_at, completed_at, last_activity_at)
VALUES
  ('32000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000003','complete','completed','コンビニで新作感と価格を理由に購入。','{"source":"demo"}'::jsonb,now() - interval '2 days' + interval '15 minutes',now() - interval '2 days' + interval '40 minutes',now() - interval '2 days' + interval '40 minutes'),
  ('32000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000003','question','in_progress','購入場所まで回答済み。','{"source":"demo"}'::jsonb,now() - interval '1 day' + interval '50 minutes',NULL,now() - interval '6 hours'),
  ('32000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000005','complete','completed','予約しやすさと担当者指名の不満を回答。','{"source":"demo"}'::jsonb,now() - interval '22 hours',now() - interval '21 hours',now() - interval '21 hours'),
  ('32000000-0000-0000-0000-000000000004','30000000-0000-0000-0000-000000000008','20000000-0000-0000-0000-000000000005','22000000-0000-0000-0000-000000000006','complete','completed','健康食品の継続購入理由を回答。','{"source":"demo"}'::jsonb,now() - interval '25 days' + interval '2 hours',now() - interval '25 days' + interval '3 hours',now() - interval '25 days' + interval '3 hours');

INSERT INTO answers (id, session_id, question_id, answer_text, answer_role, normalized_answer, created_at)
VALUES
  ('33000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000001','購入した','primary','{"value":"yes"}'::jsonb,now() - interval '2 days' + interval '16 minutes'),
  ('33000000-0000-0000-0000-000000000002','32000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000002','コンビニ','primary','{"value":"convenience"}'::jsonb,now() - interval '2 days' + interval '20 minutes'),
  ('33000000-0000-0000-0000-000000000003','32000000-0000-0000-0000-000000000001','22000000-0000-0000-0000-000000000003','仕事帰りに新作の棚を見て、価格が手頃だったので購入しました。','primary','{"sentiment":"positive"}'::jsonb,now() - interval '2 days' + interval '35 minutes'),
  ('33000000-0000-0000-0000-000000000004','32000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000001','購入した','primary','{"value":"yes"}'::jsonb,now() - interval '1 day' + interval '55 minutes'),
  ('33000000-0000-0000-0000-000000000005','32000000-0000-0000-0000-000000000002','22000000-0000-0000-0000-000000000002','スーパー','primary','{"value":"supermarket"}'::jsonb,now() - interval '1 day' + interval '60 minutes'),
  ('33000000-0000-0000-0000-000000000006','32000000-0000-0000-0000-000000000003','22000000-0000-0000-0000-000000000004','月1回以上','primary','{"value":"monthly"}'::jsonb,now() - interval '22 hours'),
  ('33000000-0000-0000-0000-000000000007','32000000-0000-0000-0000-000000000003','22000000-0000-0000-0000-000000000005','予約枠が直前まで分からず、担当者の空き時間が比較しづらいです。','primary','{"pain_point":"予約枠比較"}'::jsonb,now() - interval '21 hours' + interval '30 minutes'),
  ('33000000-0000-0000-0000-000000000008','32000000-0000-0000-0000-000000000004','22000000-0000-0000-0000-000000000006','継続中','primary','{"value":"continue"}'::jsonb,now() - interval '25 days' + interval '2 hours' + interval '30 minutes')
ON CONFLICT (id) DO NOTHING;

INSERT INTO ai_analysis_results (id, session_id, summary, usage_scene, motive, pain_points, alternatives, insight_candidates, raw_json)
VALUES
  ('34000000-0000-0000-0000-000000000001','32000000-0000-0000-0000-000000000001','新作感と価格の手頃さが購入動機。','仕事帰りのコンビニ購入','新作棚と価格訴求','容量と甘さの不安','他社チョコアイス','価格訴求と限定感を組み合わせると反応しやすい。','{"source":"demo"}'::jsonb),
  ('34000000-0000-0000-0000-000000000002','32000000-0000-0000-0000-000000000003','予約比較のしづらさが不満。','美容室予約','担当者指名と予約効率','空き枠比較が難しい','電話予約・予約アプリ','指名予約の空き枠比較UIが価値になる。','{"source":"demo"}'::jsonb)
ON CONFLICT (session_id) DO UPDATE SET
  summary = EXCLUDED.summary,
  usage_scene = EXCLUDED.usage_scene,
  motive = EXCLUDED.motive,
  pain_points = EXCLUDED.pain_points,
  alternatives = EXCLUDED.alternatives,
  insight_candidates = EXCLUDED.insight_candidates,
  raw_json = EXCLUDED.raw_json;

-- 通知テンプレート: カテゴリ別件数、本文変数、状態確認用。
INSERT INTO notification_templates (
  id, category, name, description, message_type, title_text, body_text, action_label, action_url,
  variables, is_active, is_default, created_at, updated_at
)
VALUES
  ('40000000-0000-0000-0000-000000000001','daily_survey','[デモ] 今日のかんたんアンケート','デイリーアンケート配信用。','text','[デモ] 今日のアンケート','{{user_name}}さん、今日のかんたんアンケートが届きました。{{survey_url}}','回答する','{{survey_url}}',ARRAY['user_name','survey_url'],true,true,now() - interval '8 days',now() - interval '8 days'),
  ('40000000-0000-0000-0000-000000000002','answer_complete','[デモ] 回答完了お礼','回答完了後のお礼通知。','text','[デモ] 回答ありがとうございます','{{project_title}}への回答ありがとうございました。{{points}}ポイントを付与しました。','マイページ','{{mypage_url}}',ARRAY['project_title','points','mypage_url'],true,true,now() - interval '8 days',now() - interval '8 days'),
  ('40000000-0000-0000-0000-000000000003','unanswered_reminder','[デモ] 未回答リマインド','未回答者向けのリマインド。','text','[デモ] 回答期限が近づいています','{{project_title}}の回答期限は{{deadline}}です。あと少しで完了します。','回答する','{{survey_url}}',ARRAY['project_title','deadline','survey_url'],true,true,now() - interval '7 days',now() - interval '7 days'),
  ('40000000-0000-0000-0000-000000000004','bonus_achieved','[デモ] ボーナス達成','追加ポイント対象者向け。','text','[デモ] ボーナス対象です','条件達成により{{points}}ポイントを追加で獲得できます。','詳細を見る','{{mypage_url}}',ARRAY['points','mypage_url'],true,false,now() - interval '7 days',now() - interval '7 days'),
  ('40000000-0000-0000-0000-000000000005','rank_up','[デモ] ランクアップ通知','ランクアップ通知。','text','[デモ] ランクアップしました','{{user_name}}さんのランクが{{rank_name}}になりました。','確認する','{{mypage_url}}',ARRAY['user_name','rank_name','mypage_url'],true,true,now() - interval '6 days',now() - interval '6 days'),
  ('40000000-0000-0000-0000-000000000006','point_grant','[デモ] ポイント付与通知','ポイント付与通知。','text','[デモ] ポイントを付与しました','{{points}}ポイントを付与しました。現在のポイントはマイページで確認できます。','マイページ','{{mypage_url}}',ARRAY['points','mypage_url'],true,false,now() - interval '6 days',now() - interval '6 days'),
  ('40000000-0000-0000-0000-000000000007','project_intro','[デモ] 案件案内','新着案件案内。','text','[デモ] 新しい案件が届きました','{{project_title}}の参加対象です。所要時間は短めです。','回答する','{{survey_url}}',ARRAY['project_title','survey_url'],true,true,now() - interval '5 days',now() - interval '5 days'),
  ('40000000-0000-0000-0000-000000000008','attribute_update_request','[デモ] 属性更新依頼','プロフィール更新依頼。','text','[デモ] 登録情報の確認をお願いします','より適切な案件を届けるため、登録情報を確認してください。','確認する','{{mypage_url}}',ARRAY['mypage_url'],true,false,now() - interval '5 days',now() - interval '5 days'),
  ('40000000-0000-0000-0000-000000000009','birthday','[デモ] 誕生日メッセージ','誕生日通知。','text','[デモ] 誕生日特典があります','今月誕生日の方へ{{points}}ポイントをプレゼントします。','受け取る','{{mypage_url}}',ARRAY['points','mypage_url'],false,false,now() - interval '4 days',now() - interval '4 days'),
  ('40000000-0000-0000-0000-000000000010','dormancy_recovery','[デモ] 休眠復帰案内','休眠ユーザー向け。','text','[デモ] 久しぶりの方へ','短いアンケートに回答すると{{points}}ポイントを獲得できます。','回答する','{{survey_url}}',ARRAY['points','survey_url'],true,true,now() - interval '4 days',now() - interval '4 days'),
  ('40000000-0000-0000-0000-000000000011','system','[デモ] システム通知','管理確認用の無効テンプレート。','text','[デモ] システム通知','このテンプレートは編集確認用です。','確認する','{{mypage_url}}',ARRAY['mypage_url'],false,false,now() - interval '3 days',now() - interval '3 days');

-- 配信キャンペーン: プロジェクト未選択、プロジェクト紐づき、各 status を確認できる。
INSERT INTO delivery_campaigns (
  id, project_id, segment_id, name, status, delivery_channel, scheduled_at, sent_at,
  sent_count, opened_count, started_count, completed_count, created_at, updated_at
)
VALUES
  ('50000000-0000-0000-0000-000000000001',NULL,'10000000-0000-0000-0000-000000000010','[デモ] デイリーアンケート朝配信','scheduled','line',now() + interval '1 day',NULL,0,0,0,0,now() - interval '3 days',now() - interval '3 days'),
  ('50000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','[デモ] 新着案件一斉案内','sent','line',now() - interval '2 days',now() - interval '2 days',320,210,95,48,now() - interval '4 days',now() - interval '2 days'),
  ('50000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000004','[デモ] 美容関心層向け配信','draft','liff',NULL,NULL,0,0,0,0,now() - interval '2 days',now() - interval '2 days'),
  ('50000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000009','[デモ] 未回答者リマインド','scheduled','line',now() + interval '6 hours',NULL,0,0,0,0,now() - interval '1 day',now() - interval '1 day'),
  ('50000000-0000-0000-0000-000000000005','20000000-0000-0000-0000-000000000004','10000000-0000-0000-0000-000000000007','[デモ] 会社員ランチ配信停止済み','cancelled','line',now() - interval '3 days',NULL,0,0,0,0,now() - interval '5 days',now() - interval '3 days');

INSERT INTO campaign_assignment_map (campaign_id, assignment_id)
VALUES
  ('50000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000002'),
  ('50000000-0000-0000-0000-000000000002','31000000-0000-0000-0000-000000000003'),
  ('50000000-0000-0000-0000-000000000003','31000000-0000-0000-0000-000000000004'),
  ('50000000-0000-0000-0000-000000000004','31000000-0000-0000-0000-000000000002'),
  ('50000000-0000-0000-0000-000000000005','31000000-0000-0000-0000-000000000006')
ON CONFLICT (campaign_id, assignment_id) DO NOTHING;

-- 配信オペレーション: テンプレート、対象条件、実行ログ、失敗ログ。
INSERT INTO delivery_templates (
  id, name, is_enabled, schedule_type, schedule_config, target_types, require_status,
  require_delivery_enabled, created_within_hours, notification_template_id, segment_config,
  created_at, updated_at
)
VALUES
  ('60000000-0000-0000-0000-000000000001','[デモ] 毎朝の新着案件配信',true,'daily','{"hour":9,"minute":0}'::jsonb,ARRAY['new_project','survey'],'ready',true,72,'40000000-0000-0000-0000-000000000007','{"type":"attribute","segment_id":"10000000-0000-0000-0000-000000000010"}'::jsonb,now() - interval '10 days',now() - interval '1 day'),
  ('60000000-0000-0000-0000-000000000002','[デモ] 週末まとめ配信',true,'weekly','{"weekday":5,"hour":18,"minute":30}'::jsonb,ARRAY['survey','high_point'],'ready',true,NULL,'40000000-0000-0000-0000-000000000007','{"type":"rank","rank_codes":["silver","gold","platinum"]}'::jsonb,now() - interval '9 days',now() - interval '2 days'),
  ('60000000-0000-0000-0000-000000000003','[デモ] 緊急案件チェック',false,'interval','{"interval_minutes":30}'::jsonb,ARRAY['urgent'],'ready',true,24,'40000000-0000-0000-0000-000000000011','{"type":"all"}'::jsonb,now() - interval '8 days',now() - interval '3 days');

INSERT INTO delivery_logs (id, template_id, executed_at, project_ids, target_user_count, success_count, fail_count, error_detail)
VALUES
  ('61000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001',now() - interval '2 days',ARRAY['20000000-0000-0000-0000-000000000001']::uuid[],320,316,4,'{"failures":[{"reason":"LINE未連携","count":2},{"reason":"ブロック済み","count":2}]}'::jsonb),
  ('61000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002',now() - interval '5 days',ARRAY['20000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000005']::uuid[],184,184,0,'{}'::jsonb),
  ('61000000-0000-0000-0000-000000000003','60000000-0000-0000-0000-000000000001',now() - interval '1 day',ARRAY[]::uuid[],0,0,0,'{"note":"対象案件なし"}'::jsonb);

-- デイリーアンケート: 今日配信、明日予約、配信済み、受付中、一時停止、完了。
INSERT INTO daily_surveys (
  id, title, description, status, reward_type, reward_points, reward_min_points,
  reward_max_points, target_segment_id, scheduled_at, expires_at, notification_template_id,
  created_by, created_at, updated_at
)
VALUES
  ('70000000-0000-0000-0000-000000000001','[デモ] 今日の気分','毎日使う短い気分アンケート。','active','fixed',5,3,20,'10000000-0000-0000-0000-000000000010',now() - interval '3 hours',now() + interval '21 hours','40000000-0000-0000-0000-000000000001','demo',now() - interval '5 days',now() - interval '3 hours'),
  ('70000000-0000-0000-0000-000000000002','[デモ] 今日食べたもの','食生活属性の確認。','scheduled','fixed',8,3,20,'10000000-0000-0000-0000-000000000005',now() + interval '1 day',now() + interval '2 days','40000000-0000-0000-0000-000000000001','demo',now() - interval '4 days',now() - interval '4 days'),
  ('70000000-0000-0000-0000-000000000003','[デモ] 最近買った商品','購買傾向の確認。','completed','random',5,5,30,'10000000-0000-0000-0000-000000000008',now() - interval '4 days',now() - interval '3 days','40000000-0000-0000-0000-000000000001','demo',now() - interval '8 days',now() - interval '3 days'),
  ('70000000-0000-0000-0000-000000000004','[デモ] 夕食頻度','外食・中食傾向の確認。','paused','fixed',6,3,20,'10000000-0000-0000-0000-000000000007',now() - interval '2 days',now() + interval '5 days','40000000-0000-0000-0000-000000000001','demo',now() - interval '6 days',now() - interval '2 days'),
  ('70000000-0000-0000-0000-000000000005','[デモ] スマホ決済利用','決済利用状況の確認。','draft','fixed',5,3,20,NULL,NULL,NULL,NULL,'demo',now() - interval '2 days',now() - interval '2 days');

INSERT INTO daily_survey_questions (id, survey_id, question_text, question_type, answer_options, attribute_key, sort_order, is_active)
VALUES
  ('71000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','今日の気分を選んでください。','single_choice','[{"label":"良い","value":"good"},{"label":"普通","value":"normal"},{"label":"疲れ気味","value":"tired"}]'::jsonb,NULL,10,true),
  ('71000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000001','理由があれば一言で教えてください。','text','[]'::jsonb,NULL,20,true),
  ('71000000-0000-0000-0000-000000000003','70000000-0000-0000-0000-000000000002','今日食べたものを選んでください。','multiple_choice','[{"label":"自炊","value":"home"},{"label":"外食","value":"eatout"},{"label":"コンビニ","value":"convenience"}]'::jsonb,'food_lifestyle',10,true),
  ('71000000-0000-0000-0000-000000000004','70000000-0000-0000-0000-000000000003','最近買った商品カテゴリを選んでください。','single_choice','[{"label":"食品","value":"food"},{"label":"美容","value":"beauty"},{"label":"日用品","value":"daily"}]'::jsonb,'purchase_tendency',10,true),
  ('71000000-0000-0000-0000-000000000005','70000000-0000-0000-0000-000000000004','夕食で外食する頻度を1〜5で教えてください。','scale','[{"label":"1","value":"1"},{"label":"2","value":"2"},{"label":"3","value":"3"},{"label":"4","value":"4"},{"label":"5","value":"5"}]'::jsonb,'food_lifestyle',10,true),
  ('71000000-0000-0000-0000-000000000006','70000000-0000-0000-0000-000000000005','スマホ決済を使っていますか？','single_choice','[{"label":"よく使う","value":"often"},{"label":"たまに使う","value":"sometimes"},{"label":"使わない","value":"never"}]'::jsonb,'used_services',10,true);

INSERT INTO daily_survey_deliveries (
  id, survey_id, line_user_id, status, points_awarded, sent_at, opened_at, answered_at, expired_at, created_at
)
VALUES
  ('72000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','demo_user_001','answered',5,now() - interval '3 hours',now() - interval '2 hours 55 minutes',now() - interval '2 hours 50 minutes',NULL,now() - interval '3 hours'),
  ('72000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000001','demo_user_002','opened',NULL,now() - interval '3 hours',now() - interval '2 hours',NULL,NULL,now() - interval '3 hours'),
  ('72000000-0000-0000-0000-000000000003','70000000-0000-0000-0000-000000000001','demo_user_003','sent',NULL,now() - interval '3 hours',NULL,NULL,NULL,now() - interval '3 hours'),
  ('72000000-0000-0000-0000-000000000004','70000000-0000-0000-0000-000000000001','demo_user_006','failed',NULL,NULL,NULL,NULL,NULL,now() - interval '3 hours'),
  ('72000000-0000-0000-0000-000000000005','70000000-0000-0000-0000-000000000003','demo_user_004','answered',12,now() - interval '4 days',now() - interval '4 days' + interval '20 minutes',now() - interval '4 days' + interval '40 minutes',NULL,now() - interval '4 days'),
  ('72000000-0000-0000-0000-000000000006','70000000-0000-0000-0000-000000000003','demo_user_005','expired',NULL,now() - interval '4 days',NULL,NULL,now() - interval '3 days',now() - interval '4 days'),
  ('72000000-0000-0000-0000-000000000007','70000000-0000-0000-0000-000000000003','demo_user_007','answered',7,now() - interval '4 days',now() - interval '4 days' + interval '10 minutes',now() - interval '4 days' + interval '18 minutes',NULL,now() - interval '4 days');

INSERT INTO daily_survey_answers (id, delivery_id, survey_id, question_id, line_user_id, answer_value, answered_at)
VALUES
  ('73000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','demo_user_001','"good"'::jsonb,now() - interval '2 hours 50 minutes'),
  ('73000000-0000-0000-0000-000000000002','72000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000002','demo_user_001','"新しい案件が届いていたので良い気分です"'::jsonb,now() - interval '2 hours 49 minutes'),
  ('73000000-0000-0000-0000-000000000003','72000000-0000-0000-0000-000000000005','70000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000004','demo_user_004','"beauty"'::jsonb,now() - interval '4 days' + interval '40 minutes'),
  ('73000000-0000-0000-0000-000000000004','72000000-0000-0000-0000-000000000007','70000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000004','demo_user_007','"food"'::jsonb,now() - interval '4 days' + interval '18 minutes')
ON CONFLICT (delivery_id, question_id) DO UPDATE SET
  answer_value = EXCLUDED.answer_value,
  answered_at = EXCLUDED.answered_at;

-- 通知ログ・ポイント履歴。
INSERT INTO notification_logs (
  id, line_user_id, template_id, category, rendered_title, rendered_body, variables_used,
  status, line_message_id, error_message, sent_at, created_at
)
VALUES
  ('80000000-0000-0000-0000-000000000001','demo_user_001','40000000-0000-0000-0000-000000000007','project_intro','[デモ] 新しい案件が届きました','チョコアイス購入実態調査の参加対象です。','{"project_title":"チョコアイス購入実態調査","survey_url":"/liff/survey/31000000-0000-0000-0000-000000000001"}'::jsonb,'delivered','demo-msg-001',NULL,now() - interval '2 days',now() - interval '2 days'),
  ('80000000-0000-0000-0000-000000000002','demo_user_002','40000000-0000-0000-0000-000000000003','unanswered_reminder','[デモ] 回答期限が近づいています','チョコアイス購入実態調査の回答期限が近づいています。','{"project_title":"チョコアイス購入実態調査","deadline":"明日","survey_url":"/liff/survey/31000000-0000-0000-0000-000000000002"}'::jsonb,'sent','demo-msg-002',NULL,now() - interval '6 hours',now() - interval '6 hours'),
  ('80000000-0000-0000-0000-000000000003','demo_user_006','40000000-0000-0000-0000-000000000007','project_intro','[デモ] 新しい案件が届きました','会社員ランチ実態調査の参加対象です。','{"project_title":"会社員ランチ実態調査"}'::jsonb,'failed',NULL,'通知停止中',NULL,now() - interval '7 days'),
  ('80000000-0000-0000-0000-000000000004','demo_user_010','40000000-0000-0000-0000-000000000007','project_intro','[デモ] 新しい案件が届きました','チョコアイス購入実態調査の参加対象です。','{"project_title":"チョコアイス購入実態調査"}'::jsonb,'failed',NULL,'ブロック済み',NULL,now() - interval '2 days'),
  ('80000000-0000-0000-0000-000000000005','demo_user_001','40000000-0000-0000-0000-000000000001','daily_survey','[デモ] 今日のアンケート','今日のかんたんアンケートが届きました。','{"survey_id":"70000000-0000-0000-0000-000000000001"}'::jsonb,'delivered','demo-msg-005',NULL,now() - interval '3 hours',now() - interval '3 hours');

INSERT INTO point_histories (id, line_user_id, transaction_type, points, reason, reference_type, reference_id, created_at)
VALUES
  ('81000000-0000-0000-0000-000000000001','demo_user_001','project_completion',80,'[デモ] チョコアイス購入実態調査 回答完了','project_assignment','31000000-0000-0000-0000-000000000001',now() - interval '2 days'),
  ('81000000-0000-0000-0000-000000000002','demo_user_001','daily_survey',5,'[デモ] 今日の気分 回答','daily_survey_answer','72000000-0000-0000-0000-000000000001',now() - interval '2 hours 50 minutes'),
  ('81000000-0000-0000-0000-000000000003','demo_user_004','project_completion',120,'[デモ] 美容室利用実態アンケート 回答完了','project_assignment','31000000-0000-0000-0000-000000000004',now() - interval '21 hours'),
  ('81000000-0000-0000-0000-000000000004','demo_user_004','campaign_bonus',30,'[デモ] 美容関心層ボーナス','campaign','50000000-0000-0000-0000-000000000003',now() - interval '20 hours'),
  ('81000000-0000-0000-0000-000000000005','demo_user_007','daily_survey',7,'[デモ] 最近買った商品 回答','daily_survey_answer','72000000-0000-0000-0000-000000000007',now() - interval '4 days'),
  ('81000000-0000-0000-0000-000000000006','demo_user_005','attribute_update',10,'[デモ] プロフィール更新協力','manual',NULL,now() - interval '6 days'),
  ('81000000-0000-0000-0000-000000000007','demo_user_009','project_completion',150,'[デモ] 健康食品に関する意識調査 回答完了','project_assignment','31000000-0000-0000-0000-000000000008',now() - interval '25 days'),
  ('81000000-0000-0000-0000-000000000008','demo_user_001','redemption',-100,'[デモ] ポイント交換申請','manual',NULL,now() - interval '1 day')
ON CONFLICT (id) DO NOTHING;

INSERT INTO user_points (line_user_id, total_points, available_points, lifetime_points, updated_at)
VALUES
  ('demo_user_001', 780, 680, 900, now() - interval '1 day'),
  ('demo_user_002', 340, 340, 340, now() - interval '1 day'),
  ('demo_user_003', 260, 260, 260, now() - interval '4 days'),
  ('demo_user_004', 1260, 1260, 1260, now() - interval '20 hours'),
  ('demo_user_005', 80, 80, 90, now() - interval '6 days'),
  ('demo_user_006', 120, 120, 120, now() - interval '45 days'),
  ('demo_user_007', 620, 620, 620, now() - interval '4 days'),
  ('demo_user_008', 60, 60, 60, now() - interval '1 day'),
  ('demo_user_009', 420, 420, 420, now() - interval '25 days'),
  ('demo_user_010', 40, 40, 40, now() - interval '20 days')
ON CONFLICT (line_user_id) DO UPDATE SET
  total_points = EXCLUDED.total_points,
  available_points = EXCLUDED.available_points,
  lifetime_points = EXCLUDED.lifetime_points,
  updated_at = EXCLUDED.updated_at;

INSERT INTO reward_campaigns (
  id, name, description, campaign_type, bonus_points, condition_type, condition_value,
  target_segment_id, start_at, end_at, is_active, created_at, updated_at
)
VALUES
  ('82000000-0000-0000-0000-000000000001','[デモ] 週末回答ボーナス','週末に回答したユーザーへ追加ポイント。','seasonal',20,'date_range','{"days":["saturday","sunday"]}'::jsonb,'10000000-0000-0000-0000-000000000008',now() - interval '3 days',now() + interval '4 days',true,now() - interval '5 days',now() - interval '1 day'),
  ('82000000-0000-0000-0000-000000000002','[デモ] 休眠ユーザー復帰ボーナス','休眠ユーザーの復帰促進。','dormancy_recovery',50,'manual','{"last_login_days_gte":30}'::jsonb,'10000000-0000-0000-0000-000000000009',now() - interval '10 days',now() + interval '20 days',true,now() - interval '10 days',now() - interval '2 days');

-- データ管理画面用。
INSERT INTO ng_words (word, category, is_active)
VALUES
  ('[デモ] 禁止ワード確認用', 'general', true),
  ('[デモ] 無効NGワード', 'other', false)
ON CONFLICT (word) DO UPDATE SET
  category = EXCLUDED.category,
  is_active = EXCLUDED.is_active;

INSERT INTO post_categories (category_type, name, description, sort_order, is_active)
VALUES
  ('diary', '[デモ] 健康メモ', '健康系の日記カテゴリ確認用。', 210, true),
  ('diary', '[デモ] 買い物記録', '購買系の日記カテゴリ確認用。', 220, true),
  ('rant', '[デモ] サービス不満', '不満投稿カテゴリ確認用。', 210, true),
  ('rant', '[デモ] 無効カテゴリ', '無効カテゴリの表示確認用。', 220, false)
ON CONFLICT (category_type, name) DO UPDATE SET
  description = EXCLUDED.description,
  sort_order = EXCLUDED.sort_order,
  is_active = EXCLUDED.is_active;

COMMIT;
