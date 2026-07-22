# 管理画面レビュー（2026-07-22）

対象: `src/views/admin/**`（80ビュー）＋ `src/controllers/adminController.ts` / `src/routes/adminRoutes.ts` / `src/middleware/adminAuth.ts` / `src/public/styles.css`

方法: 全ビューをコード読解。実機・ブラウザ検証は未実施（＝「必ず404」「必ずズレる」等の断定はコード上の帰結であり、実行確認はしていない）。

---

## 総評

機能の作り込みは深いが、**「管理業務の道具」としての基礎体力が欠けている**。特に3点。

1. **一覧が全部スケールしない**。ページング不在か、上限で黙って打ち切って、その打ち切った母集団の集計を「総数」として表示している画面がある（＝数字が静かに嘘になる）。
2. **本番へ実配信する操作の確認強度が画面ごとにバラバラ**。プロンプトパッケージの公開確認（影響一覧＋チェック必須）は非常に良い設計なのに、LINE一斉配信には confirm すら無い箇所がある。
3. **共通基盤が無い**ため、日時フォーマット・ステータス日本語ラベル・成功トースト・テーブル横スクロールが各画面の実装者任せになり、全部不揃い。ここは1回作れば全画面に効く。

---

## P0 — 事故る / 数字が嘘になる

### P0-1 集計値が打ち切り母集団で計算されている
| 箇所 | 内容 |
|---|---|
| `adminController.ts:3341` + `points/index.ejs:21-26` | `listSummaries(500)` の500件で「ユーザー総数」「総発行ポイント合計」を計算・表示。501人目以降は存在しないことになる。`userPointService.listSummaries` は `offset` を受けるのにUIから渡していない |
| `postAnalysis` (`adminService.ts:264-290` + `postRepository.ts:267`) | DBから200件取得後にアプリ側で sentiment / tag を後段フィルタ。「ネガティブ絞り込み」の結果は実際には「最新200件のうちのネガティブ」 |
| `posts/index.ejs:116-174` | 既定200件で無告知打ち切り。総件数表示なし＝古い投稿が存在しないように見える |
| `badges/index.ejs:131` (`adminController.ts:3384`) | `slice(0,50)` 固定。51人目以降に到達する手段なし |

→ **集計は必ずDB側の `count()` / `sum()` で取る。一覧は `range()` でページング。**

### P0-2 一覧のLIMIT無し全件ロード
- `respondents/index.ejs` + `researchOpsService.ts:240-244`: **全回答者＋全セッションをLIMIT無しでロード**してメモリ結合。ユーザー増加で確実にタイムアウト。検索・絞り込み・並び替え・ページングが一つも無い
- `applications` (`adminController.ts:8330-8335`): 全プロジェクト分を `Promise.all` で個別クエリ→メモリで flat+sort
- `exchange-requests` (`adminController.ts:6758-6768`): `listAll(500,0)` してメモリでフィルタ＆ページング。501件目以降は永久に見えず、ステータス別カウンタも誤る

### P0-3 セグメント配信の「推定人数」と実配信対象が別ロジック
`adminController.ts:5311-5339` の `executeCampaign` はセグメント条件を `segment.conditions.conditions` で読むが、`segments/form.ejs:266,275` が保存する現行フォーマットは `{operator, groups:[...]}`。
一方プレビュー/評価は `evaluateConditionsCount`（`adminController.ts:2442-2472, 4892-4917`）で全フィールド・AND/OR対応。

→ 条件が黙って無視された場合、**「20代女性向け」のつもりが全会員配信になりうる**。実行側をプレビューと同じ評価関数に統一し、未対応フィールドを検出したら実行を中断する。

### P0-4 実配信に confirm / 件数表示 / 二重送信防止が無い
| 箇所 | 内容 |
|---|---|
| `scheduler-settings/index.ejs:118-128` | 「朝の配信を今すぐ実行」「夜の配信」「未回答リマインダー」が **confirm無し・件数表示無し・連打可能**の素submit |
| `projects/deliveryV2.ejs:37-45,47-117,119-215` | 「Send Reminders」＝未回答者全員へ即送信、「Assign And Push」「Assign By Rule」も対象件数の事前提示なしで即実行 |
| `daily-surveys/show.ejs:172-198` | confirm はあるが対象人数が出ず、submit時のボタンdisableが無い |
| `delivery-templates/list.ejs:64-66` | confirm が「今すぐ実行しますか？」のみ。テンプレート名も対象件数も出ない |
| `segments/campaigns.ejs:85-106` / `segments/index.ejs:155-176` | confirm に対象人数もセグメント名も無い。暗黙のグローバル `event` に依存した実装 |
| `delivery-operations/index.ejs:995-1024` | **セグメント未選択＝全会員配信**なのに、モーダルは「全会員」と文字表示するだけで件数を出さない |

