# 実装計画: 表示モード×回答方式の不具合修正（2026-08-06監査対応）

監査結果（memory: `project_display_mode_audit`）のうち、優先①〜⑥を6 Phaseに分けて修正する。
各Phaseは単独で動作確認できる単位。**Phase間にコード依存はほぼ無いが、リスクの低い順に並べてある**（P1→P6の順で進め、各Phase完了ごとにコミットする）。

## 実装目的

- 回答データが「静かに壊れる」経路を塞ぐ（サーバーエラーの握りつぶし・分岐の誤ジャンプ・深掘りによる本回答上書き）。
- 未完成の survey_page モードを管理UIから誤って選べないようにする。
- 無認証の `/liff/chat` に所有者検証を入れる。
- 送付前チェックでモード不整合を検出できるようにする。

## 前提

- 対象ブランチ: main（直近で researchForm に display_mode select を追加済み・未コミット分と競合しないよう注意）。
- dev環境も本番Supabase＋本番LINEチャネル共有。**検証はローカルseam（`tmtest:` Bearer / 偽ユーザー`Uverify_test_001`）を使い、実ユーザーへのpushはしない。**
- `npm test`（5スイート）＋ `npx tsc --noEmit` は現在green。これを維持する。
- 回答保存形式（single=スカラー/multi=カンマ結合/matrix=JSON）は**変更禁止**。統計エクスポート(wide/long/codebook)は凍結契約＝列変更禁止。
- LINE webhook経路（conversationOrchestratorService）は probe を `answerRepository.create` で別行保存している。LIFF経路をこれに揃えるのが Phase 5 の方針。

## 変更対象

| 領域 | 変更有無 | 内容 |
|---|---|---|
| DB | なし | migration不要（answersテーブルの answer_role 列は既存） |
| API | あり | `POST /liff/chat` 認証、`POST /liff/survey/answer` の probe フラグ受け口 |
| UI | あり | researchForm の select ガード、survey.ejs のエラー表示/分岐/probe送信 |
| 型定義 | あり | validateSurvey のシグネチャ変更（project 受領） |

## 実装フェーズ

### Phase 1: survey_page を管理UIから封印（最小リスク・即効）
- 対象: `src/views/admin/projects/researchForm.ejs`
- 内容:
  1. `displayModeOptions` から `survey_page` を削除。ただし**編集対象プロジェクトの現在値が `survey_page` の場合のみ**選択肢に残す（ラベルを「ページ型（レガシー・非推奨）」にする）。こうしないと既存 survey_page 案件の編集保存で値が変わってしまう。
  2. display_mode select の helper-text に追記: 「スワイプ等の回答UIプリセットは『1問1答』でのみ適用されます」（preset の注意書きが折りたたみ内の別セクションにしか無い問題への対処）。
- サーバー側 `parseDisplayMode` は **survey_page を許容したまま**にする（既存データ・将来の再開放のため）。
- 完了条件: 新規作成フォームに survey_page が出ない／既存 survey_page 案件の編集では現在値が保持される／`npx tsc --noEmit` green。

### Phase 2: submitAnswer のエラー検査と表示（沈黙データ欠損の可視化）
- 対象: `src/views/liff/survey.ejs`（`submitAnswer` 約L1402-1424 と呼び出し元）
- 内容:
  1. `submitAnswer` が `response.ok` を検査し、成否を戻り値で返す（`{ok: boolean, status, message}`）。4xx/5xx時はサーバーの `error` メッセージを取り出す。
  2. 呼び出し元での失敗時挙動:
     - **1問1答/ページ型**: 既存の質問カード下にエラー文言を表示し（`answer-error` 等のクラスを新設）、**cursor/pageCursor を進めない**。次へボタンを再有効化して再送可能にする。
     - **チャット**: エラー内容をAIバブルで表示（「送信に失敗しました。もう一度お試しください」）し、`chatQueueIndex` を進めず入力を再有効化する。
  3. ネットワーク例外（現在の catch 節）も同じ扱いに統一。
  4. 401 は既存の再認証フロー（liff-auth.ejs の再取得）があるため壊さないこと。既存の 401 ハンドリング経路を確認してから着手する。
