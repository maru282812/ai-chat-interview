-- ============================================================
-- Migration 034: 通知テンプレート初期データ
-- 仕様書記載の全カテゴリ × 代表テンプレートを投入
-- ============================================================

INSERT INTO notification_templates (
  category, name, description, message_type,
  title_text, body_text, action_label, action_url,
  variables, is_active, is_default
) VALUES

-- ----------------------------------------------------------------
-- デイリーアンケート: 今日の1問（固定ポイント）
-- ----------------------------------------------------------------
(
  'daily_survey',
  '今日の1問（固定ポイント）',
  '毎日のアンケート通知。固定ポイント版。',
  'text',
  NULL,
  E'📢 今日の1問が届きました\n\n回答時間：約30秒\n\n🎁 {point}pt獲得\n\n今すぐ回答する\n{surveyUrl}',
  '回答する',
  '{surveyUrl}',
  ARRAY['{point}', '{surveyUrl}'],
  true,
  true
),

-- ----------------------------------------------------------------
-- デイリーアンケート: ランダム報酬版
-- ----------------------------------------------------------------
(
  'daily_survey',
  '今日の1問（ランダム報酬）',
  '毎日のアンケート通知。ランダムポイント版。',
  'text',
  NULL,
  E'🎁 今日のアンケート\n\n回答すると\n3〜20ptのどれかが当たります\n\nチャレンジする\n{surveyUrl}',
  'チャレンジする',
  '{surveyUrl}',
  ARRAY['{surveyUrl}'],
  true,
  false
),

-- ----------------------------------------------------------------
-- デイリーアンケート: 連続回答訴求版
-- ----------------------------------------------------------------
(
  'daily_survey',
  '連続回答訴求',
  '連続回答ストリーク訴求版の通知。',
  'text',
  NULL,
  E'🔥 {streakDays}日連続回答中\n\nあと{daysToBonus}日で\n{bonusPoint}ptボーナス\n\n本日のアンケートはこちら\n{surveyUrl}',
  '回答する',
  '{surveyUrl}',
  ARRAY['{streakDays}', '{daysToBonus}', '{bonusPoint}', '{surveyUrl}'],
  true,
  false
),

-- ----------------------------------------------------------------
-- 未回答リマインド
-- ----------------------------------------------------------------
(
  'unanswered_reminder',
  '未回答リマインド',
  '当日中に回答がないユーザーへのリマインド。',
  'text',
  NULL,
  E'⏰ 本日のアンケートが未回答です\n\n回答期限\n{expireDate}\n\n回答すると\n{point}pt獲得できます\n\n{surveyUrl}',
  '今すぐ回答',
  '{surveyUrl}',
  ARRAY['{expireDate}', '{point}', '{surveyUrl}'],
  true,
  true
),

-- ----------------------------------------------------------------
-- 回答完了
-- ----------------------------------------------------------------
(
  'answer_complete',
  '回答完了',
  '回答完了時のサンクスメッセージ。',
  'text',
  NULL,
  E'ありがとうございます\n\n🎉 {point}pt獲得\n\n現在の保有ポイント\n{totalPoint}pt',
  NULL,
  NULL,
  ARRAY['{point}', '{totalPoint}'],
  true,
  true
),

-- ----------------------------------------------------------------
-- ランクアップ
-- ----------------------------------------------------------------
(
  'rank_up',
  'ランクアップ通知',
  'ランクが上がった際の通知。',
  'text',
  NULL,
  E'🎉 ランクアップしました\n\n現在のランク\n{rankName}\n\n今後はさらに高ポイント案件へ参加できます',
  NULL,
  NULL,
  ARRAY['{rankName}'],
  true,
  true
),

-- ----------------------------------------------------------------
-- ポイント大量付与（ボーナス達成）
-- ----------------------------------------------------------------
(
  'bonus_achieved',
  'ボーナス達成通知',
  'ストリークボーナス等の大量ポイント付与時。',
  'text',
  NULL,
  E'おめでとうございます\n\n特別ボーナス\n{bonusPoint}pt付与\n\n現在ポイント\n{totalPoint}pt',
  NULL,
  NULL,
  ARRAY['{bonusPoint}', '{totalPoint}'],
  true,
  true
),

-- ----------------------------------------------------------------
-- ポイント付与（通常）
-- ----------------------------------------------------------------
(
  'point_grant',
  'ポイント付与通知',
  '通常のポイント付与時の通知。',
  'text',
  NULL,
  E'🎁 {point}ptが付与されました\n\n現在の保有ポイント\n{totalPoint}pt\n\nいつもご参加ありがとうございます',
  NULL,
  NULL,
  ARRAY['{point}', '{totalPoint}'],
  true,
  true
),

