# パートナーAPI（/api/partner/*）

会員ポータル **hibi-portal**（アンケでYOTTO 顧客ポータル）が、ai-chat-interview の
店舗専用アンケートを作成・公開・集計・締切するための API。

実装:
- ルータ … `src/routes/partnerRoutes.ts`（`src/app.ts` で `/api/partner` にマウント）
- 認証 … `src/middleware/partnerAuth.ts`
- ユースケース … `src/services/partnerSurveyService.ts`
- 純関数 … `src/lib/partnerDemographics.ts` / `src/lib/partnerQuestions.ts`
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
| 409 | 状態的に不許可 | `"closed survey cannot be updated"` / `"version conflict"`（§5.4.1） |
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

### 5.1 `GET /api/partner/packages`（削除済み）

**このエンドポイントは削除した（2026-08-06）。** 業種別パッケージ（設問テンプレ・消費
チケット枚数・画像）のマスタは会員ポータル hibi 側の `packages` テーブルへ移管され、
ポータルは自 DB を読む。ACI 側のハードコード `src/lib/partnerPackages.ts` と hibi 側の
写しという二重管理を解消するための削除。

`package_id` は引き続き `POST /surveys` で受け付ける。ACI はこれを検証せず、記録用の
不透明な文字列として保持してレスポンスで返すだけなので、マスタの所在が変わっても
draft 作成・取得の挙動は変わらない。

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
  "updated_at": "2026-07-29T01:23:45.678Z",
  "version": "sha256:9f2c..."           // 楽観ロック用の版（5.4.1 参照）
}
```

`questions` は `sort_order` 昇順。性年代の2問が必ず先頭に入る。

`version` は設問内容から算出した版。`PUT` の `base_version` にそのまま渡すと
楽観ロックが効く（§5.4.1）。**`updated_at` を競合判定に使わないこと**
（設問だけの変更では動かないため）。

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
  "questions": [ /* 5.2 と同じ形。全置換 */ ], // 任意
  "base_version": "sha256:9f2c…"              // 任意。楽観ロック（5.4.1）
}
```

- `questions` を送ると**パートナー設問は全置換**される（差分更新ではない）。
- 性年代設問は毎回サーバーが再構築するので、送らなくても消えない・送っても壊せない。
- 設問数を減らした場合、余った既存設問は物理削除ではなく非表示化する（既存回答の参照を壊さないため）。
- `status` が `closed` / `archived` の場合 **409**。
- `base_version` のみで `title` も `questions` も無い場合は **400**（更新内容が無いため）。

**レスポンス 200** … `SurveyView`

---

### 5.4.1 楽観ロック（`base_version`）

**解決したい問題**: ACI の管理画面では運営が、ポータルでは店舗が、**同じ
`projects` / `questions` の行**を編集している。`PUT` は全置換なので、店舗が
古い内容を持ったまま保存すると**運営の変更が黙って消える**。

**使い方**: 直前の `GET` / `PUT` で受け取った `SurveyView.version` を
`base_version` として送る。サーバー側の現在版と一致しなければ更新せず 409 を返す。

**409 のレスポンス**（マージに必要な情報を同梱する）

```jsonc
{
  "error": "version conflict",
  "current_version": "sha256:1a7b…",
  "survey": { /* SurveyView。現在のサーバー側の内容 */ }
}
```

ポータルはこの `survey` と自分の編集内容を突き合わせてマージし、
`base_version` に `current_version` を入れて再送する。

**`version` の性質**（`src/lib/partnerSurveyVersion.ts`）

- 設問の**内容**から算出する（`sha256:` ＋16進64文字）
- **`updated_at` は使えない**。`updated_at` はテーブルごとのトリガで動くため、
  設問だけ編集すると `questions` 側しか動かず `projects.updated_at` は据え置きになる。
  つまり「運営が設問だけ直した」という一番検知したい競合をすり抜ける
- 版に含めるもの … 設問文 / 種別 / 必須 / 選択肢（value・label）/ **並び順**
- 版に含めないもの … タイトル、`question_code`（保存のたびに再採番されるため）、
  **性年代の固定2問**（サーバーが毎回再構築するので、含めると常に競合する）
- 前後の空白・改行コードの揺れ、`answer_options` の `null` と `[]` の違いは版に影響しない

**後方互換**: `base_version` は**任意**。送らなければ従来どおり無条件で更新する。
そのため ACI を先にデプロイしても既存のポータルは壊れない。

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

