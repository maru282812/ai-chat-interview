/**
 * ローカル隔離DBへ migrations を流す。
 *
 * 既知の問題: 034_notification_templates_seed.sql が daily_question_priorities に
 * attr_key='car_ownership' 等を insert するが、その attr_key を登録するのは
 * 035_attribute_definitions_daily_keys.sql。**依存順が逆**で、白紙からの再構築だと
 * FK 違反で落ちる（035 のコメント自身が「事前登録」と書いており、本来 034 より前）。
 * repo の migration は書き換えず、ここで適用順だけ入れ替える。
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ROOT = "C:/work/ai-chat-interview";
const OUT_DIR = `${ROOT}/.tmverify`;
fs.mkdirSync(OUT_DIR, { recursive: true });
const DIR = path.join(ROOT, "supabase/migrations");
const DB = "postgresql://postgres:postgres@127.0.0.1:54622/postgres";

let files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

// 依存順の入れ替え: 035 を 034 の前に出す
const i34 = files.indexOf("034_notification_templates_seed.sql");
const i35 = files.indexOf("035_attribute_definitions_daily_keys.sql");
if (i34 >= 0 && i35 >= 0 && i35 > i34) {
  files.splice(i35, 1);
  files.splice(i34, 0, "035_attribute_definitions_daily_keys.sql");
  console.log("順序入れ替え: 035 を 034 の前に適用する");
}

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
