# 実装仕様書: 若年層体験パック（20代モニター向け UX 強化・全機能）

作成日: 2026-07-19
前提レポート: 20代若年層コンセプト観点のギャップ洗い出し（本仕様書の Phase A〜D はそのレポートの優先度案に対応）

## 目的

Hibi のコンセプト「20代の若者モニターが、答えやすく・本音を書きやすい」を実現するため、
回答UI・深掘り体験・報酬フィードバック・継続の仕掛けを段階的に強化する。
**全機能は管理画面から ON/OFF・設定変更できること**（グローバル既定＋プロジェクト単位の上書き）。

## スコープ外（今回やらない）

- 回答の保存形式の変更（single=スカラー / multi=配列 は不変。既存の凍結契約を壊さない）
- wide/long/codebook エクスポート列の変更（集計アプリ契約で凍結）
- サーバーサイド音声文字起こし（Whisper 等の API 課金を伴うもの。C-2 はブラウザ内 STT のみ）
- ネイティブアプリ化・PWA 化

## 全体アーキテクチャ: 体験設定（Phase 0）

### 設計方針

- 既存の `answerPresentation.ts` と同じ**サーバー権威**方式。フラグの解決は必ずサーバーで行い、
  LIFF ページへは解決済み値だけを渡す（クライアントに解決ロジックを持たせない）。
- 決定順: `projects.experience_config[key]`（プロジェクト上書き） → `app_settings('experience_defaults')[key]`（グローバル既定） → コード内デフォルト。
- グローバル専用キー（招待・オンボーディング等、案件に紐付かないもの）はプロジェクト上書き不可。

### フラグ一覧（キー名は snake_case で固定）

| キー | 型 | 既定 | スコープ | 対応機能 |
|---|---|---|---|---|
| `probe_skip_button` | bool | true | global+project | A-1 深掘りパスボタン |
| `anonymity_note` | bool | true | global+project | A-2 匿名性の明示 |
| `anonymity_note_text` | string | 固定文（後述） | global+project | A-2 |
| `completion_reward_display` | bool | true | global+project | A-3 完了画面ポイント表示 |
| `rank_celebration_on_complete` | bool | true | global+project | A-4 昇格演出の配線拡張 |
| `probe_chat_persona` | bool | false | global+project | B-1 インタビュアーキャラ |
| `persona_name` / `persona_icon` | string | "ヒビ" / "🌱" | global のみ | B-1 |
| `writing_helper_chips` | bool | false | global+project | B-2 書き出し支援チップ |
| `chat_progress` | bool | true | global+project | B-3 チャット進捗表示 |
| `time_remaining` | bool | true | global+project | B-4 残り所要時間 |
| `answer_distribution` | bool | false | global＋設問単位 | C-1 みんなの回答分布 |
| `voice_input` | bool | false | global+project | C-2 音声入力 |
| `default_answer_ui_preset` | 'casual'\|'standard'\|'formal' | 'standard' | global のみ | C-3 プリセット既定値 |
| `haptics` | bool | true | global | C-4 ハプティクス |
| `quality_micro_feedback` | bool | false | global+project | C-5 品質マイクロコピー |
| `survey_resume` | bool | true | global | C-6 中断再開 |
| `referral_enabled` | bool | false | global のみ | D-1 招待 |
| `referral_bonus_points` / `referral_bonus_points_invitee` | int | 100 / 50 | global のみ | D-1 |
| `share_card_enabled` | bool | false | global のみ | D-2 シェア画像 |
| `streak_freeze_enabled` | bool | false | global のみ | D-3 ストリークフリーズ |
| `streak_reminder_enabled` | bool | false | global のみ | D-3 夜リマインダー |
| `badge_toast` | bool | true | global | D-4 バッジ獲得トースト |
| `onboarding_swipe` | bool | false | global のみ | D-5 初回スワイプ体験 |

### DB（migration 083_experience_settings.sql）

```sql
-- グローバル設定（key-value・サーバー専用）
create table if not exists app_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
-- サーバー（service_role）専用。anon/authenticated からのアクセスは全拒否（policy を作らない）。
grant select, insert, update on app_settings to service_role;

insert into app_settings (key, value) values ('experience_defaults', '{}'::jsonb)
on conflict (key) do nothing;

-- プロジェクト単位の上書き
alter table projects
  add column if not exists experience_config jsonb not null default '{}'::jsonb;
comment on column projects.experience_config is
  '若年層体験パックのプロジェクト上書き。キーは src/lib/experienceConfig.ts の EXPERIENCE_KEYS。空={}=全て全体既定に従う';
```

