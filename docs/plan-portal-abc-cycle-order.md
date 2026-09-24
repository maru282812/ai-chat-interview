# 実装計画: 会員ポータルからの ABCサイクル注文を店舗マスタ生成に乗せる

作成日: 2026-09-11 / 状態: **ACI-1 / ACI-2 / hibi-1 / hibi-2 / hibi-3 実装済み（未コミット・未デプロイ）**

> ## 実装メモ（2026-09-11）
> - migration **ACI 104** / **hibi 0018** は本番適用済み・information_schema で確認済み。
> - hibi `packages.salon_abc_cycle` は `is_active=false`（停止）＋ `aci_industry_template_id` 設定済み。
>   切替時は `is_active=true` にするだけでセット注文になる。
> - **A1〜A6 の仮定はすべて実装どおり成立**。ただし下記2点は計画と実態が違った:
>   - 平坦版で作られた案件 `p-xjqv3k` は「回答0件」ではなく **active セッション1件**・QR発行済み
>     （チケット消費済み）。close は**未実施**（稼働中の QR を殺すため運営判断）。
>   - `projects.aci_survey_id` には**部分 UNIQUE** がある。ACI の createSet が冪等なので
>     再注文で必ず衝突する → `findProjectByAciSetId` で取り込み済みを先に見る実装にした。
> - 実ブラウザ検証は `ACI_MOCK=1`（本番 DB に実データを作らない方針）で実施。
>   注文 → A/B/C 閲覧 → QR導線まで確認。**実 ACI 接続での1周（B が LINE で届く）は未実施**。
対象リポジトリ: ai-chat-interview（ACI）／hibi-site（会員ポータル）

## 実装目的

hibi-site で「美容室 ABCサイクル調査」を注文すると、ACI に A/B/C の3案件＋サイクル定義
（cycle_groups）が店舗マスタ生成（`storeProvisioningService`）で作られ、店舗が会員サイトで
QR を発行した瞬間にチケットが消費されて A/B/C がまとめて公開される。
相談が先に来たカスタム案件も、運営が ACI で作った A/B/C セットを `/ops/assignments` から
店舗に割り当てることで同じ状態に合流させる。

完成時にできること:
- 店舗: パッケージを選ぶだけで ABC が3本そろい、QR 発行1操作で調査が始まる（B/C は LINE 配信）。
- 運営: 原本（ACI プロジェクト原本）を直せば、次の注文からその内容で生成される。
  hibi の `packages` は展示用で、原本から展示設問を取り込める。
- 事故防止: 店舗に紐づいた案件を運営が ACI 管理画面から公開できない。公開はチケット消費とセット。

## 前提（調査済みの事実）

| 項目 | 現状 |
|---|---|
| 注文経路 | hibi `app/(member)/create/actions.ts` → `POST /api/partner/surveys` → `partnerSurveyService.createSurvey` が **案件1件** を作る。ABC の概念なし |
| パッケージ | hibi `packages.questions` は A/B/C を平坦化した展示用（`seed-salon-abc-package.mjs` が手書き）。`ticket_cost` あり |
| 店舗マスタ生成 | ACI `storeProvisioningService.provisionStore` が業種テンプレ（`industry_templates` → 原本3案件）から A/B/C＋cycle_groups＋C→A 持ち越しを生成。**生成と同時に published** にする |
| 店舗の対応 | ACI `stores` は `clients` 配下の運営マスタ。hibi の店舗 ID は `projects.partner_store_id`（別軸）。stores ↔ hibi 店舗の対応列は無い |
| チケット | hibi `lib/qr.ts issueQr` が consume（QR発行1枚）→ ACI publish の順。運営が publish しても消費されない |
| 相談経路 | hibi requests（新規→対応中→成約→見送り）。成約後は運営が ACI で作り `/ops/assignments` で割り当て（`origin: ops_assigned`, draft）。**単発1件のみ** |
| 閲覧専用 | ACI migration 103 `projects.partner_readonly` と `watchForStore` が実装済み（2026-09-10 別セッション）。readonly は PUT/publish/close が 409 |
| 回答ゲート | `storeEntryService` は published 以外を「公開中でないため回答できません」で止める＝draft のまま渡せば無料で回らない |

### 仮定（要確認）

- **A1** hibi 店舗と ACI `stores` は 1対1。ACI 側に `stores.partner_store_id` を持たせて対応する。
  法人（`clients`）はポータル店舗用に固定1件「アンケでYOTTO 会員店舗」を用意する。
