# パートナーAPI（/api/partner/*）

会員ポータル **hibi-portal**（アンケでYOTTO 顧客ポータル）が、ai-chat-interview の
店舗専用アンケートを作成・公開・集計・締切するための API。

実装:
- ルータ … `src/routes/partnerRoutes.ts`（`src/app.ts` で `/api/partner` にマウント）
- 認証 … `src/middleware/partnerAuth.ts`
- ユースケース … `src/services/partnerSurveyService.ts`
- 純関数 … `src/lib/partnerDemographics.ts` / `src/lib/partnerQuestions.ts` / `src/lib/partnerPackages.ts`
- migration … `supabase/migrations/089_partner_api_store_scope.sql`

---

## 1. 認証

全エンドポイントで以下の2ヘッダが必須。

| ヘッダ | 必須 | 内容 |
|---|---|---|
| `X-Partner-Key` | ○ | 環境変数 `PARTNER_API_KEY` と一致する固定キー |
| `X-Partner-Store-Id` | ○ | ポータル側 `stores.id`。**所有者スコープのキー** |

- キーの比較は `crypto.timingSafeEqual`（SHA-256 ダイジェスト同士の定数時間比較。長さも漏らさない）。
- `PARTNER_API_KEY` が未設定の場合、全エンドポイントが **503** を返す（起動は妨げない）。
- `X-Partner-Store-Id` は `^[A-Za-z0-9_-]{1,64}$`。形式違反は **400**。
- **キーはサーバー側からのみ使うこと**（ブラウザに出さない）。

### 所有者スコープ

`POST /api/partner/surveys` で作成したアンケートには `projects.partner_store_id` に
`X-Partner-Store-Id` の値が記録される。`:id` を取る全エンドポイントは
**`partner_store_id` の一致を必ず検証**する。

- 他店舗のアンケート ID を指定 → **404**（403 ではない。存在を漏らさないため）
- 存在しない ID / UUID でない ID → **404**

---

## 2. エラー形式

既存 API と同じ `{ "error": "..." }`。

```json
{ "error": "survey not found" }
```

| ステータス | 意味 | 例 |
|---|---|---|
| 400 | リクエスト不正（zod 検証失敗・ヘッダ形式不正） | `"questions.0.answer_options: question_type=single_choice requires at least 2 answer_options"` |
| 401 | `X-Partner-Key` 不一致・未提示 | `"unauthorized"` |
| 404 | 対象なし or 他店舗のもの | `"survey not found"` |
| 409 | 状態的に不許可 | `"closed survey cannot be updated"` |
| 500 | サーバー内部エラー | |
| 503 | `PARTNER_API_KEY` 未設定 | `"partner API is not configured"` |

400 のメッセージは `<フィールドパス>: <理由>` 形式（先頭の1件のみ）。

---

## 3. 設問タイプ（4種）

ポータルが扱えるのは以下の4つだけ。文字列値は**完全一致**で送ること。

| `question_type` | 意味 | `answer_options` | 内部保存 |
|---|---|---|---|
| `"single_choice"` | 単一選択 | 必須（2件以上） | `question_type='single_choice'` |
| `"multi_choice"` | 複数選択 | 必須（2件以上） | `question_type='multi_choice'` |
| `"free_text"` | 自由記述 | **禁止**（`null` か省略） | `question_type='free_text_long'` |
| `"scale"` | スケール（段階評価） | 必須（2件以上） | `question_type='single_choice'` ＋ `question_config.presentation.scale=true` |

`answer_options` の要素:

```jsonc
{
  "value": "5",              // 必須・1〜200文字・同一設問内で一意
  "label": "とても満足",      // 必須・1〜500文字
  "allow_free_text": false,  // 任意。「その他」で自由記述欄を出す
  "exclusive": false         // 任意。選ぶと他の選択肢を全解除する
}
```

制約: 設問は 1〜50 件、`question_text` は 1〜2000 文字、`sort_order` は 0〜1000 の整数。
`sort_order` の重複・欠番は許容（昇順に並べ直してサーバーが採番する）。