→ **`prompt-packages/publish-confirm.ejs:90-103` の「影響一覧＋『確認しました』チェック必須」パターンを配信実行系へ横展開する。**社内に良い型があるのに使われていない。

### P0-5 公開後の設問編集にガードが無い
`questions/formV3.ejs` は `project.status` を参照していない。回答が入った後に設問文・選択肢・`question_type` を無警告で変更できる。
設問削除（`public/flowCanvas.js:1618-1636` + `adminController.ts:4281-4297`）は既存回答の有無を確認しない**物理削除**。

→ ロウデータの列契約（memory: wide/long/codebook は集計アプリ契約で凍結）を直接壊す経路。回答件数を出す警告バナー＋公開後は論理削除へ誘導。

### P0-6 予約したはずの配信が飛ばない
`segments/campaign-form.ejs:56` は「設定時刻に自動実行されます」と明記しているが、`delivery_campaigns` / `scheduled_at` を参照するスケジューラが存在しない（`cronDispatchService` / `notificationSchedulerService` のいずれにも参照なし。参照は controller と view のみ）。

### P0-7 UTC値を datetime-local に入れている
`segments/campaign-form.ejs:53-55,62-64` は `new Date(...).toISOString().slice(0,16)` をローカル時刻欄の value に使用。**編集して保存し直すたびに予約時刻が9時間ずれる**（回答期限も同様）。`reward-campaigns/form.ejs:112,118` も同型。

### P0-8 バリデーションを丸ごとスキップしている
`questions/formV3.ejs:1881-1918`: submit ハンドラで `preventDefault()` → 最後に `form.submit()`。`form.submit()` は **HTML5 の `required` 検証を完全にスキップ**し、`submit` イベントも再発火しないため `isDirty=false`（2102行）にも到達しない。→ `form.requestSubmit()` へ。

### P0-9 CSRF対策が存在しない
リポジトリ全体で `csrf` の実装ゼロ。Basic認証＋生フォームPOSTで、ポイント付与・交換申請承認・LINE配信を含む全操作が対象。

### P0-10 QRコードを外部サービスに送信している
`store-surveys/index.ejs:87`: 店舗限定URL（`entry_code` 込み）を `api.qrserver.com` へクエリで送信して生成。限定URLが第三者に渡り、当該サービス停止でQRが表示されなくなる。→ サーバ側で `qrcode` 生成。

---

## P1 — 共通基盤（1回直せば全画面に効く）

### P1-1 フラッシュ / トースト基盤が無い
`adminController.ts` の `res.redirect` は119箇所、うち成功を伝えているのは `?saved=1` の6箇所のみ。
`points` / `ranks` / `respondents` / `data-management` 系はすべて素のリダイレクトで、**成功も失敗も無反応**。
`adjustUserPoints`（`adminController.ts:3356-3373`）は `isNaN` / `0` のとき黙って戻るだけ。

→ `res.locals.flash` + `header.ejs` に共通トースト領域を1箇所実装し、全redirectを統一。

### P1-2 ナビゲーション
`partials/header.ejs:12-35` — 22本のフラットリンク。グループ化なし、**現在地ハイライトなし**、パンくずなし、ログイン中の管理者名もログアウトも無し（`user-profiles` だけ独自ログアウト）。

### P1-3 レスポンシブが存在しない
`styles.css` に **`@media` が0件**。テーブルを持つ59ファイルのうち `.table-scroll` でラップしているのは5ファイルのみ。
未対応で列数が多い: `applications`(6)、`exchange-requests`(8)、`points`(9)、`respondents`(10)、`sessions/show`(8列＋生JSON)、`badges`、`data-management`。

### P1-4 日時フォーマットが3方式混在＋生ISO出力
`toLocaleString('ja-JP')` / `toLocaleDateString('ja-JP')` / 手動 `slice()` が混在。TZ明記は `scheduler-settings` と `delivery-templates/form` だけ。

