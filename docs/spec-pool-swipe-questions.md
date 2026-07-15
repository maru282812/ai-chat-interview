# 実装仕様書: ついでスワイプ（設問プール）— 案件一覧埋め込みの低ステークス回答ボックス

作成: 2026-07-15。壁打ち出典: 品質ファースト・アンケート構想（2026-07-10 確定。核＝「デイリースワイプ（平常時≒真値）と本アンケートの整合性」で信頼スコアを作る。全文ドキュメントは散逸したため骨子はメモリ project_quality_first_survey を参照）。

## 目的

1. **整合性判定（信頼スコア）の素材集め**: ユーザーが案件一覧を開いた「ついで」に、報酬期待の低い簡単な2択設問へスワイプ回答してもらう。低ステークスの回答は平常時の真値に近く、後日の本アンケート回答との突合（トピック別整合性・test-retest）に使える。本仕様は**素材を貯めるところまで**。判定エンジンは作らない。
2. **ユーザー志向の把握**: 回答にトピックタグを付けて蓄積し、将来の案件マッチング・レコメンドの入力にする。
3. **企業設問の受け皿**: 設問を企業（clients）に紐づけられるようにし、将来「平常時データ取得」を課金メニュー（高精度オプション）にできる形にしておく。

デイリー「今日の1問」（報酬あり・1日1枠・ストリーク対象）とは**別物として併存**させる。ついでスワイプは低報酬（既定 +1pt）・任意・スキップ自由。低報酬であること自体が真値性を担保する設計判断なので、報酬を盛らないこと。

## スコープ外（今回やらない）

- 信頼スコア判定エンジン（整合性計算・個人ベースライン・減衰・方向性判定）。**今回は素材の蓄積のみ**
- 志向データ→案件レコメンド・スクリーニングへの接続
- `attribute_key` から `user_attributes` への書き戻し（カラムだけ用意。デイリー側も現状書き戻していない）
- 企業向けセルフサーブ投入画面（登録は運営が管理画面で代行）
- LINEトークへの出題・push通知（サイト面のみ。回答後のLINE通知もしない＝低報酬高頻度でトークを汚さない）
- 出題の A/B・企業間の出題バランス調整・日次上限の設定UI（定数でよい）
- projects.ejs 以外のLIFFページへの設置（まず案件一覧のみ。パーシャル化はしておく）

## 既存コードの前提（実装前に必読）

| 資産 | 場所 | 使い方 |
|---|---|---|
| その場回答カードの前例 | `src/views/partials/daily-today-card.ejs` | UI/配線/送信/done表示の設計をこれに揃える |
| 回答UI共通レンダラ | `src/views/partials/answer-ui.ejs`（`window.AnswerUI`） | `AnswerUI.build` / `AnswerUI.wire` / `isAutoCommit` をそのまま使う。**レンダラは追加・変更しない** |
| サーバー権威の表示解決 | `src/lib/dailyAnswerUi.ts` の `resolveDailyQuestionViews(questions, preset)` | プール設問を `DailySurveyQuestion` 形（`id/question_text/question_type/answer_options`）に整形して preset `'casual'` 固定で通す。新規解決ロジックを書かない |
| 所有者検証の前例 | `src/controllers/liffController.ts` `submitDailySurveyAnswer`（deliveryId 検証） | exposureId で同じ構図をやる |
| LIFF認証 | `liffAuthService.verifyIdToken(bearerToken(req))` | `getTodayDailySurveys` と完全に同じ流儀。ページ側/サーバー側で認証要否の判定を分けない（過去に常時401事故あり） |
| ポイント付与 | `userPointService.ensureRow` → `awardPoints`（`dailySurveyService.recordAnswer` 参照） | 正準経路。`respondents.total_points` は触らない |
| migration 適用 | `npm run db:migrate` | 作成後に自動適用（手で流さない） |

## 画面

### 案件一覧（既存 `/liff/projects` = `src/views/liff/projects.ejs`）への埋め込み

