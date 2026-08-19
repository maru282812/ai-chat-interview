# Phase Status: 管理画面ナビゲーターAI（画面カタログ＋全画面AIチャット＋道しるべ）

指示書: docs/plan-admin-navigator-ai.md / 対象repo: c:\work\ai-chat-interview
ゲート: `npx tsc --noEmit` → 関連テストを **1本ずつ** `npx tsx src/tests/<name>.test.ts`
（⚠ `npm test` は7スイートしか流さない・全体並列は偽陽性13件の前歴あり）

## Phases

| # | 名前 | 状態 | ゲート | 更新 |
|---|------|------|--------|------|
| 1 | 画面カタログ台帳＋ナビ生成＋突合テスト | done | green | 2026-08-19 |
| 2 | グローバル検索＋設定索引ページ（AI不使用） | done | green | 2026-08-19 |
| 3 | チャット全画面常駐＋道しるべツール＋候補カード | done | green | 2026-08-19 |
| 4 | 既存20ツールの screenKeys 開放 | done | green | 2026-08-19 |
| 5 | テスト追加・検証（実機確認は人手） | done（実機確認のみ人手待ち） | green | 2026-08-19 |

## 確定した決定 / 前提（後フェーズが依存）

- **ユーザー承認済みの判断（2026-08-19）**:
  - Tier C（send_campaign / publish_pool_question）は **計画どおり限定**。`"*"` にしない。
    レジストリ層で Tier C の `"*"` は登録時 throw（構造で守る）。
  - Phase 1〜5 すべて自走。ただし Phase 5 の Vercel preview 実機確認は人手に残す。
- **DB変更なし**（全フェーズ）。migration を作らない。
- **既存4画面の screenKey 値を変えない**: `research-form` / `respondent-show` /
  `sessions-index` / `session-show`。sessionStorage 会話キーと `admin_ai_actions.screen_key`
  の監査履歴が紐づくため。カタログの key は既存値を正とする。
- **URL はサーバー計算値のみ**: 候補カードの URL を AI 生成テキストから拾わない。
  `navigations` 封筒（pendingActions と同じ思想）に限定する。
- **調査で判明した現況（計画書に無い事実・Phase 1 は必ず反映すること）**:
  - `header.ejs` のナビは6グループ直書きに加え、**7つ目の動的グループ「アンケでYOTTO」**
    （`locals.portalOpsNavLinks()` 由来の外部リンク・env `PORTAL_OPS_URL` 未設定なら
    空配列でグループごと消える fail-closed）がある。**この外部リンク群はカタログの対象外**
    （admin のルートではない）。カタログ生成ナビの**後ろに現行どおり push する**形を維持する。
  - `adminRoutes` の GET ページルート（`/api/*`・`.csv`・`.png`・`/login` 除く）は約85本。
    `/admin/exchange-requests/pending-count` は JSON API なのでページ扱いしない（除外）。
  - `adminLocals.ts` は19行。`currentPath = req.baseUrl + req.path` を配布済み。
  - `toolRegistry.registerTool` は screenKeys 空 / tier 不正 / name 重複 / Tier C の
    prepare 欠落 で throw する既存ガードあり。Tier C の `"*"` 禁止はこの並びに追加する。
  - tools 配下のツール数と現行 SCREENS:
    answerTools(5) / behaviorEvidenceTools(1) = `["sessions-index","session-show","respondent-show","research-form"]`、
    dailyQueueTools(2) / deliveryTools(2) / poolQuestionTools(3) / segmentTools(3) = `["sessions-index","research-form"]`、
    questionWriteTools(4) = `["research-form"]`。
- レイヤ規約: controller → service → repository。ビューは partials 共通化。
- 禁止事項（全フェーズ共通）: 回答保存形式の変更禁止 / エクスポート列（wide/long/codebook）変更禁止 /
  `runSlot` をローカルから叩かない / `scripts/adminChatSmoke.mjs` は**本番DBに書く**ので
  追加は読み取り系のみ / `BASE_PROMPT_TEMPLATES` に**新キーを足さない**（本文更新に留める）。

## 未解決課題（重い・要人間判断）

（なし）

## フェーズ別ログ（サブが追記）

### Phase 1 — 2026-08-19
- 変更: 新規 `src/lib/adminScreenCatalog.ts`（89画面・nav:true 38）・`src/tests/adminScreenCatalog.test.ts`(21件)、
  修正 `src/middleware/adminLocals.ts`・`src/views/partials/header.ejs`・`src/tests/adminViewFoundation.test.ts`(25件)
