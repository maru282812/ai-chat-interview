# 仕様整理: デイリーアンケート（配信キュー＋カレンダー＋1問完結UI）

作成: 2026-07-13 / 更新: 2026-07-14
状態: **Phase 0・1・2 実装済み（migration 079 本番適用済み・未コミット）／Phase 3 未着手**

## 目的

「毎日1問だけ、タップかスワイプで10秒で終わる」体験を、LINE公式アカウントとサイト（LIFF）の
両方から回答者に届ける。運営は「1問を作ってキューに積むだけ」で、あとは上から順に自動で
1日1つ配信される状態にする。忙しい日は日付にドラッグして固定でき、必要なら1日2つ出せる。

- 回答者の価値: 案件アンケートより圧倒的に軽い接点。毎日開く理由になる（ストリーク・ポイント）。
- 運営の価値: 属性データが日々貯まる。配信のたびに手を動かさなくていい。

## 現状（実装済み）と構想のギャップ

| 領域 | 現状 | ギャップ |
|---|---|---|
| LINE 配信 | 朝/夜の cron が **`status=active` のアンケートを全部・全ユーザーに毎回** push（`notificationSchedulerService._runDeliveryJobs`） | キュー・順番・「1日1つ」が無い。回答済みの人にも再 push される。`active` のまま放置すると毎朝毎晩送り続ける |
| 配信予定日時 | `daily_surveys.scheduled_at` カラムと作成画面の入力欄はあるが **cron は参照していない** | 日付指定配信が実質未実装 |
| セグメント | `target_segment_id` を持つが `resolveTargetUsers` は分岐しても同じ全件を返す | セグメント配信が実質未実装（本仕様のスコープ外だが要記録） |
| サイト導線 | 案件一覧にデイリーの枠が無い。デイリーページは `?survey_id=` 必須 | 「今日の私の1問」を返す API が無い |
| 回答UI | `daily-survey.ejs` 独自のラジオ / チェック / 5段階ボタン / テキスト | スワイプ・スタンプ・カルーセル等の casual レンダラは `survey.ejs` にしか無く、デイリーは共有していない |
| 管理UI | 作成日降順の一覧のみ | カレンダー・ドラッグ・キュー順序・スロットの概念が無い |

**Phase 0 で先に止めるべき挙動**: `active` を毎日再配信するロジック。キューを入れる前提でも、
今のまま `active` なアンケートが残っていると本番で二重配信になる。

## データモデル

### `daily_surveys` に追加

| カラム | 型 | 用途 |
|---|---|---|
| `queue_position` | int null | キュー内の並び順（小さいほど先）。日付が確定したら null に戻す |
| `scheduled_date` | date null | 配信日（JST）。ドラッグで確定 |
| `slot` | text null | `morning` \| `evening`。1日2件の枠 |
| `answer_ui_preset` | text default `'casual'` | デイリーは既定でスワイプ/タップ系。`projects.answer_ui_preset` と同じ語彙 |

`status` に `queued` を追加する（`draft` / `queued` / `scheduled` / `active` / `paused` / `completed`）。

- `draft`: 設問を作っている途中。配信対象外。
- `queued`: キューに積んだ。日付未確定。`queue_position` が入る。
- `scheduled`: `scheduled_date` + `slot` が確定済み。まだ当日が来ていない。
- `active`: 当日、配信済みで回答受付中。
- `completed`: `expires_at` 経過 or 翌日以降。**cron が自動で落とす**（現状は手動のみ＝再配信の原因）。

一意制約: `unique (scheduled_date, slot) where scheduled_date is not null` — 同じ枠の二重予約を DB で防ぐ。

### `notification_scheduler_settings` に追加

| カラム | 型 | 用途 |
|---|---|---|
| `evening_autofill_enabled` | boolean default false | 夜枠をキューから自動補充するか。**既定 false ＝ 何もしなければ1日1件** |

朝枠は常にキューから自動補充する（＝構想の「何もしなければ上から順に1日1つ」）。

### 変更しないもの

`daily_survey_questions` / `daily_survey_answers` / `daily_survey_deliveries` のスキーマは据え置き。
回答の保存形式は UI を変えても不変（[[project_answer_ui_presets_impl]] と同じ原則）。

## 配信ロジック（cron）

`_runDeliveryJobs` を「全 active を送る」から「その日その枠の1件を送る」に置き換える。

