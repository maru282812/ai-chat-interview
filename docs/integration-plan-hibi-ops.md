# 実装指示書 v2: 管理画面のリンクタブ統合＋業種パッケージの hibi 側管理

作成日: 2026-08-06（v2。v1 の「ACI 管理画面へのフル吸収」案をユーザー決定により差し替え）
対象リポジトリ: **hibi-site**（Phase 1〜3）と **ai-chat-interview**（Phase 4）
同じ文書のコピー: `ai-chat-interview/docs/integration-plan-hibi-ops.md`（改訂したら両方更新）

## 決定事項（2026-08-06 確定）

| 論点 | 決定 |
|---|---|
| DB・Vercel・ドメイン | **統合しない**（Vercel は1 Pro チームに2プロジェクト＝追加費用0、ドメインは1つ＋サブドメイン、Supabase の実費差は約$10/月のみ） |
| 管理画面 | フル吸収（API 接続）はやらない。**ナビの相互埋め込み（リンクタブ）**で「タブを切り替える体感」にする |
| 業種パッケージ（オススメアンケート） | **hibi-site 側で DB 化して管理**（v1 の ACI 側管理案を破棄）。サムネ・提案サンプルスライドもここで設定 |
| 認証の行き来 | hibi 運営セッションを **90日** に延長＋ACI Basic 認証はブラウザ保存で運用。SSO ハンドオフは**保留**（煩わしさが残ったら追加） |
| 決定変更の記録 | 「消費枚数マスタは ai-chat-interview 側で管理（service-spec-ticket.md 2026-07-29 決定）」を**覆し hibi 側マスタとする**。理由: パッケージは実質 hibi の商品カタログ（チケット枚数=料金要素・公開LPの営業素材）で、ACI 自身は一切使わない |

## 実装目的

1. 運営が ACI 管理画面と hibi 運営画面を「1つの管理画面のタブ」感覚で行き来できる
2. オススメアンケート（業種パッケージ）の中身・チケット枚数・サムネ・提案サンプルスライドを
   hibi 運営画面から編集でき、公開ページ（/recommend・/sample）と会員のパッケージ選択（B5）に反映される
3. ハードコード二重管理（ACI `partnerPackages.ts` ＋ hibi `aci-mock.ts` の写し）を解消する

## 前提（現状）

- パッケージマスタ: ACI `src/lib/partnerPackages.ts`（ハードコード5件・画像なし）。
  hibi 公開ページは `lib/aci-mock.ts` の写し、会員 B5 は `lib/aci-client.ts` の `packages(storeId)` API 読み
- サムネ・スライド: hibi `components/proposal-sample.tsx` の自前ダミー SVG（パッケージに画像の概念が無い）
- hibi には画像基盤あり: `question_images`（migration 0004）＋ `lib/question-image-upload.ts`
  （マジックバイト判定・SVG 不許可）＋公開配信 `app/api/public/question-images/[imageId]`。**この方式を踏襲する**
- hibi 運営ナビ: `app/(ops)/ops/nav-items.ts`。C3 `/ops/packages` は現在「参照のみ」
- ACI 管理ナビ: `src/views/partials/header.ejs` の `navGroups` 配列
- hibi セッション: `lib/auth.config.ts` の `session: { strategy: "jwt" }`（maxAge 未指定 = 30日）

## 変更対象

| 領域 | リポジトリ | 変更有無 | 内容 |
|---|---|---|---|
| DB | hibi | あり | `packages` テーブル新設（0009）＋既存5件シード＋Storage バケット `package-images` |
| DB | ACI | なし | |
| API | hibi | あり | `GET /api/public/package-images/[imageId]`（画像公開配信）新設 |
| API | ACI | なし（後片付けのみ） | `GET /api/partner/packages` は Phase 2 完了後に非推奨化（Phase 4 で任意削除） |
| UI | hibi | あり | C3 を CRUD 化／公開・会員ページを DB 読みに差し替え／ナビに ACI リンクタブ |
| UI | ACI | あり | ナビに「アンケでYOTTO」リンクタブグループ（数行） |
| 型 | hibi | あり | `database.types.ts` に packages 追加、PublicPackage に画像フィールド追加 |
| 認証 | hibi | あり | セッション maxAge 90日 |
| env | 両方 | あり | hibi: `ACI_ADMIN_URL` ／ ACI: `PORTAL_OPS_URL` |