- ゲート: `npx tsc --noEmit` 緑 / adminScreenCatalog 21pass / adminViewFoundation 25pass /
  巻き添え確認 adminCsrf 8pass・adminChatApi 9pass・adminAuthMiddleware 10pass
- 申し送り（Phase 2 以降が依存）:
  - Phase 2 の検索・索引は `ADMIN_SCREENS` の label/description/settings/synonyms をそのまま素材にできる。
  - `settings` が空なのは意図的な読み取り専用8画面のみ（テストの `readOnlyKeys` に列挙済み）。
  - `buildNavGroups()` の返す `AdminNavGroup` は `portalOpsNavLinks()` と同形 `{label,items,external?}`。
    header は両者を1ループで描画している。**この構造を壊さない**。
  - `res.locals.currentScreen` は台帳外パス（api・エクスポート）で **null**。null 前提で書く。
  - Phase 3 で screenKey を全画面開放する際、**`getScreenByKey()` が許容 key の権威**になる。
  - 拡張子無しだが `res.json` を返す4ルートは JSON API として台帳対象外（テストに `JSON_API_PATHS` で明示）。
  - `dashboard` は「調査」所属だが `nav:false`（header 冒頭の固定リンクとして別枠描画される現行構造を維持）。
  - ⚠ ナビ描画は全73ビューに効く。デプロイ時に主要画面の目視確認が必要（今回テストのみ・実機未確認）。

### Phase 2 — 2026-08-19
- 変更: 新規 `src/services/adminChat/screenSearchService.ts`・`src/views/admin/screen-index/index.ejs`・
  `src/tests/screenSearch.test.ts`(15件)、修正 `adminScreenCatalog.ts`(89→**90画面**: screen-index 追加)・
  `adminController.ts`・`adminRoutes.ts`・`header.ejs`・`styles.css`
- ゲート: tsc 緑 / screenSearch 15pass / adminScreenCatalog 21pass / adminViewFoundation 25pass / adminCsrf 8pass
- 実測: 「離脱」→ `/admin/cycles` が1位。「配信」→ 8件（delivery-operations が1位・配信グループ6件）
- 申し送り（Phase 3 が依存）:
  - `searchScreens(q: string, limit = 8): ScreenSearchResult[]` は**純関数・DB不要・await不要**。
    戻り値 `{key,label,url,group,matchedOn,matchedTerms,description,score}` は毎回新規オブジェクトなので破壊的加工可。
    tools 配下からは `import { searchScreens } from "../screenSearchService"`。
  - `navigations` 封筒へは `{label,url,description,group}` をそのまま抜くだけ。
    `url` は必ずカタログ `path` と一致（テストで担保）＝**サーバー計算値**の要件を満たす。
  - ⚠ **動的URL（`/:param`）のフィルタは呼び出し側の責務**。`searchScreens` は `/:param` 入り候補も返す
    （`resolve_entity` が ID を埋められるように意図的）。`find_screen` の候補カードでは
    `url.includes("/:")` を除外するか `resolve_entity` に回すこと。
  - 空白区切りは AND でなく **OR 加点**。該当なしは**空配列**を返す（無理なフォールバックをしない）＝
    「候補0件は正直に返す」プロンプト方針とそのまま噛み合う。
  - このリポジトリに CSP ヘッダー設定は**無い**（helmet 不使用）。header.ejs のインラインスクリプトの流儀に合わせてよい。
  - header の検索スクリプトは既存 pending-count fetch と同じ `<script>` ブロック内。
    ai-chat-panel は footer.ejs 経由なので衝突しない。

### Phase 3 — 2026-08-19
- 変更: 新規 `src/services/adminChat/tools/navigationTools.ts`・`src/tests/adminChatNavigation.test.ts`(21件)、
  修正 `src/middleware/adminLocals.ts`・`src/controllers/adminController.ts`・
  `src/services/adminChat/adminChatService.ts`・`toolRegistry.ts`・`registerTools.ts`・
  `src/views/partials/ai-chat-panel.ejs`・`src/prompts/basePromptTemplates.ts`(adminChatCommon 本文のみ)・
  `src/tests/adminChatApi.test.ts`(封筒に navigations 追加＋台帳外 key の期待値を 500→400 に更新)
- ゲート: tsc 緑 / adminChatNavigation 21pass / adminChatService 12pass / adminChatApi 10pass /
  adminChatApproval 11pass / adminChatAnswerTools 11pass / adminScreenCatalog 21pass /
  screenSearch 15pass / adminViewFoundation 25pass / promptPackagePhase6 15pass / promptPackagePhase7 8pass
- 実測: `registerAdminChatTools()` 後、dashboard で使えるのは find_screen / resolve_entity の2本のみ
  （Tier C の漏れ無し）。sessions-index は 18本（既存16＋道しるべ2）。