```
runSlot(slot):                              # slot = morning | evening
  today = JST の今日
  1. 日付固定分を探す: scheduled_date = today かつ slot = slot（status: scheduled|active）
  2. 無ければキューから補充:
       slot == morning              → 常に補充
       slot == evening              → evening_autofill_enabled が true のときだけ補充
       補充 = status='queued' を queue_position 昇順で先頭1件 pop し、
              scheduled_date=today / slot=slot / queue_position=null を書く
  3. それでも無ければ何もしない（← 過去の active を再送しない）
  4. status='active' にして配信
  5. 送信先 = 対象ユーザー のうち、この survey の delivery レコードを**まだ持たない**人だけ
     （既存 delivery があれば送信済み or 回答済み＝再 push しない）
  6. expires_at を過ぎた active は completed に落とす（同じ cron 内で掃除）
```

冪等性は既存の `cron_dispatch_runs`（`recordRun` を取れた時だけ発火）にそのまま乗る。
`daily_survey_deliveries` の `unique (survey_id, line_user_id)` が二重 push の最後の砦になる。

## 画面導線

### 回答者（LIFF）

**LINE から**: 既存どおり。push のリンク `?survey_id=...` → `/liff/daily-survey` → 1問回答 → 完了演出。

**サイトから**: 案件一覧（`/liff/projects`）の**最上部にデイリーカードを出し、その場で回答して完結させる**。
ページ遷移させない。

```
[ 今日の1問 ]  ← 案件一覧の最上部・カード1枚
   スワイプ or タップで回答
        ↓ その場で POST
[ 回答済み ・ +5pt ・ 連続3日 ] にカードが変わる（消さない＝実績として見せる）
        ↓
[ 案件一覧 ... ]
```

- 未回答のデイリーが2件ある日は、カードを縦に2枚積む（朝/夜）。
- その日のデイリーが無い / 全部回答済みなら、カード自体を出さない（空枠を見せない）。
- サイト経由の回答者には delivery レコードが無いので、開いた時点で `upsertDelivery(status='opened')` する
  （既存 `getDailySurveyData` と同じ扱い）。

新規 API: `GET /liff/daily-survey/today` → 今日そのユーザーが答えるべきデイリー（0〜2件）を、
解決済みの表示パターン付きで返す。回答の POST は既存の `submitDailySurveyAnswer` を流用。

### 管理者

**日常運用（毎日は触らない画面）**: デイリーアンケート一覧を「カレンダー＋キュー」の2ペインにする。

```
┌─ カレンダー（月表示） ────────────┐  ┌─ 配信キュー ───────┐
│  7/14  朝: [スマホ決済利用]        │  │ ⠿ 1. 今日の気分     │
│        夜: (空)                    │  │ ⠿ 2. 夕食頻度       │
│  7/15  朝: (自動: 今日の気分)      │  │ ⠿ 3. 最近買った商品 │
│        夜: (空)                    │  │ ⠿ 4. ...            │
│  7/16  朝: (自動: 夕食頻度)        │  │                     │
└────────────────────────────────────┘  │ [+ 新規作成]        │
   ↑ キューからドラッグして日付固定       └─────────────────────┘
   ↑ カレンダーからドラッグで外す＝キューに戻る
```

- カレンダーの「(自動: xxx)」は**予測表示**。キューの順序と autofill 設定から計算した見込みで、
  DB には書かない。キューを並べ替えると即座に再計算される。
- 空き枠にドラッグすると `scheduled_date` + `slot` が確定し、キューから抜ける。
- 1日2件は「夜枠にもドラッグする」か「夜枠の autofill を ON にする」のどちらか。

**作成画面**: 現在の「配信予定日時（`scheduled_at`）」を廃止し、**「キューに積む」/「日付を指定」の2択**に変える。
既定は「キューに積む」（＝末尾に追加）。

**トラブル時**: 既存の詳細・分析画面（配信数 / 回答率 / 通知ログ）はそのまま使う。

## 権限

| 操作 | 回答者 | 運営 |
|---|---|---|
| 今日のデイリーを見る・答える | ○（自分の分のみ・サーバー権威で解決） | – |
| 作成・編集・削除 | × | ○ |
| キュー並べ替え・日付固定 | × | ○ |
| 手動即時配信（テスト送信） | × | ○ |

