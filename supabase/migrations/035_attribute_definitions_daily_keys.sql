-- ============================================================
-- Migration 035: attribute_definitions にデイリー設問用の属性キー追加
-- daily_question_priorities で参照する attr_key を事前登録
-- ============================================================

INSERT INTO attribute_definitions (attr_key, label, category, data_type, is_user_editable, is_company_visible, sort_order)
VALUES
  ('car_ownership',      '車所有',           'lifestyle', 'text',    false, true,  130),
  ('pet_ownership',      'ペット有無',        'lifestyle', 'text',    false, true,  140),
  ('children',           '子供有無・年齢',    'lifestyle', 'text',    false, true,  150),
  ('housing_type',       '住宅形態',          'lifestyle', 'text',    false, true,  160),
  ('shopping_frequency', 'ネット購買頻度',    'lifestyle', 'text',    false, true,  170),
  ('annual_income',      '世帯年収',          'lifestyle', 'text',    false, true,  180),
  ('occupation',         '職業',              'basic',     'text',    true,  true,  190),
  ('education',          '最終学歴',          'basic',     'text',    true,  false, 200)
ON CONFLICT (attr_key) DO NOTHING;
