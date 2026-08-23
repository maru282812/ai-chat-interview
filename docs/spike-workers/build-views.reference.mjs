// Phase 2 で使うプリコンパイル方式の原理検証。
// EJS を「実行時にFSから読む」のではなく「ビルド時に関数へコンパイルして埋め込む」。
//
// 重要な発見: client:true の既定出力は `with (locals || {})` を使うが、
// ESM では with 文が禁止されているため esbuild が弾く。
// `_with: false` + `localsName: "locals"` にすると with を使わない出力になる。
// ただしテンプレート側は `locals.title` ではなく `title` と書けなくなる…ではなく、
// EJS が locals.<name> へ自動展開するのは with 経由のみなので、
// _with:false の場合はテンプレ内で `locals.title` と書く必要がある。
// → 既存106ビューを書き換えずに済ませるため、コンパイル前に
//    「関数の引数で分割代入する」ラッパを噛ませる方式を検証する。
import ejs from "ejs";
import { writeFileSync } from "node:fs";

const source = `<h1><%= title %></h1>
<ul>
<% items.forEach(function(it){ %>
  <li><%= it %></li>
<% }); %>
</ul>`;

// 方式A: _with:false のみ（テンプレ側の書き換えが要る想定）
let variantA = null;
try {
  const fnA = ejs.compile(source, {
    client: true,
    compileDebug: false,
    _with: false,
    localsName: "locals",
  });
  variantA = fnA.toString();
} catch (e) {
  console.log("variantA failed:", String(e));
}

// 方式B: with を使う出力を、非ESM(CJS風)の Function コンストラクタで包む。
// esbuild の ESM 制約を回避しつつ既存テンプレを無改修で使えるか検証。
const fnB = ejs.compile(source, { client: true, compileDebug: false });
const bodyB = fnB.toString();

const out = `// 自動生成: build-views.mjs
// --- 方式A: _with:false ---
export const compiledA = ${variantA ?? "null"};

// --- 方式B: with を Function コンストラクタ経由で生成（ESM制約を回避）---
const _srcB = ${JSON.stringify(bodyB)};
export const compiledB = (0, eval)("(" + _srcB + ")");
`;

writeFileSync(new URL("./src/compiled-view.js", import.meta.url), out, "utf8");
console.log("compiled view written");
console.log("variantA available:", Boolean(variantA));
