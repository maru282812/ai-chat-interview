# 要件定義書: Phase 2 project-discovery 統合ポータル

作成日: 2026-06-19

## 目的

公式LINEから個別のLIFFページへ遷移していた既存導線を、案件探索、案件詳細、保存、やりとり、マイページ、ポイント、プロフィール確認を扱える統合ポータルへまとめる。

案件案内はLINE上でカード形式にして配信し、ユーザーがタップすると該当案件を起点に統合ポータルが開く。既存の案件アンケート回答フローは維持する。デイリーアンケートは、短い設問であればLIFFを開かずLINE内で回答できるようにする。

## 背景と現状

- 既存LIFF画面は `/liff/projects`、`/liff/projects/:id`、`/liff/saved-projects`、`/liff/interactions`、`/liff/mypage`、`/liff/daily-survey`、`/liff/survey/:assignmentId` に分かれている。
- project-discovery の土台として、`projects` に `category`、`display_thumbnail_url`、`estimated_minutes`、`max_respondents` などの表示用カラムがあり、`project_favorites` で保存機能を持つ。
- 現在の案件一覧は `projectRepository.listDiscoverable()` が `status = 'published'` の案件を返している。
- 既存の通常案件回答は `/liff/survey/:assignmentId` と `project_assignments` / `sessions` / `answers` を使っているため、このフローは変更しない。
- デイリーアンケートは `daily_surveys`、`daily_survey_questions`、`daily_survey_deliveries`、`daily_survey_answers` とポイント・ストリーク更新処理を持つが、現状はLIFF画面回答が中心。
- リッチメニュー相当のテキスト・アクションは `line_menu_actions` と `liff_entrypoints` で管理されている。

## スコープ

### 対象

- 統合ポータル画面の要件定義
- LINE案件配信カードの要件定義
- リッチメニューから統合ポータル内の指定画面へ直接遷移する導線
- 既存の通常案件回答フローとの接続
- LINE内で完結するデイリーアンケート回答
- PC版とスマホ版のレスポンシブ対応
- 実装者が次工程で画面作成できる画面・API・DB・受け入れ条件

### 対象外

- 通常案件の質問エンジン、AI深掘り、回答保存ロジックの再設計
- 管理画面全体の再設計
- LINE公式アカウント側のリッチメニュー画像制作
- ポイント・ランク計算ロジックの変更
- 企業向け分析画面の追加

## 基本方針

- 統合ポータルは、既存LIFFページを単にリンク集にするのではなく、ひとつのアプリ内で「案件を探す」「詳細を見る」「回答へ進む」「マイページを見る」を完結させる。
- 既存URLは互換性のため残し、必要に応じて統合ポータルの該当ビューへリダイレクトまたは内部リンクする。
- LINE内起動はLIFF ID tokenで本人確認する。PCブラウザでも利用できるよう、既存のWeb認証フォールバック方針を維持する。
- スマホは下部ナビゲーション、PCは左サイドバーまたは上部タブで、同じ情報設計を画面幅に応じて切り替える。
- 添付イメージのように、LINE上の案件配信は横並びカードで複数案件を比較できる形にする。ただし詳細閲覧、検索、保存、マイページは統合ポータル側で扱う。

## ユーザー種別

| ユーザー | 目的 |
|---|---|
| LINE登録ユーザー | 新着案件を確認し、条件に合う案件に回答する |
| 既存回答者 | 途中の案件を再開し、ポイント・履歴・プロフィールを確認する |
| PC利用ユーザー | LINEから開いた後でもブラウザで案件検索やマイページ確認を行う |
| 運営 | 案件案内、デイリーアンケート、リッチメニュー導線の結果を既存DBで追跡する |

## 主要ユーザーフロー

### 新着案件配信から回答

1. 運営が配信対象の案件を準備する。
2. LINEに新着案件カードが複数件配信される。
3. ユーザーがカードの「案件の詳細を見る」をタップする。
4. 統合ポータルが該当案件詳細を開く。
5. ユーザーは詳細、謝礼、所要時間、募集人数、応募状態を確認する。
6. 対象ユーザーに既存 assignment がある場合は `/liff/survey/:assignmentId` へ進む。
7. 回答フロー、完了処理、ポイント付与は既存実装を使う。

### リッチメニューからマイページ

