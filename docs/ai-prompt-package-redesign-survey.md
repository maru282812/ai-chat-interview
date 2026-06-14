# AIプロンプト管理基盤 再設計 — 現状調査レポート（2026-06-12）

> 指示書「AIプロンプト管理基盤 再設計指示」に基づく調査結果。
> **重要な前提**: 指示書が目指す「プロンプトパッケージ → バージョン → テンプレート → プロジェクト」構造は、
> feature/phase2 ブランチ上の Phase 1〜5 実装（Migration 048〜056、未コミット）で **大部分が既に実装済み**。
> 本レポートは (1) 現状調査、(2) 指示書とのギャップ一覧、(3) 残作業の設計・フェーズ分割・見積り を提示する。

---

## 1. 現状調査レポート

### 1.1 プロンプト関数一覧（調査対象10件）

全10関数は `src/prompts/researchPrompts.ts` に定義。全関数が同一パターンで動作する:

- `project.ai_prompt_templates_json`（またはパッケージの `templates_json`）が非null → `resolveBasePromptTemplate()` + `renderPromptTemplate()` によるテンプレートモード
- null → 既存ハードコードパス（legacy モード）
- ポリシー（`ai_prompt_policy_json` / パッケージ `policy_json`）は `renderPromptPolicySections()` でレンダリング後に末尾追記

| # | 関数名 | 定義位置 | aiService メソッド | ai_logs purpose | 呼び出し元（実行タイミング） | 用途 | 出力形式 |
|---|---|---|---|---|---|---|---|
| 1 | buildAnalyzeAnswerPrompt | researchPrompts.ts:567 | analyzeAnswer (523) | answer_analysis | liffController.ts:1257 / conversationOrchestratorService.ts:800（回答受信ごと） | 1ターンの回答を分析し次アクション（probe/ask_next/skip/finish）を決定 | JSON: action, question, reason, collected_slots, is_sufficient |
| 2 | buildInterviewTurnPrompt | researchPrompts.ts:1104 | interviewTurn (893) | interview_turn | conversationOrchestratorService.ts:760（インタビュー型の各ターン） | インタビュー進行判定と返答テキスト生成 | JSON |
| 3 | buildProbeGenerationPrompt | researchPrompts.ts:477 | generateStructuredProbe (957) | structured_probe_generation | **呼び出し元なし（休眠）** | 構造化深掘り質問の生成 | JSON |
| 4 | buildQuestionRenderingPrompt | researchPrompts.ts:412 | renderQuestion (490) | question_render | conversationOrchestratorService.ts:615（質問提示前） | 質問定義を自然な日本語の問いかけ文に変換 | テキスト |
| 5 | buildSlotFillingPrompt | researchPrompts.ts:777 | fillAnswerSlots (991) | slot_filling | **呼び出し元なし（休眠）** | 回答からスロット値を抽出 | JSON |
| 6 | buildCompletionCheckPrompt | researchPrompts.ts:832 | checkAnswerCompletion (1053) | completion_check | **呼び出し元なし（休眠）** | 必須情報の充足判定 | JSON |
| 7 | buildSessionSummaryPrompt | researchPrompts.ts:892 | summarizeSession (1098) | session_summary | conversationService.ts:69（セッション完了時） | セッション全体の要約生成 | テキスト |
| 8 | buildFinalStructuredSummaryPrompt | researchPrompts.ts:922 | finalAnalyze (1112) | final_structured_summary | analysisService.ts:242（分析実行時） | 最終構造化サマリー生成 | JSON |
| 9 | buildFinalAnalysisPrompt | researchPrompts.ts:1075 | finalAnalyze 内 fallback (1132) | final_analysis | 同上（#8 の JSON パース失敗時のフォールバック） | 最終分析（非構造化） | テキスト |
| 10 | buildProbePrompt | researchPrompts.ts:1040 | generateProbeQuestion (878) | probe_generation | conversationService.ts:372（深掘り発火時） | 単発の深掘り質問生成 | テキスト |

補足:
- **利用プレースホルダー**: 各キーごとに `src/prompts/basePromptTemplates.ts` の `allowedPlaceholders` に定義済み（例: buildAnalyzeAnswerPrompt は projectGoal / questionText / answer / maxProbes など24個）。許可外プレースホルダーは warn ログのみでアプリは落とさない。
- **利用ポリシー**: `src/prompts/promptPolicies.ts` に7軸（researchType / audience / probeStyle / noneAnswerPolicy / ambiguousAnswerRule / freeAnswerPolicy / restrictions / priority）。noneAnswerPolicy は free_comment 質問には適用しない。max_probes / 日本語のみ等の絶対ルールは researchPrompts.ts 側で維持。
- **AIへの最終投入箇所**: 全関数とも `aiService.ts` の `runTextPrompt()`（aiService.ts:219）に集約。`buildJapaneseSystemInstruction()` を先頭に付与し `openai.responses.create({ model: env.OPENAI_MODEL })` で送信。日本語チェック失敗時は1回リトライ。

