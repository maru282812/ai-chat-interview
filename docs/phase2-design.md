# Phase 2 設計書：リサーチプラットフォーム強化

作成日：2026-05-20  
前提：既存のインタビュー・アンケート機能を一切破壊しない

---

## 0. 現状確認（保護対象）

以下は Phase 2 で **変更禁止・保護対象** の機能：

| 機能 | 場所 | 理由 |
|------|------|------|
| LIFF Survey フロー | `/liff/survey` | 本番稼働中のコア機能 |
| LINE Webhook処理 | `/webhooks/line` | 会話フロー全体 |
| AI Probing ロジック | `aiService.ts` | チューニング済み |
| Question Flow V2 | `questionFlowServiceV2.ts` | 分岐・スクリーニング完成 |
| Point/Rank計算 | `pointService.ts`, `rankService.ts` | 本番運用中 |
| 全既存DBテーブル | supabase/ | カラム追加はOK、削除NG |
| 管理画面既存メニュー | `/admin/*` | 追加はOK、削除・変更NG |

---

## 1. DB設計変更案

### 1-1 追加テーブル

#### `attribute_definitions` — 属性定義マスタ

```sql
CREATE TABLE attribute_definitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  attr_key      TEXT UNIQUE NOT NULL,          -- 'hobby', 'sns_usage', etc.
  label         TEXT NOT NULL,                 -- 表示名
  category      TEXT NOT NULL,                 -- 'basic' | 'lifestyle' | 'interest' | 'ai_inferred'
  data_type     TEXT NOT NULL DEFAULT 'text',  -- 'text' | 'boolean' | 'number' | 'json' | 'tags'
  is_user_editable   BOOLEAN DEFAULT true,
  is_admin_only      BOOLEAN DEFAULT false,
  is_company_visible BOOLEAN DEFAULT false,    -- 企業への匿名統計開示可否
  sort_order    INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

#### `user_attributes` — 柔軟属性ストア（固定カラム地獄の回避）

```sql
CREATE TABLE user_attributes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id    TEXT NOT NULL REFERENCES user_profiles(line_user_id) ON DELETE CASCADE,
  attr_key        TEXT NOT NULL REFERENCES attribute_definitions(attr_key),
  value_text      TEXT,
  value_json      JSONB,
  value_number    NUMERIC,
  source          TEXT DEFAULT 'user',         -- 'user' | 'admin' | 'ai_inferred'
  confidence      NUMERIC(3,2),                -- AI推定時の確信度
  is_private      BOOLEAN DEFAULT false,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now(),
  UNIQUE (line_user_id, attr_key)
);
```

#### `user_attribute_history` — 属性変化の履歴

```sql
CREATE TABLE user_attribute_history (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id    TEXT NOT NULL,
  attr_key        TEXT NOT NULL,
  old_value_text  TEXT,
  old_value_json  JSONB,
  new_value_text  TEXT,
  new_value_json  JSONB,
  source          TEXT,
  changed_at      TIMESTAMPTZ DEFAULT now()
);
```

#### `behavior_logs` — 行動履歴

```sql
CREATE TABLE behavior_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id    TEXT NOT NULL,
  event_type      TEXT NOT NULL,  -- 'liff_open' | 'survey_start' | 'survey_complete' | 'rant_post' | 'diary_post' | 'mypage_view'
  source          TEXT,           -- 'liff' | 'line' | 'webhook'
  metadata        JSONB,
  created_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX behavior_logs_user_idx ON behavior_logs(line_user_id, created_at DESC);
```

#### `segments` — セグメント定義

```sql
CREATE TABLE segments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  description     TEXT,
  conditions      JSONB NOT NULL,  -- 後述の条件スキーマ
  estimated_count INTEGER,
  last_evaluated_at TIMESTAMPTZ,
  created_by      TEXT,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);
