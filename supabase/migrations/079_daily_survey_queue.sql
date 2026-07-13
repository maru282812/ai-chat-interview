-- 079_daily_survey_queue.sql
-- デイリーアンケートの配信キュー＋スロット（docs/plan-daily-survey-queue.md Phase 0-1）
--
-- 背景: 従来の cron は「status=active のデイリーを全部・全ユーザーに毎朝毎晩 push」する実装で、
--       回答済みの人にも再送し続けていた（notificationSchedulerService._runDeliveryJobs）。
--       scheduled_at カラムは存在するが cron から参照されておらず、日付指定配信は実質未実装だった。
--
-- 本 migration で「キュー（順番待ち）」と「日付×スロット（朝/夜）」を導入し、
--   ・何もしなければキューの先頭から 1 日 1 件が朝枠に配信される
--   ・夜枠は evening_autofill_enabled が true のときだけキューから補充される（＝1日2件）
--   ・日付固定はドラッグで scheduled_date + slot を書く
-- という配信モデルに置き換える。既存カラムへの追加のみで、既存データは壊れない。
--
-- 既存の scheduled_at は互換のため残すが、以後 cron は参照しない（表示用の遺物）。

-- ── daily_surveys: キュー／スロット／回答UIプリセット ──────────────────
ALTER TABLE daily_surveys ADD COLUMN IF NOT EXISTS queue_position   INTEGER;
ALTER TABLE daily_surveys ADD COLUMN IF NOT EXISTS scheduled_date   DATE;
ALTER TABLE daily_surveys ADD COLUMN IF NOT EXISTS slot             TEXT;
ALTER TABLE daily_surveys ADD COLUMN IF NOT EXISTS answer_ui_preset TEXT NOT NULL DEFAULT 'casual';

-- status に 'queued'（キュー待ち・日付未確定）を追加する。
-- 元の CHECK はテーブル定義でインライン宣言されているため、名前は daily_surveys_status_check。
ALTER TABLE daily_surveys DROP CONSTRAINT IF EXISTS daily_surveys_status_check;
ALTER TABLE daily_surveys ADD CONSTRAINT daily_surveys_status_check
  CHECK (status IN ('draft', 'queued', 'scheduled', 'active', 'paused', 'completed'));

ALTER TABLE daily_surveys DROP CONSTRAINT IF EXISTS daily_surveys_slot_check;
ALTER TABLE daily_surveys ADD CONSTRAINT daily_surveys_slot_check
  CHECK (slot IS NULL OR slot IN ('morning', 'evening'));

ALTER TABLE daily_surveys DROP CONSTRAINT IF EXISTS daily_surveys_answer_ui_preset_check;
ALTER TABLE daily_surveys ADD CONSTRAINT daily_surveys_answer_ui_preset_check
  CHECK (answer_ui_preset IN ('casual', 'standard', 'formal'));

-- 同じ日の同じ枠を二重予約できないようにする（ドラッグの取りこぼし・cron の二重補充への最後の砦）。
CREATE UNIQUE INDEX IF NOT EXISTS uq_daily_surveys_date_slot
  ON daily_surveys(scheduled_date, slot)
  WHERE scheduled_date IS NOT NULL AND slot IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_daily_surveys_queue
  ON daily_surveys(queue_position)
  WHERE status = 'queued';

CREATE INDEX IF NOT EXISTS idx_daily_surveys_date
  ON daily_surveys(scheduled_date);

-- ── notification_scheduler_settings: 夜枠の自動補充フラグ ──────────────
-- 既定 false ＝ 何もしなければ 1 日 1 件（朝だけ）。true にすると夜枠もキューから埋まる。
ALTER TABLE notification_scheduler_settings
  ADD COLUMN IF NOT EXISTS evening_autofill_enabled BOOLEAN NOT NULL DEFAULT false;
