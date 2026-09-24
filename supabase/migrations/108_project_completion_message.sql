-- 108_project_completion_message.sql
-- 案件ごとの「送信完了画面に出すお礼文」を保持する列を追加する。
--
-- 背景:
--   美容室ABCサイクル（A/C）は、お礼の文言を最後の設問の comment_bottom に載せていた。
--   comment_bottom は設問の下に出る＝「まだ回答中・送信前」の画面でお礼が出てしまい、
--   回答者から見ると「お礼が出たのにまだ送信していない」状態だった。
--   送信完了画面は既に存在する（views/liff/survey.ejs の #completeScreen）が、
--   文言が "ご協力ありがとうございます。" 固定で、案件ごとのお礼を載せられなかった。
--
-- 方針:
--   screening_config.fail_message と同じ考え方で、案件に文言を持たせる。
--   未設定の案件は従来どおり汎用文を出すため、NULL 許容・既定値なし。
--   本文は改行を含むため text（\n をそのまま保持し、描画側で改行に変換する）。
--
-- 冪等: add column if not exists。
-- rollback: ALTER TABLE projects DROP COLUMN IF EXISTS completion_message;

BEGIN;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS completion_message text;

COMMENT ON COLUMN projects.completion_message IS
  '送信完了画面に表示するお礼文。NULL なら汎用文（ご協力ありがとうございます。）を出す。';

COMMIT;
