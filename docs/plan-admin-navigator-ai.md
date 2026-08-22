# 実装計画: 管理画面ナビゲーターAI（画面カタログ＋全画面AIチャット＋道しるべ）

作成: 2026-08-19 / 状態: 計画（未実装）
要件探索の経緯: 本計画は requirements-discovery Stage 0〜6 の承認済み回答に基づく。

## 実装目的

管理画面が機能追加の積み重ねで「どの画面に何があるか・どの設定をどこでするか」が分からなくなった。
完成時にできるようになること:

1. **全管理画面**に既存のAIチャットパネルが常駐し、その画面のデータ読み取り・操作（Tier A/B 自動、Tier C 承認カード）ができる
2. チャットに「〇〇の設定どこ？」と聞くと**候補カード（画面名/できること/URL）**が返り、クリックで**新規タブ遷移**する（道しるべ）
3. ヘッダーの**グローバル検索**で画面名・設定項目名・別名から直接飛べる（AI不使用・即時）
4. **設定の索引ページ**で「設定項目 → 画面」の逆引き一覧が見られる
5. ナビから到達不能だった7画面（stores / cycles / clients / segments-campaigns / prompt-packages-migration / quality-scoring-recent / ai-analysis-report）が解消される

これらすべての土台として**画面カタログ（コード内単一台帳）**を作り、ナビ・検索・索引・道しるべAIの4つが同じ台帳を参照する。

## 前提

### 既存の関連コード（調査済み・2026-08-19時点）

| 対象 | 場所 | 要点 |
|---|---|---|
| AIチャット本体 | `src/services/adminChat/adminChatService.ts` | ALLOWED_TIERS=["A","B"]（:34）、Tier C は承認カード（prepare→pending→approve時に再計算突合）。承認トークンはAIに渡さない |
| ツールレジストリ | `src/services/adminChat/toolRegistry.ts` | 20ツール（A=10/B=8/C=2）。`screenKeys` 空は登録時throw。`toolsForScreen()` で画面絞り込み |
| ツール実装 | `src/services/adminChat/tools/*.ts`（7ファイル） | 各ツールが `SCREENS` 配列で screenKey を直書き |
| チャットUI | `src/views/partials/ai-chat-panel.ejs` | sessionStorage会話（キー=`aiChat:{screenKey}:{entityId}`）。`footer.ejs:3-5` が `locals.aiChat` のある画面のみ include |
| チャットAPI | `POST /admin/api/ai-chat`・`/approve`（`adminRoutes.ts:162-165`、`adminController.ts:4340,4400`） | screenKey 必須・履歴8192字上限 |
| 配備済み画面 | research-form / respondent-show / sessions-index / session-show の4画面のみ（`adminController.ts:975,3603,3681,3691`） | 他69画面は未配備 |
| ナビ | `src/views/partials/header.ejs:15-76` | `navGroups` 配列を EJS 内に直書き。6グループ29項目 |
| 共通ロケール | `src/middleware/adminLocals.ts` | `currentPath` を全ビューへ配布済み（画面キー自動解決の足場になる） |
| ルート | `src/routes/adminRoutes.ts`（単一ファイル409行） | admin の GET ページ約40群 |
| 監査ログ | `admin_ai_actions` テーブル | 実装済み。screen_key/entity_id 記録あり |
| 検証 | `scripts/adminChatSmoke.mjs`（⚠本番DBに書く）、`src/tests/adminChat*.test.ts`（43件） | |

### 確定済みの要件判断（要件探索の結論）

- 利用者は実質1人（＋将来スタッフ）。**ロール制御は作らない**（後で）
- チャットは**全画面常駐・操作可**。道しるべは**候補提示→ユーザーがクリックで遷移**（自動遷移しない）。遷移は**新規タブ既定**（作業中フォーム喪失防止）
- 画面カタログは**コード内定数**（DBに置かない）。routes との**突合テスト**で陳腐化を防ぐ
- 候補0件は「無い」と正直に返す。多すぎるときは上位3〜5件＋逆質問1つ
- Web-MCP化は**今回のスコープ外**（別プロジェクト。やるなら Tier A 限定）
- 会話履歴の永続化・自律度設定・呼び出し回数上限・パンくずは**後で**

