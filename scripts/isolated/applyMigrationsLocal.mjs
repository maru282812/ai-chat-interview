/**
 * ローカル隔離DBへ migrations を流す（docs/isolated-verify-env.md）。
 *
 * 本番向けの `npm run db:migrate` は Supabase Management API を使うので
 * ローカルDBには向けられない（project ref を URL から作るため 400 になる）。
 * ローカルは DB コンテナの psql へ直接流す。適用はファイル名順そのまま。
 *
 * ⚠ Supabase CLI の `supabase start` / `db reset` に migration を任せていない
 *   （config.toml の [db.migrations] enabled = false）。理由は
 *   **067 が2本ある**こと（067_document_usage_category / 067_respondent_test_flag）。
 *   CLI は supabase_migrations.schema_migrations をファイル名のバージョン部分で
 *   主キーにするため、2本目で duplicate key になって止まる。
 *   このプロジェクトの正準は filename 主キーの `_app_migrations`（applyMigrations.mjs）
 *   なので 067 が2本でも問題なく、CLI 側の制約に合わせて番号を振り直すと
 *   `_app_migrations` 側が「未適用」と見なして再実行事故になる。よって触らない。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = "C:/work/ai-chat-interview";
const OUT_DIR = `${ROOT}/.tmverify`;
fs.mkdirSync(OUT_DIR, { recursive: true });
const DIR = path.join(ROOT, "supabase/migrations");
const DB = "postgresql://postgres:postgres@127.0.0.1:54622/postgres";

// ファイル名順にそのまま流す。
// 034 は 035 が入れる attr_key を参照していたが、034 自身に同じ
// ON CONFLICT 付き INSERT を持たせて自己完結させたので、並べ替えは不要になった。
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

const failures = [];
let applied = 0;
for (const f of files) {
  try {
    execFileSync("docker", ["exec", "-i", "supabase_db_ai-chat-interview", "psql", "postgresql://postgres:postgres@127.0.0.1:5432/postgres", "-v", "ON_ERROR_STOP=1", "-q", "-f", "-"], { input: fs.readFileSync(path.join(DIR, f)),
      encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 300000,
    });
    applied++;
  } catch (e) {
    const err = `${e.stdout ?? ""}\n${e.stderr ?? ""}`.split(/\r?\n/).filter((l) => /ERROR|DETAIL|HINT/.test(l)).slice(0, 4).join(" | ");
    failures.push({ file: f, err });
    console.log(`FAIL ${f}: ${err.slice(0, 220)}`);
  }
}
console.log(`\napplied ${applied}/${files.length} / failures ${failures.length}`);
fs.writeFileSync(
  `${OUT_DIR}/applyResult.json`,
  JSON.stringify({ applied, failures }, null, 1)
);