1. ユーザーがLINEのリッチメニュー「マイページ」をタップする。
2. 統合ポータルが `view=mypage` で起動する。
3. マイページのポイント、ランク、回答履歴、プロフィール、交換申請、同意設定を表示する。

### リッチメニューから案件検索

1. ユーザーが「案件を探す」をタップする。
2. 統合ポータルが `view=projects` で起動する。
3. ユーザーは検索、カテゴリ、並び替え、保存済み絞り込みで案件を探す。

### デイリーアンケートをLINE内で回答

1. 運営がデイリーアンケートを配信する。
2. LINEメッセージに設問と回答ボタンを表示する。
3. ユーザーがLINE内で回答する。
4. webhookが回答を受け取り、`daily_survey_answers` に保存する。
5. `daily_survey_deliveries.status` を `answered` にし、既存のポイント・ストリーク・バッジ更新を実行する。
6. 完了メッセージで獲得ポイントと必要に応じて次回導線を返す。

## 画面要件

### 統合ポータル

推奨URL:

- `GET /liff/app`
- 既存互換URL:
  - `/liff/projects` は `/liff/app?view=projects`
  - `/liff/projects/:id` は `/liff/app?view=project&project_id=:id`
  - `/liff/saved-projects` は `/liff/app?view=saved`
  - `/liff/interactions` は `/liff/app?view=interactions`
  - `/liff/mypage` は `/liff/app?view=mypage`

起動パラメータ:

| パラメータ | 用途 |
|---|---|
| `view` | `home` / `projects` / `project` / `saved` / `interactions` / `mypage` |
| `project_id` | 案件詳細を直接開く |
| `assignment_id` | 通常案件回答への再開・開始導線 |
| `source` | `line_card` / `rich_menu` / `manual` など行動ログ用 |
| `category` | 案件一覧の初期カテゴリ |
| `q` | 案件一覧の初期検索語 |

共通表示:

- ロゴまたはサービス名
- 現在のビュー名
- 未回答・進行中案件のショートカット
- PC: 左サイドナビまたは上部タブ
- スマホ: 下部ナビ
- 読み込み、空、エラー、認証失敗の状態表示

### ホーム

目的:

- LINEから開いたユーザーが、次にやることをすぐ選べる入口にする。

表示項目:

- 進行中案件
- 今日のおすすめ案件
- 新着案件
- デイリーアンケートがある場合の通知
- 現在ポイント、ランク、連続回答日数の簡易表示

操作:

- 案件カードタップで案件詳細
- 「案件を探す」で一覧
- 「マイページ」でマイページ
- 進行中案件は既存 `/liff/survey/:assignmentId` へ遷移

### 案件一覧

目的:

- ユーザーが参加可能・公開中の案件を検索、比較、保存できる。

表示項目:

- 案件タイトル
- カテゴリ
- 謝礼ポイント
- 所要時間
- 募集人数または残り枠
- NEW表示
- 保存状態
- 応募・回答状態
- 任意でサムネイル

操作:

- キーワード検索
- カテゴリタブまたはフィルタ
- 並び替え: 新着順、謝礼順、所要時間順
- 保存・保存解除
- 詳細表示

PC表示:

- 2から4列のカードグリッド
- 左または上部にフィルタ
- 詳細ペインを右側に表示してもよい

スマホ表示:

- 1列カード
- 検索欄は上部固定
- 下部ナビとCTAが重ならない

### 案件詳細

目的:

- LINEカードから来たユーザーが、案件の条件を確認して回答へ進める。

表示項目:

- 案件タイトル
- 謝礼ポイント
- 所要時間
- 募集人数・完了人数
- カテゴリ
- 案件説明
- 対象条件または注意事項
- 自分の状態: 未回答、回答中、完了、期限切れ、対象外
- 保存ボタン

操作:

- 対象 assignment があり未完了なら「回答を開始」または「続きから回答」
- 完了済みなら完了状態表示
- 対象 assignment がない場合は「この案件は現在LINE案内対象者のみ参加できます」などの案内
- 保存・保存解除
- 一覧へ戻る

通常案件回答への接続:

- assignment がある場合のみ `/liff/survey/:assignmentId` に遷移する。
- `/liff/survey/:assignmentId` の画面、API、回答保存、完了処理は変更しない。

