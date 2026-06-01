# projects.status 再設計 影響調査

> 調査日: 2026-06-01  
> 対象ブランチ: main  
> **重要: この文書は影響調査のみ。migration・実装変更は未実施。**

---

## 1. 変更後のstatus定義

| status | 意味 | 現在との対応 |
|---|---|---|
| `draft` | 下書き | 変更なし |
| `ready` | 配信待ち・公開準備完了 | **新規追加** |
| `published` | LIFF掲載中 | `active` から変更 |
| `paused` | 一時停止 | 変更なし |
| `closed` | 募集終了 | **新規追加** |
| `archived` | アーカイブ | 変更なし |

### 主な置き換え対応

```
active   → published  （最重要。コード全体に影響）
paused   → paused     （変更なし）
archived → archived   （変更なし）
draft    → draft      （変更なし）
ready               → 新規追加（配信フロー用）
closed              → 新規追加（募集終了用）
```

---

## 2. 現在のstatus利用箇所一覧

### 2-1. TypeScript ソースコード

| ファイル | 行 | 現在のコード | 用途 | 影響度 |
|---|---|---|---|---|
| `src/types/domain.ts` | 3 | `"draft" \| "active" \| "paused" \| "archived"` | ProjectStatus 型定義 | **高** |
| `src/repositories/projectRepository.ts` | 62 | `.eq("status", "active")` | `listActive()` のクエリ条件 | **高** |
| `src/repositories/projectRepository.ts` | 100 | `status: "draft"` | `copyProject()` 新規コピー時の初期値 | 低（変更不要） |
| `src/repositories/projectRepository.ts` | 115 | `status: "draft"` | `copyProject()` update時の初期値 | 低（変更不要） |
| `src/repositories/projectRepository.ts` | 171 | `project.status === "active"` | `deleteById()` 実行済判定 | **高** |
| `src/repositories/projectRepository.ts` | 203 | `.eq("status", "active")` | `listDiscoverable()` LIFF表示条件 | **高** |
| `src/repositories/adminRepository.ts` | 8 | `countByStatus("active")` | ダッシュボード稼働中案件数 | **高** |
| `src/controllers/adminController.ts` | 1843 | `as "draft" \| "active" \| "paused" \| "archived"` | プロジェクト作成時の型キャスト | **高** |
| `src/controllers/adminController.ts` | 1941 | `as "draft" \| "active" \| "paused" \| "archived"` | プロジェクト更新時の型キャスト | **高** |
| `src/controllers/liffController.ts` | 2024 | `p.status === "active"` | 保存済み案件の `is_active` フラグ | **高** |

### 2-2. EJSビュー（管理画面）

| ファイル | 行 | 現在のコード | 用途 | 影響度 |
|---|---|---|---|---|
| `src/views/admin/projects/form.ejs` | 18 | `["draft", "active", "paused", "archived"]` | status 選択肢のハードコード | **高** |

### 2-3. SQLシード・テストデータ（全て `'active'` を使用中）

| ファイル | 行 | 用途 | 影響度 |
|---|---|---|---|
| `supabase/seed.sql` | 13 | メインシードデータ | 中（要更新） |
| `supabase/schema.sql` | 681 | スキーマサンプルデータ | 中（要更新） |
| `supabase/fitness_screening_test_seed.sql` | 39 | スクリーニングテスト用 | 中 |
| `supabase/realistic_interview_project.sql` | 40 | インタビューテスト用 | 中 |
| `supabase/test_all_answer_types_ai_branch_project.sql` | 65 | 全回答形式テスト用 | 中 |
| `supabase/test_app_improvement_all_features_project.sql` | 72 | 全機能テスト用 | 中 |
| `supabase/test_breakfast_health_all_features_project.sql` | 73 | 全機能テスト用 | 中 |
| `supabase/test_choco_interview_project.sql` | 37 | インタビューテスト用 | 中 |
| `supabase/test_dog_popularity_project.sql` | 66 | 全回答形式テスト用 | 中 |
| `supabase/test_interview_cases.sql` | 121, 132, 143 | インタビューテスト用 | 中 |
| `supabase/test_interview_probe_skip_project.sql` | 42 | AI深掘りテスト用 | 中 |
| `supabase/test_interview_probe_skip_project_lunch.sql` | 45 | AI深掘りテスト用 | 中 |
| `supabase/test_interview_probe_skip_project_product_dev.sql` | 49 | AI深掘りテスト用 | 中 |
| `supabase/test_performance_vs_appearance_project.sql` | 72 | 全機能テスト用 | 中 |
| `supabase/test_spring_plans_all_features_project.sql` | 73 | 全機能テスト用 | 中 |

