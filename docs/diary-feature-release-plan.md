# 日記・本音投稿機能 — 売上別 機能解禁ロードマップ

> このドキュメントは、日記・本音投稿機能をAIコストを抑えながら段階的に価値化するための指針です。  
> 機能の ON/OFF は `feature_flags` テーブルで管理します。変更後はサーバー再起動不要です。

---

## 前提方針

| 優先度 | 方針 |
|--------|------|
| 1 | 入力ハードルを下げる（タップ選択中心、自由記述は任意） |
| 2 | 継続率を高める（カレンダー・連続記録・グラフ） |
| 3 | データを構造化して蓄積する（感情タグ・mood_score・good/bad） |
| 4 | AIコストを抑える（feature_flags で段階解禁） |
| 5 | 売上に応じてAI機能を解禁する（段階1〜5） |

---

## Stage 1 — 売上 0〜5万円

**目的:** 低コストでデータ蓄積・継続率確認・入力データ質の検証

### 解禁済み機能（初期リリース）

- **感情タグ** — 嬉しい/楽しい/疲れた/不安 等 11種、複数選択可
- **一言選択** — 「今日は少し疲れた」等 10種、ローテーション表示
- **よかったこと / つらかったこと** — 短文任意入力
- **話題提供** — 「今日一番印象に残ったことは？」等 10種、日次ローテーション
- **カレンダー表示** — 直近35日をグリッド表示、mood_score で色分け
- **感情グラフ** — 直近7日の気分スコア棒グラフ
- **ログイン・継続記録** — 連続記録日数・累計記録数・最終記録日

### 非表示

- AIチャット（`ai_chat`）
- 音声入力（`voice_input`）
- AIフィードバック（`ai_feedback`）
- AI要約（`ai_post_summary`）
- AI感情スコア（`ai_sentiment_analysis`）

### feature_flags 状態

```sql
-- 全フラグ無効（初期値）
SELECT feature_key, is_enabled FROM feature_flags;
-- ai_post_summary       | false
-- ai_sentiment_analysis | false
-- ai_feedback           | false
-- ai_chat               | false
-- voice_input           | false
```

---

## Stage 2 — 売上 5〜15万円

**目的:** AIコストの実測・内部分析価値の検証（ユーザー画面には未表示）

### 解禁候補

- **内部AI要約** (`ai_post_summary`) — 投稿本文を自動要約し `ai_summary` に保存
- **AI感情スコア** (`ai_sentiment_analysis`) — `ai_sentiment_score` / `ai_stress_score` を推定
- **AI話題分類** — `ai_detected_topics` へ分類結果を保存
- **管理者向けAI分析結果** — 管理画面から `post_analysis` / `ai_*` カラムを確認可能

### 解禁方法

```sql
UPDATE feature_flags SET is_enabled = true WHERE feature_key = 'ai_post_summary';
UPDATE feature_flags SET is_enabled = true WHERE feature_key = 'ai_sentiment_analysis';
```

### まだ非表示

- カウンセラーAIチャット
- 音声入力
- ユーザー向けAIフィードバック

### 確認指標

- `ai_usage_logs` で 1日あたりの入力/出力トークン数と概算コストを確認
- 月間AIコストが売上の 10% 以内であることを確認してから Stage 3 へ

---

## Stage 3 — 売上 15〜30万円

**目的:** 軽量AIフィードバックでユーザー満足度向上を検証

### 解禁候補

- **投稿後AIフィードバック** (`ai_feedback`) — 投稿後1回だけ軽いコメントを表示

### 制限条件（必須）

- 1日あたり利用回数: **3回まで**
- 1回あたり入力文字数: **最大 400文字に短縮してAIへ送信**
- `feature_flags.is_enabled = true` になって初めてユーザー画面に表示
- `ai_usage_logs` へ必ず記録

### 解禁方法

```sql
UPDATE feature_flags SET is_enabled = true WHERE feature_key = 'ai_feedback';
```

### まだ非表示