### 保存済み

目的:

- 気になった案件を後で見返せる。

表示項目:

- 保存済み案件一覧
- 現在受付中かどうか
- 保存日
- 謝礼、所要時間

操作:

- 詳細表示
- 保存解除
- 公開終了案件は「受付終了」として表示し、回答CTAは無効にする。

### やりとり・履歴

目的:

- ユーザーが自分の応募・回答状況を確認できる。

表示項目:

- 未回答
- 回答中
- 完了
- 期限切れ
- 獲得ポイント
- 回答日時

操作:

- 未完了案件の再開
- 完了案件の結果概要またはポイント履歴への導線

### マイページ

目的:

- ポイント、ランク、プロフィール、回答履歴、同意設定、交換申請を統合ポータル内で確認・編集できる。

表示項目:

- ニックネーム
- 現在ポイント
- 利用可能ポイント
- ランク
- 次ランクまでの進捗
- 連続回答日数
- 今月の回答数・獲得ポイント
- 最近のポイント履歴
- プロフィール入力状況
- 同意設定

操作:

- プロフィール編集
- ポイント交換申請
- 回答履歴表示
- 同意設定変更

## LINE案件配信要件

### 新着案件カード

配信形式:

- LINE Flex Messageのcarouselを基本とする。
- 添付イメージのように、日付ごとの新着案件を横並びカードで提示する。
- 1メッセージあたりのカード数が多すぎる場合は、上位数件と「新着案件をもっと見る」カードに分ける。

カード表示:

- 見出し: `6月11日の新着案件` など
- 案件タイトル
- 所要時間
- 謝礼
- 募集人数または残り枠
- カテゴリ
- CTA: `案件の詳細を見る`

タップ動作:

- 案件カードCTAは統合ポータルの案件詳細を開く。
- URL例: `/liff/app?view=project&project_id={projectId}&source=line_card`
- LINE内では `liffService` 経由で該当LIFF IDを使ったURLを生成する。

配信後の状態管理:

- 配信ログは既存の `notification_logs` または `delivery_logs` に残す。
- `project_assignments` がある配信では、既存の `sent` / `opened` / `started` / `completed` を使う。
- カードタップ時に可能であれば `opened` を記録する。

### リッチメニュー深いリンク

リッチメニューの各ボタンは統合ポータルの指定ビューを直接開く。

| メニュー | 起動先 |
|---|---|
| 案件を探す | `/liff/app?view=projects&source=rich_menu` |
| マイページ | `/liff/app?view=mypage&source=rich_menu` |
| 回答中 | `/liff/app?view=interactions&filter=in_progress&source=rich_menu` |
| 保存済み | `/liff/app?view=saved&source=rich_menu` |
| 今日の気持ち・日記 | 既存 `/liff/diary` を維持、将来統合する場合は `/liff/app?view=diary` |
| 本音・悩み | 既存 `/liff/rant` を維持、将来統合する場合は `/liff/app?view=rant` |

DB要件:

- `liff_entrypoints` に `portal` を追加する。
- `line_menu_actions.liff_path` を `portal` または `/liff/app?view=...` に更新できるようにする。
- 既存の `mypage`、`survey`、`rant`、`diary` entrypoint は互換性のため残す。

## デイリーアンケートLINE内回答要件

### 基本方針

- 通常案件の回答フローとは分離する。
- デイリーアンケートは短時間回答を目的に、LINEメッセージ内のボタン・クイックリプライ・postbackで回答する。
- `dailySurveyService.recordAnswer()` 相当の処理を再利用し、ポイント、ストリーク、バッジ、ランク更新を既存と同じ結果にする。

### 対象設問

LINE内回答で扱う設問:

- `single_choice`
- `scale`
- 短い `multiple_choice`
- `text` は自由入力待ち状態を作れる場合のみ対応する。

MVPでは、1メッセージで完結できる1問アンケートを優先する。複数問は webhook 側で回答セッションを持って順番に送る。

### 回答状態

必要な状態:

- 配信済み
- 開封相当
- 回答中
- 回答済み
- 期限切れ
- 重複回答

既存 `daily_survey_deliveries.status` に加え、複数問・自由入力に対応する場合は以下のセッションテーブルを追加する。

