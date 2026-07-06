// Supabase マイグレーション適用ランナー（Management API 経由）
//   - supabase/migrations/*.sql を番号順に適用する
//   - 適用済みは _app_migrations テーブルで管理（再実行で二重適用しない）
//   - 初回実行時、BASELINE 以下の番号は「適用済み」として記録のみ（実行しない）
//     （既存DBは 001〜066 を手動/統合スキーマで適用済みのため）
//   - 接続は .env の SUPABASE_ACCESS_TOKEN（Management API）＋ SUPABASE_URL のサブドメイン=ref
//     DBパスワード不要。ダッシュボードSQLエディタと同じ /database/query を使う。
//
// 使い方: node scripts/applyMigrations.mjs
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";

const BASELINE = 66;
const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "supabase", "migrations");

const token = (process.env.SUPABASE_ACCESS_TOKEN || "").trim();
const ref = (() => {
  try {
    return new URL(process.env.SUPABASE_URL).hostname.split(".")[0];
  } catch {
    return (process.env.SUPABASE_PROJECT_REF || "").trim();
  }
})();
if (!token || !ref) {
  console.error("SUPABASE_ACCESS_TOKEN / SUPABASE_URL が必要です（.env）");
  process.exit(1);
}

const endpoint = `https://api.supabase.com/v1/projects/${ref}/database/query`;

async function runSql(query) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query })
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return res.json().catch(() => null);
}

function numberOf(filename) {
  const match = filename.match(/^(\d+)/);
  return match ? Number(match[1]) : Number.POSITIVE_INFINITY;
}

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort((a, b) => numberOf(a) - numberOf(b) || a.localeCompare(b));

  console.log(`project ref: ${ref}`);
  await runSql(
    "create table if not exists _app_migrations (filename text primary key, applied_at timestamptz not null default now())"
  );
  const existing = await runSql("select filename from _app_migrations");
  const applied = new Set((existing ?? []).map((row) => row.filename));
  const firstRun = applied.size === 0;
  if (firstRun) {
    console.log("(初回実行: ベースライン記録を行います)");
  }

  for (const file of files) {
    if (applied.has(file)) {
      continue;
    }
    if (firstRun && numberOf(file) <= BASELINE) {
      await runSql(`insert into _app_migrations(filename) values(${sqlString(file)}) on conflict do nothing`);
      console.log(`= baseline (記録のみ) ${file}`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    process.stdout.write(`→ applying ${file} ... `);
    try {
      await runSql(sql);
      await runSql(`insert into _app_migrations(filename) values(${sqlString(file)}) on conflict do nothing`);
      console.log("OK");
    } catch (error) {
      console.error(`FAILED\n   ${error.message}`);
      throw error;
    }
  }

  const final = await runSql("select filename from _app_migrations order by filename");
  console.log(`\n完了。適用済み ${final?.length ?? 0} 件（最新: ${final?.[final.length - 1]?.filename ?? "-"}）`);
}

main().catch((error) => {
  console.error("\nマイグレーション適用に失敗:", error.message);
  process.exit(1);
});