- 完了条件: サーバーを止めた状態/400を返すモックで、回答が消えずにエラー表示＋再送できる（Playwright または手動）。既存の正常フロー（3モード）が回ることをローカルseamで確認。

### Phase 3: 分岐indexの配列統一＋チャットの可視性再評価
- 対象: `src/views/liff/survey.ejs`
- 現状の欠陥:
  - 1問1答: L1892-1897 `resolveNext` の結果を `QUESTIONS.findIndex` で引き、`visibleQs[cursor]` の添字に使っている。
  - チャット: L2455-2458 同じ欠陥＋ `const visibleQs = QUESTIONS.filter(isVisible)`（L2062）が初回固定で再評価されない（1問1答は renderQuestionMode 内で再評価している L1515）。
- 内容:
  1. **「現在位置は question_code で持つ」方針に統一**する。分岐解決後は `visibleQs.findIndex(qq => qq.question_code === nextCode)` で引く。見つからない場合（分岐先が非表示）: `QUESTIONS` 上で nextCode 以降を順に走査し、最初に visible な設問へ進める。それも無ければ完了。
  2. チャットの `visibleQs` を `const` から関数化（`getVisibleQs()`）し、`askCurrentQuestion` / `advanceAfterAnswer` / `sendChatAnswer` / `chatNext` の参照を全て都度評価に変える。index ずれを防ぐため、上記1と同時に「code基準で次を決める」形へ書き換える。
  3. 完了判定（`chatQueueIndex >= visibleQs.length` L2360/L2404）も同関数基準にする。
- 注意: 1問1答の probe フロー（`checkAndShowProbe` が nextCursor を先取りする設計 L1899-1901）を壊さないこと。nextCursor の意味（visibleQs基準）を揃える。
- 完了条件: 分岐ルール＋表示条件を両方持つテスト用設問構成（seedスクリプトに一時追加してよい）で、1問1答/チャットとも正しい設問に遷移し、条件付き設問が回答に応じて出現/消滅する。既存の分岐のみ・条件なし案件の挙動が変わらない。

### Phase 4: POST /liff/chat の認証・所有者検証
- 対象: `src/controllers/liffController.ts`（`chatMessage` 約L1626-）、`src/views/liff/survey.ejs`（probe fetch L2429-2432）
- 内容:
  1. クライアント: probe fetch のヘッダを他APIと同じ `apiHeaders()` に変更（現在は素の Content-Type のみ）。
  2. サーバー: `chatMessage` の冒頭で session→assignment を引き、既存の `verifyAssignmentOwnerOrThrow`（L204）＋ `assertSessionMatchesAssignment`（2026-07-22周回で導入済み）と同じ検証を通す。session に assignment が紐づかない場合は 404。
  3. `LIFF_AUTH_REQUIRED=false` 環境（現dev）で壊れないこと: 検証は他エンドポイントと同じ「authRequired 基準」のロジックを流用する（[[project_liff_auth_gate_mismatch]] の轍を踏まない＝ページ側とサーバー側で判定基準を分けない）。
- 完了条件: 正当なトークンで probe が従来どおり動く／他人の session id＋無関係トークンで 403/404／トークン無しは authRequired 時 401。`tmtest:` seam で自動確認。

### Phase 5: 深掘り回答を answer_role='probe' で別行保存（本回答の上書き防止）
- 対象: `src/controllers/liffController.ts`（`submitSurveyAnswer` L1213-1355）、`src/views/liff/survey.ejs`（チャット L2472-2477 / 1問1答 probe L1830-1862 付近）、`src/repositories/answerRepository.ts`
- 内容:
  1. `POST /liff/survey/answer` の body に `answer_role: 'primary' | 'probe'`（省略時 primary）と `probe_index?: number` を追加。
  2. `answer_role='probe'` のとき: `upsertPrimary` ではなく `answerRepository.create` で **別行**を insert（LINE webhook経路 conversationOrchestratorService.ts:2072 等と同じ形式に揃える。同経路の probe 行の question_code/answer_text/answer_role の詰め方を先に読むこと）。バリデーション（choice値検査等）は probe では**免除**（自由文のため）。ただし所有者検証・409ゲートは維持。
  3. クライアント: probe 中の送信（チャット `sendChatAnswer` が probe 状態のとき／1問1答の probe 送信）に `answer_role:'probe'` を付ける。**`answerCtx.answers[code]` を probe 文字列で上書きしない**（分岐評価は primary の値のまま行う）。probe の表示用テキストは別変数に持つ。
  4. probe後の `current_question_id` 更新は現状維持でよい。