- 設置位置: `<div id="daily-area"></div>` の**直下**に `<div id="pool-swipe-area"></div>` を追加。今日の1問（緑のヒーローカード）が主役、ついでスワイプは脇役のトーンにする（白ベースの控えめなカード）。
- 新規パーシャル: `src/views/partials/pool-swipe-box.ejs`
  - `window.PoolSwipe.mount({ idToken, onAnswered })` を公開する（`DailyToday.mount` と同じ流儀）。
  - **answer-ui.ejs を include しない**。ホストが `daily-today-card.ejs`（内部で answer-ui を include 済み）を先に読み込んでいる前提とし、パーシャル冒頭コメントに「`window.AnswerUI` 必須。daily-today-card か answer-ui を先に include すること」と明記する。
- カード構成:
  - ヘッダ: ラベル「🎴 ついでスワイプ」＋ 右側に `+1pt` チップ（`reward_points` が 0 のときは非表示）
  - 本文: 設問文＋共通レンダラの描画（1問ずつ）。`presentation.pattern` はサーバーが返したものをそのまま使う（2択→swipe_card 想定）
  - フッタ: 進捗ドット（今日の残り問数ぶん）＋テキストリンク「スキップ」
  - 回答/スキップで即次の設問へ。最後の1問が終わったら小さな完了表示（「今日のぶんは終わり。また明日」）に畳む
- 状態:
  - 出題なし（items 空）: 何も描かない
  - ローディング: 何も出さない（案件一覧の表示を**一切ブロックしない**。fetch 失敗も console.error のみでカード非表示）
  - 送信失敗: カード内にメッセージ表示、ボタン再活性（daily-today-card と同様）
- `onAnswered(result)` で `result.pointStatus` をホストに渡す。projects.ejs 側は既存の `DailyToday.mount` の `onAnswered` と同じく `renderPointCard(result.pointStatus, gained)` を呼ぶ（昇格演出 `RankCelebration.maybePlay` も同じ形で通す。プール回答でも累計ptは動くため）。
- スマホ前提（LIFF）。PC向けの先回り実装はしない。

### 管理画面（新規 `/admin/pool-questions`）

既存 `/admin/daily-surveys` 系（`adminController` + `adminRoutes` + `src/views/admin/daily-surveys/`）の規約に揃える。ただし**モデルが違う**: デイリーは「アンケート容器＋設問リスト＋配信枠」だが、プールは**1設問＝1枚の在庫**で容器がない。よって作成UXは「1件を丁寧に作る」ではなく**「2択を量産して在庫を積む」**ことに最適化する。設計原則:

- **最速パス**: 必須入力は「設問文＋2択の左右ラベル」だけ。それ以外はすべて既定値で保存できる
- **連続作成**: 保存後に一覧へ戻さない。同じフォームに留まり、topic_tag / 企業 / 詳細設定を**維持したまま**設問文と選択肢だけクリア（同じテーマで10問続けて入れる操作が最短になる）
- **見たまま確認**: 回答者に見える swipe_card をフォーム内でライブプレビュー（実レンダラで描く。手書きモックにしない）

#### 一覧 `GET /admin/pool-questions` — 在庫ボード

- テーブル列: 設問文（2択ラベル併記）・トピックタグ・企業名（空=運営）・status・priority・reward_points・**出題数 / 回答数 / スキップ数（スキップ率）**・期間・操作
- フィルタ: status（既定 active+draft）／トピックタグ／企業
- 行内操作: activate / pause（ワンクリック。archive と削除は確認あり）
- ヘッダに在庫サマリ: 「active な設問 N 件」— CAP 3問/日 × アクティブユーザーに対して在庫が細っていないかを見る場所。**active が 10 件を切ったら警告表示**（毎日3問消費するので在庫切れ＝カード非表示が最頻の運用事故になる）

#### 新規（単発） `GET /admin/pool-questions/new` → `POST /admin/pool-questions`

レイアウトは2カラム（スマホ幅の実プレビューを右に常時表示。狭い画面では下）:

**メイン（常時表示）**

| 項目 | 入力 | 備考 |
|---|---|---|
| 設問文 | text 必須 | 例プレースホルダ「朝はパン派？ごはん派？」 |
| 選択肢（2択） | text ×2（左＝スワイプ左 / 右＝スワイプ右） | value はラベルから自動生成（サーバーで採番可）。**JSON を書かせない** |
| トピックタグ | text + datalist（既存タグをサジェスト） | 任意だが「整合性判定・志向集計のキーになる」注記を添えて実質推奨 |
| 企業 | select: clients、既定=運営設問 | |

