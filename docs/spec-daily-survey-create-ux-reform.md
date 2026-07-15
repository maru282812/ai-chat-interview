# 実装仕様書: デイリーアンケート新規作成 UX 改修

## 目的

デイリーアンケート新規作成時に、タイトル＋報酬＋設問を**1つのフォームで一度に入力できる**ようにする。
現在は「作成する（基本設定保存）→ リダイレクト → 編集画面で設問追加」という2ステップが必要だが、
クライアント側で設問を一時保管して、「作成する」時に基本設定＋設問をまとめて保存できるように改修する。

ユーザーが「設問を追加」を押した直後に設問が表示されないという UX 問題を解決し、
「タイトル・報酬を入力 → 設問を複数追加 → 作成する」という直感的なフロー実現する。

## スコープ外

- 編集時（`mode === 'edit'`）の設問管理フロー（既存通り）
- 設問テンプレートやプリセット機能
- 設問の詳細検証（既存のサーバー側検証に委譲）
- 新しいレンダラやプリセット追加

## 画面

### デイリーアンケート作成画面（URL: /admin/daily-surveys/new）

**現在**: form.ejs 全体（基本設定フォーム + SubmitButton のみ）

**変更後**:

1. **基本設定セクション** (既存通り)
   - タイトル [text]
   - 説明（管理用メモ）[textarea]
   - 報酬タイプ [select: fixed | random]
   - 付与ポイント / ポイント範囲 [number]
   - 回答UI [select: casual | standard | formal]
   - 通知テンプレート [select]
   - 対象セグメント [select]
   - 配信タイミング [radio: キューに積む | 日付を指定]
     - 日付指定時: 日付 [date] + 枠 [select: morning | evening]
   - 回答期限 [datetime-local]

2. **設問一覧** (0 件から開始)
   - テーブル表示（順序・設問文・種別・選択肢数・属性キー・操作）
   - 初期表示: 「設問がありません。下のフォームから追加してください。」

3. **設問追加フォーム** (クライアント側で処理)
   - 設問文 [text] required
   - 種別 [select: single_choice | multiple_choice | text | scale]
   - 表示順序 [number]
   - 属性キー [text] optional
   - 選択肢 [textarea] (JSON または改行区切り)
   - ボタン: 「設問を追加」(type="button" 非 POST)

4. **操作ボタン**
   - 「作成する」(type="submit") → POST に設問 JSON を含める
   - 「キャンセル」(link to /admin/daily-surveys)

**クライアント側の一時状態管理**:
- `window.tempQuestions = []` : {question_text, question_type, answer_options, attribute_key, sort_order} の配列
- 「設問を追加」ボタン: `addTempQuestion()` 関数でバリデーション → 配列に追加 → テーブル再描画
- 「設問を削除」ボタン（表示用）: テンポラリ配列から削除 → テーブル再描画
- フォーム submit 時: `<input type="hidden" name="temp_questions_json">` に JSON をセット

## API / Server Actions

### POST /admin/daily-surveys (既存の create route)

**入力**:
```json
{
  "title": string,
  "description": string | null,
  "reward_type": "fixed" | "random",
  "reward_points": number,
  "reward_min_points": number,
  "reward_max_points": number,
  "target_segment_id": string | null,
  "expires_at": string (ISO 8601) | null,
  "notification_template_id": string | null,
  "answer_ui_preset": "casual" | "standard" | "formal",
  "placement": "queue" | "date" | "none",
  "scheduled_date": string (YYYY-MM-DD) | null,
  "slot": "morning" | "evening" | null,
  "temp_questions_json": string (JSON array) | null
}
```

**temp_questions_json の形式**:
```json
[
  {
    "question_text": "今日食べたものは?",
    "question_type": "single_choice",
    "answer_options": [{"label": "朝食", "value": "breakfast"}, ...],
    "attribute_key": "meal_type" | null,
    "sort_order": 10
  },
  ...
]
```