デイリーの「誰に何が割り当たっているか」は**サーバーが決める**。クライアントから `survey_id` を
指定して未配信のものを開けないよう、`today` API は `scheduled_date = today` かつ `status=active` の
ものしか返さない（既存 `getDailySurveyData` の `status !== 'active'` チェックと整合）。

## Phase 分け

| Phase | 内容 | リリースで可能になること |
|---|---|---|
| ~~**0**~~ ✅ | 再配信バグ止め: `active` の毎日再送を停止・delivery 既存者をスキップ・`expires_at` 超過を `completed` に落とす | 本番でデイリーを `active` にしても二重配信されない（キュー導入の前提） |
| ~~**1**~~ ✅ | キュー＋スロット＋カレンダー（migration / cron 書き換え / 管理2ペインUI / 作成画面の2択化） | 運営が「1問作ってキューに積む」だけで、上から順に1日1つ自動配信される。ドラッグで日付固定・夜枠 ON で1日2件 |
| ~~**2**~~ ✅ | サイト面: `GET /liff/daily-surveys-today` ＋ 案件一覧最上部のカード（その場回答・タップ確定のUI） | サイトを開いた人が案件を見る前に今日の1問に出会い、遷移せず回答できる |
| **3** | 回答UI共通化: `survey.ejs` の casual レンダラ（swipe_card / carousel / face_scale / chip_select / big_split）を共通パーシャルに切り出し、デイリーからも使う | デイリーがスワイプ・スタンプで回答できる。UI 改善が案件アンケートと同時に効く |
| **4**（将来） | 1日N枠・任意時刻／セグメント配信の実装／AI で1問を自動生成してキューに積む／デイリーの回答UI A/B（[[project_answer_ui_experimentation]]） | – |

Phase 2 と 3 の順序は入れ替え可能。3 を先にすると差し替え作業が減るが、`survey.ejs`（稼働中）の
リファクタが先に来るぶんリスクが前倒しになる。**カード枠は据え置きで中のレンダラだけ差し替わる**ので、
2→3 の順で進めても手戻りは小さい。

## Phase 3 の注意点（先に潰しておく罠）

[[project_answer_ui_renderer_gotchas]] の2件がそのまま効く。共通パーシャル `partials/answer-ui.ejs` に
切り出すときは:

1. `label` + hidden checkbox で描くと二重トグルで相殺される → `div` で描く。
2. `data-code` 付きの `input` は汎用 text 配線に `el.value` を上書きされる → 独自 value 配線を付けない。

また、デイリーの設問モデル（`single_choice` / `multiple_choice` / `text` / `scale`・`answer_options`）は
案件アンケートの `QuestionType` / `question_config` と別物なので、**アダプタ関数**が要る:

- `scale` → `single_choice` + `presentation.scale = true`
- `multiple_choice` → `multi_choice`
- `text` → `free_text_short`
- `answer_options[{label,value}]` → レンダラが期待する `choices[{value,label,title}]`

`resolveAnswerPresentation`（[src/lib/answerPresentation.ts](../src/lib/answerPresentation.ts)）は
そのまま再利用できる。`daily_surveys.answer_ui_preset`（既定 `casual`）を projectPreset として渡す。

## Phase 0-1 の実装記録（2026-07-14）

| ファイル | 内容 |
|---|---|
| `supabase/migrations/079_daily_survey_queue.sql` | `queue_position` / `scheduled_date` / `slot` / `answer_ui_preset` 追加、`status` に `queued`、`unique(scheduled_date, slot)`、`evening_autofill_enabled` |
| `src/lib/dailyQueue.ts`（新規） | 純関数。`decideSlotDelivery`（枠ごとに1件だけ選ぶ）／`previewQueueAssignments`（カレンダーの見込み）／JST 日付ヘルパ |
| `src/tests/dailyQueue.test.ts`（新規） | 16件。全357件 pass |
| `src/services/dailySurveyService.ts` | `runSlot` 新設。`deliver` が **既に delivery を持つユーザーを除外**。`activateForToday` で期限を必ず埋める |
| `src/services/notificationSchedulerService.ts` | `_runDeliveryJobs`（全 active を送る）を `_runSlot`（枠の1件）へ置換 |
| `src/controllers/adminController.ts` / `adminRoutes.ts` | カレンダー2ペイン描画＋ `queue/reorder` / `:id/schedule` / `:id/enqueue` |
| `src/views/admin/daily-surveys/index.ejs` | カレンダー＋キューのドラッグUI（HTML5 DnD・依存追加なし） |
| `src/views/admin/daily-surveys/form.ejs` | 「配信予定日時」→「キューに積む／日付を指定」の2択。回答UIプリセット追加 |
| `src/views/admin/scheduler-settings/index.ejs` | 夜枠の「キューから自動補充する」トグル |
| `src/lib/http.ts` | `/admin` でも `Accept: application/json` なら JSON エラーを返す（ドラッグUIがメッセージを出せるように） |

