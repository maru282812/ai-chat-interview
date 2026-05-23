# LINE / LIFF セットアップガイド

本ドキュメントは、コード実装側の準備が完了した後に LINE Developers コンソールで行うべき設定、および env との対応関係をまとめたものです。

**実値は各環境の `.env` で設定すること。このドキュメントには実際の ID・トークン等の機密値を記載しないでください。**

最終更新: 2026-05-22

---

## 1. env キー一覧と現状

### 1-1. `.env.example` に存在する LINE/LIFF 関連キー

| env キー | 用途 | 必須 |
|---|---|---|
| LINE_CHANNEL_ACCESS_TOKEN | Messaging API: Bot メッセージ送信・Webhook | 必須 |
| LINE_CHANNEL_SECRET | Messaging API: Webhook 署名検証 | 必須 |
| LINE_LIFF_CHANNEL_ID | LIFF ID token 検証用チャネル ID | 本人確認時必須 |
| LINE_LIFF_ID | 汎用 LIFF ID（個別設定のフォールバック） | 任意 |
| LINE_LIFF_ID_SURVEY | survey 専用 LIFF App ID | 本人確認時必須 |
| LINE_LIFF_ID_MYPAGE | mypage 専用 LIFF App ID | 任意 |
| LINE_LIFF_ID_RANT | rant 専用 LIFF App ID | 任意 |
| LINE_LIFF_ID_DIARY | diary 専用 LIFF App ID | 任意 |
| LINE_LIFF_ID_PERSONALITY | personality 専用 LIFF App ID | 任意 |
| LINE_LIFF_ID_CONTACT | お問い合わせ専用 LIFF App ID | 任意 |
| RESEND_API_KEY | Resend メール送信 API キー（お問い合わせ通知） | 任意 |
| ADMIN_NOTIFICATION_EMAIL | お問い合わせ通知の送信先メールアドレス | 任意 |
| LIFF_AUTH_REQUIRED | Survey 本人確認を必須化するか（本番: true） | 推奨 |
| ALLOW_LIFF_AUTH_SKIP | クライアント側スキップを許可するか（本番: false） | 推奨 |

### 1-2. コードで参照している env キー

| env キー | 参照箇所 |
|---|---|
| LINE_CHANNEL_ACCESS_TOKEN | `src/services/lineService.ts` 等（Messaging API 送信） |
| LINE_CHANNEL_SECRET | `src/routes/webhookRoutes.ts`（Webhook 署名検証） |
| LINE_LIFF_CHANNEL_ID | `src/services/liffAuthService.ts`（ID token 検証） |
| LINE_LIFF_ID | `src/services/liffService.ts`（フォールバック） |
| LINE_LIFF_ID_SURVEY | `src/services/liffService.ts` |
| LINE_LIFF_ID_MYPAGE | `src/services/liffService.ts` |
| LINE_LIFF_ID_RANT | `src/services/liffService.ts` |
| LINE_LIFF_ID_DIARY | `src/services/liffService.ts` |
| LINE_LIFF_ID_PERSONALITY | `src/services/liffService.ts` |
| LINE_LIFF_ID_CONTACT | `src/controllers/liffController.ts`（contactPage） |
| RESEND_API_KEY | `src/controllers/liffController.ts`（submitContact） |
| ADMIN_NOTIFICATION_EMAIL | `src/controllers/liffController.ts`（submitContact） |
| LIFF_AUTH_REQUIRED | `src/config/env.ts` → `getSurveyLiffConfig()` |
| ALLOW_LIFF_AUTH_SKIP | `src/config/env.ts` → `getSurveyLiffConfig()` |

### 1-3. 設定状態の見方

`LINE_SETUP.md`（旧版）の「未設定」表記は、LINE Developers でまだ LIFF App を作成していない状態を指しています。実際に設定が完了したら `.env` に値を入れてください。「未設定」表現はコード側の問題ではありません。

---

## 2. チャネル構成：Messaging API と LINE Login の役割分離

