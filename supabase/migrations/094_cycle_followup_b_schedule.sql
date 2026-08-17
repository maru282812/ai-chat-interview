-- 094_cycle_followup_b_schedule.sql
--
-- B（来店後アンケート）の遅延送信（既定2時間後）を予約するための列を足す。
--
-- 背景:
--   B は「A の2時間後にプッシュ」と「店頭QRからその場で回答」の両方を許す。
--   QR は既存の /liff/store 導線でそのまま動くので、ここで足すのは前者だけ。
--   A の完了時に送信予定時刻を立て、毎分 cron が時刻を過ぎたものを送る。
--
-- なぜサイクル側に持たせるか:
--   B の送信対象は「A を完了した周」なので、周そのものに予約を持たせるのが素直。
--   assignment 側に持たせると、B の assignment がまだ存在しない時点で予約できない。
--
-- 破壊性: なし（NULL 許容カラムの追加のみ）。
-- rollback:
--   DROP INDEX IF EXISTS ix_survey_cycles_followup_b_due;
--   ALTER TABLE survey_cycles DROP COLUMN IF EXISTS followup_b_scheduled_at;
--   ALTER TABLE survey_cycles DROP COLUMN IF EXISTS followup_b_sent_at;
--   ALTER TABLE cycle_groups DROP COLUMN IF EXISTS followup_b_delay_minutes;

ALTER TABLE cycle_groups
  ADD COLUMN IF NOT EXISTS followup_b_delay_minutes int NOT NULL DEFAULT 120;

COMMENT ON COLUMN cycle_groups.followup_b_delay_minutes IS
  'A 完了から B を送るまでの分数 (Migration 094)。既定120分＝2時間後。0以下で送信しない。';

ALTER TABLE survey_cycles
  ADD COLUMN IF NOT EXISTS followup_b_scheduled_at timestamptz;

ALTER TABLE survey_cycles
  ADD COLUMN IF NOT EXISTS followup_b_sent_at timestamptz;

COMMENT ON COLUMN survey_cycles.followup_b_scheduled_at IS
  'B の送信予定時刻 (Migration 094)。A 完了時に確定する。NULL は送信しない。';
COMMENT ON COLUMN survey_cycles.followup_b_sent_at IS
  'B を送信した時刻 (Migration 094)。非NULL＝送信済みなので再送しない。';

-- 毎分の送信バッチが引く条件そのままの部分インデックス。
CREATE INDEX IF NOT EXISTS ix_survey_cycles_followup_b_due
  ON survey_cycles (followup_b_scheduled_at)
  WHERE followup_b_sent_at IS NULL
    AND followup_b_scheduled_at IS NOT NULL
    AND closed_at IS NULL;
