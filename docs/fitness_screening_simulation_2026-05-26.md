# 新規フィットネス加入者スクリーニング回答検証ログ

実施日時: 2026-05-26 12:58 JST 頃  
対象プロジェクト: `00000000-0000-4000-8000-0000000000f1`  
実行スクリプト: `scripts/runFitnessScreeningSimulation.cjs`

## 検証条件

- 既存のテスト割当5件を「全員に送付済み」とみなし、各ユーザーでアンケート回答を投入した。
- スクリーニング設問はQ1-Q3。
- 通過条件は以下。
  - プロフィール年齢: 20歳以上70歳以下
  - プロフィール都道府県: 東京都、神奈川県、埼玉県、千葉県、茨城県、栃木県、群馬県
  - Q1: `never_joined` または `trial_only`
- 通過者のみQ4-Q6の本アンケートまで回答し、割当を `completed` にした。
- 非通過者はQ1-Q3回答後に `sessions.state_json.screening_result = "fail"` として停止した。

## 結果サマリ

| ユーザー | 年齢/地域 | Q1回答 | 判定 | 本アンケート | 失敗理由 |
|---|---:|---|---|---|---|
| `line_test_fit_pass_28_tokyo` | 28 / 東京都 | `never_joined` | pass | Q4-Q6回答済み | なし |
| `line_test_fit_pass_69_saitama` | 69 / 埼玉県 | `trial_only` | pass | Q4-Q6回答済み | なし |
| `line_test_fit_fail_age_19_tokyo` | 19 / 東京都 | `never_joined` | fail | 未回答 | `profile:age between [20,70] (actual=19)` |
| `line_test_fit_fail_region_osaka` | 35 / 大阪府 | `never_joined` | fail | 未回答 | `profile:prefecture in [...] (actual="大阪府")` |
| `line_test_fit_fail_history_35_chiba` | 34 / 千葉県 | `joined_before` | fail | 未回答 | `question:Q1 (actual="joined_before", pass_values=["never_joined","trial_only"])` |

## 保存されたセッション

| ユーザー | assignment_id | session_id | assignment status | session status | screening_result | 回答数 |
|---|---|---|---|---|---|---:|
| `line_test_fit_pass_28_tokyo` | `00000000-0000-4000-8000-00000000fa01` | `13ea56c4-192e-4b7a-aa24-7c6a710c14d5` | `completed` | `completed` | `pass` | 6 |
| `line_test_fit_pass_69_saitama` | `00000000-0000-4000-8000-00000000fa02` | `3de35c86-1f31-41d8-a955-a8a169093336` | `completed` | `completed` | `pass` | 6 |
| `line_test_fit_fail_age_19_tokyo` | `00000000-0000-4000-8000-00000000fa03` | `9ae6ad7a-ed6e-4124-b55b-2d4dfe2ac8b3` | `started` | `active` | `fail` | 3 |
| `line_test_fit_fail_region_osaka` | `00000000-0000-4000-8000-00000000fa04` | `9704e58e-dca4-4e3a-852b-15efb9a1323d` | `started` | `active` | `fail` | 3 |
| `line_test_fit_fail_history_35_chiba` | `00000000-0000-4000-8000-00000000fa05` | `2e32d6a3-5b11-45f0-a724-8ed7b4667c07` | `started` | `active` | `fail` | 3 |

## 回答内容

### `line_test_fit_pass_28_tokyo`

- Q1: `never_joined`
- Q2: `東京都`
- Q3: `20s`
- Q4: 健康診断で運動不足を指摘され、仕事帰りに短時間でも体力づくりを始めたいと思ったためです。
- Q5: `price,time,beginner`
- Q6: `orientation,trainer_plan,crowd_app`

### `line_test_fit_pass_69_saitama`

- Q1: `trial_only`
- Q2: `埼玉県`
- Q3: `60s`
- Q4: 加齢で足腰の衰えを感じており、医師から軽い筋力トレーニングを勧められたら検討します。
- Q5: `beginner,effect,crowd`
- Q6: `orientation,trainer_plan,trial_plan`

### `line_test_fit_fail_age_19_tokyo`

- Q1: `never_joined`
- Q2: `東京都`
- Q3: `under_20`

### `line_test_fit_fail_region_osaka`

- Q1: `never_joined`
- Q2: `other`
- Q3: `30s`

### `line_test_fit_fail_history_35_chiba`

- Q1: `joined_before`
- Q2: `千葉県`
- Q3: `30s`

## 確認事項

- スクリーニング条件は想定通り動作した。
- 通過2件は本アンケートまで進み、非通過3件は本アンケートへ進めない状態になった。
- 現行のLIFF判定経路では、判定結果は `sessions.state_json.screening_result` に保存される。一方で `project_assignments.screening_result` は今回の確認時点でも全件 `null` のまま。画面制御自体は `sessions.state_json.screening_result` を見ているため動作するが、割当一覧や集計で `project_assignments.screening_result` を見る場合は反映されない点に注意。

## 補足

`npm run build` は今回の変更とは別の既存TypeScriptエラーで失敗した。

主なエラーは `QuestionType` に `"text"` / `"scale"` が含まれていない一方で、複数箇所がそれらを比較・代入していること。

---

## 再検証 (2026-05-26) — project_assignments.screening_result 保存対応後

### 修正内容

- `liffController.judgeScreening` にて `session.state_json.screening_result` の保存に加え、`project_assignments.screening_result`（`"passed"` / `"failed"`）および `screening_result_at` を同時に保存するよう修正した。
- シミュレーションスクリプト (`scripts/runFitnessScreeningSimulation.cjs`) も同様に `project_assignments` へ反映するよう更新し、最終状態を取得して検証するステップを追加した。

### 再検証結果

| ユーザー | 判定 | assignment_screening_result | assignment_status |
|---|---|---|---|
| `pass_28_tokyo` | pass | `passed` ✓ | `completed` |
| `pass_69_saitama` | pass | `passed` ✓ | `completed` |
| `fail_age_19_tokyo` | fail | `failed` ✓ | `started` |
| `fail_region_osaka` | fail | `failed` ✓ | `started` |
| `fail_history_35_chiba` | fail | `failed` ✓ | `started` |

### 確認事項

- 通過2件の `project_assignments.screening_result` が `passed` になった。
- 非通過3件の `project_assignments.screening_result` が `failed` になった。
- `sessions.state_json.screening_result` は従来どおり `pass` / `fail` を保持し、LIFF 画面制御は引き続きこちらを参照する。
- 非通過者の `assignment_status` は `started` のまま維持（`screened_out` ステータスは現行型定義に存在しないため変更なし）。
- `project_assignments` を参照するだけでスクリーニング合否が判別できる状態になった。
