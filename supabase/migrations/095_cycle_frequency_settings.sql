-- 095_cycle_frequency_settings.sql
--
-- 「C（離脱検証）をいつ送るか」の設定を DB 化し、管理画面から編集できるようにする。
--
-- 背景:
--   離脱判定日は `A回答日 + 来店頻度の日数 + 猶予` で決まるが、
--   このうち「来店頻度コード → 日数」の対応表だけがコード側（cycleRules.ts）に
--   ハードコードされており、変更にデプロイが必要だった。
--   さらに「どの設問を頻度設問として使うか」も Q11 決め打ちだった。
--
--   結果として設定が「設問」「コード」「cycle_groups」の3か所に散り、
--   運用者が触る場所を特定できない状態になっていた。ここで1か所に集約する。
--
-- 危険な性質（意図的にそのまま残す挙動）:
--   frequency_question_code で指定した設問の選択肢コードが frequency_days_json の
--   キーと一致しない場合、その回答者は離脱判定の対象外になる（C が送られない）。
--   誤った離脱率を出すより「判定不能」を明示する方を選ぶ設計のため。
--   ただし気づけるよう、管理画面で対応表と実際の選択肢を突き合わせて警告する。
--
-- 破壊性: なし（NULL 許容カラムと既定値付きカラムの追加のみ）。
--   frequency_days_json が NULL の間はコード側の既定表（VISIT_FREQUENCY_DAYS）が使われ、
--   既存の挙動と完全に一致する。
-- rollback:
--   ALTER TABLE cycle_groups DROP COLUMN IF EXISTS frequency_question_code;
--   ALTER TABLE cycle_groups DROP COLUMN IF EXISTS frequency_days_json;

ALTER TABLE cycle_groups
  ADD COLUMN IF NOT EXISTS frequency_question_code text NOT NULL DEFAULT 'Q11';

COMMENT ON COLUMN cycle_groups.frequency_question_code IS
  'A（起点案件）のどの設問を「来店頻度」として読むか (Migration 095)。既定 Q11。'
  'この設問の回答値で C の送付時期が決まる。';

ALTER TABLE cycle_groups
  ADD COLUMN IF NOT EXISTS frequency_days_json jsonb;

COMMENT ON COLUMN cycle_groups.frequency_days_json IS
  '来店頻度コード → 日数の対応表 (Migration 095)。{"about_2m": 60, ...} 形式。'
  'NULL はコード側の既定表を使う。ここに無いコードは判定不能＝C送付対象外。';

-- 既定表を明示的に入れておく（画面で「今どうなっているか」が見える状態にする）。
-- 既存の1件（美容室ABCサイクル）だけが対象。NULL のままでも挙動は同じだが、
-- 空欄だと運用者が「設定されていない＝動いていない」と誤解するため。
UPDATE cycle_groups
SET frequency_days_json = jsonb_build_object(
      'within_3w',  21,
      'about_1m',   30,
      'about_1_5m', 45,
      'about_2m',   60,
      'about_3m',   90,
      'over_4m',    120
    )
WHERE frequency_days_json IS NULL;