生ISO文字列をそのまま出している箇所: `respondents/index.ejs:32`、`respondents/show.ejs:44,46,67`、`sessions/show.ejs:57,58,129`、`posts/index.ejs:135`、`posts/show.ejs:10`、`postAnalysis/index.ejs:124`。
年が無い: `applications/index.ejs:15-19`（`M/D HH:mm`）、`delivery-operations/index.ejs:586`。
UTC日付を `slice(0,10)`: `clients/overview.ejs:66`（日付境界で1日ずれる）。

→ `YYYY/MM/DD HH:mm (JST)` に統一するヘルパを1本用意して全画面適用。

### P1-5 ステータス日本語ラベルが各所に散在・未使用
`researchForm.ejs:11-14` に `published→「LIFF掲載中」` の定義があるのに一覧側で使っていない。`store-surveys/index.ejs:4-15`、`clients/overview.ejs:4-11`、`delivery-templates/list.ejs:4-11` にも別々のラベル定義。

コード値を生表示している箇所（抜粋）: `question_type` / `question_role` / `project.status` / `research_mode` / assignment status / `delivery_type` / `attr_key` / `consent_source` / `sender_type` / `purpose` / `prompt_key`。

→ `STATUS_LABELS` を partial（or helper）に集約し全画面で共用。

### P1-6 日英混在
全面英語UIの画面: `respondents/index.ejs`（Project/Name/LINE User/…/Action）、`respondents/show.ejs`、`sessions/show.ejs`、`posts/*`、`postAnalysis/*`（加えて Specificity / Novelty / Actionability を無説明で露出）、`ranks/index.ejs`（`min_points` / `badge_label` という生カラム名）、`projects/deliveryV2.ejs`（同一画面内で英日が混在）。

### P1-7 監査・操作者記録がゼロ
`adminAuth.ts` は**単一Basicアカウントのみ**。権限区分なし。`res.locals.adminUser` は置かれているが、配信・cron実行・ポイント付与・ランク閾値変更・当選/落選・交換承認のいずれも画面上に「誰がいつ」が残らない（監査テーブルは `053_exchange_audit_log.sql` のみ）。

さらに `user-profiles` だけ独自のログイン/ログアウト機構（`adminController.ts:5505-5545`）を持ち、認証系統が二重になっている。

### P1-8 空状態が不揃い
0件時にヘッダだけのテーブルが残り「データが無いのか読み込み失敗なのか」が区別できない画面が多数（`respondents/index`、`projects/indexDesigner`、`questions/indexDesigner`、`deliveryV2` の各テーブル、`sessions/show` の回答/メッセージ）。
`documents/index.ejs:37-41` は**エラーと空状態が同時に出る**（取得失敗でも `documents=[]` で描画するため）。

---

## P2 — 足りない項目・機能

### 一覧の基本機能が無い
検索・絞り込み・並び替え・ページングのいずれかが欠けている: `respondents`（全滅）、`projects/indexDesigner`、`questions/indexDesigner`、`applications`（ステータス絞り込み不可）、`points`（並び替え不可・検索がクライアント側 `display:none`）、`segments`、`segments/campaigns`、`documents`、`prompt-packages`、`pool-questions`（スキップ率でソートできない）、`daily-question-priorities`、`daily-surveys`（未配置）、`store-surveys`、`notification-templates`、`data-management`（NGワード）。

### CSV / 一括操作が無い
- `exchange-requests` — **金銭を伴うのに経理突合用CSVが無い**
- `applications` — 一括当選/落選が無く、数十件来たら手作業
- `user-profiles` — 12条件で絞り込めるのに抽出結果を出力できない
- `data-management` — NGワードの一括登録（改行貼り付け）が無い
- `clients/overview` — 企業単位の期間指定・一括エクスポートが無い

