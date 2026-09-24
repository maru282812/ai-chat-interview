-- 106_fix_operator_phone_number.sql
-- 書類本文の連絡先ブロックの電話番号を、実在する番号「090-9271-8100」へ是正する。
--
-- 背景:
--   migration 101 で「050-5555-4446」を入れたが、この番号は実際には使われていない。
--   会員ポータル（hibi-site）側は 2026-09-10 に `lib/legal.ts` の BUSINESS_INFO.phone を
--   090-9271-8100 へ修正済み（commit 96a4b16）だが、ACI の書類本文が取り残されていた。
--   特商法・個人情報保護法が求める「事業者の連絡先の表示」なので、実際に繋がる番号である必要がある。
--
-- 【新バージョンを切らない】理由:
--   101 / 100 と同じ扱い。権利義務の内容に変更は無く、事業者表示（連絡手段）の是正に過ぎない。
--   新版を切ると全利用者に再同意が発生し、その間 consentService が同意待ち扱いにしてしまう。
--   同意履歴を維持したまま本文だけを是正する。
--
-- 【現在版だけを直す】理由:
--   過去版（effective_to が入っている版）は「その時点で同意を得た本文」の記録であり、
--   後から書き換えると証跡として意味を失う。差し替えるのは各書類の current_version_id が
--   指す版だけにする。
--
-- 注意: 取り込み済み本文の改行は CRLF。番号の置換だけなので改行には触れない。
-- 冪等: 既に新番号になっている本文は対象外（WHERE 句）。

BEGIN;

UPDATE document_versions
SET content = replace(content, '050-5555-4446', '090-9271-8100')
WHERE id IN (SELECT current_version_id FROM documents WHERE current_version_id IS NOT NULL)
  AND content LIKE '%050-5555-4446%';

-- 現在版に古い番号が残っていないことを確認する
DO $$
DECLARE
  remaining INTEGER;
  fixed     INTEGER;
BEGIN
  SELECT count(*) INTO remaining
  FROM document_versions
  WHERE id IN (SELECT current_version_id FROM documents WHERE current_version_id IS NOT NULL)
    AND content LIKE '%050-5555-4446%';

  IF remaining > 0 THEN
    RAISE EXCEPTION '現在版に古い電話番号が % 件残っています', remaining;
  END IF;

  SELECT count(*) INTO fixed
  FROM document_versions
  WHERE id IN (SELECT current_version_id FROM documents WHERE current_version_id IS NOT NULL)
    AND content LIKE '%090-9271-8100%';

  RAISE NOTICE '電話番号を是正した現在版: % 件', fixed;
END $$;

COMMIT;