### 仮定した仕様（要確認1件）

- **Tier C（send_campaign / publish_pool_question）は全画面開放しない**。現行の screenKeys を維持し、配信オペレーション・セグメント配信画面を追加するに留める。承認カードがあっても、LINE実配信ツールをダッシュボード含む全画面へ露出させる利益がないため。
  → 全画面で使いたければ Phase 4 で `"*"` に変えるだけ（1行）。まず限定で運用開始する。

## 変更対象

| 領域 | 変更有無 | 内容 |
|---|---|---|
| DB | **なし** | migration 不要。既存 `admin_ai_pending_actions` / `admin_ai_actions` をそのまま使う |
| API | あり | `GET /admin/api/screen-search`（新規・非LLM）。既存チャットAPIは screenKey の許容範囲拡大のみ |
| UI | あり | header ナビをカタログ生成に置換＋検索ボックス / 設定索引ページ（新規）/ チャットパネルに候補カード描画 |
| 型定義 | あり | `AdminScreenEntry` 型（カタログ）、チャットレスポンスに `navigations[]` 追加 |
| その他 | なし | env・cron・Storage 変更なし |

## 実装フェーズ

依存順: **台帳 → 台帳を使うAI無し機能（検索/索引/ナビ） → チャット全画面化＋道しるべ → 既存ツール開放 → 検証**。
各 Phase は単独でデプロイ可能。Phase 1 だけでもナビ漏れ解消の価値が出る。

### Phase 1: 画面カタログ台帳＋ナビ生成＋突合テスト

- **内容**: `src/lib/adminScreenCatalog.ts` を新規作成。全 admin GET ページを1エントリずつ宣言する:

  ```ts
  export interface AdminScreenEntry {
    key: string;              // screenKey。既存4キーは現行値を維持（sessionStorage/監査ログ互換）
    path: string;             // "/admin/cycles" | "/admin/clients/:clientId/overview"
    label: string;            // ナビ・候補カードの表示名
    group: string;            // ナビのグループ（調査/回答者/報酬/配信/投稿・分析/設定/店舗）
    nav: boolean;             // ヘッダーナビに出すか（動的URL画面は false）
    description: string;      // この画面で何ができるか（1〜2文。AIの根拠テキスト）
    settings: string[];       // この画面で設定・変更できる項目（設定索引と検索の素材）
    synonyms: string[];       // 別名・言い換え（「離脱率」→cycles 等）
    related: string[];        // 関連画面の key
    dynamicParam?: { name: string; resolver: "project" | "client" | "respondent" | "session" };
  }
  ```

  - パスマッチャ `resolveScreenByPath(path): AdminScreenEntry | null` を同ファイルに実装（`:param` 対応）
  - `header.ejs` の `navGroups` 直書きを削除し、`adminLocals.ts` でカタログから `navGroups` と `currentScreen` を `res.locals` に注入。header はそれを描画するだけにする
  - 新グループ「店舗」を作り stores / cycles を載せる。clients overview は `nav:false`（動的URL）で store-surveys からの既存リンク＋道しるべ経由
  - 到達不能だった7画面をすべてカタログに収録（nav に出すか related に載せるかはエントリごと判断）
  - **突合テスト** `src/tests/adminScreenCatalog.test.ts`: ①Express router stack から `/admin` の GET ページルート（`/admin/api/*`・`.csv`・`.png`・POST を除く）を列挙し、カタログに無いパスがあれば fail ②カタログの path が実在ルートに無ければ fail ③key 重複・description 空も fail。**新画面追加時に台帳漏れをテストで落とすのが台帳鮮度の生命線**
- **依存**: なし
- **完了条件**: 全ページのナビが現行と同等以上（7画面追加）に表示され、突合テストが green

### Phase 2: グローバル検索＋設定の索引ページ（AI不使用）

