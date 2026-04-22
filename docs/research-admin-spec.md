✅ research-admin-spec（最適化版）
1. 管理画面：調査設計項目
Project
research_mode              : 調査形式（survey / interview / hybrid）
primary_objectives         : 主目的（分析の最優先軸）
secondary_objectives       : 副目的（補助的分析軸）
comparison_constraints     : 比較条件（セグメント・対象制限）
prompt_rules               : AI応答ルール（禁止・制約）
probe_policy               : 深掘り制御設定
response_style             : 回答スタイル制御
Question
question_role:
  - screening         : スクリーニング
  - main              : 主質問
  - probe_trigger     : 深掘り対象
  - attribute         : 属性情報
  - comparison_core   : 比較分析の核
  - context           : 前提・説明（分析対象外）
2. 回答閲覧（Admin UI）
Respondents 一覧
project_name
display_name
line_user_id
respondent_status
total_sessions
completed_sessions
latest_session_status
points
rank
Respondent 詳細
基本情報
プロジェクト情報
セッション一覧
ポイント履歴
Session 詳細
質問別回答一覧
normalized_answer（構造化データ）
ai_probe_count（深掘り回数）
ai_probe_answers（深掘り本文一覧）
conversation_log
ai_analysis_result（セッション要約）
3. CSV 出力仕様
出力単位
1回答者 = 1行
対象セッション選定ルール（重要）
優先順位:
1. completed AND is_valid = true
2. completed
3. latest in_progress
4. その他は除外
メタ列
project_id
project_name
client_name
project_status
project_objective
research_mode
primary_objectives
secondary_objectives

respondent_id
line_user_id
display_name
respondent_status

session_id
session_status
session_phase

respondent_created_at
session_started_at
session_completed_at
session_last_activity_at
質問列
question_code ベース
<question_code>_answer_text
<question_code>_normalized_answer
<question_code>_ai_probe_count
<question_code>_ai_probe_texts
question_order ベース（オプション）
q01_answer_text
q01_normalized_answer
q01_ai_probe_count
q01_ai_probe_texts
値仕様
answer_text        : 一次回答（raw）
normalized_answer  : JSON文字列（DBはJSONB）
ai_probe_count     : 深掘り回数
ai_probe_texts     : 深掘り回答配列（JSON）
4. 分析出力仕様
分析 dataset
respondentSummaries
comparisonUnits
nonComparableQuestions
freeAnswerPolicy
comparisonUnits（構造化分析）

対象:

single_select
multi_select
yes_no
scale

出力:

question_code
question_role
question_type
aggregation_type
response_count
values[]
note
nonComparableQuestions
{
  "question_code": "Q5",
  "reason": "free_text",
  "analysis_hint": "テーマ抽出・感情分類のみ実施"
}
qualitative（自由回答）
・比率根拠には使用しない
・テーマ単位で整理
・primary_objectivesとの関連を重視
AI レポート JSON
{
  "executive_summary": "",
  "overall_trends": "",
  "primary_objectives": "",
  "secondary_objectives": "",
  "comparison_focus": "",
  "free_answer_policy": "",
  "respondent_summaries": [],
  "data_sufficiency": "low | medium | high"
}
AI 制約
・回答者要約は簡潔
・共通傾向を優先
・単一意見に引っ張られない
・primary_objectives を最優先
・secondary_objectives は補助扱い
5. データ構造 / DB設計
既存テーブル
projects
questions（question_role追加）
respondents
sessions（is_valid追加推奨）
messages（conversation log）
answers
ai_analysis_results
answers テーブル拡張
answer_role:
  - primary
  - ai_probe

parent_answer_id:
  primary回答への紐付け
新規テーブル
project_analysis_reports
normalized_answer
DB: JSONB
CSV: stringifyして出力
回答集約ルール
primary回答:
  answers.answer_role = primary

AI深掘り:
  answers.answer_role = ai_probe

紐付け:
  parent_answer_id
6. 管理画面構成
/admin/projects
調査設計サマリ表示
Respondents / Analysis への導線
/admin/projects/:projectId/edit
調査設計項目編集
/admin/projects/:projectId/questions
question_role 表示
/admin/projects/:projectId/questions/new
/admin/questions/:questionId/edit
question_role 編集
/admin/projects/:projectId/respondents
回答者一覧
CSV出力
分析画面導線
/admin/respondents
全プロジェクト横断一覧
/admin/respondents/:respondentId
セッション一覧導線
/admin/sessions/:sessionId
質問別回答
normalized_answer
ai_probe_count / texts
conversation_log
ai_analysis_result
/admin/projects/:projectId/analysis
comparisonUnits一覧
respondentSummaries
nonComparableQuestions
freeAnswerPolicy
最新AIレポート