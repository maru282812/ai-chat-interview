# 実装計画：条件制御のサーバー権威化（方向A）＋ carry-forward

作成日: 2026-07-03 / 前提: [spec-conditional-question-control.md](./spec-conditional-question-control.md) 方向A採用
方針: サーバー `questionEngine.ts` を制御ロジックの「正」にし、クライアント(survey.ejs)は描画に徹する。
これにより §3-1 二重実装ドリフト・§3-2 クライアント改変・§3-3 includes欠落 を同時に解消し、carry-forward の土台を作る。

---

## ゴール状態

- 「この設問を表示するか / 設問文・コメント / 選択肢集合（disable・carry-forward・ans差し込み反映済み） / 次の設問」を
  **サーバーが1つのエンジンで解決**し、解決済みビューをクライアントへ返す。
- クライアントは入力ウィジェットの描画と回答送信のみ。可視性・分岐・選択肢加工の判定JSを撤去。
- 回答保存時に**サーバーが可視性を再検証**し、本来出ない設問への回答を拒否。
- LINE会話経路も同一エンジンを使い、branchだけでなく visibility/ans/carry-forward を反映。

---

## Phase 0 — 共有エンジンを「正」に拡張（純関数・DB/HTTP非依存）

対象: [src/lib/questionEngine.ts](../src/lib/questionEngine.ts)（＋新テスト）

- `resolveQuestionView(question, ctx)` を新設。返り値:
  ```ts
  interface ResolvedQuestionView {
    visible: boolean;
    questionText: string;        // <ans> 差し込み済み
    commentTop: string | null;   // 同上
    commentBottom: string | null;
    options: ResolvedOption[];   // disable除外・carry-forward適用・choice_labelへの<ans>適用済み
  }
  ```
- 既存純関数（`isQuestionVisible` / `applyAnswerInsertions` / `filterEnabledChoices` / `resolveNextQuestionCode`）を
  この高レベル関数の内部部品として結線（現状デッドコードを本採用）。
- `<ans>` の `target=choice_label` / `choiceIndex` を解釈（§3-4 の穴埋め）。
- MA含有 `q1 includes n` はサーバー版に既存（§3-3）。クライアント撤去で自動的に正になる。
- carry-forward 評価関数 `applyCarryForward(options, ctx, source)` を用意（タグ結線は Phase 3、関数だけ先に）。
- テスト: 可視性/差し込み/disable/carry-forward/分岐 の単体。

## Phase 1 — サーバーAPIで解決済みビューを配る

対象: [src/controllers/liffController.ts](../src/controllers/liffController.ts) / liffRoutes / answer 取得repository

- サーバーで **AnswerContext を永続回答から再構築**（carry-forward が生値を必要とするため）。
- エンドポイント:
  - `GET /liff/survey/:assignmentId/next`（初回・再開）→ 最初の可視設問の `ResolvedQuestionView`。
  - `POST /liff/survey/:assignmentId/answer`（既存拡張）→
    1) **可視性再検証ゲート**: 回答対象設問が現ctxで不可視なら 409 で拒否（§3-2）。
    2) 回答保存。
    3) 次の可視設問を `resolveQuestionView` で解決して返す（`{ next: ResolvedQuestionView | null }`）。
- `branch_rule` 評価もここでサーバー一元化（LIFF survey経路の `resolveNext` を代替）。

## Phase 2 — クライアント thin 化（survey.ejs）

対象: [src/views/liff/survey.ejs](../src/views/liff/survey.ejs)

- `survey_question` / `interview_chat`: `isVisible`/`applyAns`/`filterChoices`/`resolveNext` を撤去し、
  サーバー返却の `ResolvedQuestionView` をそのまま描画。入力UIビルダーは残す。
- `survey_page`（ページ一括）: **同一ページ内は round-trip できない**ため、
  - ページ内の可視性トグルはクライアント維持（従来通り）。
  - ただし送信時にサーバーが可視性を再検証（整合はサーバーが最終権威）。
  - **carry-forward はページを跨ぐ場合のみサポート**（同一ページ内の前設問からの持ち越しは非対応＝制約として明記）。

## Phase 3 — carry-forward（選択肢の持ち越し）新規

- タグ: `<carry q1>`（前問で選んだものだけ）/ `<carry q1 mode=unselected>`（選ばなかったものだけ）。
- 型: `DisplayTagsParsed.optionSource?: { fromQuestion: string; mode: "selected" | "unselected" }`
  （[src/types/questionSchema.ts](../src/types/questionSchema.ts)）。**保存先は display_tags_parsed に載せDBマイグレーション不要**（要確認）。
- パーサ: [src/lib/tagParser.ts](../src/lib/tagParser.ts) に `<carry ...>` 解釈を追加。
- エンジン: `applyCarryForward` が `ctx.answers[fromQuestion]` を基底 options で絞り込み（value整合・順序保持）。
- 管理UI: [formV3.ejs](../src/views/admin/questions/formV3.ejs) 「3. 分岐・表示制御」に「選択肢の持ち越し元」セレクタ＋モード。
- バリデーション: 持ち越し元が前方の choice系設問であること（[surveyValidation.ts](../src/lib/surveyValidation.ts) に依存チェック追加）。