-- ----------------------------------------------------------------
-- 誕生日
-- ----------------------------------------------------------------
(
  'birthday',
  '誕生日特別ボーナス',
  '誕生日ユーザーへの特別通知。',
  'text',
  NULL,
  E'🎂 お誕生日おめでとうございます\n\n特別ボーナス\n100ptプレゼント\n\n素敵な1年になりますように',
  NULL,
  NULL,
  ARRAY['{nickname}'],
  true,
  true
),

-- ----------------------------------------------------------------
-- 休眠復帰
-- ----------------------------------------------------------------
(
  'dormancy_recovery',
  '休眠復帰キャンペーン',
  '長期未回答ユーザーへの復帰促進通知。',
  'text',
  NULL,
  E'お久しぶりです\n\n現在限定アンケートを配信中です\n\n回答すると\n通常より多いポイントを獲得できます\n\n{surveyUrl}',
  '参加する',
  '{surveyUrl}',
  ARRAY['{nickname}', '{surveyUrl}'],
  true,
  true
),

-- ----------------------------------------------------------------
-- 属性更新依頼
-- ----------------------------------------------------------------
(
  'attribute_update_request',
  '登録情報更新依頼',
  'プロフィール情報が不足しているユーザーへの更新依頼。',
  'text',
  NULL,
  E'登録情報の確認をお願いします\n\n回答時間：約1分\n\n回答すると\n20pt獲得できます\n\n{surveyUrl}',
  '回答する',
  '{surveyUrl}',
  ARRAY['{surveyUrl}'],
  true,
  true
),

-- ----------------------------------------------------------------
-- 案件案内
-- ----------------------------------------------------------------
(
  'project_intro',
  '調査案件案内',
  'マッチした調査案件のご案内。',
  'text',
  NULL,
  E'あなたに合った調査案件が届いています\n\n謝礼\n{projectReward}\n\n参加はこちら\n{surveyUrl}',
  '参加する',
  '{surveyUrl}',
  ARRAY['{projectTitle}', '{projectReward}', '{surveyUrl}'],
  true,
  true
),

-- ----------------------------------------------------------------
-- システム通知
-- ----------------------------------------------------------------
(
  'system',
  'システム通知（汎用）',
  'メンテナンス・お知らせ等の汎用テンプレート。',
  'text',
  NULL,
  E'【お知らせ】\n\n{surveyTitle}\n\nご利用いただきありがとうございます。',
  NULL,
  NULL,
  ARRAY['{surveyTitle}'],
  true,
  false
)

ON CONFLICT DO NOTHING;

-- ============================================================
-- daily_question_priorities 初期データ
-- AI が不足属性を優先出題するためのルール
-- ============================================================
INSERT INTO daily_question_priorities (
  priority_type, attr_key, question_text, question_type,
  answer_options, sort_order, weight, is_active
) VALUES

-- 車所有
(
  'missing_attribute',
  'car_ownership',
  '車を所有していますか？',
  'single_choice',
  '[{"label": "所有している", "value": "yes"}, {"label": "所有していない", "value": "no"}, {"label": "家族が所有", "value": "family"}]',
  10, 20, true
),

-- ペット有無
(
  'missing_attribute',
  'pet_ownership',
  'ペットを飼っていますか？',
  'single_choice',
  '[{"label": "飼っている（犬）", "value": "dog"}, {"label": "飼っている（猫）", "value": "cat"}, {"label": "飼っている（その他）", "value": "other"}, {"label": "飼っていない", "value": "none"}]',
  20, 20, true
),

-- 子供有無
(
  'missing_attribute',
  'children',
  'お子さんはいますか？',
  'single_choice',
  '[{"label": "いる（未就学児）", "value": "preschool"}, {"label": "いる（小学生）", "value": "elementary"}, {"label": "いる（中学生以上）", "value": "junior_high_plus"}, {"label": "いない", "value": "none"}]',
  30, 20, true
),

-- 住宅形態
(
  'missing_attribute',
  'housing_type',
  'お住まいはどちらですか？',
  'single_choice',
  '[{"label": "持ち家（一戸建て）", "value": "owned_house"}, {"label": "持ち家（マンション）", "value": "owned_condo"}, {"label": "賃貸（アパート・マンション）", "value": "rental"}, {"label": "実家", "value": "parents_home"}, {"label": "その他", "value": "other"}]',
  40, 20, true
),

-- 買い物頻度
(
  'high_value_attribute',
  'shopping_frequency',
  'オンラインショッピングはどのくらい利用しますか？',
  'single_choice',
  '[{"label": "週1回以上", "value": "weekly"}, {"label": "月2〜3回", "value": "monthly_23"}, {"label": "月1回程度", "value": "monthly_1"}, {"label": "ほとんど使わない", "value": "rarely"}]',
  50, 15, true
)

ON CONFLICT DO NOTHING;