```sql
CREATE TABLE IF NOT EXISTS daily_survey_line_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES daily_surveys(id) ON DELETE CASCADE,
  delivery_id uuid NOT NULL REFERENCES daily_survey_deliveries(id) ON DELETE CASCADE,
  line_user_id text NOT NULL REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  current_question_id uuid REFERENCES daily_survey_questions(id) ON DELETE SET NULL,
  answers_json jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'expired', 'cancelled')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (delivery_id)
);
```

### LINE webhook処理

postback payload例:

- `daily_survey:start:{surveyId}`
- `daily_survey:answer:{surveyId}:{questionId}:{value}`
- `daily_survey:skip:{surveyId}:{questionId}`

処理要件:

- webhookの `source.userId` を信頼し、クエリの `line_user_id` は使わない。
- `survey_id` と `line_user_id` から有効な `daily_survey_deliveries` を取得する。
- すでに `answered` の場合は重複回答として保存せず、回答済みメッセージを返す。
- 期限切れの場合は回答不可メッセージを返す。
- 回答完了後は `daily_survey_answers` と `daily_survey_deliveries` を更新し、ポイント付与処理を実行する。

完了メッセージ:

- 獲得ポイント
- 連続回答日数
- ランクアップがあれば通知
- `マイページを見る` CTA

## API要件

### 統合ポータル表示

`GET /liff/app`

- 種別: EJSページ
- 入力: `view`, `project_id`, `assignment_id`, `source`, `category`, `q`
- 認証: クライアント側でLIFF ID token取得後、各data APIへBearer送信
- 出力: 統合ポータルシェル

### 初期データ

`GET /liff/app-data`

- 認証: LIFF ID token必須
- 出力:
  - user summary
  - points summary
  - active assignments count
  - daily survey availability
  - enabled views

既存APIを組み合わせて画面が成立する場合、MVPではこのAPIを作らず、既存の `/liff/projects-data`、`/liff/mypage-data`、`/liff/interactions-data` を利用してもよい。

### 案件一覧

既存 `GET /liff/projects-data` を拡張する。

入力:

- `q`
- `category`
- `sort`
- `limit`
- `offset`
- `saved_only`

出力:

- `projects[]`
- `facets`
- `paging`

追加要件:

- 公開条件を `status = 'published'` に加え、`is_discoverable = true` も使う場合は既存公開案件をバックフィルする。
- タイトル検索は `user_display_title` と `name` を対象にする。

### 案件詳細

既存 `GET /liff/projects/:id/data` を継続利用する。

追加要件:

- 自分の assignment 状態
- 回答開始URL
- 対象外理由を表示できる場合は返す
- 受付終了・非公開時は404または受付終了レスポンスにする

### 保存

既存 `POST /liff/projects/:id/favorite` を継続利用する。

### マイページ

既存 `GET /liff/mypage-data`、`GET /liff/history-data`、`GET /liff/points-data`、`POST /liff/mypage-data`、`POST /liff/exchange-requests` を継続利用する。

### デイリーアンケートLINE回答

webhookの postback / message で受ける。既存 `/liff/daily-survey/:surveyId/answer` はLIFF fallbackとして残す。

## DB要件

既存利用:

| テーブル | 用途 |
|---|---|
| `projects` | 案件基本情報、公開状態、表示メタデータ |
| `project_assignments` | ユーザーごとの案件配信・回答状態 |
| `project_favorites` | 保存済み案件 |
| `sessions` / `answers` | 通常案件回答 |
| `daily_surveys` | デイリーアンケート本体 |
| `daily_survey_questions` | デイリーアンケート設問 |
| `daily_survey_deliveries` | デイリーアンケート配信状態 |
| `daily_survey_answers` | デイリーアンケート回答 |
| `line_menu_actions` | リッチメニュー・テキスト導線 |
| `liff_entrypoints` | LIFF起動先管理 |
| `notification_logs` / `delivery_logs` | 配信記録 |

追加・見直し:

| 対象 | 要件 |
|---|---|
| `projects.is_discoverable` | 統合ポータル表示可否に使う場合、既存 `published` 案件を true にバックフィルする |
| `liff_entrypoints` | `portal` entrypoint を追加する |
| `line_menu_actions` | `portal` の深いリンクを設定できるようにする |
| `daily_survey_line_sessions` | 複数問・自由入力のLINE内回答に必要 |