### 1.2 依存関係図

```
プロジェクト設定 (projects)
  ai_prompt_mode ('custom' | 'package')
  ai_prompt_package_version_id ──→ prompt_package_versions (policy_json / templates_json)
  ai_prompt_policy_json / ai_prompt_templates_json (customモード用)
        │
        ▼
aiService.resolveEffectiveProjectConfig()
  package モード: published バージョン優先 / archived → published へ自動 fallback
  custom モード or 取得失敗: project 個別設定
  どちらも null: legacy（ハードコード）
        │
        ▼
buildXxxPrompt()  (researchPrompts.ts ×10)
  resolveBasePromptTemplate → renderPromptTemplate (promptTemplateRenderer.ts、eval不使用)
  + renderPromptPolicySections (promptPolicies.ts) を末尾追記
        │
        ▼
runTextPrompt()  (aiService.ts:219)
  日本語システム指示 + プロンプト → openai.responses.create
  ai_logs へ記録: prompt_key / template_key / template_mode / policy_snapshot /
                  rendered_prompt / package_id / package_version_id / package_slug / package_version_no
        │
        ▼
OpenAI (env.OPENAI_MODEL)
```

### 1.3 既存DB（実装済みマイグレーション）

| Migration | 内容 |
|---|---|
| 048 | projects に `ai_prompt_policy_json` / `ai_prompt_templates_json` |
| 049 | ai_logs に prompt_key / template_key / template_mode / policy_snapshot / rendered_prompt |
| 054 | `prompt_packages`（slug/name/description）・`prompt_package_versions`（version_no/status: draft\|published\|archived/policy_json/templates_json）・projects.ai_prompt_mode + ai_prompt_package_version_id・ai_logs パッケージ追跡4列 |
| 055 | `project_prompt_package_change_logs`（変更履歴・FKなしスナップショット） |
| 056 | 同テーブルに `changed_by`（Basic認証ユーザー名） |

### 1.4 既存管理画面

| 画面 | 状態 |
|---|---|
| パッケージ一覧 `/admin/prompt-packages` | ✅ 実装済み（パッケージ名・slug・公開バージョン・総バージョン数・最終更新） |
| パッケージ詳細 show.ejs | ✅ バージョン一覧・検証結果・利用中プロジェクト一覧 |
| バージョン編集 version-form.ejs | ✅ 全10テンプレート + ポリシーを編集（指示書の「バージョン詳細で初めてテンプレート編集」を充足） |
| publish-confirm / archive-confirm | ✅ 影響プロジェクト一覧 + fallback 判定 + 確認チェックボックス |
| プロジェクト編集の AIプロンプト設定 | △ custom/package ラジオ + バージョン直接選択ドロップダウン |
| 適用前プレビュー / テスト実行 / AIログ閲覧 | ✅ Phase 4〜5 で実装済み |
| パッケージ変更履歴 prompt-package-history.ejs | ✅ 操作者・変更理由付き |

---

## 2. 影響範囲一覧（指示書とのギャップ）

| # | ギャップ | 指示書の要求 | 現状 | 影響ファイル |
|---|---|---|---|---|
| G1 | **プロジェクト編集にテンプレート編集UIが残存** | プロジェクト編集からベースプロンプト編集を撤去 | custom モード時にセクションB（researchForm.ejs:796）が表示される | researchForm.ejs, adminController.ts |
| G2 | **パッケージ→バージョンの2段選択でない** | パッケージ選択 + バージョン選択 | バージョンID直接選択の単一ドロップダウン（researchForm.ejs:663） | researchForm.ejs, adminController.ts |
| G3 | **個別オーバーライド層がない** | プロジェクトは「個別オーバーライド」を保持 | package モードはパッケージ設定で完全置換（projectのpolicy/templatesはマージされない） | aiService.resolveEffectiveProjectConfig, domain.ts, migration追加 |
| G4 | **パッケージ一覧に利用プロジェクト数なし** | 一覧に利用プロジェクト数を表示 | 列なし（getProjectsUsingPackage は実装済みで流用可能） | index.ejs, adminController.ts |
| G5 | **差分比較（vN vs vM）未実装** | バージョン間のテンプレート差分表示 | なし | 新規画面 or show.ejs拡張 |
| G6 | **プロンプト可視化メタが不足** | 用途・呼び出しタイミング・影響範囲・利用変数・利用ポリシー・出力形式 | label / description / allowedPlaceholders のみ（basePromptTemplates.ts） | basePromptTemplates.ts, version-form.ejs |
| G7 | **デッドコード** | — | `src/prompts/aiPrompts.ts` はどこからも import されていない（buildProbePrompt等の旧重複定義） | aiPrompts.ts 削除 |
| G8 | **休眠コードパス** | — | generateStructuredProbe / fillAnswerSlots / checkAnswerCompletion は呼び出し元ゼロ（テンプレート管理対象には含まれている） | 仕様判断が必要 |

