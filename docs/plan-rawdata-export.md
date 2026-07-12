# ロウデータ出力（Freeasy水準）要件

作成: 2026-07-12（requirements-discovery による要件確定）

## 背景・目的

- 受け手は**自社の集計担当（Python / pandas で集計予定）**。
- 参考は アイブリッジ Freeasy のロウデータ出力（設定画面＋ `006021833_Rawdata.csv`）。
- **UIの再現は不要**。「この水準の情報量・選択肢を持つ出力」が目標。
- 既存の統計エクスポートエンジン（PR#9・`src/lib/statExport.ts` / `src/lib/codebook.ts` / `src/services/statExportService.ts`）を土台に**併設**する。既存の respondents_wide / answers_long / codebook は壊さない。

## 確定要件（MVP）

### 1. 新エンドポイント: Freeasy式ロウデータ

- 例: `GET /admin/projects/:projectId/exports/stat/rawdata.csv`
- 列命名は Freeasy 式:
  - 先頭メタ列: `MID`（=respondent_key）/ `START` / `END` / `TIME` / `STA`（ステータス）
  - SA設問: `q{n}`（コード値）
  - MA設問: `q{n}c{k}`（0/1 フラグ。one-hot は現行実装を流用）
  - 自由記述・その他テキスト: `q{n}t{k}`
  - マトリクス行: `q{n}s{k}`（SA行）/ `q{n}s{j}c{k}`（MA行）
  - 設問別回答時刻: `q{n}_datetime`
  - 末尾: 属性列（下記5）
- q番号の採番は**送付時スナップショット（questionnaire_snapshot）のマスター順**。スナップショット未確定時は現行マスター順にフォールバック。

### 2. レイアウトデータ（対応表）の同時出力

- Freeasy 命名で意味情報が失われるため、`q番号 ⇔ question_code ⇔ 設問文 ⇔ 選択肢コード/ラベル` の対応表 CSV を必ず併置する（Freeasy の「レイアウトデータをダウンロード」相当）。
- **注意**: 既存 wide/long/codebook は集計アプリ連携で**契約凍結（列変更禁止・末尾追加のみ／2026-07-11・export_jobs監査対象）**。凍結ファイルには触らず、**新規 `rawdata-layout.csv`** として実装する。

### 3. コード出力 / 回答値出力の切替

- クエリパラメータ（例 `?mode=code|label`）。label 時は選択肢コードの代わりに値ラベルを出力。
- codebook の値ラベルをそのまま使う。

### 4. 設問別回答時刻列

- `Answer.created_at` 由来。**DB変更なし**で実装可能。

### 5. 属性列（UserProfile 結合）

- `SEX`（gender）/ `AGE`（birth_date から回答時点年齢）/ `PRE`（prefecture）/ `JOB`（occupation）/ `BUS`（industry）/ `MAR`（marital_status）/ `CHI`（has_children）
- コード値で出力し、値ラベルはレイアウトデータに載せる。
- 世帯年収（INC 相当）は現状プロフィール項目が無いため対象外（→別トラック）。

### 6. ステータス別件数パネル＋出力対象の手動選択

- 出力画面（analysis.ejs の統計エクスポートカード拡張 or 専用カード）に response_status 別の件数（完了 ◯件 / 途中離脱 ◯件 …）を表示。
- チェックボックスで含めるステータスを手動選択（**既定 = 完了のみ**）。「いれるいれないは手動判断だが、画面にわかる形で」に対応。
- Freeasy の END1〜10 のような離脱「番地」管理は作らない（簡易版）。不足が出たら離脱設問位置の列追加を検討。

### 7. AI深掘り列

- 既定ONで同一ファイルに含める（`{code}_final_answer_text` 等の現行統合列）。チェックで除外可能。
- 業界標準に無い本システム独自の付加価値のため既定は含める。

### 8. 物理仕様

- UTF-8 BOM / カンマ区切り / RFC4180 / CRLF（現行 `toCsvRfc4180` を流用）。
- Python（pandas `encoding="utf-8-sig"`）前提のため **SJIS-win・タブ区切りは作らない**。

## Phase2（将来）

- **UA / IPAddress**: 現状は同意記録（user_consent_records）にのみ保存。回答セッション単位の収集（DB変更＋LIFF配管）を行ってから出力列追加。不正回答検出用途。
- **256カラム分割・取得レコード単位ページング・ランダムN件**: Vercel のレスポンスサイズ制限に当たったら着手。

## 別トラック（エクスポート外）

- **世帯年収プロフィール項目の追加**: 必要と確定（2026-07-12）。ただしプロフィール機能側の改修（LIFF入力UI・選択肢設計・既存回答者は欠損）。項目追加後にエクスポートの属性列へ自動追加する。

## 不要（理由付き）

| 項目 | 理由 |
|---|---|
| MAカンマ区切り / ASSUM 形式 | 自社 Python 集計では one-hot（MAフラグ）で十分 |
| SPSSシンタックス生成 | SPSS 不使用（Python予定） |
| SJIS-win / タブ区切り | pandas は UTF-8 BOM を読める |
| 設定画面のUI再現 | 「出力の水準」が目標。UIは既存管理画面の拡張で足りる |
| Freeasy互換のための既存マクロ対応 | 既存の作業手順・マクロは無し（命名採用は可読性・慣習目的） |

## 未確定（open questions）

| # | 項目 | 内容 | 確認相手 |
|---|---|---|---|
| 1 | 世帯年収の選択肢設計 | プロフィール改修時に確定（区分・刻み・回答拒否枠） | ユーザー |
| 2 | 離脱番地の細分化 | 簡易版（ステータス別件数）で不足が出たら END 番地相当を検討 | 運用開始後 |
| 3 | q番号とコンセプト（L1）の関係 | 複数コンセプト回答時の列展開ルール（`q{n}` に concept サフィックスを付けるか） | 実装計画時 |

## 次工程

- 実装計画: implementation-planner で Phase 分解（新規ビルダー `buildFreeasyRows` ＋ q番号採番 ＋ 画面カード拡張の想定）。
- 既存挙動の保存: respondents_wide / answers_long / codebook は**凍結契約**のため一切変更しない。既存テスト（statExport.test.ts）も green を維持。
- 新エンドポイントも export_jobs 監査ログ（migration 076/077 の型）への記録を踏襲する。