### 5.6.1 `GET /api/partner/surveys/:id/results`

**店舗への申し送り設問**の結果。設問ごとに「集計のみ」か「原文」を返す。

回答者向け利用規約 **第9条3項**（migration 102）に基づく開示。
運営が管理画面で**明示的に開示ONにした設問だけ**が返る（既定は返らない）。

**レスポンス 200**

```jsonc
{
  "survey_id": "0f2b...-uuid",
  "status": "published",
  "total_count": 42,
  "questions": [
    {
      "question_code": "Q12",
      "question_text": "今日は施術中に話しかけてもよいですか？（ひとつだけ）",
      "notice": "この設問のみ担当者が施術前に確認いたします。会話の量はいつでも変えていただけます。",
      "mode": "aggregate",
      "choices": [
        { "value": "welcome", "label": "ぜひ話しかけてほしい", "count": 12 },
        { "value": "quiet",   "label": "できれば静かに過ごしたい", "count": 7 },
        { "value": "either",  "label": "どちらでもよい", "count": 3 }
      ],
      "entries": null,
      "answered_count": 22
    },
    {
      "question_code": "Q13",
      "question_text": "今日の施術について、気になっていることやスタッフに伝えたいことはありますか？",
      "notice": "この設問のみ担当者が施術前に確認いたします。",
      "mode": "verbatim",
      "choices": null,
      "entries": [
        { "answered_at": "2026-09-09T02:11:00.000Z", "text": "髪のパサつきが気になっています。" }
      ],
      "answered_count": 1
    }
  ]
}
```

| フィールド | 内容 |
|---|---|
| `notice` | 回答画面に出した告知文。**何を約束して集めたか**を店舗側にも示すため必ず返る |
| `mode` | `aggregate`=選択肢別の件数のみ / `verbatim`=原文一覧 |
| `choices` | `mode=aggregate` のときのみ。定義済み選択肢を**0埋めで全件**返す。それ以外は `null` |
| `entries` | `mode=verbatim` のときのみ。**新しい順**。空文字の回答は除く。それ以外は `null` |
| `answered_count` | 開示対象に絞ったあとの回答件数。`total_count` とは一致しない |

**返らないもの（設計上の保証・変更しないこと）**

- 回答者の識別子は一切返さない。`respondent_id` / `line_user_id` / 氏名はもちろん、
  **`session_id` も返さない**（個票を横に並べると回答者の名寄せに使えてしまうため）。
- 開示ONでない設問は、`questions` に**一切現れない**（ホワイトリスト方式）。
- 告知文（`notice`）が未設定の設問は、開示ONでも返らない（規約上の根拠が無いため）。
- `timing=on_close` の設問は、案件が `closed` になるまで返らない。
- **規約 v2.0 に同意した日時より前の回答は返らない**（利用目的の追加は遡及しないため）。
  そのため改定前に集めた回答は、フラグを立てても件数に入らない。

`questions` が空配列で返ることは正常（開示設定した設問がまだ無い状態）。

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

### 5.8 `GET /api/partner/legal/store-terms`（会員利用規約・店舗向け）

**migration 105**。会員ポータルの店舗が同意する利用規約の**現在版**を返す。
本文の正は ACI の `documents`（固定 id `d1000000-0000-0000-0000-000000000001`）で、
運営は ACI 管理画面「書類」で新版を作るだけでよい。**同意の記録はポータル側**（`legal_consents`）。

店舗スコープの検証はしない（全店舗に同じ文書）。認証ヘッダは他のエンドポイントと同じ。

**レスポンス 200**

```jsonc
{
  "document_id": "d1000000-0000-0000-0000-000000000001",
  "title": "会員利用規約（店舗向け・アンケでYOTTO）",
  "version_no": "1.0-draft",
  "content": "# アンケでYOTTO 会員利用規約（店舗向け）\n\n…",   // Markdown
  "change_reason": "初版（弁護士確認前の案）",
  "effective_from": "2026-09-11T00:00:00.000Z",
  "versions": [                                              // 新しい順・最大20件・本文なし
    { "version_no": "1.0-draft", "effective_from": "2026-09-11T00:00:00.000Z", "change_reason": "初版（弁護士確認前の案）" }
  ]
}
```

**版番号の規約（ポータル側の判定と対になる）**

