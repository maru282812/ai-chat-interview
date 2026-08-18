-- 096_industry_templates_and_stores.sql
--
-- 「業種テンプレ → 法人 → 店舗 → 店舗ごとの案件」の階層を導入する。
--
-- 背景（これが無いと何が起きるか）:
--   entry_code は projects に直付けの UNIQUE なので、店舗ごとに案件が必要になる。
--   さらに cycle_group_steps の UNIQUE(project_id) により1案件は1サイクルにしか
--   属せないため、2店舗目のサイクルを作るには案件を丸ごと複製するしかなかった。
--   30店舗×3業種で案件90件を手作業で作る運用は現実的でない。
--
-- 方針:
--   案件の複製自体はやめない（設問も謝礼も店舗ごとに変える要件があるため、
--   案件を共有するとその要件を満たせない）。代わりに
--   「業種テンプレから店舗一式を一括生成する」形にして手作業を無くす。
--
-- 階層:
--   industry_templates（業種）… 美容室ABC / ネイルABC。設問の原本となる案件を指す
--     └ clients（法人）      … 既存テーブルを「法人」として使う（意味を変えない）
--         └ stores（店舗）   … 新設。ここが増える単位
--             └ projects     … 店舗ごとに複製された A/B/C。store_id で紐づく
--
-- 既存 partner_store_id との関係:
--   あちらは hibi-portal（別DB）の stores.id を持つ外部参照で、別軸。
--   本マイグレーションの stores は ai-chat-interview 側のマスタなので混同しない。
--
-- 破壊性: なし（新規テーブルと NULL 許容カラムの追加のみ）。
--   store_id / industry_template_id が NULL の案件＝従来どおりの単発案件。
-- rollback:
--   ALTER TABLE cycle_groups DROP COLUMN IF EXISTS store_id, DROP COLUMN IF EXISTS industry_template_id;
--   ALTER TABLE survey_cycles DROP COLUMN IF EXISTS store_id;
--   ALTER TABLE projects DROP COLUMN IF EXISTS store_id, DROP COLUMN IF EXISTS industry_template_id, DROP COLUMN IF EXISTS template_step_role;
--   DROP TABLE IF EXISTS stores;
--   DROP TABLE IF EXISTS industry_templates;

-- ------------------------------------------------------------------
-- 1. 業種テンプレート
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS industry_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,                    -- 「美容室ABCサイクル」「ネイルABCサイクル」
  industry_code text NOT NULL,           -- salon / nail / clinic ...
  description text,

  -- 設問の原本。この案件を複製して店舗用の案件を作る。
  entry_template_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  followup_template_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  verify_template_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,

  -- 店舗サイクルの既定値。店舗生成時に cycle_groups へコピーされる
  -- （コピー後は店舗ごとに変更可能＝あとからテンプレを変えても既存店舗に影響しない）。
  grace_days int NOT NULL DEFAULT 7,
  undecided_days int NOT NULL DEFAULT 60,
  restart_cooldown_days int NOT NULL DEFAULT 25,
  followup_b_delay_minutes int NOT NULL DEFAULT 120,
  frequency_question_code text NOT NULL DEFAULT 'Q11',
  -- 業種で来店頻度の現実的な幅が違う（美容室は月〜4か月、ネイルは3〜4週間）。
  -- 業種ごとに対応表を持たないと離脱判定が実態と合わない。
  frequency_days_json jsonb,

  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (industry_code)
);

COMMENT ON TABLE industry_templates IS
  '業種ごとの調査票テンプレと既定設定 (Migration 096)。店舗はここから一括生成する。';
COMMENT ON COLUMN industry_templates.frequency_days_json IS
  '来店頻度コード → 日数。業種ごとに現実的な幅が違うためテンプレ単位で持つ。';

-- ------------------------------------------------------------------
-- 2. 店舗（法人 clients の配下）
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS stores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 法人。チェーン展開（1法人が複数店舗）を表現する。
  client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  industry_template_id uuid REFERENCES industry_templates(id) ON DELETE SET NULL,

  name text NOT NULL,                    -- 「●●美容室 渋谷店」
  -- entry_code の接頭辞。店舗ごとの案件は `<slug>-a` のようなコードになる。
  code_slug text NOT NULL,

  -- 店舗ごとの謝礼。NULL ならテンプレ案件の値をそのまま使う（謝礼なしの店舗もある）。
  reward_points_override int,

  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code_slug)
);

COMMENT ON TABLE stores IS
  '店舗マスタ (Migration 096)。clients=法人の配下。ここが店舗数ぶん増える単位。'
  '⚠ projects.partner_store_id は hibi-portal（別DB）の外部IDで別軸。混同しないこと。';
COMMENT ON COLUMN stores.reward_points_override IS
  '店舗ごとの謝礼ポイント。NULL はテンプレ案件の値を使う（謝礼なしの店舗もあるため NULL 許容）。';

CREATE INDEX IF NOT EXISTS ix_stores_client ON stores (client_id);
CREATE INDEX IF NOT EXISTS ix_stores_template ON stores (industry_template_id);

-- ------------------------------------------------------------------
-- 3. 案件を店舗・テンプレへ紐づける
-- ------------------------------------------------------------------

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE SET NULL;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS industry_template_id uuid REFERENCES industry_templates(id) ON DELETE SET NULL;

-- テンプレ内での役割。複製元を特定し、再生成や一覧のグルーピングに使う。
-- 'template' はテンプレ本体（＝どの店舗のものでもない原本）。
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS template_step_role text
  CHECK (template_step_role IS NULL OR template_step_role IN ('template', 'entry', 'followup', 'verify'));

COMMENT ON COLUMN projects.store_id IS
  '所属店舗 (Migration 096)。NULL は店舗に属さない通常案件。';
COMMENT ON COLUMN projects.template_step_role IS
  '業種テンプレ内での役割 (Migration 096)。template=原本 / entry=A / followup=B / verify=C。';

CREATE INDEX IF NOT EXISTS ix_projects_store ON projects (store_id) WHERE store_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS ix_projects_industry_template
  ON projects (industry_template_id) WHERE industry_template_id IS NOT NULL;

-- ------------------------------------------------------------------
-- 4. サイクルを店舗・テンプレへ紐づける
-- ------------------------------------------------------------------

ALTER TABLE cycle_groups
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE CASCADE;

ALTER TABLE cycle_groups
  ADD COLUMN IF NOT EXISTS industry_template_id uuid REFERENCES industry_templates(id) ON DELETE SET NULL;

COMMENT ON COLUMN cycle_groups.store_id IS
  '所属店舗 (Migration 096)。店舗ごとに1サイクル定義。NULL は手動作成の定義。';

CREATE INDEX IF NOT EXISTS ix_cycle_groups_store ON cycle_groups (store_id) WHERE store_id IS NOT NULL;

-- 周回にも店舗を持たせる。同じ人が複数店舗を使い分けても周回が混ざらないようにし、
-- 離脱率を店舗別・業種別に集計できるようにする。
ALTER TABLE survey_cycles
  ADD COLUMN IF NOT EXISTS store_id uuid REFERENCES stores(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS ix_survey_cycles_store ON survey_cycles (store_id) WHERE store_id IS NOT NULL;

-- ------------------------------------------------------------------
-- 5. 権限（074 の GRANT 漏れ事故を繰り返さないため明示）
-- ------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON industry_templates TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON stores TO service_role;
