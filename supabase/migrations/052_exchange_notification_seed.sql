-- ポイント交換通知テンプレートの初期データ
-- exchange_approved : 承認時に送信
-- exchange_fulfilled: ギフト送付済み時に送信（URLはマイページで確認）

-- ============================================================
-- notification_templates.category CHECK 制約を拡張
-- 既存値を保持しつつ exchange_approved / exchange_fulfilled を追加
-- ============================================================
ALTER TABLE notification_templates
  DROP CONSTRAINT IF EXISTS notification_templates_category_check;

ALTER TABLE notification_templates
  ADD CONSTRAINT notification_templates_category_check
  CHECK (category IN (
    'daily_survey',
    'answer_complete',
    'unanswered_reminder',
    'bonus_achieved',
    'rank_up',
    'point_grant',
    'project_intro',
    'attribute_update_request',
    'birthday',
    'dormancy_recovery',
    'system',
    'exchange_approved',
    'exchange_fulfilled'
  ));

INSERT INTO notification_templates (
  category,
  name,
  description,
  message_type,
  body_text,
  action_label,
  action_url,
  variables,
  is_active,
  is_default
) VALUES
(
  'exchange_approved',
  '交換申請承認通知',
  'ポイント交換申請が承認されたことをユーザーに知らせる通知',
  'text',
  'ご申請いただいたポイント交換が承認されました！

【交換内容】
{points}pt → {amount_jpy}円相当のギフト

現在ギフトの準備中です。準備が完了したらまたご連絡しますので、もう少々お待ちください。',
  NULL,
  NULL,
  ARRAY['points', 'amount_jpy'],
  true,
  true
),
(
  'exchange_fulfilled',
  '交換ギフト送付通知',
  'ギフトURLが準備できたことをユーザーに知らせる通知（URLはマイページで確認）',
  'text',
  'ギフトのご用意ができました！

【交換内容】
{points}pt → {amount_jpy}円相当のギフト

マイページからギフトURLをご確認いただけます。
👉 {mypage_url}

有効期限がある場合はお早めにご利用ください。',
  NULL,
  NULL,
  ARRAY['points', 'amount_jpy', 'mypage_url'],
  true,
  true
)
ON CONFLICT DO NOTHING;