**詳細設定（アコーディオン・既定は閉じる）**

| 項目 | 入力 | 既定 |
|---|---|---|
| 設問タイプ | select: `single_choice` / `scale` | single_choice。scale を選ぶと選択肢入力が「1〜5自動」表示に切替 |
| 3択以上にする | 「選択肢を追加」ボタンで最大4つ | 2択（swipe_card）。3〜4択は tap_cards になる旨をプレビューで見せる |
| priority | number | 0 |
| reward_points | number 0〜3 | 1 |
| 再出題間隔（日） | number 任意 | 空=再出題しない。「N日後に同じ質問を再度出し、回答の一致を品質判定の素材にする」説明文を付ける |
| 掲載期間 | starts_at / ends_at | 空=無期限 |
| attribute_key | select: attribute_definitions | 空（将来用） |
| 作成時ステータス | radio: 下書き / すぐ公開(active) | **すぐ公開**（在庫積みが目的なので draft を既定にしない） |

**プレビュー**: `answer-ui.ejs` をフォームに include し、入力変更のたびに `resolveDailyQuestionViews` 相当の結果（2択→swipe_card / 3-4択→tap_cards / scale→face_scale）を `AnswerUI.build` で実描画する。LIFF 用パーシャルだが自己完結（IIFE + 接頭辞付きクラス）なので admin に include して問題ない。プレビューは admin 側の見た目確認用であり、本番の表示解決はあくまでサーバー権威のまま。

**保存後**: 302 で一覧に戻さず同フォームに留まり、フラッシュ「追加しました（active 在庫 N 件）」＋設問文/選択肢のみクリア。「一覧へ戻る」リンクを常設。

#### まとめて追加 `GET /admin/pool-questions/bulk` → `POST /admin/pool-questions/bulk`

企業から設問リストを Excel/テキストでもらうケースの現実解。デイリー作成UX改修（spec-daily-survey-create-ux-reform.md）と同じ**クライアント一時状態→1回のPOST**方式。

- textarea に1行1問で貼り付け: `設問文 | 左選択肢 | 右選択肢`（トピックタグ・企業はフォーム上部の共通指定を全行に適用）
- 「取り込む」(type=button) でクライアント側パース→下の一時テーブルに展開（行ごとに削除可・パース失敗行は赤表示で理由表示）
- 「まとめて作成」で `questions_json` を hidden に詰めて1回 POST。サーバーは行ごとに検証して一括 INSERT、失敗行があれば全体を 400 で返す（部分作成しない）
- 作成時ステータス共通指定（draft / active）

#### 編集・status・削除

- **編集** `GET /admin/pool-questions/:id/edit` → `POST /admin/pool-questions/:id`（単発フォームと同画面。**回答が1件でも付いた設問は設問文・選択肢を編集不可**にして「意味が変わる修正は archive→新規作成」を案内。answers にスナップショットを焼いていても、設問側が変わると一覧・集計が読み違えるため）
- **status変更** `POST /admin/pool-questions/:id/status/:action`（activate / pause / archive）
- **削除** `POST /admin/pool-questions/:id/delete`（回答が1件でも付いていたら物理削除させず archive を促すエラーにする）

#### 後回し（作らない）

- AI による2択候補の自動提案（既存 `runAdminToolPrompt` の選択肢提案エンドポイントを2択モードで流用できる下地はあるが、まず手入力＋一括貼り付けで回す）
- トピックタグのマスタ管理画面（datalist サジェストで代用）
- 出題プレビューのユーザー指定シミュレーション

## API

すべて Express Route（このプロジェクトは Next.js ではない）。LIFF 側は `liffRoutes.ts`、管理側は `adminRoutes.ts` に追加。

### GET `/liff/pool-questions-today`

- 認可: LIFF idToken 必須（`liffAuthService.verifyIdToken(bearerToken(req))`）
- サーバー権威で「今この人に出す設問」を最大 `POOL_DAILY_CAP = 3` 問決めて返す。選定ルール:
  1. 候補 = `status='active'` かつ掲載期間内（starts_at/ends_at が NULL または現在時刻を包含）
  2. 除外 = 本人が回答済みで、`reask_after_days` が NULL または前回回答から未経過のもの
  3. 除外 = 本人が過去 `POOL_SKIP_COOLDOWN_DAYS = 14` 日以内にスキップしたもの
  4. 除外 = 今日すでに answered / skipped の exposure があるもの
  5. **今日 served のまま残っている exposure を最優先で再掲**（リロードで別の設問に差し替わらない＝冪等）
  6. 残枠を `priority DESC, created_at ASC` で補充。今日の exposure 総数（served+answered+skipped）が CAP に達したら補充しない