- **A2** ABC の QR 発行時チケットは `packages.ticket_cost`（既定1枚）。納品依頼は従来どおり1回1枚。
- **A3** ポータル経由の A/B/C は **閲覧専用（partner_readonly=true）**。理由: パートナー設問の編集は
  4種（single/multi/free/scale）に全置換するため、B のマトリクスや A-Q11 の分岐が壊れる。
  設問変更の要望は既存の change_requests（要望欄）で受け、運営が ACI 側で直す。
- **A4** QR は A のみ発行。B/C は cycle の LINE 配信で届くので QR 不要。
- **A5** hibi の `projects.aci_survey_id` には **A の survey_id** を入れる（既存の QR・stats・結果導線を壊さない）。
  B/C は新テーブル `project_surveys` で持つ。
- **A6** 店舗コード slug は hibi の `member_no` から `m<番号>`（無ければ店舗 ID 先頭8桁）。entry_code は `m123-a` 等。

## 変更対象

| 領域 | ACI | hibi |
|---|---|---|
| DB | あり: migration 104（stores.partner_store_id、固定 client） | あり: migration 0018（packages.aci_industry_template_id、projects.aci_set_id、project_surveys） |
| API | あり: partner `survey-sets` 3本、partner-admin `industry-templates` / `survey-sets` 4本 | あり: aci-client に set 系4関数、Server Actions 変更 |
| UI | あり: 管理画面の公開ガード表示 | あり: パッケージ編集（テンプレ選択・展示設問取込）、B4 エディタの閲覧専用表示、C6 セット割り当て |
| 型定義 | domain.ts（Store, partner 型） | aci-types.ts（zod）、types.ts |

## 実装フェーズ

依存: ACI-1 → ACI-2 → hibi-1 → hibi-2 → hibi-3 → 検証。ACI-2 まで先に本番へ出してよい（hibi から呼ばない限り無害）。

### 即時対応（コード変更なし）

- hibi `packages.salon_abc_cycle` を `is_active=false` にして、切替まで平坦版の注文を止める。
- 既に作られた平坦版案件（entry_code `p-xjqv3k`「萬谷 高明 美容室 ABCサイクル調査」・回答0件）は
  ACI で close し、hibi 側 project を運営が案内のうえ削除または「見送り」扱いにする。

### Phase ACI-1: 店舗マスタ生成をポータル向けに拡張（DB＋service）

- migration `104_portal_store_link.sql`
  - `stores.partner_store_id text UNIQUE NULL`（hibi 店舗 ID。コメントで「hibi-portal の stores.id」と明記）
  - `clients` に固定行「アンケでYOTTO 会員店舗」を冪等 INSERT（固定 UUID を定数化）
  - service_role GRANT の確認（新規テーブルは無いが、既存 GRANT 一括の対象に stores が入っているか確認）
- `storeProvisioningService.provisionStore` に options を追加
  - `initialStatus: "draft" | "published"`（既定 published＝既存挙動保存）
  - `partnerStoreId?: string` → 生成した3案件すべてに `partner_store_id` と `partner_readonly=true` を付ける
  - `packageId?: string` → A 案件の `objective` に `package:<id>` を書く（hibi の枚数解決が package を引けるように）
  - `stores.partner_store_id` で既存店舗を引く `getByPartnerStoreId` を追加し、同じ hibi 店舗の再注文は
    **新しい store を作らず既存 store の案件を返す**（冪等）。ただし「2周目の再注文」は別論点（未決）
- テスト: `storeProvisioning.test.ts` に draft 生成／partner 紐づけ／再実行で増えない を追加
- 完了条件: 既存テストが全 pass、`npm run db:migrate` で本番に 104 適用、information_schema で列を確認

### Phase ACI-2: パートナー API に「セット」を追加（API）

セット = `cycle_groups` の行。所有者判定は `cycle_groups.store_id → stores.partner_store_id === X-Partner-Store-Id`。

- `src/services/partnerSurveySetService.ts`（新規）
  - `createSet({ partnerStoreId, industryTemplateId, storeName, memberNo, packageId })`
    → `provisionStore({ initialStatus:"draft", partnerStoreId, ... })` を呼び
    `{ set_id, title, surveys:[{role, survey_id, entry_code}], answer_url:null }` を返す
  - `publishSet(setId, partnerStoreId)` → 全ステップを published にする（冪等・readonly でも通す。
    partner の単発 publish が readonly を 409 にするのはそのまま）。A の answer_url を返す
  - `getSet(setId, partnerStoreId)` → 各ステップの status と設問ビュー
