/**
 * src/public の静的ファイルをビルド時にモジュールへ埋め込む。
 *
 * なぜ必要か:
 *   express.static は FS からファイルを読む。Cloudflare Workers には FS が無いため、
 *   そのままでは /public/* が 404 になる。
 *
 * 方式:
 *   テキスト資産（css/js）はそのまま文字列、バイナリは base64 で埋め込む。
 *   現状 6ファイル・約180KB でバンドル上限（圧縮後3MB）に対して十分小さい。
 *   将来ここが肥大化したら Workers Assets バインディングへ移すこと。
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, extname } from "node:path";

const ROOT = process.cwd();
const PUBLIC_DIR = join(ROOT, "src", "public");
const OUT_FILE = join(ROOT, "src", "public", "_compiled.ts");

const TEXT_EXT = new Set([".css", ".js", ".mjs", ".svg", ".txt", ".json", ".map"]);
const MIME = {
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function walk(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (!name.startsWith("_compiled")) acc.push(full);
  }
  return acc;
}

const files = walk(PUBLIC_DIR).sort();
const entries = [];

for (const file of files) {
  const key = relative(PUBLIC_DIR, file).split("\\").join("/");
  const ext = extname(file).toLowerCase();
  const isText = TEXT_EXT.has(ext);
  const buf = readFileSync(file);
  entries.push({
    key,
    type: MIME[ext] ?? "application/octet-stream",
    encoding: isText ? "utf8" : "base64",
    body: isText ? buf.toString("utf8") : buf.toString("base64"),
    bytes: buf.length,
  });
}

const total = entries.reduce((n, e) => n + e.bytes, 0);

const out = `// 自動生成: scripts/compileAssets.mjs — 直接編集しないこと
// 生成元: src/public/**（${entries.length} ファイル・${total} bytes）
/* eslint-disable */
// biome-ignore-all

export interface CompiledAsset {
  type: string;
  encoding: "utf8" | "base64";
  body: string;
}

export const COMPILED_ASSETS: Record<string, CompiledAsset> = {
${entries
  .map(
    (e) =>
      `  ${JSON.stringify(e.key)}: { type: ${JSON.stringify(e.type)}, encoding: ${JSON.stringify(
        e.encoding
      )}, body: ${JSON.stringify(e.body)} }`
  )
  .join(",\n")}
};
`;

writeFileSync(OUT_FILE, out, "utf8");
console.log(
  `[compileAssets] embedded ${entries.length} files (${total} bytes) -> ${relative(ROOT, OUT_FILE)}`
);