- 返す設問ぶんの exposure を作成（`status='served'`, `exposure_date=JST今日`, `position=今日の通し順`）。**exposure 作成に失敗した設問は黙って落とす**（案件一覧を止めない。`getTodayDailySurveys` の delivery skip と同じ構図でログだけ残す）
- 日付は既存の `jstDateString()` を使う（UTC日付を使わない）
- レスポンス:

```jsonc
{
  "ok": true,
  "items": [
    {
      "question": {
        "id": "...", "question_text": "...", "question_type": "single_choice",
        "choices": [{ "value": "...", "label": "..." }],
        "presentation": { "pattern": "swipe_card", ... },  // resolveDailyQuestionViews(…, 'casual') の出力
        "reward_points": 1
      },
      "exposureId": "..."
    }
  ]
}
```

- 表示解決: プール設問を `DailySurveyQuestion` 形に詰め替えて `resolveDailyQuestionViews(questions, 'casual')` を通し、`choices` / `presentation` をそのまま載せる。**topic_tag / client_id はレスポンスに含めない**（回答者に判定利用・出所を悟らせない。真値性の生命線）

### POST `/liff/pool-questions/:questionId/answer`

- 認可: LIFF idToken 必須
- 入力: `{ exposureId: string, answerValue: unknown, answerMs?: number }`
  - バリデーション: exposureId 必須・UUID。answerValue 必須。answerMs は数値なら 0〜600000 にクランプ、それ以外は null
- 所有者検証（400/403/409 の順で厳格に）:
  - exposure が存在し `exposure.question_id === :questionId` かつ `exposure.line_user_id === 検証済みユーザー` でなければ **403**（他人の exposureId でポイント参照先をすり替える攻撃の遮断。deliveryId 検証の前例踏襲）
  - `exposure.status !== 'served'` なら **409**（二重回答・スキップ済みへの回答を拒否）
- 処理順（**すべてレスポンス前に await**。Vercel serverless で投げっぱなしにしない）:
  1. `pool_question_answers` に insert（topic_tag / client_id は設問から**スナップショット**して焼き付ける）
  2. exposure を `status='answered', answered_at=now()` に更新
  3. `reward_points > 0` なら `userPointService.ensureRow` → `awardPoints`（`transactionType: 'pool_question'`, `referenceType: 'pool_question_answer'`, `referenceId: exposureId`, reason: `ついでスワイプ回答`）
  4. `pointStatusService.getStatus` で付与後ステータス取得
- **ストリークは更新しない**（連続日数は「今日の1問」の領分。混ぜるとデイリーの動機設計が壊れる）。ランク同期はポイント付与に伴い `userRankService.syncRank` を呼ぶ
- 出力: `{ ok: true, pointsAwarded, pointStatus }` / エラー時 `{ error: "..." }`

### POST `/liff/pool-questions/:questionId/skip`

- 認可・所有者検証は answer と同一
- exposure を `status='skipped'` に更新するだけ。**減点・ペナルティなし**（答えたくない設問を無理に答えさせると真値でなくなる）
- 出力: `{ ok: true }`

### 管理系（admin セッション認可・既存 daily-surveys と同じミドルウェア）

上記「管理画面」節の各ルート。`adminController` にハンドラ追加。一覧の出題数/回答数/スキップ数は exposures の status 別 count を設問ごとに集計して出す。

## DB（migration `082_pool_questions.sql`）