### 2-1. Messaging API チャネル

**用途**

- Webhook 受信（ユーザーメッセージ、友だち追加イベント等）
- Bot メッセージ送信（Reply / Push）
- リッチメニュー設定
- 友だち追加導線

**必要な env**

```
LINE_CHANNEL_ACCESS_TOKEN=<Messaging API チャネルのアクセストークン>
LINE_CHANNEL_SECRET=<Messaging API チャネルのシークレット>
```

**Webhook URL**

```
{APP_BASE_URL}/webhooks/line
```

LINE Developers > Messaging API タブ > Webhook settings で設定し、「Use Webhook」を ON にすること。

---

### 2-2. LINE Login チャネル（LIFF 用）

**用途**

- LIFF App の登録・管理
- LIFF 認証（liff.init / liff.getIDToken）
- ID token 検証（LINE API `oauth2/v2.1/verify`）
- LINE User ID 取得

**必要な env**

```
LINE_LIFF_CHANNEL_ID=<LINE Login チャネルの Channel ID>
LINE_LIFF_ID_SURVEY=<survey 用 LIFF App ID>
LINE_LIFF_ID_MYPAGE=<mypage 用 LIFF App ID>
LINE_LIFF_ID_RANT=<rant 用 LIFF App ID>
LINE_LIFF_ID_DIARY=<diary 用 LIFF App ID>
LINE_LIFF_ID_PERSONALITY=<personality 用 LIFF App ID>
```

**チャネル分離の注意点**

| パターン | 説明 |
|---|---|
| Messaging API と同一チャネルで LIFF を作成する場合 | Channel ID が共通。`LINE_LIFF_CHANNEL_ID` には Messaging API チャネルの Channel ID を設定する。 |
| LINE Login チャネルを別途作成する場合（推奨） | `LINE_LIFF_CHANNEL_ID` には **LINE Login チャネル** の Channel ID を設定すること。Messaging API の Channel ID ではない。LIFF App はすべて LINE Login チャネルに紐づける。 |

LINE Login チャネルを分離する場合、Messaging API チャネルとの Bot リンク機能（Bot link feature）を設定することで友だち追加と LIFF を連携できる。

---

## 3. LIFF App 一覧

### 3-1. 一覧表

| 用途 | env キー | Endpoint | 必須 scope | 認証要否 | 備考 |
|---|---|---|---|---|---|
| Survey（アンケート） | LINE_LIFF_ID_SURVEY | `/liff/survey` | openid, profile | **必須** | assignment 本人確認あり |
| MyPage（マイページ） | LINE_LIFF_ID_MYPAGE | `/liff/mypage` | openid, profile | 必須 | 会員情報管理 |
| Rant（本音・悩み） | LINE_LIFF_ID_RANT | `/liff/rant` | openid, profile | 要確認 | 既存導線 |
| Diary（今日の気持ち） | LINE_LIFF_ID_DIARY | `/liff/diary` | openid, profile | 要確認 | 既存導線 |
| Personality（性格診断） | LINE_LIFF_ID_PERSONALITY | `/liff/personality` | openid, profile | 要確認 | 既存導線 |
| Contact（お問い合わせ） | LINE_LIFF_ID_CONTACT | `/liff/contact` | openid, profile | 必須 | Resend でメール通知・DB保存 |

`LINE_LIFF_ID`（汎用）は個別設定がない場合のフォールバックとして使用される。本番では各機能に専用 LIFF を用意することを推奨。

### 3-2. LINE Developers での LIFF App 作成推奨設定

各 LIFF App を LINE Developers で作成する際の推奨値：

| 項目 | 推奨値 |
|---|---|
| LIFF app name | 用途に応じた名称（例: `アンケート`, `マイページ`） |
| Size | Full（全画面） |
| Endpoint URL | `{APP_BASE_URL}/liff/{機能名}` |
| Scope | `openid` と `profile` の両方にチェック |
| Bot link feature | On (Aggressive)（友だち追加済みの場合は Aggressive 推奨） |
| Scan QR | 不要 |

