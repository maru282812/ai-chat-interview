-- 109_followup_b_index_without_closed.sql
--
-- B（来店後アンケート）の送信対象を引く部分インデックスから closed_at 条件を外す。
--
-- 背景:
--   B の抽出（listFollowupBDue）は closed_at IS NULL を条件に入れていた。
--   このため A を完了した直後にもう一度 A を開くと、前の周が「再来店」として
--   閉じられ、まだ送っていない B の予約が黙って送信対象から消えていた。
--   2026-09-17 に実機検証で発生し、B が永久に届かなかった。
--
--   B は「その周の A に答えた人」への返礼であって、次の来店があったかとは
--   無関係。アプリ側の抽出条件から closed_at を外したので、インデックスの
--   WHERE 句も揃える（揃えないとインデックスが使われず Seq Scan になる）。
--
-- 破壊性: **なし**。インデックスの張り替えのみ。データは触らない。
--   新しいインデックスは旧インデックスより対象行がわずかに広い
--   （閉じた周のうち B 未送信のものを含む）。
--
-- ロールバック:
--   DROP INDEX IF EXISTS ix_survey_cycles_followup_b_due;
--   CREATE INDEX ix_survey_cycles_followup_b_due
--     ON survey_cycles (followup_b_scheduled_at)
--     WHERE followup_b_sent_at IS NULL
--       AND followup_b_scheduled_at IS NOT NULL
--       AND closed_at IS NULL;
--   ※ ただし戻すと上記の「B が消える」不具合も戻る。

DROP INDEX IF EXISTS ix_survey_cycles_followup_b_due;

CREATE INDEX IF NOT EXISTS ix_survey_cycles_followup_b_due
  ON survey_cycles (followup_b_scheduled_at)
  WHERE followup_b_sent_at IS NULL
    AND followup_b_scheduled_at IS NOT NULL;

COMMENT ON INDEX ix_survey_cycles_followup_b_due IS
  'B の送信バッチ（listFollowupBDue）が引く条件そのままの部分インデックス。'
  ' closed_at は条件に含めない（周が閉じても未送信の B は送るため / migration 109）。';
