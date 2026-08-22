/**
 * 106個の EJS ビューをビルド時にコンパイルし、単一モジュールへ埋め込む。
 *
 * なぜ必要か:
 *   実行時の EJS は `views` ディレクトリからテンプレートを **ファイルシステム経由で読む**。
 *   Cloudflare Workers には FS が無いため、そのままでは全画面が動かない。
 *
 * 方式（Phase 0 で実証済み・docs/spike-workers/RESULTS.md）:
 *   ejs.compile(src, { client: true }) が返す関数のソースを **文字列として埋め込み**、
 *   実行時に評価して関数へ戻す。
 *
 *   `client:true` の既定出力は `with (locals || {})` を含む。ESM では with が使えず
 *   esbuild が弾くため、関数ソースを文字列で持ち、実行時に new Function で組み立てる。
 *   こうすると **既存106ビューを1行も書き換えずに済む**（`_with:false` にすると
 *   テンプレ内の `title` が束縛されず ReferenceError になる）。
 *
 * include の解決:
 *   ejs のコンパイル済み関数は include を第3引数の関数として受け取る。
 *   ビュー名は「views ルートからの相対パス（拡張子なし・POSIX区切り）」に正規化し、
 *   実行時に同じ辞書から引く。
 */
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import ejs from "ejs";

const ROOT = process.cwd();
const VIEWS_DIR = join(ROOT, "src", "views");
const OUT_FILE = join(ROOT, "src", "views", "_compiled.ts");

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (name.endsWith(".ejs")) acc.push(full);
  }
  return acc;
}

/** views ルートからの相対キー（POSIX区切り・拡張子なし）に正規化する */
function toKey(absPath) {
  return relative(VIEWS_DIR, absPath).split("\\").join("/").replace(/\.ejs$/, "");
}

const files = walk(VIEWS_DIR).sort();
const entries = [];
let failed = 0;

for (const file of files) {
  const key = toKey(file);
  const src = readFileSync(file, "utf8");
  try {
    // filename を渡すと ejs が include のパス解決に使うが、client:true では
    // 実行時に include 関数へ委譲されるため、ここではコンパイルが通ればよい。
    const fn = ejs.compile(src, {
      client: true,
      compileDebug: false,
      filename: file,
      rmWhitespace: false,
    });
    entries.push({ key, source: fn.toString() });
  } catch (e) {
    failed++;
    console.error(`[compileViews] FAILED ${key}: ${e.message}`);
  }
}

if (failed > 0) {
  console.error(`[compileViews] ${failed} view(s) failed to compile`);
  process.exit(1);
}

const banner = `// 自動生成: scripts/compileViews.mjs — 直接編集しないこと
// 生成元: src/views/**/*.ejs（${entries.length} ファイル）
/* eslint-disable */
// biome-ignore-all

/** コンパイル済みテンプレートのソース（キー = views からの相対パス・拡張子なし） */
export const COMPILED_VIEW_SOURCES: Record<string, string> = {
`;

const body = entries
  .map((e) => `  ${JSON.stringify(e.key)}: ${JSON.stringify(e.source)}`)
  .join(",\n");

const footer = `
};

export const COMPILED_VIEW_COUNT = ${entries.length};
`;

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, banner + body + footer, "utf8");
console.log(`[compileViews] compiled ${entries.length} views -> ${relative(ROOT, OUT_FILE)}`);
