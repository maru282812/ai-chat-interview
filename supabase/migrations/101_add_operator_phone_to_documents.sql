-- 101_add_operator_phone_to_documents.sql
-- 書類本文の連絡先ブロックに電話番号「050-5555-4446」を追加する。
--   - メール:contact@yottollc.com  →  直後に「- 電話:050-5555-4446」を追加
--   - 連絡先:contact@yottollc.com  →  同上
--
-- 100 と同じく、権利義務の変更ではなく事業者表示（連絡手段）の追加に過ぎないため、
-- 新バージョンは切らず既存バージョンの本文を直接是正する（同意履歴を維持する）。
--
-- 注意: 取り込み済み本文の改行は CRLF。周囲の行と改行コードを揃えないと
--       Markdown のリストが崩れるため、CRLF で挿入する。
-- 冪等性: 既に電話番号を含む本文は対象外にする。

BEGIN;

UPDATE document_versions
SET content = replace(
                content,
                E'- メール:contact@yottollc.com\r\n',
                E'- メール:contact@yottollc.com\r\n\r\n- 電話:050-5555-4446\r\n'
              )
WHERE content LIKE E'%- メール:contact@yottollc.com\r\n%'
  AND content NOT LIKE '%050-5555-4446%';

UPDATE document_versions
SET content = replace(
                content,
                E'- 連絡先:contact@yottollc.com\r\n',
                E'- 連絡先:contact@yottollc.com\r\n\r\n- 電話:050-5555-4446\r\n'
              )
WHERE content LIKE E'%- 連絡先:contact@yottollc.com\r\n%'
  AND content NOT LIKE '%050-5555-4446%';

-- 連絡先ブロックを持つ本文すべてに電話が入ったことを確認する
DO $$
DECLARE
  missing INTEGER;
BEGIN
  SELECT count(*) INTO missing
  FROM document_versions
  WHERE content LIKE '%contact@yottollc.com%'
    AND content NOT LIKE '%050-5555-4446%';

  IF missing > 0 THEN
    RAISE EXCEPTION '電話番号が未追加の書類が % 件あります', missing;
  END IF;
END $$;

COMMIT;
