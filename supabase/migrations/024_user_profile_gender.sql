-- Phase2: user_profiles に gender カラムを追加
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS gender TEXT
    CHECK (gender IN ('male', 'female', 'other', 'prefer_not_to_say'));