- `src/routes/partnerRoutes.ts` に追加
  - `POST /api/partner/survey-sets`
  - `GET  /api/partner/survey-sets/:id`
  - `POST /api/partner/survey-sets/:id/publish`
- `src/routes/partnerAdminRoutes.ts` に追加
  - `GET  /api/partner-admin/industry-templates` … id/name/industry_code と **展示用の平坦化設問**（原本3案件を
    パートナー4種へ落とす。落とせない設問は `single_choice` 扱いで選択肢を省略し `note` を付ける）
  - `GET  /api/partner-admin/assignable-survey-sets` … `stores.partner_store_id IS NULL` の cycle_groups
  - `POST /api/partner-admin/survey-sets/:id/assign` `{ store_id }` … stores.partner_store_id を書き、3案件に
    partner_store_id + readonly を付ける。既に別店舗なら 409
  - `POST /api/partner-admin/survey-sets/:id/unassign` … 回答が1件でもあれば 409
- 管理画面ガード（事故防止）
  - `adminController` の案件更新で `partner_store_id` が付いた案件を draft→published に変えようとしたら
    400 で拒否し、「会員店舗の QR 発行で公開されます」と表示。`store-surveys/index.ejs` にも同文言のバッジ
- `docs/partner-api.md` に追記。テスト: `partnerSurveySetApi.test.ts`（所有者不一致 404、publish 冪等、assign 409）
- 完了条件: テスト pass、`wrangler dev --local` で 3 ルートが curl で通る（Workers 固有事故の確認）

### Phase hibi-1: DB・型・クライアント・パッケージ管理（hibi）

- migration `0018_survey_sets.sql`
  - `packages.aci_industry_template_id text NULL`（NULL=従来の単発パッケージ）
  - `projects.aci_set_id text NULL`
  - `project_surveys(project_id uuid FK, role text check in ('entry','followup','verify'), aci_survey_id text, entry_code text, PRIMARY KEY(project_id, role))`、RLS deny-all＋force（既存表と同じ）
- `lib/aci-types.ts`: `surveySetSchema`、`industryTemplateSchema`、`CreateSurveySetInput`
- `lib/aci-client.ts`: `createSurveySet` / `getSurveySet` / `publishSurveySet` / `listIndustryTemplates`（partner-admin キーで）
- `lib/aci-mock.ts` にモック追加（テストと `ACI_MOCK` 起動用）
- `/ops/packages` フォーム: 「ACI 業種テンプレ」select（`listIndustryTemplates`）と
  「展示設問を原本から取り込む」ボタン（取込結果を `questions` テキストエリアに流し込む。保存は既存経路）
- `seed-salon-abc-package.mjs` は `aci_industry_template_id` を入れる形に直し、questions は取込結果で上書きする運用にする
- 完了条件: migration 適用、`/ops/packages` でテンプレ選択と取込が動く

### Phase hibi-2: 注文→生成→QR発行（会員側）

- `app/(member)/create/actions.ts`: `chosen.aci_industry_template_id` があれば `createSurveySet` を呼び、
  `projects` に `aci_survey_id = entry.survey_id`, `aci_set_id`, `origin: 'package'` で INSERT、
  `project_surveys` に3行 INSERT。失敗時は既存と同じくエラー表示（ACI 側は冪等なので再試行可）
- `lib/qr.ts issueQr`: `project.aci_set_id` があれば `publishSurvey` の代わりに `publishSurveySet`。
  consume が先・publish が後の順序は変えない。枚数解決は従来どおり `resolveProjectQrTicketCost`
- B4 エディタ `app/(member)/create/[projectId]/survey-editor.tsx`: `aci_set_id` があれば
  A/B/C タブの閲覧専用表示（`getSurvey` は readonly でも通る）＋「設問の変更は要望欄から」の案内。
  PUT 系ボタンは出さない（押せても ACI が 409）
- B2 回答状況: 当面 A の `getStats` のまま（セット別の集計は次段）
- 完了条件: 注文→ACI に draft 3件＋cycle_group→QR発行でチケット1枚減→3件 published→QR の A が回答できる
  →B が施術後に LINE で届く（ACI のサイクル cron を実機で1周）

### Phase hibi-3: 相談経路のセット割り当て（運営側）

- `lib/assignments.ts` に `assignSurveySetToStoreProject({ setId, storeId })` を追加。順序は既存と同じ
  「ACI assign → hibi INSERT（projects＋project_surveys）→ 失敗時 ACI unassign」
