# 設問の条件制御（表示・分岐・差し込み・選択肢持ち越し）現状精査と不足機能

作成日: 2026-07-03 / 対象ブランチ: feat/statistical-export-engine
目的: 「回答結果に応じて設問文/選択肢を変える」制御が **どこまで動き、どこで途切れているか** をコード実測で確定し、
アンケート/インタビューで不足している機能を棚卸しする。DB変更・実装はまだ行わない（調査のみ）。

---

## 0. 用語（このドキュメント内）

| 機能 | 意味 | ユーザー要望との対応 |
|---|---|---|
| **表示条件 (visibility / `<pipe>`)** | 「Bと答えた人にだけこの設問を出す」 | 要望① |
| **差し込み (`<ans q●●>`)** | 回答値を設問文/選択肢ラベルに埋め込む | 要望①（文章を変える） |
| **進行分岐 (`branch_rule`)** | 「Bと答えたら設問Xへ飛ぶ」 | 要望①（遷移） |
| **選択肢無効化 (`<disable>`)** | 条件を満たしたら選択肢を1つ消す（減算） | 要望②に近いが別物 |
| **選択肢持ち越し (carry-forward)** | 前問で選んだC,Dだけを次問の選択肢にする | **要望②そのもの・未実装** |
| **排他 (exclusive)** | 同時に選べない選択肢（回答時制約） | 参考 |

---

## 1. アーキテクチャ：回答UIは2経路ある

```
                       ┌────────────────────────────────────────────┐
   回答者              │ LIFF webview  = src/views/liff/survey.ejs   │  ← 主経路
                       │  survey_question / interview_chat 両モード   │
                       │  設問を一括ロードし、進行はブラウザ内JSで判定 │
                       └───────────────┬────────────────────────────┘
                                       │ fetch
        ┌──────────────────────────────┼──────────────────────────────┐
        ▼                              ▼                              ▼
 POST /liff/survey/answer      POST /liff/chat                judge-screening / complete
 （回答保存・表示条件の         （AI深掘り＝                    （通過判定・完了）
   再検証なし）                  conversationOrchestratorService）
```

