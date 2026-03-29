insert into liff_entrypoints (
  entry_key,
  title,
  path,
  entry_type,
  settings_json,
  is_active
)
values
  ('rant', '本音・悩み', '/liff/rant', 'rant', '{}'::jsonb, true),
  ('diary', '今日の気持ち', '/liff/diary', 'diary', '{}'::jsonb, true),
  ('personality', '性格診断', '/liff/personality', 'personality', '{}'::jsonb, true)
on conflict (entry_key) do update
set
  title = excluded.title,
  path = excluded.path,
  entry_type = excluded.entry_type,
  settings_json = excluded.settings_json,
  is_active = excluded.is_active;

update line_menu_actions
set liff_path = 'rant'
where menu_key = 'share_rant';

update line_menu_actions
set liff_path = 'diary'
where menu_key = 'today_feeling';

update line_menu_actions
set liff_path = 'personality'
where menu_key = 'personality';
