# 設計仕様書: 企業単位の集計基盤（土台①共通指標 / 土台②client集計ルート / 移行境界）

> 位置づけ: **これは土台（データモデルと境界）を確定するための設計書**であり、機能を一気に作るための実装書ではない。
> 上物（GT整形・クロス集計・ダッシュボード・ビフォーアフター・商圏分析）は、ここで固めた土台の上に**後から順に**足す。
> 本書のゴールは「後で作り直しになる箇所（＝データの持ち方）だけを今正しく決める」こと。

## 背景と要件

- アンケでYOTTO のプラン別納品物（事実サマリー / GT / 自由回答集 / 提案書 / クロス集計 / ローデータ / ダッシュボード / ビフォーアフター / 商圏分析）を、
  **店舗専用アンケートだけでなく企業案件でも**、かつ**複数アンケートを企業単位で合算した数値**として出せるようにしたい。
- **上物（意味合算(B) / クロス集計 / ダッシュボード / ビフォーアフター / 商圏・流入軸）も最終的に全て作る。ただし実装は最後でよい**。
  今やるのは土台の確定と最初の縦切り（Slice1）だけ。上物は本土台の上に**作り直しゼロ**で乗る設計にする（§確定ロードマップ参照）。
- **集計・分析の本体を「ここで内製」するか「別の集計ソフト」にするかは未定**。どちらに転んでも土台が無駄にならない形にしておく。
- 最初は店舗専用アンケートのみで運用開始。最終的に最高の状態へ育てられる基盤にする。

### この設計が守る不変条件（Invariants）

1. **移行境界 = 統計エクスポート層**。集計本体を内製にしても別ソフトにしても、消費する入力は
   [statExport.ts](../src/lib/statExport.ts) が出す wide / long / codebook（RFC4180+BOM）に統一する。→ ロックインを作らない。
2. **合算を可能にする唯一の鍵 = 共通指標コード（metric_code）**。設問文はアンケートごとに違うので単純合算できない。
   各設問に「意味の共通コード」を貼れる仕組みだけは最初から持つ。
3. **集計のルートは project ではなく client（企業）へ開く**。将来のエリア/流入経路も同じ「group by 軸の差し替え」で拡張する。
4. **後方互換**。既存の回答フロー・CSV・analysis 画面・statExport を1バイトも壊さない。追加は全て任意フィールド。

---

## 用語・データモデル

### 土台①　共通指標コード（canonical metric）

複数アンケートを横断して「同じ意味の数値」として集計するための語彙。設問に**任意で1つ**貼る。

