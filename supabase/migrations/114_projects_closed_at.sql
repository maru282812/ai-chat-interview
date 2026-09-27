-- 114_projects_closed_at.sql
-- 案件を締め切った「時刻」を保持する列を追加する。
--
-- 背景:
--   「締切」を**集計の区切り**に変える（締切後も回答は受け付け、納品する数字は締切時点で固定する）。
--   ところが集計（getStats / getResults / getGtTable / closeSurvey）は毎回ライブで
--   sessions を数え直しており、スナップショットが無い。締切後に回答が増えると
--   「◯件で締め切りました」と店舗に伝えた数と、後から見える数が食い違う。
--
--   区切りの基準になる時刻が要るが、closeSurvey はこれまで projects.updated_at を
--   closed_at として返していた。updated_at は他の更新でも動くので**基準として使えない**
--   （締切と無関係な更新のたびに、集計に含める範囲がずれてしまう）。
--
-- 方針:
--   締切時刻を専用の列に持つ。集計は sessions.completed_at <= closed_at で切る。
--   命名・型は cycles.closed_at（093_survey_cycles.sql）に合わせる。
--   回収中（未締切）は NULL で、そのときは全件を数える。
--
-- ⚠ バックフィルの値は**近似値**:
--   既存の締切済み案件には updated_at を入れる。本当の締切時刻ではないが、
--   NULL のままだと「締切時刻なし＝全件表示」になり、いま見えている数字が動いてしまう。
--   締切後に回答が入っていない案件では実害が無い（どちらで切っても同じ件数）。
--
-- GRANT: 列の追加はテーブルの権限を引き継ぐので個別の GRANT は不要
--        （108_project_completion_message.sql と同じ）。
--
-- 冪等: add column if not exists ＋ バックフィルは closed_at is null のみ。
-- rollback: ALTER TABLE projects DROP COLUMN IF EXISTS closed_at;

BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS closed_at timestamptz;

COMMENT ON COLUMN projects.closed_at IS
  '締め切った時刻。集計はこの時刻までの完了セッションだけを数える（締切後の回答は次回ぶん）。NULL は回収中。';

-- 既存の締切済み案件のバックフィル（近似値。上のコメント参照）
UPDATE projects
   SET closed_at = updated_at
 WHERE status IN ('closed', 'archived')
   AND closed_at IS NULL;

COMMIT;