```

#### `delivery_campaigns` — セグメント配信キャンペーン

```sql
CREATE TABLE delivery_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      UUID NOT NULL REFERENCES projects(id),
  segment_id      UUID REFERENCES segments(id),
  name            TEXT NOT NULL,
  status          TEXT DEFAULT 'draft',  -- 'draft' | 'scheduled' | 'sent' | 'cancelled'
  delivery_channel TEXT DEFAULT 'liff',
  scheduled_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  sent_count      INTEGER DEFAULT 0,
  opened_count    INTEGER DEFAULT 0,
  started_count   INTEGER DEFAULT 0,
  completed_count INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now()
);
```

#### `user_consent` — 同意管理

```sql
CREATE TABLE user_consent (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_user_id    TEXT NOT NULL,
  consent_type    TEXT NOT NULL,  -- 'terms' | 'privacy' | 'ai_analysis' | 'company_data_share' | 'ai_learning'
  consented       BOOLEAN NOT NULL,
  version         TEXT,
  consented_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (line_user_id, consent_type)
);
```

### 1-2 既存テーブル拡張（カラム追加のみ）

#### `user_profiles` 拡張

```sql
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS
  nickname          TEXT,
  family_structure  TEXT,          -- '独身' | '既婚子なし' | '既婚子あり'
  household_count   INTEGER,
  profile_completed BOOLEAN DEFAULT false,
  profile_completed_at TIMESTAMPTZ,
  ai_persona_summary TEXT,        -- AI生成の人物像サマリー
  ai_tags           TEXT[],        -- AI生成タグ配列
  quality_score     NUMERIC(5,2) DEFAULT 100,
  ai_eval_score     NUMERIC(5,2),
  is_blocked        BOOLEAN DEFAULT false,
  is_notification_stopped BOOLEAN DEFAULT false,
  fraud_flag        BOOLEAN DEFAULT false,
  last_login_at     TIMESTAMPTZ,
  notification_ok   BOOLEAN DEFAULT true,
  visibility_settings JSONB DEFAULT '{}';
```

#### `respondents` 拡張

```sql
ALTER TABLE respondents ADD COLUMN IF NOT EXISTS
  answer_quality_score NUMERIC(5,2);
```

### 1-3 インデックス追加

```sql
CREATE INDEX IF NOT EXISTS user_attributes_key_idx ON user_attributes(attr_key);
CREATE INDEX IF NOT EXISTS user_attributes_source_idx ON user_attributes(source);
CREATE INDEX IF NOT EXISTS behavior_logs_type_idx ON behavior_logs(event_type, created_at DESC);
```

### 1-4 初期データ（属性定義マスタ）

```sql
INSERT INTO attribute_definitions (attr_key, label, category, data_type, is_company_visible) VALUES
  -- ライフスタイル
  ('hobby',           '趣味',           'lifestyle', 'tags',    false),
  ('interest_category','興味カテゴリ',   'lifestyle', 'tags',    true),
  ('used_services',   '利用サービス',    'lifestyle', 'tags',    true),
  ('purchase_tendency','購買傾向',       'lifestyle', 'text',    true),
  ('sns_usage',       'SNS利用',        'lifestyle', 'tags',    true),
  ('gaming_frequency','ゲーム頻度',     'lifestyle', 'text',    true),
  ('beauty_interest', '美容関心',       'lifestyle', 'text',    true),
  ('food_lifestyle',  '食生活',         'lifestyle', 'text',    true),
  ('values',          '価値観',         'lifestyle', 'tags',    false),
  ('future_anxiety',  '将来不安',       'lifestyle', 'tags',    false),
  ('favorite_category','推しカテゴリ',  'lifestyle', 'tags',    false),
  ('spending_tendency','消費傾向',      'lifestyle', 'text',    true),
  -- AI推定（管理側のみ）
  ('ai_personality_type', 'AI推定性格タイプ', 'ai_inferred', 'text', false),
  ('ai_stress_tendency',  'AI推定ストレス傾向','ai_inferred','text', false),
  ('ai_purchase_signal',  'AI購買シグナル',   'ai_inferred','tags', true)
ON CONFLICT (attr_key) DO NOTHING;
```

---

## 2. マイページ強化

### 2-1 初回登録導線

**現状:** LIFF起動→即利用可能  
**変更後:** LIFF起動→プロフィール未入力チェック→必須入力画面→利用開始

```
友達追加
  ↓
LINE Welcome メッセージ（既存処理はそのまま）
  ↓