- **内容**:
  - `GET /admin/api/screen-search?q=`: カタログの label/description/settings/synonyms を対象に部分一致＋簡易スコアリング（label一致 > synonyms > settings > description）。LLM 不使用・即時応答。上位8件を `{key,label,url,group,matchedOn}` で返す
  - `header.ejs` に検索ボックス追加。入力でドロップダウン候補、Enter/クリックで遷移（同タブ。ナビ操作なので新規タブにしない）。既存の交換申請バッジ fetch と同様の素朴な実装でよい
  - `GET /admin/screen-index`: 設定索引ページ。カタログから「グループ → 画面 → settings 一覧」を描画し、各行に画面リンク。ナビ「設定」グループに追加
- **依存**: Phase 1（カタログ）
- **完了条件**: 「離脱」で検索して `/admin/cycles` が出る。索引ページに全画面の settings が並ぶ
- **狙い**: AI無しで迷子の大半を解決し、かつカタログの記述品質（description/settings/synonyms）をここで実地検証してから AI に食わせる

### Phase 3: チャット全画面常駐＋道しるべツール＋候補カード

- **内容**:
  - **screenKey 自動解決**: `adminLocals.ts` で `resolveScreenByPath(currentPath)` が引けたら `res.locals.aiChat = { screenKey, entityId: null }` を既定注入。既存4画面のコントローラ明示指定（entityId 付き）はそのまま優先（`res.locals` を後勝ちにしない）。`footer.ejs` の条件は変更不要（aiChat が常に入るようになるため）
  - **チャットAPI**: screenKey バリデーションを「カタログに存在するキー」に変更。`buildSystemPrompt` に現在画面の label/description を注入（「あなたは今〇〇画面にいる」）
  - **`find_screen` ツール（Tier A・全画面）**: 引数 `query`。Phase 2 の検索ロジックを service 層で共用し、候補を返す。execute の戻り値とは別に、レスポンス封筒へ `navigations: [{label, url, description, group}]` を追加（pendingActions と同型の設計＝**URL はAIの生成文ではなくサーバー計算値**。AIがURLを捏造して誤誘導する事故を構造的に防ぐ）
  - **`resolve_entity` ツール（Tier A・全画面）**: 引数 `type`（project/client/respondent/session）と `name`。名前→ID を既存 repository で検索し、動的URL画面（clients overview 等）への遷移URLを組み立てて navigations に載せる
  - **候補カードUI**: `ai-chat-panel.ejs` に navigations 描画を追加。カードは `target="_blank" rel="noopener"`（**新規タブ既定**・作業中フォーム保護）。0件時はAIが「該当画面はありません」と返す（プロンプトで指示、無理なフォールバック禁止）。多数時は上位3〜5件＋絞り込み質問1つ（同プロンプト）
  - **ワイルドカード登録**: `toolRegistry` に `screenKeys: ["*"]` サポートを追加（`toolsForScreen` で展開）。**Tier C の `"*"` は登録時 throw**（不可逆操作の全画面露出をレジストリ層で構造的に禁止）
  - `BASE_PROMPT_TEMPLATES.adminChatCommon` に道しるべの振る舞い（候補提示・0件正直・逆質問）を追記。⚠キー数を数えるテストは過去に件数直書きで壊れた前歴あり（現在は BASE_PROMPT_TEMPLATES 突合方式に修正済み）— キーは増やさず既存 adminChatCommon の本文更新に留める
- **依存**: Phase 1（カタログ・キー体系）。Phase 2 の検索ロジック共用（Phase 2 を飛ばす場合は検索 service をここで作る）
- **完了条件**: ダッシュボード含む全画面でパネルが開き、「サイクルの設定どこ？」で cycles の候補カードが出てクリックで新規タブ遷移する

### Phase 4: 既存20ツールの screenKeys 開放

- **内容**:
  - Tier A（10本）: `screenKeys: ["*"]` に変更（読み取りはどの画面から聞かれても安全）
  - Tier B（8本）: `["*"]` に変更。ただし entityId 前提のツール（update_question 等）は「entityId が無い画面では対象IDを引数で明示させる」よう description と引数スキーマを点検・補強（誤対象への書き込み防止）
  - Tier C（2本）: 現行 screenKeys ＋ `delivery-operations` / `segments` 系の画面キーを追加。**`"*"` にはしない**（前提仮定どおり。変えたくなったら1行）
  - 実行時ガード `adminChatService.ts:173-176`（画面外ツール blocked）は現行のまま活かす