注意（migration-review 観点）:
- 既存データ破壊なし（新規テーブル＋additive カラムのみ）。rollback は drop table / drop column で可能。
- `npm run db:migrate` で本番適用（feedback_auto_apply_migrations 準拠）。

### サーバー実装

新規ファイル:
- `src/lib/experienceConfig.ts` … 純関数。`resolveExperience(projectConfig, globalDefaults): ResolvedExperience`。
  キー一覧 `EXPERIENCE_KEYS`（型付き）とコード内デフォルトをここに集約。未知キーは無視。
- `src/repositories/appSettingsRepository.ts` … `get(key)` / `upsert(key, value)`。service_role クライアント使用。
- `src/services/experienceService.ts` … `getResolvedForProject(projectId)` / `getGlobal()`。
  60 秒のインメモリキャッシュ可（サーバーレスなのでベストエフォートでよい）。

LIFF への受け渡し:
- `liffController` の各ページ描画（survey / projects / mypage / daily-survey 等）で
  `locals.experience = resolved` を渡し、EJS 側で `window.EXPERIENCE = <%- JSON.stringify(experience) %>` として注入。
- API レスポンスに載せる必要があるのは C-1（分布）のみ。他はページ注入で足りる。

### 画面: 管理画面（グローバル）

**新規 `/admin/experience-settings`**（views/admin/experience-settings/index.ejs）

- 表示項目: 上記フラグ一覧を「A 本音の書きやすさ / B 書く体験 / C 楽しさ / D 成長ループ」のセクションに分けたトグル＋入力欄。
  各行に 1 行説明（この仕様書の機能名をそのまま使う）。
- 操作: 保存ボタン 1 つ。POST で `app_settings('experience_defaults')` を丸ごと upsert。
- 状態: 保存成功/失敗のフラッシュ表示。読み込み失敗時はエラー表示（空フォームで保存させない）。
- ルーティング: `adminRoutes.ts` に GET/POST を追加。既存の admin ページ（pool-questions 等）の
  controller / route / view の構成に合わせる。管理画面の既存認証ミドルウェアをそのまま通す。

### 画面: 管理画面（プロジェクト上書き）

**既存 `researchForm.ejs` の回答UIセクション（answer_ui_preset select 周辺）に追記**

- 「若年層体験オプション」欄を追加。project スコープの各キーについて
  `<select>`（`継承（全体既定）` / `ON` / `OFF`）を並べる。継承は `experience_config` にキーを**書かない**ことで表現する。
- `anonymity_note_text` はテキスト入力（空=継承）。
- 保存: projects 更新の既存 POST に `experience_config` の組み立てを追加（controller 側でホワイトリスト検証。
  未知キー・型不一致は捨てる）。

### C-3 連動: answer_ui_preset のグローバル既定化

- `projects.answer_ui_preset` は **not null default 'standard' のまま変えない**（既存挙動保存）。
- researchForm の select に `（全体既定に従う）` を追加する場合は空文字を POST し、controller で
  `experience_defaults.default_answer_ui_preset` を引いて**保存時に実体化**する（列を nullable にしない。
  実行時解決を増やさないため）。
- 新規プロジェクト作成時の初期値も同様に全体既定を実体化する。

### 受け入れ条件（Phase 0）

- [ ] `/admin/experience-settings` でトグルを変更・保存でき、再読込で保持される
- [ ] researchForm でプロジェクト上書きを設定でき、`experience_config` に選んだキーだけが保存される
- [ ] LIFF ページの `window.EXPERIENCE` に解決済み値が入る（上書き > 全体既定 > コード既定の順）
- [ ] app_settings に anon キーでアクセスできない（RLS）
- [ ] 既存プロジェクトの answer_ui_preset・回答挙動が一切変わらない

---

## Phase A（本音の核・配線中心）

### A-1 深掘り（probe）パスボタン

**目的**: 答えたくない深掘りに UI の逃げ道を用意し、離脱と空虚な義務回答を減らす。

**画面**:
- survey_question モード: `probeArea`（survey.ejs:432 付近）の送信ボタン横に
  控えめなテキストボタン「うまく言えない・パス」を追加（pool-swipe の `.skip` と同トーン）。
- interview_chat モード: probe 表示中（chatTextRow が出ている間）だけ入力欄の上に同じパスリンクを表示。
- タップ時: 確認なしで次の設問へ進む。ユーザーバブルには「（パス）」等を**残さない**（気まずさを作らない）。