> **注意:** `test_dog_popularity_project.sql` の 437, 629, 893 行にも `'active'` が含まれるが、これらは**回答選択肢の value 値**（`"活発"` の英語値など）であり、`status` ではないため変更不要。

### 2-4. 影響なし（別テーブルの status）

以下は同じ `"active"` という値を使っているが、`projects.status` とは無関係。

| ファイル | 対象テーブル | 理由 |
|---|---|---|
| `src/controllers/liffController.ts:717, 761` | `sessions.status` | セッション状態管理。変更不要 |
| `src/controllers/liffController.ts:1186` | `sessions.status` | セッション状態管理。変更不要 |
| `src/controllers/liffController.ts:1699` | `daily_surveys.status` | デイリーアンケート状態。変更不要 |
| `src/services/notificationSchedulerService.ts:88` | `daily_surveys.status` | スケジューラはdaily_surveysを参照。変更不要 |
| `src/services/conversationOrchestratorService.ts:1020,1266` | `respondents.status` / `sessions.status` | 会話フロー管理。変更不要 |
| `src/services/menuActionService.ts:125,282` | `sessions.status` | セッション選択ロジック。変更不要 |
| `src/repositories/sessionRepository.ts:12` | `sessions.status` | セッション取得。変更不要 |

---

## 3. 機能別影響範囲

### ■ 案件管理画面

#### 現在の挙動
- 案件一覧: 全 status を一覧表示（フィルタなし）
- 編集画面: `draft / active / paused / archived` の4択
- 新規作成時の初期status: `draft`
- 表示ラベル: status 値をそのまま表示（英語）

#### 変更後の挙動
- 案件一覧: 変更なし（全件表示のため影響なし）
- 編集画面: `draft / ready / published / paused / closed / archived` の6択に更新
- 新規作成時の初期status: `draft` のまま（変更不要）
- 表示ラベル: 日本語ラベルの追加を検討（ready: 配信待ち、published: 掲載中、closed: 募集終了）

#### 修正ファイル
- `src/views/admin/projects/form.ejs:18` — status 選択肢の配列を更新
- `src/controllers/adminController.ts:1843, 1941` — 型キャストを更新

---

### ■ LIFF一覧

#### 現在の挙動
```sql
-- listDiscoverable() の内部条件
WHERE is_discoverable = true AND status = 'active'
ORDER BY created_at DESC
```

#### 変更後の挙動
```sql
WHERE is_discoverable = true AND status = 'published'
ORDER BY created_at DESC
```

#### 修正ファイル
- `src/repositories/projectRepository.ts:203` — `"active"` → `"published"`

---

### ■ LIFF 保存済み案件（マイページ）

#### 現在の挙動
```typescript
// liffController.ts:2024
is_active: p ? p.status === "active" : false,
```
保存済み案件が現在も公開中かどうかを `is_active` フラグで返している。LIFF 側がこのフラグを使って「現在受付中」などの表示制御をしている可能性がある。

#### 変更後の挙動
```typescript
is_active: p ? p.status === "published" : false,
```

#### 修正ファイル
- `src/controllers/liffController.ts:2024` — `"active"` → `"published"`

---

### ■ LIFF詳細（直接アクセス）

#### 現在の挙動
`getDiscoverableById()` は `is_discoverable = true` でフィルタしているが、**status フィルタがない**。

