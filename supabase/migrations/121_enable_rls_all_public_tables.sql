-- 121: public スキーマの全テーブルで RLS を有効化（Supabase セキュリティ警告 rls_disabled_in_public への対応）
--
-- 背景:
--   アプリ（Express / Workers）と hibi-site はサーバー側で service_role キーだけを使う。
--   service_role は RLS を素通りするため、ポリシー無しで RLS を有効にしてもアプリ動作は変わらない。
--   これまでは「anon / authenticated の権限を外す」方式で守っていたが、後から作ったテーブルの一部
--   （delivery_logs / delivery_templates / project_applications / project_concepts /
--    project_favorites / questionnaire_snapshots）と view v_user_point_summary で外し漏れがあり、
--   公開キー（anon key）だけで読み書き・削除できる状態だった。
--
-- 方針（非破壊。データ・列は一切変更しない）:
--   1. RLS 無効の public テーブルを全部 RLS 有効化（ポリシー無し＝anon/authenticated は全拒否）
--   2. 外し漏れの 6 テーブルと view から anon / authenticated の権限を剥奪
--   3. view は security_invoker にして、下のテーブルの RLS を経由させる
--   4. 今後作るテーブルで同じ漏れが起きないよう、既定権限から anon / authenticated を外す

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.relname);
  END LOOP;
END $$;

REVOKE ALL ON TABLE
  public.delivery_logs,
  public.delivery_templates,
  public.project_applications,
  public.project_concepts,
  public.project_favorites,
  public.questionnaire_snapshots
FROM anon, authenticated;

ALTER VIEW public.v_user_point_summary SET (security_invoker = true);
REVOKE ALL ON TABLE public.v_user_point_summary FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
