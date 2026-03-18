# LINE Chat Interview MVP

LINE上で固定質問フローを進行し、回答保存、必要最小限のAI深掘り、要約、分析、ポイント・ランク運用を行うMVPです。

## 採用技術構成

- Runtime: Node.js 24 + TypeScript
- Web: Express + EJS
- DB/BaaS: Supabase (Postgres)
- Messaging: LINE Messaging API (HTTP呼び出し)
- AI: OpenAI API
- UI: LINE Flex Message + シンプルな管理画面

## ディレクトリ構成

```text
src/
  config/          環境変数とクライアント初期化
  controllers/     HTTPハンドラ
  lib/             共通ユーティリティ
  prompts/         AI用途別プロンプト
  repositories/    Supabaseアクセス
  routes/          ルーティング
  services/        会話制御、AI、ポイント、ランク等の業務ロジック
  templates/       LINE Flexテンプレート
  types/           ドメイン型
  views/           管理画面EJS
  app.ts           Express構成
  server.ts        起動エントリ
supabase/
  migrations/      スキーマ定義
  seed.sql         初期データ
```

## DBスキーマ案

`supabase/migrations/001_init.sql` に以下を実装しています。

- projects
- questions
- respondents
- sessions
- messages
- answers
- ai_analysis_results
- ai_logs
- ranks
- point_transactions
- reward_rules
- respondent_rank_histories

## 管理画面の画面一覧

- `/admin` ダッシュボード
- `/admin/projects` プロジェクト一覧
- `/admin/projects/new` プロジェクト作成
- `/admin/projects/:id/edit` プロジェクト編集
- `/admin/projects/:id/questions` 質問一覧
- `/admin/projects/:id/questions/new` 質問作成
- `/admin/questions/:id/edit` 質問編集
- `/admin/respondents` 回答者一覧
- `/admin/respondents/:id` 個票詳細、進捗、会話ログ、分析結果
- `/admin/points` ポイント・ランク管理
- `/admin/ranks` ランク閾値管理
- `/admin/exports/*` CSV出力

## LINE上のUI一覧

- follow時の歓迎メッセージ
- `はじめる` / `再開` / `ポイント` / `ランク` / `マイページ` / `ヘルプ`
- 質問文
- 回答完了通知
- ポイント獲得通知
- ランクアップ通知
- マイページ風Flex Message

## API一覧

- `GET /health`
- `POST /webhooks/line`
- `GET /admin/*`
- `POST /admin/projects`
- `POST /admin/questions`
- `POST /admin/ranks`
- `POST /admin/respondents/:id/points`
- `GET /admin/exports/answers.csv`
- `GET /admin/exports/messages.csv`
- `GET /admin/exports/analysis.csv`
- `GET /admin/exports/points.csv`
- `GET /admin/exports/ranks.csv`

## 会話制御フロー

1. followイベントで回答者をupsertし、歓迎メッセージを返す
2. `はじめる` で対象プロジェクトの未完了セッションを再開、なければ新規作成
3. 現在質問を送信
4. 回答を検証して保存
5. 固定分岐ルールで次質問を決定
6. 必要な場合のみAI深掘りを1回挿入
7. 5問ごと、または完了時に要約更新
8. 完了時に最終分析、ポイント付与、ランク更新、完了通知

## AI利用フロー

- 深掘り: 現在質問 + 直前回答 + セッション要約
- 要約: 直近5件までのQ/A断片 + 既存要約
- 最終分析: 圧縮済み要約 + 構造化回答一覧

全履歴は送らず、用途別プロンプトを分離しています。

## ポイント付与フロー

1. セッション完了
2. `reward_rules` と `projects.reward_points` を参照
3. 基本報酬、初回参加ボーナス、継続参加ボーナス、案件ボーナスを計算
4. `point_transactions` に履歴保存
5. `respondents.total_points` を更新

## ランク更新フロー

1. 累計ポイント更新後に `ranks` を参照
2. 到達済み最大ランクを決定
3. 変更時は `respondent_rank_histories` に保存
4. LINEでランクアップ通知

## 実装優先順位

1. Webhook、固定質問、回答保存、セッション
2. 管理画面最低限
3. 質問管理、回答管理、会話ログ、CSV
4. ポイント、ランク
5. AI深掘り、要約、最終分析
6. Flex Messageとマイページ導線

## セットアップ

```bash
npm install
npm run dev
```

Supabaseには `supabase/migrations/001_init.sql` と `supabase/seed.sql` を適用してください。
