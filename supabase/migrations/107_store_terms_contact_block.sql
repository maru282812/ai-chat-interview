-- 107_store_terms_contact_block.sql
-- 会員利用規約（店舗向け・migration 105）の末尾に、事業者の連絡先ブロックを追加する。
--
-- 背景:
--   105 で投入した本文には問い合わせ先が無かった。他の書類（回答者向け利用規約・
--   プライバシーポリシー・企業向け利用規約・セキュリティ方針）は末尾に
--   「氏名／所在地／メール／電話／LINE公式アカウント」の連絡先ブロックを持っており、
--   会員（店舗）だけが当方への連絡手段を規約内で知れない状態だった。
--   電話番号は 090-9271-8100（migration 106 で他書類も是正済み。hibi の
--   lib/legal.ts BUSINESS_INFO と同じ値）。
--
-- 【新バージョンを切らない】理由:
--   100 / 101 / 106 と同じ扱い。権利義務の内容に変更は無く、事業者表示（連絡手段）の
--   追加に過ぎない。加えて 1.0-draft は弁護士確認前の案で、まだ同意した会員が居ない
--   （hibi の legal_consents は空）状態のため、版を上げる意味が無い。
--
-- 注意: 105 の本文は LF（このファイルから投入したため）。他書類の CRLF とは異なる。
-- 冪等: 既に連絡先ブロックがある本文は対象外。

BEGIN;

UPDATE document_versions
SET content = replace(
                content,
                E'## 附則\n',
                E'## 第19条（お問い合わせ）\n\n本規約および本サービスに関するお問い合わせは、次の連絡先までご連絡ください。\n\n- 事業者:篠原 智徳（屋号: YOTTO）\n\n- 所在地:〒160-0023 東京都新宿区西新宿三丁目3番13号 西新宿水間ビル6階\n\n- メール:contact@yottollc.com\n\n- 電話:090-9271-8100（受付時間: 平日 10:00〜18:00。土日祝・年末年始を除く）\n\n- LINE公式アカウント:Hibi\n\n## 附則\n'
              )
WHERE id IN (SELECT current_version_id FROM documents WHERE id = 'd1000000-0000-0000-0000-000000000001')
  AND content NOT LIKE '%090-9271-8100%';

-- 連絡先が入ったことを確認する
DO $$
DECLARE
  ok BOOLEAN;
BEGIN
  SELECT (v.content LIKE '%090-9271-8100%' AND v.content LIKE '%contact@yottollc.com%')
  INTO ok
  FROM documents d JOIN document_versions v ON v.id = d.current_version_id
  WHERE d.id = 'd1000000-0000-0000-0000-000000000001';

  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION '会員利用規約（店舗向け）に連絡先ブロックが入っていません';
  END IF;
  RAISE NOTICE '会員利用規約（店舗向け）に連絡先ブロックを追加しました';
END $$;

COMMIT;
