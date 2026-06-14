# AIプロンプト管理基盤 再設計 — フェーズ1 現状調査レポート（完全版・2026-06-13）

> 指示書「AIプロンプト管理基盤 再設計指示」フェーズ1の調査結果。
> 前回調査（[ai-prompt-package-redesign-survey.md](./ai-prompt-package-redesign-survey.md)、2026-06-12）は
> **パッケージ管理対象の10関数のみ**を対象としていた。本レポートは指示書の要求どおり
> **全 buildXxxPrompt（17関数）・全AIプロンプト生成箇所・全OpenAI呼び出し箇所（13箇所）** を網羅する。

---

## 0. 重要な前提（先に読むこと）

1. **指示書フェーズ2〜4の大部分は実装済み**。feature/phase2 ブランチ上で Migration 048〜057・パッケージ管理画面・バージョンライフサイクル（draft/published/archived）・差分比較・プレビュー・テスト実行・AIログ閲覧・変更履歴・個別オーバーライドまで完了している（Phase 1〜6、詳細は前回調査レポート参照）。
2. ただし**現行実装と指示書のアーキテクチャには構造的な差が1つある**（§6 参照）:
   - 指示書: **プロンプト単位のバージョン管理**（Prompt Definition → Prompt Version → Package Mapping で「Interview Turn → v3」のようにプロンプトごとにバージョンを束ねる）
   - 現行: **パッケージ単位のバージョン管理**（prompt_package_versions が全10テンプレート+ポリシーを1つの JSON blob として保持。プロンプト個別のバージョン番号は存在しない）
3. **未管理プロンプトが11箇所残っている**（researchPrompts.ts 内7関数 + ソース内インライン4箇所）。「ソースコードに散在する全プロンプトを管理画面へ集約する」という指示書の目的に対する実質的な残作業はここ。

---

## 1. プロンプト一覧（全数調査）

### 1.1 グループA: パッケージ管理対象（10関数・管理画面編集可）

全て `src/prompts/researchPrompts.ts` 定義。`ai_prompt_templates_json`（またはパッケージの `templates_json`）が非nullならテンプレートモード、nullならハードコードのlegacyモードで動作する二重構造。

| # | Prompt Key | 定義 | aiService メソッド | 用途 | 出力 |
|---|---|---|---|---|---|
| A1 | buildAnalyzeAnswerPrompt | researchPrompts.ts:567 | analyzeAnswer | 回答分析と次アクション決定（probe/ask_next/skip/finish） | JSON |
| A2 | buildInterviewTurnPrompt | researchPrompts.ts:1104 | interviewTurn | インタビュー進行判定・返答生成 | JSON |
| A3 | buildProbeGenerationPrompt | researchPrompts.ts:477 | generateStructuredProbe【休眠】 | 構造化深掘り質問生成 | JSON |
| A4 | buildQuestionRenderingPrompt | researchPrompts.ts:412 | renderQuestion | 質問定義→自然な日本語の問いかけ文 | テキスト |
| A5 | buildSlotFillingPrompt | researchPrompts.ts:777 | fillAnswerSlots【休眠】 | 回答からスロット値抽出 | JSON |
| A6 | buildCompletionCheckPrompt | researchPrompts.ts:832 | checkAnswerCompletion【休眠】 | 必須情報の充足判定 | JSON |
| A7 | buildSessionSummaryPrompt | researchPrompts.ts:892 | summarizeSession | セッション全体要約 | テキスト |
| A8 | buildFinalStructuredSummaryPrompt | researchPrompts.ts:922 | finalAnalyze | 最終構造化サマリー | JSON |
| A9 | buildFinalAnalysisPrompt | researchPrompts.ts:1075 | finalAnalyze内fallback | 最終分析（A8のJSONパース失敗時） | テキスト |
| A10 | buildProbePrompt | researchPrompts.ts:1040 | generateProbeQuestion | 単発の深掘り質問生成 | テキスト |

呼び出し元・変数の詳細は前回調査レポート §1.1 を参照（変更なし）。
【休眠】= 呼び出し元ゼロだが、テンプレート管理対象10件の入口として Phase 6-F で意図的に温存。

### 1.2 グループB: researchPrompts.ts 内の未管理プロンプト（7関数）

ハードコードのみ。テンプレートモードなし・ポリシー適用なし・管理画面から編集不可。

