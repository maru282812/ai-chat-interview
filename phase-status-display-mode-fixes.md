# Phase Status: 表示モード×回答方式の不具合修正

指示書: docs/plan-display-mode-fixes.md / 対象repo: c:\work\ai-chat-interview
ゲート: `npx tsc --noEmit` → 関連テストを **1本ずつ** `npx tsx src/tests/<name>.test.ts`（`npm test` は5本のみ・全体並列は偽陽性）

## Phases

| # | 名前 | 状態 | ゲート | 更新 |
|---|------|------|--------|------|
| 1 | survey_page を管理UIから封印 | done | green (tsc + ejs.compile) | 2026-08-06 |
| 2 | submitAnswer のエラー検査と表示 | done | green (tsc + ejs.compile + script構文) | 2026-08-06 |
| 3 | 分岐indexの配列統一＋チャット可視性再評価 | done | green (tsc + ejs.compile + script構文 + 分岐ロジック11件) | 2026-08-06 |
| 4 | POST /liff/chat の認証・所有者検証 | done | green (tsc + ejs.compile + script構文 + 認証分岐8件) | 2026-08-06 |
| 5 | 深掘り回答を answer_role='probe' で別行保存 | done | green (tsc + ejs.compile + script構文 + 11スイート) | 2026-08-06 |
| 6 | 送付前バリデーションにモード整合チェック | done | green (tsc + 新規21件 + 既存7スイート) | 2026-08-06 |

## 確定した決定 / 前提（後フェーズが依存）

- 回答保存形式（single=スカラー / multi=カンマ結合 / matrix=JSON）変更禁止。統計エクスポート(wide/long/codebook)の列変更禁止（行フィルタは可）。
- サーバー側 `parseDisplayMode` は survey_page を許容したまま（P1 は UI 封印のみ）。
- 401 は既存の再認証フロー（liff-auth.ejs）に流す。挙動を変えない。
- LIFF の認証要否判定はページ側とサーバー側で **同じ authRequired 基準** を使う（project_liff_auth_gate_mismatch の轍を踏まない）。
- 完了処理は showComplete / finalizeChatCompletion の 2 経路。両方壊さない。
- dev も本番 Supabase 共有。実ユーザーへの LINE push は行わない。検証は `tmtest:` seam。
- migration 不要（answers.answer_role は既存列）。

## 未解決課題（重い・要人間判断）

（なし）

## フェーズ別ログ（サブが追記）

### Phase 1 — 2026-08-06
- 変更ファイル: src/views/admin/projects/researchForm.ejs
- ゲート: `npx tsc --noEmit` 緑 / `ejs.compile()` ok / 3入力（新規/survey_question/survey_page）で選択肢を検証
- 申し送り: **researchForm.ejs の display_mode ブロック自体が HEAD 比で未コミットの既存作業由来**。commit 時はハンク全部を Phase 1 と見なさずスコープを切ること。Phase 6 の warning 文言は P1 の helper-text と表現を揃える。

### Phase 2 — 2026-08-06
- 変更ファイル: src/views/liff/survey.ejs
- ゲート: `npx tsc --noEmit` 緑 / `ejs.compile()` ok / インライン script 2本を `new Function()` で構文検証 ok / answerPresentation・questionEngine・surveyFlowService 各1本 pass
- 実装:
  - `submitAnswer` は必ず `{ok, status, message}` を返す。`response.ok` false 時はサーバー本文の `error` / `message` を採用（`extractSubmitErrorMessage`）。fetch 例外は `{ok:false, status:0}`。
  - **401 の扱い**: 追加のリダイレクト・`handleTokenExpired()` 呼び出しは入れていない（既存の再認証は liff-auth.ejs の exp 事前検査＋`apiHeaders()` のライブトークン再取得が担当）。回答API側には元々 401 ハンドリングが存在しなかったため、案内文言を出すだけに留めて挙動を変えていない。
  - 1問1答/ページ型: `#answerError`（`.answer-error`）を nav-btns 直上に新設。失敗時は cursor/pageCursor を進めず、`recoverNextButton()` で「次へ」を再有効化。ページ型は1問でも失敗したら `pageCursor++` に到達しない。probe 送信（probeSubmitBtn）も失敗時は `probeNextCursor` を消費しない。
  - チャット: `handleChatSubmitFailure()` でAIバブル表示。`chatQueueIndex` は進めない。インライン送信/chatNext は `unfreezeLatestQuestionBlock()` でブロックを再活性化、`sendChatAnswer` は入力欄に本文を戻して再送可能に。