```typescript
// projectRepository.ts:209-217
async getDiscoverableById(id: string): Promise<Project | null> {
  const { data, error } = await supabase
    .from("projects")
    .select("id, name, ...")
    .eq("id", id)
    .eq("is_discoverable", true)  // ← status チェックなし！
    .maybeSingle();
```

つまり、現状でも `paused` / `archived` な案件に直接アクセスできてしまう可能性がある。

#### 変更後の推奨挙動
`published` 以外の案件に直接アクセスした場合は 404 を返すべき。

```typescript
.eq("is_discoverable", true)
.eq("status", "published")  // ← 追加推奨
```

ただし、`paused` 中の案件を「準備中」として表示させる要件があるなら別途判断が必要。

#### 修正ファイル
- `src/repositories/projectRepository.ts:209-217` — status フィルタの追加を検討

---

### ■ 自動配信

#### 現在の挙動
`notificationSchedulerService.ts` のスケジューラは `daily_surveys.status = 'active'` を見ており、**projects.status は参照していない**。

プロジェクト単位の自動配信（`ready` → `published` 遷移）は現時点では実装されていない。

#### 変更後の挙動（新設計）
自動配信対象を `ready` ステータスにする場合、新しい配信ジョブの実装が必要。

```sql
-- 新配信ジョブの対象条件（案）
WHERE status = 'ready' AND is_delivery_enabled = true
```

配信成功後:
```sql
UPDATE projects SET status = 'published' WHERE id = :project_id;
```

#### 修正ファイル
- 新規: 自動配信ジョブのロジック（現在未実装）

---

### ■ 手動配信

#### 現在の挙動
`delivery_campaigns` テーブルの存在は確認されたが、ソースコード内での `projects.status` 参照は見つからなかった。手動配信時に status を変更するロジックは現時点では未実装と思われる。

#### 変更後の検討事項
- 手動配信の対象を `ready` のみにするか、`published` も再配信できるか
- 手動配信後に `status = 'published'` に自動更新するか

#### 要確認
- `researchOpsService.ts` の実装内容（`delivery_campaigns` との連携があるか）

---

### ■ 新着案件

#### 現在の挙動
`listDiscoverable()` は `status = 'active' AND is_discoverable = true` で取得し、フロント側で `created_at` でソートして新着扱いにしていると思われる。

#### 変更後の挙動
`published` に変更後:
- `ready` の案件は LIFF に表示されない（`listDiscoverable()` が `published` のみ返すため）
- `closed` の案件も表示されない

---

### ■ セグメント

スクリーニング条件・セグメント抽出のコード（`src/services/researchOpsService.ts` 等）では `projects.status` の直接参照は確認されなかった。影響なし（要最終確認）。

---

### ■ バッジ・ポイント・集計

#### ダッシュボード
```typescript
// src/repositories/adminRepository.ts:8
projectRepository.countByStatus("active")  // → "published" に変更必要
```

ダッシュボードの「稼働中案件数」カウントが `active` を参照している。`published` に変更が必要。

#### ポイント・バッジ
セッション完了・ポイント付与のロジックは `sessions.status` と `respondents.status` に依存しており、`projects.status` への直接依存は確認されなかった。影響なし。

---

### ■ スケジューラ

#### notification_scheduler_settings / notification_templates / delivery_campaigns
`notificationSchedulerService.ts` のメインループは `daily_surveys.status = 'active'` を参照している。`projects.status` への依存なし。

#### 影響なし
スケジューラ関連コードは全て `daily_surveys` テーブルを参照しており、`projects.status` の変更による直接的な影響はない。

---

## 4. データ移行方針

### 現在のDBデータ確認クエリ

```sql
SELECT status, COUNT(*)
FROM projects
GROUP BY status
ORDER BY status;
```

現在のデータベースには CHECK 制約がないため、理論上は任意の status 値が入っている可能性がある。

### 想定されるデータ分布