**API**:
- `POST /liff/chat` の body に `skip: true` を追加受理。`skip` のとき:
  - probe 待ち状態（`state_json.pendingProbe*`）をクリアし、`probe_question: null` を返す。
  - `answers` へは保存しない。代わりにセッション `state_json.probeSkips`（配列: 設問ID＋時刻）へ記録
    （信頼スコア素材。新テーブルは作らない）。
- survey_question モードの probe は既存の probe 応答フローに合わせて同じ `/liff/chat` を `skip: true` で呼ぶ。

**フラグ**: `probe_skip_button`（OFF なら現行どおりボタン非表示）。

**受け入れ条件**:
- [ ] probe 表示中にパスを押すと次の設問へ進み、回答テーブルに空回答が入らない
- [ ] `state_json.probeSkips` に記録される
- [ ] フラグ OFF でボタンが出ない／既存の probe 回答フローは無変更

### A-2 匿名性の明示

**目的**: 「誰が読むのか」の不安を除去し、自由記述の本音率を上げる。

**画面**:
- survey.ejs: 自由記述（textarea 描画時）と probeArea の直上に 1 行:
  既定文言「🔒 回答は匿名で集計されます。あなたの名前が企業に伝わることはありません」。
- daily-today-card / pool-swipe: テキスト設問フォールバック時のみ同じ行を出す（選択式には出さない。ノイズ回避）。
- スタイル: 12px・グレー・アイコン付き。タップ不要の静的表示。

**フラグ**: `anonymity_note` / 文言は `anonymity_note_text`（プロジェクト上書き可。
店舗アンケート等、実名を取る案件では OFF or 文言変更できることが必須）。

**注意**: 文言は規約 v2（docs/terms-v2-draft.md）の記載と矛盾しないこと。
verbatim 引用を行う案件では「回答内容は匿名のまま公表に使われることがあります」等へ差し替え必要 → 既定文言の最終決定は運営判断（実装は文言可変にするだけ）。

**受け入れ条件**:
- [ ] 自由記述・probe の直上に表示される／選択式には出ない
- [ ] プロジェクト上書きで文言変更・非表示にできる

### A-3 完了画面の獲得ポイント表示

**目的**: 報酬が最も大きい案件アンケート完了時に「もらえた」を見せ、次回回答の動機を作る。

**API**:
- `POST /liff/survey/:assignmentId/complete`（liffController.completeSurveyByAssignment）のレスポンスを拡張:
  ```json
  { "ok": true, "alreadyCompleted": false,
    "pointsAwarded": 300,
    "pointStatus": { "available_points": 1234, "rank_code": "...", "tier": 2,
                      "next_rank_name": "...", "points_to_next": 66 } }
  ```
- `runPostCompleteProcess` から付与ポイント数を戻り値で受け取り（現状 void なら戻り値追加）、
  `pointStatusService.getStatus(lineUserId)` を**付与後に**呼んで同梱。
- `alreadyCompleted: true` のときは `pointsAwarded: 0`＋現在の pointStatus のみ（二重演出防止）。
- 旧クライアント互換: 追加フィールドのみ。既存フィールドは不変。

**画面**:
- survey_question の完了画面（`complete-title` 付近）と interview_chat の完了バブル直後に共通の報酬カードを描画:
  `+300pt GET!`（カウントアップアニメーション）＋残高＋「次のランクまであと◯pt」バー
  （projects.ejs の `.hb-pt` の見た目を流用。実装はパーシャル化して共用: `partials/reward-flash.ejs` を新設）。
- `prefers-reduced-motion` でアニメーション停止。
- 完了 API が失敗した場合は現行のエラーメッセージ（報酬カードは出さない）。

**フラグ**: `completion_reward_display`。

**受け入れ条件**:
- [ ] survey_question / interview_chat 両経路で完了時に獲得 pt と残高が表示される（両経路必須: project_store_survey_join_cta の教訓）
- [ ] 二重完了（リロード）で 0pt 表示になり演出が再発火しない
- [ ] 店舗専用アンケート（非会員）では報酬カードを出さず既存 CTA を維持する

### A-4 昇格演出の配線拡張

**目的**: 昇格の瞬間を逃さない。現状デイリー回答（projects/mypage の onAnswered）のみ発火。

**画面/実装**:
- survey.ejs に `rank-icons.js` と `partials/rank-celebration.ejs` を include（CSP 準拠の既存方式のまま）。
- A-3 の complete レスポンスに `prevPointStatus` も同梱（付与**前**の getStatus を先に取る）。
  クライアントは `RankCelebration.maybePlay(prevStatus, nextStatus)` を完了画面表示後に呼ぶ。
