/**
 * runTests.mjs — src/tests/*.test.ts を1本ずつ逐次実行する。
 *
 * なぜ逐次か: 各スイートは同じ検証用フィクスチャ名や環境変数を掴むため、
 * 並列（node --test の一括実行や tsx の同時起動）だと互いに干渉して
 * 実際には健全なスイートが落ちる「偽陽性」が出る。1本ずつなら再現性がある。
 *
 * 使い方:
 *   node scripts/runTests.mjs           # 全スイート
 *   node scripts/runTests.mjs store     # 名前に "store" を含むスイートだけ
 */

import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const TESTS_DIR = path.join(process.cwd(), "src", "tests");
const filter = process.argv[2] ?? null;

const suites = readdirSync(TESTS_DIR)
  .filter((file) => file.endsWith(".test.ts"))
  .map((file) => file.replace(/\.test\.ts$/, ""))
  .filter((name) => (filter ? name.toLowerCase().includes(filter.toLowerCase()) : true))
  .sort();

if (suites.length === 0) {
  console.error(filter ? `該当するスイートがありません: ${filter}` : "テストが見つかりません");
  process.exit(1);
}

const failed = [];
const started = Date.now();

for (const [index, name] of suites.entries()) {
  const label = `[${String(index + 1).padStart(2, " ")}/${suites.length}] ${name}`;
  // tsx の実行ファイルを直接叩く（npx 経由 + shell:true は引数エスケープの警告が出る）。
  const result = spawnSync(
    process.execPath,
    [path.join("node_modules", "tsx", "dist", "cli.mjs"), path.join("src", "tests", `${name}.test.ts`)],
    { encoding: "utf8" }
  );

  if (result.status === 0) {
    console.log(`${label} ✔`);
  } else {
    console.log(`${label} ✘`);
    failed.push({ name, output: `${result.stdout ?? ""}${result.stderr ?? ""}` });
  }
}

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
console.log(`\n${suites.length - failed.length}/${suites.length} passed (${elapsed}s)`);

if (failed.length > 0) {
  for (const { name, output } of failed) {
    console.log(`\n--- ${name} ---`);
    console.log(output.split("\n").slice(-25).join("\n"));
  }
  process.exit(1);
}
