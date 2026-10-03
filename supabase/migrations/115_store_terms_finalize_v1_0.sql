-- 115_store_terms_finalize_v1_0.sql
-- 会員利用規約（店舗向け・migration 105）を、弁護士確認の完了にあわせて正式版にする。
--
-- 背景:
--   105 で投入した版は `1.0-draft`（弁護士確認前の案）で、本文冒頭にもその旨の注記があった。
--   2026-10-03 に弁護士確認が完了したため、版番号から `-draft` を外し、注記を削除する。
--   あわせて次の2点も是正する（いずれも権利義務の内容を変えない表記の修正）:
--     - ドメイン再編（2026-10-03）で会員サイトが hibi.yottollc.com → anke.yottollc.com に変わった
--     - サービス名の表記を「アンケでYOTTO」→「アンケdeYOTTO」に統一（LINE公式アカウントの
--       申請名と一致させるため。hibi 側は 2026-10-01 に全箇所統一済みで、本文だけ旧表記が残っていた）
--   hibi 側の3文書（チケット規約・特商法・プライバシーポリシー）も同日に
--   `lib/legal.ts` の版から `-draft` を外している。
--
-- 【新バージョンを切らない】理由:
--   100 / 101 / 106 / 107 と同じ扱い。
--   - 権利義務の内容に変更は無い（draft 注記の削除・URL とサービス名表記の是正のみ）
--   - `1.0-draft` に同意した会員は居ない（hibi の legal_consents は空）
--   新版を切ると version_no が変わり、hibi 側の同意判定（doc_version 一致）に
--   無駄な再同意を発生させるだけなので、現在版を UPDATE する。
--
-- 版番号の扱い:
--   `1.0-draft` → `1.0`。メジャー番号は据え置きなので、hibi 側の再同意判定
--   （`lib/store-terms-version.ts` の majorOf 比較）でも needs_consent にはならない。
--
-- 冪等:
--   version_no が '1.0-draft' の行だけを対象にする。適用済みなら 0 行更新で no-op。
--   `UNIQUE (document_id, version_no)` があるが、この document には 1.0-draft の
--   1版しか存在しないため '1.0' への変更で衝突しない。
--
-- 注意: 105 の本文は LF（他書類の CRLF とは異なる）。E'...\n' の置換もそれに合わせる。

BEGIN;

-- 1) 本文の draft 注記を削除し、会員サイト URL とサービス名表記を是正する
UPDATE document_versions
SET content = replace(
                replace(
                  replace(
                    content,
                    E'**本規約は弁護士確認前の案（1.0-draft）です。正式版の公開までに内容が変わる場合があります。**\n\n',
                    ''
                  ),
                  'https://hibi.yottollc.com',
                  'https://anke.yottollc.com'
                ),
                'アンケでYOTTO',
                'アンケdeYOTTO'
              ),
    version_no = '1.0',
    change_reason = '弁護士確認の完了により正式版化（draft 注記の削除）。あわせて会員サイト URL を anke.yottollc.com に、サービス名表記を「アンケdeYOTTO」に是正。権利義務の内容に変更なし。'
WHERE document_id = 'd1000000-0000-0000-0000-000000000001'::UUID
  AND version_no = '1.0-draft';

-- 2) documents 側のタイトル・説明文も表記を揃える
--    （版番号の運用ルール自体は今後も使うので残す）
UPDATE documents
SET description = 'hibi 会員ポータルの店舗が同意する利用規約。アンケdeYOTTO（anke.yottollc.com）が GET /api/partner/legal/store-terms で現在版を取得し、同意は hibi 側 legal_consents に記録される。版番号は X.Y[-suffix]。メジャー番号を上げると店舗の再同意が発生し、マイナーは告知のみ。-draft は弁護士確認前の草案に付ける（現行 1.0 は確認済みの正式版）。',
    title = '会員利用規約（店舗向け・アンケdeYOTTO）',
    updated_at = now()
WHERE id = 'd1000000-0000-0000-0000-000000000001'::UUID;

COMMIT;
