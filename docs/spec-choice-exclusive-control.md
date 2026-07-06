# 実装仕様書: 複数選択設問の排他制御（exclusive control）

## 目的

複数選択（`multi_choice`）で「同時に選べないはずの組み合わせ」を UI とサーバ検証で防ぐ。
代表例＝「特になし / わからない / 該当なし / その他」を選んだのに A・B も選ぶケース。
加えて「B は C・D と排他」のような**選択肢どうしの部分排他**も表現できるようにする。

## 用語・データモデル

`QuestionOption`（[src/types/domain.ts](../src/types/domain.ts) L324）に2フィールドを追加する。
このリポジトリでは **`option.value === option.label`**（[adminController.ts](../src/controllers/adminController.ts) L1784）なので、
排他参照は既存の anchors / groups / freetext と同じく**ラベル文字列**で持つ。

```ts
export interface QuestionOption {
  value: string;
  label: string;
  allow_free_text?: boolean;
  // ↓ 追加
  /** true の場合、選択すると同一設問の他選択肢を全解除する（特になし/わからない/該当なし/その他）。 */
  exclusive?: boolean;
  /** 特定の選択肢とだけ排他にする value(=label) の配列。B↔[C,D] のような部分排他。評価は双方向（無向）。 */
  exclusive_with?: string[];
}
```

### 排他の評価ルール（フロント・サーバで同一）

2つの選択肢 a, b が「排他（同時選択不可）」であるとは:

```
conflicts(a, b) =
     a.exclusive === true
  || b.exclusive === true
  || (a.exclusive_with ?? []).includes(b.value)
  || (b.exclusive_with ?? []).includes(a.value)
```

- `exclusive: true` は「他全部と排他」の近道。
- `exclusive_with` は**無向**として扱う（片側にだけ書けば両方向に効く）。設定ミス（C側でBを入れ忘れ）を防ぐため。

## スコープ外

- 選択数の上下限（`min_select` / `max_select`）＝**既に実装済み**（formV3 / adminController）。今回は触らない。
- `single_choice`・`matrix_*`（元々ラジオで排他済み／マトリクスは対象外）。
- 選択数制限のフロント/サーバ強制（既存挙動のまま。本件と別issue）。
- 「その他」自由記述の未入力バリデーション（別件）。

## 画面

### 1. 管理: 設問作成/編集フォーム（`/admin/...questions/...`, [formV3.ejs](../src/views/admin/questions/formV3.ejs)）

対象は `multi_choice` のときのみ表示（`single_choice` 等では非表示）。

各選択肢行（`.option-row`）に **折りたたみ（アコーディオン）** で排他設定を追加する。

- 表示項目:
  - 各行に「排他設定 ▸」トグル。**デフォルトは閉じる**（設問作成時の見通しを損なわない）。
  - 排他ルールが設定済みの行には、トグル横に小バッジ（例: `排他` / `排他3`）を常時表示。閉じていても設定済みが分かる。
  - 開くと以下:
    - チェックボックス「この選択肢を選んだら他を全て解除（全排他）」→ `option.exclusive`
    - 「この選択肢と排他にする選択肢」＝**同一設問の他選択肢ラベルをチェックリスト表示**（自分自身は除外）→ `option.exclusive_with`
      - 「全排他」ON のときは個別チェックリストを disabled（全部対象なので無意味なため）。
- 操作:
  - チェック操作は各行の hidden input に直列化（既存の `option_screening_pass` と同じ hidden 方式）。
    - `name="option_exclusive"` 値 `"1" | "0"`（行順）
    - `name="option_exclusive_with"` 値 = 選択ラベルを `,` 連結した文字列（未設定は空文字。行順）
  - 選択肢の追加/削除/ラベル編集に追従: チェックリストは**アコーディオンを開いた時点で現在の選択肢ラベルから動的生成**（stale 回避）。ラベル変更で参照が切れた値は「(削除済み) ラベル名」とグレー表示し、外せるようにする。
  - **デフォルト自動ON**: 新規行のラベルが `/特になし|わからない|該当なし|その他/` に一致、または「自由記述を出す選択肢」に含まれる場合、`option_exclusive` hidden を初期値 `"1"`＋チェック済みで生成。ユーザーは外せる。
