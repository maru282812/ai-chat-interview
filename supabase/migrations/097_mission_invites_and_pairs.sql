-- 097_mission_invites_and_pairs.sql
--
-- ミッション Phase 1: 招待とペアアンケート。
-- 仕様: docs/spec-mission-phase1-invite-pair.md / 計画: docs/plan-mission-phases.md
--
-- 法的前提（requirements/legal-premium-act.md）:
--   招待謝礼は定義告示運用基準 4(7) で取引付随に当たらない（明文）。
--   回答報酬は 5(3)「仕事の報酬」構成。全報酬に 1人あたり上限 2,000pt を適用する
--   （2026-09-04 決定。仮に懸賞と評価されても限度額 100円×20倍 を超えないため）。
--
-- 設計判断:
--   - pair_answers は choice_code しか持たない＝自由記述カラムを**作らない**。
--     規約 v2.0 第10条4項(1)（回答原文の第三者提供禁止）をスキーマで強制する（D-10/D-11）。
--   - 保留ポイントのテーブルは作らない。user_points.pending_points は exchange_request
--     専用で流用できない（050 のトリガー仕様）。確定時に初めて awardPoints を呼ぶ。
--   - ステージ・部屋・隠し部屋は Phase 2 以降の別 migration（098〜）。
--
-- 破壊性: なし（新規テーブルのみ）。
-- rollback:
--   DROP TABLE IF EXISTS pair_answers;
--   DROP TABLE IF EXISTS pair_questions;
--   DROP TABLE IF EXISTS survey_pairs;
--   DROP TABLE IF EXISTS mission_invites;

-- ------------------------------------------------------------------
-- 1. 招待
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mission_invites (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token         text NOT NULL UNIQUE,          -- crypto.randomBytes 由来・推測不能
  inviter_id    text NOT NULL,                 -- 招待した人の line_user_id
  invitee_id    text,                          -- 登録後に埋まる
  status        text NOT NULL DEFAULT 'issued'
                CHECK (status IN ('issued','registered','answered','expired','revoked')),
  registered_at timestamptz,
  answered_at   timestamptz,
  expires_at    timestamptz NOT NULL,
  -- 不正検出の材料（同一端末の連続登録など。migration 086 の行動計測と突合する）
  signup_ua     text,
  signup_ip     text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  -- 自己招待はアプリ層でも弾くが、最後の砦として DB でも禁止する
  CONSTRAINT chk_mission_invites_not_self
    CHECK (invitee_id IS NULL OR invitee_id <> inviter_id)
);

CREATE INDEX IF NOT EXISTS ix_mission_invites_inviter
  ON mission_invites (inviter_id);

-- 同じ相手を2回招待しても2回払わない（登録済みの組み合わせは一意）
CREATE UNIQUE INDEX IF NOT EXISTS ux_mission_invites_pair
  ON mission_invites (inviter_id, invitee_id) WHERE invitee_id IS NOT NULL;

-- 被招待者は「誰かの招待で一度だけ」登録報酬を受け取れる
CREATE UNIQUE INDEX IF NOT EXISTS ux_mission_invites_invitee
  ON mission_invites (invitee_id) WHERE invitee_id IS NOT NULL;

-- ------------------------------------------------------------------
-- 2. ペア
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS survey_pairs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invite_id    uuid NOT NULL REFERENCES mission_invites(id) ON DELETE CASCADE,
  user_a       text NOT NULL,                  -- 招待者
  user_b       text NOT NULL,                  -- 被招待者
  expires_at   timestamptz NOT NULL,           -- 成立期限（既定14日・A2）
  completed_at timestamptz,                    -- 両者が全問回答した時刻
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_survey_pairs_distinct CHECK (user_a <> user_b),
  CONSTRAINT ux_survey_pairs_invite UNIQUE (invite_id)
);

CREATE INDEX IF NOT EXISTS ix_survey_pairs_user_a ON survey_pairs (user_a);
CREATE INDEX IF NOT EXISTS ix_survey_pairs_user_b ON survey_pairs (user_b);

-- ------------------------------------------------------------------
-- 3. ペア設問（選択式のみ。自由記述の型を持たない）
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pair_questions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sort_order  int  NOT NULL,
  question_text text NOT NULL,
  -- [{"code":"morning","label":"朝型"},...] の配列。code は英数のみ
  choices     jsonb NOT NULL,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_pair_questions_active
  ON pair_questions (sort_order) WHERE is_active;

-- ------------------------------------------------------------------
-- 4. ペア回答（choice_code のみ＝原文を持ちようがない）
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS pair_answers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pair_id      uuid NOT NULL REFERENCES survey_pairs(id) ON DELETE CASCADE,
  line_user_id text NOT NULL,
  question_id  uuid NOT NULL REFERENCES pair_questions(id) ON DELETE CASCADE,
  choice_code  text NOT NULL,
  answered_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_pair_answers UNIQUE (pair_id, line_user_id, question_id)
);

CREATE INDEX IF NOT EXISTS ix_pair_answers_pair ON pair_answers (pair_id);

-- ------------------------------------------------------------------
-- 5. 初期設問（Q-2 の初期セット。管理側で差し替え可能）
--    「割れて、かつ盛り上がる」2〜3択。深刻な話題・要配慮情報に近づかない。
-- ------------------------------------------------------------------

INSERT INTO pair_questions (sort_order, question_text, choices)
SELECT * FROM (VALUES
  (1,  '朝は得意なほう？',
       '[{"code":"morning","label":"どちらかといえば朝型"},{"code":"night","label":"どちらかといえば夜型"}]'::jsonb),
  (2,  '旅行の計画は？',
       '[{"code":"plan","label":"きっちり決めたい"},{"code":"free","label":"その場で決めたい"}]'::jsonb),
  (3,  'きのこの山 と たけのこの里、選ぶなら？',
       '[{"code":"kinoko","label":"きのこの山"},{"code":"takenoko","label":"たけのこの里"}]'::jsonb),
  (4,  '休みの日、どっちが多い？',
       '[{"code":"out","label":"出かける"},{"code":"home","label":"家でゆっくり"}]'::jsonb),
  (5,  '目玉焼きにかけるなら？',
       '[{"code":"soy","label":"しょうゆ"},{"code":"sauce","label":"ソース"},{"code":"salt","label":"塩こしょう"}]'::jsonb),
  (6,  '夏と冬、選ぶなら？',
       '[{"code":"summer","label":"夏"},{"code":"winter","label":"冬"}]'::jsonb),
  (7,  '映画は？',
       '[{"code":"theater","label":"映画館で観たい"},{"code":"home","label":"家で観たい"}]'::jsonb),
  (8,  '待ち合わせは？',
       '[{"code":"early","label":"だいぶ早く着く"},{"code":"just","label":"ぴったりに着く"},{"code":"late","label":"ちょっと遅れがち"}]'::jsonb),
  (9,  'お風呂は？',
       '[{"code":"bath","label":"湯船につかりたい"},{"code":"shower","label":"シャワーで済ませたい"}]'::jsonb),
  (10, '大事な話は？',
       '[{"code":"talk","label":"直接話したい"},{"code":"text","label":"文字で伝えたい"}]'::jsonb)
) AS v(sort_order, question_text, choices)
WHERE NOT EXISTS (SELECT 1 FROM pair_questions);

-- ------------------------------------------------------------------
-- 6. 権限（074 の GRANT 漏れ事故を繰り返さないため明示）
-- ------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON mission_invites TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON survey_pairs   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON pair_questions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON pair_answers   TO service_role;
