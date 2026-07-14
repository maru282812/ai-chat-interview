-- ============================================================
-- 080: 通知テンプレートの「既定」重複を解消する
--
-- 症状: デイリーの配信実行が「通知テンプレートが見つかりません」で失敗していた。
--
-- 原因: 044 のデモseedが、本番テンプレートと同じ category に is_default=true で
--       入っていたため、category ごとに既定が2件ある状態になっていた。
--       getDefault() は .single() で引くので複数行ヒットでエラーになり、
--       そのエラーコード（PGRST116）を「該当なし」と解釈して null を返していた。
--       ＝テンプレートは存在するのに「無い」と誤判定されていた。
--
-- 影響: daily_survey（配信が例外で停止）のほか、unanswered_reminder /
--       answer_complete / rank_up / dormancy_recovery / project_intro も
--       既定を引けず、通知が黙って送られていなかった（warn ログのみ）。
--
-- 方針: デモ行は消さない（他の画面が参照している可能性があるため）。
--       既定フラグだけ降ろす。そのうえで、なお既定が複数残る category は
--       最終更新が新しい1件だけを既定として残す。何度流しても同じ結果になる。
--
-- 一意制約は張らない: 管理画面の作成/編集はチェックボックスで is_default を
--       直に立てる実装のままなので、ここで unique 制約を足すと保存が 500 になる。
--       重複が再発しても getDefault が1件に決められるようリポジトリ側を堅くした。
-- ============================================================

-- 1. デモseed（044）が立てた既定フラグを降ろす
UPDATE notification_templates
SET    is_default = false,
       updated_at = now()
WHERE  is_default = true
AND    id IN (
  '40000000-0000-0000-0000-000000000001',  -- [デモ] 今日のかんたんアンケート
  '40000000-0000-0000-0000-000000000002',  -- [デモ] 回答完了お礼
  '40000000-0000-0000-0000-000000000003',  -- [デモ] 未回答リマインド
  '40000000-0000-0000-0000-000000000005',  -- [デモ] ランクアップ通知
  '40000000-0000-0000-0000-000000000007',  -- [デモ] 案件案内
  '40000000-0000-0000-0000-000000000010'   -- [デモ] 休眠復帰案内
);

-- 2. それでも既定が複数残る category は、最終更新が新しい1件だけ残す
WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY category
           ORDER BY updated_at DESC, id
         ) AS rn
  FROM   notification_templates
  WHERE  is_default = true
  AND    is_active  = true
)
UPDATE notification_templates t
SET    is_default = false,
       updated_at = now()
FROM   ranked r
WHERE  t.id = r.id
AND    r.rn > 1;
