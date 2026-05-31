# 実装済み機能一覧

> 作成日: 2026-05-31  
> 調査対象: `c:\work\ai-chat-interview`  
> 技術スタック: TypeScript + Express + EJS + Supabase (PostgreSQL) + OpenAI + LINE Messaging API + LIFF

---

## 1. 概要

本プロジェクトは **LINE + Supabase + OpenAI** を組み合わせた **リサーチプラットフォーム** です。  
LINE 上でユーザーとインタビュー・アンケートを実施し、AI によるプローブ機能・分析機能を備えた管理システムです。

### システム構成

| レイヤー | 技術 |
|---|---|
| LINE 連携 | LINE Messaging API (Webhook) + LIFF |
| フロントエンド | EJS テンプレート（管理画面 / LIFF ページ） |
| バックエンド | Express (TypeScript) |
| DB | Supabase (PostgreSQL) / 39 マイグレーション |
| AI | OpenAI GPT（回答分析・プローブ・タグ生成） |
| 通知 | LINE Push Messaging |
| スケジューラ | node-cron ベースの通知スケジューラ |

---

## 2. 機能一覧サマリー

| No | 機能名 | 実装状況 | 関連画面 | 主要ファイル |
|---|---|---|---|---|
| 1 | プロジェクト管理 | 実装済み | `/admin/projects` | adminController, projectRepository |
| 2 | 質問設計（フロー） | 実装済み | `/admin/projects/:id/questions` | questionFlowServiceV2, adminController |
| 3 | フローデザイナー | 実装済み | `/admin/projects/:id/questions/flow` | questions/flowDesigner.ejs |
| 4 | ページグループ管理 | 実装済み | `/admin/projects/:id/page-groups` | questionPageGroupRepository |
| 5 | LINE Webhook 処理 | 実装済み | - (Webhook) | webhookController, conversationOrchestratorService |
| 6 | LIFF アンケート/インタビュー | 実装済み | `/liff/survey` | liffController, questionFlowServiceV2 |
| 7 | AI プローブ機能 | 実装済み | - (バックエンド) | aiService, conversationOrchestratorService |
| 8 | 回答収集・保存 | 実装済み | - | answerRepository, sessionRepository |
| 9 | 案件配信管理 | 実装済み | `/admin/projects/:id/delivery` | assignmentService, projectAssignmentRepository |
| 10 | スクリーニング条件 | 実装済み | `/admin/projects/:id/screening` | screeningService, screeningConditionRepository |
| 11 | 日記投稿 (LIFF) | 実装済み | `/liff/diary` | postService, liffController |
| 12 | 本音投稿 (LIFF) | 実装済み | `/liff/rant` | postService, rantTagRepository |
| 13 | 投稿管理（管理画面） | 実装済み | `/admin/posts` | adminController, postRepository |
| 14 | 投稿分析（AI） | 実装済み | `/admin/post-analysis` | aiTagService, analysisService |
| 15 | パーソナリティ診断 | 一部実装済み | `/liff/personality` | personalityService |
| 16 | マイページ | 実装済み | `/liff/mypage` | liffController |
| 17 | プロフィール確認 | 実装済み | `/liff/profile/check` | liffController, userProfileRepository |
| 18 | お問い合わせ | 実装済み | `/liff/contact` | liffController |
| 19 | ポイント管理 | 実装済み | `/admin/points` | userPointService, pointTransactionRepository |
| 20 | バッジシステム | 実装済み | `/admin/badges` | userBadgeService |
| 21 | ランク制度 | 実装済み | `/admin/ranks` | rankService, userRankService |
| 22 | 連続回答ボーナス | 実装済み | - (バックエンド) | userStreakService |
| 23 | セグメント管理 | 実装済み | `/admin/segments` | segmentRepository, adminController |
| 24 | 属性定義管理 | 実装済み | `/admin/attributes` | userAttributeRepository |
| 25 | 配信キャンペーン | 一部実装済み | `/admin/segments` | deliveryCampaignRepository |
| 26 | デイリーアンケート | 実装済み | `/liff/daily-survey` + `/admin/daily-surveys` | dailySurveyService |
| 27 | 設問優先度管理 | 実装済み | `/admin/daily-question-priorities` | dailyQuestionPriorityService |
| 28 | 通知テンプレート管理 | 実装済み | `/admin/notification-templates` | notificationTemplateRepository |
| 29 | 通知スケジューラ | 実装済み | `/admin/scheduler-settings` | notificationSchedulerService |
| 30 | 報酬キャンペーン | 実装済み | `/admin/reward-campaigns` | rewardCampaignService |
| 31 | AI 分析ダッシュボード | 一部実装済み | `/admin/ai-analysis` | aiTagService, researchOpsService |
| 32 | プロジェクト分析 | 実装済み | `/admin/projects/:id/analysis` | analysisService, adminController |
| 33 | CSV エクスポート | 実装済み | `/admin/exports/*` | csvService, adminController |
| 34 | データ管理（NG ワード） | 実装済み | `/admin/data-management` | adminController |
| 35 | ユーザープロフィール管理 | 実装済み | `/admin/user-profiles` | userProfileRepository |
| 36 | 管理画面認証 | 実装済み | - (ミドルウェア) | adminAuth.ts |
| 37 | UP 管理画面認証 | 実装済み | `/admin/user-profiles/login` | adminController |
| 38 | LINE メニュー操作 | 実装済み | - (LINE) | menuActionService, menuActionServiceDb |
| 39 | Flex Message 送信 | 実装済み | - (バックエンド) | flex.ts, lineMessagingService |
| 40 | 画像アップロード | 実装済み | 管理画面・LIFF | storage.ts, adminController, liffController |
| 41 | AI フロー自動生成 | 実装済み | `/admin/projects/:id/questions/flow` | adminController (apiGenerateFlow) |
| 42 | フロー流用 | 実装済み | フローデザイナー | adminController (apiImportFlowFromProject) |
| 43 | 不足属性分析 | 実装済み | `/admin/ai-analysis` | missingAttributeService |
| 44 | 回答抽出・構造化 | 実装済み | - (バックエンド) | answerExtractionService |
| 45 | 回答者管理 | 実装済み | `/admin/respondents` | respondentService, researchOpsService |

---

## 3. 機能詳細

---

### 3.1 プロジェクト管理

#### 概要
リサーチプロジェクト（インタビュー・アンケート）の作成・編集・コピー・削除。プロジェクト単位で質問フローを設計し、ユーザーへ配信する。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts)
- [src/routes/adminRoutes.ts](../src/routes/adminRoutes.ts)
- [src/repositories/projectRepository.ts](../src/repositories/projectRepository.ts)
- [src/views/admin/projects/index.ejs](../src/views/admin/projects/index.ejs)
- [src/views/admin/projects/form.ejs](../src/views/admin/projects/form.ejs)
- [src/views/admin/projects/list.ejs](../src/views/admin/projects/list.ejs)
- [src/views/admin/projects/researchForm.ejs](../src/views/admin/projects/researchForm.ejs)