- 状態:
  - `multi_choice` 以外を選択中は排他UIブロックごと hidden。
  - 選択肢0件のときは非表示。

### 2. 回答: LIFF アンケート（`/liff/...`, [survey.ejs](../src/views/liff/survey.ejs) `multi_choice`）

- 表示項目: 既存の checkbox 描画（list / card 両対応）。見た目変更なし。
- 操作:
  - checkbox に排他情報を埋め込む: `data-exclusive="1|0"` と `data-exclusive-with="C,D"`（`choiceListItem` と card 分岐の `<input type="checkbox">` に付与）。
  - あるチェックを ON にした瞬間、現在 ON の他選択肢のうち `conflicts()` に該当するものを自動 OFF にする（`.selected` クラスも同期）。
  - 「全排他」選択肢を ON→ 他を全解除。他の通常選択肢を ON→ 既に ON の「全排他」選択肢を解除。
- 状態: 排他情報が無い設問（従来データ）は一切変化しない（後方互換）。

## API / Server Actions

### submitSurveyAnswer（[liffController.ts](../src/controllers/liffController.ts) L1039）

- 種別: Route Handler（既存・追記のみ）
- 入力: `answer_value`（`multi_choice` は配列）
- 追加バリデーション（`question` ロード後 L1063〜upsert 前 L1077 の間に挿入）:
  - 対象設問が `multi_choice` かつ `answer_value` が配列のとき、送信された値集合に対し全ペアで `conflicts()` を評価。
  - 1ペアでも排他違反があれば `400 { ok:false, error:"同時に選択できない選択肢が含まれています。" }` を返し **upsert しない**。
  - 送信値のうち config.options に無い値（＝「その他」自由記述の生テキスト）は排他判定の対象外としてスキップ（allow_free_text 由来のため）。
- 認可: 既存の `verifyAssignmentOwnerOrThrow` のまま（変更なし）。
- 出力: 成功 `{ ok:true }`（変更なし）/ 排他違反 `400`。

> フロント制御はJSを無効化・直叩きで回避可能なため、サーバ側検証は必須（二重防御）。

## DB

**マイグレーション不要**。`options` は `question_config`(JSONB) 内の配列で、`exclusive` / `exclusive_with` は追加キーのため既存行と互換。

| テーブル | カラム | 型 | 制約 | 用途 |
|---|---|---|---|---|
| questions | question_config.options[].exclusive | bool(JSON) | 任意 | 全排他フラグ |
| questions | question_config.options[].exclusive_with | string[](JSON) | 任意 | 部分排他の相手ラベル |

## 権限

| 操作 | 管理者 | 回答者(LIFF) |
|---|---|---|
| 排他設定の編集 | ○ | × |
| 排他違反の回答送信 | – | ×（400で拒否） |

RLS方針: 変更なし（questions 編集は既存の管理者権限、回答は既存の assignment 所有者検証を踏襲）。

## 受け入れ条件

- [ ] `multi_choice` の設問編集で、各選択肢に「排他設定」アコーディオンが出る（`single_choice` では出ない）。
- [ ] 「特になし」等のラベルで新規行を足すと、全排他チェックが初期ON。
- [ ] 「B」を開き C・D にチェック→保存→再表示で C・D がチェック済み（`options[B].exclusive_with = ["C","D"]`）。
- [ ] C 側を開いていないのに、回答画面で C を選ぶと B が外れる（無向で効く）。
- [ ] 回答画面: 「特になし(全排他)」を選ぶと他が全解除される。他を選ぶと「特になし」が外れる。
- [ ] 排他情報の無い既存設問は挙動が一切変わらない（回答画面・保存とも）。
- [ ] サーバ: 排他違反の値配列を直接 POST すると `400` で拒否され、回答が保存されない。
- [ ] 「その他」自由記述の生テキストが混じっても、排他判定でエラーにならない。
- [ ] `npx tsc --noEmit` / 既存テストスイート pass。

