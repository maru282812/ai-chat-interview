-- 045_documents_consents.sql
-- 規約・同意管理機能
-- documents: 書類マスタ（利用規約・PP等）
-- document_versions: 本文バージョン履歴（上書き禁止・追記のみ）
-- user_consent_records: ユーザー同意証跡（物理削除禁止）
-- project_document_requirements: 案件ごとの必須/任意同意書設定

BEGIN;

-- ── 書類種別 ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE document_type AS ENUM (
    'terms_of_service',
    'privacy_policy',
    'survey_participation',
    'interview_participation',
    'point_service',
    'data_usage',
    'third_party_sharing',
    'campaign_terms',
    'project_specific'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 書類マスタ ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type      document_type NOT NULL,
  title              TEXT        NOT NULL,
  description        TEXT,
  -- current_version_id は後で FK を追加（循環参照回避のため DEFERRABLE）
  current_version_id UUID,
  is_active          BOOLEAN     NOT NULL DEFAULT true,
  -- 全体同意で必須とするか（ログイン時チェック対象）
  is_required_global BOOLEAN     NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── バージョン履歴 ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_versions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id    UUID        NOT NULL REFERENCES documents(id),
  version_no     TEXT        NOT NULL,          -- 例: "1.0", "2.1"
  content        TEXT        NOT NULL,          -- 本文（Markdown 可）
  change_reason  TEXT,                          -- 改定理由
  effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
  effective_to   TIMESTAMPTZ,                   -- NULL = 最新版
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by     TEXT        NOT NULL DEFAULT 'admin',
  UNIQUE (document_id, version_no)
);

-- current_version_id の FK（バージョン挿入後に設定可能なよう DEFERRABLE）
DO $$ BEGIN
  ALTER TABLE documents
    ADD CONSTRAINT fk_documents_current_version
    FOREIGN KEY (current_version_id)
    REFERENCES document_versions(id)
    DEFERRABLE INITIALLY DEFERRED;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── ユーザー同意証跡 ───────────────────────────────────────────────────────
-- 物理削除禁止。deleted_at による論理削除のみ。
CREATE TABLE IF NOT EXISTS user_consent_records (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id        TEXT        NOT NULL,
  document_id         UUID        NOT NULL REFERENCES documents(id),
  document_version_id UUID        NOT NULL REFERENCES document_versions(id),
  -- 案件単位の同意の場合のみ設定
  project_id          UUID        REFERENCES projects(id),
  consented_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- 'liff' | 'admin' | 'import' など
  consent_source      TEXT        NOT NULL DEFAULT 'liff',
  ip_address          TEXT,
  user_agent          TEXT,
  -- 論理削除用（削除不可ポリシーのため運用上はほぼ NULL のまま）
  deleted_at          TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ucr_line_user    ON user_consent_records(line_user_id);
CREATE INDEX IF NOT EXISTS idx_ucr_document     ON user_consent_records(document_id);
CREATE INDEX IF NOT EXISTS idx_ucr_version      ON user_consent_records(document_version_id);
CREATE INDEX IF NOT EXISTS idx_ucr_project      ON user_consent_records(project_id) WHERE project_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ucr_consented_at ON user_consent_records(consented_at DESC);

-- ── 案件×書類 関連 ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_document_requirements (
  project_id   UUID    NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  document_id  UUID    NOT NULL REFERENCES documents(id),
  is_required  BOOLEAN NOT NULL DEFAULT true,  -- true=必須 / false=任意
  sort_order   INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, document_id)
);

-- ── updated_at 自動更新 ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- 既存トリガーが存在する場合はスキップ（同名の関数・トリガーが他テーブルにもある可能性）
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'trg_documents_updated_at'
  ) THEN
    EXECUTE $trig$
      CREATE TRIGGER trg_documents_updated_at
      BEFORE UPDATE ON documents
      FOR EACH ROW EXECUTE FUNCTION set_updated_at();
    $trig$;
  END IF;
END;
$$;

-- ── 初期書類マスタ（グローバル必須3書類） ──────────────────────────────────
INSERT INTO documents (id, document_type, title, description, is_active, is_required_global)
VALUES
  ('d0000000-0000-0000-0000-000000000001', 'terms_of_service',
   '利用規約', 'サービス全般の利用規約', true, true),
  ('d0000000-0000-0000-0000-000000000002', 'privacy_policy',
   'プライバシーポリシー', '個人情報の取り扱いについて', true, true),
  ('d0000000-0000-0000-0000-000000000003', 'point_service',
   'ポイント利用規約', 'ポイントサービスの利用規約', true, true),
  ('d0000000-0000-0000-0000-000000000004', 'survey_participation',
   'アンケート参加規約', 'アンケート参加時の同意事項', true, false),
  ('d0000000-0000-0000-0000-000000000005', 'interview_participation',
   'インタビュー参加規約', 'インタビュー参加時の同意・録音利用', true, false),
  ('d0000000-0000-0000-0000-000000000006', 'data_usage',
   'データ利用同意書', '回答データの分析・活用に関する同意', true, false),
  ('d0000000-0000-0000-0000-000000000007', 'third_party_sharing',
   '第三者提供同意書', '匿名加工後の企業レポートへの利用', true, false)
ON CONFLICT (id) DO NOTHING;