**出力** (成功時):
- HTTP 302 redirect to `/admin/daily-surveys/{surveyId}/edit`

**出力** (エラー時):
- HTTP 400: バリデーションエラー（タイトル未入力、設問の形式エラー等）
  ```json
  { "error": "Error message" }
  ```
- HTTP 500: サーバーエラー

**認可**: 管理者のみ（既존 `/admin` ページ権限で保護）

**処理の流れ**:
1. dailySurveyService.create() で survey レコード作成
2. temp_questions_json が存在し、Array.isArray() なら、ループして dailySurveyService.createQuestion() を一括実行
3. 全成功時に `/admin/daily-surveys/{surveyId}/edit` へリダイレクト
4. createQuestion() の失敗時は HTTP 400 で返す（DB transaction で一括ロールバック or 個別エラー報告）

## DB

**変更なし**。既存テーブル構造（`daily_surveys`, `daily_survey_questions`）を流用。

新規設問は既存の `dailySurveyService.createQuestion()` で一件ずつ INSERT するだけ。

## 権限

| 操作 | 管理者 |
|---|---|
| 新規デイリー作成（設問含む） | ✓ |
| 作成時に設問を同時追加 | ✓ |

**RLS**: なし（管理画面のため DB RLS ではなく Express middleware で保護）

## 受け入れ条件

- [ ] 新規作成画面（/admin/daily-surveys/new）で、タイトルを入力した状態で「設問を追加」フォームが見える
- [ ] 設問文を入力して「設問を追加」ボタンを押すと、サーバーへ POST されず、画面内の設問一覧テーブルにすぐ表示される（1行追加される）
- [ ] 設問リストに複数の設問を追加でき、それぞれ順序・種別・選択肢数が表示される
- [ ] 設問リストの「削除」ボタンを押すと、一時状態から削除され、テーブルから消える
- [ ] 「作成する」ボタンを押すと、基本設定 + 全設問をサーバーに送信し、1つの POST リクエストで処理される
- [ ] 成功時は自動的に編集画面（/admin/daily-surveys/{id}/edit）にリダイレクトされ、追加された設問が表示される
- [ ] タイトルが未入力のまま「作成する」を押すと、フォーム side validation（HTML required 属性）で送信が止まる
- [ ] 設問を1つも追加しないまま「作成する」を押した場合、基本設定だけで survey が作成される（設問なしの状態）
- [ ] ページをリロード（F5）した場合、一時状態の設問は消える（localStorage には保存しない）
- [ ] キャンセルボタンで /admin/daily-surveys 一覧に戻る

## 実装指示

### 実装順序

1. **form.ejs の修正** (UI層)
   - `<% if (mode === 'edit' && survey) { %>` の条件を `<% if (!survey) { ... %>` か別フラグに変更し、新規作成時からも設問セクションを表示
   - 「設問を追加」フォームの form を削除し、`<form>` → `<div>` に変更（フォーム送信ではなく JavaScript で処理）
   - 「設問を追加」ボタンを `<button type="button" onclick="addTempQuestion()">` に変更
   - 設問テーブルにも「削除」アクション追加（`<button type="button" onclick="deleteTempQuestion(index)">`)
   - メインフォーム末尾に隠し input 追加: `<input type="hidden" name="temp_questions_json" id="temp_questions_json">`
   - メインフォーム onsubmit に JavaScript フック追加（設問 JSON をセット）

