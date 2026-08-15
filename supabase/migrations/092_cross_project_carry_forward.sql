-- 092_cross_project_carry_forward.sql
--
-- 別案件の回答を carry-forward（選択肢の持ち越し）で参照できるようにする。
--
-- 背景:
--   店舗アンケートは A（施術前）/ B（施術後）/ C（後日）を別案件として配信するが、
--   C の選択肢を A の回答（今日のメニュー）で絞る、という要件がある。
--   既存の carry-forward は同一案件（同一セッション）の回答しか参照できないため、
--   「どの案件の回答を、どの名前空間で持ち込むか」を案件側に宣言させる。
--
-- 参照のしかた:
--   projects.carry_forward_sources = [{ "namespace": "a", "entry_code": "yotto-salon-a" }]
--   と宣言すると、その案件の設問は display_tags_parsed.optionSource で
--   { "fromQuestion": "a:q5", "mode": "selected" } のように参照できる。
--
--   名前空間付きキーは carry-forward からのみ参照可能。
--   visibility_conditions の pipe 式は `q\d+` しか解釈しないため影響を受けない。
--
-- 破壊性: なし（NULL 許容カラムの追加のみ）。既存案件は NULL = 従来どおり同一案件内のみ。
-- rollback: ALTER TABLE projects DROP COLUMN carry_forward_sources;

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS carry_forward_sources jsonb;

COMMENT ON COLUMN projects.carry_forward_sources IS
  '別案件の回答を carry-forward で参照するための宣言 (Migration 092)。'
  '[{namespace, entry_code}] 形式。同一 respondent の当該案件の primary 回答を '
  '`<namespace>:<question_code>` キーで AnswerContext に読み込む。NULL は参照なし。';
