# 実装計画: 美容室ABCサイクル（繰り返し回答＋離脱率計測）

作成: 2026-08-17 / ステータス: 計画（未実装）

## 実装目的

同じ人が A→B→C→A→B… と繰り返し回答できるようにし、**「Aで答えた来店頻度の期間を過ぎても再来店しなかった人＝離脱」** を計測する。

完成時にできること:

- 1案件＝1QRのまま、同じ人が何周でも回答できる
- 周回（サイクル）単位で回答が横串に繋がり、離脱率がSQLで出せる
- 離脱疑いの人にだけ C（本音アンケート）が自動送付される

## 確定仕様

| 項目 | 決定 |
|---|---|
| A | 来店した理由。**A-Q11で来店頻度を取得**（`within_3w`〜`over_4m`, `undecided`） |
| B | 来店後の満足度。**A回答の2時間後にPush、またはQRから随時** |
| C | 離脱検証。**A回答から「頻度期間」経過後もAが来ていない人にだけ送付** |
| サイクル起点 | **A の完了**。次のAで `cycle_no+1` |
| A→B→A→B | **2周した**（解釈①） |
| 途中でA再来 | 前サイクルを締めて新サイクル開始 |
| 順序強制 | **しない**（順不同で来た事実を記録する） |
| 離脱判定 | **次のAが来た時点で「離脱していない」が確定**。C送付前にAが来たらC送付キャンセル |

### 離脱の定義（本計画の核）

```
Aの回答日 + A-Q11の頻度日数 + 猶予 < 今日  かつ  その間にAの再回答がない
  → 離脱疑い → C を送付
```

C に来ないこと自体は離脱ではない（C は離脱を*測る*ための調査）。

### 頻度コード → 日数

| code | ラベル | 日数 |
|---|---|---|
| `within_3w` | 3週間以内 | 21 |
| `about_1m` | 約1か月 | 30 |
| `about_1_5m` | 約1か月半 | 45 |
| `about_2m` | 約2か月 | 60 |
| `about_3m` | 約3か月 | 90 |
| `over_4m` | 4か月以上 | 120 |
| `undecided` | 特に決まっていない | **NULL＝C送付対象外**（要判断・下記オープン論点） |

猶予日数（grace）は案件グループ設定で持つ。既定 +7日。

## 前提（既存コード）

- 「1案件1回」を縛っているのは3点のみ
  - `project_assignments` の `unique(project_id, respondent_id)` — `supabase/migrations/004_project_assignments.sql:22`
  - `respondents` の `unique(line_user_id, project_id)` — `supabase/migrations/001_init.sql:71`
  - `assignment.status === 'completed'` の画面ゲート — `src/controllers/liffController.ts:931`（＋API冪等ガード `:1576`）
- `answers` / `sessions` は `session_id` 基準でUNIQUEが無く、**多重セッションをスキーマ変更なしで持てる**
- A/B/C は `entry_code=yotto-salon-a/b/c` で seed 済み — `scripts/seedSalonSurveyProjects.mjs`
- 店舗コード入力は実装済み — `src/views/liff/store-entry.ejs`, `POST /liff/store/resolve`
- get-or-create は3箇所に複製（共通関数なし）
  - `src/services/storeEntryService.ts:41`
  - `src/services/applicationService.ts:52`（auto応募）
  - `src/services/applicationService.ts:129`（管理者当選）

### ⚠ 先に直すバグ

`src/services/crossProjectAnswerService.ts:70-73` が `listByRespondent(respondentId)` の結果を
`s.project_id === sourceProject.id` で絞っているが、`respondents` は **project単位のレコード**。
渡るのはC案件のrespondent_idなので、A案件のsessionは絶対にヒットせず常に `null` を返す。
→ **A→Cのcarry-forwardは現状動いていない可能性が高い。Phase 1 で修正＋実データ確認。**

修正方針: `line_user_id` から参照先案件の respondent を引き直す
（`respondentRepository.getByLineUserAndProject(lineUserId, sourceProject.id)`）。

## 変更対象

| 領域 | 変更 | 内容 |
|---|---|---|
| DB | あり | `cycle_groups` / `survey_cycles` 新規、`project_assignments.cycle_id` 追加、UNIQUE張替 |
| API | あり | store/resolve のサイクル解決、C送付cron、B遅延Push |
| UI | あり | 管理画面にサイクル定義＋離脱ファネル |
| 型定義 | あり | assignment型に `cycle_id`、cycle系の型追加 |
| cron | あり | 日次バッチ（⚠ Vercel Hobby = 1日1回まで） |
| 統計export | あり | `CYCLE_NO` を**末尾追加**（列変更禁止・契約） |

## DB設計

