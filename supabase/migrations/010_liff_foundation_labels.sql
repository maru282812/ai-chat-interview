insert into liff_entrypoints (
  entry_key,
  title,
  path,
  entry_type,
  settings_json,
  is_active
)
values
  ('rant', '本音・悩み投稿', '/liff/rant', 'rant', '{}'::jsonb, true),
  ('diary', '今日の気持ち・日記', '/liff/diary', 'diary', '{}'::jsonb, true),
  ('personality', '性格診断', '/liff/personality', 'personality', '{}'::jsonb, true)
on conflict (entry_key) do update
set
  title = excluded.title,
  path = excluded.path,
  entry_type = excluded.entry_type,
  settings_json = coalesce(liff_entrypoints.settings_json, '{}'::jsonb),
  is_active = excluded.is_active;

update line_menu_actions
set
  label = '本音・悩み投稿',
  liff_path = 'rant',
  action_payload = jsonb_set(
    coalesce(action_payload, '{}'::jsonb),
    '{prompt}',
    to_jsonb('本音や悩みがあれば、そのまま送ってください。長文でも問題ありません。'::text),
    true
  )
where menu_key = 'share_rant';

update line_menu_actions
set
  label = '今日の気持ち・日記',
  liff_path = 'diary',
  action_payload = jsonb_set(
    coalesce(action_payload, '{}'::jsonb),
    '{prompt}',
    to_jsonb('今日の気持ちや出来事を自由に送ってください。短くても長くても大丈夫です。'::text),
    true
  )
where menu_key = 'today_feeling';

update line_menu_actions
set
  label = '性格診断',
  liff_path = 'personality'
where menu_key = 'personality';