置き場所は既存の [QuestionMeta](../src/types/domain.ts#L520)（= `question_config.meta`）。**DBマイグレーション不要**（JSONB拡張）。

```ts
// src/types/domain.ts QuestionMeta に追加
export interface QuestionMeta {
  // ...既存...
  /** 共通指標コード。複数アンケート横断の合算・比較の突き合わせキー。任意。 */
  metric_code?: string;      // 例: "satisfaction" | "revisit_intent" | "nps" | "awareness_channel"
  /** 指標の集計方向。ランキング/ビフォーアフターでの良し悪し判定に使う。任意。 */
  metric_direction?: "higher_is_better" | "lower_is_better" | "neutral";
}
```

**共通指標コードの初期語彙（マスタ）** — `src/lib/metricCatalog.ts`（新規・純データ＋バリデータ）に定義する。
コードは**固定の enum ではなく「推奨カタログ＋自由入力可」**とする（新種の指標を運用で足せるように）。

| metric_code | ラベル | 既定 direction | 想定設問型 | 用途例 |
|---|---|---|---|---|
| `satisfaction` | 満足度 | higher_is_better | 単一選択(尺度)/数値 | GT・企業横断平均・ランキング |
| `revisit_intent` | 再来店意向 | higher_is_better | 単一選択(尺度) | 企業横断・ビフォーアフター |
| `nps` | NPS（推奨度） | higher_is_better | 数値(0-10) | 企業横断・店舗間比較 |
| `awareness_channel` | 認知経路 | neutral | 単一/複数選択 | 商圏・流入分析の素地 |
| `visit_frequency` | 来店頻度 | neutral | 単一選択 | クロス集計の属性軸 |
| `price_evaluation` | 価格評価 | higher_is_better | 単一選択(尺度) | GT・提案書 |

> カタログはあくまで推奨。`metric_code` に未知の文字列を入れても保存でき、`[a-z0-9_]+` のみ許可（バリデータで正規化）。
> ラベルはカタログにあればカタログ優先、無ければ「そのコード名」を表示。

### 土台②　集計ルート（aggregation scope）

集計単位を **project 固定から可変軸へ開く**。今回作るのは `client` 軸のみ。将来軸は同じインターフェイスに追加する。

```ts
// src/lib/aggregationScope.ts（新規・型と純関数）
export type AggregationScope =
  | { kind: "project"; project_id: string }
  | { kind: "client"; client_id: string };   // ← 今回追加する軸
// 将来: { kind: "area"; area_code } | { kind: "channel"; entry_code } を同じ union に足すだけ
```

- `client` 軸の対象 project 集合 = `projects.client_id = :client_id`（`client_id` は既存カラム。[Project.client_id](../src/types/domain.ts#L319)）。
- 「合算」は**2レベル**に分けて定義し、実装難易度で段階を分ける:
  - **(A) 件数系の単純合算**（respondent_count / completed_session_count / 回答数）＝ 各 project の集計を足すだけ。**今回のSlice1で出す**。
  - **(B) 共通指標の意味合算**（同一 `metric_code` の設問を横断して度数分布・平均を合成）＝ 土台①が効く。**将来Slice**。設問の値ラベルが揃わない場合の突き合わせは codebook の値ラベル整合を前提とする（別途「指標の値写像」を要する場合は将来課題として本書§将来課題に記載）。

### 土台③　移行境界（migration boundary）の明文化

```
[回答データ(DB)] → statExport.ts → wide.csv / long.csv / codebook.csv (RFC4180+BOM)
                                        │
                                        ├─→ 内製集計（本アプリ内の集計サービス）
                                        └─→ 外部集計ソフト（別実装・将来）
```

- **契約**: 外部ソフトに渡す/内製が読むデータは、上記3ファイルのスキーマ（列＝送付時マスター順・多重選択one-hot・欠損センチネル）を**唯一の正**とする。
- 内製集計を実装する場合も、可能な限り**この3ファイル相当の中間表現を経由**して集計する（直接SQLで独自集計を積み上げない）。
  → こうすると「内製 → 別ソフト」への移行時に集計ロジックの意味がズレない。
- `metric_code` は codebook.csv に**列を1本追加**して外部へも受け渡す（下記DB/エクスポート差分参照）。

---

## スコープ

### 今回（土台確定＋Slice1）で作るもの

1. **型の追加**（`QuestionMeta.metric_code` / `metric_direction`）＋ `metricCatalog.ts`（純データ＋バリデータ＋テスト）。
2. **設問編集フォームに「共通指標」セレクト**を追加（カタログ候補＋自由入力）。保存パース。
3. **codebook / statExport に metric 列を追加**（後方互換・列追加のみ）。
4. **企業ごとまとめ画面 `GET /admin/clients/:id/overview`**（Slice1）:
   - client 情報＋配下 project 一覧。
   - 件数系の単純合算(A)（合計 respondent数 / 完了数 / 回答数）。
   - 各 project の納品物リンク（analysis / 統計エクスポート5種）。
   - 各 project に設定済みの `metric_code` の一覧表示（＝「この企業で横断集計できる指標」の可視化。合算値そのものは将来Slice）。

### 今回作らないもの（確定ロードマップ＝いずれ全て作る。実装は最後。§確定ロードマップ で作り直しゼロを保証）

- GT整形出力 / クロス集計ロジック / リアルタイムダッシュボード。
- 共通指標の意味合算(B)の実集計・店舗間ランキング・ビフォーアフター期間比較。
- 商圏(area)/流入(channel)軸（`AggregationScope` に足せる形だけ用意し、実装はしない）。
- 別集計ソフトそのもの。

これらは「やらない」ではなく「後でやる」。ただし後で作り直しにならないよう、**土台段階で“場所の予約”が要る箇所だけは今入れておく**（下記ロードマップの★印）。

---

## 画面

### 1. 管理: 設問作成/編集フォーム [formV3.ejs](../src/views/admin/questions/formV3.ejs)

- 既存メタ（research_goal 等）の近くに **「共通指標（横断集計キー）」** セレクトを追加。
  - `<select name="metric_code">`: 先頭「（なし）」＋ `metricCatalog` の候補。末尾に「その他（自由入力）」→ テキスト入力表示。
  - 併設 `<select name="metric_direction">`: なし / 高いほど良い / 低いほど良い / 中立。カタログ既定を初期選択。
  - ヘルプ文: 「複数アンケートを企業単位で合算・比較するための共通キーです。満足度など同じ意味の設問に同じコードを付けてください。」
- 初期値: `question.question_config.meta.metric_code` / `metric_direction` を反映。
- 状態: 未設定でも保存可（任意）。

### 2. 管理: 企業ごとまとめ画面（新規）[clients/overview.ejs](../src/views/admin/clients/overview.ejs)

- ヘッダー: client 名 / contact。
- **合算サマリー（件数系(A)）**: 配下 project 数 / 合計回答者数 / 合計完了数 / 合計回答数（各 project の既存 count を合算）。
- **配下アンケート一覧テーブル**: project名 / status / visibility_type / 回答者数 / 完了数 / 納品物リンク（`/admin/projects/:id/analysis`, 統計エクスポート）。
  - 並び順は **`created_at` 昇順**（★予約③＝将来の wave 列を差し込める自然順）。列構成は将来「シリーズ / 回」列を左に挿入できる形にしておく。
- **横断集計できる指標一覧**: 配下 project の設問から `metric_code` を集めて重複排除表示（コード / ラベル / 使っている project 数）。
  - 将来Slice(B)で、ここが「指標を選ぶと企業横断の度数/平均を出す」入口になる（今回はリンク先未実装のため一覧表示のみ）。
- 導線: store-surveys 画面の client 行、および管理ヘッダー nav の「企業一覧」（後述）からリンク。

### 3. 管理: 企業一覧（軽微・任意）

- `GET /admin/clients` 一覧（clientRepository.list）→ 各行から overview へリンク。
  - 既に store-surveys 内に clients CRUD があるため、**最小実装は overview へのリンク追加のみ**でもよい（新規一覧画面は任意）。

---

## API / Server Actions

| メソッド/パス | ハンドラ | 用途 | 認可 |
|---|---|---|---|
| `GET /admin/clients/:id/overview` | `adminController.clientOverview`（新規） | 企業まとめ画面 | 既存の管理者ガード |
| `GET /admin/clients`（任意） | `adminController.clientsIndex`（新規・任意） | 企業一覧 | 同上 |
| 既存 `POST .../questions`（作成/更新） | `adminController`（追記） | metric_code/direction の保存パース | 同上 |

- `clientOverview` の集計は**既存リポジトリの再利用**で組む:
  - `clientRepository.getById(id)`
  - `projectRepository.listByClient(client_id)`（新規・`client_id` で絞る薄いメソッド）
  - 各 project の respondent/完了/回答数は既存 count 系（analysis で使っている `dataset` 由来のもの）を流用。
  - 指標一覧は各 project の questions から `question_config.meta.metric_code` を収集（純関数 `collectClientMetrics(projects, questionsByProject)` を `aggregationScope.ts` に置きテスト）。

---

## DB

**マイグレーション不要**（全て JSONB 拡張と既存カラムの利用）。

| テーブル | カラム | 型 | 制約 | 用途 |
|---|---|---|---|---|
| questions | question_config.meta.metric_code | string(JSON) | 任意・`[a-z0-9_]+` | 共通指標コード |
| questions | question_config.meta.metric_direction | string(JSON) | 任意・enum | 良し悪し方向 |
| projects | client_id | uuid | 既存 | 企業集計ルート（既存） |
| clients | (既存) | – | 既存 | 企業マスタ（既存） |

### エクスポート差分（後方互換・列追加のみ）

- **codebook.csv** に `metric_code` / `metric_direction` 列を追加（値が無い設問は空欄）。
- wide/long は列構成を変えない（respondent軸・回答軸のため）。metric は codebook 側の変数定義として持たせ、外部ソフトが codebook をキーに突き合わせる。

## 権限

| 操作 | 管理者 | 回答者(LIFF) |
|---|---|---|
| metric_code の設定 | ○ | × |
| 企業まとめ画面の閲覧 | ○ | × |

RLS方針: 変更なし。clients/projects/questions は既存の管理者権限を踏襲。

---

## 確定ロードマップ（全て作る・実装は最後）と「作り直しゼロ」の保証

上物は全て実装対象。下表は **各Sliceが本土台の何に乗るか** と **後で作り直しにならないか（＝今“予約”が要るか）** を明示する。
「今の予約」が空欄のものは、土台に手を入れず後から純粋に足せる（rework無し）。★は**今のうちに場所だけ予約する**もの。

| 将来Slice | 乗る土台 | 追加で要るもの（実装時） | 今の予約（rework回避） |
|---|---|---|---|
| GT整形出力 | 既存 statExport / codebook | 整形・帳票化のみ | 不要（純追加） |
| クロス集計 | wide/long ＋ metric_code | 設問×属性のクロス計算（純関数） | 不要（純追加） |
| 意味合算(B)・店舗間ランキング | metric_code ＋ client集計ルート | 度数/平均の合成・並べ替え | ★**値写像の枠**（下記） |
| リアルタイムダッシュボード | client集計ルート ＋ metric定義 | 集計の即時読取り経路 | ★**定義の一元化ルール**（下記） |
| ビフォーアフター（期間比較） | client集計ルート ＋ metric_code | 改善前後の突き合わせ計算 | ★**project間ペア/世代の予約**（下記） |
| 商圏(area)/流入(channel)軸 | `AggregationScope` union | project へエリア/経路属性 | 不要（union＋属性を後付け） |
| 別集計ソフト連携 | 移行境界（エクスポート3ファイル） | pull/push 出力口 | 不要（境界が既に契約） |

### ★予約①　意味合算(B)の値写像（reserve、実装は最後）

同一 `metric_code` でも選択肢の値・尺度点数がアンケート間で異なる場合の正規化（例: 5件法↔7件法、「満足」の得点割当）。
土台段階では**キーの居場所だけ予約**し、実装しない。`QuestionMeta` に将来 `metric_value_map?: Record<string, number>` を足せる形にしておく
（`cleaning` と同じ JSONB 追加方式なので**マイグレーション不要で後付け可能＝rework無し**）。今回はフィールドを**作らない**（予約の明文化のみ）。

### ★予約②　metric/scope 定義の一元化ルール（consistency、今から適用）

リアルタイムダッシュボードは性能上、エクスポートCSVを介さず**DBを直接読む経路**になり得る。そのとき集計の意味が二重定義になると危険。
そこで**ルールを今から固定**する: 「どの経路（CSV経由/DB直読）で集計しても、**指標の意味は `metricCatalog.ts`、集計軸は `aggregationScope.ts` の定義を唯一の正とする**」。
ダッシュボードはこの2ファイルを import して集計する（独自に指標や軸を再定義しない）。→ 実装コード追加は最後だが、**設計原則は今確定**。

### ★予約③　project 間のペア/世代（survey series）— ビフォーアフターの土台

ビフォーアフターは「企業内でアンケートA(改善前)とB(改善後)を**同じ調査の別時点**として結ぶ」必要がある。
`client_id` は企業でまとめるだけで**順序・ペアは表せない**ため、これは後付けだと既存 project 群の関連付け直しになりやすい＝**唯一の実質的 rework リスク**。
そこで**概念だけ予約**する（今回フィールドは作らない・実装しない）:

- 将来 `projects.survey_series_code text`（同一シリーズを束ねる自由コード）＋ `projects.wave int`（第何回＝時点順）を足す想定。
- これで「同一 series を wave 順に並べ、同一 metric_code をビフォーアフター比較」できる。
- **今回の予約行為**: 企業まとめ画面(Slice1)の配下一覧を **`created_at` 昇順（=将来の wave 相当の自然順）** で並べておき、後で series/wave 列を差し込める列構成にしておく。DB変更はしない。

> つまり rework 回避のために今やるのは、③の「並び順と列構成を将来のwave挿入に耐える形にする」＝**コード上の小さな配慮のみ**。DB・機能追加は一切しない。

### 別集計ソフト連携（将来選択）

エクスポート3ファイル＋codebookの metric 列を契約に、pull（管理画面DL）or push（バッチ出力）を将来選択。移行境界が既に契約なので土台変更は不要。

---

## 受け入れ条件（今回：土台＋Slice1）

- [ ] `QuestionMeta` に `metric_code` / `metric_direction` が追加され、設問編集で選択・自由入力・保存・再表示できる。
- [ ] `metricCatalog.ts` に推奨語彙とラベル解決・コード正規化バリデータがあり、テストが pass。
- [ ] 未知の metric_code（自由入力）も `[a-z0-9_]+` に正規化して保存できる。metric 未設定の既存設問は挙動不変。
- [ ] codebook.csv に `metric_code` / `metric_direction` 列が増える（未設定は空欄）。wide/long の既存列は不変。
- [ ] `GET /admin/clients/:id/overview` が client 情報・配下 project 一覧（`created_at` 昇順＝★予約③）・件数系合算(A)・納品物リンク・横断指標一覧を表示する。
- [ ] 配下 project が0件の企業でも 500 にならず「アンケート未紐付け」を表示する。
- [ ] `projectRepository.listByClient` / `collectClientMetrics` に純関数テストがある。
- [ ] 既存の analysis 画面・statExport 5種・回答フローが一切変わらない（後方互換）。
- [ ] `npx tsc --noEmit` / `npm run lint` / 既存テストスイート + 新規テスト pass。

---

## 実装指示（AIエージェント向け・今回分）

### 実装順序

1. **型** [src/types/domain.ts](../src/types/domain.ts): `QuestionMeta` に `metric_code?: string` / `metric_direction?: "higher_is_better"|"lower_is_better"|"neutral"` を追加。
2. **カタログ** 新規 `src/lib/metricCatalog.ts`: 推奨指標配列（code/label/default_direction/note）＋ `normalizeMetricCode(raw): string|null`（`[a-z0-9_]+` 正規化・不正はnull）＋ `metricLabel(code): string`。`src/tests/metricCatalog.test.ts` を添える。
3. **保存パース** [adminController.ts](../src/controllers/adminController.ts) の設問作成/更新で `question_config.meta` を組む箇所に `metric_code`（normalize後・空はキー付けない）と `metric_direction` を追記。
4. **codebook** [src/lib/codebook.ts](../src/lib/codebook.ts): 変数定義に metric_code/metric_direction を含め、[statExport.ts](../src/lib/statExport.ts) の `buildCodebookRows` の列に2本追加（末尾・空欄許容）。既存テスト [statExport.test.ts](../src/tests/statExport.test.ts) の期待列を更新。
5. **集計ルート** 新規 `src/lib/aggregationScope.ts`: `AggregationScope` 型 ＋ 純関数 `collectClientMetrics(projectsQuestions): {code,label,project_count}[]`。テストを添える。
6. **リポジトリ** [projectRepository.ts](../src/repositories/projectRepository.ts): `listByClient(clientId)`（`.eq("client_id", clientId)`）を追加（`listStoreProjects` 流儀）。
7. **コントローラ** [adminController.ts](../src/controllers/adminController.ts): `clientOverview`（getById＋listByClient＋各project件数集計＋collectClientMetrics）。ルート [adminRoutes.ts](../src/routes/adminRoutes.ts) に `GET /admin/clients/:id/overview`。任意で `GET /admin/clients` 一覧。
8. **ビュー** 新規 `src/views/admin/clients/overview.ejs`（合算サマリー＋配下一覧＋指標一覧＋納品物リンク）。store-surveys の client 行から overview へのリンク追加。
9. **UI** [formV3.ejs](../src/views/admin/questions/formV3.ejs): 「共通指標」セレクト＋direction＋自由入力トグル＋初期値反映。

### 規約

- 追加フィールドは全て**任意**。未設定時は `meta` にキーを付けない（既存行と JSON 互換）。
- 集計は既存 count 系・既存リポジトリを再利用し、独自 SQL 集計を新設しない（移行境界を守る）。
- 純ロジック（metricCatalog / aggregationScope）は純関数化しテスト必須。

### 禁止事項

- DBマイグレーション追加禁止（JSONB拡張と既存カラムのみ）。
- wide/long CSV の既存列順・意味を変えない（追加は codebook の列のみ）。
- analysis 画面・回答フロー・statExport の既存挙動を変えない（後方互換）。
- 意味合算(B)・クロス集計・ダッシュボード・area/channel 軸は今回実装しない（型の拡張余地だけ残す）。

### 完了確認

`npx tsc --noEmit` / `npm run lint` / 既存＋新規テスト pass、および上記「受け入れ条件」全項目。