-- ── 初期バージョン（v1.0） ─────────────────────────────────────────────────
INSERT INTO document_versions (id, document_id, version_no, content, change_reason, effective_from, created_by)
VALUES
  ('f0000000-0000-0000-0000-000000000001', 'd0000000-0000-0000-0000-000000000001', '1.0',
   '# 利用規約

## 第1条（目的）
本規約は、当サービス（以下「本サービス」）の利用条件を定めるものです。

## 第2条（利用資格）
本サービスは、18歳以上の方を対象とします。

## 第3条（禁止事項）
- 虚偽の情報の登録
- 他のユーザーへの迷惑行為
- サービスの不正利用

## 第4条（免責事項）
当社は、本サービスの利用により生じた損害について、責任を負いません。

## 第5条（規約の変更）
当社は、必要に応じて本規約を変更できます。変更の場合は事前にお知らせします。
',
   '初版', now(), 'admin'),

  ('f0000000-0000-0000-0000-000000000002', 'd0000000-0000-0000-0000-000000000002', '1.0',
   '# プライバシーポリシー

## 1. 収集する情報
- 氏名・生年月日・居住地域などのプロフィール情報
- アンケート・インタビューへの回答内容
- 利用状況・アクセスログ

## 2. 利用目的
- サービスの提供・改善
- マーケティングリサーチへの活用（匿名加工後）
- ポイント管理・付与

## 3. 第三者提供
法令に基づく場合、または同意を得た場合を除き、第三者へは提供しません。

## 4. 安全管理
適切なセキュリティ対策を実施し、個人情報を保護します。

## 5. お問い合わせ
個人情報に関するお問い合わせは、コンタクトフォームよりご連絡ください。
',
   '初版', now(), 'admin'),

  ('f0000000-0000-0000-0000-000000000003', 'd0000000-0000-0000-0000-000000000003', '1.0',
   '# ポイント利用規約

## 第1条（ポイントの付与）
アンケートやインタビューへの回答完了により、所定のポイントを付与します。

## 第2条（ポイントの有効期限）
最終回答日から1年間有効です。期限を過ぎたポイントは失効します。

## 第3条（ポイントの交換）
所定のポイント数に達した場合、特典と交換できます。詳細は別途告知します。

## 第4条（ポイントの取消）
不正行為が確認された場合、付与済みポイントを取り消す場合があります。

## 第5条（サービス終了時の取扱）
サービス終了時のポイントの取扱については、別途お知らせします。
',
   '初版', now(), 'admin'),

  ('f0000000-0000-0000-0000-000000000004', 'd0000000-0000-0000-0000-000000000004', '1.0',
   '# アンケート参加規約

## 同意事項
1. 回答内容は研究・マーケティング目的で利用されます
2. 回答は匿名加工された上で集計・分析されます
3. 個人を特定できる形での公開は行いません
4. 回答の途中中断は自由です
5. ポイントは回答完了時に付与されます
',
   '初版', now(), 'admin'),

  ('f0000000-0000-0000-0000-000000000005', 'd0000000-0000-0000-0000-000000000005', '1.0',
   '# インタビュー参加規約

## 同意事項
1. 発言内容はAIによる分析に利用されます
2. 録音・テキスト化されたデータは安全に管理されます
3. 個人を特定できる情報は除去した上で分析します
4. 分析結果はレポート形式で企業に提供される場合があります
5. 参加中止はいつでも可能です
',
   '初版', now(), 'admin'),

  ('f0000000-0000-0000-0000-000000000006', 'd0000000-0000-0000-0000-000000000006', '1.0',
   '# データ利用同意書

## 利用目的
回答データを以下の目的で利用することに同意をお願いします。

1. **集計・分析**: 統計処理を行い、個人を特定しない形で分析します
2. **AI分析**: 回答パターンの分析にAIを活用します
3. **属性推定**: 回答傾向から属性・嗜好を推定し、より適切な案件を提案します

## 注意事項
- 個人情報は匿名加工後にのみ利用されます
- いつでも同意を撤回できます（ただし既に実施した分析への影響はありません）
',
   '初版', now(), 'admin'),

  ('f0000000-0000-0000-0000-000000000007', 'd0000000-0000-0000-0000-000000000007', '1.0',
   '# 第三者提供同意書

## 提供先
調査を依頼した企業（クライアント企業）

## 提供内容
匿名加工済みの集計データ・分析レポート

## 提供しないもの
- 氏名・住所・連絡先などの個人識別情報
- LINE IDなどのアカウント情報

## 同意の撤回
同意を撤回した場合、以後の分析結果への反映を停止します。
ただし、同意撤回前に提供済みのデータは取り消せません。
',
   '初版', now(), 'admin')
ON CONFLICT (id) DO NOTHING;

-- current_version_id を設定
UPDATE documents SET current_version_id = 'f0000000-0000-0000-0000-000000000001' WHERE id = 'd0000000-0000-0000-0000-000000000001';
UPDATE documents SET current_version_id = 'f0000000-0000-0000-0000-000000000002' WHERE id = 'd0000000-0000-0000-0000-000000000002';
UPDATE documents SET current_version_id = 'f0000000-0000-0000-0000-000000000003' WHERE id = 'd0000000-0000-0000-0000-000000000003';
UPDATE documents SET current_version_id = 'f0000000-0000-0000-0000-000000000004' WHERE id = 'd0000000-0000-0000-0000-000000000004';
UPDATE documents SET current_version_id = 'f0000000-0000-0000-0000-000000000005' WHERE id = 'd0000000-0000-0000-0000-000000000005';
UPDATE documents SET current_version_id = 'f0000000-0000-0000-0000-000000000006' WHERE id = 'd0000000-0000-0000-0000-000000000006';
UPDATE documents SET current_version_id = 'f0000000-0000-0000-0000-000000000007' WHERE id = 'd0000000-0000-0000-0000-000000000007';

COMMIT;