- pool-swipe の回答レスポンス（既に pointStatus を含む）にも `prevPointStatus` を追加し、
  projects.ejs の onAnswered で同様に発火。

**フラグ**: `rank_celebration_on_complete`。

**受け入れ条件**:
- [ ] 案件完了で閾値を跨ぐと昇格演出が再生される／跨がなければ何も起きない
- [ ] デイリーの既存発火と二重にならない（同一画面で 1 回だけ）

---

## Phase B（書く体験の刷新）

### B-1 インタビュアーキャラクター（アバター＋名前）

**目的**: 「システムに尋問される」感を消し、人格のある聞き手に話す体験へ。

**画面**:
- interview_chat: AI バブルの左に 32px の丸アバター（`persona_icon` の絵文字 or 画像URL）＋
  初回メッセージの前に一言自己紹介バブル「こんにちは、インタビュアーの<persona_name>です。今日は◯分ほどお付き合いください」。
- survey_question の probeArea: 事務的なカードをやめ、チャットバブル風の吹き出し＋アバターで
  probe 質問を表示する（見た目のみ。フローは不変）。
- 自己紹介文はハードコードせず `experience_defaults` の `persona_intro_text`（string・任意）を追加。

**プロンプト連携**: 文体は既存の `young_casual` プロンプトプリセット（prompt-packages）が担当。
本機能は**見た目のみ**でプロンプトには触らない（キャラ名と AI の一人称を合わせたい場合は
プロンプトパッケージ側で設定する運用とし、仕様書スコープ外）。

**フラグ**: `probe_chat_persona`（OFF なら現行の無記名バブル）。

**受け入れ条件**:
- [ ] ON でアバター＋自己紹介が出る／OFF で現行表示
- [ ] probe の送信・保存フローに変化がない（見た目だけの変更）

### B-2 書き出し支援チップ

**目的**: 白紙の textarea 恐怖をなくす。タップで文頭が入り、続きを書くだけにする。

**画面**:
- 自由記述（free_text_short / free_text_long / probe）の textarea 上部にチップ列（横スクロール可）:
  既定チップ「正直、」「一番気になったのは」「値段について」「見た目について」「強いて言えば」。
- タップでカーソル位置に挿入（既に本文があれば末尾に追記）。挿入後フォーカスを textarea へ。
- 設問単位のカスタムチップ: `question_config.presentation.helper_chips: string[]`（managementUI は
  questions form の presentation 設定欄に textarea（改行区切り）で追加）。未設定は既定チップ。

**非誘導との整合（重要）**: チップは**観点の入口**のみとし、意見の方向（「良かった」「悪かった」）を
含む文言を既定に入れない。`non_leading` プリセット案件では設問単位で空配列を設定して無効化できる。

**フラグ**: `writing_helper_chips`。

**受け入れ条件**:
- [ ] チップタップで文頭が挿入されフォーカスが戻る
- [ ] 設問単位チップが既定を上書きする／空配列で非表示
- [ ] 保存される回答はチップ文＋ユーザー入力の連結テキスト（特別扱いなし）

### B-3 チャットモードの進捗表示

**目的**: 「あとどれくらいか」不明による離脱を防ぐ。

**画面**:
- interview_chat のヘッダ（chat-container 上部に固定バー新設）: 細プログレスバー＋「あと◯問くらい」。
- 分母は `visibleQs.length`、分子は `chatQueueIndex`。probe は問数に数えない
  （「くらい」の曖昧表現で吸収。分岐で増減しても破綻しない）。
- screening フェーズ中は「条件確認中（あと◯問）」表記。

**フラグ**: `chat_progress`。

**受け入れ条件**:
- [ ] 設問が進むとバーが進む／probe 中は進まない
- [ ] 分岐スキップで問数が減っても表示が破綻しない

### B-4 残り所要時間の表示（survey_question）

**目的**: プログレスバーだけでは長さの体感が掴めないのを補う。

**画面**:
- progress-bar 直下に小さく「あと約◯分」。
- 計算: `project.estimated_minutes × (1 - cursor / visibleQs.length)` を切り上げ。1 分未満は「あと1分かからず終わります」。
- `estimated_minutes` 未設定の案件では非表示（推計しない）。

**フラグ**: `time_remaining`。

**受け入れ条件**:
- [ ] estimated_minutes がある案件のみ表示され、進捗で減っていく

---