- 申し送り: **Playwright / 実機での動作確認は未実施（環境都合で省略）**。400/ネットワーク断ケースの画面確認は残っている。survey.ejs は実機でしか出ない罠が既知（project_answer_ui_renderer_gotchas）なので、コミット前に一度は実機かローカルseamで3モードを通すこと。
- Phase 3 への注意: btnNext の失敗時 `return` は `nextCursor` 算出前に置いてある。Phase 3 で分岐解決を code 基準に書き換える際、この early return の位置（submitAnswer 直後・resolveNext の前）を維持すること。

### Phase 3 — 2026-08-06
- 変更ファイル: src/views/liff/survey.ejs
- ゲート: `npx tsc --noEmit` 緑 / `ejs.compile()` ok / インライン script 2本を `new Function()` で構文検証 ok / questionEngine・surveyFlowService・answerPresentation 各1本 pass / 分岐ロジック検証スクリプト 11件 pass
- 実装:
  - **共通ヘルパー2本を `startSurvey()` 直下（`resolveNext` の直後）に新設**し、1問1答／チャットで同じ関数を使う。
    - `resolveNextIndex(q, visList)` … 「現在位置は question_code で持つ」方針の本体。`visList.findIndex(qq => qq.question_code === nextCode)` で引き、**返すのは常に `visList` 上の index**（完了は `visList.length`）。
    - `firstVisibleIndexFrom(startQIdx, visList)` … 分岐先が非表示のとき、`QUESTIONS` 上で `nextCode` 以降を順に走査して最初の可視設問の visList index を返す。無ければ `visList.length`（完了）。
  - 解決順序: ①分岐なし → 現在設問の visList index + 1 ②分岐先が可視 → その index ③分岐先が非表示 → `firstVisibleIndexFrom` ④分岐先コードが QUESTIONS に無い（設定ミス）→ `console.warn` して次の設問へフォールバック。⑤現在設問自身が可視リストに居ない（回答で自分が非表示化）→ QUESTIONS 順で自分の次以降の最初の可視設問。
  - **1問1答**: `btnNext` で `QUESTIONS.findIndex` を廃止。`submitAnswer` 成功後に `visibleQs = QUESTIONS.filter(isVisible)` で**再評価してから** `resolveNextIndex` を呼ぶ。`nextCursor` の意味＝「この再評価後の visibleQs 上の index」に統一。`renderQuestionMode()` が同条件で再 filter するため probe 経由の遅延適用でも意味が一致する。
  - **チャット**: `const visibleQs = QUESTIONS.filter(isVisible)`（初回固定）を廃止し `function getVisibleQs()` に。参照を全て都度評価へ差し替え＝`checkChatNextEnabled` / `askCurrentQuestion`（完了判定 `chatQueueIndex >= visibleQs.length` を含む・冒頭でローカル const に取り直し）/ `sendChatAnswer` / `chatNext` / 起動ログ。`advanceAfterAnswer` の次位置決定も `resolveNextIndex(q, getVisibleQs())` 一本に。
  - **Phase 2 の early return は位置を維持**（`submitAnswer` 直後・分岐解決の前）。ページ型・probe 送信の失敗時カーソル非消費も変更なし。
- 検証: 実ファイルから3関数を抽出して評価する検証スクリプトを scratchpad に作成（`branchLogic.test.mjs`）。「分岐＋表示条件を併せ持つ設問構成」で ①分岐先可視 ②分岐先非表示→次の可視へ ③以降全非表示→完了 ④存在しないコード ⑤現在設問の自己非表示 ⑥通し遷移2本（Q1→Q4→Q5 / Q1→Q2→Q3→Q5）を確認。**旧実装なら `vis[3]`＝Q5 に飛んでいた（設問スキップ）ケースを回帰として明示**。**既存の「分岐のみ・条件なし」案件は全設問可視＝visList index が QUESTIONS index と一致するため挙動不変**であることもテストで固定。
- 申し送り:
  - **Playwright / 実機での動作確認は未実施（未検証）**。3モード（1問1答／ページ型／チャット）の実機通しは Phase 2 分と併せて残っている。
  - `sendChatAnswer` は probe 返信にも使われる。現状 probe 返信も `advanceAfterAnswer` を通り `answerCtx.answers[code]` を probe 文字列で上書きするが、これは Phase 5 の担当範囲なので Phase 3 では触っていない。
  - `resolveNextIndex` は「戻る」には使っていない（`btnBack` は従来どおり `cursor--`）。条件付き設問で戻ったときの再表示は既存挙動のまま。
  - ページ型（survey_page）の `pageCursor` は今回対象外（分岐は 1問1答/チャットのみ）。Phase 6 で survey_page×branch_rule を error にする方針と整合。

