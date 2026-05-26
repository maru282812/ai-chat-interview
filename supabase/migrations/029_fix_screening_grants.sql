-- -------------------------------------------------------
-- 029: screening_conditions テーブルの権限修正
-- 028 で GRANT が欠落していた環境向けの修正
-- -------------------------------------------------------

-- テーブルが存在する場合のみ適用
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
      and table_name = 'screening_conditions'
  ) then
    -- RLS 有効化
    alter table screening_conditions enable row level security;

    -- 権限付与
    grant select, insert, update, delete on table screening_conditions
      to service_role, authenticated, anon;

    -- service_role bypass policy（存在しない場合のみ作成）
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public'
        and tablename = 'screening_conditions'
        and policyname = 'service_role_all'
    ) then
      execute '
        create policy "service_role_all" on screening_conditions
          as permissive for all
          to service_role
          using (true)
          with check (true)
      ';
    end if;
  end if;
end $$;