### 詳細への導線・戻り導線が無い
- `respondents/show.ejs` / `sessions/show.ejs` に**戻るリンクもパンくずも無い**（ブラウザバック頼み）
- `points/index.ejs` からユーザーの取引履歴に辿れない＝調整の妥当性を検証できない
- `user-profiles` は一覧のインライン展開のみでユーザー詳細ページが無く、投稿・ポイント・セッションと繋がらない
- `badges` の獲得者数がリンクでない
- `ai-analysis/index.ejs:21-24` の**危険ワード検出が数値だけで該当投稿に飛べない**（安全に関わる指標なのに対処導線ゼロ）
- **セッション一覧画面が存在しない**（`sessions/` は `show.ejs` のみ）。ダッシュボードの「進行中セッション」からも飛べず、セッションを横断的に探す手段が無い

### ダッシュボードが起点として機能していない
`dashboard.ejs` はカウンタ4枚（リンクなし・集計基準時刻の記載なし）＋「MVP Scope」という**開発者向け内部文言が本番トップに常設**。要対応キュー（未処理の交換申請 / 選考中の応募 / 今日の配信予定 / 未分析投稿）が無い。

### 配信の全体像が見えない
配信テンプレート（cron）・キャンペーン予約・リマインダーの**次回実行予定を一望できる画面が無い**。カレンダーは `daily-surveys/index.ejs:50-100` のデイリーアンケートだけ。`delivery-templates/list.ejs:53` はスケジュール式を出すのみで次回実行日時も最終実行結果も無い。`scheduler-settings/index.ejs:5-8` も「稼働中ジョブ: N件」だけ。

### 失敗の追跡ができない
`delivery-templates/list.ejs:93-110` の配信ログは `fail_count` の数値のみで**失敗理由も再実行導線も無い**。`daily-surveys/show.ejs:17-24` は `?delivered=&failed=` のクエリフラッシュだけで、`analytics.ejs:152-189` の通知ログに繋がっていない（リロードで消える）。

### AIコストが管理できない
`ai-logs/index.ejs:56-64` にトークン数・レイテンシ・コストの列が無く、`token_usage` は詳細でJSONを開かないと見えない。プロジェクト絞り込みが**UUIDの手打ち**（:34-35）、**「エラーのみ」フィルタも無い**（障害調査で最初に必要な操作）。

### 編集できない / 実行手段が無い
- `attributes/index.ejs` — 属性定義の**編集手段が無い**（追加と削除のみ）。ラベル誤字の修正が削除→再作成になる
- `badges/index.ejs:62-126` — バッジのCRUD・並び替えが無い（有効/無効トグルのみ）。`manual` バッジの付与UIも無い
- `reward-campaigns` — `form.ejs:87-89` が「手動実行」条件タイプを提供するのに、**手動実行のルートもボタンも存在しない**。付与実績（人数/pt合計/最終実行）の列も無い
- `posts` — 投稿の削除・非表示・NG対応の操作が一切無い（NGワード管理はあるのに、引っかかった投稿への対処導線が無い）

### リンク先・機能が存在しない
| 箇所 | 内容 |
|---|---|
| `questions/indexDesigner.ejs:13` | 「プレビュー」が `/admin/projects/<id>/preview` を指すが `adminRoutes.ts` に該当ルートが無い |
| `exchange-requests/index.ejs:75` | 不正検知バナーの「絞り込む」が `?q=` を投げるが、`adminController.ts:6753-6796` は `q` を読んでいない |
| `ai-analysis/index.ejs:86` | 「各投稿の『拡張分析』ボタンから実行できます」と案内しているが、`posts/index.ejs` にも `show.ejs` にもそのボタンが無い |
| `notification-templates/form.ejs:145-155` | 「Flex Message の JSON を直接入力します」とあるが**JSON入力欄が無い**。controller は `flex_template: null` 固定保存 |
| `delivery-operations/index.ejs:427-432,1047` | 選んだ `notification_template_id` を `executeCampaign` が参照しない。右ペインのLINEプレビューは実送信内容と無関係。実処理はアサインのみでLINE pushしていないのに「配信完了！送信数: N件」と表示 |
| `applications/index.ejs:83-87` | 落選フォームが `note` を送っていないため、`adminController.ts:8395` の理由読み取りが実質デッドコード |
| `projects/concepts.ejs:92-94` | 「実際の配信画面の結線は次工程です」＝**未完成機能が本番管理画面に露出**。設定しても効かない |
| `segments/campaign-form.ejs:56` | P0-6（予約実行のスケジューラ不在） |
| `prompt-packages/migration.ejs:189` | footer include が無くレイアウトが閉じない |

---

## P3 — 到達不能ビューの整理

