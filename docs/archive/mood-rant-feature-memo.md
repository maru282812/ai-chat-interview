# 今日の気持ち・愚痴/本音機能 実装メモ

> このファイルは、未コミット変更を破棄する前に、今後再利用できるよう機能内容を整理したメモ。
> 作成日: 2026-05-25

---

## 1. 概要

このフェーズで実装・改修した機能は大きく3つ。

1. **今日の気持ち（diary）機能** — 感情タグ記録、カレンダー表示、月次集計API改善
2. **愚痴/本音（rant）機能** — UI改善、タグのみ投稿対応、AIカウンセラー改善
3. **アンケートのプロフィール確認画面** — セッション開始前にプロフィールスナップショットを保存

---

## 2. 今日の気持ち（diary）機能

### 目的
ユーザーが日々の気分や気持ちタグを記録できるようにする。

### UI改善内容（`src/views/liff/diary.ejs`）
- `fsec-label` フォントサイズ: 13px → 16px / font-weight: 600 → 700
- 感情チップ（`.e-chip`）のパディング・サイズを拡大（見やすさ改善）
- `mood_score`ボタン（旧 `.mood-btn`）を廃止し、感情タグのみに集約
- PCレイアウト向け `@media (min-width: 1024px)` ブロック追加

### 月次集計API改善（`src/controllers/liffController.ts`）

#### 変更前
- `byDate` マップの重複日は先に来た投稿のみ記録
- `mood_trend`: 直近7日の `mood_score` を返す

#### 変更後
- 同日複数投稿の `emotion_tags` を `Set` でマージ（重複除去）
- `mood_score` は当日の最高値を採用
- **月次統計を返すように変更**:
  - `positive` カウント: `["happy", "fun", "motivated", "proud"]`
  - `tired` カウント: `["tired", "anxious", "irritated", "sad"]`
  - `normal` カウント: その他タグ
  - `tag_ranking`: 月内でよく使われたタグ上位5件
- `month_stats: { positive, normal, tired }` / `tag_ranking` / `current_month` を返す

### APIレスポンス構造（変更後）
```json
{
  "ok": true,
  "entries": [...],
  "stats": { "streak": 3, "last_entry_date": "2026-05-24" },
  "month_stats": { "positive": 5, "normal": 3, "tired": 2 },
  "tag_ranking": [{ "code": "calm", "count": 4 }],
  "current_month": "2026-05"
}
```

### シードスクリプト（`scripts/seedDiaryDummyData.mjs`）
- 過去30日分のダミーデータを `user_posts` テーブルに投入するスクリプト
- 環境変数: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- オプション: `SEED_USER_ID`（デフォルト値あり）, `SEED_TODAY`
- 感情タグ一覧:
  - `happy`, `tired`, `anxious`, `moody`, `fun`, `irritated`, `calm`, `sad`, `sleepy`, `motivated`, `proud`
- `user_posts` の `type="diary"` かつ `metadata.dummy_seed="diary_calendar_ui_dummy_v1"` で識別
- 既存ダミーデータを削除してから挿入するべき等設計

```bash
node scripts/seedDiaryDummyData.mjs
# または
SEED_USER_ID=Uxxx node scripts/seedDiaryDummyData.mjs
```

---

## 3. 愚痴 / 本音 / 悩み投稿機能

### 目的
ユーザーが本音や悩みを低いハードルで投稿できるようにする。

### UI改善内容（`src/views/liff/rant.ejs`）

#### スタイル変更
- `fsec-label`: 13px→16px, font-weight 600→700
- `r-chip`: サイズ・パディング拡大、色調をモダンに（`#14b8a6` ベース）
- `textarea`: カラー・placeholder・フォーカス枠を追加
- PCレイアウト向け `@media (min-width: 1024px)` 追加

#### テキスト変更
| 変更前 | 変更後 |
|--------|--------|
| `今感じていることをそのまま書いてください。` | `書ける範囲で大丈夫です。ひとことだけでもOKです。` |
| `本音・悩みを入力して投稿してください。` | `タグを選ぶか、ひとこと書いてみてください。` |
| `AIからの一言` | `AIからのひとこと` |
| `〇人` | `〇人が共感` |

#### 投稿条件（バリデーション追加）
以下のどちらかを満たせば投稿可能:
- 本文が入力されている
- タグが1つ以上選択されている

本文もタグもない場合のエラー文言:
> 今の気持ちに近いタグを1つ選ぶか、ひとこと入力してください。