- **依存**: Phase 3（ワイルドカード対応・全画面パネル）
- **完了条件**: 任意の画面から「〇〇案件の設問一覧見せて」等が動き、Tier C はダッシュボードでは提示すらされない

### Phase 5: テスト・実機確認

- **内容**:
  - 既存 `adminChat*.test.ts` 43件の green 維持＋追加: 突合テスト（Phase 1）/ find_screen・resolve_entity / navigations 封筒 / `"*"`展開 / Tier C `"*"` throw / screen-search API
  - `scripts/adminChatSmoke.mjs` に道しるべ系の疎通を追加（⚠**本番DBに書くスクリプト**。Tier A 系のみ追加し、書き込み系は流さない）
  - 実機（Vercel preview）: 全画面でパネル表示・検索・索引・候補カード遷移をスマホ幅含め確認（モバイル既定の原則は LIFF 向けだが、管理画面もタブレット幅で崩れないことだけ確認）
- **完了条件**: 下記「完了条件」チェックリスト全消化

## ファイル別変更内容

| 種別 | パス | 変更内容 |
|---|---|---|
| 新規 | `src/lib/adminScreenCatalog.ts` | 画面カタログ本体＋`resolveScreenByPath`＋ナビ生成ヘルパ |
| 新規 | `src/services/adminChat/screenSearchService.ts` | 検索スコアリング（API・find_screen 共用） |
| 新規 | `src/services/adminChat/tools/navigationTools.ts` | `find_screen` / `resolve_entity`（Tier A・`"*"`） |
| 新規 | `src/views/admin/screen-index/index.ejs` | 設定の索引ページ |
| 新規 | `src/tests/adminScreenCatalog.test.ts` | routes 突合・key 重複・記述必須 |
| 新規 | `src/tests/adminChatNavigation.test.ts` | find_screen / navigations / `"*"` / Tier C throw |
| 修正 | `src/middleware/adminLocals.ts` | navGroups・currentScreen・aiChat 既定注入 |
| 修正 | `src/views/partials/header.ejs` | navGroups 直書き削除→locals 描画・検索ボックス追加 |
| 修正 | `src/views/partials/ai-chat-panel.ejs` | navigations 候補カード描画（新規タブ） |
| 修正 | `src/services/adminChat/toolRegistry.ts` | `"*"` 展開・Tier C `"*"` 禁止 |
| 修正 | `src/services/adminChat/adminChatService.ts` | navigations 封筒・system prompt へ現在画面情報 |
| 修正 | `src/services/adminChat/registerTools.ts` | navigationTools 登録 |
| 修正 | `src/services/adminChat/tools/*.ts`（7ファイル） | SCREENS を `"*"`／Tier C は画面追加 |
| 修正 | `src/controllers/adminController.ts` | screen-search / screen-index ハンドラ・チャットAPIの screenKey 検証差し替え |
| 修正 | `src/routes/adminRoutes.ts` | `GET /admin/api/screen-search`・`GET /admin/screen-index` |
| 修正 | `src/public/styles.css` | 検索ドロップダウン・候補カード・索引ページ |
| 修正 | （BASE_PROMPT_TEMPLATES 内）`adminChatCommon` | 道しるべ振る舞いの追記（キー追加はしない） |
| 修正 | `scripts/adminChatSmoke.mjs` | 道しるべ疎通（読み取りのみ） |

## 注意点

