# 実装計画: 案件検索サイト化（応募モデル＋Hibi UI＋LIFF統合）

作成日: 2026-07-04
設計元: docs/plan-site-structure.md（§4 応募モデル・§6.5 LIFF統合とデイリー導線）
デザイン正: mockups/（確定＝一覧p51／詳細p56・選考ありp73／保存p59／やりとりp61／マイページp40／応募完了p62／同意ゲートp71／起動時デイリーp80／デイリーバナーp81／リッチメニューp82）
前提スタック: **Express + EJS + Supabase**（Next.jsではない）。スマホ（LIFF）が正、PC対応はスコープ外。

## 実装目的

ユーザーが公式LINE（1本のLIFF）から「案件を探す→応募する→（auto案件は即）回答する→謝礼を受け取る」を完結できるようにする。
完成時: ①一覧/詳細がHibiデザインで表示され応募ボタンが機能する ②auto案件は応募→即回答開始、manual案件は選考待ちに入る ③管理画面で応募の選考（当選→assignment発行/落選）ができる ④起動時デイリー・リッチメニュー導線が繋がる。

## 前提（現状の事実）

- 一覧/詳細/保存/やりとり/マイページのLIFFページとdata APIは**既存**（liffController: projectsPage/getProjectsData/getProjectDetailData/toggleProjectFavorite/savedProjects/interactions/mypage）。UIは旧オレンジ・応募導線なし（「LINEでご連絡ください」止まり）。
- 公開制御は `listDiscoverable()/getDiscoverableById()` の `status='published'` × `visibility_type='public'`。
- assignment作成の冪等パターンは `storeEntryService.resolveEntry()` に実装済み（respondent確保→assignment確保、`projectAssignmentRepository.create`）。**auto応募はこれを流用**。
- assignmentステータスに「当選」は無い（pending/assigned/sent/opened/started/completed/expired/cancelled）。当選＝「applicationがaccepted＋assignment発行」で表現する。
- スクリーニングは回答セッション内で判定→通過で同一セッションcontinue（surveyFlowService）。
- 最新migration=071。migrationは `npm run db:migrate` で本番Supabaseへ自動適用（[[feedback_auto_apply_migrations]]）。
- LIFF IDは RANT/DIARY/PERSONALITY/SURVEY/MYPAGE/CONTACT の6種（全て `LINE_LIFF_ID` フォールバック）。
- デイリーは別系統（dailySurveyService、`/liff/daily-survey?survey_id=` 直アクセスでupsert開始）。

## 仮定した仕様（要確認）