| # | Prompt Key | 定義 | aiService メソッド | 呼び出し元（実行タイミング） | 用途 | 出力 |
|---|---|---|---|---|---|---|
| B1 | buildProjectInitialStatePrompt | researchPrompts.ts:363 | generateProjectInitialState (474) | projectAiStateService.ts:31（プロジェクトAI状態の初期生成時） | プロジェクトレベルAI初期状態（required_slots/probe_policy等）の生成 | JSON |
| B2 | buildProjectAnalysisPrompt | researchPrompts.ts:961 | generateProjectAnalysis (1178) | analysisService.ts:280 ← adminController.ts:2662（管理画面の分析レポート生成） | プロジェクト横断の回答者比較分析 | JSON |
| B3 | buildPostAnalysisPrompt | researchPrompts.ts:1018 | analyzePost (1214) | analysisService.ts:302 ← conversationOrchestratorService.ts:1827/2198・liffController.ts:365（投稿受信ごと非同期） | 単一投稿の分析（summary/tags/sentiment等） | JSON |
| B4 | buildRantExtendedPrompt | researchPrompts.ts:1238 | analyzeRantExtended (1250) | aiTagService.ts:65（愚痴投稿の拡張分析） | カテゴリ・深刻度・危険フラグ判定 | JSON |
| B5 | buildDiaryExtendedPrompt | researchPrompts.ts:1252 | analyzeDiaryExtended (1273) | aiTagService.ts:90（日記投稿の拡張分析） | mood_score・トピック・行動シグナル | JSON |
| B6 | buildRantCounselorReplyPrompt | researchPrompts.ts:1265 | generateRantCounselorReply (1294) | liffController.ts:379（愚痴投稿への即時返信） | カウンセラー風の短い受け止め返信（80文字以内） | テキスト |
| B7 | buildPersonaTagsPrompt | researchPrompts.ts:1294 | generateUserPersonaTags (1322) | aiTagService.ts:33（ユーザー属性タグ生成） | 属性タグ3〜5件 + ペルソナ要約 | JSON |

### 1.3 グループC: ソース内インラインプロンプト（4箇所・関数化すらされていない）

build関数を経由せず、ハンドラー内に直接プロンプト文字列が埋め込まれている。**全て `gpt-4o-mini` ハードコード + chat.completions API**（グループA/Bは `env.OPENAI_MODEL` + responses API）。

| # | 場所 | ハンドラー/メソッド | 用途 | 出力 |
|---|---|---|---|---|
| C1 | adminController.ts:3296（呼び出し3312） | apiSuggestAnswerOptions | フローデザイナー: 設問文から回答形式・選択肢をAI提案 | JSON |
| C2 | adminController.ts:3477（呼び出し3498） | apiImportFlowFromProject | 他案件の設問を新案件向けにAIで書き換えて流用 | JSON |
| C3 | adminController.ts:3672（呼び出し3710） | apiGenerateFlow | プロジェクト名+調査目的から設問フロー自動生成（8〜15問） | JSON |
| C4 | missingAttributeService.ts:77（呼び出し92） | suggestQuestions ← adminController.ts:4920 | 不足ユーザー属性に対するデイリーアンケート設問提案 | JSON |

### 1.4 グループD: 補助プロンプト部品（単体ではAIに送られない）

| 部品 | 場所 | 役割 |
|---|---|---|
| buildJapaneseSystemInstruction(purpose) | aiService.ts | 全responses API呼び出しの先頭に付与する日本語強制システム指示 |
| buildSharedSections(project, purpose) | researchPrompts.ts | プロジェクト目的・AI状態等の共通セクション（A群とB2が利用） |
| renderPromptPolicySections | promptPolicies.ts | 7軸ポリシー（researchType/audience/probeStyle等）のレンダリング（A群のみ） |
| BASE_PROMPT_TEMPLATES | basePromptTemplates.ts | A群10件のデフォルトテンプレート + allowedPlaceholders + 可視化メタ |

※ `src/prompts/aiPrompts.ts` は Phase 6-F で削除済み（import ゼロのデッドコードだった）。

---

## 2. OpenAI 呼び出し箇所（全13箇所）