### Phase 4 — 2026-08-06
- 変更ファイル: src/controllers/liffController.ts / src/views/liff/survey.ejs
- ゲート: `npx tsc --noEmit` 緑 / `ejs.compile()` ok / インライン script 2本を EJS タグ除去後に `new Function()` で構文検証 ok / dailyChatAnswer・liffBehaviorEvents・probePlayground・answerPresentation・questionEngine・surveyFlowService 各1本 pass / **認証分岐の検証テスト 8件 pass**
- 実装:
  - **サーバー** `chatMessage`: session 取得（＋`status==='active'` 判定）の直後に、`projectAssignmentRepository.getByProjectAndRespondent(session.project_id, session.respondent_id)` で **assignment を session から引く**。無ければ `HttpError(404)`。その assignment に対して既存の `verifyAssignmentOwnerOrThrow(req, chatAssignment.id)` ＋ `assertSessionMatchesAssignment(session, chatAssignment, {path})` を通す。
  - **assignment を body 任せにしなかった理由**: 1問1答経路の probe fetch は元々 `assignment_id` を送っていない。body 由来にすると「送らなければ検証が飛ぶ」抜け道になるため、session から引いて必ず検証対象を確定させる。結果として `assertSessionMatchesAssignment` は同一 project/respondent 由来なので常に成立する（多層防御としてそのまま残置）。
  - **authRequired 基準は自前実装せず `verifyAssignmentOwnerOrThrow` に全面委譲**。`liffAuthAvailable=false` は即 return、`authRequired=false` かつトークン無しも即 return、トークンがあれば authRequired の値に関わらず検証、という既存の唯一の判定点をそのまま使う（[[project_liff_auth_gate_mismatch]] の轍を踏まない）。
  - **クライアント** survey.ejs の probe fetch 2箇所（1問1答 `checkAndShowProbe` / チャット `advanceAfterAnswer`）のヘッダを `{'Content-Type':...}` から `apiHeaders()` へ。1問1答側は body にも `assignment_id: ASSIGNMENT_ID` を追加してチャット経路と形を揃えた（サーバーは使わないが将来の判断材料）。
- 検証（`tmtest:` seam）: **実サーバー起動は行わず**、repository/`env` を monkey-patch して `chatMessage` を直接呼ぶテストを scratchpad に作成（`chatAuth.test.mts`・DB/LINE API に一切触れない）。①正当トークン=従来どおり `{probe_question:null}` まで到達 ②他人トークン=403 ③トークン無し×authRequired=true=401 ④**トークン無し×authRequired=false（現dev）=通る＝壊れない** ⑤**liffAuthAvailable=false（LIFF未構成）=通る＝壊れない** ⑥authRequired=false でもトークンがあれば検証（他人=403） ⑦session に assignment 無し=404 ⑧assignment_id 未送信の1問1答経路でも session から引けて通る。
- 申し送り:
  - **ローカル dev サーバーを立てての curl 確認は未実施（未検証）**。本番 Supabase 共有のため実 session/assignment を用意する副作用を避け、上記の分岐テストで代替した。実機通し（Phase 2/3 分と併せて）は依然残っている。
  - session 不在（`getById` が throw）・`status!=='active'` の早期 return は**認証より前**にある既存挙動をそのまま維持した。所有者情報を漏らさないので変更していないが、厳密に「認証を最優先」に揃えるなら `submitSurveyAnswer` の `allSettled` 方式に寄せる余地がある（今回のスコープ外）。
  - Phase 5 で probe 送信に `answer_role` を足す際、**1問1答側の probe fetch body に `assignment_id` を足した**ことを前提にしてよい。

