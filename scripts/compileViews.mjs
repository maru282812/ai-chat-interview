/**
 * 106個の EJS ビューをビルド時にコンパイルし、単一モジュールへ埋め込む。
 *
 * なぜ必要か:
 *   実行時の EJS は views ディレクトリからテンプレートを **ファイルシステム経由で読む**。
 *   Cloudflare Workers には FS が無いため、そのままでは全画面が動かない。
 *
 * ## なぜ「関数ソースを文字列で持って実行時に評価」ではダメか
 *
 * Phase 0 のスパイクでは `with (locals||{})` を含む関数ソースを文字列で埋め込み、
 * 実行時に new Function で組み立てる方式を採った。ローカルの workerd では動いたが、
 * **本番同等の実行では `EvalError: Code generation from strings disallowed`** になる。
 * Workers は eval / new Function を禁止している。
 *
 * したがって「ビルド時に本物の関数へ」しなければならない。
 * しかし ESM では `with` 文が使えない（esbuild が
 * "With statements cannot be used with the esm output format" で弾く）。
 *
 * ## 採用した方式
 *
 * `_with: false` でコンパイルすると with を使わない出力になる。
 * ただしテンプレート内の変数参照は `title` のような**裸の識別子のまま**なので、
 * そのままでは ReferenceError になる。
 *
 * そこで関数本体の先頭に「locals からの分割代入」を差し込む。
 * 差し込む変数名は、テンプレートが実際に参照している識別子を
 * コンパイル済みソースから抽出して決める。
 *
 *   function (locals, escapeFn, include, rethrow) {
 *     const { title, items, ... } = locals || {};   // ← これを足す
 *     ...元の本体...
 *   }
 *
 * これにより **既存106ビューを1行も書き換えずに** Workers で動く。
 */
import { readdirSync, statSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import ejs from "ejs";

const ROOT = process.cwd();
const VIEWS_DIR = join(ROOT, "src", "views");
const OUT_FILE = join(ROOT, "src", "views", "_compiled.ts");

/** 分割代入に含めてはいけない名前（関数引数・JS予約語・グローバル） */
const RESERVED = new Set([
  "locals", "escapeFn", "include", "rethrow",
  "__output", "__append", "__line", "_ENCODE_HTML_RULES", "_MATCH_HTML", "encode_char",
  "var", "let", "const", "function", "return", "if", "else", "for", "while", "do",
  "switch", "case", "break", "continue", "new", "delete", "typeof", "instanceof",
  "in", "of", "this", "null", "undefined", "true", "false", "try", "catch", "finally",
  "throw", "class", "extends", "super", "yield", "await", "async", "void",
  "Object", "Array", "String", "Number", "Boolean", "Math", "JSON", "Date", "RegExp",
  "Map", "Set", "Promise", "Error", "console", "parseInt", "parseFloat", "isNaN",
  "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI", "Intl",
  "globalThis", "Symbol", "BigInt", "structuredClone",
  // strict モードの予約語。束縛名にできないので分割代入に入れてはいけない
  // （EJS テンプレに `public` という locals があり、実際に SyntaxError を踏んだ）。
  "implements", "interface", "package", "private", "protected", "public", "static",
  "arguments", "eval",
]);

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

/**
 * コンパイル済み本体から「locals から取るべき識別子」を集める。
 *
 * 文字列リテラル（__append("...") の中身）を除いたうえで識別子を拾い、
 * 予約語・ローカル宣言済みの名前を除外する。
 * 余分に拾っても `const { x } = locals||{}` が undefined になるだけで害はない
 * （テンプレートが未定義変数を参照したときの挙動は with と同じ ReferenceError ではなく
 *  undefined になるが、EJS の locals 参照としてはむしろ安全側）。
 */
function collectLocalNames(body) {
  // 文字列リテラルを除去（雑だが、識別子抽出の精度を上げるには十分）
  const withoutStrings = body
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

  // 本体内で宣言されているローカル変数は除外する
  const declared = new Set();
  for (const m of withoutStrings.matchAll(/\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(m[1]);
  }
  for (const m of withoutStrings.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)/g)) {
    declared.add(m[1]);
  }
  // for (const x of ...) / catch (e) / 関数の仮引数など
  for (const m of withoutStrings.matchAll(/\bfor\s*\(\s*(?:var|let|const)\s*\[?\s*([\w$,\s]+?)\s*\]?\s*(?:of|in)\b/g)) {
    for (const n of m[1].split(",")) declared.add(n.trim());
  }
  for (const m of withoutStrings.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) {
    declared.add(m[1]);
  }
  for (const m of withoutStrings.matchAll(/\bfunction\s*\(([^)]*)\)/g)) {
    for (const n of m[1].split(",")) {
      const t = n.trim();
      if (t) declared.add(t);
    }
  }
  // アロー関数の仮引数 (a, b) => / a =>
  for (const m of withoutStrings.matchAll(/\(([^()]*)\)\s*=>/g)) {
    for (const n of m[1].split(",")) {
      const t = n.trim();
      if (t && /^[A-Za-z_$][\w$]*$/.test(t)) declared.add(t);
    }
  }
  for (const m of withoutStrings.matchAll(/\b([A-Za-z_$][\w$]*)\s*=>/g)) {
    declared.add(m[1]);
  }
  // 分割代入 const { a, b } = ... / const [a, b] = ...
  for (const m of withoutStrings.matchAll(/\b(?:var|let|const)\s*[{[]([^}\]]*)[}\]]/g)) {
    for (const n of m[1].split(",")) {
      const t = n.trim().split(":").pop().trim();
      if (t) declared.add(t);
    }
  }

  const names = new Set();
  for (const m of withoutStrings.matchAll(/(^|[^.\w$])([A-Za-z_$][\w$]*)/g)) {
    const name = m[2];
    if (RESERVED.has(name) || declared.has(name)) continue;
    // オブジェクトのキー（{ foo: ... }）や関数呼び出し直後は拾わない方が安全だが、
    // 余分に拾っても undefined になるだけなので許容する
    names.add(name);
  }
  return [...names].filter(isBindableIdentifier).sort();
}

