-- Add user-facing display title separate from internal project name.
-- user_display_title: shown in LIFF survey, LINE messages, and other user-visible surfaces.
-- Falls back to name when null.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS user_display_title text;