「まずはプロフィール設定」ボタン → LIFF Mypage起動
  ↓
必須項目入力フォーム（ニックネーム/性別/生年月日/都道府県/職業）
  ↓
user_profiles.profile_completed = true
  ↓
利用開始（アンケート・案件への参加解放）
```

**制約確認:**
- 既存の `user_profiles` テーブルにカラム追加のみ
- `profile_completed` フラグを追加して判定
- アンケート開始時（`/liff/survey`）に未完了チェックを追加
  → 未完了の場合はマイページにリダイレクト

### 2-2 マイページUI構成（ダッシュボード型）

```
┌──────────────────────────────────┐
│ [アバター] ニックネーム            │
│ ランクバッジ 🥉Bronze             │
│ ポイント: 1,250pt  [明細→]       │
├──────────────────────────────────┤
│ 回答数: 12件 | 継続: 5日          │
│ ████████░░ 性格タイプ: 共感型      │
├──────────────────────────────────┤
│ おすすめ案件                       │
│ ・[案件名] 100pt [参加→]          │
├──────────────────────────────────┤
│ 最近の活動                         │
│ ・5/20 日記を投稿                  │
│ ・5/18 アンケート完了 +50pt        │
├──────────────────────────────────┤
│ [プロフィール編集] [回答履歴]       │
└──────────────────────────────────┘
```

### 2-3 プロフィール項目区分

| 区分 | 項目 | 編集権限 | 開示設定 |
|------|------|---------|---------|
| A 必須 | ニックネーム/性別/生年月日/都道府県/職業/業種/婚姻/子供/同居/通知可否 | ユーザー可 | 非公開 |
| B 運営管理 | LINE ID/ランク/ポイント/利用開始日/最終回答日/ブロック/不正フラグ/品質スコア | 運営のみ | 非公開 |
| C 拡張属性 | `user_attributes` テーブル全項目 | 一部ユーザー可 | 属性定義に従う |

---

## 3. 属性管理設計

### 3-1 属性タグ管理

**自動付与ルール（AIによるタグ生成）:**

```
トリガー: 愚痴/日記投稿後・アンケート完了後
処理:
  1. 過去N件のpost_analysis.tagsを集計
  2. AIに「この人の特徴タグを3〜5個生成して」と送信
  3. user_attributes に source='ai_inferred' で保存
  4. user_profiles.ai_tags[] を更新