2. **form.ejs の JavaScript** (クライアント側ロジック)
   - グローバル変数 `window.tempQuestions = []` 初期化
   - `function addTempQuestion()`
     - form 要素から入力値をパース（question_text, question_type, answer_options, attribute_key, sort_order）
     - 簡易バリデーション（question_text 必須、answer_options のパース）
     - バリデーション失敗時 alert() で通知
     - 成功時 `tempQuestions.push(...)` で配列に追加
     - `renderTempQuestionTable()` を呼んで再描画
     - フォーム要素をリセット（input, textarea の value = ''）
   - `function deleteTempQuestion(index)`
     - 配列から指定 index を削除
     - `renderTempQuestionTable()` を呼んで再描画
   - `function renderTempQuestionTable()`
     - テーブル tbody の innerHTML をクリア
     - tempQuestions をループし、各行を `<tr>` で生成して追加
     - 「削除」ボタンのクリックハンドラを `onclick="deleteTempQuestion(${i})"`
   - メインフォームの onsubmit ハンドラ追加:
     ```javascript
     document.getElementById('mainForm').addEventListener('submit', function(e) {
       const jsonInput = document.getElementById('temp_questions_json');
       jsonInput.value = JSON.stringify(tempQuestions);
       // form submit 続行
     });
     ```

3. **adminController.ts の postDailySurvey() 修正** (サーバー側ロジック)
   - リクエストボディから `temp_questions_json` パラメータを取得
   - `JSON.parse()` で配列にデシリアライズ（エラー時は 400）
   - survey 作成後、`temp_questions_json` が存在＆非空なら、ループして `dailySurveyService.createQuestion()` を呼び出し
   - 各 createQuestion() の入力値を検証（answer_options の形式等は既存の createDailySurveyQuestion() 処理と統一）
   - エラー時の扱い: 
     - 軽微（パース失敗など）→ 400 で即座に返す
     - DB エラー（survey は作成されたが question 作成で失敗）→既に作成された survey を削除するか、エラーメッセージで返す（transaction 推奨）
   - 全成功時は既存通り `/admin/daily-surveys/{survey.id}/edit` へリダイレクト

4. **テスト・確認**
   - ブラウザで /admin/daily-surveys/new を開く
   - 基本設定を入力
   - 設問を複数追加して、テーブルに表示されることを確認
   - 設問を削除して、テーブルから消えることを確認
   - 「作成する」を押して、POST が実行されて編集画面にリダイレクトされることを確認
   - ブラウザの Network タブで `temp_questions_json` が含まれていることを確認
   - 編集画面で設問が正しく保存されていることを確認

### 規約・コードベース方針

- **既存ファイル変更**: `src/views/admin/daily-surveys/form.ejs` / `src/controllers/adminController.ts` のみ
- **新規ファイル作成**: なし（JavaScript は form.ejs の `<script>` 内に記述）
- **命名規約**: 
  - JavaScript 関数: camelCase (`addTempQuestion`, `deleteTempQuestion` など)
  - HTML id: kebab-case → temp_questions_json (既存の hidden input 命名に合わせる)
  - 変数: camelCase
- **バリデーション**: 
  - クライアント側: 簡易（question_text 必須、answer_options のパース試行）
  - サーバー側: 既存の createDailySurveyQuestion() の入力検証を流用（ボディ受け取り側で再検証）
- **エラーハンドリング**: 
  - クライアント側: バリデーション失敗時 `alert("エラーメッセージ")`
  - サーバー側: 既存の HttpError / res.status(400).json({error: "..."}) パターンに統一

### 禁止事項

- **既存の設問管理フロー（編集時）を変えない**。`mode === 'edit'` 時の「編集画面で設問追加→リダイレクト」は現在通り。
- **設問を localStorage に保存しない**。ページリロード時は一時状態が消える（意図的）。
- **サーバー側で createQuestion() を複数回呼び出す際に transaction を使わない**（既存実装がトランザクション未使用のため、整合性を保つ）。

### 完了確認

1. **TypeScript / Lint**: `npx tsc --noEmit` / `npm run lint` で エラーなし
2. **Build**: `npm run build` で エラーなし
3. **受け入れ条件の確認** (ブラウザで実測)
   - 上記「受け入れ条件」セクションの全チェック項目を実機で確認
4. **リグレッション確認**
   - 既존 編集画面（/admin/daily-surveys/{id}/edit）で設問を編集・削除・追加できることを確認
   - 既存 일本 일론일（/admin/daily-surveys）で一覧表示・削除・配信ができることを確認