#### 関連URL・画面遷移
- `/admin/projects` - プロジェクト一覧
- `/admin/projects/new` - 新規作成フォーム
- `/admin/projects/:id/edit` - 編集フォーム
- `POST /admin/projects/:id/copy` - コピー
- `POST /admin/projects/:id/delete` - 削除
- 管理画面 > プロジェクト管理

#### 関連DB
- `projects` テーブル（`001_init.sql`, `002_project_research_settings.sql`, `012_project_ai_state.sql`, `031_add_user_display_title.sql`）
  - `name`, `description`, `research_mode`, `primary_objectives`, `ai_state_json`, `user_display_title`

#### 現在できること
- プロジェクトを作成・編集・削除できる
- プロジェクトをコピーできる（質問ごとコピー）
- リサーチ設定（`research_mode`等）を編集できる
- プロジェクト一覧を表示できる

#### 不足・未完成点
- アーカイブ機能の画面が未実装の可能性あり（コード上に delete のみ確認）
- プロジェクト有効/無効の明示的な切り替えが不明

#### 動作確認方法
1. サーバー起動 (`npm run dev`)
2. `/admin/projects` にアクセス
3. 「新規作成」ボタンでプロジェクト作成
4. 保存・編集・コピー・削除を確認

---

### 3.2 質問設計・フロー管理

#### 概要
プロジェクトに紐づく質問（Question）の CRUD と、分岐条件付きフロー設計。質問型式は単一選択・複数選択・マトリクス・テキスト・画像付き等多様。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts)
- [src/repositories/questionRepository.ts](../src/repositories/questionRepository.ts)
- [src/services/questionFlowServiceV2.ts](../src/services/questionFlowServiceV2.ts)
- [src/lib/questionEngine.ts](../src/lib/questionEngine.ts)
- [src/lib/questionDesign.ts](../src/lib/questionDesign.ts)
- [src/lib/questionMetadata.ts](../src/lib/questionMetadata.ts)
- [src/types/questionSchema.ts](../src/types/questionSchema.ts)
- [src/views/admin/questions/flowDesigner.ejs](../src/views/admin/questions/flowDesigner.ejs)
- [src/views/admin/questions/formV3.ejs](../src/views/admin/questions/formV3.ejs)
- [src/views/admin/questions/indexV2.ejs](../src/views/admin/questions/indexV2.ejs)

#### 関連URL・画面遷移
- `/admin/projects/:id/questions` - 質問一覧
- `/admin/projects/:id/questions/flow` - フローデザイナー
- `/admin/projects/:id/questions/new` - 質問作成
- `/admin/questions/:id/edit` - 質問編集
- 管理画面 > プロジェクト > 質問管理 > フローデザイナー

#### 関連DB
- `questions` テーブル（`001_init.sql`, `008`, `014`, `016`, `017`, `019`, `020`, `021`, `030`）
  - `question_type`, `options_json`, `tags`, `is_screening_question`, `probe_guideline`, `max_probe_count`, `image_url` など多数

#### 現在できること
- 質問を作成・編集・削除できる
- フローデザイナーで分岐条件を視覚的に設定できる
- 質問タイプ（単一選択・複数選択・マトリクス・テキスト等）を選べる
- AI で選択肢を自動提案できる
- 別プロジェクトからフローを流用できる
- AI でフロー全体を自動生成できる
- タグを解析・生成できる

#### 不足・未完成点
- 旧バージョン（formV1, formV2, questions/index.ejs 等）が残存しており整理が必要
- デザイナー向けビュー（formDesigner.ejs, indexDesigner.ejs）の用途が不明確

---

### 3.3 フローデザイナー（ビジュアルエディター）

#### 概要
質問フローを視覚的に編集できる管理画面。ドラッグ&ドロップで質問の順序・分岐を設定する。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/views/admin/questions/flowDesigner.ejs](../src/views/admin/questions/flowDesigner.ejs)
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`questionFlow`, `apiUpdateQuestionFlow`, `apiCreateQuestionFlow`, `apiDeleteQuestion`)

#### 関連URL・画面遷移
- `/admin/projects/:id/questions/flow`

#### 関連DB
- `questions` テーブル（フロー順序・分岐条件）

#### 現在できること
- フロー全体を視覚的に確認できる
- 質問の追加・削除・順序変更ができる
- API で質問を更新できる（`POST /admin/api/questions/:id`）

---

### 3.4 ページグループ管理

#### 概要
`survey_page` モードのプロジェクトで、複数質問を1ページにまとめる「ページグループ」の管理。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts)
- [src/repositories/questionPageGroupRepository.ts](../src/repositories/questionPageGroupRepository.ts)
- [src/views/admin/projects/pageGroups.ejs](../src/views/admin/projects/pageGroups.ejs)

#### 関連URL・画面遷移
- `/admin/projects/:id/page-groups`

#### 関連DB
- `question_page_groups` テーブル

#### 現在できること
- ページグループを作成・更新・削除できる
- 質問をページグループに割り当てられる

---

### 3.5 LINE Webhook 処理

#### 概要
LINE からのイベント（フォロー・テキストメッセージ等）を受信し、会話制御・回答収集・インタビュー進行を行う。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/webhookController.ts](../src/controllers/webhookController.ts)
- [src/routes/webhookRoutes.ts](../src/routes/webhookRoutes.ts)
- [src/services/conversationOrchestratorService.ts](../src/services/conversationOrchestratorService.ts)
- [src/services/conversationService.ts](../src/services/conversationService.ts)
- [src/lib/conversationControl.ts](../src/lib/conversationControl.ts)
- [src/lib/line.ts](../src/lib/line.ts)
- [src/services/lineMessagingService.ts](../src/services/lineMessagingService.ts)

#### 関連URL・画面遷移
- `POST /webhooks/line` - LINE Webhook エンドポイント

#### 関連DB
- `messages` テーブル（メッセージ履歴）
- `sessions` テーブル（会話セッション）
- `answers` テーブル（回答）

#### 現在できること
- LINE フォローイベントを受信・処理できる
- LINE テキストメッセージを受信・会話形式で処理できる
- LINE Signature 検証が実施されている
- メッセージをログに保存できる

---

### 3.6 LIFF アンケート・インタビュー画面