#### 投稿完了後の表示改善
- 本文が空の場合: 本文ボックス（`result-content`）を非表示にする
- タグのみ投稿でも完了画面が正しく表示される

### バックエンド改善

#### エラーメッセージ変更（`src/controllers/liffController.ts`）
```ts
// 変更前
throw new HttpError(400, "投稿内容を入力してください。");
// 変更後
throw new HttpError(400, "今の気持ちに近いタグを1つ選ぶか、ひとこと入力してください。");
```

#### AIカウンセラー返信の条件変更
```ts
// 変更前: 本文が空なら AI 返信なし
if (!content) {
  aiReply = await aiService.generateRantCounselorReply(...);
}
// 変更後: タグがあれば本文なしでも AI 返信あり
if (content || tagLabels.length > 0) {
  aiReply = await aiService.generateRantCounselorReply(...);
}
```

#### aiService の条件変更（`src/services/aiService.ts`）
```ts
// 変更前
if (!postText.trim()) return null;
// 変更後（タグもなければスキップ）
if (!postText.trim() && tagLabels.length === 0) return null;
```

### AIカウンセラープロンプト改善（`src/prompts/researchPrompts.ts`）
- 「本文がある場合は本文優先、ない場合はタグから推測」を明示
- ルール追加:
  - 質問で終わらせない
  - 会話継続を促さない
  - 「頑張れ」を多用しない
  - 病名・診断をしない
- 文字数制限: 80文字以内（変更なし）
- 1〜2文以内（変更なし）

---

## 4. アンケート プロフィール確認画面

### 目的
アンケート開始前にユーザーのプロフィール情報をスナップショットとして保存する。
リサーチ集計時にユーザーの属性（性別・年齢・職業等）を回答と紐付けられるようにする。

### フロー
1. セッションに `profile_snapshot_json` が未保存の場合、アンケートURL開通時にプロフィール確認画面を表示
2. ユーザーが「この内容で開始する」を押すと `/liff/sessions/:sessionId/profile-snapshot` APIを呼び出してスナップショット保存
3. スナップショット保存後、アンケート本体を表示

### 新規APIエンドポイント
```
POST /liff/sessions/:sessionId/profile-snapshot
```
- `liffController.saveSessionProfileSnapshot` が処理
- `LIFF_AUTH_REQUIRED=true` の場合のみ Bearer トークン認証
- ユーザープロフィールを `sessions.profile_snapshot_json` に保存

### スナップショット内容
```json
{
  "gender": "female",
  "birth_date": "1990-01-01",
  "prefecture": "東京都",
  "occupation": "会社員",
  "industry": "IT",
  "marital_status": "married",
  "has_children": true,
  "children_ages": [],
  "household_composition": [],
  "nickname": "田中",
  "snapshotted_at": "2026-05-25T00:00:00.000Z"
}
```

### マイページからの「変更する」導線
- `mypage.ejs`: 保存完了後に `next` パラメータが `/liff/` で始まる場合のみリダイレクト（open redirect 対策済み）

---

## 5. 管理画面 Raw Data CSV エクスポート

### 新規機能（リサーチ用）
- `GET /admin/projects/:projectId/exports/raw-data.csv`
- `adminController.exportProjectRawData` → `csvService.projectRawDataCsv` → `researchOpsService.buildRawDataExportRows`

### CSV列構成
| 列名 | 内容 |
|------|------|
| `MID` | LINE ユーザーID |
| `SUPPLIER` | 固定値 "LINE" |
| `START` / `END` | セッション開始・終了日時 |
| `TIME` | 所要時間（分） |
| `SEX` | 性別コード (1:男性, 2:女性, 3:その他, 9:回答しない) |
| `AGE` | 年齢 |
| `GEN` | 年代（10の倍数） |
| `PRE` | 都道府県 |
| `JOB` | 職業 |
| `BUS` | 業種 |
| `MAR` | 婚姻状況コード (1:未婚, 2:既婚, 3:離婚, 4:死別) |
| `CHI` | 子供の有無 (1:あり, 2:なし) |
| `{code}` | SA設問: 選択肢の1始まりインデックス |
| `{code}C{n}` | MA設問: 各選択肢の選択有無 (1/0) |
| `{code}` | FA設問: テキストそのまま |

- プロフィール情報は `sessions.profile_snapshot_json` から取得
- スナップショット未保存の場合は全プロフィール列がnull