```sql
-- 082_pool_questions.sql
-- ついでスワイプ（設問プール）: 案件一覧に埋め込む低ステークス2択の
-- 出題プール・出題ログ・回答。信頼スコア（整合性判定）の素材置き場。
-- 判定エンジンは未実装。answers は削除せず貯める前提。

CREATE TABLE IF NOT EXISTS pool_questions (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_text    TEXT        NOT NULL,
  question_type    TEXT        NOT NULL DEFAULT 'single_choice'
                               CHECK (question_type IN ('single_choice', 'scale')),
  answer_options   JSONB       NOT NULL DEFAULT '[]',
  topic_tag        TEXT,
  client_id        UUID        REFERENCES clients(id) ON DELETE SET NULL,
  attribute_key    TEXT        REFERENCES attribute_definitions(attr_key) ON DELETE SET NULL,
  status           TEXT        NOT NULL DEFAULT 'draft'
                               CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  priority         INTEGER     NOT NULL DEFAULT 0,
  reward_points    INTEGER     NOT NULL DEFAULT 1 CHECK (reward_points BETWEEN 0 AND 3),
  reask_after_days INTEGER     CHECK (reask_after_days IS NULL OR reask_after_days >= 1),
  starts_at        TIMESTAMPTZ,
  ends_at          TIMESTAMPTZ,
  created_by       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pool_questions_serving
  ON pool_questions(status, priority DESC, created_at ASC);

-- 出題ログ。回答APIの所有者検証の要（daily_survey_deliveries と同じ役割）。
-- 同じ設問でも日が変われば再出題できるよう exposure_date を一意キーに含める
-- （reask_after_days による test-retest 再出題のため）。
CREATE TABLE IF NOT EXISTS pool_question_exposures (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  question_id   UUID        NOT NULL REFERENCES pool_questions(id) ON DELETE CASCADE,
  line_user_id  TEXT        NOT NULL REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  exposure_date DATE        NOT NULL,
  position      INTEGER     NOT NULL DEFAULT 0,
  status        TEXT        NOT NULL DEFAULT 'served'
                            CHECK (status IN ('served', 'answered', 'skipped')),
  served_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at   TIMESTAMPTZ,
  UNIQUE (question_id, line_user_id, exposure_date)
);

CREATE INDEX IF NOT EXISTS idx_pool_exposures_user_date
  ON pool_question_exposures(line_user_id, exposure_date);
CREATE INDEX IF NOT EXISTS idx_pool_exposures_user_question
  ON pool_question_exposures(line_user_id, question_id, status);
CREATE INDEX IF NOT EXISTS idx_pool_exposures_question
  ON pool_question_exposures(question_id, status);

-- 回答＝信頼スコアの素材。topic_tag / client_id は回答時点のスナップショット
-- （設問側を後から編集しても素材の意味が変わらないように焼き付ける）。
CREATE TABLE IF NOT EXISTS pool_question_answers (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  exposure_id  UUID        NOT NULL REFERENCES pool_question_exposures(id) ON DELETE CASCADE,
  question_id  UUID        NOT NULL REFERENCES pool_questions(id) ON DELETE CASCADE,
  line_user_id TEXT        NOT NULL REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  answer_value JSONB       NOT NULL,
  answer_ms    INTEGER,
  topic_tag    TEXT,
  client_id    UUID,
  answered_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (exposure_id)
);

CREATE INDEX IF NOT EXISTS idx_pool_answers_user
  ON pool_question_answers(line_user_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_pool_answers_topic
  ON pool_question_answers(line_user_id, topic_tag, answered_at DESC);

-- RLS: アプリは service_role で接続する。anon / authenticated には出さない
-- （076→077 の是正と同じ教訓。GRANT は 074 の DEFAULT PRIVILEGES でも付くが明示する）。
ALTER TABLE pool_questions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_question_exposures ENABLE ROW LEVEL SECURITY;
ALTER TABLE pool_question_answers   ENABLE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON pool_questions          TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON pool_question_exposures TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON pool_question_answers   TO service_role;

-- point_histories の CHECK に pool_question / pool_question_answer を追加。
-- ⚠ 実装時の注意: 下のリストは 050 時点の全値＋今回の追加。050 より後に
-- この CHECK を再構築した migration が無いか grep で確認し、あれば最新の
-- 全値リストに追記する形で書くこと（値の取りこぼし＝既存機能の insert 失敗）。
ALTER TABLE point_histories
  DROP CONSTRAINT IF EXISTS point_histories_transaction_type_check;
ALTER TABLE point_histories
  ADD CONSTRAINT point_histories_transaction_type_check
  CHECK (transaction_type IN (
    'daily_survey', 'interview_complete', 'project_completion', 'streak_bonus',
    'birthday_bonus', 'campaign_bonus', 'attribute_update', 'first_bonus',
    'continuity_bonus', 'project_bonus', 'manual_adjustment', 'redemption',
    'exchange_request', 'exchange_cancel', 'exchange_refund',
    'pool_question'
  ));

ALTER TABLE point_histories
  DROP CONSTRAINT IF EXISTS point_histories_reference_type_check;
ALTER TABLE point_histories
  ADD CONSTRAINT point_histories_reference_type_check
  CHECK (reference_type IN (
    'daily_survey_answer', 'project_assignment', 'campaign', 'session', 'manual',
    'exchange_request',
    'pool_question_answer'
  ));
```

