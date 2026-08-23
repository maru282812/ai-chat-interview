# 実装計画: デプロイ先ポータブル化（Vercel ⇄ Cloudflare Workers）

作成: 2026-08-21 / 更新: 2026-08-22
状態: **Phase 0-4 完了（実装・動作確認済み）**・Phase 5 は不要になった・Phase 6（実データ検証）未実施

> 運用手順は [docs/deploy-portable.md](deploy-portable.md) を参照（こちらが運用時の入口）。
> Phase 5（scrypt/zlib の代替実装）は Phase 0 の実測で**両方動いたため不要**になった。

> Phase 0 の実測結果は [docs/spike-workers/RESULTS.md](spike-workers/RESULTS.md)。
> 動作実証済みアダプタ = `docs/spike-workers/adapter.reference.js`

## 実装目的

同一コードベースを **Vercel(Node) と Cloudflare Workers の両方**へデプロイできる状態にする。
切り替えはアダプタファイルとビルド設定の選択のみで行い、アプリ本体（routes / services /
repositories / views）はデプロイ先を意識しない。

完成時にできること:

- `npm run build:vercel` → 従来どおり Vercel へデプロイ（既存挙動を一切変えない）
- `npm run build:workers && npx wrangler deploy` → 同じアプリが Workers 上で動く
- 本番切り替えはドメインの向き先変更のみ

## 前提（調査で確定した事実）

調査日 2026-08-21。想定より障壁は小さい。

### 追い風だった点

| 項目 | 実態 | 評価 |
|---|---|---|
| Vercel 固有コード | [api/index.ts](../api/index.ts) は `createApp()` を export するだけ。Vercel SDK 依存ゼロ | ほぼ無改修 |
| crypto | 全 8 箇所が `node:crypto`（`createHash`/`createHmac`/`timingSafeEqual`/`randomBytes`） | `nodejs_compat` で動作 |
| Node 組み込み依存 | crypto 8・zlib 2・path 3 のみ。`fs` 直接使用は **ゼロ** | 想定より軽い |
| cron エンドポイント | [src/routes/cronRoutes.ts](../src/routes/cronRoutes.ts) が既に HTTP 化済み・`CRON_SECRET` 認証あり | Cron Trigger から叩くだけ |

### 障壁として残る点