## 権限・セキュリティ要件

- LIFF data APIはBearer ID tokenを必須にする。
- line_user_id はサーバー側でID tokenまたはLINE webhook sourceから取得する。
- 他ユーザーの保存案件、assignment、ポイント、プロフィールを取得できないこと。
- 案件詳細は公開状態を確認する。非公開・停止・アーカイブは表示しない。
- assignment がない案件では通常案件回答URLを発行しない。
- デイリーアンケートのpostbackは、配信対象ユーザー・有効期限・回答済みを検証する。
- PCブラウザ利用時も認証状態なしで個人情報を表示しない。

## レスポンシブ要件

対応幅:

- スマホ: 360px以上
- タブレット: 768px以上
- PC: 1024px以上

スマホ:

- 下部ナビ
- 1列カード
- CTAは親指で押しやすい固定またはカード下部配置
- LINE内ブラウザの高さ制約を考慮する

PC:

- 最大幅固定ではなく、横幅を活かした一覧表示
- サイドバーまたは上部ナビ
- 案件一覧は複数列
- マイページはサマリー、履歴、プロフィールを分割表示

共通:

- 画面幅変更で情報が欠落しない
- ボタンやテキストが重ならない
- LIFF内でも通常ブラウザでも破綻しない

## 受け入れ条件

- [ ] LINEで新着案件カードを受け取り、任意の案件カードから統合ポータルの該当案件詳細が開く。
- [ ] 案件詳細から既存の `/liff/survey/:assignmentId` へ進み、既存の回答・完了・ポイント付与が変わらず動く。
- [ ] リッチメニューの「マイページ」から統合ポータルのマイページが直接開く。
- [ ] リッチメニューの「案件を探す」から検索可能な案件一覧が開く。
- [ ] スマホ幅360px、390px、PC幅1366pxで主要画面の表示が破綻しない。
- [ ] 案件一覧で検索、カテゴリ、並び替え、保存、詳細遷移ができる。
- [ ] 保存済み案件で受付中・受付終了の状態が分かる。
- [ ] デイリーアンケートをLINE内ボタンで回答でき、`daily_survey_answers`、`daily_survey_deliveries.status = answered`、ポイント・ストリークが更新される。
- [ ] デイリーアンケートに重複回答した場合、追加保存や二重ポイント付与が発生しない。
- [ ] 認証なし、別ユーザー、非公開案件、期限切れdaily surveyの異常系が安全に処理される。
- [ ] 既存の `/liff/projects`、`/liff/mypage`、`/liff/survey/:assignmentId` は互換性を失わない。

## 実装指示メモ

推奨順序:

1. `liff_entrypoints` に `portal` を追加し、`liffService` で統合ポータルURLを生成できるようにする。
2. `GET /liff/app` と `src/views/liff/app.ejs` を作る。
3. 既存の `/liff/projects-data`、`/liff/projects/:id/data`、`/liff/mypage-data`、`/liff/interactions-data` を統合ポータルから呼び出す。
4. 既存 `/liff/projects` などは統合ポータルへ寄せる。完全削除はしない。
5. LINE新着案件カードをcarousel化し、CTAを統合ポータルの詳細URLへ変更する。
6. `line_menu_actions` のリッチメニュー導線を統合ポータルの深いリンクへ更新する。
7. デイリーアンケートLINE内回答のpostback処理を追加する。
8. 複数問・自由入力対応が必要な場合は `daily_survey_line_sessions` を追加する。
9. PC・スマホ表示をPlaywrightまたはブラウザで確認する。
10. `npm run build` と関連テストを実行する。

触らないもの:

- 通常案件の質問進行ロジック
- `/liff/survey/:assignmentId` の回答保存・完了処理
- 既存ポイント・ランク計算の意味
- 既存マイページAPIのレスポンス互換性

次工程で画面作成する場合の前提:

- 新規画面は統合ポータルを第一画面にする。
- スマホ専用デザインで終わらせず、PC幅の一覧・マイページ表示を別レイアウトとして用意する。
- 既存のEJS構成に合わせる場合は `src/views/liff/app.ejs` にまとめ、必要に応じて `src/public` にCSS/JSを分離する。
- 画面文言は文字化けしている既存文言を流用せず、日本語として読み直して作る。