## DB スキーマ（hibi: 0009_packages.sql の指針）

```
packages
  id               text primary key         -- 既存 slug 踏襲（restaurant_basic 等。URL /recommend/[id] に使用）
  industry         text not null            -- 業種キー（restaurant / salon / retail / clinic / general …）
  industry_label   text not null
  name             text not null
  description      text not null
  ticket_cost      integer not null default 1 check (ticket_cost >= 1)
  questions        jsonb not null           -- PackageQuestion[]（lib/aci-types.ts の packageQuestionSchema と同形状）
  cover_image_path text                     -- Storage `package-images` 内パス。null = サムネ未設定（ダミーSVGで表示）
  slides           jsonb not null default '[]'
                   -- [{ id: uuid, image_path: text, caption: text | null, sort_order: int }]
  sort_order       integer not null default 0
  is_active        boolean not null default true   -- false は公開・会員ページに出さない（下書き/停止）
  updated_at       timestamptz not null default now()
```

- RLS: 0001 と同じ deny-all（enable + force + revoke）、grant は service_role のみ（0003/0004 の作法）
- シード: `lib/aci-mock.ts` の `MOCK_PACKAGES` 5件を INSERT（questions は同一 JSON）
- 画像実体: 非公開バケット `package-images`。公開配信は画像 id（uuid）だけを露出する
  `GET /api/public/package-images/[imageId]` 方式（question-images と同じ。パス・パッケージ id を漏らさない）
  → 画像メタは `package_images` テーブルを別に切らず、`packages.cover_image_path` / `slides[].image_path` に
  直接パスを持たせ、配信ルートは `?p=<packageId>&k=<cover|slideId>` ではなく
  **`slides[].id`（uuid）または cover 用に `packages.id + 'cover'` を引数にせず**、
  実装簡素化のため `package_images` テーブル（id uuid pk, package_id fk, kind('cover'|'slide'),
  storage_path, content_type, byte_size, caption, sort_order, status('active'|'revoked')）を新設して
  question_images と完全同型にする。**packages.cover_image_path / slides は持たせず、
  画像はすべて package_images で管理**（上の cover_image_path / slides 定義は不採用。こちらが正）。

> 整理: `packages`（本体・questions・ticket_cost・sort・active）＋ `package_images`（cover/slide 画像、
> question_images と同型）。この2テーブル構成を採用する。

## 実装フェーズ

### Phase 1（hibi）: パッケージ DB 化＋C3 の CRUD 化
- migration 0009（packages ＋ package_images ＋ RLS/grant ＋ シード5件）、`database.types.ts` 更新
- `lib/packages.ts`（server-only）: list/get/create/update/toggle/sort、画像 upload/revoke
  （`lib/question-image-upload.ts` のマジックバイト判定を共通化 or 流用。SVG 不許可）
- `GET /api/public/package-images/[imageId]`: 公開配信（active のみ。revoked/不明 id は 404）
- C3 `/ops/packages` を CRUD 画面に: 一覧（有効/無効・並び順）・基本情報編集・設問編集
  （まずは JSON テキストエリア＋ zod 検証で可）・カバー/スライド画像のアップロード・並べ替え・キャプション
- `docs/service-spec-ticket.md` に決定変更の追記（「消費枚数マスタは hibi 側 packages テーブルへ移管 2026-08-06」）
- 完了条件: migration 適用／C3 から作成・編集・画像設定ができ、audit 相当のログ（console で可）が残る

### Phase 2（hibi）: 表示側の差し替え（公開＋会員）
- `lib/public-packages.ts`: `MOCK_PACKAGES` 依存をやめ、自 DB（lib/packages.ts）読みに変更。
  `PublicPackage` に `coverImageUrl: string | null` / `slides: { imageUrl, caption }[]` を追加