---

## 3.5 設問文の画像（`question_text_image`）

**設問タイプは上の4種のまま増えない。`text_with_image` のような専用タイプは存在しない。
代わりに、4種すべての設問に画像を添えられる**（「画像付きの単一選択」も作れる）。

### リクエスト（`POST /surveys` / `PUT /surveys/:id` の各設問に付ける）

```jsonc
{
  "question_text": "この写真の料理について、満足度を教えてください。",
  "question_type": "single_choice",
  "answer_options": [
    { "value": "5", "label": "とても満足" },
    { "value": "1", "label": "とても不満" }
  ],
  "sort_order": 1,
  "question_text_image": {
    "main_url": "https://portal.example.com/api/public/question-images/0f2b...-uuid",
    "additional_urls": [
      "https://portal.example.com/api/public/question-images/1a3c...-uuid"
    ],
    "caption": "7月の新メニュー"
  }
}
```

| フィールド | 型 | 制約 |
|---|---|---|
| `main_url` | `string \| null` | URL 形式・最大 2000 文字。**許可ホストの `https:` のみ**（下記） |
| `additional_urls` | `string[]` | **最大 4 件**。既定 `[]`。各要素は `main_url` と同じ制約 |
| `caption` | `string \| null` | 最大 200 文字 |

- `question_text_image` 自体が **任意**（省略・`null` いずれも可）。**後方互換**のため、
  このフィールドを一切送らない従来のリクエストはこれまでと完全に同じ挙動になる。
- `caption` だけ（画像URLなし）でも送れる。
- 内部では `question_config.question_text_image`（camelCase: `mainUrl` / `additionalUrls` / `caption`）
  に保存される。回答画面（LIFF）は既にこの形を描画する。
- **性年代の固定2問には画像を付けられない**（サーバーが毎回再構築するため、
  リクエストに何を書いても反映されない）。

### レスポンス

`SurveyView` の各設問に `question_text_image` が **必ず含まれる**（画像が無ければ `null`）。
形はリクエストと同じ snake_case。

```jsonc
{
  "question_code": "pq1",
  "question_text": "この写真の料理について、満足度を教えてください。",
  "question_type": "single_choice",
  "answer_options": [ … ],
  "sort_order": 10,
  "is_required": true,
  "is_fixed": false,
  "question_text_image": {
    "main_url": "https://portal.example.com/api/public/question-images/0f2b...-uuid",
    "additional_urls": [],
    "caption": "7月の新メニュー"
  }
}
```

### URL のホスト制限（セキュリティ要件）

画像URLは**回答画面の `<img>` の向き先**になる。任意の外部URLを通すと、
パートナーAPIキーが漏れた場合や将来パートナーが増えた場合に
**トラッキング・回答者IPの収集・不適切画像の差し込み**に使われる。
そのため受け入れるURLのホストを許可リストに限定している。

- 環境変数 `PARTNER_IMAGE_URL_ALLOWED_HOSTS`（カンマ区切りのホスト名）に一致するホストのみ通す。
- **完全一致**。サブドメインは自動で許可しない（`portal.example.com` を許可しても
  `evil.portal.example.com` は通らない）。
- **`https:` のみ**。`http:` / `data:` / `javascript:` は通らない。
- **`PARTNER_IMAGE_URL_ALLOWED_HOSTS` が未設定なら、画像URLを含むリクエストは全て 400**
  （fail-closed。設定漏れが「何でも通る」状態にならないようにしている）。
  画像フィールドを送らない従来のリクエストは、未設定でもこれまでどおり通る。

### 400 になる条件（まとめ）

| 条件 | 例 |
|---|---|
| ホストが許可リストにない | `https://evil.example.com/a.png` |
| `https` 以外のスキーム | `http://portal.example.com/a.png` |
| `PARTNER_IMAGE_URL_ALLOWED_HOSTS` 未設定なのに画像URLを送った | 任意のURL |
| URL 形式でない | `"not a url"` / `"javascript:alert(1)"` |
| `main_url` が 2000 文字超 | |
| `additional_urls` が 5 件以上 | |
| `caption` が 200 文字超 | |