- **進行ロジック（表示条件・差し込み・disable・分岐）は survey.ejs のクライアントJSで実行される。**
  - `isVisible()` [survey.ejs:710](../src/views/liff/survey.ejs#L710)
  - `applyAns()` [survey.ejs:718](../src/views/liff/survey.ejs#L718)
  - `filterChoices()`（`<disable>`）[survey.ejs:731](../src/views/liff/survey.ejs#L731)
  - `resolveNext()`（`branch_rule`）[survey.ejs:740](../src/views/liff/survey.ejs#L740) / 呼び出し [survey.ejs:1690](../src/views/liff/survey.ejs#L1690), [survey.ejs:2260](../src/views/liff/survey.ejs#L2260)
- サーバー側 `src/lib/questionEngine.ts` に**同じ4機能の純関数が別実装で存在するが、ランタイムからは呼ばれていない**（後述 §3）。
- `conversationOrchestratorService`（LINEサーバー会話）は `branch_rule` のみ利用し、表示条件・差し込み・disable は適用しない。

---

## 2. 機能別・配線状況マトリクス（＝どこで途切れているか）

| 機能 | 型/データ | パーサ | 管理画面UI | サーバー純関数 | **LIFFクライアント(本番)** | サーバー会話(LINE) | サーバー再検証 |
|---|---|---|---|---|---|---|---|
| 表示条件 `<pipe>` | ✅ `visibility_conditions` | ✅ | ✅ [formV3:847](../src/views/admin/questions/formV3.ejs#L847) | ✅ `isQuestionVisible`（未使用） | ✅ `isVisible` | ❌ | ❌ |
| 差し込み `<ans>` | ✅ `answerInsertions` | ✅ | ✅ [formV3:996](../src/views/admin/questions/formV3.ejs#L996) | ✅ `applyAnswerInsertions`（未使用） | ✅ `applyAns` | ❌ | ― |
| 進行分岐 `branch_rule` | ✅ | ✅ | ✅ [formV3:794](../src/views/admin/questions/formV3.ejs#L794) | ✅ `resolveMatchedBranchCode` | ✅ `resolveNext` | ✅ [questionFlowServiceV2:202](../src/services/questionFlowServiceV2.ts#L202) | ✅（会話側のみ） |
| 選択肢無効化 `<disable>` | ✅ `disableRules` | ✅ | △（タグ直書き想定） | ✅ `filterEnabledChoices`（未使用） | ✅ `filterChoices` | ❌ | ❌ |
| **選択肢持ち越し carry-forward** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| 排他 exclusive | ✅ `exclusive/exclusive_with` | ― | ✅ プレビュー [formV3:506](../src/views/admin/questions/formV3.ejs#L506) | ✅ `optionExclusion.ts` | ✅ | ― | △ |

凡例: ✅=あり / △=部分的 / ❌=なし / （未使用）=定義済みだが実行経路から未呼び出し

---

## 3. 「途切れている」箇所の具体

### 3-1. サーバー純関数 `questionEngine.ts` が丸ごとデッドコード（本番未使用）
`isQuestionVisible` / `applyAnswerInsertions` / `filterEnabledChoices` / `filterVisibleQuestions` / `groupQuestionsByPage`
は [questionEngine.ts](../src/lib/questionEngine.ts) に実装・テスト済みだが、
リポジトリ全文検索で呼び出し元は `questionDesign.ts`（branch正規化のみ）と自テストだけ。
**実際の回答フロー（liffController / liffService）からは1つも呼ばれていない。**

→ つまり「表示条件・差し込み・disable」は **survey.ejs のJSに再実装されたコピーだけが本番で動いている**。
ロジックが2箇所に分岐しており、**片方だけ直すとドリフトする**（例: サーバー版は `q1 includes 1` 対応、クライアント版は未対応 — §3-3）。

### 3-2. 制御が完全にクライアント権威（サーバー再検証なし）
`POST /liff/survey/answer` [survey.ejs:1218](../src/views/liff/survey.ejs#L1218) は回答を保存するが、
`visibility_conditions` を再評価して「本来出ないはずの設問への回答」を弾く処理は無い。
`filterChoices`(disable) / `isVisible` はブラウザ内でのみ効くため、**改変リクエストで無効化・非表示設問を回答できる**。
分岐 `branch_rule` は会話経路 [questionFlowServiceV2:202](../src/services/questionFlowServiceV2.ts#L202) ではサーバー評価されるが、
LIFF survey経路では `resolveNext` がクライアント判定。**同じ分岐が経路によって評価場所が違う。**

### 3-3. クライアント `evalPipe` の式サポートがサーバー版より狭い
- サーバー `evalExpr` [questionEngine.ts:99](../src/lib/questionEngine.ts#L99) は `q1 includes 1`（MA含有）に対応。
- クライアント `evalPipe` [survey.ejs:681](../src/views/liff/survey.ejs#L681) は比較演算子のみで **`includes` 非対応**。
  → multi_choice を条件にした `<pipe>` 表示条件は、LIFFで意図通り効かない可能性。

### 3-4. `<ans>` の差し込み先 target が実質「本文置換」だけ
型 `AnswerInsertion.target` は `question_text / comment_top / comment_bottom / choice_label` を定義 [questionSchema.ts:143](../src/types/questionSchema.ts#L143) だが、
クライアント `applyAns` は渡された文字列を正規表現置換するだけで、**`choice_label`（選択肢ラベルへの差し込み）や `choiceIndex` を解釈していない**。

### 3-5. `<disable>` は要望②を満たさない
- `DisableRule` は `{ targetChoice, condition }` の**1選択肢×1条件の減算**（型コメントも「マトリクス系の行/列非表示」用途）[questionSchema.ts:160](../src/types/questionSchema.ts#L160)。
- 「前問で選んだC,Dだけ残す」を disable で書くには **全選択肢に「前問で選ばれなかったら消す」条件を個別付与**する必要があり、選択肢が増えると破綻。動的な「選んだものだけ」を表現する仕組みがない。

### 3-6. carry-forward（要望②）は全レイヤーで不在
型・パーサタグ・純関数・クライアントJS・管理UI のいずれにも「前問の**選択結果**を次問の選択肢集合に流し込む」機構が無い。
`PipingCondition` 型 [questionSchema.ts:122](../src/types/questionSchema.ts#L122) は名前が紛らわしいが**表示制御用**で、選択肢の持ち越しではない。

---

## 4. アンケート/インタビューで不足している機能（棚卸し）

「今すぐ要る」を◎、「よくある要望」を○、「将来」を△で優先度目安。

### 4-A. 設問ロジック系
- ◎ **carry-forward / 選択肢の持ち越し**（要望②）: 前問の選択・非選択・順位を次問の選択肢集合にする。ループ設問（選んだブランドごとに深掘り）の前提。
- ◎ **条件制御のサーバー権威化 or 再検証**: 表示条件・disable・分岐を保存時に再評価し、クライアント改変・ドリフトを防ぐ（§3-2）。
- ○ **`<pipe>` の MA(includes) 対応をクライアントにも**（§3-3）。
- ○ **選択肢/設問ブロックのランダム表示（順序ランダム化）**: 現状 `<fix>`/`<norep>` はあるが順序ランダムは無い（メモの「ブロックランダム化」は次フェーズ）。
- ○ **クオータ/割付（定員制御）**: スクリーニングの pass/fail はあるが「属性ごとの回収上限で締切」は無い。
- △ **constant-sum（合計100%）/ ranking（順位付け）設問タイプ**: 現行 QuestionType [domain.ts:49](../src/types/domain.ts#L49) に無い。
- △ **設問文の A/B や動的テキスト**（差し込み以上の分岐文言）。

### 4-B. 回答体験・運用系
- ○ **途中保存・再開（resume）**: LIFF が全設問一括ロードのため、離脱時の途中復帰の扱いを要確認。
- ○ **「その他（自由記述）」と排他/持ち越しの連携**: 排他は options に無い生テキストをスキップ [optionExclusion.ts:34](../src/lib/optionExclusion.ts#L34)。持ち越し時の扱い未定義。
- △ **回答のバックナビゲーション時の分岐再計算**（戻って回答変更→以降の表示条件/持ち越しの再評価整合）。

### 4-C. インタビュー（AI深掘り）系
- 深掘り自体は `conversationOrchestratorService` で実装済み（プロンプト管理・playground あり）。
- ○ **深掘りへの表示条件/差し込み/持ち越しの反映**: 会話経路は `branch_rule` のみ利用で、visibility/`<ans>`/disable/carry-forward が効かない（§1末尾）。LIFFチャットUIとの評価場所の一貫性を要確認。

---

## 5. 推奨対応順（実装は別タスク）

1. **設計判断①: 制御ロジックの「正」をどこに置くか。**
   案A サーバー `questionEngine.ts` を正にしてAPI化しクライアントは描画のみ / 案B 現状のクライアント権威を維持しつつサーバー再検証を追加。
   → ドリフト（§3-1/3-3）と改変（§3-2）を同時に解くなら案A寄り。
2. **既存機能の配線穴埋め**: `<pipe>` includes 対応、`<ans>` choice_label 対応（§3-3/3-4）。
3. **carry-forward の新規設計**（要望②）: データモデル（例 `option_source: { from_question, mode: selected|unselected }`）＋パーサタグ＋評価＋管理UI。ループ設問と併せて設計。
4. **ランダム化・クオータ**は carry-forward 後に。

---

## 付録: 主要ファイル

| 役割 | ファイル |
|---|---|
| サーバー純関数（未使用の正実装候補） | [src/lib/questionEngine.ts](../src/lib/questionEngine.ts) |
| クライアント実装（本番稼働） | [src/views/liff/survey.ejs](../src/views/liff/survey.ejs) |
| 分岐のサーバー評価（会話経路） | [src/services/questionFlowServiceV2.ts](../src/services/questionFlowServiceV2.ts) |
| 型定義 | [src/types/questionSchema.ts](../src/types/questionSchema.ts) / [src/types/domain.ts](../src/types/domain.ts) |
| タグパーサ | [src/lib/tagParser.ts](../src/lib/tagParser.ts) |
| 排他 | [src/lib/optionExclusion.ts](../src/lib/optionExclusion.ts) |
| スクリーニング判定 | [src/services/screeningService.ts](../src/services/screeningService.ts) |
| 管理フォーム | [src/views/admin/questions/formV3.ejs](../src/views/admin/questions/formV3.ejs) |
</content>
</invoke>