/** 束縛名として使える識別子か（予約語や非識別子を弾く最終ゲート） */
function isBindableIdentifier(name) {
  if (!/^[A-Za-z_$][\w$]*$/.test(name)) return false;
  try {
    // 実際に束縛してみるのが最も確実
    new Function(`const { ${name} } = {};`);
    return true;
  } catch {
    return false;
  }
}

const files = walk(VIEWS_DIR).sort();
const entries = [];
let failed = 0;

for (const file of files) {
  const key = toKey(file);
  const src = readFileSync(file, "utf8");
  try {
    const fn = ejs.compile(src, {
      client: true,
      compileDebug: false,
      filename: file,
      _with: false,
      localsName: "locals",
    });
    const source = fn.toString();

    const bodyStart = source.indexOf("{");
    const bodyEnd = source.lastIndexOf("}");
    if (bodyStart < 0 || bodyEnd <= bodyStart) {
      throw new Error("could not locate function body");
    }
    const body = source.slice(bodyStart + 1, bodyEnd);

    if (/\bwith\s*\(/.test(body)) {
      throw new Error("compiled output still contains a with statement");
    }

    const names = collectLocalNames(body);
    const preamble = names.length
      ? `  const { ${names.join(", ")} } = (locals || {});\n`
      : "";

    entries.push({
      key,
      fnSource: `function (locals, escapeFn, include, rethrow) {\n${preamble}${body}}`,
    });
  } catch (e) {
    failed++;
    console.error(`[compileViews] FAILED ${key}: ${e.message}`);
  }
}

if (failed > 0) {
  console.error(`[compileViews] ${failed} view(s) failed to compile`);
  process.exit(1);
}

const out = `// @ts-nocheck
// 自動生成: scripts/compileViews.mjs — 直接編集しないこと
//
// テンプレート本文は EJS が生成した JS をそのまま埋めているため、
// tsconfig の strict / noUncheckedIndexedAccess は満たせない（満たす必要もない）。
// 型検査は呼び出し側（src/lib/compiledViews.ts）の CompiledTemplate 型で担保する。
// 生成元: src/views/**/*.ejs（${entries.length} ファイル）
/* eslint-disable */
// biome-ignore-all

export type CompiledTemplate = (
  locals: Record<string, unknown>,
  escapeFn: (markup: unknown) => string,
  include: (path: string, data?: Record<string, unknown>) => string,
  rethrow?: unknown
) => string;

/**
 * コンパイル済みテンプレート（キー = views からの相対パス・拡張子なし）。
 * Workers は eval / new Function を禁止しているため、文字列ではなく
 * **本物の関数**として埋め込んでいる。
 */
export const COMPILED_VIEWS: Record<string, CompiledTemplate> = {
${entries.map((e) => `  ${JSON.stringify(e.key)}: ${e.fnSource} as CompiledTemplate`).join(",\n")}
};

export const COMPILED_VIEW_COUNT = ${entries.length};
`;

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, out, "utf8");
console.log(`[compileViews] compiled ${entries.length} views -> ${relative(ROOT, OUT_FILE)}`);