エラーメッセージは
`question_text_image: image url must be https and its host must be listed in PARTNER_IMAGE_URL_ALLOWED_HOSTS`。

### 全置換であることの注意（重要）

`PUT /surveys/:id` に `questions` を送ると、`question_config` は**毎回ゼロから組み直される**。
したがって **画像フィールドを送らなかった設問の画像は消える**（差分更新ではない）。

ポータル側は、PUT を組み立てるたびにサーバー側で画像を合成し直し、
**全設問について画像フィールドを毎回そろえて送る**こと。
クライアントから来た画像URLをそのまま流すのではなく、ポータルDBを正として組み立てる
（そうしないと、店舗の自動保存で運営が付けた画像が消える）。

---

## 4. 性年代設問（サーバー固定・パートナーは編集不可）

パートナー経由で作成したアンケートには、**作成時にサーバーが必ず2問を自動付与**する。
`PUT /surveys/:id` を何度呼んでも、毎回サーバーが正しい形へ戻すため
**消せない・変更できない**。ポータル側は「固定行」として読み取り専用で表示すること。

| `question_code` | 設問文 | `sort_order` | 選択肢 |
|---|---|---|---|
| `__partner_gender__` | あなたの性別を教えてください。 | 1 | `female`(女性) / `male`(男性) / `no_answer`(未回答) |
| `__partner_age__` | あなたの年代を教えてください。 | 2 | `under20`(20代未満) / `20s`(20代) / `30s`(30代) / `40s`(40代) / `50s`(50代) / `60s_over`(60代以上) |

- レスポンスの設問配列にはこの2問が `is_fixed: true` で含まれる。パートナー設問は `is_fixed: false`。
- パートナー設問の `question_code` は `pq1`, `pq2`, … とサーバーが採番する（リクエストでは送らない）。
- パートナー設問の `sort_order` はサーバー側で 10 以降に振り直される（性年代の 1, 2 より必ず後ろ）。

---

## 5. エンドポイント

### 5.1 `GET /api/partner/packages`

業種別パッケージ一覧（設問テンプレ・消費チケット枚数マスタ）。マスタは
`src/lib/partnerPackages.ts` がコード上の唯一の正（専用テーブルは無い）。

**レスポンス 200**

```jsonc
{
  "packages": [
    {
      "id": "restaurant_basic",
      "industry": "restaurant",
      "industry_label": "飲食店",
      "name": "飲食店 基本セット",
      "description": "満足度・再来店意向・認知経路を押さえた定番構成。…",
      "ticket_cost": 1,
      "questions": [
        {
          "question_text": "本日のご利用の総合的な満足度を教えてください。",
          "question_type": "scale",
          "answer_options": [
            { "value": "5", "label": "とても満足" },
            { "value": "4", "label": "やや満足" },
            { "value": "3", "label": "ふつう" },
            { "value": "2", "label": "やや不満" },
            { "value": "1", "label": "とても不満" }
          ],
          "sort_order": 1,
          "is_required": true
        }
      ]
    }
  ],
  "fixed_demographic_questions": {
    "gender": { "options": [ { "value": "female", "label": "女性" }, … ] },
    "age":    { "options": [ { "value": "under20", "label": "20代未満" }, … ] }
  }
}
```

現在の `id` 一覧: `restaurant_basic` / `salon_basic` / `retail_basic` / `clinic_basic` / `general_basic`。

**パッケージの `questions` は「下書きの初期値」**。サーバーは `package_id` から設問を
勝手に差し込まない。ポータルが編集した結果を `POST /surveys` の `questions` で送ること。

---

### 5.2 `POST /api/partner/surveys`

draft を作成する。

**リクエスト**