| 現在の status | 想定データ | 移行先 |
|---|---|---|
| `draft` | 作業中の案件 | `draft`（変更なし） |
| `active` | 現在稼働中の案件 | `published` |
| `paused` | 停止中の案件 | `paused`（変更なし） |
| `archived` | アーカイブ済み案件 | `archived`（変更なし） |

### 移行SQL案（実行はしない）

```sql
-- Step 1: 現在のデータを確認
SELECT status, COUNT(*) FROM projects GROUP BY status ORDER BY status;

-- Step 2: active → published に変換
UPDATE projects
SET status = 'published', updated_at = NOW()
WHERE status = 'active';

-- Step 3: CHECK 制約を追加（新migration）
ALTER TABLE projects
  ADD CONSTRAINT projects_status_check
  CHECK (status IN ('draft', 'ready', 'published', 'paused', 'closed', 'archived'));
```

> **注意:** Step 2 と Step 3 は同一 migration ファイル内でトランザクションとして実行すること。順序を守らないと CHECK 制約追加が既存の `active` データで失敗する。

---

## 5. 修正が必要なファイル一覧

### 必須修正（壊れる箇所）

| ファイル | 修正内容 | 優先度 |
|---|---|---|
| `src/types/domain.ts:3` | `ProjectStatus` 型に `ready`, `published`, `closed` を追加、`active` を削除 | **最高** |
| `src/repositories/projectRepository.ts:62` | `"active"` → `"published"` | **最高** |
| `src/repositories/projectRepository.ts:171` | `project.status === "active"` → `project.status === "published"` | **最高** |
| `src/repositories/projectRepository.ts:203` | `"active"` → `"published"` | **最高** |
| `src/repositories/adminRepository.ts:8` | `countByStatus("active")` → `countByStatus("published")` | **高** |
| `src/controllers/adminController.ts:1843` | 型キャストを新しい ProjectStatus に更新 | **高** |
| `src/controllers/adminController.ts:1941` | 型キャストを新しい ProjectStatus に更新 | **高** |
| `src/controllers/liffController.ts:2024` | `p.status === "active"` → `p.status === "published"` | **高** |
| `src/views/admin/projects/form.ejs:18` | status 選択肢を6択に更新 | **高** |

### DBマイグレーション（新規追加必要）

| ファイル | 内容 | 優先度 |
|---|---|---|
| `supabase/migrations/041_project_status_redesign.sql` | `active → published` UPDATE + CHECK 制約追加 | **最高** |

### シード・テストデータ（`active` → `published` に更新）

| ファイル | 行 | 優先度 |
|---|---|---|
| `supabase/seed.sql` | 13 | 高 |
| `supabase/schema.sql` | 681 | 高 |
| `supabase/fitness_screening_test_seed.sql` | 39 | 中 |
| `supabase/realistic_interview_project.sql` | 40 | 中 |
| `supabase/test_all_answer_types_ai_branch_project.sql` | 65 | 中 |
| `supabase/test_app_improvement_all_features_project.sql` | 72 | 中 |
| `supabase/test_breakfast_health_all_features_project.sql` | 73 | 中 |
| `supabase/test_choco_interview_project.sql` | 37 | 中 |
| `supabase/test_dog_popularity_project.sql` | 66 | 中 |
| `supabase/test_interview_cases.sql` | 121, 132, 143 | 中 |
| `supabase/test_interview_probe_skip_project.sql` | 42 | 中 |
| `supabase/test_interview_probe_skip_project_lunch.sql` | 45 | 中 |
| `supabase/test_interview_probe_skip_project_product_dev.sql` | 49 | 中 |
| `supabase/test_performance_vs_appearance_project.sql` | 72 | 中 |
| `supabase/test_spring_plans_all_features_project.sql` | 73 | 中 |

### 推奨修正（現在も潜在バグ）

| ファイル | 修正内容 | 優先度 |
|---|---|---|
| `src/repositories/projectRepository.ts:209-217` | `getDiscoverableById()` に `status = 'published'` フィルタ追加 | 中 |

### テストファイル（変更不要）