- **既存4画面の screenKey 値を変えない**: sessionStorage 会話キーと `admin_ai_actions.screen_key` の監査履歴が screenKey に紐づく。カタログの key は既存値を正とする
- **URL はサーバー計算値のみ**: 候補カードの URL を AI の生成テキストから拾わない。navigations 封筒（pendingActions と同じ思想）に限定
- **プロンプトインジェクション**: 全画面開放でツール結果に載る自由記述（回答テキスト等）の露出面が増える。既存ルール（`impl-admin-ai-chat.md:138`）維持＋`adminChatInjection.liveeval.mts` を Phase 5 で再実行
- **Tier C は `"*"` 禁止をレジストリ層で throw**: 規約でなく構造で守る（screenKeys 空 throw と同じ思想）
- **`res.locals.aiChat` の優先順位**: middleware 既定 → コントローラ明示（entityId 付き）が上書き、の順を崩さない。render 引数の `aiChat` が locals より優先されることを確認
- **header.ejs のコメント資産**: :11-14 の「以前リンク無しだった画面」の経緯コメントはカタログ側へ移設して残す
- **navGroups 描画変更は全73ビューに効く**: Phase 1 デプロイ時に主要画面の目視確認を行う
- **`adminChatSmoke.mjs` は本番DBに書く**: 追加分は読み取り系のみ。書き込み検証はローカル＋テストで行う
- ロール制御・自律度設定・会話永続化・回数上限・Web-MCP は**やらない**（要件探索で「後で/対象外」確定）

## 完了条件

- [ ] 突合テスト: admin の全 GET ページルートがカタログに存在（テスト green）
- [ ] ナビ: stores / cycles / segments-campaigns / prompt-packages-migration / quality-scoring-recent / ai-analysis-report がヘッダーから到達可能、clients overview は道しるべ/関連リンクで到達可能
- [ ] 検索: 「離脱」→ cycles、「配信」→ 配信系複数、が上位に出る
- [ ] 索引: `/admin/screen-index` に全画面の設定項目が画面リンク付きで並ぶ
- [ ] チャット: 全画面でパネルが開く（dashboard 含む）
- [ ] 道しるべ: 「〇〇の設定どこ？」→候補カード→クリックで**新規タブ**遷移。該当なしは「無い」と返る
- [ ] resolve_entity: 「（企業名）のまとめ画面」→ clients overview の実URLカード
- [ ] Tier A/B ツールが任意画面で動作、Tier C は配信系画面以外で提示されない
- [ ] 既存テスト43件＋新規テストが green（⚠全体並列実行の偽陽性13件は既知・1本ずつ流す）
- [ ] adminChatInjection.liveeval で挙動劣化なし

## Codex / Claude Code 用指示文

### Phase 1 指示文

```
c:\work\ai-chat-interview で作業。docs/plan-admin-navigator-ai.md の Phase 1 を実装する。

やること:
1. src/lib/adminScreenCatalog.ts を新規作成。AdminScreenEntry 型（計画書参照）で
   src/routes/adminRoutes.ts の全 admin GET ページ（/admin/api/*・.csv・.png・POST除く）を
   1画面1エントリで宣言。key は既存AIチャット4画面（research-form / respondent-show /
   sessions-index / session-show）の現行値を必ず維持。description（できること1〜2文）・
   settings（設定できる項目）・synonyms（言い換え）を全エントリで埋める。
   グループは既存6つ＋新設「店舗」（stores / cycles / store-surveys を移す）。
   resolveScreenByPath(path)（/:param 対応）と buildNavGroups() も同ファイルに実装。
2. src/middleware/adminLocals.ts で buildNavGroups() と
   resolveScreenByPath(currentPath) の結果を res.locals.navGroups / currentScreen に注入。
3. src/views/partials/header.ejs の navGroups 直書き（15-76行）を削除し locals 描画に置換。
   :11-14 の経緯コメントは adminScreenCatalog.ts に移設して残す。表示は現行と同等
   （グループ化ドロップダウン・is-active ハイライト・交換申請バッジ維持）。
4. src/tests/adminScreenCatalog.test.ts: Express router stack から adminRoutes の
   GET ページを列挙しカタログと双方向突合（漏れ/幽霊/key重複/description空で fail）。

やらないこと: チャット関連・検索・索引には触れない。DB変更なし。
完了条件: 全画面でナビ表示が現行同等＋7画面追加、突合テスト green、npm test（1本ずつ）green。
```

### Phase 2 指示文

