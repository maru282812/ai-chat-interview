-- ============================================================
-- 054: プロンプトパッケージ管理
-- 目的: プロジェクト個別設定に加え、共通の「プロンプトパッケージ」を
--       定義・バージョン管理し、各プロジェクトで選択できるようにする
-- 設計方針:
--   - 既存プロジェクトは ai_prompt_mode = 'custom' のまま動作し影響ゼロ
--   - ai_logs はFKなしスナップショット方式（監査ログとして削除・変更の影響を受けない）
--   - slug の変更禁止・published 切替・version 採番はアプリ側で管理（Phase 2〜4）
-- ============================================================

-- ────────────────────────────────────────────────
-- 1. prompt_packages
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prompt_packages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text        NOT NULL UNIQUE,
  name        text        NOT NULL,
  description text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE  prompt_packages            IS 'プロンプトパッケージ定義。標準インタビュー用・女性向け・ビジネス向けなどをパッケージ化する';
COMMENT ON COLUMN prompt_packages.slug       IS '識別子（URL・ai_logs 非正規化コピーに使用）。公開後は管理画面で編集不可とする運用ルールで保護';
COMMENT ON COLUMN prompt_packages.name       IS '管理画面表示名';
COMMENT ON COLUMN prompt_packages.description IS 'パッケージ説明';

-- ────────────────────────────────────────────────
-- 2. prompt_package_versions
-- ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS prompt_package_versions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id   uuid        NOT NULL REFERENCES prompt_packages(id) ON DELETE CASCADE,
  version_no   integer     NOT NULL,
  status       text        NOT NULL DEFAULT 'draft'
                           CHECK (status IN ('draft', 'published', 'archived')),
  policy_json  jsonb,
  templates_json jsonb,
  change_note  text,
  published_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),

  UNIQUE (package_id, version_no)
);

COMMENT ON TABLE  prompt_package_versions                IS 'パッケージのバージョン履歴。published は同一パッケージ内で1件のみ（アプリ側で管理）';
COMMENT ON COLUMN prompt_package_versions.version_no     IS 'パッケージ内自動採番（1始まり）。採番競合は INSERT 時に MAX+1 で回避（アプリ側）';
COMMENT ON COLUMN prompt_package_versions.status         IS 'draft | published | archived。published→archived の自動移行は Phase 4 で実装';
COMMENT ON COLUMN prompt_package_versions.policy_json    IS 'AIPromptPolicy 相当の設定（疎な定義可）';
COMMENT ON COLUMN prompt_package_versions.templates_json IS 'AIPromptTemplateMap 相当（疎な定義可。未定義キーは BASE_PROMPT_TEMPLATES にフォールバック）';
COMMENT ON COLUMN prompt_package_versions.change_note    IS '変更メモ（管理者向け）';

-- ────────────────────────────────────────────────
-- 3. projects テーブルへのカラム追加
-- ────────────────────────────────────────────────
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ai_prompt_mode               text    NOT NULL DEFAULT 'custom'
                                                        CHECK (ai_prompt_mode IN ('custom', 'package')),
  ADD COLUMN IF NOT EXISTS ai_prompt_package_version_id uuid    REFERENCES prompt_package_versions(id) ON DELETE SET NULL;

COMMENT ON COLUMN projects.ai_prompt_mode               IS 'custom = プロジェクト個別設定（従来通り） / package = パッケージバージョン適用';
COMMENT ON COLUMN projects.ai_prompt_package_version_id IS 'ai_prompt_mode = package のとき参照するバージョン。パッケージ削除時は SET NULL（アプリ側で custom にフォールバック）';

-- ────────────────────────────────────────────────
-- 4. ai_logs テーブルへのカラム追加
-- （FKなし・スナップショット方式。削除・変更の影響を受けない監査ログ）
-- ────────────────────────────────────────────────
ALTER TABLE ai_logs
  ADD COLUMN IF NOT EXISTS package_id         uuid,
  ADD COLUMN IF NOT EXISTS package_version_id uuid,
  ADD COLUMN IF NOT EXISTS package_slug       text,
  ADD COLUMN IF NOT EXISTS package_version_no integer;

COMMENT ON COLUMN ai_logs.package_id         IS 'パッケージID（FKなしスナップショット）';
COMMENT ON COLUMN ai_logs.package_version_id IS 'パッケージバージョンID（FKなしスナップショット）';
COMMENT ON COLUMN ai_logs.package_slug       IS 'パッケージslugの非正規化コピー（削除後も追跡可能）';
COMMENT ON COLUMN ai_logs.package_version_no IS 'パッケージバージョン番号の非正規化コピー（削除後も追跡可能）';

-- template_mode の許容値コメント更新: 'package_template' が Phase 3 で追加される
COMMENT ON COLUMN ai_logs.template_mode IS 'legacy | base_template | custom_template | package_template（Phase 3 追加）';

-- ────────────────────────────────────────────────
-- 5. GRANT / RLS
-- （管理画面からのみ操作。service_role フルアクセスで十分）
-- ────────────────────────────────────────────────
GRANT SELECT, INSERT, UPDATE, DELETE ON prompt_packages         TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON prompt_package_versions TO service_role;

-- RLS は既存の projects / ai_logs に従う（追加カラムは自動的にカバー）
-- 新テーブルは管理者専用のため RLS 無効のまま（service_role のみアクセス）
ALTER TABLE prompt_packages         DISABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_package_versions DISABLE ROW LEVEL SECURITY;