### Phase 5 — 2026-08-06
- 変更ファイル: src/controllers/liffController.ts / src/views/liff/survey.ejs / **新規** src/tests/surveyProbeAnswerRole.test.ts
- ゲート: `npx tsc --noEmit` 緑 / `ejs.compile()` ok / インライン script 2本を `new Function()` で構文検証 ok / **surveyProbeAnswerRole 11件 pass（新規）** / statExport 22・rawdataExport 17・surveyFlowService 11・questionEngine 9・answerPresentation 21・dailyChatAnswer 16・probePlayground 12・optionExclusion 4・answerTypes 22・storeSurveyEntry 10 各 pass
- **最重要の発見**: ワイヤの `answer_role:'probe'` と DB/domain の値は**別物**。`AnswerRole = "primary" | "ai_probe"`（domain.ts:85）で、LINE webhook 経路（conversationOrchestratorService:2076 / 2278、conversationService:285）は **`"ai_probe"`** を入れている。エクスポート・集計は全て `'ai_probe'` を基準に primary と分離しているため、**指示書の 'probe' をそのまま DB に書くと probe 行が primary 扱いになり集計が壊れる**。よって API は `'probe'` / `'ai_probe'` の**両方を受け付け、DB には必ず `'ai_probe'` を書く**。
- **statExport / rawdataExport の行フィルタは追加不要だった**（事前確認の結論）。理由: 両者は生 answers を読まず、`ExportAnswerGroup { primaryAnswer, probeAnswers }` に**分離済みの構造を受け取る**。分離は `statExportService.buildGroups`（L46-51, L95-100）と `researchOpsService.buildAnswerGroups`（L36-41）の `isAiProbeAnswer()`＝`answer_role==='ai_probe' || normalized_answer.source==='ai_probe'` が担当。`answerRepository.upsertPrimary`/`sampleForAggregate` も `.eq("answer_role","primary")` 済み、`surveyFlowService.buildAnswerContext`（L55）と `getSurveyNext`（liffController:1398）も非 primary を skip 済み。**列変更・行フィルタ追加とも一切していない＝凍結契約に触れていない。**
- 実装（サーバー `submitSurveyAnswer`）:
  - body に `answer_role`（省略時 primary）と `probe_index?` を追加。`isProbeAnswer` は `'probe'` と `'ai_probe'` の両方で true。
  - probe のとき: multi_choice 排他検査と `isNewAnswerType` バリデーションを**スキップ**（自由文のため）。**所有者検証（allSettled の verifyAssignmentOwnerOrThrow）・assertSessionMatchesAssignment・可視性 409 ゲートは probe 経路でも通る位置のまま＝維持**。
  - probe は `answerRepository.create({ answer_role:'ai_probe', parent_answer_id: <同一 session×question の最後の primary 行 id> })` で別行 insert。primary が未保存なら `parent_answer_id:null` で落とさず残す。`normalized_answer` に `source:'ai_probe'`（＋ probe_index）を補完＝`isAiProbeAnswer` の第2条件でも拾える二重の保険。
  - probe は `{ ok:true, answer_role:'ai_probe', next:null }` を返して**早期 return**。ctx を書き換えず `computeNextView` も呼ばないので**分岐は primary の値のまま**。`current_question_id` 更新は指示どおり現状維持。
- 実装（クライアント survey.ejs）:
  - `submitAnswer(questionCode, answerValue, opts)` に第3引数を追加。`opts.answerRole==='probe'` のとき **`answerCtx.answers[code]` を上書きしない**／自由文として送る（image_upload の normalized 組み立ても抑止）／body に `answer_role` と `probe_index` を付ける。**既存呼び出しは第3引数なし＝primary のままで無改修**。
  - 1問1答: `probeSubmitBtn` が `{answerRole:'probe', probeIndex}` を渡す。probe 本文は新設 `probeTextsByCode`（code -> 返信配列）に保持＝表示用テキストは ctx と分離。
  - チャット: **新設 `chatProbeActiveQ`** で probe 状態を明示。従来 `sendChatAnswer` は「probe 返信も primary として同じ設問に送り、ctx を probe 文字列で上書きしていた」（Phase 3 申し送りの指摘箇所）。今は probe 表示中の送信を probe として送り、設問は `chatProbeActiveQ` から取る。`advanceAfterAnswer` は probe 提示時に flag を立て、次設問へ進むときに解除。probe 本文は `chatProbeTextsByCode` に保持。
- 検証（新規 src/tests/surveyProbeAnswerRole.test.ts・DB/LINE API に触れない monkey-patch seam）: ①answer_role 省略＝upsertPrimary（後方互換）②'primary' 明示も同じ ③'probe' は upsertPrimary を呼ばず create・`answer_role:'ai_probe'`・parent_answer_id=primary 行 ④'ai_probe' も同扱い ⑤probe は `next:null` ⑥current_question_id は更新される ⑦選択肢外の自由文でも 400 にならない ⑧primary 未保存でも parent_answer_id=null で残る ⑨**表示条件を満たさない設問への probe は 409**（ゲート維持）⑩**LINE経路由来の既存 probe 行と LIFF経路の新 probe 行が `isAiProbeAnswer` で同じく primary から分離される**（既存 probe の扱い不変） ⑪buildAnswerContext が probe 行を無視する。
- 申し送り:
  - **Playwright / 実機での動作確認は未実施（未検証）**。Phase 2/3/4 分と併せて 3モード実機通しが依然残っている。特にチャットの `chatProbeActiveQ` は**実機でしか出ない罠が既知の survey.ejs**（[[project_answer_ui_renderer_gotchas]]）なので、コミット前に「choice設問→深掘り→返信→次設問」を一度通すこと。
  - **複数回 probe（同一設問に2回以上深掘り）はサーバー的には全て別行で積まれる**が、現行クライアントは probe を1回しか出さない（`/liff/chat` が次の probe を返せば2回目も動く想定）。probe_index はクライアント側の連番で、サーバーは検証していない。
  - **既存の LIFF probe 行（この修正前に primary を上書きしてしまった分）は遡って復元できない**。過去データの primary が probe 文字列になっている案件がありうる点は運用側の判断事項。
  - Phase 6 には未着手。

