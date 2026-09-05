/**
 * compiledViewGlobals.test.ts
 *
 * scripts/compileViews.mjs は `_with:false` でコンパイルした本体の先頭に
 * `const { a, b, ... } = (locals || {})` を差し込む。差し込む名前はテンプレートが
 * 参照している識別子をソースから機械的に拾って決めている。
 *
 * このとき **グローバル組み込みまで拾ってしまうと undefined で潰れる**。
 * 実際に URLSearchParams がこれで潰れ、本番の /admin/points と
 * /admin/post-analysis が `URLSearchParams2 is not a constructor` で全滅した
 * （esbuild が衝突回避で URLSearchParams → URLSearchParams2 にリネームするため
 *  エラー文の名前が別物に見え、原因が分かりにくい）。
 *
 * ここでは生成物 _compiled.ts を直接読み、
 * 「locals から取り出している名前」と「グローバルとして呼ばれている名前」が
 * 衝突していないことを見る。DB にも実行環境にも触らない。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

const COMPILED = path.join(process.cwd(), "src", "views", "_compiled.ts");

/** ビューごとの { key, 分割代入している名前 } を生成物から読み出す */
function readDestructuredNames(): Array<{ key: string; names: string[] }> {
  const source = fs.readFileSync(COMPILED, "utf8");
  const lines = source.split("\n");
  const out: Array<{ key: string; names: string[] }> = [];
  let currentKey: string | null = null;

  for (const line of lines) {
    const keyMatch = line.match(/^ {2}"([^"]+)": function \(locals/);
    if (keyMatch) currentKey = keyMatch[1] ?? null;

    const destructureMatch = line.match(/const \{ ([^}]*) \} = \(locals \|\| \{\}\);/);
    if (destructureMatch && currentKey) {
      const names = destructureMatch[1]!
        .split(",")
        .map((n) => n.trim())
        .filter(Boolean);
      out.push({ key: currentKey, names });
    }
  }
  return out;
}

test("_compiled.ts が生成されている", () => {
  assert.ok(fs.existsSync(COMPILED), "src/views/_compiled.ts がない。npm run build:views を先に実行する");
  const views = readDestructuredNames();
  assert.ok(views.length > 0, "分割代入を含むビューが1件も読み取れていない（生成物の形が変わった可能性）");
});

test("locals の分割代入がグローバル組み込みを潰していない", () => {
  const views = readDestructuredNames();
  const source = fs.readFileSync(COMPILED, "utf8");

  const collisions: string[] = [];
  for (const { key, names } of views) {
    for (const name of names) {
      // globalThis に同名が実在する = テンプレートがグローバルとして呼びうる名前
      if (!(name in globalThis)) continue;

      // ただし「グローバル名と同名の locals」は正当にありうる（events / global など）。
      // 誤検知を避けるため、その名前が実際に new/呼び出しに使われている場合だけ落とす。
      const escaped = name.replace(/[^A-Za-z0-9_$]/g, (ch) => "\\" + ch);
      const pattern = "new\\s+" + escaped + "\\d*\\s*\\(|(?<![.\\w$])" + escaped + "\\d*\\s*\\(";
      const usedAsGlobal = new RegExp(pattern).test(source);
      if (usedAsGlobal) collisions.push(`${key} :: ${name}`);
    }
  }

  assert.deepEqual(
    collisions,
    [],
    "グローバル組み込みが locals の分割代入で undefined に潰されている。" +
      " scripts/compileViews.mjs の RESERVED に該当名を追加すること:\n  " +
      collisions.join("\n  ")
  );
});

test("URLSearchParams が locals から取り出されていない（既知の再発ポイント）", () => {
  const views = readDestructuredNames();
  const bad = views.filter((v) => v.names.includes("URLSearchParams") || v.names.includes("URL"));
  assert.deepEqual(
    bad.map((v) => v.key),
    [],
    "URL / URLSearchParams はグローバルなので locals から取ってはいけない"
  );
});