| テーブル | 主な用途 |
|---|---|
| `pool_questions` | 設問プール（運営/企業）。出題制御（priority・期間・再出題間隔） |
| `pool_question_exposures` | 出題ログ。所有者検証・冪等な再掲・日次上限・スキップ管理 |
| `pool_question_answers` | 回答本体＋信号（回答所要ms・トピック/企業スナップショット）＝将来の信頼スコア素材 |

## 権限

| 操作 | 回答者（LIFF） | 運営（admin） |
|---|---|---|
| 今日の出題取得 | ○（本人ぶんのみ・サーバーが選定） | −（一覧画面で統計は見える） |
| 回答 / スキップ | ○（本人の exposure のみ。403/409 で遮断） | − |
| 設問 CRUD・status 変更 | − | ○ |
| 回答データ閲覧 | −（自分の過去回答も見せない） | ○（集計値。個票閲覧UIは今回作らない） |

- RLS 方針: 全テーブル RLS 有効・ポリシーなし（= anon/authenticated は一切アクセス不可）。アプリサーバー（service_role）経由のみ。
- 回答者には topic_tag・client_id・判定利用の存在を一切見せない。

## 受け入れ条件

正常系:
- [ ] 案件一覧を開くと、今日の1問カードの下についでスワイプのカードが出る（active なプール設問があり未回答の場合）
- [ ] 2択設問が swipe_card パターンで描画され、スワイプ1操作で確定・次の設問へ進む（送信ボタンなし）
- [ ] 最大3問で完了表示に変わり、リロードしても今日はもう出題されない
- [ ] 回答直後にホストのポイントカードが `+1pt` 加算後の値に更新される（`pointStatus` 反映）
- [ ] `point_histories` に `transaction_type='pool_question'` の行が付き、`user_points` トリガで残高が増える
- [ ] スキップすると次の設問に進み、ポイントは付かず、同設問は14日間出題されない
- [ ] 途中でリロードすると、残っていた served の設問が同じ順で再掲される（別の設問に差し替わらない）
- [ ] `reask_after_days=N` の設問は、回答からN日経過後に再出題され、回答が別 exposure で2行貯まる
- [ ] 管理画面で設問の作成・編集・activate/pause/archive・出題/回答/スキップ数の閲覧ができる
- [ ] 新規フォームは「設問文＋2択ラベル」だけ入力して保存でき、保存後も同フォームに留まり topic_tag・企業・詳細設定が維持される
- [ ] フォームのプレビューに実レンダラの swipe_card が描画され、選択肢を3つにすると tap_cards に切り替わる
- [ ] まとめて追加で `設問文 | 左 | 右` を複数行貼り付け→一時テーブル確認→1回のPOSTで全行作成できる。不正行があれば1件も作成されない
- [ ] 一覧に active 在庫件数が表示され、10件未満で警告が出る
- [ ] 回答が付いた設問は設問文・選択肢が編集不可になり、archive→新規作成の案内が出る
- [ ] 回答レスポンス・出題レスポンスのどこにも topic_tag / client_id が含まれない

異常系:
- [ ] プール設問ゼロ・fetch失敗・exposure作成失敗のいずれでも案件一覧は通常どおり表示される（カードが出ないだけ）
- [ ] 他人の exposureId を使った回答 POST は 403
- [ ] 同じ exposure への2回目の回答 POST は 409（ポイント二重付与なし）
- [ ] skipped 済み exposure への回答 POST は 409
- [ ] answerValue 欠落は 400
- [ ] 回答付き設問の削除はブロックされ、archive を案内するエラーになる

## 実装指示（AIエージェント向け）

### 実装順序