| # | 箇所 | API | モデル | ai_logs記録 |
|---|---|---|---|---|
| 1 | aiService.ts:261 `runTextPrompt()` | responses.create | env.OPENAI_MODEL | ✅ あり（prompt_key/template_mode/policy_snapshot/rendered_prompt/package追跡4列） |
| 2 | aiService.ts:496 generateProjectInitialState | responses.create | env.OPENAI_MODEL | ❌ なし |
| 3 | aiService.ts:1206 generateProjectAnalysis | responses.create | env.OPENAI_MODEL | ❌ なし |
| 4 | aiService.ts:1230 analyzePost | responses.create | env.OPENAI_MODEL | ❌ なし |
| 5 | aiService.ts:1258 analyzeRantExtended | responses.create | env.OPENAI_MODEL | ❌ なし |
| 6 | aiService.ts:1280 analyzeDiaryExtended | responses.create | env.OPENAI_MODEL | ❌ なし |
| 7 | aiService.ts:1300 generateRantCounselorReply | responses.create | env.OPENAI_MODEL | ❌ なし |
| 8 | aiService.ts:1312 callRaw（テスト実行用） | responses.create | env.OPENAI_MODEL | ❌ なし（管理画面テスト用なので妥当） |
| 9 | aiService.ts:1330 generateUserPersonaTags | responses.create | env.OPENAI_MODEL | ❌ なし |
| 10 | adminController.ts:3312 apiSuggestAnswerOptions | chat.completions | **gpt-4o-mini固定** | ❌ なし |
| 11 | adminController.ts:3498 apiImportFlowFromProject | chat.completions | **gpt-4o-mini固定** | ❌ なし |
| 12 | adminController.ts:3710 apiGenerateFlow | chat.completions | **gpt-4o-mini固定** | ❌ なし |
| 13 | missingAttributeService.ts:92 suggestQuestions | chat.completions | **gpt-4o-mini固定** | ❌ なし |

**まとめ**: グループA（管理対象10件）だけが `runTextPrompt()` に集約されai_logsに完全記録される。B/C群はログなし・直接呼び出し。C群はAPIスタイル・モデルも別系統。

---

## 3. 使用変数・必須変数・変数不足時の挙動

### グループA（テンプレートモード）
- 使用変数は `basePromptTemplates.ts` の `allowedPlaceholders` に全キー定義済み（例: buildAnalyzeAnswerPrompt は projectGoal/questionText/answer/maxProbes 等24個）。
- **変数不足時の挙動**（promptTemplateRenderer.ts:22）: `{{key}}` がコンテキストに無い → **warn ログ + 空文字置換。エラーにはならず、アプリは落ちない**。
- 許可外プレースホルダー: パッケージ側は保存時**警告**、プロジェクト個別設定（旧custom）は**エラー**（promptPackageValidationService の意図的な差）。
- enabled:true かつ空白テンプレート → 保存時エラー。テンプレート未設定キーは BASE_PROMPT_TEMPLATES へフォールバック。

### グループB（ハードコード）
- 変数はTypeScriptの関数引数（型チェックあり）。null可能フィールドは `?? "not set"` / `?? "none"` で埋める設計のため**実行時に変数不足でエラーになるケースはない**（コンパイル時に保証）。
- B1: project 8フィールド + template定義。B2: project + respondentSummaries + comparisonUnits + freeAnswerPolicy（JSON.stringifyで埋め込み）。B3: postType/sourceMode/content。B4/B5: content のみ。B6: postText/selectedTags。B7: analyses（最大20件にslice）。
- エラー時挙動: B4〜B7は try-catch で **null を返して握りつぶす**（投稿処理を止めないため）。B1〜B3は例外がそのまま上位へ伝播。

### グループC（インライン）
- テンプレートリテラル直書き。C2/C3はAI失敗時にフォールバックあり（C2: 元テキストをそのまま使用、C4: カバレッジデータのみ返す）。C1/C3は失敗時 500 を返す。

---

## 4. プロンプト依存関係

```
buildProjectInitialStatePrompt (B1)
  └─→ projects.ai_state_json として保存
        └─→ buildSharedSections 経由で A群ほぼ全部のプロンプトに注入
              （required_slots / probe_policy / topic_control が実行時の判断材料）

buildAnalyzeAnswerPrompt (A1) ──判断 action=probe──→ buildProbePrompt (A10)
buildQuestionRenderingPrompt (A4) ←─ 前問の質問文・回答を文脈として受け取る

buildSessionSummaryPrompt (A7)
  └─→ session summary
        ├─→ buildFinalStructuredSummaryPrompt (A8) ─JSONパース失敗─→ buildFinalAnalysisPrompt (A9)
        └─→ buildProjectAnalysisPrompt (B2) の respondentSummaries 入力

buildPostAnalysisPrompt (B3)
  └─→ post_analyses 保存
        └─→ buildPersonaTagsPrompt (B7) の入力（最大20件）

buildRantExtendedPrompt (B4) / buildDiaryExtendedPrompt (B5)
  └─→ aiTagService がタグ保存（B7と同じ流れに合流）

ポリシー層（A群のみ）:
  パッケージ policy_json → overrides.policy マージ → renderPromptPolicySections → 各プロンプト末尾
```

