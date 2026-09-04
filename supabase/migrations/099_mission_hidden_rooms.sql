-- 099_mission_hidden_rooms.sql
--
-- ミッション Phase 3: 隠し部屋（山分け・一律・抽選）。
-- 仕様: docs/spec-mission-phase23-rooms-hidden.md / requirements/legal-premium-act.md
--
-- 法的設計条件をスキーマで強制する:
--   - flat_points / prize_points は CHECK で上限 2,000（D-19。仮に懸賞と評価されても
--     限度額 100円×20倍 を超えない）。山分けの1人あたりはアプリ層 splitPerPerson が
--     min(2000, floor(pot/人数)) でキャップする（potそのものは2,000超でよい）。
--   - 抽選は 1人1口・等確率（D-17）。「口数」を持つ列は存在しない
--     （mission_hidden_entries の UNIQUE が 1人1行を構造で保証）。
--   - 参加にポイントを消費する配管は存在しない（賭博罪・刑法185条の回避）。
--
-- 部屋（category別）はテーブルを作らない: discoverable案件の projects.category から
-- 読み時に導出する（0件の部屋はそもそも生成されない）。
--
-- 破壊性: なし（新規テーブルのみ）。
-- rollback:
--   DROP TABLE IF EXISTS mission_hidden_awards;
--   DROP TABLE IF EXISTS mission_hidden_entries;
--   DROP TABLE IF EXISTS mission_hidden_rooms;

-- ------------------------------------------------------------------
-- 1. 隠し部屋（1ミッションに1部屋）
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mission_hidden_rooms (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mission_id    uuid NOT NULL REFERENCES missions(id) ON DELETE CASCADE,
  -- 部屋の中身 = このカテゴリの discoverable 案件（通常部屋一覧からは除外される）
  category      text NOT NULL,
  -- 開き方 4種（mockups/campaign/game.html §7。すべて偶然性の問題を設計で回避済み）
  open_mode     text NOT NULL CHECK (open_mode IN ('rooms_cleared','schedule','first_n','random')),
  rooms_needed  int CHECK (rooms_needed IS NULL OR rooms_needed >= 1),
  -- schedule: 管理者指定 / random: 保存時にサーバーが乱数確定（以後固定＝全員同じ時刻）
  opens_at      timestamptz,
  closes_at     timestamptz,
  first_n       int CHECK (first_n IS NULL OR first_n >= 1),
  -- 報酬 3種
  award_mode    text NOT NULL CHECK (award_mode IN ('split','flat','raffle')),
  pot_points    int CHECK (pot_points IS NULL OR pot_points > 0),
  -- D-19: 1人あたり上限 2,000pt を DB でも強制
  flat_points   int CHECK (flat_points IS NULL OR (flat_points > 0 AND flat_points <= 2000)),
  prize_points  int CHECK (prize_points IS NULL OR (prize_points > 0 AND prize_points <= 2000)),
  winners_count int CHECK (winners_count IS NULL OR winners_count >= 1),
  -- split / raffle の確定バッチが立てる（cron の再実行ガードではなく完了マーカー。
  -- 冪等は mission_hidden_awards の UNIQUE ＋ awardPoints の idempotency_key が持つ）
  settled_at    timestamptz,
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_mission_hidden_rooms_mission UNIQUE (mission_id)
);

-- ------------------------------------------------------------------
-- 2. 入室記録（先着N判定と参加者集合。UNIQUE = 1人1口の構造保証）
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mission_hidden_entries (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hidden_room_id uuid NOT NULL REFERENCES mission_hidden_rooms(id) ON DELETE CASCADE,
  line_user_id   text NOT NULL,
  entered_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_mission_hidden_entries UNIQUE (hidden_room_id, line_user_id)
);

CREATE INDEX IF NOT EXISTS ix_mission_hidden_entries_room
  ON mission_hidden_entries (hidden_room_id);

-- ------------------------------------------------------------------
-- 3. 付与の記録（結果表示用＋冪等の一重目）
-- ------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mission_hidden_awards (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hidden_room_id uuid NOT NULL REFERENCES mission_hidden_rooms(id) ON DELETE CASCADE,
  line_user_id   text NOT NULL,
  points         int  NOT NULL CHECK (points > 0 AND points <= 2000),
  kind           text NOT NULL CHECK (kind IN ('split','flat','raffle')),
  awarded_at     timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ux_mission_hidden_awards UNIQUE (hidden_room_id, line_user_id)
);

CREATE INDEX IF NOT EXISTS ix_mission_hidden_awards_user
  ON mission_hidden_awards (hidden_room_id, line_user_id);

-- ------------------------------------------------------------------
-- 4. 権限（GRANT 漏れ事故の再発防止）
-- ------------------------------------------------------------------

GRANT SELECT, INSERT, UPDATE, DELETE ON mission_hidden_rooms   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON mission_hidden_entries TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON mission_hidden_awards  TO service_role;
