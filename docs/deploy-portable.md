# デプロイ運用ガイド（Vercel ⇄ Cloudflare Workers）

最終更新: 2026-08-22 / 状態: **両環境で動作確認済み**（本番切り替えは未実施）

同一コードベースが Vercel(Node) と Cloudflare Workers の両方で動く。
アプリ本体（routes / services / repositories / views）はデプロイ先を意識しない。

## コマンド

| 目的 | コマンド |
|---|---|
| ローカル開発（Node） | `npm run dev` |
| ローカル開発（Workers） | `npm run build:workers && npm run dev:workers` |
| Vercel 用ビルド | `npm run build` |
| Workers 用ビルド | `npm run build:workers` |
| Workers へデプロイ | `npm run deploy:workers` |
| ビュー再生成のみ | `npm run build:views` |
| 静的ファイル再生成のみ | `npm run build:assets` |
| 全ビューの描画確認 | `npm run verify:views` |

`src/views/_compiled.ts` と `src/public/_compiled.ts` は**生成物**で git 管理外。
ビルドが自動生成するので、手で編集しないこと。

## 環境ごとの違い（ここだけが分岐点）

| 項目 | Vercel (Node) | Cloudflare Workers |
|---|---|---|
| エントリ | `api/index.ts` | `workers/index.ts` |
| env | `process.env`（読込時に解決） | fetch handler 引数 → `initEnv()` |
| ビュー | プリコンパイル（共通） | プリコンパイル（共通） |
| 静的ファイル | 埋め込み（共通） | 埋め込み（共通） |
| 定期実行 | `vercel.json` の crons | `wrangler.toml` の Cron Trigger |
| 常駐スケジューラ | 起動しない | 起動しない（node-cron はスタブ） |

ビューと静的ファイルは**両環境で同じ経路**を通す。
環境ごとに描画方式を変えると「片方でしか出ない不具合」が生まれるため。

## Workers への初回デプロイ手順

### 1. env を登録する

必要なキーは `src/config/env.ts` の `envSchema` が唯一の真実。
**秘密情報は `wrangler.toml` の `[vars]` に書かない**。secret として登録する。

```bash
wrangler secret put SUPABASE_URL
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler secret put LINE_CHANNEL_ACCESS_TOKEN
wrangler secret put LINE_CHANNEL_SECRET
wrangler secret put OPENAI_API_KEY
wrangler secret put ADMIN_PASSWORD_HASH
wrangler secret put ADMIN_SESSION_SECRET
wrangler secret put DEFAULT_PROJECT_ID
# 以下は任意（未設定なら該当機能が 503 になる）
wrangler secret put CRON_SECRET
wrangler secret put PARTNER_API_KEY
wrangler secret put PARTNER_ADMIN_API_KEY
wrangler secret put MENTAL_PUSH_PROXY_SECRET
wrangler secret put RESEND_API_KEY
```

⚠ **env 欠落は全停止を招く**（過去に `.env` 削除で本番全滅の実績あり）。
未設定のまま起動すると zod が落ちるが、`/health` が
`{"ok":false,"error":"worker_bootstrap_failed","message":...}` を 500 で返すので
理由は分かるようにしてある。**デプロイ直後は必ず `/health` を見ること**。

### 2. デプロイして疎通確認

```bash
npm run deploy:workers
curl https://<worker>.workers.dev/health        # {"ok":true,...}
curl -I https://<worker>.workers.dev/admin/login # 200
curl -I https://<worker>.workers.dev/public/styles.css # 200 text/css
```

### 3. LIFF を触る前に

`APP_BASE_URL` を Workers 側の URL に合わせること。
**LINE に貼る URL は必ず `liffService` のヘルパー経由で生成する**
（`APP_BASE_URL` 直組みは禁止。PR#37 の教訓）。

## 本番切り替え（cron の二重発火に注意）

⚠ **最重要**: Vercel と Workers の cron を同時に有効にすると**配信が2回走る**。

切り替えは必ずこの順で行う。

1. Workers を独自ドメイン抜きで立て、`/health` と主要画面を確認
2. **Vercel 側の cron を止める** — `vercel.json` の `crons` を空にして再デプロイ
3. Workers 側の cron を有効化 — `wrangler.toml` の `[triggers]` を
   コメント解除して `npm run deploy:workers`
4. `cron_dispatch_runs` テーブルで発火を確認
5. ドメインを Workers に向ける
6. `APP_BASE_URL` を更新して再デプロイ

`cronDispatchService` の `CATCH_UP_WINDOW_MIN`（5分）が**毎分実行を前提**にしている。
実行間隔を広げるとこの窓を跨いだジョブが「その日まるごと未実行」になりうる。

## 切り戻し

Vercel 側は一切壊していないので、**ドメインを戻すだけ**で復帰できる。

1. ドメインを Vercel に戻す
2. `wrangler.toml` の `[triggers]` をコメントアウトして再デプロイ（cron 停止）
3. `vercel.json` の `crons` を戻して再デプロイ

**Workers に移行しても Vercel 契約は残すこと**。切り戻し先が消える。

## 触るときの注意

- **ビューを足したら `npm run build:views`**。生成物は git 管理外なので
  ビルドを通さないと新しいビューが存在しないことになる（`build` が自動で呼ぶ）
- **`process.env` を直接読まない**。`src/config/env.ts` の `env` 経由にする。
  Workers に `process.env` は無い（例外は `portalOpsLinks.ts` のみ・理由はコード内に記載）
- **eval / new Function は使えない**（Workers が禁止）。
  テンプレートを実行時に組み立てる実装を足さないこと
- **node-cron は Workers で使えない**。定期実行は Cron Trigger →
  `workers/index.ts` の scheduled handler → `cronDispatchService.dispatch()`
- バンドルは現状 **7.0MB（未圧縮）/ 1.38MB（gzip）**。Workers の上限は**圧縮後 3MB**なので
  現状は余裕がある（2026-08-22 実測）。大きな依存を足したら
  `gzip -9 -c dist-workers/index.js | wc -c` で圧縮後サイズを見ること

## 既知の未検証項目

実 DB・外部サービスに繋いだ状態での確認は未実施。Workers 本番化の前に通すこと。

- [ ] Supabase 接続（実データでの一覧・詳細・保存）
- [ ] OpenAI 呼び出し（AIチャット・深掘り）
- [ ] LINE 配信（webhook 受信・push 送信）
- [ ] LIFF 実機（認証・回答・完了）
- [ ] Cron Trigger の実発火
- [ ] 統計ZIPエクスポート（`deflateRawSync` は Phase 0 で動作確認済みだが実データ未検証）