#### 概要
LINE の LIFF でブラウザを開き、チャット形式または画面フォーム形式でアンケート・インタビューに回答できる画面。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/liffController.ts](../src/controllers/liffController.ts)
- [src/routes/liffRoutes.ts](../src/routes/liffRoutes.ts)
- [src/services/liffService.ts](../src/services/liffService.ts)
- [src/services/liffAuthService.ts](../src/services/liffAuthService.ts)
- [src/services/questionFlowServiceV2.ts](../src/services/questionFlowServiceV2.ts)
- [src/views/liff/survey.ejs](../src/views/liff/survey.ejs)

#### 関連URL・画面遷移
- `/liff/survey` - アンケート/インタビュー（デフォルト）
- `/liff/survey/:assignmentId` - 案件指定で開始
- `POST /liff/survey/answer` - 回答送信
- `POST /liff/survey/complete` - 回答完了
- `POST /liff/survey/:assignmentId/complete` - 案件完了確定
- `POST /liff/survey/:assignmentId/judge-screening` - スクリーニング判定

#### 関連DB
- `sessions`, `answers`, `project_assignments`, `messages`

#### 現在できること
- LIFF を開いてアンケート・インタビューに回答できる
- 回答を順次送信・保存できる
- 完了処理（ポイント付与等）を実行できる
- スクリーニング判定が実行される
- 画像をアップロードできる
- LIFF ID Token 検証で本人確認できる

#### 不足・未完成点
- UI の詳細（チャット形式 vs ページ形式の分岐）は `survey.ejs` の実装次第（要確認）

---

### 3.7 AI プローブ機能

#### 概要
インタビュー回答をリアルタイムで AI（OpenAI）が分析し、情報が不足している場合に追加質問（プローブ）を自動生成する機能。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/services/aiService.ts](../src/services/aiService.ts)
- [src/prompts/aiPrompts.ts](../src/prompts/aiPrompts.ts)
- [src/config/openai.ts](../src/config/openai.ts)
- [src/repositories/aiLogRepository.ts](../src/repositories/aiLogRepository.ts)

#### 関連DB
- `ai_logs` テーブル（LLM 呼び出しログ）
- `answer_extractions` テーブル

#### 現在できること
- 回答を分析し、情報不足を検知できる
- プローブ質問を自動生成できる
- 回答から構造化データを抽出できる
- セッション要約・最終分析ができる
- AI 呼び出しをログに記録できる

---

### 3.8 回答収集・保存

#### 概要
インタビュー・アンケートの回答を DB に保存する基盤。選択肢・テキスト・画像など多様な回答型式に対応。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/repositories/answerRepository.ts](../src/repositories/answerRepository.ts)
- [src/repositories/answerExtractionRepository.ts](../src/repositories/answerExtractionRepository.ts)
- [src/repositories/sessionRepository.ts](../src/repositories/sessionRepository.ts)
- [src/services/answerExtractionService.ts](../src/services/answerExtractionService.ts)

#### 関連DB
- `answers` テーブル（`001_init.sql`, `019_answers_free_text.sql`）
- `answer_extractions` テーブル（`013_answer_extractions.sql`）
- `sessions` テーブル

#### 現在できること
- 回答を DB に保存できる
- 自由記述回答（`free_text_answer`）を保存できる
- 回答から構造化データを抽出・保存できる

---

### 3.9 案件配信管理

#### 概要
プロジェクトを特定のユーザー（回答者）に配信（アサイン）する機能。手動配信とルールベース配信に対応。期限管理・リマインダー送信も含む。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts)
- [src/services/assignmentService.ts](../src/services/assignmentService.ts)
- [src/repositories/projectAssignmentRepository.ts](../src/repositories/projectAssignmentRepository.ts)
- [src/views/admin/projects/deliveryV2.ejs](../src/views/admin/projects/deliveryV2.ejs)
- [src/views/admin/projects/delivery.ejs](../src/views/admin/projects/delivery.ejs)

#### 関連URL・画面遷移
- `/admin/projects/:id/delivery` - 配信管理画面
- `POST /admin/projects/:id/delivery/manual` - 手動配信
- `POST /admin/projects/:id/delivery/rules` - ルール配信
- `POST /admin/projects/:id/delivery/reminders` - リマインダー送信

#### 関連DB
- `project_assignments` テーブル（`004_project_assignments.sql`, `006`, `018`）
  - `status` (pending/started/completed/expired), `delivery_channel`, `assigned_at`, `expired_at`

#### 現在できること
- 特定ユーザーに手動でプロジェクトを配信できる
- ルールに基づいて対象ユーザーを絞り込み配信できる
- リマインダーを送信できる
- 期限切れ案件を自動処理できる（`expireOverdueAssignments`）
- 配信状況（未回答・期限切れ等）を CSV でエクスポートできる

#### 不足・未完成点
- `delivery.ejs`（v1）と `deliveryV2.ejs` の2バージョンが存在し、どちらを使うか要確認

---

### 3.10 スクリーニング条件管理

#### 概要
プロジェクトへの参加資格を、ユーザー属性（プロフィール）または回答条件で判定するスクリーニング機能。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts)
- [src/services/screeningService.ts](../src/services/screeningService.ts)
- [src/repositories/screeningConditionRepository.ts](../src/repositories/screeningConditionRepository.ts)
- [src/views/admin/projects/screening.ejs](../src/views/admin/projects/screening.ejs)

#### 関連URL・画面遷移
- `/admin/projects/:id/screening` - スクリーニング条件管理

#### 関連DB
- `screening_conditions` テーブル（`028_screening_conditions.sql`）
- `questions` の `is_screening_question` フラグ（`030_screening_question_pass_options.sql`）

#### 現在できること
- スクリーニング条件を追加・削除できる
- プロフィール属性・回答内容に基づく条件を設定できる
- LIFF からスクリーニング判定を実行できる（`judgeScreening`）

---

### 3.11 日記投稿 (LIFF)

#### 概要
ユーザーが LIFF 上で日記（感情・体験の記録）を投稿する機能。AI による品質評価・感情分析が付随する。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/liffController.ts](../src/controllers/liffController.ts) (`diaryPage`, `createPost`)
- [src/services/postService.ts](../src/services/postService.ts)
- [src/services/postCompleteService.ts](../src/services/postCompleteService.ts)
- [src/repositories/postRepository.ts](../src/repositories/postRepository.ts)
- [src/views/liff/diary.ejs](../src/views/liff/diary.ejs)

#### 関連URL・画面遷移
- `/liff/diary` - 日記入力ページ
- `POST /liff/posts` - 投稿作成 API
- `GET /liff/diary-calendar` - カレンダー表示（投稿履歴）