- /recommend カード・/recommend/[id]: 実サムネ表示（無ければ既存 `ProposalCoverThumb` の SVG）
- /sample ビューア: パッケージにスライドがあれば実画像スライド、無ければ既存 `SAMPLE_SLIDES`
- 会員 B5（`app/(member)/create/page.tsx` / `actions.ts`）: `aci-client.packages(storeId)` 読みを
  自 DB 読みに差し替え（is_active のみ）。draft 作成時に ACI へ送る設問はこの DB の questions を使う。
  性年代自動付与の説明表示は既存の固定文言のまま（付与自体は ACI 側の責務で変更なし）
- チケット消費枚数: QR 発行の消費 qty を `packages.ticket_cost` から取る（`DEFAULT_CONSUMPTION_QTY` は
  パッケージ無し（ゼロから自作）の既定値として残す）
- 完了条件: C3 で編集→公開ページ・B5 に即反映／ACI の packages API をどこからも呼んでいない／
  lint・typecheck・test・build 全部通る

### Phase 3（hibi）: リンクタブ＋セッション延長
- env `ACI_ADMIN_URL`（例: `https://ai-chat-interview-theta.vercel.app`。未設定ならリンク非表示）
- `app/(ops)/ops/nav-items.ts` ＋ ops layout: ナビ末尾に「Hibi 管理画面（ACI）」グループを追加
  （店舗専用アンケート `/admin/store-surveys`・管理トップ `/admin` への**同一タブ**リンク）
- C6 割り当て候補の各行に「ACI でこの案件を編集する」リンク（`${ACI_ADMIN_URL}/admin/store-surveys`）
- `lib/auth.config.ts`: `session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 90 }`
- `.env.example` 更新
- 完了条件: /ops から ACI へ1クリックで行ける／90日セッションで再ログイン不要になっている

### Phase 4（ACI）: リンクタブ＋後片付け ※ai-chat-interview リポジトリのセッションで実行
- env `PORTAL_OPS_URL`（例: `https://<hibi本番ドメイン>`。ローカルは `http://localhost:3333`）
- `src/views/partials/header.ejs` の `navGroups` に「アンケでYOTTO」グループを追加:
  プロジェクト・納品 `/ops/projects`／割り当て `/ops/assignments`／チケット台帳 `/ops/ledger`／
  パッケージ `/ops/packages`／会員 `/ops/members`（すべて `PORTAL_OPS_URL` ベースの同一タブリンク。
  env 未設定ならグループごと非表示）
- 店舗専用アンケート一覧（`views/admin/store-surveys/index.ejs`）に
  「hibi で店舗に割り当てる → /ops/assignments」の導線を1つ追加
- 後片付け（任意・Phase 2 完了確認後）: `GET /api/partner/packages` と `src/lib/partnerPackages.ts` を削除
  （他に参照が無いことを grep で確認してから。`fixed_demographic_questions` を他が使っていないかも確認）
- 完了条件: ACI 管理画面のナビから hibi の5画面に1クリックで行ける

## ファイル別変更内容（主要）