---

## 4. Survey LIFF 本人確認フロー

### 4-1. 処理の流れ

Survey LIFF を開いた際の本人確認は、**ユーザーに操作を求めない**サイレント認証です。LINEアプリ内で自動的に処理されます。

```
1. LINEから Survey URL を開く
2. サーバーが assignment_id を受け取り、liffConfig を評価
   - LIFF_AUTH_REQUIRED=true かつ LIFF 設定不足 → 503 エラー画面（回答不可）
3. survey.ejs が返される（liffId / authRequired / skipAllowed を含む）
4. クライアント側で liff.init() を実行
5. liff.getIDToken() で ID token を取得（ユーザー操作不要）
6. POST /liff/survey/verify-identity に id_token + assignment_id を送信
7. サーバー側で LINE API に ID token を検証
8. LINE User ID と assignment.user_id を照合
   - 一致: { ok: true } → 回答画面を表示
   - 不一致: 403 → 「ご本人専用」エラー画面
9. LIFF 設定不足: 503 → skipAllowed に応じてブロック or 警告スキップ
```

### 4-2. 環境別の挙動

| 環境 | LIFF 設定不足 | 本人確認 | 推奨 env 設定 |
|---|---|---|---|
| local / dev | 警告ログを出してスキップ可 | 任意 | `LIFF_AUTH_REQUIRED=false` `ALLOW_LIFF_AUTH_SKIP=true` |
| staging | 原則必須 | 必須 | `LIFF_AUTH_REQUIRED=true` `ALLOW_LIFF_AUTH_SKIP=false` |
| production | エラーで停止（回答不可） | 必須 | `LIFF_AUTH_REQUIRED=true` `ALLOW_LIFF_AUTH_SKIP=false` |

### 4-3. エラー表示一覧

| 状況 | ユーザー向けメッセージ |
|---|---|
| LIFF 設定不足（管理者設定ミス） | 「アンケート画面の設定が完了していません。管理者にお問い合わせください。」 |
| LINE 外ブラウザで開いた | 「このアンケートはLINEアプリ内から開いてください。」 |
| 本人不一致（別アカウント） | 「このアンケートはご本人専用です。配信されたLINEアカウントから開いてください。」 |
| ID token 検証失敗 | 「本人確認に失敗しました。LINEアプリから再度開いてください。」 |
| liff.init() 失敗 | 「画面の初期化に失敗しました。LINEアプリから再度開いてください。」 |

### 4-4. ログ出力一覧

サーバー側（`logger.*`）で出力するログ：

| ログキー | 出力タイミング | 含まれるフィールド |
|---|---|---|
| `survey.page.liffConfig` | Survey ページ表示時 | assignmentId, liffAuthAvailable, authRequired, skipAllowed, missingEnvVars |
| `survey.page.liffConfigMissing` | 本番モードで設定不足を検知 | assignmentId, missingEnvVars |
| `verifyIdentity.start` | verify-identity API 開始 | assignmentId |
| `verifyIdentity.liffNotConfigured` | LIFF 未設定 | assignmentId, missingEnvVars, authRequired |
| `verifyIdentity.tokenVerificationFailed` | ID token 検証エラー | assignmentId, error |
| `verifyIdentity.mismatch` | 本人不一致 | assignmentId, respondentId, reason |
| `verifyIdentity.success` | 本人確認成功 | assignmentId, respondentId |
| `liffAuth.verifyIdToken.success` | LINE API 検証成功 | userId |
| `liffAuth.verifyIdToken.lineApiRejected` | LINE API 拒否 | status |
| `liffAuth.verifyIdToken.fetchFailed` | LINE API への通信失敗 | error |

**注意**: ID token そのものはログに出力しない。`userId` は識別のために出力するが、機密性を考慮してログ管理を行うこと。

クライアント側（`console.*`）のログは survey.ejs に実装済み。ブラウザの開発者コンソールで確認できる。

---