- 申し送り（Phase 4 が依存）:
  - `ALL_SCREENS = "*"` を toolRegistry から export 済み。Phase 4 の `SCREENS` 差し替えは
    `screenKeys: [ALL_SCREENS]` を使う（文字列リテラル `"*"` の直書きも動くが定数を推奨）。
  - 画面一致判定は **`toolMatchesScreen(tool, screenKey)` に一本化済み**。
    `tool.screenKeys.includes(screenKey)` を新たに書かないこと（`"*"` を取りこぼす）。
    adminChatService の実行時ガード（画面外ツール blocked）も既にこの関数を通っている。
  - Tier C の `"*"` は `registerTool` で throw（テスト2件で担保）。Phase 4 で Tier C に
    画面キーを追加するときは**カタログに実在する key** を使うこと（現状 registerTool は
    key の実在までは検証しない＝タイプミスは「どの画面にも出ない」で黙って死ぬ）。
  - `AdminChatResponse.navigations` は **ツールの戻り値に `navigations: [{label,url,description,group}]`
    がある場合のみ**積まれる（`navigationsOf()` が形を検証・同一URLは重複排除）。
    他のツールが偶然 `navigations` キーを返すと封筒に載るので、Phase 4 で既存20ツールの
    戻り値に `navigations` という名前のフィールドを足さないこと。
  - `find_screen` は動的URL（`/:param`）を候補カードから除外し `needs_entity` に回す実装。
    `resolve_entity` の対象画面は `ENTITY_SCREEN_KEYS`（project→research-form/questions-index/
    project-analysis、client→client-overview、respondent→respondent-show、session→session-show）。
  - `resolve_entity` は既存 repository のみ使用（project/client は `list()` 後にメモリ部分一致、
    respondent は `searchPaged`、session は `getById`）。新しい SQL 経路は作っていない。
  - middleware の既定注入は `currentScreen` が引けた画面のみ。**render 引数優先を実測テスト済み**
    （実 Express を立てて `/admin/sessions` で entityId が locals の null に勝つことを確認）。
  - ⚠ 実機確認は未（Phase 5）。全画面でパネルが出るようになったため、
    ナビ描画同様に主要画面の目視確認が要る。

### Phase 4 — 2026-08-19
- 変更: `src/services/adminChat/toolRegistry.ts`（screenKeys の実在検証を追加）・
  `tools/answerTools.ts`・`tools/behaviorEvidenceTools.ts`・`tools/dailyQueueTools.ts`・
  `tools/deliveryTools.ts`・`tools/poolQuestionTools.ts`・`tools/questionWriteTools.ts`・
  `tools/segmentTools.ts`、`src/tests/behaviorEvidenceTools.test.ts`・`src/tests/adminChatService.test.ts`
- ゲート: tsc 緑 / adminChatService 12pass / adminChatApi 10pass / adminChatApproval 11pass /
  adminChatAnswerTools 11pass / adminChatNavigation 21pass / behaviorEvidenceTools 4pass /
  adminScreenCatalog 21pass / adminAiErrorCategorization 6pass /
  巻き添え確認 screenSearch 15pass・adminViewFoundation 25pass
- 実測（`registerAdminChatTools()` 後の `toolsForScreen`）:
  dashboard 20本（Tier C ゼロ）/ points-index 20本（Tier C ゼロ）/ segments-index 20本（Tier C ゼロ）/
  delivery-operations 22本（publish_pool_question・send_campaign）/ delivery-calendar 21本（send_campaign）/
  segments-campaigns-index・segments-campaign-edit 各21本（send_campaign）/
  pool-questions-index 21本（publish_pool_question）/ sessions-index・research-form 各22本（現行維持）
- 申し送り（Phase 5 が依存）:
  - Tier A 10本・Tier B 8本は `[ALL_SCREENS]`。Tier C 2本だけが明示キー
    （send_campaign = sessions-index / research-form / delivery-operations / delivery-calendar /
    segments-campaigns-index / segments-campaign-edit、
    publish_pool_question = sessions-index / research-form / pool-questions-index /
    pool-question-edit / pool-questions-bulk / delivery-operations）。
  - **`registerTool` が screenKeys の実在をカタログで検証するようになった**（`"*"` と `test-` 始まりは除外）。
    新ツール／キー追加でタイプミスすると登録時に throw する。テストの合成ツールは
    `test-screen` / `test-screen-1` / `test-screen-2` / `test-another-screen` に統一済み（`test-` 接頭辞が escape hatch）。
  - entityId フォールバックの状況: `requireId()`（answerTools 3本）・`requireProjectId()`
    （behaviorEvidenceTools 1本 / questionWriteTools 3本）が「引数優先→ctx.entityId→throw」を通す。
    `update_question` は question_id 必須で entityId を一切見ない。dailyQueue / segment / poolQuestion の
    Tier B 5本は ctx.entityId を参照しない（対象は引数だけで決まる）。**null のまま書き込みに進む経路は無い**。
  - 案件ID前提の Tier B（create_question / reorder_questions）と get_project_questions は
    description と project_id の説明に「案件編集画面以外では project_id を必ず指定する」を追記済み。
    Phase 5 でここを検証するなら「entityId=null かつ project_id 省略で throw する」を直接テストするのが早い。
  - ⚠ `adminChatService` の実行時ガード（画面外ツール blocked）は**未変更**。Phase 3 のまま
    `toolMatchesScreen` を通っている。