#### 関連DB
- `user_posts` テーブル（`007_post_foundation.sql`, `011`, `026`）
  - `post_type` (diary/rant), `quality_score`, `quality_label`, `emotion_tags`

#### 現在できること
- 日記を投稿できる
- カレンダーで投稿履歴を確認できる
- 投稿完了後にポイントが付与される
- AI で品質スコアが計算される

---

### 3.12 本音投稿 (LIFF)

#### 概要
ユーザーが「本音・不満・願望」を匿名で投稿する機能。AI タグ付与・カウンセラー返信生成も実装。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/liffController.ts](../src/controllers/liffController.ts) (`rantPage`, `createPost`)
- [src/services/postService.ts](../src/services/postService.ts)
- [src/services/aiTagService.ts](../src/services/aiTagService.ts)
- [src/repositories/rantTagRepository.ts](../src/repositories/rantTagRepository.ts)
- [src/views/liff/rant.ejs](../src/views/liff/rant.ejs)

#### 関連URL・画面遷移
- `/liff/rant` - 本音投稿ページ
- `POST /liff/posts` - 投稿作成 API

#### 関連DB
- `user_posts` テーブル（`post_type = 'rant'`）
- `rant_tags` テーブル（`027_rant_tags.sql`）
- `post_analysis` テーブル

#### 現在できること
- 本音を投稿できる
- AI タグが自動付与される
- AI カウンセラー返信が生成される（`generateRantCounselorReply`）
- NG ワードフィルタリングが適用される（`data-management` 参照）

---

### 3.13 投稿管理（管理画面）

#### 概要
管理者が全ユーザーの日記・本音投稿を一覧・詳細確認できる画面。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`posts`, `postDetail`)
- [src/services/researchOpsService.ts](../src/services/researchOpsService.ts)
- [src/views/admin/posts/index.ejs](../src/views/admin/posts/index.ejs)
- [src/views/admin/posts/show.ejs](../src/views/admin/posts/show.ejs)

#### 関連URL・画面遷移
- `/admin/posts` - 投稿一覧
- `/admin/posts/:id` - 投稿詳細

#### 現在できること
- 投稿一覧を閲覧できる
- 投稿詳細（AI タグ・品質スコア）を確認できる

---

### 3.14 投稿分析（AI）

#### 概要
投稿を AI が詳細分析し、感情・テーマ・ペルソナタグを付与する機能。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`postAnalysis`, `runExtendedPostAnalysis`, `runUserTagGeneration`)
- [src/services/aiTagService.ts](../src/services/aiTagService.ts)
- [src/services/analysisService.ts](../src/services/analysisService.ts)
- [src/repositories/postAnalysisRepository.ts](../src/repositories/postAnalysisRepository.ts)
- [src/views/admin/postAnalysis/index.ejs](../src/views/admin/postAnalysis/index.ejs)

#### 関連URL・画面遷移
- `/admin/post-analysis` - 投稿分析一覧
- `POST /admin/api/ai/analyze-post/:id` - 個別投稿の詳細分析実行
- `POST /admin/api/ai/generate-user-tags/:id` - ユーザータグ生成

#### 関連DB
- `post_analysis` テーブル

#### 現在できること
- 投稿分析結果一覧を確認できる
- 管理画面から手動で AI 分析を実行できる
- ユーザーペルソナタグを AI 生成できる

---

### 3.15 パーソナリティ診断

#### 概要
ユーザーの回答履歴から AI がパーソナリティプロファイルを生成・表示する機能。

#### 実装状況
**一部実装済み**（画面・サービスは実装済み、自動更新タイミングが要確認）

#### 関連ファイル
- [src/controllers/liffController.ts](../src/controllers/liffController.ts) (`personalityPage`, `personalityData`)
- [src/services/personalityService.ts](../src/services/personalityService.ts)
- [src/services/personalityServiceImpl.ts](../src/services/personalityServiceImpl.ts)
- [src/services/personalityServiceV2.ts](../src/services/personalityServiceV2.ts)
- [src/repositories/personalityProfileRepository.ts](../src/repositories/personalityProfileRepository.ts)
- [src/views/liff/personality.ejs](../src/views/liff/personality.ejs)

#### 関連URL・画面遷移
- `/liff/personality` - パーソナリティ診断表示
- `GET /liff/personality-data` - データ取得 API

#### 関連DB
- `personality_profiles` テーブル

#### 現在できること
- パーソナリティプロファイルを表示できる
- AI でプロファイルを生成・更新できる（`getOrBuild`）

#### 不足・未完成点
- v1 / v2 / Impl と3バージョンのサービスが存在し、どれが実際に呼ばれているか要確認
- プロファイルの自動更新タイミングが不明

---

### 3.16 マイページ (LIFF)

#### 概要
ユーザーが自分のプロフィール・ポイント・バッジ・回答履歴を確認できるページ。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/liffController.ts](../src/controllers/liffController.ts) (`mypagePage`, `getMypageData`, `updateMypageData`, `getHistoryData`, `getPointsData`)
- [src/views/liff/mypage.ejs](../src/views/liff/mypage.ejs)

#### 関連URL・画面遷移
- `/liff/mypage` - マイページ
- `GET /liff/mypage-data` - データ取得
- `POST /liff/mypage-data` - プロフィール更新
- `GET /liff/history-data` - 回答履歴
- `GET /liff/points-data` - ポイント情報

#### 関連DB
- `user_profiles`, `user_points`, `point_transactions`, `project_assignments`

#### 現在できること
- プロフィールを確認・更新できる
- ポイント残高・履歴を確認できる
- 回答履歴を確認できる
- バッジ・ランクを確認できる

---

### 3.17 プロフィール確認 (LIFF)

#### 概要
ユーザーが未入力の属性（年齢・性別等）を補完するプロフィール確認画面。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/liffController.ts](../src/controllers/liffController.ts) (`profileCheckPage`, `getProfileCheckData`)
- [src/views/liff/profile-check.ejs](../src/views/liff/profile-check.ejs)

#### 関連URL・画面遷移
- `/liff/profile/check` - プロフィール確認
- `GET /liff/profile-check-data` - データ取得
- `GET /liff/profile-status` - 入力状況確認

#### 関連DB
- `user_profiles` テーブル（`015_user_profiles_and_screening.sql`, `024_user_profile_gender.sql`）
  - `gender`, `birth_year`, `prefecture` など

---

### 3.18 お問い合わせ (LIFF)

#### 概要
ユーザーからのお問い合わせを受け付けるフォーム。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/liffController.ts](../src/controllers/liffController.ts) (`contactPage`, `submitContact`)
- [src/views/liff/contact.ejs](../src/views/liff/contact.ejs)