## 5. LINE Developers コンソール 設定手順

### 5-1. Messaging API チャネルの確認

1. LINE Developers Console にログイン
2. 対象の Messaging API チャネルを開く
3. 「Messaging API」タブ > 「Webhook settings」
   - Webhook URL: `{APP_BASE_URL}/webhooks/line`
   - Use Webhook: **ON** にする
4. 「Verify」ボタンで疎通確認

### 5-2. LINE Login チャネルの作成（未作成の場合）

1. Provider > 「Create a new channel」 > 「LINE Login」
2. Channel 名・説明を入力して作成
3. 「Basic settings」タブ > Channel ID をメモ → `.env` の `LINE_LIFF_CHANNEL_ID` に設定

### 5-3. LIFF App の作成（各機能）

1. LINE Login チャネルを開く
2. 「LIFF」タブ > 「Add」
3. 各機能の設定（Section 3-2 の推奨設定を参照）
4. 作成後に表示される LIFF ID（`1234567890-xxxxxxxx` 形式）を対応する env に設定

### 5-4. rant / diary / personality の既存 LIFF 確認

これらは既に `LINE_LIFF_ID_RANT` / `LINE_LIFF_ID_DIARY` / `LINE_LIFF_ID_PERSONALITY` として設定済みの場合がある。  
LINE Developers に対応する LIFF App が存在し、Endpoint URL が `APP_BASE_URL` と一致しているか確認すること。

---

## 6. 動作確認手順

### 6-1. Webhook 動作確認

1. LINE Developers の Webhook 設定画面で「Verify」を押す
2. アプリのログに `POST /webhooks/line` が届くことを確認

### 6-2. Survey LIFF 本人確認動作確認

1. 管理画面 > プロジェクト > Delivery で対象 respondent に assignment を作成
2. 「Survey URL」列の URL をコピー
3. 対象の LINE アカウントで URL を開く（LINEアプリ内）
4. 確認事項:
   - 本人アカウント → アンケートが表示される
   - 別の LINE アカウントで同じ URL を開く → 「ご本人専用」エラーが表示される
5. `LIFF_AUTH_REQUIRED=true` `ALLOW_LIFF_AUTH_SKIP=false` の状態で、`LINE_LIFF_CHANNEL_ID` を空にすると → 設定不足エラー画面が表示される（回答不可）

### 6-3. 開発環境での確認

`LIFF_AUTH_REQUIRED=false` `ALLOW_LIFF_AUTH_SKIP=true` の状態では、LIFF 設定がなくても回答画面が表示される（警告ログのみ）。開発・テスト用途。

---

## 7. Rich Menu 設計方針

### 7-1. ボタン配置（URI タイプ / LIFF 直接遷移）

リッチメニューは全ボタンを **テキスト送信からURIアクションへ変更** し、Webhook を経由せず即座に LIFF 画面を開く構成にする。

| ボタン | アクションタイプ | URI | 遷移先 |
|---|---|---|---|
| 案件一覧 | URI | `https://liff.line.me/{LINE_LIFF_ID_SURVEY}` | `/liff/survey` |
| マイページ | URI | `https://liff.line.me/{LINE_LIFF_ID_MYPAGE}` | `/liff/mypage` |
| 今日の気持ち | URI | `https://liff.line.me/{LINE_LIFF_ID_DIARY}` | `/liff/diary` |
| 本音・悩み | URI | `https://liff.line.me/{LINE_LIFF_ID_RANT}` | `/liff/rant` |
| 性格診断 | URI | `https://liff.line.me/{LINE_LIFF_ID_PERSONALITY}` | `/liff/personality` |
| お問い合わせ | URI | `https://liff.line.me/{LINE_LIFF_ID_CONTACT}` | `/liff/contact` |

**変更前（テキスト送信）との違い:**
- テキストが LINE トークに送信されない
- Webhook 処理を経由しない（"マイページ"/"案件一覧" 等のキーワード判定が不要になる）
- ボタン押下で即座に LIFF 画面が開く