- カウンセラーAIチャット
- 音声入力

---

## Stage 4 — 売上 30〜50万円

**目的:** 有料ユーザー向け差別化機能として音声入力を追加

### 解禁候補

- **音声入力** (`voice_input`) — 音声入力 → 文字起こし → AI要約 → 日記保存

### 制限条件（必須）

- **有料ユーザーのみ** 利用可（プラン管理が必要）
- 月間利用回数上限: **30回/ユーザー**
- 1回あたり音声長さ上限: **60秒**
- コスト試算後に解禁（音声 API 単価を確認すること）

### 解禁方法

```sql
UPDATE feature_flags SET is_enabled = true, min_plan = 'paid' WHERE feature_key = 'voice_input';
```

---

## Stage 5 — 売上 50万円以上

**目的:** カウンセラーAIチャットで高単価化・B2B展開へ

### 解禁候補

- **カウンセラーAIチャット** (`ai_chat`) — 会話型AIカウンセリング
- **性格分析レポート** — 累積データをもとに詳細プロファイル
- **詳細AIレポート** — 月次感情サマリー
- **B2B向け匿名集計レポート** — N>=10 の集計データを企業提供

### 制限条件（必須）

- 1日あたり会話回数: **5回まで**
- 1回あたりメッセージ文字数: **最大 300文字**
- 会話履歴は **直近5往復のみ** AIへ送信（全履歴送信禁止）
- 月間利用上限に達したら自動停止
- `ai_usage_logs` で月間コストを管理者が監視
- 管理画面から即時 OFF 可能

### 解禁方法

```sql
UPDATE feature_flags SET is_enabled = true, min_plan = 'paid' WHERE feature_key = 'ai_chat';
```

---

## AIコスト対策チェックリスト

各 Stage でAI機能を解禁する前に以下を確認すること。

- [ ] `feature_flags.is_enabled` で即停止できる構造になっているか
- [ ] ユーザーごとの1日利用回数を `ai_usage_logs` で計測しているか
- [ ] 入力文字数を制限してAIへ送る前にトリミングしているか
- [ ] チャット履歴は必要な往復分のみ送っているか（全件送信禁止）
- [ ] 管理画面で月間トークン数・概算コストを確認できるか
- [ ] 無料ユーザーにはAIチャットを開放していないか
- [ ] AIコストが月間売上の **15% を超えたら即停止** のルールがあるか

---

## feature_flags テーブル 一覧

| feature_key | Stage | 説明 |
|---|---|---|
| `ai_post_summary` | 2 | AI要約（管理者のみ確認） |
| `ai_sentiment_analysis` | 2 | AI感情スコア・ストレス推定 |
| `ai_feedback` | 3 | 投稿後1回のAIフィードバック |
| `voice_input` | 4 | 音声入力・文字起こし（有料ユーザー限定） |
| `ai_chat` | 5 | カウンセラーAIチャット（有料機能） |

```sql
-- 現在の状態確認
SELECT feature_key, is_enabled, min_plan, min_revenue_stage, description
FROM feature_flags
ORDER BY min_revenue_stage;
```

---

## ai_usage_logs — 利用量モニタリング

```sql
-- 直近7日の機能別コスト集計
SELECT
  feature_type,
  COUNT(*)                          AS calls,
  SUM(input_tokens)                 AS total_input_tokens,
  SUM(output_tokens)                AS total_output_tokens,
  SUM(estimated_cost)               AS total_cost_usd
FROM ai_usage_logs
WHERE used_at >= NOW() - INTERVAL '7 days'
GROUP BY feature_type
ORDER BY total_cost_usd DESC;

-- ユーザー別の1日利用回数（上限管理用）
SELECT user_id, COUNT(*) AS calls_today
FROM ai_usage_logs
WHERE feature_type = 'ai_feedback'
  AND used_at >= CURRENT_DATE
GROUP BY user_id
HAVING COUNT(*) >= 3
ORDER BY calls_today DESC;
```