## Phase 4 — LINE会話経路の統一

対象: [src/services/conversationOrchestratorService.ts](../src/services/conversationOrchestratorService.ts) / [questionFlowServiceV2.ts](../src/services/questionFlowServiceV2.ts)

- 次設問選定時に不可視設問をスキップ（`resolveQuestionView().visible` を使用）。
- 設問文へ `<ans>` 差し込み・carry-forward を反映してから配信。

---

## 確定した設計判断（2026-07-03）

1. **スコープ順** → **Phase0-2 先行**。ドリフト+改変を先に潰し、carry-forward(Phase3) は次バッチ。
2. **carry-forward 保存先** → **display_tags_parsed に `optionSource` を追加**（DBマイグレーション無し）。
3. **survey_page の同一ページ内 carry-forward** → **非対応（ページ跨ぎのみ対応）で確定**。

## 進捗

- ✅ **Phase 0 完了**（2026-07-03）: `questionEngine.ts` に `resolveQuestionView` / `applyCarryForward` を追加し、
  既存デッドコード（isQuestionVisible / applyAnswerInsertions / filterEnabledChoices）を本採用。
  `<ans>` を選択肢ラベルにも適用。`optionSource` 型を questionSchema に追加。
  テスト `src/tests/questionEngine.test.ts` 9件パス・typecheck クリーン。DB/HTTP 非依存の純関数のみ（挙動未変更）。
- ✅ **Phase 1 完了**（2026-07-03）: サーバーフロー・サービス `src/services/surveyFlowService.ts`
  （`buildAnswerContext` / `computeNextView` / `resumeView` / `answerValueForContext`）を新設。分岐は questionDesign の
  堅牢版 resolveNextQuestionCode（LINE会話と同一）を再利用、可視性/差し込み/carry-forward/disable は
  `resolveQuestionView` に委譲。`POST /liff/survey/answer` を拡張し、①**可視性ゲート**（不可視設問への回答を 409 で拒否・
  条件なし設問は素通し）②回答後に**次設問の解決済みビューを `next` で返却**（現行クライアントは無視＝後方互換）。
  クライアントが配列をカンマ結合文字列で送る点に合わせ型ベースで array/scalar を復元。
  テスト `surveyFlowService.test.ts` 7件＋全263件パス・typecheckクリーン。
  **`GET /survey/:id/next` は消費者が定義される Phase 2 に延期**（未消費APIの増設回避。`resumeView` は先行実装済み）。
- 🟡 **Phase 2（サーバー基盤）完了・クライアント消費は未**（2026-07-03）:
  - **重要発見**: surveyPage はクライアントへ全設問ではなく **フェーズ絞り込み（screening/main）＋ブロック/選択肢ランダム化済み** の
    部分集合 `renderQuestions` を渡す（surveyOrderingService は初回のみ session に順序を永続化し以降は決定的に再利用）。
    Phase1 の `next` は `listByProject`（全設問）で計算しており、クライアントが消費すると集合・順序がズレる欠陥があった。
  - 対処: `surveyFlowService` に `selectPhaseQuestions` / `resolveOrderedRenderSet` を追加し、フロー側でも同一集合・順序を再現。
    `computeNextView` を sort_order 直接比較から **表示順(index)ベース**へ修正（ランダム化耐性）。
    `submitSurveyAnswer` の `next` をフェーズ絞り込み済みセットで解決するよう修正。
    `surveyPage` を `selectPhaseQuestions` 共有へリファクタ（挙動不変・重複削減）。
  - `GET /liff/survey/:assignmentId/next` を新設（初回・再開用。`resumeView` で未回答かつ可視の最初の設問ビューを返す）。
  - テスト 11件（surveyFlowService）＋全267件パス・typecheck クリーン。**すべて後方互換**（現行クライアントは `next`/GET を未使用）。
  - ⬜ **残: クライアント thin 化**（survey.ejs から isVisible/applyAns/filterChoices/resolveNext を撤去し、
    初回=GET /next、以後=POST /answer の `next` を描画。survey_question→interview_chat の順。survey_page はページ内可視性のみ
    クライアント維持）。**3モード×主要設問タイプ×probe のブラウザE2E検証が必須**のため、実機/Playwright 検証とセットで実施する。
- ⬜ Phase 4 LINE会話統一 は未着手。

## 影響・リスク

- survey.ejs は大きめの改修（判定JS撤去＋描画をサーバー返却駆動へ）。回帰テスト範囲: 3表示モード×主要設問タイプ。
- 1問ずつモードは round-trip 増だが、既に `/liff/survey/answer` を都度叩いており増分は小さい。
- testmaster 台帳の該当項目 fingerprint が変わる（再テスト対象化）。
</content>