```jsonc
{
  "title": "○○食堂 お客様アンケート",
  "package_id": "restaurant_basic",     // 任意。記録用（レスポンスで返る）
  "questions": [
    {
      "question_text": "本日のご利用の満足度を教えてください。",
      "question_type": "scale",
      "answer_options": [
        { "value": "5", "label": "とても満足" },
        { "value": "1", "label": "とても不満" }
      ],
      "sort_order": 1,
      "is_required": true               // 任意。既定 true
    },
    {
      "question_text": "ご意見をお書きください。",
      "question_type": "free_text",
      "answer_options": null,
      "sort_order": 2,
      "is_required": false
    }
  ],
  "store": {
    "name": "○○食堂",                   // 必須
    "industry": "restaurant"            // 任意
  }
}
```

**レスポンス 201**（`SurveyView`。以下 5.3 / 5.4 も同じ形）

```jsonc
{
  "survey_id": "0f2b...-uuid",
  "title": "○○食堂 お客様アンケート",
  "status": "draft",                    // draft|ready|published|paused|closed|archived
  "store_id": "…X-Partner-Store-Id と同じ値…",
  "store_name": "○○食堂",
  "package_id": "restaurant_basic",
  "entry_code": "p-k3m9xz",
  "answer_url": null,                   // published のときだけ URL が入る
  "questions": [
    {
      "question_code": "__partner_gender__",
      "question_text": "あなたの性別を教えてください。",
      "question_type": "single_choice",
      "answer_options": [ { "value": "female", "label": "女性" }, … ],
      "sort_order": 1,
      "is_required": true,
      "is_fixed": true,
      "question_text_image": null       // 画像が無ければ null（3.5 参照）
    },
    { "question_code": "__partner_age__",  "…": "…", "sort_order": 2,  "is_fixed": true },
    { "question_code": "pq1", "…": "…", "sort_order": 10, "is_fixed": false },
    { "question_code": "pq2", "…": "…", "sort_order": 11, "is_fixed": false }
  ],
  "created_at": "2026-07-29T01:23:45.678Z",
  "updated_at": "2026-07-29T01:23:45.678Z"
}
```

`questions` は `sort_order` 昇順。性年代の2問が必ず先頭に入る。

---

### 5.3 `GET /api/partner/surveys/:id`

1件取得（編集画面の再読込用）。レスポンスは `SurveyView`（5.2 と同形）。

---

### 5.4 `PUT /api/partner/surveys/:id`

draft を更新する。`title` と `questions` は**どちらか一方だけでもよい**（両方省略は 400）。

**リクエスト**

```jsonc
{
  "title": "○○食堂 お客様アンケート（7月）",   // 任意
  "questions": [ /* 5.2 と同じ形。全置換 */ ]   // 任意
}
```

- `questions` を送ると**パートナー設問は全置換**される（差分更新ではない）。
- 性年代設問は毎回サーバーが再構築するので、送らなくても消えない・送っても壊せない。
- 設問数を減らした場合、余った既存設問は物理削除ではなく非表示化する（既存回答の参照を壊さないため）。
- `status` が `closed` / `archived` の場合 **409**。

**レスポンス 200** … `SurveyView`

---

### 5.5 `POST /api/partner/surveys/:id/publish`

公開して回答URLを返す。ボディ不要。**冪等**（公開済みに再度呼んでも同じURLを返す）。

**レスポンス 200**

```jsonc
{
  "survey_id": "0f2b...-uuid",
  "status": "published",
  "answer_url": "https://liff.line.me/1234567890-abcdefgh?entry_code=p-k3m9xz",
  "entry_code": "p-k3m9xz"
}
```

- `answer_url` はポータル側で QR 画像化して店舗に渡す。
- `LINE_LIFF_ID_SURVEY`（無ければ `LINE_LIFF_ID`）が設定されていれば LIFF 恒久URL、
  未設定なら `${APP_BASE_URL}/liff/store?entry_code=...`。
- `status` が `closed` / `archived` の場合 **409**。

---

### 5.6 `GET /api/partner/surveys/:id/stats`

回答件数と性年代集計。ポータル B2 のポーリング（15秒目安）で叩く想定。

**レスポンス 200**