| ファイル | 理由 |
|---|---|
| `src/tests/questionSchemaRedesign.test.ts:121` | `status: "draft"` を使用中。`draft` は変更なし |

---

## 6. 壊滅的影響の有無

### 定量評価

| 観点 | 評価 |
|---|---|
| 修正必須ファイル数（TSソース） | **9ファイル** |
| 修正必須ファイル数（SQLシード） | **15ファイル** |
| 修正必須SQL箇所 | **migration 1本 + seed 15本** |
| 管理画面への影響 | **あり**（form.ejs のstatus選択肢、型キャスト） |
| LIFF表示への影響 | **あり**（is_active フラグ、案件一覧フィルタ） |
| 配信処理への影響 | **限定的**（daily_surveysは無関係。project自動配信は未実装） |
| 既存データ移行難易度 | **低**（UPDATE 1本で完了） |
| テスト修正の必要性 | **低**（既存テストの修正は不要。シードは更新必要） |

### 壊滅的ではない理由

1. `active` の使用箇所が明確に特定でき、全て `published` への単純置換で対応できる
2. 他の status（`draft` / `paused` / `archived`）は変更なし
3. 新規追加の `ready` / `closed` は既存ロジックに影響しない（新機能として追加するだけ）
4. DB の CHECK 制約が現状ないため、移行中に「制約違反」は起きない（ただし追加後は厳格化される）
5. `sessions.status` / `daily_surveys.status` など他テーブルの `active` 値には影響なし

### リスクのある点

| リスク | 内容 |
|---|---|
| 型キャストの残存 | `adminController.ts` の型キャストを更新し忘れると TypeScript エラーは出ないが、不正な値が DB に入る可能性 |
| シードデータの更新漏れ | ローカル開発環境で旧データが残ると、一覧が0件になる |
| LIFF `is_active` フラグ | フロント側（LIFF）がこのフラグを使ってUI制御していた場合、変更後は全案件が `is_active: false` になる。**デプロイのタイミングにより一時的にUI崩れの可能性あり** |
| `getDiscoverableById()` の status フィルタ欠如 | 現在も `paused` 案件が直接アクセス可能。今回の変更に合わせて修正を推奨 |

---

## 7. 推奨方針

### 結論: `projects.status` 単独再設計で進めて問題ない

`delivery_status` を別カラムで分ける必要はない。理由は以下の通り。

**進めて良い理由:**
1. **変更スコープが明確**: `active` → `published` の単純置換が主体。修正箇所が全て特定済み
2. **段階的実装が可能**: `ready` / `closed` は既存コードに影響しない形で追加できる
3. **DB移行が簡単**: CHECK 制約なしのため、UPDATE 後に制約追加する1本のマイグレーションで完結
4. **配信ロジックが未実装**: `ready` を使った自動配信は現状実装がないため、後から追加できる

**推奨実装順序:**

```
Step 1: TypeScript 型定義の更新（domain.ts）
Step 2: migration 作成（UPDATE + CHECK制約追加）
Step 3: ソースコード修正（repository / controller / view / 型キャスト）
Step 4: シードデータ更新（seed.sql / test_*.sql）
Step 5: ローカル migration 実行・動作確認
Step 6: 本番 migration 実行
Step 7: ready / closed を使う新機能の実装（配信フローなど）
```

**`delivery_status` を分けない理由:**
- `status` の各値は明確に異なる概念（下書き/配信待ち/掲載中/停止/終了/保存）
- `published` が「LIFF掲載中」かつ「配信済み」を兼ねることで、シンプルな状態管理になる
- delivery_status を追加すると、「statusとdelivery_statusの組み合わせ」という複雑な状態管理が必要になる

**合計修正量の見積もり:**

| カテゴリ | ファイル数 | 工数目安 |
|---|---|---|
| 型定義・TS修正 | 4ファイル | 30分 |
| DB migration | 1ファイル | 15分 |
| シードデータ | 15ファイル | 30分 |
| 動作確認 | - | 30分 |
| **合計** | **20ファイル** | **約2時間** |