#### 関連URL・画面遷移
- `/liff/contact` - お問い合わせページ
- `POST /liff/contact` - 送信

#### 関連DB
- `contact_messages` テーブル（`025_contact_messages.sql`）

---

### 3.19 ポイント管理

#### 概要
ユーザーへのポイント付与・残高管理・履歴管理。アンケート完了・日記投稿等でポイントが付与される。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/services/userPointService.ts](../src/services/userPointService.ts)
- [src/services/pointService.ts](../src/services/pointService.ts)
- [src/repositories/pointTransactionRepository.ts](../src/repositories/pointTransactionRepository.ts)
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`points`, `adjustUserPoints`)
- [src/views/admin/points/index.ejs](../src/views/admin/points/index.ejs)

#### 関連URL・画面遷移
- `/admin/points` - ポイント管理一覧
- `POST /admin/user-points/:lineUserId/adjust` - ポイント手動調整
- `GET /admin/exports/points.csv` - CSV エクスポート

#### 関連DB
- `user_points` テーブル（`033_migrate_points_to_user_points.sql`）
- `point_transactions` テーブル
- `v_user_point_summary` ビュー（`039_fix_033_view_grant.sql`）

#### 現在できること
- ポイント残高を確認できる
- ポイントを手動で調整できる
- ポイント履歴を確認できる
- ポイントを CSV でエクスポートできる
- アンケート完了・投稿完了時に自動付与される

---

### 3.20 バッジシステム

#### 概要
達成条件に応じてユーザーにバッジを付与するシステム。バッジ定義の管理と自動付与機能。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/services/userBadgeService.ts](../src/services/userBadgeService.ts)
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`badgesPage`, `updateBadgeStatus`)
- [src/views/admin/badges/index.ejs](../src/views/admin/badges/index.ejs)

#### 関連URL・画面遷移
- `/admin/badges` - バッジ管理

#### 関連DB
- `badge_definitions` テーブル（`032_daily_survey_notifications_points.sql`）
- `user_badges` テーブル

#### 現在できること
- バッジ一覧を確認できる
- バッジの有効/無効を切り替えられる（`PATCH /admin/badges/:id/status`）
- 条件達成時にバッジが自動付与される（`checkAndAward`）
- バッジ授与数の集計ができる

---

### 3.21 ランク制度

#### 概要
ポイント総量に応じてユーザーのランクを自動計算・更新するシステム。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/services/rankService.ts](../src/services/rankService.ts)
- [src/services/userRankService.ts](../src/services/userRankService.ts)
- [src/repositories/rankRepository.ts](../src/repositories/rankRepository.ts)
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`ranks`, `updateRank`)
- [src/views/admin/ranks/index.ejs](../src/views/admin/ranks/index.ejs)

#### 関連URL・画面遷移
- `/admin/ranks` - ランク管理
- `GET /admin/exports/ranks.csv` - CSV エクスポート

#### 関連DB
- `ranks` テーブル（ランク定義）
- `respondents.rank_id` または `user_points` の関連

#### 現在できること
- ランク定義を一覧・編集できる
- ポイントからランクを自動解決できる
- ランクを CSV エクスポートできる

---

### 3.22 連続回答ボーナス（ストリーク）

#### 概要
ユーザーが連続して回答・投稿したことを記録し、ボーナスポイントを付与するストリーク機能。

#### 実装状況
**実装済み**（バックエンドのみ。LIFF 画面への表示は要確認）

#### 関連ファイル
- [src/services/userStreakService.ts](../src/services/userStreakService.ts)

#### 関連DB
- `user_streaks` テーブル（`032_daily_survey_notifications_points.sql`）

#### 現在できること
- 連続回答日数を記録できる
- ストリーク数を取得できる
- ボーナス計算ができる

#### 不足・未完成点
- LIFF マイページへの表示が未実装の可能性あり

---

### 3.23 セグメント管理

#### 概要
ユーザー属性・行動データに基づくセグメント（ユーザーグループ）定義と配信ターゲティング。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts)
- [src/repositories/segmentRepository.ts](../src/repositories/segmentRepository.ts)
- [src/views/admin/segments/index.ejs](../src/views/admin/segments/index.ejs)
- [src/views/admin/segments/form.ejs](../src/views/admin/segments/form.ejs)
- [src/views/admin/segments/campaign-form.ejs](../src/views/admin/segments/campaign-form.ejs)

#### 関連URL・画面遷移
- `/admin/segments` - セグメント一覧
- `/admin/segments/new` - 新規作成
- `/admin/segments/:id/edit` - 編集
- `POST /admin/api/segments/preview` - プレビュー（対象ユーザー数確認）
- `POST /admin/api/segments/:id/evaluate` - 評価実行

#### 関連DB
- `segments` テーブル（`022_phase2_foundation.sql`）

#### 現在できること
- セグメント定義を作成・編集・削除できる
- セグメントプレビューで対象ユーザー数を事前確認できる
- セグメントを評価・更新できる

---

### 3.24 属性定義管理

#### 概要
ユーザー属性（年齢・性別・地域等）の定義を管理するマスタ管理画面。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`attributesPage`, `createAttributeDefinition`, `deleteAttributeDefinition`)
- [src/repositories/userAttributeRepository.ts](../src/repositories/userAttributeRepository.ts)
- [src/views/admin/attributes/index.ejs](../src/views/admin/attributes/index.ejs)

#### 関連URL・画面遷移
- `/admin/attributes` - 属性定義管理

#### 関連DB
- `attribute_definitions` テーブル（`022_phase2_foundation.sql`, `035_attribute_definitions_daily_keys.sql`）
- `user_attributes` テーブル

#### 現在できること
- 属性定義を作成・削除できる
- ユーザー属性値を管理できる

---

### 3.25 配信キャンペーン

#### 概要
セグメント × 通知テンプレートを組み合わせた配信キャンペーン管理。スケジュール配信。

#### 実装状況
**一部実装済み**（管理画面・リポジトリは実装済み、キャンペーン実行の完全性は要確認）

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`newCampaignPage`, `createCampaign`, `executeCampaign` 等)
- [src/repositories/deliveryCampaignRepository.ts](../src/repositories/deliveryCampaignRepository.ts)
- [src/views/admin/segments/campaign-form.ejs](../src/views/admin/segments/campaign-form.ejs)

#### 関連URL・画面遷移
- `/admin/segments/campaigns/new` - キャンペーン作成
- `POST /admin/api/campaigns/:id/execute` - キャンペーン実行

#### 関連DB
- `delivery_campaigns` テーブル

#### 不足・未完成点
- キャンペーン一覧画面が専用のものか、セグメント画面内に統合されているか要確認
- `executeCampaign` の処理内容（実際の LINE プッシュ送信）の完全実装確認が必要