```
docs/plan-admin-navigator-ai.md の Phase 2。Phase 1 マージ済みが前提。

1. src/services/adminChat/screenSearchService.ts: searchScreens(q) を実装。
   カタログの label > synonyms > settings > description の順でスコアリング、上位8件。
2. GET /admin/api/screen-search?q= を adminRoutes/adminController に追加（認証は既存
   adminAuthMiddleware 配下）。{key,label,url,group,matchedOn}[] を返す。
3. header.ejs に検索ボックス（入力→fetch→ドロップダウン候補→クリックで同タブ遷移）。
   既存の pending-count fetch と同程度の素朴な実装でよい。styles.css に最小限のCSS。
4. GET /admin/screen-index（設定索引ページ）: カタログから グループ→画面→settings を
   描画、各行に画面リンク。ナビ「設定」グループに追加（カタログにエントリ追加）。

完了条件: 「離脱」検索で /admin/cycles がヒット。索引ページ表示。テスト green。
```

### Phase 3 指示文

```
docs/plan-admin-navigator-ai.md の Phase 3。Phase 1-2 マージ済みが前提。

1. adminLocals.ts: resolveScreenByPath が引けたら res.locals.aiChat =
   {screenKey, entityId: null} を既定注入。既存4画面のコントローラ明示（entityId付き）が
   優先されること（render 引数 > locals）を必ず確認・テスト。
2. adminController.aiChatApi: screenKey 検証を「カタログに存在するキー」へ差し替え。
3. adminChatService.buildSystemPrompt: 現在画面の label / description を注入。
4. toolRegistry: screenKeys ["*"] サポート（toolsForScreen / isRegisteredScreen で展開）。
   Tier C で "*" は登録時 throw（テスト必須）。
5. tools/navigationTools.ts 新規: find_screen（query→searchScreens 共用）と
   resolve_entity（type+name→既存repositoryでID検索→動的URL組み立て）。両方 Tier A・"*"。
   ツールの execute 戻り値とは別に、AdminChatResponse へ navigations:
   {label,url,description,group}[] を追加（pendingActions と同様、URLはサーバー計算値のみ。
   AI生成テキストからURLを拾わない）。
6. ai-chat-panel.ejs: navigations を候補カードとして描画。target="_blank" rel="noopener"。
7. BASE_PROMPT_TEMPLATES.adminChatCommon 本文に追記: 場所質問には find_screen を使う/
   候補0件は「該当画面はありません」と正直に/多数時は3〜5件＋絞り込み質問1つ。
   ⚠新キーは追加しない（キー数突合テストへの影響を避ける）。

完了条件: dashboard 含む全画面でパネルが開き、「サイクルの設定どこ？」で cycles の
候補カードが出て新規タブで遷移。既存4画面の sessionStorage 会話キーが変わっていない。
```

### Phase 4 指示文

```
docs/plan-admin-navigator-ai.md の Phase 4。Phase 3 マージ済みが前提。

1. tools/ 配下7ファイルの SCREENS: Tier A 10本と Tier B 8本を ["*"] へ。
   Tier B のうち entityId 前提ツール（update_question / reorder_questions 等）は、
   entityId が null の画面では対象IDを引数で明示させるよう description と
   parameters を点検・補強（誤対象書き込み防止）。
2. Tier C 2本（publish_pool_question / send_campaign）: "*" にせず、
   現行 screenKeys ＋ delivery-operations / segments 系の画面キーを追加。
3. adminChatService の実行時ガード（画面外ツール blocked）は変更しない。

完了条件: 任意画面から Tier A/B が動作、Tier C はダッシュボードで提示されない。
adminChat*.test 全 green（1本ずつ実行）。adminChatInjection.liveeval 再実行で劣化なし。
```

### Phase 5 指示文

```
docs/plan-admin-navigator-ai.md の Phase 5（検証）。

1. 新規テスト: adminChatNavigation.test.ts（find_screen / resolve_entity / navigations /
   "*"展開 / Tier C "*" throw / screen-search API）。
2. scripts/adminChatSmoke.mjs に道しるべ疎通を追加（⚠本番DBに書くため読み取り系のみ）。
3. Vercel preview で実機確認: 完了条件チェックリスト（計画書参照）を全消化。
   タブレット幅でヘッダー検索とパネルが崩れないことも確認。
```
