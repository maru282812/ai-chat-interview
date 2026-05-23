# Phase2 未実装タスク一覧

## 実装済み（今回対応）

- [x] LIFFマイページ登録導線
  - [x] 必須項目（呼び名・生年月日・性別・都道府県・職業・業種）
  - [x] 推奨項目（婚姻状況・子どもの有無）
  - [x] 利用規約同意チェックボックス
  - [x] 登録後 `profile_completed = true`
  - [x] `next` URLへの登録完了後リダイレクト
  - [x] `/liff/rant`, `/liff/diary`, `/liff/personality` からマイページへの誘導
- [x] `/admin/data-management` ページ（NGワード・カテゴリ管理）
- [x] DB migration: `024_user_profile_gender.sql`（genderカラム追加）

---

## 未実装・後続対応

### スケジュール配信 cron

`delivery_campaigns` の `scheduled_at` を見て自動で `executeCampaign` を呼び出す処理。

候補実装方式:
- Node.js `setInterval` または `node-cron` でサーバー起動時にジョブ登録
- Supabase Edge Function + pg_cron
- 外部スケジューラー（GitHub Actions など）

対応ファイル候補:
- `src/services/schedulerService.ts`（新規作成）
- `src/server.ts` にジョブ登録処理を追加

---

### 推奨項目の拡充

マイページ推奨項目に未実装のもの:

- 世帯年収
- 興味ジャンル（`user_attributes` テーブルで管理）
- 通知許可設定（`notification_ok`）
- 性格分析公開可否
- 愚痴/日記データの分析利用同意

---

### 管理画面 未作成ページ

| パス | 状態 | 備考 |
|---|---|---|
| `/admin/attributes` | 実装済み | 属性定義マスタ管理 |
| `/admin/segments` | 実装済み | セグメント管理 |
| `/admin/ai-analysis` | 実装済み | AI分析ダッシュボード |
| `/admin/data-management` | 実装済み | NGワード・カテゴリ管理 |
| セグメント配信キャンペーン一覧 | 未実装 | `/admin/segments/campaigns` の一覧ページ |

---

### ユーザー属性（user_attributes）の編集UI

LIFFマイページから `user_attributes` テーブルの属性（興味カテゴリ等）を
編集できる推奨項目UIの拡充。

対応ファイル:
- `src/repositories/userAttributeRepository.ts`（既存）
- `src/views/liff/mypage.ejs`（編集フォームに追加）

---

### history-data / points-data ページのプロフィールチェック

現在 `/liff/history-data` と `/liff/points-data` はAPIエンドポイントのため
プロフィールチェックのリダイレクト対象から除外している。
これらをLIFFページとして追加する場合は同様のチェックを実装する。

---

### DBマイグレーション適用手順

未適用のマイグレーションは以下をSupabaseのSQL Editorで順番に実行:

1. `supabase/migrations/022_phase2_foundation.sql`
2. `supabase/migrations/023_phase2d.sql`
3. `supabase/migrations/024_user_profile_gender.sql`
