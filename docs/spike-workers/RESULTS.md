# Phase 0 スパイク結果（2026-08-21 実測）

実測環境: wrangler 4.124.0 / workerd 1.20260815.1 / `compatibility_flags = ["nodejs_compat"]`
検証物: `docs/spike-workers/adapter.reference.js`（実際に動いたアダプタ）

## 結論: 4項目すべて ✅ — Workers 移行は実現可能

| # | 項目 | 結果 | 実測値 |
|---|---|---|---|
| 1 | Express 5 | ✅ | ルーティング・ミドルウェア・`express.json()` すべて動作 |
| 2 | `node:crypto` scrypt | ✅ | `keyLen=64` / `timingSafeEqual=true` / `createHash`・`createHmac` も動作 |
| 3 | `node:zlib` deflateRawSync | ✅ | 同期API がそのまま動く（統計ZIPエクスポートは**縮退不要**） |
| 4 | プリコンパイル EJS | ✅ | FS 非依存でレンダリング成功・日本語も正常 |

→ **計画の B4（scrypt）/ B5（zlib）はいずれも問題なし**。当初の懸念は解消。

## 判明した落とし穴（Phase 1-4 で必ず効く）

### ① EJS の `client:true` は ESM で使えない
既定出力が `with (locals || {})` を含み、esbuild が
`With statements cannot be used in an ECMAScript module` で弾く。

- `_with:false` にすると `with` は消えるが、テンプレ内の `title` が
  **どこにも束縛されず ReferenceError** になる（106ビュー全書き換えが必要になる）
- **採用**: `with` 版の関数ソースを文字列で埋め込み、実行時に評価して関数化する。
  これなら**既存106ビューを1行も直さずに済む**。
  → `docs/spike-workers/build-views.reference.mjs` の方式B

### ② esbuild は `--platform=node` だと workerd で落ちる
`Dynamic require of "tty" is not supported`。
`--platform=browser --conditions=workerd,worker,browser` にしたうえで、
**bare 指定の組み込みモジュールを `node:` 付きへ alias する**必要がある
（`path`→`node:path` 等。`express`/`serve-static`/`etag` などが bare で require する）。

### ③ `createRequire` バナーが必須
`iconv-lite`/`safer-buffer` が実行時に動的 `require("node:buffer")` を呼ぶ。
esbuild では静的解決できないため、バナーで `globalThis.require` を注入して回避する。

```js
import { createRequire as __cr } from "node:module";
const require = __cr("file:///");
globalThis.require = globalThis.require || require;
```

### ④ workerd の `ServerResponse.assignSocket` は未実装
`Error [ERR_METHOD_NOT_IMPLEMENTED]`。
`res.write` / `res.end` を差し替えて出力を横取りする方式にする（reference 実装済み）。

### ⑤ **最重要**: `req.socket.readable = true` が無いとボディが常に空になる
`body-parser` → `on-finished` の `isFinished()`（`on-finished/index.js:76`）が
`!socket.readable` を見て「もう読み終わった」と誤判定し、**エラーを出さず `next()` する**。
結果 `req.body` は `undefined` のまま、**HTTP 200 が返る**。

→ 全 POST が無言で壊れる。テストで気づきにくいので要注意。
   `req.complete = true` を立てるのも同じ理由で NG。

## 未検証（Phase 4-6 で確認すること）

- 106ビュー全部のプリコンパイル（原理検証は1ファイルのみ）
- `include()` の相対パス解決（`../partials/` と `./partials/` が混在）
- `express.static` → Workers Assets 置き換え
- 実DB（Supabase）接続・OpenAI・LINE 呼び出し
- Cron Trigger からの `cronDispatchService.dispatch()` 発火
- バンドルサイズ（スパイクで既に 1.1MB。Workers 無料枠の上限は圧縮後 3MB）
