# LINE Developers 設定メモ

本ドキュメントは、コード実装側の準備が完了した後に LINE Developers コンソールで行うべき設定をまとめたものです。  
**実際の LINE Developers 画面での確認・設定は 2026-04-18 時点で未実施です。**

---

## 現状の整理

| 項目 | 状態 |
|------|------|
| LINE_CHANNEL_ACCESS_TOKEN | .env 設定済み |
| LINE_CHANNEL_SECRET | .env 設定済み |
| APP_BASE_URL（HTTPS）| .env 設定済み |
| Webhook 受け口実装 | あり（`/webhooks/line`） |
| LINE_LIFF_CHANNEL_ID | **未設定** |
| LINE_LIFF_ID（汎用） | **未設定** |
| LINE_LIFF_ID_SURVEY | **未設定** |
| LINE_LIFF_ID_MYPAGE | **未設定** |
| LINE_LIFF_ID_RANT | .env 設定済み |
| LINE_LIFF_ID_DIARY | .env 設定済み |
| LINE_LIFF_ID_PERSONALITY | .env 設定済み |

---

## 設定が揃うと動くもの / 揃わないと動かないもの

### LINE_LIFF_CHANNEL_ID が未設定の場合

- `/liff/survey/:assignmentId` の本人確認が無効になる
  - 画面は表示され、回答はできる
  - ただし **assignmentId を知っていれば誰でも開ける状態**（セキュリティリスク）
- `/liff/mypage`, `/liff/rant`, `/liff/diary`, `/liff/personality` の認証も無効になる
- コード側では `503 LIFF_NOT_CONFIGURED` を返すが、survey.ejs はスキップして続行する設計にしてある

### LINE_LIFF_ID_SURVEY が未設定の場合

- `LINE_LIFF_ID`（汎用）にフォールバックする
- 汎用も未設定なら `liffId = null` になり、LIFF SDK は読み込まれず本人確認もスキップ
- 回答は可能

---

## LINE Developers コンソールで行う設定手順

### 1. Messaging API チャネルの確認

1. LINE Developers Console にログイン
2. 対象の Messaging API チャネルを開く
3. 「Messaging API」タブ > 「Webhook settings」
   - Webhook URL: `https://your-app.example.com/webhooks/line`
   - Use Webhook: **ON** にする
4. Channel ID を確認（この値が `LINE_LIFF_CHANNEL_ID` に入る場合もある）

### 2. LIFF App の作成（survey 用）

1. 同チャネルまたは LINE Login チャネルで「LIFF」タブを開く
2. 「Add」で LIFF App を追加
3. 以下を設定:
   - **LIFF app name**: アンケート（任意）
   - **Size**: Full / Tall（推奨: Full）
   - **Endpoint URL**: `https://your-app.example.com/liff/survey`
   - **Scope**: `openid`, `profile` の両方にチェック
   - **Bot link feature**: On (Aggressive) を推奨
4. 作成後に表示される `LIFF ID`（`1234567890-xxxxxxxx` 形式）を `.env` の `LINE_LIFF_ID_SURVEY` に設定

### 3. LIFF App の作成（mypage 用）

1. 同様に LIFF App を追加
2. 以下を設定:
   - **Endpoint URL**: `https://your-app.example.com/liff/mypage`
   - **Scope**: `openid`, `profile`
3. LIFF ID を `.env` の `LINE_LIFF_ID_MYPAGE` に設定

### 4. LINE_LIFF_CHANNEL_ID の設定

- LIFF App を作成したチャネルの **Channel ID** を `LINE_LIFF_CHANNEL_ID` に設定
- Messaging API チャネルと LIFF チャネルが別の場合は LIFF チャネルの Channel ID を使う

### 5. rant / diary / personality の LIFF App 確認

- すでに `LINE_LIFF_ID_RANT` / `LINE_LIFF_ID_DIARY` / `LINE_LIFF_ID_PERSONALITY` が設定済みなら、対応する LIFF App が LINE Developers に存在するか確認する
- Endpoint URL が `APP_BASE_URL` と一致しているか確認する

---

## 動作確認手順（LINE Developers 設定後）

### Webhook 動作確認

1. LINE Developers の Webhook 設定画面で「Verify」ボタンを押す
2. アプリのログに `POST /webhooks/line` が届いていることを確認

### Survey LIFF 動作確認

1. 管理画面 `> プロジェクト > Delivery` を開く
2. 対象の respondent に assignment を作成（Manual Delivery）
3. 「Survey URL」列に表示された URL をコピー
4. LINE の「テストアカウント」またはその respondent の LINE アカウントでURL を開く
5. 以下を確認:
   - 本人であればアンケートが表示される
   - 別の LINE アカウントで同じURLを開いたとき 403 になる
6. `LINE_LIFF_CHANNEL_ID` が未設定の場合は本人確認なしで表示される（設定後に再確認）

### 本人確認が有効になった後の確認

1. `LINE_LIFF_CHANNEL_ID` と `LINE_LIFF_ID_SURVEY` を `.env` に設定してサーバー再起動
2. LIFF SDK が読み込まれ、`liff.init()` が呼ばれることをブラウザコンソールで確認
3. `POST /liff/survey/verify-identity` が呼ばれ `{ ok: true }` が返ることを確認
4. 別人のアカウントで開くと `403 IDENTITY_MISMATCH` が返ることを確認

---

## 既存 LIFF 導線への影響

今回の変更は以下の既存導線に影響を与えません:

- `/liff/rant` / `/liff/diary` / `/liff/personality` → 変更なし
- `/liff/mypage` → 変更なし
- Webhook 処理 → 変更なし
- 既存の `start` / `はじめる` コマンドによるセッション開始 → 変更なし
- CSV エクスポート / 分析系 → 変更なし

`LINE_LIFF_ID_SURVEY` / `LINE_LIFF_ID_MYPAGE` は新規追加の env のみのため、未設定でも既存機能は壊れません。

---

## 機密値の注意

このドキュメントには実際の ID・トークン等の機密値を記載しないでください。  
`.env` ファイルを `.gitignore` に含め、リポジトリに秘密情報をコミットしないようにしてください。