C群は相互依存なし（それぞれ独立した管理画面ユーティリティ）。

---

## 5. プロンプト解決の現行優先順位（実装済み）

```
1. project.ai_prompt_overrides_json.policy   （オーバーライド・policyのみ）
2. ai_prompt_mode='package' の published バージョン（archived は published へ自動fallback）
3. ai_prompt_mode='custom' の ai_prompt_policy_json / ai_prompt_templates_json
4. どちらも null → legacy（researchPrompts.ts ハードコードパス）
```

全解決は `aiService.resolveEffectiveProjectConfig()`（export済み）に集約。

---

## 6. 指示書とのギャップ（今回調査で確定した残課題）

| # | ギャップ | 内容 | 規模感 |
|---|---|---|---|
| **N1** | **プロンプト単位バージョンの不在（構造差）** | 指示書はプロンプト定義ごとに v1/v2/v3 を持ち、パッケージは「Interview Turn → v3」のマッピング集合。現行はパッケージバージョンが全テンプレートを1 blobで保持し、プロンプト個別のバージョン番号・履歴・差分が存在しない（差分はバージョン間比較のみ）。 | **大**（DB再設計級。判断が必要） |
| **N2** | **未管理プロンプト B1〜B7（7関数）** | テンプレート管理・ポリシー・ai_logs記録の対象外。「全プロンプトを管理画面へ集約」の最大の残作業。B群は変数が少なく移行しやすい（B4〜B7は変数1〜2個）。 | 中（1関数あたりA群と同パターンで移行可能） |
| **N3** | **インラインプロンプト C1〜C4（4箇所）** | 関数化すらされておらず、gpt-4o-mini固定・chat.completions・ログなし。最低でも researchPrompts.ts への関数化 + モデル設定の一元化が必要。 | 中 |
| **N4** | **B/C群のai_logs記録なし** | 管理画面「利用状況」メニュー（指示書フェーズ3）を全プロンプトに広げるなら、B/C群も runTextPrompt 相当の記録経路に乗せる必要がある。 | 小〜中（N2/N3とセットで解消） |
| **N5** | **プロンプト定義一覧画面の不在** | 指示書フェーズ3の「プロンプト定義一覧（名前/key/最新公開版/利用パッケージ数/利用プロジェクト数）」に相当する画面はない。現行はパッケージ起点のみ。N1の判断に依存。 | 中 |

※ 前回調査のG1〜G8はPhase 6で全て解消済み。

### N1 の判断ポイント（実装フェーズ前に決めること）

- **(a) 現行のパッケージ単位バージョンを維持**（推奨・低リスク）: 「Interview Turn だけ v3 に上げる」はできないが、運用上はバージョン複製+1テンプレート修正で代替可能。Migration 048〜057・6フェーズ分の実装・テスト・確認導線をそのまま活かせる。
- **(b) 指示書どおりプロンプト単位バージョン+マッピングへ再設計**: prompt_definitions / prompt_versions / package_mappings の3テーブル新設、prompt_package_versions からのデータ移行、解決ロジック・管理画面・検証・差分・履歴の全面改修が必要。実装済み資産の大部分を作り直すことになる。

---

## 7. 推奨する実装フェーズ分割（調査確認後）

| フェーズ | 内容 | 対応ギャップ | 見積り |
|---|---|---|---|
| 7-A | B1〜B7 を BASE_PROMPT_TEMPLATES + テンプレートモードへ移行（allowedPlaceholders定義・runTextPrompt経由化・ai_logs記録） | N2, N4 | 1.5日 |
| 7-B | C1〜C4 の関数化（researchPrompts.tsへ移設）+ モデル設定一元化 + テンプレート管理対象化 | N3, N4 | 1.0日 |
| 7-C | プロンプト定義一覧画面（key/用途/最新版/利用パッケージ数/利用プロジェクト数/利用状況リンク） | N5 | 1.0日 |
| 7-D | （N1で(b)を選んだ場合のみ）プロンプト単位バージョン再設計 | N1 | 5日以上 |

**合計: (a)なら約3.5日 / (b)なら8.5日以上**

7-A/7-B は独立して着手可能。7-C は 7-A/7-B 完了後が望ましい（全プロンプトがパッケージ管理に乗ってから一覧化する方が二度手間がない）。