- `/ops/assignments` にセット候補セクション（`assignable-survey-sets`）と割り当てフォーム
- `/ops/requests/[requestId]` の成約後の導線に「ACI 店舗マスタで店舗を追加 → セット割り当て」のリンクを1つ
- 完了条件: 運営が ACI 店舗マスタで作った A/B/C を hibi 店舗に割り当て、店舗側で QR 発行できる

### 検証（両リポジトリ）

- ACI: `npm test`、`wrangler dev --local` で partner ルート疎通、Playwright で `/liff/store?entry_code=m123-a` が draft では拒否・published で回答できる
- hibi: `npm run typecheck`／`npm test`、実 Chrome（モバイル幅）で注文→エディタ閲覧→QR発行→残枚数減、console に Uncaught なし
- 本番: ACI 104 と hibi 0018 を適用し information_schema で確認。GRANT 漏れ確認

## ファイル別変更内容

| 種別 | リポ | パス | 変更内容 |
|---|---|---|---|
| 新規 | ACI | supabase/migrations/104_portal_store_link.sql | stores.partner_store_id、固定 client |
| 修正 | ACI | src/services/storeProvisioningService.ts | initialStatus / partnerStoreId / packageId、getByPartnerStoreId |
| 修正 | ACI | src/repositories/storeRepository.ts | getByPartnerStoreId、partner_store_id の create/update |
| 修正 | ACI | src/repositories/cycleRepository.ts | listUnassignedSets、findByStoreIds |
| 新規 | ACI | src/services/partnerSurveySetService.ts | createSet / publishSet / getSet / assign / unassign / templates |
| 修正 | ACI | src/routes/partnerRoutes.ts | survey-sets 3ルート |
| 修正 | ACI | src/routes/partnerAdminRoutes.ts | industry-templates、survey-sets 3ルート |
| 修正 | ACI | src/controllers/adminController.ts | partner 紐づけ案件の公開ガード |
| 修正 | ACI | src/views/admin/store-surveys/index.ejs | 「会員店舗の QR 発行で公開」バッジ |
| 修正 | ACI | src/types/domain.ts | Store.partner_store_id |
| 新規 | ACI | src/tests/partnerSurveySetApi.test.ts | セット API |
| 修正 | ACI | src/tests/storeProvisioning.test.ts | draft / partner 紐づけ |
| 修正 | ACI | docs/partner-api.md | セット API 仕様 |
| 新規 | hibi | supabase/migrations/0018_survey_sets.sql | packages 列、projects 列、project_surveys |
| 修正 | hibi | lib/aci-types.ts, lib/aci-client.ts, lib/aci-mock.ts | set 系 |
| 修正 | hibi | lib/types.ts | PackageRow / Project / ProjectSurvey |
| 修正 | hibi | lib/packages.ts, app/(ops)/ops/packages/* | テンプレ選択・展示設問取込 |
| 修正 | hibi | app/(member)/create/actions.ts | セット注文分岐 |
| 修正 | hibi | lib/qr.ts | publishSurveySet 分岐 |
| 修正 | hibi | app/(member)/create/[projectId]/survey-editor.tsx | 閲覧専用 A/B/C 表示 |
| 修正 | hibi | lib/assignments.ts, app/(ops)/ops/assignments/* | セット割り当て |
| 修正 | hibi | seed-salon-abc-package.mjs | aci_industry_template_id を入れる |

## 注意点

- **公開の唯一の入口を店舗の QR 発行にする**。ACI 管理画面からの公開ガード（ACI-2）を落とすと
  「無料で回る」事故がそのまま復活する。
- `provisionStore` の既定挙動（published）は変えない。運営の店舗マスタ画面は従来どおり。
- `copyProject` は display_mode 等を写さないため provisionStore が補っている。開示フラグ（設問単位の店舗開示）
  の伝播 strip も既存どおり効くことを確認する。
- パートナー PUT は readonly を 409 で拒否済み。hibi 側でボタンを隠すのは体裁で、防御線は ACI。
- ACI `stores.code_slug` は UNIQUE。hibi 店舗名変更は ACI 案件名に反映しない（手動）。
- Workers で新ルートを追加するときは `wrangler dev --local` で必ず通す（Node では出ない事故がある）。
- 2周目以降の再注文（同じ店舗で ABC をもう一度）は本計画では「既存セットを返す」だけ。周回課金はサイクルの
  納品依頼（1回1枚）で回収する前提。別料金にするなら packages 側で決める。
- 法令: チケットは前払式支払手段の整理済み（service-spec-ticket.md）。本計画で消費タイミングは変えないため追加論点なし。

## 完了条件

- [ ] hibi で ABC パッケージを注文すると ACI に draft の A/B/C＋cycle_group が作られ、店舗専用アンケート一覧に3行出る
- [ ] QR 発行でチケットがパッケージの枚数だけ減り、3案件が published になる（二度押しで再消費しない）
- [ ] 発行された QR（A）から回答でき、B が LINE で届く（実機1周）
- [ ] ACI 管理画面から partner 紐づけ案件を公開しようとすると拒否される
- [ ] 運営が店舗マスタで作った A/B/C を `/ops/assignments` から店舗へ割り当て、店舗が QR 発行できる
- [ ] `/ops/packages` で原本から展示設問を取り込める
- [ ] 両リポジトリの typecheck / test / build 緑、実 Chrome（モバイル幅）で console に Uncaught なし

## Codex / Claude Code 用指示文

### ACI-1
```
storeProvisioningService.provisionStore に options { initialStatus?: "draft"|"published", partnerStoreId?: string, packageId?: string } を追加してください。
- 既定は従来どおり published。
- partnerStoreId があれば stores.partner_store_id（migration 104 で追加）に保存し、生成する3案件すべてに partner_store_id と partner_readonly=true を付ける。
- packageId があれば entry 案件の objective に `package:<id>` を書く。
- storeRepository.getByPartnerStoreId を追加し、同じ partnerStoreId での再実行は新規 store を作らず既存店舗の案件を返す。
- migration 104: stores.partner_store_id text UNIQUE NULL、clients に固定行「アンケでYOTTO 会員店舗」を冪等 INSERT。npm run db:migrate で適用し列の存在を確認。
- storeProvisioning.test.ts に draft 生成・partner 紐づけ・再実行で増えない のテストを追加。npm test 緑。
```

### ACI-2
```
パートナー API に「セット」（= cycle_groups）を追加してください。所有者判定は cycle_groups.store_id → stores.partner_store_id が X-Partner-Store-Id と一致すること。不一致は 404。
- POST /api/partner/survey-sets { industry_template_id, title, store:{name, member_no}, package_id } → provisionStore(draft, partnerStoreId) を呼び { set_id, surveys:[{role,survey_id,entry_code}] } を返す
- GET /api/partner/survey-sets/:id
- POST /api/partner/survey-sets/:id/publish → 全ステップ published（冪等）。answer_url は entry の LIFF URL（liffService 経由）
- partner-admin: GET /industry-templates（展示用平坦化設問付き）、GET /assignable-survey-sets、POST /survey-sets/:id/assign {store_id}、POST /survey-sets/:id/unassign（回答ありは 409）
- adminController: partner_store_id が付いた案件を管理画面から published に変える操作を 400 で拒否し、store-surveys/index.ejs に「会員店舗の QR 発行で公開」バッジ。
- docs/partner-api.md に追記。partnerSurveySetApi.test.ts を追加。wrangler dev --local で curl 疎通まで確認。
```

### hibi-1
```
migration 0018: packages.aci_industry_template_id text NULL、projects.aci_set_id text NULL、project_surveys(project_id, role, aci_survey_id, entry_code) を RLS deny-all + force で追加。
lib/aci-types.ts / aci-client.ts / aci-mock.ts に createSurveySet / getSurveySet / publishSurveySet / listIndustryTemplates を追加（既存の request() と parseOrThrow を使う）。
/ops/packages のフォームに ACI 業種テンプレの select と「展示設問を原本から取り込む」ボタンを追加（取込結果を questions テキストエリアへ）。requireOps() を先頭で通すこと。
```

### hibi-2
```
app/(member)/create/actions.ts: パッケージに aci_industry_template_id があれば createSurveySet を呼び、projects（aci_survey_id=entry, aci_set_id, origin='package'）と project_surveys 3行を作る。
lib/qr.ts issueQr: aci_set_id があれば publishSurvey の代わりに publishSurveySet。consume→publish の順序は変えない。
survey-editor.tsx: aci_set_id があれば A/B/C の閲覧専用タブと「設問の変更は要望欄から」の案内。PUT 系 UI は出さない。
実 Chrome（モバイル幅）で 注文→エディタ→QR発行→残枚数減 を確認し、console に Uncaught が無いこと。
```

### hibi-3
```
lib/assignments.ts に assignSurveySetToStoreProject を追加（ACI assign → hibi INSERT → 失敗時 ACI unassign、既存の単発と同じ順序・監査ログ）。
/ops/assignments にセット候補セクションと割り当てフォーム。/ops/requests/[requestId] に「ACI 店舗マスタで店舗を追加 → セット割り当て」のリンクを1つ。
```
