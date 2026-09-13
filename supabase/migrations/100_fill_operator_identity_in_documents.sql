-- 100_fill_operator_identity_in_documents.sql
-- 書類本文の運営者情報プレースホルダを実際の値へ確定する。
--   [運営者氏名]  -> 篠原智徳
--   info@yotto.jp -> contact@yottollc.com
--
-- 権利義務の内容を変更するものではなく、未確定だった事業者表示（氏名・連絡先）の
-- 確定に過ぎないため、新バージョンは切らず既存バージョンの本文を直接是正する。
-- （新バージョンを切ると全ユーザーに再同意を求めることになり、実態と釣り合わない）

BEGIN;

UPDATE document_versions
SET content = replace(
                replace(content, '[運営者氏名]', '篠原智徳'),
                'info@yotto.jp', 'contact@yottollc.com'
              )
WHERE content LIKE '%[運営者氏名]%'
   OR content LIKE '%info@yotto.jp%';

-- 是正漏れが無いことを確認（残っていれば適用を中止する）
DO $$
DECLARE
  leftover INTEGER;
BEGIN
  SELECT count(*) INTO leftover
  FROM document_versions
  WHERE content LIKE '%[運営者氏名]%'
     OR content LIKE '%info@yotto.jp%';

  IF leftover > 0 THEN
    RAISE EXCEPTION '運営者情報のプレースホルダが % 件残っています', leftover;
  END IF;
END $$;

COMMIT;