1. **migration**: `supabase/migrations/082_pool_questions.sql`（上記SQL。⚠内の transaction_type 最新値確認を先に行う）→ `npm run db:migrate` で本番適用
2. **選定ロジック（純関数）**: `src/lib/poolQuestionSelection.ts` — 候補配列＋本人の exposure/answer 履歴＋今日の日付を受け取り、出題すべき設問配列を返す純関数 `selectPoolQuestions()`。定数 `POOL_DAILY_CAP = 3` / `POOL_SKIP_COOLDOWN_DAYS = 14` もここ。**DBアクセスを混ぜない**（テスト容易性のため。probePlaygroundService の純関数分離と同じ流儀）
3. **repository / service**: `src/repositories/poolQuestionRepository.ts`（CRUD＋候補取得＋exposure upsert＋集計）、`src/services/poolQuestionService.ts`（selection 呼び出し・exposure 作成・回答記録・ポイント付与。`dailySurveyService.recordAnswer` の処理順を踏襲）
4. **LIFF API**: `liffController.ts` に `getTodayPoolQuestions` / `submitPoolQuestionAnswer` / `skipPoolQuestion` を追加し、`liffRoutes.ts` の daily 系の並びに登録
5. **UI**: `src/views/partials/pool-swipe-box.ejs` 新規 → `projects.ejs` に `#pool-swipe-area` と `PoolSwipe.mount` を追加（`DailyToday.mount` の直後・onAnswered は既存の renderPointCard/RankCelebration パターンを流用）
6. **admin**: `adminController` ハンドラ＋`adminRoutes` ＋ `src/views/admin/pool-questions/`（index / form / bulk）。daily-surveys のビュー構成を踏襲。form は answer-ui.ejs include のライブプレビュー付き2カラム、bulk はクライアント一時状態→1回POST（spec-daily-survey-create-ux-reform.md と同方式）
7. **テスト**: `src/tests/poolQuestionSelection.test.ts`（選定純関数: 上限・除外・冪等再掲・reask・スキップcooldownの各ケース）。既存テストの書き方（node:test / dailyAnswerUi.test.ts）に合わせる

### 規約

- Express + EJS + Supabase(service_role)。TypeScript は既存の controller/service/repository 分層に従う
- 商用副作用（ポイント付与・DB更新）は**レスポンス前に await**（Vercel serverless。投げっぱなし禁止）
- 日付は `jstDateString()`（JST権威）。UTC混入は事故のもと
- LIFF 認証は `bearerToken` + `liffAuthService.verifyIdToken` のみ。独自の認証分岐を作らない
- モバイルファースト。swipe レンダラは既存のものを使い、reduced-motion 等の配慮も answer-ui 側に任せる

### 禁止事項

- `answer-ui.ejs` のレンダラ追加・変更（本仕様は既存パターンの消費者に徹する）
- デイリーアンケート系（daily_surveys / deliveries / cron runSlot / 今日の1問カード）の挙動変更。**runSlot は本番へ実 push するのでローカルから叩かない**
- `respondents.total_points` への加算（レガシー経路）。ポイントは `userPointService.awardPoints` のみ
- 統計エクスポートの wide/long/codebook への列追加（凍結契約。プール回答はエクスポート対象外）
- 出題・回答レスポンスへの topic_tag / client_id / 判定用途の露出
- ストリーク（user_streaks）の更新

### 完了確認

`npx tsc --noEmit` / `npm test` / `npm run build` が通り、上記受け入れ条件を満たすこと。UI はモバイルビューポートで projects ページを開いて確認する。

## 将来接続のためのメモ（実装対象外）

- 信頼スコアエンジン（構想②）は `pool_question_answers` を素材に、(a) 同一 topic_tag の本アンケート回答との整合、(b) `reask_after_days` による同一設問の test-retest 一致率、(c) `answer_ms` の異常（即答すぎ）を入力にする想定。二層（トピック別＋総合）・指数減衰（半減期90日仮）・個人ベースライン・方向性判定は構想メモ（project_quality_first_survey）参照
- 志向マッチングは `line_user_id × topic_tag` の回答分布を案件属性と突合する。topic_tag のマスタ化はその時点で
- 企業課金（高精度オプション）を始める際は、規約v2.0のデータ使途条項（project_terms_v2_data_use）との整合を先に確認すること