- `X.Y[-suffix]`。`-draft` は弁護士確認前。
- **メジャー X を上げる** = 権利義務の実質変更。ポータルは店舗に**再同意**を求め、同意までは
  申し送り閲覧・QR発行・納品依頼を止める。
- **マイナー Y を上げる** = 表現の修正・誤記訂正等。ポータルは告知バナーだけ出す（再同意なし）。
- 施行日は `effective_from`（管理画面で新版を作った時刻）。予告期間を置きたい場合は先にお知らせで告知してから公開する。

- 文書が無効化されている / 版が無い → **404** `{"error":"store terms not found"}`

---

## 6. 環境変数

| 変数 | 必須 | 内容 |
|---|---|---|
| `PARTNER_API_KEY` | パートナーAPIを使うなら必須 | `X-Partner-Key` と照合する固定キー。16文字以上。`openssl rand -hex 32` 推奨 |
| `PARTNER_ADMIN_API_KEY` | 運営専用API（§8）を使うなら必須 | `X-Partner-Admin-Key` と照合する固定キー。16文字以上。**`PARTNER_API_KEY` とは必ず別の値**。未設定だと `/api/partner-admin/*` は全て 503。フォールバックはしない |
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

---

## 8. 運営専用API（`/api/partner-admin/*`）

**ACI の管理画面で運営（YOTTO）が作った案件を、ポータルの運営画面（`/ops`）から
店舗へ割り当てる**ためのAPI。店舗（ポータルの一般ユーザー）は使わない。

実装:
- ルータ … `src/routes/partnerAdminRoutes.ts`（`src/app.ts` で `/api/partner-admin` にマウント）
- 認証 … `src/middleware/partnerAdminAuth.ts`
- ユースケース … `src/services/partnerAssignmentService.ts`
- リポジトリ … `src/repositories/projectRepository.ts`
  （`listAssignableForPartner` / `listAssignedToPartner` / `assignPartnerStore` / `unassignPartnerStore`）
- テスト … `src/tests/partnerAdminApi.test.ts`

**migration は増やしていない**。割り当ての実体は既存列 `projects.partner_store_id`（migration 089）。

### 8.1 認証

| ヘッダ | 必須 | 内容 |
|---|---|---|
| `X-Partner-Admin-Key` | ○ | 環境変数 `PARTNER_ADMIN_API_KEY` と一致する固定キー |

- `X-Partner-Store-Id` は **不要**（このルータは店舗スコープを持たない。未割り当て案件が対象で、
  割り当て先の店舗はボディの `store_id` で受け取る）。
- 比較は `/api/partner/*` と同じ SHA-256 ダイジェスト同士の `timingSafeEqual`。
- **`PARTNER_ADMIN_API_KEY` 未設定なら全エンドポイントが 503**
  （`{"error":"partner admin API is not configured"}`）。
  **`PARTNER_API_KEY` へのフォールバックは一切しない**（fail-closed）。
  店舗スコープの鍵で全社の案件が引ける穴を作らないため。
- 店舗用の `PARTNER_API_KEY` の値を `X-Partner-Admin-Key` に載せても **401**。

### 8.2 エラー形式

`/api/partner/*` と同じ `{ "error": "..." }`。

| ステータス | 意味 |
|---|---|
| 400 | `store_id` が UUID でない / 未指定 |
| 401 | `X-Partner-Admin-Key` 不一致・未提示 |
| 404 | `:id` が UUID でない / 案件が存在しない |
| 409 | 割り当てガード違反（8.5 参照） |
| 503 | `PARTNER_ADMIN_API_KEY` 未設定 |

### 8.3 `GET /api/partner-admin/assignable-surveys`

割り当て候補の一覧。**設問本文は含まない**（一覧は選ぶためのもので、専門家が練った
設問文を割り当て前に丸ごと露出させない）。中身を見るときは 8.5 の 1件取得を明示的に叩く。

DB 側の抽出条件（`listAssignableForPartner`）:
`partner_store_id is null` かつ `client_id is null` かつ
`status in ('draft','ready')` かつ `is_discoverable = false`。
並びは `created_at` 降順。

**レスポンス 200**

```jsonc
{
  "surveys": [
    {
      "survey_id": "0f2b...-uuid",
      "title": "飲食店 満足度調査（汎用）",
      "status": "draft",                 // "draft" | "ready"
      "question_count": 8,               // 4種に写像できる設問数（性年代の固定2問は含まない）
      "created_at": "2026-08-01T00:00:00.000Z",
      "assignable": true,                // false ならそのままでは割り当てられない
      "blocked_reason": null             // assignable=false のときだけ理由が入る
    }
  ]
}
```