## Phase C（楽しさの上乗せ）

### C-1 みんなの回答分布

**目的**: 回答直後に「自分は多数派か少数派か」を見せる。20代の回答動機として最重要級の報酬。

**対象**: プール設問（ついでスワイプ）とデイリーの**選択式のみ**。案件アンケートは対象外
（調査の中立性と納品データへの影響を避ける）。

**API**:
- プール: `POST /liff/pool-questions/:id/answer` のレスポンスに追加:
  ```json
  { "distribution": { "total": 128, "choices": [ { "value": "a", "label": "朝", "count": 80, "pct": 63 } ] } }
  ```
  集計は回答保存後に同一リクエスト内で group by（プールは低頻度・小規模なので集計テーブル不要。
  遅くなったら materialized 化を検討）。**回答前には絶対に返さない**（誘導防止）。
  `total < 10` のときは `distribution: null`（n が小さいと個人が推測されうる）。
- デイリー: 回答 POST のレスポンスに同様の distribution を追加（設問単位フラグが ON のもののみ）。

**設問単位の選択**: `pool_questions` / デイリー設問の管理フォームに「回答後に分布を表示する」
チェックボックスを追加（カラム `show_distribution boolean not null default false` を両テーブルに追加 → migration 084）。

**画面**:
- 回答確定 → 分布バー（自分の選択肢をハイライト）＋「あなたは◯◯派（62%）/ 少数派！（12%）」を
  1.5 秒フェードインで表示 → 次の設問 or done へ。distribution が null なら現行どおり即遷移。

**規約整合（実装前ゲート）**: 集計値の本人向け表示が規約 v2 の利用目的に収まっているかを確認してから着手。
NG なら文言追加が先（terms-v2-draft.md 管轄）。

**フラグ**: グローバル `answer_distribution` AND 設問単位 `show_distribution`。

**受け入れ条件**:
- [ ] 回答後にのみ分布が表示される（回答前のレスポンス・HTML に分布が含まれない）
- [ ] n<10 で表示されない／設問フラグ OFF で表示されない
- [ ] 分布表示中の再タップで二重回答にならない

### C-2 音声入力（ブラウザ内 STT）

**目的**: 長文を打たない層の本音を「喋って書く」で回収する。

**画面**:
- 自由記述 textarea（probe 含む）の右下にマイクボタン。押下で録音開始（ボタンが赤く脈動）、
  もう一度押すか無音 2 秒で停止し、認識テキストを textarea 末尾に追記（**編集可能**のまま。自動送信しない）。

**実装**:
- `window.SpeechRecognition || window.webkitSpeechRecognition` の**存在検出でボタンを出し分ける**。
  LIFF の iOS WebView（WKWebView）では利用不可のため、非対応環境ではボタン自体を描画しない
  （エラーを見せない。これが仕様）。lang='ja-JP'、interimResults は使わず final のみ追記。
- 権限拒否時: トースト「マイクが許可されていません」1 回のみ。

**フラグ**: `voice_input`（既定 OFF。対応環境が限られるため運営が明示的に有効化する）。

**受け入れ条件**:
- [ ] Android Chrome 系 LIFF で録音→テキスト追記→手動送信ができる
- [ ] iOS LIFF ではボタンが出ない／機能フラグ OFF でも出ない

### C-3 casual 既定化＋legacy 型のプリセット対応

**目的**: 若年層向けをデフォルト体験にする。プリセット対象外で従来描画に落ちる設問型を減らす。

**実装**:
1. Phase 0 の `default_answer_ui_preset` を researchForm・新規作成フローに配線（前述）。
2. `answerPresentation.ts` の basePattern に legacy 型を追加:
   - `sd`（SD法）→ casual: `face_scale`（両極ラベルを端に表示）/ standard: `big_slider` / formal: legacy
   - `numeric` → casual/standard: `big_slider`（options が数値連番のとき）/ formal: legacy
   - `scale`（legacy）→ single_choice の scale 指定と同じ分岐に合流
   - 適用不能条件（SCALE_OPTION_MAX 等）は既存の applyFallback をそのまま通す。
3. answer-ui.ejs 側は既存パターンの再利用のみで新規レンダラ不要（sd の端ラベルは bigslider-ends を使う）。

**テスト**: `answerPresentation.test.ts` に sd/numeric/scale の decision table を追加。
**罠**（project_answer_ui_renderer_gotchas）: 新レンダラを追加する場合は label+hidden checkbox 禁止・
data-code input への独自 value 配線禁止を必ず確認。