---

### 3.26 デイリーアンケート

#### 概要
毎日配信される短いアンケート。設問・配信・回答・分析まで一貫して管理できる機能。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (dailySurveys 系)
- [src/controllers/liffController.ts](../src/controllers/liffController.ts) (`dailySurveyPage`, `getDailySurveyData`, `submitDailySurveyAnswer`)
- [src/services/dailySurveyService.ts](../src/services/dailySurveyService.ts)
- [src/repositories/dailySurveyRepository.ts](../src/repositories/dailySurveyRepository.ts)
- [src/views/admin/daily-surveys/index.ejs](../src/views/admin/daily-surveys/index.ejs)
- [src/views/admin/daily-surveys/form.ejs](../src/views/admin/daily-surveys/form.ejs)
- [src/views/admin/daily-surveys/show.ejs](../src/views/admin/daily-surveys/show.ejs)
- [src/views/admin/daily-surveys/analytics.ejs](../src/views/admin/daily-surveys/analytics.ejs)
- [src/views/liff/daily-survey.ejs](../src/views/liff/daily-survey.ejs)

#### 関連URL・画面遷移
- `/admin/daily-surveys` - 管理一覧
- `/admin/daily-surveys/new` - 作成フォーム
- `/admin/daily-surveys/:id/analytics` - 分析画面
- `/liff/daily-survey` - ユーザー回答ページ
- `POST /admin/daily-surveys/:id/deliver` - 配信実行
- `POST /liff/daily-survey/:id/answer` - 回答送信

#### 関連DB
- `daily_surveys` テーブル（`032_daily_survey_notifications_points.sql`）
- `daily_survey_questions` テーブル
- `daily_survey_answers` テーブル

#### 現在できること
- デイリーアンケートを作成・編集・削除できる
- 設問を追加・編集・削除できる
- ステータス（下書き・アクティブ・一時停止・完了）を管理できる
- 対象ユーザーに配信できる
- LIFF で回答できる
- 回答分析を確認できる

---

### 3.27 設問優先度管理

#### 概要
デイリーアンケートの設問配信優先度を管理する機能。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/services/dailyQuestionPriorityService.ts](../src/services/dailyQuestionPriorityService.ts)
- [src/repositories/dailyQuestionPriorityRepository.ts](../src/repositories/dailyQuestionPriorityRepository.ts)
- [src/views/admin/daily-question-priorities/index.ejs](../src/views/admin/daily-question-priorities/index.ejs)
- [src/views/admin/daily-question-priorities/form.ejs](../src/views/admin/daily-question-priorities/form.ejs)

#### 関連URL・画面遷移
- `/admin/daily-question-priorities` - 優先度一覧
- `/admin/daily-question-priorities/new` - 作成

#### 現在できること
- 設問優先度を作成・編集・削除・有効化/無効化できる

---

### 3.28 通知テンプレート管理

#### 概要
LINE プッシュ通知のメッセージテンプレートを管理する機能。デフォルトテンプレートの設定も可能。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (notificationTemplates 系)
- [src/repositories/notificationTemplateRepository.ts](../src/repositories/notificationTemplateRepository.ts)
- [src/views/admin/notification-templates/index.ejs](../src/views/admin/notification-templates/index.ejs)
- [src/views/admin/notification-templates/form.ejs](../src/views/admin/notification-templates/form.ejs)

#### 関連URL・画面遷移
- `/admin/notification-templates` - テンプレート一覧
- `/admin/notification-templates/new` - 作成フォーム

#### 関連DB
- `notification_templates` テーブル（`032_daily_survey_notifications_points.sql`, `034_notification_templates_seed.sql`）

#### 現在できること
- 通知テンプレートを作成・編集・削除できる
- テンプレートを有効/無効にできる
- デフォルトテンプレートを設定できる
- 初期データ（Seed）が投入済み（`034`）

---

### 3.29 通知スケジューラ

#### 概要
デイリーアンケート通知・朝夕メッセージ・未回答リマインダーを自動送信するスケジューラ。管理画面から設定・手動実行が可能。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/services/notificationSchedulerService.ts](../src/services/notificationSchedulerService.ts)
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`schedulerSettings`, `updateSchedulerSettings`, `runSchedulerJob`)
- [src/views/admin/scheduler-settings/index.ejs](../src/views/admin/scheduler-settings/index.ejs)

#### 関連URL・画面遷移
- `/admin/scheduler-settings` - スケジューラ設定
- `POST /admin/scheduler-settings/run/:job` - 手動実行

#### 関連DB
- `notification_scheduler_settings` テーブル（`036_notification_scheduler_settings.sql`）

#### 現在できること
- スケジューラの設定（時刻・有効/無効）を管理できる
- スケジューラを手動実行できる（`runDailyMorning`, `runDailyEvening`, `runUnansweredReminder`）
- スケジューラを起動・停止・再起動できる

---

### 3.30 報酬キャンペーン

#### 概要
特定条件達成時にユーザーに報酬（ポイント・特典）を付与するキャンペーン機能。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/services/rewardCampaignService.ts](../src/services/rewardCampaignService.ts)
- [src/repositories/rewardCampaignRepository.ts](../src/repositories/rewardCampaignRepository.ts)
- [src/repositories/rewardRuleRepository.ts](../src/repositories/rewardRuleRepository.ts)
- [src/views/admin/reward-campaigns/index.ejs](../src/views/admin/reward-campaigns/index.ejs)
- [src/views/admin/reward-campaigns/form.ejs](../src/views/admin/reward-campaigns/form.ejs)

#### 関連URL・画面遷移
- `/admin/reward-campaigns` - キャンペーン一覧
- `/admin/reward-campaigns/new` - 作成フォーム

#### 関連DB
- `reward_campaigns` テーブル
- `reward_rules` テーブル

#### 現在できること
- 報酬キャンペーンを作成・編集・削除・有効化/無効化できる

#### 不足・未完成点
- キャンペーンが実際にポイント付与にどう連動しているか要確認（`postCompleteService` との繋がり）

---

### 3.31 AI 分析ダッシュボード

#### 概要
ユーザー投稿の AI 分析結果・ペルソナタグ・属性カバレッジを閲覧するダッシュボード。

#### 実装状況
**一部実装済み**（画面・APIは実装済み、分析の完全自動実行は要確認）

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`aiAnalysisPage`, `aiReportPage`)
- [src/services/aiTagService.ts](../src/services/aiTagService.ts)
- [src/services/missingAttributeService.ts](../src/services/missingAttributeService.ts)
- [src/views/admin/ai-analysis/index.ejs](../src/views/admin/ai-analysis/index.ejs)
- [src/views/admin/ai-analysis/report.ejs](../src/views/admin/ai-analysis/report.ejs)

