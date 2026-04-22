## 深掘り処理の現状整理

### 採用する本流
深掘りの送信・状態更新・回答反映は `conversationOrchestratorService.ts` を本流とする。

### 現行の深掘り送信
`analysisAction === "probe"` の場合、`suggested_probe_question` を優先して送信する。  
` suggested_probe_question` が空の場合は `buildStructuredProbeFallback()` によりフォールバック文面を生成する。  
送信後は `current_phase: "ai_probe"` に更新し、以下を `state_json` に保存する。

- `pendingQuestionId`
- `pendingProbeQuestion`
- `pendingProbeSourceQuestionId`
- `pendingProbeSourceAnswerId`
- `pendingProbeReason`
- `pendingProbeType`
- `pendingProbeMissingSlots`
- `aiProbeCount`
- `aiProbeCountCurrentAnswer`

### suggested_probe_question の扱い
AI判定結果からの深掘り質問文は `extractSuggestedProbeQuestion()` で取り出す。  
また、`buildStructuredAnswer()` で `normalized_answer.suggested_probe_question` に保存する。

### ai_probe フェーズでの挙動
`current_phase === "ai_probe"` のときは、ユーザーの追加入力を `ai_probe` 回答として保存する。  
その後、元の primary 回答の `normalized_answer` を更新し、必要であれば次の深掘りを再判定する。  
深掘り不要になった場合は `advanceAfterProbeOrComplete()` に進める。

### 改修方針
`conversationRuntimeService.ts` に残っている旧/別系統の深掘り処理  
（`aiService.generateProbeQuestion` を直接呼び、`pendingProbeQuestion` を保存する処理）は、  
新しい `conversationOrchestratorService.ts` の責務と重複するため、今後の正規ルートとしては使用しない。

### ルール
- 深掘り質問の生成元は `buildStructuredAnswer()` の AI 判定結果を正とする
- 深掘り送信は `maybeAskProbe()` に集約する
- セッション状態の更新は `conversationOrchestratorService.ts` 側で統一する
- `conversationRuntimeService.ts` 側に旧深掘り経路が残っている場合は削除、または未使用化する
- `pendingProbeQuestion` を更新する処理は 1 系統に限定する

### 結論
`conversationOrchestratorService.ts` の現行実装は基本的にこのままでよい。  
改善するなら、`conversationRuntimeService.ts` 側の旧深掘り経路を廃止し、  
深掘りの生成・送信・状態管理を `conversationOrchestratorService.ts` に一本化する。