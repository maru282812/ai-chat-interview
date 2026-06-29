# 改修指示文（testmaster テスト結果より / 2026-06-29）

testmaster の API 契約テスト・画面テストで検出した事項。対象アプリ = この ai-chat-interview。
優先度順。**A は実害（情報漏洩寄りの contract 違反）なので先に。** DB/seed を伴う C はユーザー確認後に着手。

---

## A.【最優先・セキュリティ】非UUIDで 500 + DBエラー露出を塞ぐ

### 症状
`GET /liff/documents/:documentId` に非UUID（例 `abc`）を渡すと **404 ではなく 500**、レスポンスに
`invalid input syntax for type uuid "abc"` という **Postgres 内部メッセージがそのまま露出**する。
同じ構造の id 受け取り系すべてに潜在。

### 原因（2層）
1. **根本**: ハンドラが未検証の id を uuid 型カラムのクエリへ直接渡す → Postgres 例外 → 500。
   - `src/controllers/liffController.ts:2239` `getDocumentContent`（documentId）
   - 同 `:629/:1090/:1579`（assignmentId）, `:1728`（surveyId）, `:1835/:1956/:2011`（projects の id）, `:2311`（exchange id）
2. **増幅**: `src/lib/http.ts:47-61` の errorHandler が `/liff` の **5xx でも `detail: error.message` を返す**
   → 本来 friendlyMessage で隠すべき DB 内部が `detail` から漏れる。

### 改修（両方やる）
1. **errorHandler の漏洩を止める**（src/lib/http.ts）: `/liff` ブランチで **5xx のときは `detail` を含めない**
   （`detail` は 400 系のみ。5xx は friendlyMessage と fallback だけ返す）。
   → これだけで「DB内部の露出」は全 500 経路で止まる。最優先。
2. **uuid 形式バリデーションを共通化**: `isUuid(s)` ヘルパ（正規表現）を用意し、上記 id 受け取り箇所で
   **形式不正なら getById に渡す前に 404**（存在しない扱い）を返す。
   - 既存の「未存在UUID → 404」挙動と一貫させる（404 に寄せる。400 でも可だが既存契約は 404）。
   - 可能なら Express の `param` ミドルウェアか小さなラッパで一括適用し、各ハンドラ修正を最小化。

### 受け入れ条件
- `GET /liff/documents/abc` → **404**、本文に `uuid`/`syntax`/SQL 断片を**含まない**。
- `:assignmentId` `:surveyId` `projects/:id` でも非UUID → 404、DBメッセージ非露出。
- 既存の「未存在UUID → 404」「正常UUID → 200」は不変（リグレッションなし）。

---

## B.【契約テストの分母追加】

testmaster の [[testmaster-test-plan]] に「非UUID形式の id → 404（500でなく、DBメッセージ非露出）」を
id 受け取り系ぶん追加しておく（A 修正後に passed になる回帰防止項目になる）。これは testmaster 側で実施。

---

## C.【画面テスト blocked 3件を「今後テスト可能」にする】※DB/seed 変更を含むため要確認

いずれも**プロダクトのバグではなく、テスト到達手段（fixture/seam）が無い**ことが原因で blocked。
read-only 検証では分岐に入れないので、下記いずれかで到達手段を用意したい。

1. **本番モード設定不足の 503 画面**（liffController.ts:659/867、`authRequired=true` 必須）
   - 現状 env が `LIFF_AUTH_REQUIRED=false` で、env 変更は禁止だった。
   - 提案: テスト専用に **その1リクエストだけ authRequired を強制できる seam**（非本番環境限定のヘッダ/クエリで
     `getSurveyLiffConfig()` の `authRequired` を上書き、本番では無効）を入れる。
   - これにより 503 分岐を env 改変なしで再現可能にする。

2. **screening fail 対象外画面**（liffController.ts:691、`session.state_json.screening_result==="fail"`）
3. **未判定スクリーニングの設問絞り込み**（liffController.ts:776-786、`hasScreeningQuestions && !screeningJudged`）
   - 2・3 は **専用の使い捨てテストデータ**が必要。提案: `scripts/seed-test-fixtures.ts`（仮）で
     - screening_config.enabled=true のテスト project
     - screening_result="fail" の session を持つ assignment（→2用）
     - screening 有効・未判定 session の assignment（→3用）
     をテスト専用行として作成（実データ非破壊）。run-screen skill はこの id を使って各分岐を描画検証する。

> **STOP-GATE**: C は seed スクリプト追加＝DBへの書き込みを伴う。実装可否（専用テストデータ方式でよいか、
> 別環境を使うか）を確認してから着手。A・B は即着手可。

---

## 着手順（推奨）
1. A-1（errorHandler の detail 漏洩停止）→ A-2（uuid バリデーション）… 同一PRでよい
2. B（testmaster 側で分母追加）
3. C は方針確認後