**実データでの確認（デモ案件）**:
```
日付未固定の active（旧実装ならこれ全部が毎朝毎晩 push されていた）: 1件
   - [デモ] スマホ決済利用
キュー: 1.[デモ] 今日食べたもの / 2.[デモ] 今日の気分
[morning] deliver → 「[デモ] 今日食べたもの」1件だけ（source=queue）
[evening] noop  → 配信なし（autofill-disabled）
```
キュー並べ替え・日付固定・キューへ戻す・二重予約の 409 まで HTTP 経由で確認済み。
**LINE への実配信（runSlot の deliver 部分）は本番ユーザーへ push されるため未実行。**
管理画面の詳細ページから宛先を指定した「テスト送信」で確認すること
（宛先指定の送信ではキューを消費しないようにしてある）。

## Phase 2 の実装記録（2026-07-14）

| ファイル | 内容 |
|---|---|
| `src/routes/liffRoutes.ts` | `GET /liff/daily-surveys-today` を追加（`/daily-survey/:id/answer` と衝突しないパスにした） |
| `src/controllers/liffController.ts` | `getTodayDailySurveys`。**サーバーが「今日その人が答えるべきもの」を決める**（`status=active` かつ `scheduled_date=今日` かつ未回答）。サイト流入で delivery が無い人にはここで `opened` を作る。`user_profiles` 未作成などで失敗しても案件一覧を止めず、カードを出さないだけにする |
| 同上 | `submitDailySurveyAnswer` に **deliveryId の所有者検証**を追加（後述） |
| `src/views/liff/projects.ejs` | 最上部に `#daily-area`。カードは `single_choice` / `scale` は**タップした瞬間に確定**（確定ボタンを挟まない）、`multiple_choice` はトグル＋「N件で送信」、`text` はテキストエリア＋送信。回答後は同じ場所で「✅ 今日の1問に回答しました / N日連続 / +Npt」に差し替える（カードは消さない） |
| 同上 | 今日の1問の取得は**案件一覧の表示をブロックしない**（失敗してもカードが出ないだけ） |

**セキュリティ修正（既存の穴）**: `submitDailySurveyAnswer` は `deliveryId` を検証せず `recordAnswer` に渡していたため、
他人の配信レコード ID を渡して回答済みにしたり、ポイント付与の参照先を書き換えたりできた。
`(id, survey_id, line_user_id)` の一致を確認し、他人のものなら 403 を返すようにした。

**実機での確認（Playwright・モバイルビューポート 390×844）**:
```
daily card 件数: 1
  ラベル : ☀️ 今日の1問     報酬: +8pt
  設問   : 今日食べたものを選んでください。
  選択肢 : ['自炊', '外食', 'コンビニ']
  位置   : 案件より上
  → 選択 →「1件で送信」→ ✅ 今日の1問に回答しました / 1日連続 / +8pt
リロード後 card 件数: 0（回答済みなので出ない）
JS エラー: なし
```
API 単体でも確認済み: 他人の deliveryId → **403** ／ 本人 → 200・8pt 付与・streak 1 ／ 回答後は `items: []`。

## 運用上の注意

- **キューが空の日は何も配信されない**（無理に何かを送らない）。管理画面のキュー残数が少なくなったら
  警告バッジを出す（Phase 1 に含める）。
- **ポイント付与はレスポンス前に await**（[[feedback_vercel_serverless]]）。既存 `recordAnswer` は
  ポイント→ストリーク→ランク→バッジを順に await しているのでそのまま。
- 監査: 配信は既存の `notification_logs`（category=`daily_survey`）に残る。キュー並べ替え・日付固定は
  現状ログを残していない → Phase 1 で `daily_surveys.updated_at` 更新のみ（専用監査ログは作らない）。
- export: デイリーの回答は現在ロウデータ出力の対象外（案件スコープの出力のため）。当面据え置き。