| # | 項目 | 実態 | 対処 |
|---|---|---|---|
| B1 | EJS ビュー | 106ファイル・`res.render()` **114箇所**・`process.cwd()` からFS読み（[src/app.ts:24](../src/app.ts#L24)） | ビルド時プリコンパイル＋バンドル埋め込み |
| B2 | 静的ファイル | 6ファイルを `express.static`（[src/app.ts:36](../src/app.ts#L36)） | Workers Assets へ |
| B3 | 動的 cron | DB値を読んで実行時 `cron.schedule()`（[notificationSchedulerService.ts:202-322](../src/services/notificationSchedulerService.ts#L202-L322)） | 既に HTTP dispatch 併存。Workers では常駐版を起動しないだけ |
| B4 | scrypt | 同上 | ✅ **解消**（実測で動作。Phase 5 の移行作業は不要） |
| B5 | zlib | 同上 | ✅ **解消**（実測で動作。ZIP縮退は不要） |
| B6 | Express 5 | Workers 公式サポート外 | ✅ **解消**（アダプタ実証済み。ただし下記②〜⑤の罠あり） |

### 仮定した仕様（要確認）

- 管理画面の統計ZIPエクスポート(B5)は、Workers 側では一時的に使えなくても業務が回る
  → 回らない場合は Phase 5 の対処方針が変わる
- Workers 移行後も Supabase / OpenAI / LINE / Resend は現行のまま（変更しない）

## 変更対象

| 領域 | 変更有無 | 内容 |
|---|---|---|
| DB | **なし** | migration 不要 |
| API | なし（ロジック） | ルート定義・認証は不変 |
| UI | なし（見た目） | EJS の**読み込み方式**のみ変更。テンプレート本文は不変 |
| 型定義 | 軽微 | Workers 用 `Env` 型を追加 |
| その他 | あり | ビルド構成・アダプタ・`wrangler.toml`・env 供給経路・cron 設定 |

## 実装フェーズ

> **重要**: Phase 0 は「調べて止まる」フェーズ。ここが赤なら Phase 1 以降は着手しない。

### Phase 0: 実現可能性の実証（スパイク）

- 内容: 使い捨てブランチで最小 Workers を立て、以下4点を**実測**する
  1. Express 5 + `nodejs_compat` でリクエストが通るか（B6）
  2. `node:crypto` の `scrypt` が動くか（B4）
  3. `node:zlib` の `deflateRawSync` が動くか（B5）
  4. プリコンパイル済み EJS が動くか（B1 の原理検証・1ファイルで可）
- 依存: なし
- 完了条件: 4項目の可否が○×で確定し、×があれば代替案が決まっている
- **停止ゲート**: 1 が × なら計画全体を見直す（Hono 等への載せ替えが必要になり工数が跳ね上がる）

### Phase 1: 環境抽象化レイヤ

- 内容: `process.env` 直参照を `src/config/env.ts` 経由に一本化する。
  Workers は `process.env` を持たず env は fetch handler の引数で来るため、
  ここを塞がないと Workers 側で全設定が undefined になる
- 依存: Phase 0 が緑
- 完了条件: `grep -rn "process\.env" src --include=*.ts` が env.ts とテスト以外でヒットしない／
  既存テスト全 pass／Vercel 側の挙動が不変

### Phase 2: ビューのプリコンパイル化

- 内容: 106 EJS をビルド時にコンパイルして単一モジュールへ埋め込む。
  `app.set("views", ...)` を廃し、カスタム `app.engine` でメモリ上テンプレートを解決する。
  `include()` の相対パス解決（`../partials/`・`./partials/` の混在を実測済み）を
  コンパイル時に吸収する
- 依存: Phase 1
- 完了条件: `res.render()` 114箇所が**無改修**で動く／Vercel でも同方式で全画面が表示される／
  `adminViewFoundation.test.ts` 等の既存ビューテストが pass

### Phase 3: 静的アセットの移設

- 内容: `src/public` の6ファイルを Workers Assets 配信に対応させる。
  Vercel 側は `express.static` を維持し、アダプタ層で分岐
- 依存: Phase 2
- 完了条件: 両環境で `/public/*` が 200 で返る

### Phase 4: Workers アダプタ + wrangler 構成

- 内容: `workers/index.ts`（fetch handler + scheduled handler）と `wrangler.toml` を新規作成。
  scheduled handler は `cronDispatchService.dispatch()` を直接呼ぶ（HTTP 自己呼び出しはしない）。
  `node-cron` 常駐スケジューラは Workers では起動しない（[api/index.ts](../api/index.ts) と同じ扱い）
- 依存: Phase 3
- 完了条件: `wrangler dev` でローカル起動し `/health` が 200／
  Cron Trigger で dispatch が発火することをログで確認

### Phase 5: 差分機能の処理（B4/B5 の後始末）

- 内容: Phase 0 で × だった項目の代替実装。
  scrypt が不可なら PBKDF2/WebCrypto へ移行（**既存ハッシュとの互換維持が必須** →
  アルゴリズム識別子付きの二重検証にする）。
  zlib が不可なら ZIP エクスポートを Workers では 501 で明示的に無効化
- 依存: Phase 4
- 完了条件: 管理者ログインが両環境で成功／無効化した機能が明示エラーを返す（無言で壊れない）

### Phase 6: 並行稼働検証

- 内容: Workers を**別ドメイン**（例 `staging-cf.<domain>`）で立て、本番と並走させる
- 依存: Phase 5
- 完了条件: 管理画面主要導線・LIFF 主要導線・cron 発火を実機確認／
  本番 `app.yottollc.com` は無変更のまま

## ファイル別変更内容

| 種別 | パス | 変更内容 |
|---|---|---|
| 新規 | `workers/index.ts` | Workers エントリ（fetch + scheduled） |
| 新規 | `wrangler.toml` | Workers 設定・nodejs_compat・Cron Triggers・Assets |
| 新規 | `scripts/compileViews.mjs` | 106 EJS のプリコンパイル |
| 新規 | `src/views/_compiled.ts`（生成物） | 埋め込みテンプレート |
| 修正 | `src/app.ts` | views 設定をエンジン差し替えに・static を分岐 |
| 修正 | `src/config/env.ts` | env 注入方式の抽象化 |
| 修正 | `src/lib/adminPassword.ts` | (Phase 0 の結果次第) |
| 修正 | `src/lib/zip.ts` | (Phase 0 の結果次第) |
| 修正 | `package.json` | `build:vercel` / `build:workers` 分離 |
| 不変 | `api/index.ts` / `vercel.json` | Vercel 側は触らない |

## 注意点

- **本番 `app.yottollc.com` は LIFF 込みで稼働中**。Phase 6 まで向き先を変えない
- **env 欠落は全停止を招く**（過去に `.env` 削除で本番全滅の実績あり）。Workers 側 env は
  Phase 4 時点で全キーを移し、`/health` に必須キーの存在チェックを足すこと
- **LIFF URL は `liffService` ヘルパー経由**（PR#37 の教訓）。`APP_BASE_URL` 直組み禁止は
  Workers 側でも同様
- **cron の二重発火**に注意。Vercel と Workers を並走させると配信が2回走る。
  Phase 6 では Workers 側の Cron Trigger を**無効のまま**にし、切り替え時に入れ替える
- Phase 2 はビューの読み込み方式を全画面で変える。**影響範囲は 114 箇所と最大**。
  ここだけは Vercel 側でも先に本番投入して安定を確認してから Workers へ進むのが安全

## 完了条件

- [ ] Phase 0 の4項目が実測で確定している
- [ ] `npm run build:vercel` の成果物が現行と同等に動く（デグレなし）
- [ ] `npm run build:workers` → `wrangler dev` で全画面が表示される
- [ ] 管理者ログインが両環境で成功する
- [ ] cron dispatch が Workers の Cron Trigger で発火する
- [ ] 既存テスト（7スイート）が両構成で pass
- [ ] 別ドメインでの並行稼働を実機確認済み
- [ ] 本番切り替え手順とロールバック手順が文書化されている

## 未確定事項（着手前にユーザー確認）

1. 統計ZIPエクスポートは Workers 側で一時的に使えなくても許容できるか
2. Phase 2（ビュー方式変更）を Vercel 本番へ先行投入してよいか
3. Workers 移行後も Vercel 契約を残すか（残さないと切り戻し先が消える）