### 7-2. Rich Menu 作成方針

- Rich Menu は LINE Developers コンソールまたは Messaging API（`/v2/bot/richmenu`）で作成する
- 画像サイズ: 2500×1686 px（Full size）または 2500×843 px（Half size）推奨
- 各ボタンのアクション設定: `type: uri` / `uri: https://liff.line.me/{各LIFF_ID}` を設定する
- 友だち追加時にデフォルト Rich Menu を自動適用するには、LINE Developers で「Default rich menu」に設定する
- ユーザー別の Rich Menu 切り替えが必要な場合は Messaging API の `link richmenu to user` を使用する

### 7-3. 不要になる Webhook テキスト判定

以下のキーワード処理は、リッチメニューを URI タイプに変更すると不要になる。
即削除せず、既存利用箇所がないことを確認してから整理すること。

```
if (text === "マイページ")   // → /liff/mypage へ直接遷移
if (text === "案件一覧")     // → /liff/survey へ直接遷移
```

### 7-4. 現時点でのスコープ外

以下は Rich Menu から誘導する想定だが、画面が未実装のため将来対応とする:

- ポイント一覧画面（個別）
- 回答履歴一覧画面（個別）
- プロフィール設定画面（個別）

---

## 8. お問い合わせ LIFF 仕様

### 8-1. 機能概要

| 項目 | 内容 |
|---|---|
| ルート | `GET /liff/contact`（画面）/ `POST /liff/contact`（送信） |
| 認証 | Bearer トークン（LINE ID token 必須） |
| DB | `contact_messages` テーブルに保存（migration: 025_contact_messages.sql） |
| メール | Resend で `ADMIN_NOTIFICATION_EMAIL` へ通知（未設定時はスキップ） |
| 二重送信防止 | 送信中はボタン disabled、送信後は成功画面に切り替え |

### 8-2. 問い合わせ種別

| value | 表示名 |
|---|---|
| service | サービスについて |
| project | 案件について |
| bug | 不具合報告 |
| points | ポイントについて |
| other | その他 |

### 8-3. セットアップ手順

1. LINE Developers で Contact 用 LIFF App を作成（他と同様に Full size / openid+profile）
2. `.env` に設定:
   ```
   LINE_LIFF_ID_CONTACT=<Contact 用 LIFF App ID>
   RESEND_API_KEY=re_...          # https://resend.com で取得
   ADMIN_NOTIFICATION_EMAIL=admin@example.com
   ```
3. Resend のダッシュボードで送信ドメインを設定（`from` アドレスの検証）
4. Supabase で migration `025_contact_messages.sql` を適用
5. リッチメニューのお問い合わせボタンを URI タイプに変更（7-1 参照）

---

## 9. 既存導線への影響

今回の変更（お問い合わせ LIFF 追加・リッチメニュー URI 化）は以下の挙動に影響を与えない:

- `/liff/rant` / `/liff/diary` / `/liff/personality` / `/liff/mypage` / `/liff/survey` → 変更なし
- Webhook 処理本体 → 変更なし（テキスト判定はリッチメニュー URI 化後に個別整理）
- 既存の `start` / `はじめる` コマンドによるセッション開始 → 変更なし
- CSV エクスポート / 分析系 → 変更なし

`LINE_LIFF_ID_CONTACT` / `RESEND_API_KEY` / `ADMIN_NOTIFICATION_EMAIL` はすべて optional で、未設定時は:
- `LINE_LIFF_ID_CONTACT` 未設定 → `/liff/contact` は `LINE_LIFF_ID`（汎用）にフォールバック
- `RESEND_API_KEY` 未設定 → メール送信をスキップし、DB 保存のみ実施

---

## 10. 機密値の注意

- このドキュメントには実際の ID・トークン等の機密値を記載しないこと
- `.env` ファイルを `.gitignore` に含め、リポジトリに秘密情報をコミットしないこと
- 実値は各環境（local / staging / production）の `.env` でそれぞれ設定すること