`blocked_reason` に入り得る文字列（`assign` の 409 メッセージと同じ文言）:

| 値 | 意味 |
|---|---|
| `"already assigned to a store"` | 既に別の店舗に割り当て済み |
| `"project belongs to a client"` | `client_id` 付き（他社クライアントの案件） |
| `"status must be draft or ready (current: <status>)"` | `published` / `closed` / `archived` 等 |
| `"project is discoverable in the public list"` | 「探す」一覧に出している案件 |
| `"contains N question(s) not representable as partner question types"` | 4種に写像できない設問がある |

### 8.4 `GET /api/partner-admin/assigned-surveys`

割り当て済み案件の一覧（`partner_store_id is not null`）。
ポータル側の対応行と突き合わせる**整合性チェック**用。設問本文は含まない。

**レスポンス 200**

```jsonc
{
  "surveys": [
    {
      "survey_id": "0f2b...-uuid",
      "title": "飲食店 満足度調査（汎用）",
      "status": "ready",
      "store_id": "3333...-uuid",        // ポータル側 stores.id
      "entry_code": "p-abc123",          // 未採番なら null
      "created_at": "2026-08-01T00:00:00.000Z",
      "updated_at": "2026-08-02T00:00:00.000Z"
    }
  ]
}
```

### 8.5 `GET /api/partner-admin/surveys/:id`

割り当て前プレビュー（**設問込み**）。運営が「店舗のエディタで開いたら何が見えるか」を
割り当て前に確認するためのもの。

レスポンスは店舗向け `GET /api/partner/surveys/:id` と**同じ `SurveyView`**（5.2 参照）。
未割り当ての案件では `store_id` が空文字、`entry_code` / `answer_url` が `null` になる。

- `:id` が UUID でない / 存在しない → **404** `{"error":"survey not found"}`
- 所有者スコープの検査はしない（未割り当て案件を見るのが目的のため）。
  だからこの鍵は運営サーバー側だけで使う。

### 8.6 `POST /api/partner-admin/surveys/:id/assign`

店舗に割り当てる。

**リクエスト**

```jsonc
{ "store_id": "3333...-uuid" }   // ポータル側 stores.id。UUID 必須（違反は 400）
```

**ガード（すべて満たさないと 409）**

| # | 条件 | 409 のメッセージ |
|---|---|---|
| 1 | `partner_store_id is null` | `"already assigned to a store"` |
| 2 | `client_id is null` | `"project belongs to a client"` |
| 3 | `status` が `draft` / `ready` | `"status must be draft or ready (current: published)"` |
| 4 | `is_discoverable = false` | `"project is discoverable in the public list"` |
| 5 | **完了セッションが0件** | `"survey already has N completed session(s)"` |
| 6 | **全設問が4種に写像できる** | `"survey contains question types not supported by the partner editor: q2(matrix_single), ..."` |

- 5 は「回答済み案件を店舗に渡すと、他所で集めた回答者データがその店舗に見えてしまう」事故を塞ぐ。
- 6 は `toPartnerQuestionType()` が `null` を返す設問（マトリクス・画像アップロード等）。
  黙って落とすと店舗のエディタで設問が減り、次の保存（全置換）で内部からも消えるため
  **409 にして、どの設問かを `question_code(question_type)` の形で返す**。
- 1 は最終的に**条件付きUPDATE**（`where id = ? and partner_store_id is null`）でも担保する。
  同時に2つの運営操作が走っても更新行が0件になり、後勝ちの二重割り当てにならない。
  この場合も `"already assigned to a store"` の 409。

**更新内容**

| 列 | 値 |
|---|---|
| `partner_store_id` | リクエストの `store_id` |
| `visibility_type` | `'private_store'` |
| `is_discoverable` | `false` |
| `entry_code` | 既存があればそのまま。無ければ `p-xxxxxx` を採番 |

**`status` は変更しない（`published` にしない）。**
QR を発行する前に回答が集まると、店舗が意図しないままチケットが消費される穴になるため。
公開は店舗が `POST /api/partner/surveys/:id/publish` を叩いたときだけ行われる。

割り当て後、`ensureDemographicQuestions()` を呼んで性年代の固定2問をそろえる
（ポータルから作った案件と同じ不変条件にする）。