```jsonc
{
  "survey_id": "0f2b...-uuid",
  "status": "published",
  "total_count": 42,
  "demographics": {
    "gender": { "female": 25, "male": 15, "no_answer": 2 },
    "age": { "under20": 1, "20s": 12, "30s": 14, "40s": 9, "50s": 4, "60s_over": 2 },
    "cross": [
      { "gender": "female", "age": "under20",  "count": 1 },
      { "gender": "female", "age": "20s",      "count": 8 },
      { "gender": "female", "age": "30s",      "count": 9 },
      { "gender": "female", "age": "40s",      "count": 5 },
      { "gender": "female", "age": "50s",      "count": 2 },
      { "gender": "female", "age": "60s_over", "count": 0 },
      { "gender": "male",   "age": "under20",  "count": 0 }
      // … 性別3 × 年代6 = 18 セルすべてを 0 埋めで返す
    ]
  }
}
```

集計の定義:
- `total_count` = **完了セッション数**（`sessions.status='completed'`）。URLを開いただけの流入は含めない。
- `demographics` も完了セッションのみが対象。
- `gender` / `age` / `cross` のキーは**必ず全件そろう**（0 埋め）。キー欠損の考慮は不要。
- 片方の軸だけ未回答/未知値の回答者は、判明している軸だけ数え `cross` には入れない。
  したがって **`cross` の合計 ≦ `total_count`**（一致するとは限らない）。

---

### 5.7 `POST /api/partner/surveys/:id/close`

締め切る。ボディ不要。**冪等**（締切済みに再度呼んでも 200）。

**レスポンス 200**

```jsonc
{
  "survey_id": "0f2b...-uuid",
  "status": "closed",
  "closed_at": "2026-07-29T09:00:00.000Z",
  "total_count": 42
}
```

**データセット生成のキックは行わない。** ai-chat-interview の統計エクスポート
（`statExportService` / `rawdataExport`）は管理画面から明示的にダウンロードする
**同期生成**の仕組みで、非同期のジョブキュー（生成をキックして後で取りに行く仕組み）が
存在しないため。締切後の納品物の生成は、運営が管理画面から行う運用とする。

---

## 6. 環境変数

| 変数 | 必須 | 内容 |
|---|---|---|
| `PARTNER_API_KEY` | パートナーAPIを使うなら必須 | `X-Partner-Key` と照合する固定キー。16文字以上。`openssl rand -hex 32` 推奨 |
| `PARTNER_IMAGE_URL_ALLOWED_HOSTS` | 設問文画像を使うなら必須 | 画像URLとして受け入れるホストのカンマ区切り許可リスト（例: `portal.example.com`）。**未設定だと画像URLは全て 400**（fail-closed）。3.5 参照 |
| `APP_BASE_URL` | 既存 | `answer_url` のフォールバック生成に使う |
| `LINE_LIFF_ID_SURVEY` / `LINE_LIFF_ID` | 既存・任意 | 設定されていれば `answer_url` を LIFF 恒久URLにする |

`.env.example` にも記載済み。

---

## 7. 内部表現との対応（保守メモ）

パートナーAPIは既存の「店舗専用アンケート」表現をそのまま使う。新しいテーブルは作っていない。

| パートナーAPI | 内部 |
|---|---|
| survey | `projects` 1行（`visibility_type='private_store'`, `is_discoverable=false`, `delivery_enabled=false`） |
| survey_id | `projects.id` |
| title | `projects.name` ＝ `projects.user_display_title` |
| store.name | `projects.client_name` |
| package_id | `projects.objective` に `package:<id>` の形で保存 |
| store_id（所有者） | `projects.partner_store_id`（**migration 089 で追加**） |
| entry_code / answer_url | `projects.entry_code`（`p-` プレフィックス）＋ 既存の `/liff/store` 導線 |
| 設問 | `questions` 各行 |
| question_text_image | `questions.question_config.question_text_image`（camelCase に変換して保存） |
| 回答 | `sessions` / `answers`（既存の LIFF 回答フローがそのまま書く） |

回答導線は既存の `storeEntryService`（`/liff/store?entry_code=...`）を再利用しているため、
パートナー経由アンケート専用の回答画面は無い。