---

## 3. 新DB設計（追加分のみ）

既存 048〜056 でほぼ充足。**追加が必要なのは G3（オーバーライド層）のみ**:

```sql
-- 057（案）: プロジェクト個別オーバーライド
ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS ai_prompt_overrides_json jsonb;
-- 形式: { "policy": {部分上書き}, "templates": { "buildXxxPrompt": {...} } }
-- package モード時: パッケージ設定 → overrides で deep-merge
```

既存の `ai_prompt_policy_json` / `ai_prompt_templates_json` を package モード時のオーバーライドとして再利用する案もあるが、custom モードの設定と意味が混ざるため**専用カラムを推奨**。

将来拡張（ABテスト・パフォーマンス比較・バージョン別分析・ロールバック・逆引き・公開履歴・品質比較）は、ai_logs のスナップショット列（package_version_no 等）と change_logs で集計基盤が既にあり、追加テーブルなしで開始可能。

---

## 4. 新画面設計（変更分のみ）

### プロジェクト編集画面
- セクションB（ベースプロンプトテンプレート編集）を**撤去**
- 「AIプロンプト設定」: 利用モード（package / custom※） + **パッケージ選択 → バージョン選択の2段ドロップダウン**（fetch でバージョン一覧を動的取得）
- 「AIプロンプト方針」（7軸ポリシー編集）は現行のまま維持
- 個別オーバーライド: 「パッケージ設定を一部上書きする」折りたたみセクション（上書き中のキーのみバッジ表示）

※ custom モードの扱いは判断ポイント（§6 参照）

### パッケージ一覧
- 「利用プロジェクト数」列を追加（クリックで利用プロジェクト逆引き）

### バージョン詳細
- 各テンプレートカードに可視化メタ表示: 用途 / 呼び出しタイミング / 影響範囲 / 利用変数 / 利用ポリシー / 出力形式（basePromptTemplates.ts の定義を拡張して供給）
- 「他バージョンと比較」ボタン → 差分表示画面（行単位 diff、変更キーのみハイライト）

---

## 5. 移行方針

1. **データ移行は不要**。既存プロジェクトは ai_prompt_mode='custom' のまま無影響（Migration 054 の設計通り）。
2. セクションB撤去後も `ai_prompt_templates_json` のデータは保持（削除しない）。custom モード継続プロジェクトのために読み取りパスは維持。
3. 既存 custom プロジェクトのパッケージ化は「現在の個別設定からパッケージ草稿を作成」ボタン（任意・後続フェーズ）で支援。
4. aiPrompts.ts は import ゼロ確認済みのため即削除可。

---

## 6. 実装フェーズ分割案 + 工数見積り

| フェーズ | 内容 | ギャップ | 見積り |
|---|---|---|---|
| 6-A | プロジェクト編集再構成: セクションB撤去・パッケージ→バージョン2段選択（バージョン一覧API追加） | G1, G2 | 1.0日 |
| 6-B | 個別オーバーライド層: Migration 057 + resolveEffectiveProjectConfig の deep-merge + UI + テスト | G3 | 1.5日 |
| 6-C | 可視化強化: 一覧に利用プロジェクト数・テンプレートメタ情報整備 | G4, G6 | 0.5日 |
| 6-D | バージョン差分比較画面 | G5 | 1.0日 |
| 6-E | 整理: aiPrompts.ts 削除・休眠3メソッドの方針決定（削除 or 温存をコメント明記） | G7, G8 | 0.25日 |

**合計: 約4.25日**（6-B/6-D は独立して着手可能）

### 事前に決めるべき判断ポイント
1. **custom モードの存続**: (a) 後方互換として残す（推奨・低リスク） / (b) 廃止して全プロジェクトをパッケージ+オーバーライドへ統一（指示書の純粋形・移行コスト大）
2. **オーバーライドの粒度**: ポリシーのみ許可か、テンプレート本文の上書きまで許可か（テンプレート上書きを許すと「パッケージ中心管理」が再び崩れるリスク）

---

## 7. 推奨アーキテクチャ

現行実装（Phase 1〜5）の構造を**そのまま土台として維持**し、上記4フェーズで指示書との差分を埋めるのが最小リスク。理由:

- パッケージ→バージョン→テンプレート→プロジェクトの階層・published/archived ライフサイクル・fallback・監査ログ・確認導線は既に指示書の要求水準を満たしている
- ai_logs のFKなしスナップショット方式により、将来拡張（ABテスト・バージョン別品質比較）は集計クエリの追加だけで実現できる
- 唯一の構造的追加は「個別オーバーライド層」で、resolveEffectiveProjectConfig に merge ステップを1段挟むだけで済む（解決優先順位: overrides > package version > legacy）

custom モードは「オーバーライドが全量になった特殊ケース」と再解釈できるため、長期的には (b) 統一が綺麗だが、当面は (a) 共存で運用し、パッケージ運用が安定してから統合を検討することを推奨する。