**レスポンス 200** … `SurveyView`（5.2 と同形）。`store_id` に割り当てた店舗ID、
`status` は割り当て前のまま（`draft` か `ready`）。

### 8.7 `POST /api/partner-admin/surveys/:id/unassign`

割り当てを取り消す。ボディ不要。
**ポータル側の書き込みが失敗したときの巻き戻し（補償トランザクション）にも使う。**

更新内容（安全側に倒す）:

| 列 | 値 |
|---|---|
| `partner_store_id` | `null` |
| `visibility_type` | `'public'` |
| `entry_code` | `null`（古いQRで回答が入り続けるのを防ぐ） |
| `is_discoverable` | `false` |

- **冪等**。既に未割り当ての案件に呼んでも UPDATE を投げずに 200 を返す
  （巻き戻しが二重に走っても落ちない）。
- `:id` が UUID でない / 存在しない → **404**

**レスポンス 200** … `SurveyView`。`store_id` は空文字、`entry_code` / `answer_url` は `null`。

- **閲覧専用の紐づけ（`partner_readonly=true`・8.8〜8.10）には当てられない → 409**
  `"read-only survey (use unwatch)"`。unassign は `entry_code` を落とすため、
  稼働中の案件に当てると QR が死ぬ。閲覧専用の解除は必ず 8.10 の `unwatch` を使う。

### 8.8 `GET /api/partner-admin/watchable-surveys`（閲覧専用の紐づけ候補）

**migration 103**。運営が ACI 管理画面で作って回している案件（美容室ABCサイクルの A/B/C 等）を、
店舗のポータルに「見るだけ」で出すための別経路。assign と違い **稼働中・締切済み・回答あり・
4種に写像できない設問を含む案件でもよい**。

抽出条件（`listWatchableForPartner`）: `partner_store_id is null` ∧ `client_id is null` ∧ `status <> 'archived'`。
設問本文は含まない。

**レスポンス 200**

```jsonc
{
  "surveys": [
    {
      "survey_id": "0f2b...-uuid",
      "title": "美容室 A（ご来店時）",
      "status": "published",
      "entry_code": "yotto-salon-a",       // 運営が見分けるための材料
      "completed_count": 42,               // 完了セッション数
      "shareable_question_count": 2,       // 店舗開示ON（notice あり）の設問数。0 なら申し送りは出ない
      "created_at": "2026-08-01T00:00:00.000Z",
      "watchable": true,
      "blocked_reason": null               // "already assigned to a store" / "project belongs to a client" / "archived survey cannot be watched"
    }
  ]
}
```

### 8.9 `POST /api/partner-admin/surveys/:id/watch`（閲覧専用で紐づける）

**リクエスト** … `{ "store_id": "<ポータル stores.id>" }`（8.6 と同じ）

**ガード（409）**: `partner_store_id is null` / `client_id is null` / `status <> 'archived'` のみ。
回答の有無・設問型・is_discoverable は問わない。条件付きUPDATE（`where partner_store_id is null`）で
同時実行の後勝ちを防ぐ。

**更新内容（これ以外は一切触らない）**

| 列 | 値 |
|---|---|
| `partner_store_id` | リクエストの `store_id` |
| `partner_readonly` | `true` |

`visibility_type` / `entry_code` / `is_discoverable` / `status` は変えない。
`ensureDemographicQuestions()` も呼ばない（稼働中の設問構成を変えない）。

紐づけた案件に対して店舗向け API は次のように振る舞う:

| エンドポイント | 挙動 |
|---|---|
| `GET /surveys/:id` / `GET /stats` / `GET /results` | 通常どおり返す |
| `PUT /surveys/:id` / `POST /publish` / `POST /close` | **409 `"read-only survey"`** |

**レスポンス 200** … `SurveyView`。`status` / `entry_code` は紐づけ前のまま。

### 8.10 `POST /api/partner-admin/surveys/:id/unwatch`（閲覧専用の紐づけを外す）

ボディ不要。**冪等**（既に未紐づけなら UPDATE を投げずに 200）。
更新するのは `partner_store_id = null` / `partner_readonly = false` だけで、**`entry_code` には触らない**。

- `partner_readonly = false` の割り当て案件に当てると 409 `"survey is not read-only (use unassign)"`
- `:id` が UUID でない / 存在しない → 404

**レスポンス 200** … `SurveyView`。`store_id` は空文字。`entry_code` は残る。