| 種別 | リポジトリ / パス | 内容 |
|---|---|---|
| 新規 | hibi supabase/migrations/0009_packages.sql | packages ＋ package_images ＋ シード |
| 修正 | hibi supabase/database.types.ts | 2テーブル追加（手書き同期） |
| 新規 | hibi lib/packages.ts | CRUD＋画像（server-only） |
| 新規 | hibi app/api/public/package-images/[imageId]/route.ts | 画像公開配信 |
| 修正 | hibi app/(ops)/ops/packages/** | 参照→CRUD 画面 |
| 修正 | hibi lib/public-packages.ts | 自 DB 読み＋画像フィールド |
| 修正 | hibi components/proposal-sample.tsx | 実画像＋SVG フォールバック |
| 修正 | hibi app/(public)/recommend/**・sample/** | サムネ・スライド表示 |
| 修正 | hibi app/(member)/create/page.tsx・actions.ts | B5 を自 DB 読みに |
| 修正 | hibi lib/tickets.ts 呼び出し側 | 消費 qty を packages.ticket_cost から |
| 修正 | hibi app/(ops)/ops/nav-items.ts・layout | ACI リンクタブ |
| 修正 | hibi lib/auth.config.ts | maxAge 90日 |
| 修正 | ACI src/views/partials/header.ejs | 「アンケでYOTTO」リンクグループ |
| 削除(任意) | ACI src/lib/partnerPackages.ts ほか | packages API の廃止 |

## 注意点

- **id は既存 slug を維持**（`restaurant_basic` 等）。/recommend/[packageId] の URL・既存 draft の
  package 参照を壊さない。C3 の新規作成時は slug の形式（半角英数+アンダースコア・一意）を検証する
- **B5 の互換**: Phase 2 で `packagesResponseSchema`（aci-types）由来の型を使っている箇所を洗い出して
  hibi 型に置き換える。`ACI_MOCK=1` のローカル完結モードは「自 DB 読み」になるので自然に解消されるが、
  DB 未接続ローカルで公開ページが落ちないことを確認する
- **画像**: question-images と同じくマジックバイト判定・SVG 不許可・revoked 即 404。
  カバーは1パッケージ1枚（active の部分一意）、スライドは複数可
- **ticket_cost の変更は既存進行中案件に遡及させない**: 消費時に都度マスタを引くと、掲示中の案件の
  途中で枚数が変わり得る。QR 発行時点の枚数で確定させる（発行フローで読む値がその時点のマスタ値で
  あることを確認し、確認モーダルに表示している枚数と実消費が必ず一致すること）
- ACI 側ナビの `PORTAL_OPS_URL` / hibi 側の `ACI_ADMIN_URL` は**未設定なら出さない**（リンク切れを出さない）
- hibi /ops へのリンクを ACI に張っても、hibi 側の運営認可（allowlist・404）は従来どおり効く。
  リンクタブは認可を一切バイパスしない

## 完了条件（全体）

- [ ] hibi C3 でパッケージの作成・設問編集・チケット枚数・サムネ・スライドを設定できる
- [ ] 設定内容が /recommend・/recommend/[id]・/sample・会員 B5 に反映される（画像未設定は従来ダミー表示）
- [ ] ACI `partnerPackages.ts` と hibi `aci-mock.ts` 写しの二重管理が解消されている
- [ ] ACI 管理画面ナビ⇔hibi 運営ナビを同一タブで相互に行き来できる
- [ ] hibi 運営の再ログインが90日に1回になっている
- [ ] lint / typecheck / test / build がすべて通る

## Codex / Claude Code 用指示文

### Phase 1 指示文（hibi-site で実行）

```
本書「DBスキーマ」節のとおり supabase/migrations/0009_packages.sql を作成してください
（packages ＋ package_images。RLS deny-all＋force＋revoke、service_role grant は 0004 の作法。
シードは lib/aci-mock.ts の MOCK_PACKAGES 5件）。supabase/database.types.ts を手書き同期。
lib/packages.ts（server-only）に一覧/取得/作成/更新/有効切替/並び替えと、画像アップロード
（lib/question-image-upload.ts のマジックバイト判定を流用、jpeg/png/webp のみ、カバーは
active 1枚まで）・revoke を実装。app/api/public/package-images/[imageId]/route.ts で
question-images と同じ方式の公開配信（active のみ・revoked は 404）を実装。
/ops/packages（C3）を CRUD 画面に作り替え: 一覧（sort_order 順・有効/無効バッジ）、基本情報
フォーム、questions の JSON テキストエリア（packageQuestionSchema の配列として zod 検証・
エラーは行内表示）、カバー/スライドのアップロード・削除・並べ替え・キャプション編集。
Server Actions は先頭で requireOps()、入力は zod、失敗は { ok:false, message }、成功は
revalidatePath。docs/service-spec-ticket.md に「消費枚数マスタを hibi 側 packages へ移管
（2026-08-06）」の追記もすること。lint / typecheck / test を通す。
完了条件: migration 適用後、C3 でパッケージを編集し画像を設定できる。
```

### Phase 2 指示文（hibi-site で実行）

```
表示側をパッケージ DB 読みに差し替えてください。
lib/public-packages.ts: MOCK_PACKAGES 依存をやめ lib/packages.ts（is_active のみ）読みに。
PublicPackage に coverImageUrl / slides[{imageUrl, caption}] を追加（URL は
/api/public/package-images/:id で組み立て）。
/recommend と /recommend/[packageId]: カバー画像があれば実画像サムネ、無ければ既存
ProposalCoverThumb（SVG）を表示。/sample: スライドがあれば実画像ビューア（ページ送り・
キャプション表示）、無ければ既存 SAMPLE_SLIDES。
会員 B5（app/(member)/create/page.tsx・actions.ts）: aci-client の packages(storeId) を
呼ぶのをやめ、自 DB 読みに差し替え。draft 作成時に ACI へ送る設問はこの questions を使う。
QR 発行時の消費枚数はパッケージ由来の案件は packages.ticket_cost を、それ以外は
DEFAULT_CONSUMPTION_QTY を使い、確認モーダルの表示枚数と実消費が一致することをテストで担保。
aci-types の packages 関連スキーマ・aci-client.packages()・aci-mock の MOCK_PACKAGES が
不要になったら削除（他参照が無いことを grep で確認）。lint / typecheck / test / build を通す。
完了条件: C3 の編集が公開ページと B5 に反映される。DB 未接続ローカルでも公開ページが落ちない。
```

### Phase 3 指示文（hibi-site で実行）

```
運営ナビに ACI へのリンクタブを追加してください。
env ACI_ADMIN_URL（未設定ならリンク群を出さない）。app/(ops)/ops/nav-items.ts に外部リンク型の
項目を表現できる形を足し（external: true 等）、ops layout のナビ末尾に「Hibi 管理画面（ACI）」
グループ: 管理トップ（/admin）と店舗専用アンケート（/admin/store-surveys）への同一タブリンク。
C6（/ops/assignments）の割り当て候補セクション見出し付近に「ACI で案件を作成・編集する」リンク。
lib/auth.config.ts の session を { strategy: "jwt", maxAge: 60 * 60 * 24 * 90 } に変更。
.env.example に ACI_ADMIN_URL を追記。lint / typecheck / test を通す。
完了条件: /ops から ACI 管理画面へ1クリックで遷移できる。
```

### Phase 4 指示文（ai-chat-interview で実行）

```
src/views/partials/header.ejs の navGroups に「アンケでYOTTO」グループを追加してください。
項目: プロジェクト・納品 → {PORTAL_OPS_URL}/ops/projects ／ アンケート割り当て → /ops/assignments ／
チケット台帳 → /ops/ledger ／ パッケージ → /ops/packages ／ 会員管理 → /ops/members。
PORTAL_OPS_URL は env（未設定ならグループを出さない）。リンクは同一タブ。
views/admin/store-surveys/index.ejs の説明文近くに「hibi 会員店舗への割り当ては
アンケでYOTTO 運営画面（/ops/assignments）で行う」導線リンクを1つ追加。
（任意・hibi Phase 2 完了確認後）GET /api/partner/packages と src/lib/partnerPackages.ts を削除。
削除前に grep で参照ゼロを確認し、fixed_demographic_questions を他機能が使っていないことも確認する。
完了条件: ACI 管理画面ナビから hibi の5画面へ遷移できる。
```

## 次の工程

- Phase 1 から hibi-site で着手（Phase 1→2→3 は同一リポジトリなので連続実行可）
- Phase 4 は ai-chat-interview リポジトリのセッションで実行
- SSO ハンドオフ（ACI→hibi の署名付き自動ログイン）は保留。運用して煩わしければ別計画で追加