### Phase 5 — 2026-08-19
- 変更: `src/tests/adminChatNavigation.test.ts`（21→**39件**・Phase 5 分18件追加）・
  `src/services/adminChat/registerTools.ts`（テスト用 `__resetRegisteredFlagForTest()` を追加）・
  `scripts/adminChatSmoke.mjs`（道しるべ疎通・**読み取り系のみ**）
- ゲート（1本ずつ・全緑）: tsc / adminChatNavigation 39 / adminChatService 12 / adminChatApi 10 /
  adminChatApproval 11 / adminChatAnswerTools 11 / adminAiErrorCategorization 6 / behaviorEvidenceTools 4 /
  adminScreenCatalog 21 / screenSearch 15 / adminViewFoundation 25 / adminCsrf 8 / adminAuth 13 /
  adminAuthMiddleware 10 / promptPackagePhase6 15 / promptPackagePhase7 8 / promptPackagePhase9 10 /
  promptPlacement 9 / `npm run build` 成功
- 追加テストの観点:
  - **Tier C の確定キー集合を固定**（send_campaign 6画面 / publish_pool_question 6画面）。
    レジストリの `"*"` throw はキーを**増やす**事故を止められないため、集合そのものを固定した。
    露出画面を変えるときはこのテストを意図的に更新すること（＝人の判断を通す関門）。
  - Tier C ゼロ画面（dashboard / points-index / segments-index）で提示すらされないこと。
  - Tier A/B が全ツール `"*"`（Phase 4 の開放が巻き戻っていない）＋ダッシュボード20本を固定。
  - **entityId=null かつ project_id 省略で create_question / reorder_questions が throw**
    （repository へ到達しないことも確認＝黙って別案件に書かない）。引数 project_id が
    画面の entityId に勝つことも実行して確認。
  - resolve_entity 6件: 不正 type / 空 name（repo を叩かない）/ 企業名→実URL（`:param` が
    ID に置換され骨格はカタログ path 由来）/ 複数一致は5件上限＋確認指示 / 一致ゼロは正直に /
    navigations 封筒への積み上がり。
  - screen-search API 4件: service と同一結果・url はカタログ path のみ・境界入力で空配列・
    LLM を呼ばない。
- `adminChatSmoke.mjs` 追加分（**読み取りのみ・新規 fetch は GET 1本だけ**）:
  - `GET /admin/api/screen-search` を3語（離脱 / 配信 / 該当なし）で叩く非LLM疎通。
    道しるべが変なときに「台帳が悪いのか AI が悪いのか」を切り分けられる。
  - Tier A チャット3ケース（find_screen ヒット / find_screen 0件 / resolve_entity）。
  - 全ケース共通で `navigations` 封筒の中身と、本文に `/admin/` の URL が混ざっていないかを表示。
- 実装の軽微な追加: `registerTools.ts` に `__resetRegisteredFlagForTest()`。
  `registered` フラグで多重登録を防いでいるため、`__resetRegistryForTest()` でレジストリを
  空にしたあと同一プロセスで本物のツール一式を再登録できなかった。テスト専用の逃がし口。
- 実測メモ: `screenSearchApi` は `?q=a&q=b`（配列）を `bodyString()` の共通挙動で
  **先頭要素だけ**見る。例外にはならず台帳外 URL も作らないので仕様として固定した（テスト済み）。
- **人間に残す作業（Phase 5 の未消化分）**:
  - Vercel preview での実機確認（全画面パネル表示・ヘッダー検索・索引ページ・候補カードの
    新規タブ遷移・タブレット幅の崩れ）。ナビ描画は全73ビューに効くので主要画面の目視が要る。
  - `src/tests/adminChatInjection.liveeval.mts` の再実行（**実LLMを叩き課金が発生する**ため未実行）。