**受け入れ条件**:
- [ ] 全体既定を casual にすると新規プロジェクトが casual で作られる／既存プロジェクトは不変
- [ ] sd/numeric が casual で face_scale / big_slider 描画になり、保存形式は従来と一致

### C-4 ハプティクス

**目的**: スワイプ確定・昇格の「気持ちよさ」を触覚で足す。

**実装**:
- `src/views/partials/answer-ui.ejs` に `function haptic(ms)` を追加:
  `if (window.EXPERIENCE?.haptics && navigator.vibrate) navigator.vibrate(ms)`。
- 発火点: swipe/split/sort のコミット時 15ms、carousel CTA 10ms、昇格演出開始時 [30,50,30]。
- iOS Safari/WebView は navigator.vibrate 非対応 → 自然に no-op（分岐不要）。

**フラグ**: `haptics`（既定 ON。vibrate 非対応環境では実質無効）。

**受け入れ条件**:
- [ ] Android でスワイプ確定時に振動する／フラグ OFF で振動しない

### C-5 品質マイクロコピー（ポジティブ後押し）

**目的**: 文字数カウンタではなく「伝わってる」感で自然に厚い回答へ誘導。

**画面**:
- 自由記述 textarea の下に段階表示（入力イベントで更新・デバウンス 300ms）:
  - 0〜9 文字: 表示なし
  - 10〜29 文字: 「👍 いい感じです」
  - 30 文字以上: 「✨ 伝わる回答です。ありがとうございます」
  - BOILERPLATE_EXACT に一致: 「もう一言だけ、理由を教えてもらえると嬉しいです」（送信は妨げない。
    既存の isFreeTextValid による必須判定はそのまま）
- 閾値はコード定数（設定画面には出さない。過剰設定化を避ける）。

**フラグ**: `quality_micro_feedback`。

**受け入れ条件**:
- [ ] 入力量に応じて表示が変わる／既存バリデーションの挙動は不変

### C-6 中断・再開（survey_question カーソル復元）

**目的**: LIFF を閉じて戻ったとき最初からやり直しになる離脱要因を除去。

**実装**:
- 回答は既に設問ごとにサーバー保存されている（submitAnswer）。復元だけが未実装。
- サーバー: survey ページ描画時に該当 assignment の回答済み question_code 一覧を取得し、
  `locals.answeredCodes` として注入。
- クライアント: 起動時に `visibleQs` の先頭から answeredCodes に含まれる設問をスキップした位置へ
  cursor を進める（分岐 resolveNext は再評価。回答済み値は answerCtx へ復元して分岐条件・
  carry-forward が正しく効くようにする）。
- interview_chat は対象外（会話ログ復元は複雑度が高い。今回はスコープ外と明記）。

**フラグ**: `survey_resume`。

**受け入れ条件**:
- [ ] 3 問回答→ページ再読込→4 問目から再開され、分岐・表示条件が正しく効く
- [ ] 全問回答済みで再訪すると完了確定フローへ直行する（既存の complete resume と競合しない）

---

## Phase D（成長ループ）

### D-1 招待（紹介コード）

**目的**: 20代獲得の主経路（友達紹介）を作る。

**DB（migration 085_referrals.sql）**:
```sql
alter table respondents add column if not exists referral_code text unique;
create table referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_respondent_id uuid not null references respondents(id),
  invitee_respondent_id uuid not null references respondents(id) unique, -- 1人は1回しか招待されない
  code text not null,
  status text not null default 'registered' check (status in ('registered','qualified','awarded')),
  created_at timestamptz not null default now(),
  awarded_at timestamptz
);
-- RLS: サーバー専用（service_role のみ）。
```
- referral_code は登録時に採番（英数 8 桁・衝突時リトライ）。既存ユーザーは初回マイページ表示時に遅延採番。

**フロー**:
1. マイページに「友達を招待」カード: 自分のコード＋「LINE で送る」（`liff.shareTargetPicker` で
   招待メッセージ＋登録 URL `?ref=CODE` を送信。非対応環境はコピーだけ）。
2. 登録フロー（profile-check / store-entry の member join）で `ref` パラメータを受け取り、
   registered で referrals 作成。**自己招待・重複は 409**。
3. **不正対策**: 付与は登録時ではなく「招待された側が有効回答 3 件完了」時点（status: qualified→awarded）。
   判定は既存の完了処理（runPostCompleteProcess）にフックし、awardPoints で
   referrer に `referral_bonus_points`、invitee に `referral_bonus_points_invitee` を付与
   （point_histories の reason に `referral_bonus` を追加。enum 制約があれば migration で追加）。