```sql
-- migration 093

create table cycle_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  client_id uuid references clients(id),
  entry_project_id uuid not null references projects(id),   -- A（起点）
  followup_project_id uuid references projects(id),         -- C（離脱検証）
  grace_days int not null default 7,
  created_at timestamptz not null default now()
);

-- ステップ構成（A→B / A→B→C の差を吸収）
create table cycle_group_steps (
  id uuid primary key default gen_random_uuid(),
  cycle_group_id uuid not null references cycle_groups(id) on delete cascade,
  project_id uuid not null references projects(id),
  step_order int not null,
  step_role text not null,        -- 'entry' | 'followup' | 'verify'
  unique (cycle_group_id, project_id)
);

create table survey_cycles (
  id uuid primary key default gen_random_uuid(),
  cycle_group_id uuid not null references cycle_groups(id) on delete cascade,
  line_user_id text not null,
  cycle_no int not null,
  started_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text,              -- 'completed' | 'restarted' | 'churn_confirmed'
  -- 離脱判定用（A完了時に確定）
  frequency_code text,
  expected_return_at timestamptz, -- A完了日 + 頻度日数 + grace
  followup_sent_at timestamptz,
  returned_at timestamptz,        -- 次のAが来た時刻（=離脱していない証拠）
  unique (cycle_group_id, line_user_id, cycle_no)
);

create index ix_survey_cycles_due
  on survey_cycles (expected_return_at)
  where closed_at is null and followup_sent_at is null;

-- assignment をサイクルに紐づけ
alter table project_assignments add column cycle_id uuid references survey_cycles(id);

-- ★ 1案件1回の解除
alter table project_assignments drop constraint project_assignments_project_respondent_unique;
alter table project_assignments add constraint project_assignments_project_respondent_cycle_unique
  unique (project_id, respondent_id, cycle_id);
```

> **注意**: PostgreSQLのUNIQUEは NULL を重複扱いしない。`cycle_id IS NULL`（サイクル外の通常案件）は
> 無制限に作れてしまうため、**既存案件の1回制限は別途アプリ層で維持**する（下記 注意点）。

### `respondents` の unique はどうするか

`unique(line_user_id, project_id)` は **張り替えない**。
respondent は「この人とこの案件の関係」を表すので周回で使い回してよい。
サイクルの区別は assignment 側の `cycle_id` が持つ。これにより変更範囲が小さくなる。

## 実装フェーズ

### Phase 1: carry-forwardバグ修正＋実データ確認
- `crossProjectAnswerService.loadOneSource` を line_user_id 起点に修正
- 既存A/C案件で実際に値が引けることを確認
- 依存: なし / 完了条件: A回答がC画面に反映されることを実機確認

### Phase 2: DB（migration 093）
- 上記スキーマ適用（`npm run db:migrate`）
- 既存 `project_assignments` 全行は `cycle_id = NULL` のまま
- 完了条件: 既存の回答導線が全て無傷で動く（リグレッション）

### Phase 3: サイクル解決ロジック
- `cycleService`（新規）: `resolveCycleForEntry(lineUserId, projectId)`
  - entry(A) → 開いているサイクルがあれば締めて `cycle_no+1` で新規作成
  - それ以外 → 開いているサイクルに join。無ければ作らず `cycle_id=NULL`（順序強制しないため）
- get-or-create 3箇所を `cycle_id` 込みに改修
- `projectAssignmentRepository.getByProjectAndRespondent` の `.maybeSingle()` 単一前提を解消
- 完了条件: 同じ人がAを2回答えると assignment が2件立ち、cycle_no が 1,2 になる

### Phase 4: 離脱判定＋C自動送付
- A完了時に `frequency_code` / `expected_return_at` を確定（A-Q11から算出）
- 日次cron: `expected_return_at < now()` かつ未送付・未再来のサイクルにCをPush
- 次のA完了時に前サイクルへ `returned_at` を記録し、**C送付予定をキャンセル**
- ⚠ 商用副作用（Push/ポイント）はレスポンス前に await（投げっぱなし禁止）
- 完了条件: 頻度期間を過ぎた人にだけCが飛ぶ／期間内に再来した人には飛ばない

### Phase 5: B の2時間後Push
- A完了時に送信予約を登録し、日次cronの粒度では足りないため要検討（下記オープン論点）
- QR経由のB回答は現行のまま（Phase 3のサイクル解決に乗るだけ）

### Phase 6: 管理画面＋統計
- サイクル定義CRUD、離脱ファネル（cycle_no別 A/B/C完了数・離脱率）
- 統計exportに `CYCLE_NO` を末尾追加

## 注意点

- **ポイント二重取り**: 周回ごとに完了ポイントが付く。A連打で無限取得できないよう
  「同一サイクル内は1回」＋ entry再開のクールダウン（最短間隔）が必須
- **既存案件の1回制限**: `cycle_id IS NULL` はUNIQUEが効かないため、
  サイクルに属さない案件は `status==='completed'` ゲート（`liffController.ts:931`）を維持して守る
- **統計export契約**: wide/long/codebook は列変更禁止・**末尾追加のみ**。
  1人1行の前提が崩れるため集計アプリ側へ申し送りが必要
- **Vercel Hobby**: cron 1日1回まで。Bの2時間後Pushはこの粒度で実現できない
- `my_assignment`（`liffController.ts:2725`）が最新サイクルを指すよう修正が必要

## オープン論点（要判断）

1. **`undecided`（頻度未定）の人にCを送るか。** 現案は送付対象外。
   固定日数（例60日）で送る案もあるが、離脱率の分母に混ぜると精度が落ちる
2. **Bの「2時間後」の実現手段。** Vercel Hobby の cron は1日1回。
   選択肢: (a) 外部スケジューラ (b) 送付時刻を日次バッチの粒度に丸める
   (c) LINE側の仕組みを使う。※要調査
3. **A連打のクールダウン日数**（新サイクル開始の最短間隔）

## 完了条件

- [ ] A→B→C→A→B と回答でき、assignment が周回ごとに独立して立つ
- [ ] A-Q11 の頻度に応じてCの送付日が個別に決まる
- [ ] 期間内に再来店（A再回答）した人にはCが送られない
- [ ] cycle_no 別の A/B/C 完了数から離脱率が算出できる
- [ ] 既存の非サイクル案件が「1回のみ」のまま無傷
- [ ] ポイントが周回で二重取得されない