## 実装指示（AIエージェント向け）

### 実装順序

1. **型** [src/types/domain.ts](../src/types/domain.ts): `QuestionOption` に `exclusive?: boolean` と `exclusive_with?: string[]` を追加。
2. **共有判定ユーティリティ** 新規 `src/lib/optionExclusion.ts`:
   - `conflicts(a, b)` と `findExclusionViolation(values: string[], options: QuestionOption[]): [string,string] | null` をエクスポート（純関数）。
   - `src/tests/optionExclusion.test.ts` を追加（全排他 / 部分排他の無向性 / 違反なし / freetext値スキップ の4系統）。
3. **サーバ保存パース** [adminController.ts](../src/controllers/adminController.ts) L1783 の `questionConfig.options = optionLabels.map(...)` に:
   - `option_exclusive`（`option_screening_pass` と同じ配列/文字列正規化）を読み `opt.exclusive = flag`（false のときはキー付けない）。
   - `option_exclusive_with`（行ごとの `,` 区切り文字列 → `splitList`）を読み、空でなければ `opt.exclusive_with = labels`。
   - `MULTI_CHOICE_TYPES.includes(questionType)` のときのみ設定。他型では付けない。
4. **サーバ回答検証** [liffController.ts](../src/controllers/liffController.ts) `submitSurveyAnswer` L1063〜L1077 間に `findExclusionViolation` 呼び出しを追加し、違反時 400。
5. **管理フォームUI** [formV3.ejs](../src/views/admin/questions/formV3.ejs):
   - `.option-row`（L332〜）に排他アコーディオン + hidden `option_exclusive` / `option_exclusive_with` + バッジを追加。
   - 既存の `addOptionRow` / `remove-row` / ラベル入力の JS に、アコーディオン開時のチェックリスト動的生成・hidden 直列化・特定ラベルの自動ON を実装。
   - `multi_choice` 選択時のみ表示するトグル（既存 `typeMultiFields` の show/hide ロジックに相乗り）。
   - 編集時の初期値: `question.question_config.options[i].exclusive` / `exclusive_with` を各行の hidden 初期値に反映（`optionLabels` ループ内で参照）。
6. **回答画面** [survey.ejs](../src/views/liff/survey.ejs):
   - `choiceListItem` と card 分岐の checkbox に `data-exclusive` / `data-exclusive-with` を付与（`multi_choice` のみ）。
   - `bindInputEvents` の checkbox `change` ハンドラ（L1468〜1482）に、ON 時の排他相手 auto-OFF ＋ `.selected` 同期を追加。判定は `conflicts` 同一ロジックをインラインで再現（EJSはTS import不可のため）。card クリック分岐（L1363〜1379）にも同処理を通す。

### 規約

- `option.value === option.label` 前提を崩さない（排他参照はラベル文字列）。
- hidden-per-row 直列化は既存 `option_screening_pass`（formV3 L339 / adminController L1777）の書式に厳密に合わせる。
- ラベル参照分割は既存 `splitList`（adminController L1806）を再利用。
- 新規サーバロジックは純関数化し必ずテストを添える。

### 禁止事項

- DBマイグレーション追加禁止（JSON拡張のみ）。
- `min_select` / `max_select` の既存挙動を変えない。
- 排他情報の無い既存設問の描画・保存・回答フローを1バイトも変えない（後方互換）。
- `single_choice` / `matrix_*` に排他UI・検証を波及させない。

### 完了確認

`npx tsc --noEmit` / `npm run lint` / 既存テストスイート + 新規 `optionExclusion.test.ts` pass、および上記「受け入れ条件」全項目。