4. マイページに招待状況（登録◯人・達成◯人・獲得◯pt）。

**規約整合**: 紹介プログラムの条件（付与条件・不正時没収）は利用規約に記載が必要 → 実装前に条文確認。

**受け入れ条件**:
- [ ] コード経由登録で referrals が作られ、3 件完了で両者に pt 付与（べき等・二重付与なし）
- [ ] 自己招待・同一 invitee の重複が拒否される
- [ ] フラグ OFF で招待カード・ref 受理が無効

### D-2 シェア画像（性格タイプ / 実績カード）

**目的**: 「友達に見せたくなる成果物」を作り、オーガニック流入を得る。

**実装**:
- personality.ejs に「シェア画像を作る」ボタン → クライアント側 canvas で
  1080×1080 のカード（タイプ名・バー・Hibi ロゴ・招待コード）を描画 → `liff.shareTargetPicker`
  （画像は一旦 dataURL → 既存の画像アップロード API で一時 URL 化して flex message で送る。
   一時画像は 24h で削除する cron 不要の手段として、Storage の署名付き URL＋短寿命を利用）。
- **含めてはいけない情報**: 実名・LINE ID・具体的な回答内容（匿名の集計・タイプ表現のみ）。
- セルフチェック（メンタル）系データはカードに一切使わない（規約 v2 の除外条文）。

**フラグ**: `share_card_enabled`。

**受け入れ条件**:
- [ ] 画像が生成され LINE でシェアできる／個人特定情報が画像に含まれない

### D-3 ストリーク防衛（フリーズ＋夜リマインダー）

**目的**: ストリークが切れた日を離脱日にしない。

**DB（migration 086）**: `alter table respondents add column streak_freezes_available int not null default 0;`
＋月初リセットはしない（付与型: 毎月 1 個付与だと cron が要る → **付与は「30 日連続達成ごとに 1 個」**に
して回答時判定で完結させる。Vercel Hobby の cron 制約に抵触しない）。

**フロー**:
- ストリーク計算（dailySurveyChatService の streak 算出）で「昨日未回答だが freezes_available > 0」の場合、
  1 個消費して streak を継続。消費したことを回答レスポンスに `streakFreezeUsed: true` で返し、
  カードに「フリーズを使って◯日連続をキープ！」表示。
- 夜リマインダー: 既存の夜枠 runSlot 配信処理に「当日デイリー未回答かつ streak ≥ 3 のユーザー」への
  一言 push を追加（新規 cron は作らない。既存夜枠に相乗り。夜枠 OFF 環境では送られない=仕様）。

**フラグ**: `streak_freeze_enabled` / `streak_reminder_enabled`。

**受け入れ条件**:
- [ ] 1 日飛ばしてもフリーズ保有時は連続日数が維持され、保有数が減る
- [ ] 30 日連続達成でフリーズが 1 個付与される（二重付与なし）
- [ ] リマインダーは未回答者だけに 1 日 1 回、夜枠でのみ送られる

### D-4 バッジ獲得トースト

**目的**: バッジが「mypage に並ぶだけ」の死に資産になっているのを、獲得の瞬間の喜びに変える。

**実装**:
- バッジ付与処理（badge 付与サービス）の結果を、デイリー回答レスポンス・complete レスポンスに
  `newBadges: [{code, name, icon}]` として同梱。
- クライアント: rank-celebration と同様の共通パーシャル `partials/badge-toast.ejs` を新設。
  画面下からトースト（アイコン＋「バッジ『◯◯』を獲得！」）を 3 秒表示。昇格演出と同時発生時は
  昇格演出の後に順次表示（キュー処理）。

**フラグ**: `badge_toast`。

**受け入れ条件**:
- [ ] バッジ付与と同じリクエスト内でトーストが出る／昇格演出と重ならない

### D-5 オンボーディング（初回 3 スワイプ体験）

**目的**: 初回ユーザーに 30 秒で「スワイプ→pt が貯まる→交換できる」を体験させる。

**実装**:
- 対象: 登録完了直後（profile-check 完了後の遷移先）で、プール回答実績 0 のユーザー。
- 画面: 専用ページは作らず、projects.ejs 先頭に全画面オーバーレイ（3 枚のオンボーディング専用
  プール設問を PoolSwipe の既存 UI で出題 → 3 問目完了で「+3pt GET! Hibi はこうやって貯まる」→
  オーバーレイを閉じて一覧へ）。
