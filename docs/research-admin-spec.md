# Research Admin / CSV / Analysis Spec

## 1. 管理画面の追加項目

### Project
- `research_mode`
- `primary_objectives`
- `secondary_objectives`
- `comparison_constraints`
- `prompt_rules`
- `probe_policy`
- `response_style`

### Question
- `question_role`
  - `screening`
  - `main`
  - `probe_trigger`
  - `attribute`
  - `comparison_core`

## 2. 回答閲覧の構成

### Respondents 一覧
- プロジェクト名
- 回答者名
- LINE User ID
- 回答者ステータス
- セッション数
- 完了セッション数
- 最新セッション状態
- ポイント
- ランク

### Respondent 詳細
- 回答者の基本情報
- プロジェクト情報
- セッション一覧
- ポイント履歴

### Session 詳細
- 質問ごとの回答
- `normalized_answer`
- AI 深掘り有無
- 深掘り回答本文
- Conversation Log
- セッション単位 AI 分析結果

## 3. CSV 仕様

### 出力単位
- 1 回答者 1 行
- 対象セッションは `latest completed session` を優先し、存在しない場合は `latest session` を採用

### 行メタ列
- `project_id`
- `project_name`
- `client_name`
- `project_status`
- `project_objective`
- `research_mode`
- `primary_objectives`
- `secondary_objectives`
- `respondent_id`
- `line_user_id`
- `display_name`
- `respondent_status`
- `session_id`
- `session_status`
- `session_phase`
- `respondent_created_at`
- `session_started_at`
- `session_completed_at`
- `session_last_activity_at`

### 質問列
- `question_code` ベース
  - `<question_code>_answer_text`
  - `<question_code>_normalized_answer`
  - `<question_code>_ai_probe`
- `question_order` ベースも選択可
  - `q01_answer_text`
  - `q01_normalized_answer`
  - `q01_ai_probe`

### 値の扱い
- `answer_text`: 一次回答
- `normalized_answer`: 一次回答の JSON 文字列
- `ai_probe`: 該当質問に AI 深掘り回答が 1 件以上ある場合 `true`

## 4. 分析出力仕様

### 分析用 dataset
- `respondentSummaries`
- `comparisonUnits`
- `nonComparableQuestions`
- `freeAnswerPolicy`

### comparisonUnits
- 構造化質問
  - `single_select`
  - `multi_select`
  - `yes_no`
  - `scale`
- 出力
  - `question_code`
  - `question_role`
  - `question_type`
  - `aggregation_type`
  - `response_count`
  - `values[]`
  - `note`

### qualitative only
- `text` 質問は比較不能な自由回答として扱う
- 比率断定の根拠には使わない
- 反復テーマと objective への関連で整理する

### AI レポート JSON
- `executive_summary`
- `overall_trends`
- `primary_objectives`
- `secondary_objectives`
- `comparison_focus`
- `free_answer_policy`
- `respondent_summaries`

### AI 制約
- 回答者ごとの要約は簡潔にする
- 複数人比較では共通観点を優先する
- 面白い 1 回答に引っ張られない
- `primary_objectives` を中心に分析する
- `secondary_objectives` は補助扱いにする

## 5. 既存テーブルとの接続方法

### 既存利用
- `projects`
  - 調査設計の中核
- `questions`
  - 設問定義
  - `question_role` を追加
- `respondents`
  - 回答者単位の管理軸
- `sessions`
  - 回答セッション単位
- `messages`
  - Conversation Log
- `answers`
  - 設問回答
  - `answer_role` と `parent_answer_id` を追加
- `ai_analysis_results`
  - セッション単位の個別要約

### 新規追加
- `project_analysis_reports`
  - プロジェクト単位の AI 分析レポート保存先

### 回答集約ルール
- 一次回答は `answers.answer_role = primary`
- AI 深掘り回答は `answers.answer_role = ai_probe`
- 深掘り回答は `answers.parent_answer_id` で一次回答に紐付ける

## 6. 画面別の変更内容

### `/admin/projects`
- 調査設計の要約表示
- Respondents / Analysis への導線追加

### `/admin/projects/:projectId/edit`
- 調査設計項目の編集

### `/admin/projects/:projectId/questions`
- `question_role` 表示

### `/admin/projects/:projectId/questions/new`
### `/admin/questions/:questionId/edit`
- `question_role` 編集

### `/admin/projects/:projectId/respondents`
- プロジェクト単位の回答者一覧
- CSV 出力導線
- 分析画面導線

### `/admin/respondents`
- 全プロジェクト横断の回答者一覧強化

### `/admin/respondents/:respondentId`
- セッション一覧への導線整理

### `/admin/sessions/:sessionId`
- 質問別回答
- `normalized_answer`
- AI 深掘り有無
- Conversation Log
- セッション AI 分析

### `/admin/projects/:projectId/analysis`
- 比較単位一覧
- 個別要約一覧
- 自由回答の扱い方針
- 最新 AI レポート表示