### Phase 6 — 2026-08-06
- 変更ファイル: src/lib/surveyValidation.ts / src/controllers/adminController.ts / **新規** src/tests/surveyValidationDisplayMode.test.ts
- ゲート: `npx tsc --noEmit` 緑 / **surveyValidationDisplayMode 21件 pass（新規）** / statExport 22・rawdataExport 17・answerTypes 22・surveyProbeAnswerRole 11・answerPresentation 21・questionEngine 9・surveyFlowService 11 各 pass（1本ずつ）
- 実装:
  - `validateSurvey(questions, project?: Project | null)` に拡張。**project が falsy なら追加チェックを一切実行しない**＝既存呼び出し（statExport.test.ts の4箇所）は無改修で挙動不変。
  - 追加チェックは private 関数 `checkDisplayModeConsistency(project, activeQuestions, findings)` に隔離し、既存8チェックの直後・errorCount 集計の直前に差し込む。**対象は既存チェックと同じ `activeQuestions`（`is_system` 除外済み）**。
  - **error 3種**: `page_mode_without_page_group`（survey_page で全問 page_group_id=null。**設問0件のときは出さない**＝空案件で誤検知しない）／`page_mode_with_branch_rule`（設問ごと・question_code 付き）／`page_mode_with_ai_probe`（設問ごと・question_code 付き）。
  - **warning 3種**: `answer_ui_preset_not_applied`（survey_page または interview_chat で `answer_ui_preset` が standard 以外。**未設定は standard 扱いで出さない**）／`chat_mode_without_ai_probe`（interview_chat で ai_probe_enabled が0件）／`new_answer_type_no_renderer`（設問ごと）。
  - **「新4型」の特定**: `src/lib/answerTypes.ts` の `NEW_ANSWER_TYPES = ["pairwise","ranking_top_n","point_allocation","image_heatmap"]` ＋ `isNewAnswerType()` を **そのまま import して判定**（型リストをハードコードで二重管理しない）。テスト側も4型を明示列挙して固定。
  - **文言は Phase 1 の申し送りどおり researchForm.ejs の helper-text と表現統一**＝「スワイプ等の回答UIプリセットは「1問1答」でのみ適用されます。」を warning メッセージの先頭にそのまま含めた。テストで部分一致を assert して固定してある（片方だけ書き換えると落ちる）。
  - **adminController の配線は2箇所**: `validateProjectSurvey`（GET /validate・レポートのみ）と **`createProjectSnapshot`（送付ゲート）両方**に `projectRepository.getById` を `Promise.all` で足して project を渡した。後者にも渡した理由＝**新 error を「レポートには出るが確定はブロックしない」状態にすると、survey_page×分岐/probe の壊れた構成がそのまま凍結できてしまう**ため。`?force=1` の逃げ道は既存どおり残っている。
- `src/views/admin/projects/analysis.ejs` は**変更不要**。findings を level/code/message で汎用描画しており（L62-73）、エラー/警告件数も findings から数えているので追加 finding がそのまま表示される。
- 申し送り:
  - **管理画面での実表示は未確認（未検証）**。純関数＋汎用レンダラなので構造上は出るはずだが、実案件での「調査票を検証」ボタン押下は Phase 2〜5 の実機通しと併せて残っている。
  - **既存の survey_page 案件は確定（スナップショット作成）が新たにブロックされうる**。page group 未設定 or 分岐 or probe を持つレガシー案件は `?force=1` が必要になる。運用側に影響が出る可能性がある唯一の挙動変更点。
  - 新4型の warning は**回答画面レンダラが実装されたら削除する**チェック（`isNewAnswerType` が true の間ずっと出る）。レンダラ実装時に `new_answer_type_no_renderer` を消すこと。
  - 指示書に無い項目（survey_question 側の検査・preset のホワイトリスト保存・hidden 設問）は追加していない。