#### 関連URL・画面遷移
- `/admin/ai-analysis` - AI 分析ダッシュボード
- `/admin/ai-analysis/report` - 詳細レポート
- `GET /admin/api/missing-attributes/coverage` - 属性カバレッジ
- `GET /admin/api/missing-attributes/suggest` - 属性提案

#### 現在できること
- AI 分析ダッシュボードを閲覧できる
- 個別投稿の詳細分析を手動実行できる
- ユーザータグを手動生成できる
- 属性カバレッジを確認できる

---

### 3.32 プロジェクト分析

#### 概要
プロジェクト単位の回答データを分析し、AI レポートを生成する機能。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`projectAnalysis`, `runProjectAnalysis`)
- [src/services/analysisService.ts](../src/services/analysisService.ts)
- [src/services/aiService.ts](../src/services/aiService.ts) (`generateProjectAnalysis`)
- [src/repositories/projectAnalysisRepository.ts](../src/repositories/projectAnalysisRepository.ts)
- [src/views/admin/projects/analysis.ejs](../src/views/admin/projects/analysis.ejs)

#### 関連URL・画面遷移
- `/admin/projects/:id/analysis` - 分析表示
- `POST /admin/projects/:id/analysis` - 分析実行

#### 関連DB
- `project_analysis_reports` テーブル
- `ai_analysis_results` テーブル

#### 現在できること
- プロジェクトの回答データを分析できる
- AI 分析レポートを生成できる
- 分析結果を閲覧できる

---

### 3.33 CSV エクスポート

#### 概要
各種データを CSV 形式でエクスポートする機能。管理者が分析ツールにインポートできる。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/services/csvService.ts](../src/services/csvService.ts)
- [src/lib/csv.ts](../src/lib/csv.ts)
- [src/controllers/adminController.ts](../src/controllers/adminController.ts)

#### エクスポート種別と URL

| エクスポート対象 | URL |
|---|---|
| 全回答 | `GET /admin/exports/answers.csv` |
| 全メッセージ | `GET /admin/exports/messages.csv` |
| AI 分析結果 | `GET /admin/exports/analysis.csv` |
| ポイント一覧 | `GET /admin/exports/points.csv` |
| ランク一覧 | `GET /admin/exports/ranks.csv` |
| ユーザー投稿 | `GET /admin/exports/user-posts.csv` |
| 投稿分析 | `GET /admin/exports/post-analysis.csv` |
| プロジェクト回答者 | `GET /admin/projects/:id/exports/respondents.csv` |
| 配信状況 | `GET /admin/projects/:id/exports/assignments.csv` |
| 未回答一覧 | `GET /admin/projects/:id/exports/unanswered.csv` |
| 期限切れ一覧 | `GET /admin/projects/:id/exports/expired.csv` |

#### 現在できること
- 上記11種類のデータを CSV でダウンロードできる

---

### 3.34 データ管理（NG ワード・カテゴリ）

#### 概要
投稿内容のフィルタリングに使う NG ワードと、投稿カテゴリのマスタ管理。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`dataManagementPage` 等)
- [src/views/admin/data-management/index.ejs](../src/views/admin/data-management/index.ejs)

#### 関連URL・画面遷移
- `/admin/data-management` - NG ワード・カテゴリ管理

#### 関連DB
- `ng_words` テーブル（`023_phase2d.sql`）
- `post_categories` テーブル（`023_phase2d.sql`）

#### 現在できること
- NG ワードを追加・有効/無効・削除できる
- 投稿カテゴリを追加・有効/無効・削除できる

---

### 3.35 ユーザープロフィール管理（管理画面）

#### 概要
管理者が全ユーザーのプロフィール（LINE ユーザー情報・属性）を閲覧・管理できる画面。別ログインによるアクセス制御付き。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`userProfilesLoginPage`, `userProfilesLogin`, `userProfilesAdmin`)
- [src/repositories/userProfileRepository.ts](../src/repositories/userProfileRepository.ts)
- [src/views/admin/user-profiles/login.ejs](../src/views/admin/user-profiles/login.ejs)
- [src/views/admin/user-profiles/index.ejs](../src/views/admin/user-profiles/index.ejs)

#### 関連URL・画面遷移
- `/admin/user-profiles/login` - 専用ログインページ
- `/admin/user-profiles` - ユーザープロフィール一覧

#### 現在できること
- 別パスワードでログインできる（Cookie セッション）
- ユーザープロフィール一覧を閲覧できる

---

### 3.36 管理画面認証

#### 概要
管理画面全体へのアクセス制御ミドルウェア。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/middleware/adminAuth.ts](../src/middleware/adminAuth.ts)

#### 現在できること
- 未認証アクセスをリダイレクトできる

#### 不足・未完成点
- 認証方式の詳細（セッション・Basic 認証等）は `adminAuth.ts` 内容次第（要確認）

---

### 3.37 LINE メニュー操作

#### 概要
LINE リッチメニューのボタン押下やキーワード送信で、LIFF ページへの誘導やアクションを実行する機能。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/services/menuActionService.ts](../src/services/menuActionService.ts)
- [src/services/menuActionServiceDb.ts](../src/services/menuActionServiceDb.ts)
- [src/repositories/lineMenuActionRepository.ts](../src/repositories/lineMenuActionRepository.ts)

#### 関連DB
- `line_menu_actions` テーブル

#### 現在できること
- テキストメッセージからアクションを解決できる
- 選択肢の保留・クリアができる
- DB ベースのアクション管理ができる

---

### 3.38 Flex Message 送信

#### 概要
LINE の Flex Message（カード型リッチメッセージ）を生成・送信する機能。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/templates/flex.ts](../src/templates/flex.ts)
- [src/services/lineMessagingService.ts](../src/services/lineMessagingService.ts)

#### 現在できること
- Flex Message テンプレートを生成できる
- LINE に Flex Message を Reply/Push で送信できる

---

### 3.39 画像アップロード

#### 概要
管理画面・LIFF からの画像（プロフィール画像・質問画像等）アップロード機能。Supabase Storage を使用。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/config/storage.ts](../src/config/storage.ts)
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`uploadImage`)
- [src/controllers/liffController.ts](../src/controllers/liffController.ts) (`uploadRespondentImage`)

#### 関連URL・画面遷移
- `POST /admin/api/upload/image` - 管理画面画像アップロード
- `POST /liff/survey/upload-image` - LIFF 画像アップロード

#### 現在できること
- 管理画面から画像をアップロードできる
- LIFF から回答者画像をアップロードできる
- Supabase Storage に保存される

---