1. **応募時の事前設問はPhase範囲外**。応募＝同意ゲート＋確認のみ。スクリーニングは従来どおり回答セッション冒頭で実施（auto案件は応募→assignment→回答画面でスクリーニング、という現行と同じ流れに乗る）。応募フォームでの事前設問化は、進行中の設問条件制御サーバー権威化（carry-forward）完了後の拡張とする。
2. おすすめ（マッチ度）はPhase範囲外。一覧のイチオシ枠は「新着1件」を暫定表示。
3. 回答UIの現行緑(#2ca87a)→ティール(#0E6B5A)統一は最終Phaseで実施（それまで混在許容）。
4. 実装ブランチは main から `feat/discovery-site` を新規に切る（feat/statistical-export-engine のWIPと混ぜない）。

## 変更対象

| 領域 | 変更有無 | 内容 |
|---|---|---|
| DB | あり | migration 072: project_applications新設＋projects 5カラム追加 |
| API | あり | 応募API群（apply/withdraw）・一覧/詳細data拡張・admin応募管理・デイリーゲートdata |
| UI | あり | LIFF 5画面刷新＋応募フロー新規＋admin応募管理＋リッチメニュー |
| 型定義 | あり | ProjectApplication型・Project拡張・ScreeningPassActionとの対応 |
| その他 | あり | LIFF ID統合（env＋LINE Developers設定）・当選/落選Flexテンプレート |

## 実装フェーズ

### Phase 1: DB＋型（応募モデルの土台）
- migration `072_project_applications.sql`:
  - `project_applications`: id uuid PK / project_id FK / line_user_id text / respondent_id uuid null / status text check(applied|accepted|rejected|withdrawn|expired) default 'applied' / assignment_id uuid null / note text null（admin用メモ）/ applied_at / decided_at / created_at / updated_at、**unique(project_id, line_user_id)**、index(line_user_id, applied_at)
  - projects追加: `tags text[] default '{}'` / `ng_conditions text` / `recruit_deadline timestamptz` / `apply_mode text default 'manual' check(manual|auto)` / `interview_format text`
  - 既存migration（064等）に倣いGRANT/権限を揃える
- domain.ts: `ProjectApplication` / `ProjectApplicationStatus` 型、Projectに5フィールド追加
- 既存テストのProjectフィクスチャに新フィールド補完（064の時と同じ作業）
- **完了条件**: `npm run db:migrate` 適用成功・`npx tsc --noEmit` クリーン・全テストpass

### Phase 2: 応募サービス＋API（サーバ側で完結・UIなし）
- `projectApplicationRepository.ts` 新規: create/findByProjectAndUser/listByUser/listByProject/updateStatus/countMonthlyByUser/countActiveByProject
- `applicationService.ts` 新規:
  - `apply(projectId, lineUserId, displayName)`: 公開検証（published×public・**誤表示遮断を必ず通す**）→ 締切(recruit_deadline)・枠(max_respondents vs countActiveByProject)チェック → 重複チェック（unique違反は409相当）→ application作成 → **apply_mode='auto'なら storeEntryService と同じ冪等パターンで respondent/assignment 確保し assignment_id を保存、`{status:'accepted', assignmentId}` を返す**。manualなら `{status:'applied'}`
  - `withdraw(projectId, lineUserId)`: status='applied' のときのみ withdrawn へ
  - `getMonthlySummary(lineUserId)`: 当月応募数（n/10表示用）
- liffRoutes/liffController: `POST /liff/projects/:id/apply`・`POST /liff/projects/:id/withdraw`（LIFF認証必須・既存の認証seamに合わせる）
- テスト: applicationService（公開遮断/締切/満枠/重複/withdraw条件/auto→assignment冪等）
- **完了条件**: curl等でauto案件に応募→assignment_idが返る・同一ユーザー再応募が409・manual案件はappliedで止まる・テストpass

### Phase 3: admin応募管理（manualフローを成立させる）
- adminController+adminRoutes: `GET /admin/applications`（案件別フィルタ付き一覧）・`POST /admin/applications/:id/accept`（respondent/assignment確保→application更新→**当選Flex通知**）・`POST /admin/applications/:id/reject`（落選通知は任意送信チェックボックス）
- views/admin/applications/index.ejs: 応募一覧（応募日時/ユーザー/プロフィール要約/状態/操作）。store-surveys/index.ejs の作り（?msg= flash方式）に合わせる
- templates/flex.ts: 当選通知（回答URL付き）・落選通知を追加。既存 delivery_templates は使わず直接push（既存のassignment通知経路に倣う）
- admin researchForm.ejs: tags/ng_conditions/recruit_deadline/apply_mode/interview_format の編集欄追加（adminController.updateProjectにマッピング）
- **完了条件**: manual案件に応募→admin一覧に出る→当選操作でassignmentが発行されLINE通知が届く→やりとりdata（Phase 4で表示）に反映される

### Phase 4: LIFF UI刷新（探す/詳細/保存・Hibiデザイン）
- `public/hibi.css` 新規: mockups/base.css の t-hibi テーマ・共通部品（appbar/bell/カード/rf/バッジ/bottomnav/CTA）を移植し全LIFFページで共有
- views/liff/projects.ejs 刷新（**p51**）: チップ絞り込み（カテゴリ・即回答・pt・時間はクライアント側フィルタで開始）／イチオシヒーロー（暫定=最新1件）／報酬左カード／応募数プログレス（Phase 2のgetMonthlySummary）
- views/liff/project-detail.ejs 刷新（**p56/p73**）: apply_modeで出し分け（auto=ティールヒーロー+3カード+チャットプレビュー+「応募してすぐ回答する」／manual=p73の流れタイムライン+「応募ページに進む」）。NG条件・締切・タグ表示
- views/liff/saved-projects.ejs 刷新（**p59**）: タブ（募集中/終了）＋全カードCTA＋締切順
- getProjectsData/getProjectDetailData: 新フィールド（tags/ng_conditions/recruit_deadline/apply_mode/残枠/応募済みフラグ/月間応募数）を返すよう拡張。listDiscoverableのselectに新カラム追加＋締切切れ除外
- **完了条件**: 実機LIFFで一覧→詳細→保存が新デザインで動作・締切切れ案件が出ない・応募済み案件のボタンが「応募済み」表示

### Phase 5: 応募フローUI＋やりとり＋マイページ
- views/liff/apply.ejs 新規（**p71→確認→p62**）: 同意ゲート（getPendingGlobalConsents流用・未同意書類のみ表示）→応募確認→POST apply→結果分岐（auto: p62状態A「いますぐ回答」=survey URLへ／manual: p62状態B「選考待ち」）
- views/liff/interactions.ejs 刷新（**p61**）: 「応募中」タブ追加（listByUser: applied=選考中/accepted未完了=当選・未回答をハイライト＋回答開始CTA/rejected=落選）。withdraw導線
- views/liff/mypage.ejs 刷新（**p40**）: 残高ヒーロー（既存points-data流用）＋充実度リング（暫定=プロフィール入力率の簡易計算）＋応募状況＋メニュー接続（既存の謝礼履歴/同意/通知設定ページへ）
- **完了条件**: auto案件で 詳細→同意→応募→回答開始→完了 が一気通貫・manual案件で応募→やりとり「選考中」→(admin当選)→「当選・未回答」→回答 が通る

### Phase 6: 導線統合（LIFF 1本化＋リッチメニュー＋デイリー）
- LIFF ID統合: LINE Developersでサイト用LIFF（endpoint=`{APP_BASE_URL}/liff/projects`）を正とし、SURVEY/MYPAGE等のenvを同一IDへ。ディープリンクは既存の liff.state 展開（surveyPage実装済みの3経路展開）に乗せる
- リッチメニュー（**p82**）: さがす/おすすめ(暫定=さがす?sort=latest)/保存/やりとり/マイページ/ヘルプ の6ボタン画像＋richmenu API設定。menuActionServiceDb/liffEntrypointRepository の既存機構に登録
- 起動時デイリーインタースティシャル（**p80**）: projectsPage で「今日のアクティブなデイリーがあり・未回答・当日未スキップ」なら interstitial を表示（スキップはcookie/localStorageで当日抑制）。回答は既存 daily-survey answer APIへ、完了後に一覧へ
- デイリーバナー（**p81・確定A**）: 一覧上部に未回答時のみスリムバナー（×で当日非表示）
- 当選/新着Flexのリンク先をサイトのディープリンクへ差し替え
- **完了条件**: リッチメニュー各ボタン→サイト各タブに着地・デイリー未回答時のみ起動時1回表示＆×後はバナーのみ・通知タップ→該当ページ直行

### Phase 7（別トラック・任意）: 回答UIティール統一／おすすめ順／応募時事前設問（carry-forward後）

## ファイル別変更内容（主要）

| 種別 | パス | 変更内容 |
|---|---|---|
| 新規 | supabase/migrations/072_project_applications.sql | applicationsテーブル＋projects 5カラム |
| 修正 | src/types/domain.ts | ProjectApplication型・Project拡張 |
| 新規 | src/repositories/projectApplicationRepository.ts | 応募CRUD・当月/案件別カウント |
| 新規 | src/services/applicationService.ts | apply/withdraw/締切枠判定/auto発行 |
| 修正 | src/controllers/liffController.ts | apply系ハンドラ・data API拡張・interstitial判定 |
| 修正 | src/routes/liffRoutes.ts | POST apply/withdraw・GET apply ページ |
| 修正 | src/repositories/projectRepository.ts | listDiscoverable select拡張＋締切除外 |
| 修正 | src/controllers/adminController.ts / src/routes/adminRoutes.ts | 応募管理・researchForm新項目 |
| 新規 | src/views/admin/applications/index.ejs | 応募一覧・当選/落選操作 |
| 修正 | src/views/admin/projects/researchForm.ejs | tags/NG/締切/応募方式の編集 |
| 新規 | public/hibi.css | t-hibiテーマ共通CSS（mockups/base.cssから移植） |
| 修正 | src/views/liff/projects.ejs ほか detail/saved/interactions/mypage | p51/p56/p73/p59/p61/p40へ刷新 |
| 新規 | src/views/liff/apply.ejs | 同意ゲート→確認→完了（p71/p62） |
| 修正 | src/templates/flex.ts | 当選/落選Flex追加・リンク先差し替え |
| 新規 | src/tests/applicationService.test.ts | Phase 2の6観点 |

## 注意点

- **誤表示遮断が最優先**: apply APIにも published×public フィルタ必須（詳細ページだけに頼らない）。private_store案件への応募はentry_code経路以外404。
- **重複防止**: DB unique(project_id, line_user_id) を最終防衛線に、サービス層で409を明示。rejected後の再応募は不可（uniqueのまま）＝仕様として明記。
- **冪等性**: auto応募のassignment確保はstoreEntryServiceパターン（既存があれば再利用）を踏襲。応募ボタン連打で二重assignmentを作らない。
- **既存互換**: admin pushで直接assignmentを作る既存運用は残る（applicationレスの当選が存在しうる）。やりとり表示はassignment基準＋application情報の突合で組む。
- **既存フィクスチャ**: Projectに5フィールド追加すると既存テストのモックが落ちる（064のとき同様）→Phase 1で一括補完。
- **LIFF ID切替はPhase 6まで遅延**: それまで既存IDのまま新UIを配信でき、ロールバック容易。
- **デイリー抑制はクライアント保存**（localStorage）: サーバ側配信レコードと二重管理にしない（1日1回の再表示抑制だけが目的）。

## 完了条件（全体）

- [ ] auto案件: 一覧→詳細→同意→応募→即回答→完了→pt付与 がLIFF実機で一気通貫
- [ ] manual案件: 応募→選考中表示→admin当選→LINE通知→やりとりから回答 が通る
- [ ] 締切/満枠案件は一覧から消え、応募APIも拒否する
- [ ] 重複応募が画面・APIともに不可
- [ ] リッチメニュー6ボタン・デイリー起動時1回＋バナー再入口が動作
- [ ] `npx tsc --noEmit`・全テストpass、既存機能（店舗導線・デイリーpush・admin push配信）が無影響

---

## 実装状況（2026-07-05）

**Phase 1〜5 実装完了・E2E検証済み**（残り＝Phase 6 のLINE側設定と保存/マイページの刷新）:
- migration 072（project_applications＋projects 5カラム）/ 073（project_favorites GRANT修正）適用済み
- applicationService（apply auto/manual・withdraw・accept・reject）＋テスト10件pass・全27スイートpass
- API: POST /liff/projects/:id/apply | /withdraw、一覧/詳細/interactions data拡張（monthly_applications/tags/deadline/application_status）
- admin: /admin/applications（当選→assignment発行＋当選Flex／落選＋任意通知）・researchFormに応募方式/タグ/NG条件/募集期限/実施形式
- UI: public/hibi.css（**固定スマホ幅フレームなし・PC後付け可**）＋ projects.ejs(p51)/project-detail.ejs(p56/p73・同意ゲート/応募/選考待ち/回答開始の状態遷移内蔵)/interactions.ejs(p61・4タブ)刷新
- E2E実証: auto応募→assignment即発行→survey到達／重複409／manual応募→admin当選→assignment発行／一覧・詳細・やりとりが実DBデータで描画（スクリーンショット確認）
- 完了通知・ポイント付与は既存 runPostCompleteProcess（assignment経由）にそのまま乗る（無改修）

### Phase 6 のLINE側設定手順（コード外・運用作業）
1. **LIFF endpoint**: LINE Developers の LIFF アプリ（LINE_LIFF_ID_MYPAGE 系を正とする）の endpoint URL を `{APP_BASE_URL}/liff/projects` に変更（サイトの玄関＝探す）
2. **env統合**: `LINE_LIFF_ID_SURVEY` / `LINE_LIFF_ID_MYPAGE` / `LINE_LIFF_ID_CONTACT` を同一IDへ（フォールバック `LINE_LIFF_ID` も同値に）
3. **リッチメニュー**（p82の6ボタン）: さがす=`/liff/projects` / おすすめ=`/liff/projects?sort=latest` / 保存=`/liff/saved-projects` / やりとり=`/liff/interactions` / マイページ=`/liff/mypage` / ヘルプ=既存ガイド。すべて `https://liff.line.me/{LIFF_ID}` に liff.state でパスを載せる
4. 当選Flexは buildProjectStartUrl 経由（LIFF URL自動選択）のため追加設定不要
5. デイリーインタースティシャル（p80/p81）は次スプリント（projectsPage に「今日の未回答デイリー」判定を追加）

## Codex / Claude Code 用指示文

### Phase 1 指示文
```
docs/plan-site-implementation.md の Phase 1 を実装してください。
1) supabase/migrations/072_project_applications.sql を新規作成:
   - project_applications テーブル（id/project_id/line_user_id/respondent_id/status check(applied|accepted|rejected|withdrawn|expired) default 'applied'/assignment_id/note/applied_at/decided_at/created_at/updated_at、unique(project_id,line_user_id)、index(line_user_id,applied_at)）
   - projects に tags text[] default '{}' / ng_conditions text / recruit_deadline timestamptz / apply_mode text default 'manual' check(manual|auto) / interview_format text を追加
   - GRANT等は 064_store_survey_entry.sql の流儀に合わせる
2) src/types/domain.ts に ProjectApplication/ProjectApplicationStatus 型を追加し、Project に上記5フィールドを追加
3) 既存テストの Project フィクスチャに新フィールドを補完
完了条件: npm run db:migrate 成功、npx tsc --noEmit クリーン、npm test 全pass。
```

### Phase 2 指示文
```
docs/plan-site-implementation.md の Phase 2 を実装してください。
- src/repositories/projectApplicationRepository.ts 新規（create/findByProjectAndUser/listByUser/listByProject/updateStatus/countMonthlyByUser/countActiveByProject）
- src/services/applicationService.ts 新規。apply() は
  ①projectRepository.getDiscoverableById で公開検証（該当なしは 'not_found'）
  ②recruit_deadline 超過は 'closed'、countActiveByProject >= max_respondents は 'full'
  ③既存applicationがあれば 'duplicate'
  ④作成後 apply_mode==='auto' なら src/services/storeEntryService.ts の respondent/assignment 冪等確保パターンを流用して assignment を作り assignment_id を保存、status='accepted' で返す
  withdraw() は status==='applied' のときのみ 'withdrawn'。
- liffRoutes に POST /liff/projects/:id/apply と POST /liff/projects/:id/withdraw を追加（既存のLIFF認証ミドルウェア/検証と同じ方式）
- src/tests/applicationService.test.ts: 非公開遮断/締切/満枠/重複/withdraw条件/autoのassignment冪等 の6観点
完了条件: npx tsc --noEmit クリーン、npm test 全pass。
```

### Phase 3 指示文
```
docs/plan-site-implementation.md の Phase 3 を実装してください。
- GET /admin/applications（?project_id=フィルタ）一覧、POST /admin/applications/:id/accept（respondent/assignment確保→status='accepted'/assignment_id/decided_at 更新→当選Flexをpush）、POST /admin/applications/:id/reject（status='rejected'、通知はフォームのチェックで任意送信）
- views/admin/applications/index.ejs は views/admin/store-surveys/index.ejs の構成（?msg=/?err= flash、ヘッダーnav追加）に合わせる
- templates/flex.ts に buildApplicationAcceptedFlex（回答URL付き）/buildApplicationRejectedFlex を追加
- views/admin/projects/researchForm.ejs に tags（カンマ区切り入力）/ng_conditions/recruit_deadline/apply_mode/interview_format を追加し adminController.updateProject にマッピング
完了条件: typecheck/テストpass。手動確認手順（manual案件応募→当選→通知→assignment確認）をREADMEコメントで残す。
```

### Phase 4〜6
Phase 4以降は各Phase着手時に、上記フェーズ定義＋mockups/該当ページ（p51/p56/p73/p59→Phase4、p71/p62/p61/p40→Phase5、p80/p81/p82→Phase6）を正として同様の粒度で指示文化する。UI実装時は mockups/base.css の t-hibi テーマを public/hibi.css へ移植し、モックのDOM構造・クラス名を極力踏襲すること。
```
