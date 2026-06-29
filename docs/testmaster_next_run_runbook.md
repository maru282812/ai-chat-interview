# Testmaster 次回テスト実行 runbook（2026-06-29 整備）

前サイクルで blocked / untested だった項目を、次回テスト時に到達できるよう
**テスト到達手段（seam / fixture）を整備済み**。手順は以下。すべて非本番限定。

## 0. 前提
- testmaster: `http://localhost:3400`（projectId=`ai-chat-interview`）
- 対象アプリは **必ず現 HEAD を別ポートで起動**（稼働中の :3000 は古いプロセスのことがある）:
  ```bash
  PORT=3100 npx tsx src/server.ts
  ```
- `.env` は `NODE_ENV=development`（seam は production では完全に無効）。

## 1. テスト用 fixture を投入（冪等・tmtest_ 隔離・非破壊）
```bash
node scripts/seed-test-fixtures.mjs seed      # 投入
node scripts/seed-test-fixtures.mjs ids       # 使う assignmentId / seam を表示
node scripts/seed-test-fixtures.mjs teardown  # 後片付け（テスト専用行のみ削除）
```
投入される assignment（project=screening 有効）:
| 用途 | assignmentId 末尾 | 備考 |
|---|---|---|
| screening fail 対象外画面 | …031 | state_json.screening_result='fail' |
| 未判定 screening 絞り込み | …032 | screening 未判定 |
| **完了済み/再アクセス** | …033 | status='completed'（user_id=null で誘導を飛ばす） |
| **profile 未確認誘導 / verify-identity 所有者** | …034 | user_id='tmtest_owner'・session 未確認 |

## 2. 認証 seam（認証後分岐に到達する）
実 LINE id_token を偽造できないため、**非本番限定の sentinel** を用意済み
（`src/services/liffAuthService.ts` の `verifyIdToken` 冒頭）。

- ヘッダ系 API: `Authorization: Bearer tmtest:<lineUserId>`
- body の id_token 系（verify-identity 等）: `id_token = "tmtest:<lineUserId>"`
- 例: `tmtest:tmtest_owner` → userId=`tmtest_owner` として本人扱い。

これで到達可能になるもの（前回 blocked/untested）:
- ID形式バリデーションの認証ゲート4件（projects/:id/data・favorite・exchange-requests/:id/cancel・daily-survey/:surveyId/answer）→ 非UUID で **404**。
- verify-identity: 所有者一致(200 ok)・別ユーザー(403 IDENTITY_MISMATCH)・user_id 未設定 dev 分岐。
- consent-check / consent-submit / consent-statuses / mypage-data / profile-status / answer 系（要 session）。

## 3. 503「LIFF設定不足」seam（env 改変なし）
```
GET /liff/survey/<assignmentId>  -H "x-test-auth-required: 1"   # または ?__test_auth_required=1
```
→ 503「設定が完了していません」。本番では無視。

## 4. サイクルの回し方
1. 改修したら `testmaster-test-plan` を再実行（前回 import ペイロード `%TEMP%/tm_payload.json` を基に、
   **変更ソース単位のみ新fp** に remap して全置換 import。未変更単位は既存fp据置で passed 保全）。
   - testmaster の id = `sha1(projectId|fp|title)`。fp が変わると id が変わり当該項目は untested 化＝要再テスト。
2. `testmaster-run-api`（HTTP契約） / `testmaster-run-screen`（画面・LIFF）を、要再テスト分だけ再記録。
   run の fingerprint はサーバが suggestion から自動付与するので import→run は常に整合。
3. カバレッジ確認 → 残 Untested の方針判断 → 次サイクル。

## 5. セキュリティ注意
seam（auth / 503）と fixture は **すべて `NODE_ENV!=="production"` ガード**。本番では分岐に入らない。
`tmtest:` 接頭辞・`x-test-auth-required` ヘッダ・seed の固定UUIDは本番DB/本番環境では無効/未投入のこと。