### 3.40 AI フロー自動生成・流用

#### 概要
OpenAI を使って質問フローを自動生成する機能と、既存プロジェクトのフローを別プロジェクトに流用する機能。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`apiGenerateFlow`, `apiImportFlowFromProject`, `apiGetProjectFlowPreview`)

#### 関連URL・画面遷移
- `POST /admin/api/projects/:id/flow/generate` - フロー自動生成
- `POST /admin/api/projects/:id/flow/import-from-project` - フロー流用
- `GET /admin/api/projects/:id/flow-preview` - プレビュー

#### 現在できること
- プロジェクト設定をもとに AI がフローを自動生成できる
- 既存プロジェクトのフローをコピーして流用できる
- 流用前にプレビューで内容確認できる

---

### 3.41 回答者管理

#### 概要
回答者（Respondent）の一覧・詳細確認と管理機能。回答履歴・セッション・ポイント・バッジ等を一元確認。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`respondents`, `respondentDetail`, `adjustPoints`)
- [src/services/researchOpsService.ts](../src/services/researchOpsService.ts)
- [src/repositories/respondentRepository.ts](../src/repositories/respondentRepository.ts)
- [src/views/admin/respondents/index.ejs](../src/views/admin/respondents/index.ejs)
- [src/views/admin/respondents/show.ejs](../src/views/admin/respondents/show.ejs)

#### 関連URL・画面遷移
- `/admin/respondents` - 一覧
- `/admin/respondents/:id` - 詳細
- `POST /admin/respondents/:id/points` - ポイント調整

#### 現在できること
- 回答者一覧を確認できる
- 回答者の詳細（セッション・回答・ポイント等）を確認できる
- ポイントを手動調整できる

---

### 3.42 セッション詳細閲覧

#### 概要
インタビュー・アンケートの1セッション分の詳細（メッセージ・回答・AI ログ）を確認する画面。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`sessionDetail`)
- [src/services/researchOpsService.ts](../src/services/researchOpsService.ts)
- [src/views/admin/sessions/show.ejs](../src/views/admin/sessions/show.ejs)

#### 関連URL・画面遷移
- `/admin/sessions/:id` - セッション詳細

#### 現在できること
- セッション内のメッセージ・回答・AI ログを確認できる

---

### 3.43 不足属性分析

#### 概要
ユーザー属性のカバレッジを分析し、収集すべき属性の設問を提案する AI 機能。

#### 実装状況
**実装済み**

#### 関連ファイル
- [src/services/missingAttributeService.ts](../src/services/missingAttributeService.ts)
- [src/controllers/adminController.ts](../src/controllers/adminController.ts) (`apiMissingAttributeCoverage`, `apiMissingAttributeSuggest`)

#### 関連URL・画面遷移
- `GET /admin/api/missing-attributes/coverage`
- `GET /admin/api/missing-attributes/suggest`

#### 現在できること
- 属性収集カバレッジを計算できる
- 不足属性を補う設問を AI が提案できる

---

### 3.44 回答抽出・構造化

#### 概要
自由記述回答から構造化データ（スロット）を抽出する機能。

#### 実装状況
**実装済み**（バックエンドのみ）

#### 関連ファイル
- [src/services/answerExtractionService.ts](../src/services/answerExtractionService.ts)
- [src/repositories/answerExtractionRepository.ts](../src/repositories/answerExtractionRepository.ts)

#### 関連DB
- `answer_extractions` テーブル（`013_answer_extractions.sql`）

#### 現在できること
- 回答から構造化データを抽出できる
- 抽出データを DB に保存できる
- 回答を再処理できる

---

## 4. 未完成・要確認の機能一覧

| No | 機能名 | 状況 | 要確認事項 |
|---|---|---|---|
| 1 | パーソナリティ診断（自動更新） | 要確認 | v1/v2/Impl 3バージョン存在。どれが呼ばれているか、自動更新タイミングが不明 |
| 2 | 配信キャンペーン（実行） | 要確認 | `executeCampaign` の完全実装確認（実際の LINE プッシュ送信まで実施されているか） |
| 3 | 管理画面認証方式 | 要確認 | `adminAuth.ts` の認証方式詳細（Basic 認証・セッション等） |
| 4 | ストリーク（LIFF 表示） | 要確認 | マイページへのストリーク表示が実装されているか |
| 5 | 報酬キャンペーンの連動 | 要確認 | `rewardCampaignService` と `postCompleteService` の連動箇所 |
| 6 | 旧バージョンの EJS ファイル | 使用されていない可能性あり | `questions/form.ejs`（v1）、`questions/index.ejs`（v1）、`projects/delivery.ejs`（v1）等の使用有無 |
| 7 | デザイナー向けビュー | 使用されていない可能性あり | `formDesigner.ejs`, `indexDesigner.ejs`, `indexDesigner.ejs` の使用有無 |
| 8 | 会話形式 LINE インタビュー | 要確認 | `conversationService.ts` vs `conversationOrchestratorService.ts` どちらが主体か |
| 9 | LIFF コンセント（同意管理） | 要確認 | `getConsentData`/`updateConsentData` の画面が存在するか不明 |
| 10 | AI カウンセラー返信の配信 | 要確認 | `generateRantCounselorReply` 実行後の LINE 送信が実装されているか |

---

## 5. 今後の改修優先度

### 優先度 高（安定稼働・品質改善）

1. **旧バージョン EJS の整理** — `form.ejs`（v1/v2）, `index.ejs`（v1）等の使用有無確認と削除
2. **パーソナリティサービスの整理** — v1/v2/Impl の統合または明確な切り分け
3. **配信キャンペーン実行の完全性確認** — LINE プッシュ送信まで確実に動作するか検証
4. **管理画面認証方式の文書化** — 認証フローの明確化

### 優先度 中（機能追加・UX 改善）

5. **ストリーク（連続回答ボーナス）のマイページ表示** — バックエンドは実装済み、LIFF 画面への反映
6. **報酬キャンペーンとポイント付与の連動** — キャンペーン条件達成 → ポイント自動付与の仕組み確認
7. **AI カウンセラー返信の自動配信** — 本音投稿への返信を LINE で自動送信
8. **コンセント（同意管理）画面の確認** — API は存在するが対応画面が不明

### 優先度 低（将来的な機能強化）

9. **Phase 2 フル対応** — セグメント × 配信キャンペーンの本格運用
10. **分析ダッシュボードの強化** — 集計・可視化の拡充
11. **テスト整備** — `tests/questionSchemaRedesign.test.ts` のみ存在し、テストカバレッジが低い

---

*本ファイルは 2026-05-31 時点のコードから作成した調査結果です。コード変更後は更新が必要です。*