- 注意: 統計エクスポートは primary 行だけを読む前提を確認（`statExport.ts` / `rawdataExport.ts` が answer_role をフィルタしているか必ず先に確認し、フィルタが無ければ `answer_role='primary'` 条件を追加する——**列追加ではなく行フィルタなので凍結契約違反にならない**が、既存probe行（LINE経路由来）の扱いが変わらないことをテストで担保）。
- 完了条件: チャットで choice 設問→深掘り→返信、のあと answers テーブルに primary（選択値）と probe（自由文）が別行で残る。分岐が primary 値で評価される。エクスポートの回帰（statExport.test.ts）green。

### Phase 6: 送付前バリデーションにモード整合チェック
- 対象: `src/lib/surveyValidation.ts`（`validateSurvey` L238-）、`src/controllers/adminController.ts`（`validateProjectSurvey` L4078-）、必要なら `src/views/admin/projects/analysis.ejs` の表示
- 内容: `validateSurvey(questions)` → `validateSurvey(questions, project)` に拡張し（後方互換のため project は optional）、以下を追加:
  - **error**: survey_page で page group 未設定（全問 `page_group_id=null`）／survey_page で `branch_rule` あり／survey_page で `ai_probe_enabled` あり
  - **warning**: survey_page または interview_chat で `answer_ui_preset` が standard 以外（プリセットは適用されない旨）／interview_chat で `ai_probe_enabled` の設問が0件（チャットにする意味が薄い旨）／pairwise 等の新4型が存在（現状レンダラ無し）
- 既存8チェックの出力形式（error/warning の構造）に合わせる。テスト: `surveyValidation` の既存テストがあれば踏襲、無ければ新設（純関数なので `src/tests/` に追加しやすい）。
- 完了条件: 上記組合せの検出テストが通る／既存の検証green維持／管理画面の送付前チェックに表示される。

## ファイル別変更内容

| 種別 | パス | 変更内容 |
|---|---|---|
| 修正 | src/views/admin/projects/researchForm.ejs | P1: survey_page封印＋preset注意書き |
| 修正 | src/views/liff/survey.ejs | P2: submitAnswer ok検査＋エラーUI / P3: 分岐index・可視性 / P4: probe fetchヘッダ / P5: probe送信フラグ |
| 修正 | src/controllers/liffController.ts | P4: chatMessage認証 / P5: answer_role受け口 |
| 修正 | src/repositories/answerRepository.ts | P5: probe行insert（必要なら） |
| 修正 | src/lib/surveyValidation.ts | P6: project受領＋モード整合チェック |
| 修正 | src/controllers/adminController.ts | P6: validateProjectSurvey配線 |
| 修正/新規 | src/tests/surveyValidation*.test.ts | P6: 追加チェックのテスト |
| 修正 | src/lib/statExport.ts / rawdataExport.ts | P5: answer_roleフィルタ確認（必要時のみ） |

## 注意点