`res.render` の全呼出（`adminController.ts`）と `adminRoutes.ts` を突き合わせた結果、projects/questions クラスタ22ファイル中**10ファイルが到達不能**。

死: `projects/index.ejs`, `projects/list.ejs`, `projects/form.ejs`, `projects/delivery.ejs`, `projects/screening.ejs`, `questions/form.ejs`, `questions/formV2.ejs`, `questions/formDesigner.ejs`, `questions/index.ejs`, `questions/indexV2.ejs`
現行: `projects/indexDesigner.ejs`, `projects/researchForm.ejs`, `projects/deliveryV2.ejs`, `questions/formV3.ejs`, `questions/indexDesigner.ejs`, `questions/flowDesigner.ejs`

問題は残存そのものより**内容の食い違い**: 死んでいる `projects/index.ejs:57` の削除confirmは「関連データも削除されます」、現行 `projects/indexDesigner.ejs:72` は「archivedに変更されます」。ファイル名からは判別できず、旧世代を読んだ人が誤った仕様理解をする。

→ 削除するか `_deprecated/` へ隔離。残すなら冒頭に `<%# DEPRECATED: use formV3 %>` を必須化。

---

## P4 — 大きいフォームの操作性

- **下書き保存も離脱警告も無い**。`beforeunload` はリポジトリ全体で0件。`questions/formV3.ejs`（約11万文字・2131行）で、セッション切れ・タブクラッシュ・ヘッダの「一覧へ戻る」（:114）・←→キーナビ（:116-127）のいずれでも全損する
- **エラー箇所が分からない**。5タブ構成なのにエラーは最上部に1行のみ。`.tab-btn.has-error` / `.err-badge` のCSSは定義済みだがJSから一度も付与されていない（＝設計はあるが未実装）
- **タブ位置がリセットされる**。バリデーションエラーで再renderされると必ず「1. 基本設定」に戻る。URLハッシュ連携なし
- `projects/researchForm.ejs`（78KB）にセクションナビ・目次・スティッキー保存バーが無く、送信ボタンは982行目の最下部のみ。`<details>` の開閉状態も保持されない
- `formV3.ejs:1881-1905` は submit時に `/admin/api/generate-tags` を await するため数秒の無反応時間が発生。ボタンdisableもスピナーも無く二重送信可能、失敗時は `console.warn` のみ

---

## 誤操作を誘発する個別UI

