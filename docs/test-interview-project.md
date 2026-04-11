# テスト用インタビュー案件

LINE チャットインタビューの動作確認用に、既存スキーマへ投入できる案件定義を追加した。

## 定義ファイル

- SQL: `supabase/test_interview_project.sql`
- テストケース SQL: `supabase/test_interview_cases.sql`
- project_id: `00000000-0000-4000-8000-000000000002`
- タイトル: `テスト用インタビュー案件（コンビニ利用インタビュー）`
- status: `active`
- research_mode: `interview`
- reward_points: `10`

## 調査設定

- primary_objectives
  - コンビニ利用頻度の把握
  - 利用シーンの理解
- secondary_objectives
  - 利用時の不満点
  - 改善ニーズ
- probe_policy
  - target_question_codes: `Q2`, `Q3`
  - max_probes_per_answer: `2`
  - max_probes_per_session: `2`
  - short_answer_min_length: `18`
  - probe_guideline: `理由を聞く。具体例を聞く。感情を引き出す。`

## 設問一覧

1. `Q1`
   - 質問: `普段どれくらいの頻度でコンビニを利用しますか？`
   - タイプ: `single_select`
   - ロール: `screening`
   - 深掘り: なし

2. `Q2`
   - 質問: `どのような場面でコンビニを利用することが多いですか？`
   - タイプ: `text`
   - ロール: `main`
   - 深掘り: あり
   - 最大深掘り回数: `2`

3. `Q3`
   - 質問: `コンビニに対して不満や改善してほしい点があれば教えてください。`
   - タイプ: `text`
   - ロール: `comparison_core`
   - 深掘り: あり
   - 最大深掘り回数: `2`

4. `__free_comment__`
   - 質問: `最後に、ここまでで話しきれなかったことがあれば自由に教えてください。`
   - タイプ: `text`
   - ロール: `free_comment`
   - hidden/system: `true`

## 登録手順

1. Supabase SQL Editor で `supabase/test_interview_project.sql` を実行する。
2. 必要なら `supabase/test_interview_cases.sql` を続けて実行し、会話ログ付きのテストデータを投入する。
3. 管理画面で案件が作成されていることを確認する。
   - `/admin/projects`
4. 質問 3 件と hidden free comment が入っていることを確認する。
   - `/admin/projects/00000000-0000-4000-8000-000000000002/questions`

## assignment 作成方法

対象 LINE ユーザーが既に `respondents` に存在している場合は、管理画面からの割当が最も安全。

1. 管理画面で案件 Delivery 画面を開く。
   - `/admin/projects/00000000-0000-4000-8000-000000000002/delivery`
2. `Manual Delivery` で対象ユーザーに対応する行を選ぶ。
3. `Assign And Push` を押す。
4. LINE へ招待メッセージが飛び、assignment が `assigned` / `sent` / `opened` のいずれかで作成される。

SQL で assignment を作る場合は、`supabase/test_interview_project.sql` の末尾にある optional block を使う。

## LINE 動作確認手順

1. 対象ユーザーに assignment を作成する。
2. LINE で bot に `案件一覧` と送る。
3. 一覧に `テスト用インタビュー案件（コンビニ利用インタビュー）` が表示されることを確認する。
4. 表示された番号を送る。
5. Q1 が表示されることを確認する。
6. Q1 に回答し、続けて Q2 が表示されることを確認する。
7. Q2 では短めの回答を送る。
   - 例: `朝に使います`
8. 理由・具体例・感情のいずれかを聞く深掘りが 1 回以上返ることを確認する。
9. その後 Q3 に進み、必要に応じて再度深掘りが発生することを確認する。
10. 最後まで回答して完了メッセージを確認する。

## 深掘りを確認しやすい回答例

- Q2: `朝に使います`
- Q3: `レジ待ちです`

短く抽象的な回答の方が、現在の probe policy では深掘りが発生しやすい。

## テストケース

### 共通前提

- `supabase/test_interview_project.sql` を適用済みであること
- 対象ユーザーが `respondents` に存在していること
- `line_menu_actions` に `案件一覧` エイリアスを持つ `start_project_list` が入っていること
- 検証対象案件の assignment は、ケースごとに `未作成` / `sent` / `opened` / `started` / `completed` を使い分けること

### ケース一覧