```

**属性更新ルール:**

```
明示入力: source='user', confidence=1.0
管理更新: source='admin', confidence=1.0
AI推定:   source='ai_inferred', confidence=(AIの出力値)
```

### 3-2 属性履歴

`user_attribute_history` テーブルへのトリガー関数：

```sql
CREATE OR REPLACE FUNCTION log_attribute_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.value_text IS DISTINCT FROM NEW.value_text
     OR OLD.value_json IS DISTINCT FROM NEW.value_json THEN
    INSERT INTO user_attribute_history(
      line_user_id, attr_key,
      old_value_text, old_value_json,
      new_value_text, new_value_json,
      source
    ) VALUES (
      OLD.line_user_id, OLD.attr_key,
      OLD.value_text, OLD.value_json,
      NEW.value_text, NEW.value_json,
      NEW.source
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER user_attributes_history_trigger
  BEFORE UPDATE ON user_attributes
  FOR EACH ROW EXECUTE FUNCTION log_attribute_change();
```

---

## 4. セグメント配信設計

### 4-1 条件スキーマ（`segments.conditions` JSONB）

```json
{
  "operator": "AND",
  "conditions": [
    { "field": "age_min",       "op": "gte", "value": 20 },
    { "field": "age_max",       "op": "lte", "value": 39 },
    { "field": "gender",        "op": "in",  "value": ["female"] },
    { "field": "prefecture",    "op": "in",  "value": ["東京都","神奈川県"] },
    { "field": "rank_code",     "op": "in",  "value": ["silver","gold","platinum"] },
    { "field": "total_points",  "op": "gte", "value": 100 },
    { "field": "attr_key",      "value": "beauty_interest", "op": "eq", "attr_value": "高" },
    { "field": "personality_segment", "op": "contains", "value": "共感型" },
    { "field": "answer_rate_min", "op": "gte", "value": 0.7 },
    { "field": "last_active_days", "op": "lte", "value": 30 }
  ]
}
```

### 4-2 セグメント評価クエリ（概略）

```typescript
// segmentService.ts (新規作成)
async function evaluateSegment(segmentId: string): Promise<string[]> {
  const segment = await db.segments.findById(segmentId);
  const conditions = segment.conditions;
  
  // user_profiles + respondents + user_attributes のJOINクエリを動的構築
  // 結果: line_user_id[] を返す
  
  await db.segments.update(segmentId, {
    estimated_count: result.length,
    last_evaluated_at: new Date()
  });
  
  return result;
}
```

### 4-3 管理画面：セグメント配信フロー

```
セグメント作成 → 条件設定 → 対象人数プレビュー
  ↓
プロジェクト選択 → 配信キャンペーン作成
  ↓
delivery_campaigns に記録
  ↓
既存の project_assignments 生成ロジックを流用
（assignmentService.ts の createBatchAssignments を活用）
  ↓
配信履歴・開封率・回答率をキャンペーンごとに集計
```

---

## 5. ポイント表示設計

### 5-1 ユーザー向けマイページ表示

| 表示項目 | データソース |
|---------|------------|
| 現在ポイント | `respondents.total_points` |
| 獲得履歴 | `point_transactions WHERE type IN ('project_completion',...)` |
| 利用履歴 | `point_transactions WHERE type IN ('redemption',...)` |
| 失効予定 | 将来的に expiry カラム追加（今回はN/A表示） |
| ランク | `respondents.current_rank_id → ranks` |
| 次ランク条件 | `ranks WHERE min_points > current ORDER BY min_points LIMIT 1` |

### 5-2 管理側操作（既存の拡張）

既存の `/admin/respondents/:id/points` を拡張：
- 手動付与・減算：**現状実装済み**
- 不正調整理由の必須化（reason フィールドを必須に）
- 付与ログ：`point_transactions` テーブルで**現状実装済み**
- キャンペーン付与：`delivery_campaigns` 完了時の自動付与ルール追加

---

## 6. 回答履歴設計

### 6-1 ユーザー向け表示

**データソース:** `project_assignments JOIN projects JOIN sessions JOIN point_transactions`

```
回答済案件一覧
┌─────────────────────────────────┐
│ [案件名]              2026/05/18 │
│ ステータス: 完了 ✓              │
│ 獲得: +100pt                    │
│ [AI分析結果を見る →]           │
└─────────────────────────────────┘
```

**AI分析結果（ユーザー開示範囲）:**
- `ai_analysis_results.summary` の一部（個人特定なしの要約）
- センシティブ情報・他回答者比較は非表示

### 6-2 管理側機能

**既存実装の活用:**
- 回答履歴一覧: `/admin/respondents/:id` で**現状実装済み**

**追加機能:**
- 回答速度（`sessions.created_at` vs 各 `answers.created_at`）
- AI要約（`ai_analysis_results.summary`）
- 品質判定（`respondents.answer_quality_score`）
- NG判定・不正検知フラグ（`respondents.fraud_flag`）

---

## 7. 愚痴（Rant）強化

### 7-1 データ分類強化

**現状:** `user_posts.type = 'rant'`, `post_analysis` テーブル（sentiment, tags, keywords あり）  
**追加項目（`post_analysis` のJSONB活用）:**

```typescript
interface RantAnalysisExtension {
  rant_category: string;      // '仕事' | '人間関係' | '健康' | '消費' | 'その他'
  product_category?: string;  // '食品' | '家電' | '美容' | etc.
  severity: 1 | 2 | 3;       // 深刻度
  danger_flag: boolean;       // 危険ワード検出（自傷・犯罪等）
  top_phrases: string[];      // 頻出フレーズ
}
```

### 7-2 閲覧方針（重要：プライバシー）

| 閲覧対象 | 方針 | 実装 |
|---------|------|------|
| 全文（運営） | **原則しない** | 管理画面に全文表示しない |
| AI要約 | 基本閲覧対象 | `post_analysis.summary` を表示 |
| 危険ワード | 必要時のみ確認 | `danger_flag=true` の件数のみ表示、個別確認は申請制 |
| 統計 | 主用途 | カテゴリ別件数・感情推移グラフ |
| 企業提供 | **匿名統計のみ** | 個人特定不可能な集計データのみ |

**管理画面での実装:**
```
愚痴分析ダッシュボード
├── カテゴリ別件数（棒グラフ）
├── 感情推移（週次折れ線グラフ）
├── 深刻度分布（円グラフ）
├── 頻出ワードクラウド
├── 危険ワード件数（件数のみ。個別内容は非表示）
└── ※個別全文の閲覧ボタンなし
```

---

## 8. 日記（Diary）強化

### 8-1 継続データの価値化

**現状:** `user_posts.type = 'diary'`, 基本的なpost_analysisあり  
**追加処理:**

```typescript
interface DiaryAnalysisExtension {
  mood_score: number;        // -5〜+5 感情スコア
  topic_categories: string[]; // ['健康', '消費', '仕事', '趣味']
  behavior_signals: string[]; // ['節約志向', '運動増加', '睡眠悪化']
}
```

**継続率計算:**
- `behavior_logs` で diary投稿イベントを記録
- 週次・月次での投稿継続率を集計

### 8-2 運営側活用方針

- **全文閲覧前提にしない**
- AI集約→統計化→傾向化が主用途
- 感情変化トレンド（ユーザー全体の気分推移）を運営ダッシュボードに表示
- 個別ユーザーの感情推移は**管理者専用**の respondent detail画面に限定

---

## 9. 性格分析（Personality）強化

### 9-1 既存実装の活用

**現状:** `user_personality_profiles` テーブル・`personalityService.ts`・`/liff/personality` ビュー・`/admin/respondents/:id` にプロフィール表示あり

**既存スキーマの確認が必要な項目:**
- `traits` JSONB: どの軸で保持しているか
- `segments` TEXT: どんな値が入るか

### 9-2 ユーザー向け表示強化

```
性格分析ページ（/liff/personality）
┌──────────────────────────────────┐
│ あなたのタイプ: 共感型 🤝         │
│                                  │
│ 思考傾向: 感情重視 ████████░░    │
│ コミュニケーション: オープン型     │
│ 消費傾向: 体験優先                │
│ ストレス: 人間関係に敏感           │
│                                  │
│ 向いている案件タイプ:             │
│ ・生活体験系 ・感情フィードバック系 │
└──────────────────────────────────┘
```

### 9-3 管理側機能

**分布分析:**
- 全ユーザーの性格タイプ分布（円グラフ）
- プロジェクト参加者の性格傾向比較
- 性格タイプ×回答品質の相関

### 9-4 企業向け提供（匿名統計のみ）

```
「このプロジェクト回答者の特徴」
├── 主要タイプ: 共感型 42% / 分析型 28% / 直感型 30%
├── 消費傾向: 体験優先が多い傾向
├── ストレス源: 時間・コスト・品質の三項目が高頻度
└── ※個人の回答内容・氏名等は一切含まない
```

---

## 10. 管理画面変更案

### 10-1 サイドメニュー構成（既存＋追加）

```
現状                          追加・変更
─────────────────────         ──────────────────────
ダッシュボード                 ダッシュボード（強化）
プロジェクト管理               プロジェクト管理（変更なし）
回答者管理                     回答者管理（詳細強化）
投稿管理                       投稿管理（変更なし）
ポイント・ランク               ポイント・ランク（変更なし）
─────────────────────         ──────────────────────
                               【NEW】属性管理
                               【NEW】セグメント配信
                               【NEW】AI分析
                               【NEW】データ管理
```

### 10-2 追加メニュー詳細

#### 属性管理 `/admin/attributes`
- 属性定義一覧（追加・編集・削除）
- ユーザー属性一覧（フィルタリング可）
- AI推定属性一覧（確信度・更新日でフィルタ）
- CSV エクスポート

#### セグメント配信 `/admin/segments`
- セグメント一覧・作成・編集
- 条件ビルダー UI（年齢/性別/地域/属性/ランク等）
- 対象人数プレビュー（リアルタイム or バッチ評価）
- キャンペーン一覧（配信履歴・開封率・回答率）
- 配信予約（scheduled_at 設定）

#### AI分析 `/admin/ai-analysis`
- 感情分析ダッシュボード（全体トレンド）
- 愚痴分析（カテゴリ別・頻出ワード・深刻度）
- 日記分析（感情スコア推移・行動シグナル）
- 性格分析（タイプ分布・傾向比較）
- トレンド分析（週次・月次集計グラフ）

#### データ管理 `/admin/data`
- AIタグ管理（生成済みタグ一覧・削除）
- NGワード管理（追加・削除・カテゴリ分類）
- カテゴリ管理（愚痴/日記カテゴリ定義）
- 属性定義管理（`attribute_definitions` の CRUD）

### 10-3 既存画面の拡張

**ダッシュボード強化:**
- 追加KPI: 今週の愚痴投稿数、日記継続率、AI分析完了数
- 感情トレンド週次グラフ（ミニ版）

**回答者詳細強化:**
- タブ追加:「属性情報」「性格分析」「行動履歴」
- 既存タブ（参加履歴・会話ログ）はそのまま保持

---

## 11. ユーザー導線整理

### 11-1 初回導線（新規ユーザー）

```
LINE友達追加
    ↓
Webhookで respondents レコード作成（既存処理）
    ↓
ウェルカムメッセージ送信（既存処理）
    ↓ ＋追加
「プロフィール設定へ →」ボタン付きメッセージ
    ↓
/liff/mypage?mode=initial_setup
    ↓
必須5項目入力（ニックネーム/性別/生年月日/都道府県/職業）
    ↓
user_profiles.profile_completed = true, profile_completed_at = now()
    ↓
「設定完了！案件に参加しましょう」→ 案件一覧へ
```

### 11-2 参加制限ロジック

`/liff/survey` 起動時に以下チェックを追加：

```typescript
// liffController.ts の survey ルートに追加
const profile = await userProfileRepo.findByLineUserId(lineUserId);
if (!profile?.profile_completed) {
  return res.redirect(`${LIFF_MYPAGE_URL}?mode=initial_setup&redirect=survey`);
}
```

### 11-3 通常利用フロー

```
LINEリッチメニュー
├── 参加調査 → 案件一覧 → survey（profile_completedチェック）
├── 本音・悩み → /liff/rant
├── 今日の気持ち → /liff/diary
├── マイページ → /liff/mypage（強化後ダッシュボード）
└── 性格診断 → /liff/personality（強化後）
```

---

## 12. プライバシー方針整理

### 12-1 データ公開範囲マトリクス

| データ種別 | ユーザー自身 | 運営 | 企業 | AI解析 |
|----------|------------|------|------|--------|
| 基本プロフィール | 閲覧・編集可 | 閲覧可 | **不可** | 属性抽出のみ |
| 回答内容 | 要約のみ | 閲覧可 | 匿名集計のみ | 可 |
| 愚痴全文 | 自分のみ | **原則不可** | **不可** | 要約・タグのみ |
| 日記全文 | 自分のみ | **原則不可** | **不可** | 要約・感情のみ |
| 性格分析 | 閲覧可 | 閲覧可 | 匿名統計のみ | 可 |
| 行動履歴 | 一部閲覧可 | 閲覧可 | **不可** | 可 |
| ポイント残高 | 閲覧可 | 閲覧可 | **不可** | 不要 |

### 12-2 同意管理（`user_consent` テーブル）

| 同意種別 | タイミング | デフォルト |
|---------|-----------|-----------|
| `terms` | 初回登録時 | 必須 |
| `privacy` | 初回登録時 | 必須 |
| `ai_analysis` | 初回登録時 | opt-out可 |
| `company_data_share` | 初回登録時 | opt-out可 |
| `ai_learning` | 初回登録時 | opt-out可（将来対応） |

### 12-3 個人特定防止措置

- 企業提供データは**必ずN≥10以上の集計**のみ
- 自由記述は企業に提供しない（AI要約のみ）
- LINE User IDは企業に非開示（内部ID使用）
- 愚痴・日記の個別レコードは企業非開示

### 12-4 危険ワード対応フロー

```
危険ワード検出（AI分析時）
  ↓
post_analysis.danger_flag = true
  ↓
管理画面に件数のみ通知（内容は非表示）
  ↓
運営担当者が「対応要否確認」→ 必要な場合のみ内容確認（ログ記録）
```

---

## 13. AI分析活用方針

### 13-1 分析パイプライン

```
ユーザーアクション
(回答/愚痴/日記)
      ↓
既存: post_analysis 生成（sentimentの, tags, keywords）
      ↓
【追加】拡張分析（rant_category, mood_score, behavior_signals）
      ↓
【追加】ユーザー属性更新（ai_inferred タグ生成）
      ↓
【追加】user_profiles.ai_persona_summary 更新（週次バッチ）
      ↓
【追加】セグメント再評価（属性変更トリガー）
```

### 13-2 AI生成タグ生成ロジック

```typescript
// 週次バッチ or 投稿N件ごとにトリガー
async function generateAiTagsForUser(lineUserId: string) {
  const recentPosts = await postRepo.findRecentByUser(lineUserId, 20);
  const analyses = await postAnalysisRepo.findByPostIds(recentPosts.map(p => p.id));
  
  const prompt = buildPersonaTagPrompt(analyses); // 既存の AI呼び出しパターン流用
  const tags = await aiService.generateTags(prompt);
  
  // user_attributes に source='ai_inferred' で保存
  for (const tag of tags) {
    await userAttributeRepo.upsert({ line_user_id: lineUserId, attr_key: 'ai_tag_'+tag.category, value_text: tag.value, source: 'ai_inferred', confidence: tag.confidence });
  }
  
  await userProfileRepo.update(lineUserId, { ai_tags: tags.map(t => t.value) });
}
```

### 13-3 企業向けレポート値

- 性格タイプ分布（匿名）
- 消費傾向分類（匿名集計）
- 主要な不満カテゴリ（匿名集計）
- ライフスタイルスコア（匿名平均）
- 「このプロジェクトの回答者像」サマリー（AI生成・個人特定なし）

---

## 14. 実装優先度・ロードマップ

### フェーズ2-A（最優先・基盤）

1. DB migration: `user_profiles` 拡張カラム追加
2. DB migration: `attribute_definitions`, `user_attributes`, `user_attribute_history` 作成
3. DB migration: `behavior_logs`, `user_consent` 作成
4. マイページ: 初回プロフィール入力フォーム
5. マイページ: ダッシュボード型UIリニューアル
6. `/liff/survey`: `profile_completed` チェック追加

### フェーズ2-B（コア機能）

7. DB migration: `segments`, `delivery_campaigns` 作成
8. 管理画面: セグメント作成・条件ビルダー
9. 管理画面: AI分析ダッシュボード
10. 管理画面: 属性管理画面
11. 回答履歴: ユーザー向け表示
12. ポイント明細: ユーザー向け詳細表示

### フェーズ2-C（AI強化）

13. 愚痴分析: 拡張分析（カテゴリ・深刻度・危険ワード）
14. 日記分析: 感情スコア・行動シグナル
15. AI タグ自動生成バッチ
16. 性格分析UI強化
17. 企業向けレポート生成

### フェーズ2-D（運用最適化）

18. セグメント配信の自動スケジュール
19. 同意管理UI（マイページ内）
20. 管理画面: NGワード・カテゴリ管理
21. キャンペーン開封率・回答率トラッキング

---

## 15. 保護チェックリスト（実装時確認事項）

各機能実装時に以下を必ず確認：

- [ ] `user_posts`, `post_analysis` テーブルの既存カラムを削除・変更していないか
- [ ] `projects`, `questions`, `answers`, `sessions` テーブルを変更していないか
- [ ] `/liff/survey` のルート・コントローラーロジックを破壊していないか
- [ ] `questionFlowServiceV2.ts` のロジックに触れていないか
- [ ] `aiService.ts` の既存メソッドシグネチャを変更していないか
- [ ] 既存の管理画面メニュー・ルートが動作するか
- [ ] LINE Webhook処理（`/webhooks/line`）が正常動作するか
- [ ] Point・Rank計算ロジックが変わっていないか
