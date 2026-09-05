/**
 * プリコンパイル済みビュー106件を全て「実際に描画してみる」検証。
 *
 * 目的: 構文エラー・include 解決漏れを本番前に潰す。
 * テンプレートは locals に何を要求するか個別に違うため、未定義変数による
 * ReferenceError は「データ不足」として区別して数える（描画経路自体の失敗ではない）。
 */
import { COMPILED_VIEWS } from "file:///c:/work/ai-chat-interview/dist/views/_compiled.js";
import { renderCompiled } from "file:///c:/work/ai-chat-interview/dist/lib/compiledViews.js";

const keys = Object.keys(COMPILED_VIEWS).sort();
const results = { ok: [], missingData: [], includeError: [], shadowedGlobal: [], other: [] };

for (const key of keys) {
  try {
    renderCompiled(key, { title: "t", locals: {} });
    results.ok.push(key);
  } catch (e) {
    const msg = String(e.message || e);
    if (/compiled view not found/.test(msg)) results.includeError.push(`${key} :: ${msg}`);
    // 「グローバル組み込みが locals の分割代入で潰された」型のバグは
    // locals 不足では絶対に起きない＝データを渡せば直る類ではないので、
    // missingData に混ぜず必ず要修正として立てる。
    // （URLSearchParams がこれで潰れ、/admin/points と /admin/post-analysis が
    //   `URLSearchParams2 is not a constructor` で本番全滅した。従来はこの文言が
    //   どの分類にも引っかからず other 扱いで、exit code も 0 のまま素通りしていた。）
    else if (/is not a constructor|is not a function/.test(msg)) results.shadowedGlobal.push(`${key} :: ${msg}`);
    else if (/is not defined|Cannot read propert|undefined/.test(msg)) results.missingData.push(key);
    else results.other.push(`${key} :: ${msg}`);
  }
}

console.log(`total views      : ${keys.length}`);
console.log(`rendered OK      : ${results.ok.length}`);
console.log(`needs data       : ${results.missingData.length}  (テンプレが locals を要求。描画経路は健全)`);
console.log(`INCLUDE ERRORS   : ${results.includeError.length}  <-- 要修正`);
console.log(`SHADOWED GLOBALS : ${results.shadowedGlobal.length}  <-- 要修正（compileViews.mjs の RESERVED 漏れ）`);
console.log(`other errors     : ${results.other.length}`);

if (results.includeError.length) {
  console.log("\n--- include 解決失敗 ---");
  for (const r of results.includeError) console.log("  " + r);
}
if (results.other.length) {
  console.log("\n--- その他エラー（先頭20件） ---");
  for (const r of results.other.slice(0, 20)) console.log("  " + r);
}

if (results.shadowedGlobal.length) {
  console.log("\n--- グローバル組み込みが locals に潰されている ---");
  for (const r of results.shadowedGlobal) console.log("  " + r);
}

process.exit(results.includeError.length + results.shadowedGlobal.length > 0 ? 1 : 0);