| 箇所 | 内容 |
|---|---|
| `data-management/index.ejs:41-45,96-100` | 有効/無効ボタンが**現在の状態を表示するボタン**。「有効」と書かれたボタンを押すと無効になる |
| `data-management/index.ejs:48-51,103-106` | 削除confirmに対象語が出ない。カテゴリ削除時の既存投稿への影響も示されない |
| `respondents/show.ejs:11-22` | pt調整フォームの初期値が `10` / `manual adjustment` で入りっぱなし。confirmも結果表示も無い |
| `points/index.ejs:119-124,140-154` | pt調整に confirm も絶対値上限も無い。`-99999` を誤入力しても即実行 |
| `ranks/index.ejs:3-16` | ランクごとに独立フォームで、**閾値の逆転（シルバー100 > ゴールド50）を検証しない**。該当人数も影響件数も出ない |
| `notification-templates/index.ejs:116-126` | 「DEFAULT設定」（以後の全配信文面が変わる）と「無効化」に confirm 無し。使用箇所の表示も無く、デフォルトを無効化するとリマインダー配信が黙って壊れる |
| `store-surveys/index.ejs:101-123` | `entry_code` 変更に確認が無い。**配布済みQR/URLが即無効**になる |
| `documents/form.ejs:71-77` | 「グローバル必須」ONで全ユーザーが次回ログイン時に同意ブロックされるのに、素のsubmit |
| `attributes/index.ejs:33-38` | 削除confirmに属性名も登録件数も出ない（同じ行に登録数を表示しているのに） |
| `pool-questions/index.ejs:104-117` | 「公開」（＝実出題開始）に confirm 無し、アーカイブと削除にはある、という非対称 |
| `daily-surveys/show.ejs:80-91` | 「配信開始」に confirm 無し、「完了にする」にはある、という非対称 |
| `projects/concepts.ejs:16-26` | ローテーション方式が `onchange` で即保存。フィールディング中の切替で割当済み提示順が壊れるが警告なし |
| `projects/concepts.ejs:68-70` | 削除confirmが `onsubmit` でなく `onclick`。**Enterキー送信ではconfirmを通らない** |
| `segments/index.ejs:36-40` | `last_evaluated_at` の古さを警告しない。数ヶ月前の `estimated_count` が配信確認モーダルの「推定N名」の根拠になる |
| `delivery-operations/index.ejs:766-817` | 同意書類を一覧表示するだけで、**必須書類の未同意者数チェック無しに配信実行できる** |
| `delivery-operations/index.ejs:684-701` | ソートの「作成日順」が `return 0` で何もしない＝一度ポイント順にすると戻せない |
| `delivery-operations/index.ejs:1075-1103` | カンバンD&Dが `scheduled`/`in_progress`/`completed` では alert を出すだけの死んだ操作。confirm文に `delivery_enabled = true` とDB列名を生表示 |
| `exchange-requests/index.ejs:155` | `pending`/`approved` が先に評価されるため到達不能。通知失敗した `approved` 案件の再送ボタンが出ない |
| `sessions/show.ejs:79-108` | 列見出しが `normalized_answer` / `extracted_json` の生カラム名で、中身も生JSON。8列テーブルに押し込まれ実質読めない |
| `respondents/show.ejs:79` | 「AI分析 **Phase 2-C**」と開発フェーズ名が本番UIに露出 |
| `ai-analysis/report.ejs:16 vs :33,60,110` | k-匿名性（N<3非表示）が性格タイプにしか適用されていないように読める。感情/インサイト/愚痴カテゴリは生件数を出している |
| `user-profiles/index.ejs:219` | EJS `<%= %>` が `'` を `&#39;` にエスケープするため、インラインJSのクォート手動エスケープが二重処理。かつ関数側で結局サニタイズするので加工自体が無意味 |
| `delivery-operations/index.ejs:554,1125` | `data-name` に手動 `replace` を入れた上でEJSが再エスケープ。`"` や `&` を含む案件名は検索にヒットしない |
| `daily-question-priorities/form.ejs:47-56` | 選択肢を生JSONのtextareaで入力させ、クライアント検証が無い |
| `experience-settings/index.ejs:39,90-95` | 全項目一括上書き保存。変更履歴も既定値リセットも無い |

---

## 着手順の提案

| 順 | 内容 | 効果 |
|---|---|---|
| 1 | **P0-3 / P0-4** — 配信実行系に `publish-confirm.ejs` 型の確認（影響一覧＋件数＋チェック必須）を横展開し、条件評価をプレビューと統一 | 誤配信という取り返しのつかない事故を止める。既存の良い型を流用するだけなので実装量は小さい |
| 2 | **P0-1 / P0-2** — 集計をDB側 `count`/`sum` に、一覧を `range()` ページングに | 「数字が静かに嘘」を止める。`respondents` は放置するとタイムアウトで画面ごと死ぬ |
| 3 | **P1-1 / P1-4 / P1-5 / P1-3** — フラッシュ基盤・日時ヘルパ・STATUS_LABELS partial・`.table-scroll` 一括適用 | 1回で全画面に効く。以降の指摘の半分がこれで消える |
| 4 | **P0-5 / P0-9** — 公開後の設問編集ガードとCSRF | データ整合と最低限のセキュリティ |
| 5 | **P3** — 到達不能10ファイルの削除/隔離 | これ以降の作業の誤読を防ぐ。実質ノーリスク |
| 6 | P2（ダッシュボードの要対応キュー、配信カレンダー、セッション一覧、CSV/一括操作） | 日々の運用工数に効く |

---

## 補足

- 本レビューはコード読解ベース。P0-3（セグメント条件フォーマット不一致）、P0-6（予約スケジューラ不在）、`questions/indexDesigner.ejs:13` のプレビュー404 は影響が大きいので、**実機で1回踏んで確認してから直す**ことを推奨。
- 良い設計として横展開すべきもの: `prompt-packages/publish-confirm.ejs` / `archive-confirm.ejs`（影響一覧＋確認チェック）、`user-profiles/index.ejs`（12条件フィルタ＋ページング＋空状態＋横スクロール）、`daily-surveys/index.ejs`（カレンダー＋ドラッグ）。
