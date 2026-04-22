Prompt & Conversation Control Architecture（決定版）
目的

本セクションでは以下の責務を明確に分離し、拡張可能で安定した設計とする：

survey / interview の表示差分
Probe Generation（深掘り生成）
Answer Quality Evaluation（回答評価）

従来のようにこれらを単一の prompt や service に混在させるのではなく、
責務ごとに独立したレイヤーとして設計する。

基本方針

会話制御は以下の3レイヤーで構成する：

Rendering（表示）
Control（進行制御）
Evaluation（評価）

これらは必ず一方向のパイプラインとして実行する。

User Answer
   ↓
[Evaluation]
   ↓
[Control]
   ↓
[Rendering]
   ↓
Next Message
1. Answer Evaluation Layer
役割

ユーザー回答の品質を評価することに特化する。
会話制御や表示には関与しない。

責務
回答の質の評価（S / A / B / C / D）
回答の弱さ判定（isWeak）
改善ヒント生成
情報密度・具体性などのスコアリング
出力フォーマット
type AnswerEvaluationResult = {
  score: "S" | "A" | "B" | "C" | "D"
  isWeak: boolean
  reason: string
  improvementHint?: string
}
評価軸
具体性（specificity）
意図適合（intent fit）
情報量（information density）
誠実さ（sincerity）
ビジネス活用性（business usability）
2. Conversation Control Layer
役割

次に何をするかを決定する。
唯一「分岐」を持つレイヤー。

責務
深掘りするか判定
次の質問へ進むか判定
セッション終了判定
probe回数制御
入力
AnswerEvaluationResult
現在のプローブ回数
プロジェクト設定（probe_policy）
判定ロジック

以下の条件を統合して判断する：

isWeak == true
short_answer_min_length
抽象回答パターン
max_probes_per_answer
max_probes_per_session
user_declined 判定
出力例
type NextAction =
  | { type: "PROBE"; promptHint: string }
  | { type: "NEXT_QUESTION" }
  | { type: "END" }
3. Question Rendering Layer
役割

ユーザーに見せるメッセージを生成する。
ロジックを持たない純粋な表示レイヤー。

責務
survey / interview の文面切り替え
表示フォーマット整形
不要な記号（Q1など）の除去
表示ルール
survey
簡潔
指示的
ノイズなし
interview
会話的
自然な日本語
共感表現あり
4. Probe Generation Policy
基本方針

Probe（深掘り）はEvaluationとControlの結果として発生する副作用とする。
独立した責務として扱わない。

ルール
1回につき1問のみ生成
「why / where / situation」にフォーカス
回答改善を優先
新しい話題は広げない
禁止事項
強制的な深掘り
複数質問同時生成
評価なしでの深掘り
5. Prompt Builder の責務再定義
役割

promptBuilder は「ロジックを持たないテンプレート管理層」とする。

許可する責務
評価用プロンプト生成
深掘り用プロンプト生成
表示用テンプレート生成
禁止する責務
分岐判断
状態管理
probe実行可否の決定
6. survey / interview 表示差分
方針

表示差分は Rendering Layer のみで制御する。
Control や Evaluation に影響させない。

実装ルール
同一 question を mode によって変換する
question 本文は共通データを使用
UI 表現のみ変える
7. 実装構成
新規サービス
answerEvaluationService.ts
conversationControlService.ts
questionRendererService.ts
既存修正
conversationOrchestratorService.ts

処理順：

evaluateAnswer()
→ decideNextAction()
→ renderQuestion()
8. 設計上の重要ルール
ルール1：責務の混在禁止
Evaluation は評価のみ
Control は判断のみ
Rendering は表示のみ
ルール2：一方向データフロー

逆流は禁止：

Rendering → Control → Evaluation
（NG）
ルール3：プロンプトは補助
ロジックはコードで持つ
プロンプトに依存しない
9. 今後の拡張性

本設計により以下が容易になる：

AIモデル変更（GPT → Claude等）
評価ロジックの改善
深掘りアルゴリズムの変更
UI変更（LINE / LIFF / Web）
まとめ

本設計では：

「評価」
「制御」
「表示」

を完全分離し、

AI依存の曖昧な制御から、コードベースの安定した制御へ移行する。