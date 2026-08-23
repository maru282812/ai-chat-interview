/**
 * Cloudflare Workers 用バンドルを作る。
 *
 * Phase 0 の実測で判明した設定をここに固めている（docs/spike-workers/RESULTS.md）。
 * 素の esbuild 設定では workerd が起動しないので、下記3点は外さないこと。
 *
 *  1. platform=browser + conditions=workerd,worker,browser
 *     platform=node にすると require が動的のまま残り
 *     `Dynamic require of "tty" is not supported` で起動不能になる。
 *
 *  2. bare 指定の Node 組み込みを node: 付きへ alias
 *     express / serve-static / etag などが `require('path')` の形で書いており、
 *     platform=browser では解決できない。
 *
 *  3. createRequire バナー
 *     iconv-lite / safer-buffer が実行時に動的 require を呼ぶ。
 *     静的解決できないため globalThis.require を注入して逃がす。
 */
import { build } from "esbuild";
import { rmSync, mkdirSync } from "node:fs";

const NODE_BUILTINS = [
  "path", "url", "crypto", "stream", "buffer", "util", "events", "fs", "os",
  "zlib", "querystring", "string_decoder", "tty", "net", "http", "https",
  "assert", "async_hooks", "child_process", "dns", "module", "process",
  "timers", "constants", "punycode", "v8", "worker_threads",
];

const alias = Object.fromEntries(NODE_BUILTINS.map((m) => [m, `node:${m}`]));

// node-cron は子プロセス起動用に __dirname を評価するため Workers で import できない。
// 常駐スケジューラは Workers では起動しない（Cron Trigger が定期実行を担う）ので
// 空実装へ差し替える。詳細は workers/shims/node-cron.ts。
alias["node-cron"] = "./workers/shims/node-cron.ts";

const BANNER = `import { createRequire as __workersCreateRequire } from "node:module";
const require = __workersCreateRequire("file:///");
globalThis.require = globalThis.require || require;`;

rmSync("dist-workers", { recursive: true, force: true });
mkdirSync("dist-workers", { recursive: true });

const result = await build({
  entryPoints: ["workers/index.ts"],
  bundle: true,
  format: "esm",
  outfile: "dist-workers/index.js",
  platform: "browser",
  conditions: ["workerd", "worker", "browser"],
  target: "es2022",
  external: ["node:*", "cloudflare:*"],
  alias,
  banner: { js: BANNER },
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
  metafile: true,
});

const bytes = Object.values(result.metafile.outputs)[0]?.bytes ?? 0;
console.log(`[buildWorkers] bundle: ${(bytes / 1024 / 1024).toFixed(2)} MB (未圧縮)`);
if (bytes > 8 * 1024 * 1024) {
  console.warn("[buildWorkers] 警告: バンドルが大きい。Workers の上限は圧縮後 3MB。");
}
