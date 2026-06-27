-- 067_document_usage_category.sql
-- 書類の「用途区分」を追加し、重複書類を論理アーカイブする。
--
-- 背景: documents には document_type（中身のラベル）と is_active / is_required_global
-- しか軸がなく、「誰に・どこで・同意を取るのか」を表現できていなかった。
-- 直交する usage_category 軸を追加し、配布・同意ロジックの主軸とする。
--
-- 併せて、063 で取り込んだ詳細な「回答者向け利用規約 v1.1」に内容が吸収された
-- 旧 045 の単純書類（ポイント/アンケート参加/インタビュー参加/データ利用/第三者提供）を
-- is_active=false で論理アーカイブする（物理削除はしない＝045 の削除禁止ポリシー準拠）。

BEGIN;

-- ── 用途区分カラム ──────────────────────────────────────────────────────────
--   consent_global  : 全回答者が登録時に同意必須（利用規約・PP）
--   consent_project : 案件単位で同意（案件別同意書）
--   public          : 公開・閲覧のみ（同意不要）
--   b2b_contract    : 企業向け契約・締結テンプレ（LIFF 外）
--   internal        : 社内文書・実装参照（非配布）
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS usage_category TEXT NOT NULL DEFAULT 'internal';

DO $$ BEGIN
  ALTER TABLE documents
    ADD CONSTRAINT chk_documents_usage_category
    CHECK (usage_category IN (
      'consent_global', 'consent_project', 'public', 'b2b_contract', 'internal'
    ));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 14 書類の用途区分バックフィル ──────────────────────────────────────────
-- 回答者・登録時同意（global）
UPDATE documents SET usage_category = 'consent_global'
  WHERE id IN (
    'd0000000-0000-0000-0000-000000000001',  -- 回答者向け利用規約
    'd0000000-0000-0000-0000-000000000002',  -- プライバシーポリシー
    'd0000000-0000-0000-0000-000000000003'   -- ポイント利用規約（このあとアーカイブ）
  );

-- 案件別同意（いずれも利用規約 v1.1 に吸収済み・このあとアーカイブ）
UPDATE documents SET usage_category = 'consent_project'
  WHERE id IN (
    'd0000000-0000-0000-0000-000000000004',  -- アンケート参加規約
    'd0000000-0000-0000-0000-000000000005',  -- インタビュー参加規約
    'd0000000-0000-0000-0000-000000000006',  -- データ利用同意書
    'd0000000-0000-0000-0000-000000000007'   -- 第三者提供同意書
  );

-- 公開・閲覧のみ
UPDATE documents SET usage_category = 'public'
  WHERE id = '63000000-0000-0000-0000-000000000004';  -- セキュリティ方針

-- 企業向け契約・締結テンプレ
UPDATE documents SET usage_category = 'b2b_contract'
  WHERE id IN (
    '63000000-0000-0000-0000-000000000005',  -- 企業向け利用規約
    '63000000-0000-0000-0000-000000000011',  -- NDAテンプレート
    '63000000-0000-0000-0000-000000000012'   -- 個別契約覚書テンプレート
  );

-- 社内文書・実装参照（非配布）
UPDATE documents SET usage_category = 'internal'
  WHERE id IN (
    '63000000-0000-0000-0000-000000000003',  -- LINE登録時同意文（文面テンプレ集）
    '63000000-0000-0000-0000-000000000006',  -- 委託先管理台帳
    '63000000-0000-0000-0000-000000000007'   -- 漏えい時対応手順
  );

-- ── 重複書類の論理アーカイブ ────────────────────────────────────────────────
-- 回答者向け利用規約 v1.1（063）に内容が吸収されたため、回答者への同意取得から外す。
-- user_consent_records は監査用に温存（is_active=false で listGlobalRequired 等から除外される）。
UPDATE documents
  SET is_active = false,
      is_required_global = false,
      updated_at = now()
  WHERE id IN (
    'd0000000-0000-0000-0000-000000000003',  -- ポイント利用規約（global 必須も解除）
    'd0000000-0000-0000-0000-000000000004',  -- アンケート参加規約
    'd0000000-0000-0000-0000-000000000005',  -- インタビュー参加規約
    'd0000000-0000-0000-0000-000000000006',  -- データ利用同意書
    'd0000000-0000-0000-0000-000000000007'   -- 第三者提供同意書
  );

-- ── セキュリティ方針を公開化 ────────────────────────────────────────────────
-- 取り込み時は is_active=false だったが、公開・閲覧用途のため有効化する。
UPDATE documents
  SET is_active = true,
      updated_at = now()
  WHERE id = '63000000-0000-0000-0000-000000000004';

COMMIT;