- **survey.ejs は実機でしか出ない罠が既知**（[[project_answer_ui_renderer_gotchas]]）。P2/P3/P5 はローカルPlaywright（LIFF SDKスタブ・`Uverify_test_001` seam）で必ず画面操作確認する。
- dev も本番DB共有。検証で作る案件は `is_discoverable=false`・`private_store` とし、終わったら削除。実ユーザーへのLINE pushは行わない。
- 401再認証フロー・完了処理2経路（showComplete / finalizeChatCompletion）を壊さない。P2でエラー扱いを変えるときは 401 だけ既存経路に流す。
- 対象外（今回やらない・別判断）: 途中再開の実装（resumeView配線）／snapshot hash から display_mode を外す件（凍結契約に関わるため要議論）／presentation_pattern の保存時ホワイトリスト／hidden設問の画面スキップ／research_mode 基準の probe 許可判定の統一／pool・partner API の preset 既定。

## 完了条件（全体）

- [ ] P1〜P6 各Phaseの完了条件を満たす
- [ ] `npx tsc --noEmit` / `npm test` green、既存49スイートに新規失敗なし
- [ ] 3表示モード（1問1答・チャット・既存survey_page案件）の正常回答フローがローカルseamで回る
- [ ] Phaseごとにコミット（メッセージに Phase 番号を含める）

## Claude Code / Codex 用指示文（Phaseごと）

### Phase 1
> docs/plan-display-mode-fixes.md の Phase 1 を実装して。src/views/admin/projects/researchForm.ejs の displayModeOptions から survey_page を除外し、編集中プロジェクトの現在値が survey_page のときだけ「ページ型（レガシー・非推奨）」として選択肢に残す。display_mode select の helper-text に「スワイプ等の回答UIプリセットは『1問1答』でのみ適用されます」を追記。tsc --noEmit を通し、既存 survey_page 案件の編集で値が保持されることを確認して。

### Phase 2
> docs/plan-display-mode-fixes.md の Phase 2 を実装して。src/views/liff/survey.ejs の submitAnswer に response.ok 検査を入れ、失敗時は {ok:false} を返す。呼び出し元（1問1答/ページ型/チャットの3経路）で失敗時にカーソルを進めず、エラー文言を表示して再送可能にする。401 は既存の再認証フローに流し、挙動を変えないこと。ローカルで 400 を返すケースを作り、回答が消えずに再送できることを Playwright で確認して。

### Phase 3
> docs/plan-display-mode-fixes.md の Phase 3 を実装して。src/views/liff/survey.ejs の分岐解決を「visibleQs 基準の question_code 検索」に統一する（1問1答 L1892-1897、チャット L2455-2458）。チャットの visibleQs（L2062）を都度評価の関数に変える。分岐先が非表示の場合は QUESTIONS 順で次の可視設問へ。checkAndShowProbe の nextCursor の意味も揃える。分岐＋表示条件を併せ持つテスト構成で両モードの遷移を確認して。

### Phase 4
> docs/plan-display-mode-fixes.md の Phase 4 を実装して。POST /liff/chat（liffController.chatMessage）に他の回答APIと同じ認証＋所有者検証（verifyAssignmentOwnerOrThrow ＋ assertSessionMatchesAssignment 相当）を入れ、survey.ejs の probe fetch を apiHeaders() に変更。LIFF_AUTH_REQUIRED=false 環境でも壊れない判定基準にすること。tmtest seam で正当/不正の両ケースを確認して。

### Phase 5
> docs/plan-display-mode-fixes.md の Phase 5 を実装して。POST /liff/survey/answer に answer_role('primary'|'probe') を追加し、probe は upsertPrimary ではなく別行 insert（LINE webhook経路 conversationOrchestratorService の probe 行の形式に揃える）。クライアントは probe 送信時にフラグを付け、answerCtx.answers を probe 文字列で上書きしない。statExport / rawdataExport が primary のみ読むことを確認し、必要なら answer_role フィルタを追加。choice設問→深掘り→返信で primary と probe が別行になること、statExport.test.ts green を確認して。

### Phase 6
> docs/plan-display-mode-fixes.md の Phase 6 を実装して。validateSurvey に optional の project 引数を追加し、survey_page×(グループ未設定/branch_rule/ai_probe)=error、(page|chat)×preset非standard・chat×probe0件・新4型存在=warning を追加。adminController.validateProjectSurvey から project を渡す。追加チェックのユニットテストを src/tests/ に新設し、既存テスト green を維持して。