- 出題は既存 pool_questions に `is_onboarding boolean default false` を追加（migration 084 に同居）し、
  オンボーディング時のみ CAP・cooldown を無視してこの 3 問を出す。
- 完了フラグは respondents に持たせず「is_onboarding 設問への回答有無」で判定（追加状態を作らない）。

**フラグ**: `onboarding_swipe`。

**受け入れ条件**:
- [ ] 初回のみ表示され、3 問回答で閉じ、以後表示されない（スキップリンクあり）
- [ ] 通常のプール出題ロジック（CAP/cooldown）に影響しない

### D-6 ダークモード（参考・最後）

- 対象を LIFF 主要 5 画面＋answer-ui に限定し、色を CSS カスタムプロパティへ抽出 →
  `prefers-color-scheme: dark` で差し替え。管理画面は対象外。
- 工数対効果が最も低いため Phase D の最後。フラグ不要（OS 設定に追従）。
- 受け入れ: ダーク設定端末で文字が読める・選択状態が判別できる（コントラスト 4.5:1）。

---

## 権限まとめ

| 操作 | 回答者(LIFF) | 管理者(admin) |
|---|---|---|
| 体験設定の閲覧（解決済み値の注入） | ○（自分のページ描画時のみ） | ○ |
| グローバル設定の変更 | × | ○（/admin/experience-settings） |
| プロジェクト上書きの変更 | × | ○（researchForm） |
| 設問単位設定（分布・チップ） | × | ○（questions form / pool-questions form） |
| 分布の閲覧 | ○（自分が回答した設問・回答後のみ） | ○ |
| 招待コード発行・照会 | ○（自分の分のみ） | ○（全件） |

- RLS 方針: 新規テーブル（app_settings / referrals）はすべて service_role 専用（policy なし＝全拒否）。
  service_role GRANT の付け漏れに注意（074 事件の再発防止: migration に grant を明記する）。
- LIFF 側の書込み系は既存どおり ID トークン検証＋所有者検証（verifyAssignmentOwnerOrThrow 等）を通す。

## 実装順序（全体）

1. **Phase 0**: migration 083 → experienceConfig.ts（純関数＋テスト） → repository/service →
   /admin/experience-settings → researchForm 上書き UI → LIFF への注入
2. **Phase A**: A-3（complete レスポンス拡張）→ A-4（celebration 配線）→ A-1（probe skip）→ A-2（匿名表示）
3. **Phase B**: B-1 → B-2 → B-3 → B-4（すべて表示層中心・独立に出荷可）
4. **Phase C**: C-3（プリセット）→ C-5 → C-4 → C-6 → C-1（migration 084・規約確認ゲート）→ C-2
5. **Phase D**: D-4 → D-3（migration 086）→ D-5（084 同居分）→ D-1（migration 085・規約確認ゲート）→ D-2 → D-6

各 Phase 完了ごとに `npx tsc --noEmit` / `npm test`（⚠ 全体並列実行の偽陽性既知・1 本ずつ）/ 実機 LIFF 確認。

## 実装指示（AI エージェント向け・共通規約）

1. **規約**: Express + EJS + Supabase（このリポジトリは Next.js ではない）。controller → service →
   repository の層を守る。LIFF 画面は partials 共通化（answer-ui / rank-celebration の流儀に合わせる）。
   migration は `supabase/migrations/0NN_name.sql` 連番、作成後 `npm run db:migrate` で本番適用。
2. **禁止事項**:
   - 回答の保存形式（single=スカラー / multi=配列）と answers 経路の変更禁止
   - エクスポート（wide/long/codebook）の列変更禁止
   - `runSlot` をローカルから叩かない（本番へ実 push される）
   - 商用副作用（pt 付与・通知）はレスポンス前に await（fire-and-forget 禁止・Vercel サーバーレス）
   - 完了系の変更は survey_question / interview_chat の**両経路**に必ず適用
   - answer-ui に新レンダラを足すときは「label+hidden checkbox 禁止」「data-code input への独自 value 配線禁止」
3. **フラグの既定値**: 本仕様書のフラグ一覧の既定に従う。既定 OFF の機能は出荷しても挙動が変わらないこと
   （＝安全にマージできる）を PR ごとに確認する。
4. **完了確認**: `npx tsc --noEmit` → 対象テスト個別実行 → 各機能の受け入れ条件を実機（モバイルビューポート）で照合。
5. **着手前ゲート**: C-1（分布）と D-1/D-2（招待・シェア）は規約 v2 との整合確認が済むまで実装に入らない。