| ID | 観点 | 事前条件 | 操作 | 期待結果 |
| --- | --- | --- | --- | --- |
| TC-INT-01 | 案件登録 | SQL 未適用 | `supabase/test_interview_project.sql` を実行 | `projects` に対象案件、`questions` に `Q1`,`Q2`,`Q3`,`__free_comment__` が登録される |
| TC-INT-02 | 案件一覧なし | 対象ユーザーに active assignment がない | LINE で `案件一覧` を送信 | `現在参加可能な案件はありません。` が返る |
| TC-INT-03 | 案件一覧表示 | 対象案件の assignment が `assigned` または `sent` | LINE で `案件一覧` を送信 | `参加可能な案件` と案件名が表示され、末尾に `番号を送信してください` が付く。assignment は `opened` に更新されうる |
| TC-INT-04 | 不正な案件番号 | TC-INT-03 実施直後 | 一覧にない番号を送信 | `該当する案件番号が見つかりません。案件一覧をもう一度送信してください。` が返る |
| TC-INT-05 | 案件開始 | TC-INT-03 実施直後 | 対象案件の番号を送信 | `「テスト用インタビュー案件（コンビニ利用インタビュー）」を開始します。` に続いて Q1 が表示される |
| TC-INT-06 | 選択式バリデーション | Q1 表示中 | 選択肢にない文字列を送信 | `番号か選択肢名で1つだけ返信してください。` の後に同じ Q1 が再表示される |
| TC-INT-07 | Q1 正常遷移 | Q1 表示中 | `1` または `ほぼ毎日` を送信 | Q2 が表示される。初回回答保存後、assignment は `started` に更新されうる |
| TC-INT-08 | Q2 深掘り発火 | Q2 表示中 | `朝に使います` を送信 | すぐ次の本質問へは進まず、理由・具体例・感情のいずれかを補う深掘りが返る |
| TC-INT-09 | Q2 深掘り回答後の遷移 | TC-INT-08 実施直後 | 深掘りに対して具体回答を返す | Q3 に進む。`current_phase` は `ai_probe` から `question` に戻る |
| TC-INT-10 | Q3 深掘り発火 | Q3 表示中 | `レジ待ちです` を送信 | 必要に応じて深掘りが返る。セッション全体の深掘り回数は最大 2 回まで |
| TC-INT-11 | フリーコメント遷移 | Q3 の回答完了後 | 通常どおり回答を進める | `最後に、ここまでで話しきれなかったことがあれば自由に教えてください。` が表示される |
| TC-INT-12 | 完了処理 | `__free_comment__` 表示中 | 任意のコメントを送信 | まず `ありがとうございます。完了処理を進めています。` が reply され、その後 push で `獲得ポイント` / `累計ポイント` / `現在ランク` を含む結果と `インタビューが完了しました。ご協力ありがとうございました。` が届く。assignment は `completed` になる |
| TC-INT-13 | 中断 | 進行中セッションあり | `やめる` を送信 | `中断しました。続きは resume、やり直しは 最初から でできます。` が返り、セッションは `abandoned` になる |
| TC-INT-14 | 再開 | 進行中または再開可能 assignment あり | `再開` を送信 | 再開可能案件があれば `「案件名」を再開します。` と現在の質問が返る。なければ `再開できる案件はありません` |
| TC-INT-15 | 最初からやり直し | 進行中セッションあり | `最初から` を送信 | 既存セッションが中断され、`最初からやり直します。Q1 から再開します。` に続いて Q1 が返る |

### 推奨入力例

| 設問 | 深掘りを起こしやすい入力 | 深掘りを起こしにくい入力 |
| --- | --- | --- |
| Q2 | `朝に使います` | `平日の出勤前に駅前のコンビニでコーヒーとパンを買います。時間がないので早く買えて助かっています` |
| Q3 | `レジ待ちです` | `昼休みはレジ待ちが長く、急いでいる日にかなりストレスです。セルフレジがもう少し増えると助かります` |

### 観測ポイント

- 管理画面
  - `/admin/projects` で案件登録有無を確認する
  - `/admin/projects/00000000-0000-4000-8000-000000000002/questions` で hidden free comment を含む質問構成を確認する
  - `/admin/projects/00000000-0000-4000-8000-000000000002/delivery` で assignment status の遷移を確認する
- DB
  - `project_assignments.status` が `assigned -> sent -> opened -> started -> completed` のいずれで推移するかを確認する
  - `sessions.current_phase` が `question -> ai_probe -> question -> free_comment -> completed` と遷移することを確認する
  - `answers.answer_role` に深掘り回答が入った場合、`primary` と `ai_probe` が分かれて保存されることを確認する