---

## 6. 関連ファイル一覧

### 変更ファイル（Git追跡済み）
| ファイル | 内容 |
|---------|------|
| `src/views/liff/diary.ejs` | 今日の気持ち UI 全面改修 |
| `src/views/liff/rant.ejs` | 愚痴/本音投稿 UI 改善、タグのみ投稿対応 |
| `src/views/liff/survey.ejs` | プロフィール確認画面 追加 |
| `src/views/liff/mypage.ejs` | 保存後リダイレクト（open redirect対策） |
| `src/controllers/liffController.ts` | プロフィールスナップショットAPI, 月次集計改善, 愚痴バリデーション改善 |
| `src/routes/liffRoutes.ts` | `/sessions/:sessionId/profile-snapshot` ルート追加 |
| `src/services/liffService.ts` | `contact` エントリータイプ追加 |
| `src/services/aiService.ts` | 愚痴AIタグのみ対応 |
| `src/services/researchOpsService.ts` | Raw Data CSV エクスポート実装 |
| `src/services/csvService.ts` | `projectRawDataCsv` 追加 |
| `src/controllers/adminController.ts` | `exportProjectRawData` 追加 |
| `src/routes/adminRoutes.ts` | Raw Data CSV ルート追加 |
| `src/repositories/sessionRepository.ts` | `updateProfileSnapshot` 追加 |
| `src/prompts/researchPrompts.ts` | AIカウンセラープロンプト改善 |
| `src/types/domain.ts` | `Session.profile_snapshot_json`, `LiffEntrypoint.entry_type` に `contact` 追加 |

### 未追跡ファイル（新規作成）
| ファイル | 内容 |
|---------|------|
| `scripts/seedDiaryDummyData.mjs` | 日記ダミーデータ投入スクリプト |
| `supabase/migrations/028_grant_diary_rant_tables.sql` | diary/rant テーブルへの service_role 権限付与 |
| `supabase/migrations/029_session_profile_snapshot.sql` | `sessions` に `profile_snapshot_json` カラム追加 |
| `supabase/migrations/030_menu_action_text_and_contact.sql` | メニューアクション更新、`contact` エントリー追加 |

---

## 7. DB / SQL 設計メモ

### Migration 028
`service_role` に対して以下のテーブルへの権限付与:
- `emotion_tag_master`
- `one_line_prompt_master`
- `diary_topic_master`
- `feature_flags`
- `ai_usage_logs`
- `rant_tags`
- `rant_post_tags`

### Migration 029
```sql
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS profile_snapshot_json jsonb;
```

### Migration 030
1. `line_menu_actions` の `participate_research` アクションにエイリアス追加
2. `liff_entrypoints.entry_type` CHECK制約に `'contact'` を追加
3. `liff_entrypoints` に `contact` エントリーを UPSERT
4. `line_menu_actions` に `contact` アクションを UPSERT

---

## 8. 今後再開する場合の注意点

### LIFF / LINE 認証
- LIFF認証とPCブラウザ認証の違いに注意
- `liff.line.me` 経由で開く導線を基本にする
- ngrok URL 直打ちでは LINE 認証が成立しない可能性がある
- `.env` / LIFF ID / LINE Channel ID の整合性を確認する

### Migration の適用
- `029_session_profile_snapshot.sql` を **本番DBに適用**してから `sessions.profile_snapshot_json` を使うコードを有効化
- `028_grant_diary_rant_tables.sql` は権限追加のみなので安全
- `030_menu_action_text_and_contact.sql` は UPSERT 設計のため再実行可能

### プロフィール確認画面の動作
- `session.profile_snapshot_json` が `null` かつ `userProfile` がある場合のみ確認画面を表示
- 確認画面を経由せずに開始した場合（`profile_snapshot_json` がすでに設定済み）はスキップ
- スナップショット保存APIが失敗してもアンケートは続行（ブロッカーにしない設計）

### Raw Data CSV
- `sessions.profile_snapshot_json` が null の場合、全プロフィール列が null になる
- アンケート開始前にプロフィール確認画面を経由したセッションのみ属性データあり

### 今日の気持ち月次統計
- タグコード（英語）を使って positive/tired/normal を分類
- `POSITIVE_TAGS = ["happy", "fun", "motivated", "proud"]`
- `TIRED_TAGS = ["tired", "anxious", "irritated", "sad"]`
- その他のタグは `normal` にカウント
