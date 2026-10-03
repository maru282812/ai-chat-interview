/**
 * 隔離環境でアプリを起動する。
 *
 * env.ts の loadDotEnv() は .env（＝本番 Supabase）をハードコードで読む。
 * dotenv は既に設定済みの process.env を上書きしないので、ここで .env.tmverify を
 * **先に** process.env へ入れてから子プロセスに渡す（.env の値は負ける）。
 *
 * 起動前に接続先が本番でないことを検査し、本番なら起動しない。
 */
import { spawn } from "node:child_process";
import fs from "node:fs";

const ROOT = "C:/work/ai-chat-interview";
const OUT_DIR = `${ROOT}/.tmverify`;
fs.mkdirSync(OUT_DIR, { recursive: true });
const ENV_FILE = `${ROOT}/.env.tmverify`;

const env = { ...process.env };
for (const line of fs.readFileSync(ENV_FILE, "utf8").split(/\r?\n/)) {
  const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(line);
  if (m) env[m[1]] = m[2];
}

// 安全ゲート
const url = env.SUPABASE_URL ?? "";
if (!/^http:\/\/127\.0\.0\.1:54621/.test(url)) {
  throw new Error(`SUPABASE_URL がローカルでない: ${url}`);
}
for (const [k, v] of Object.entries(env)) {
  if (/^SUPABASE/i.test(k) && /qdswfa|hfjyoc/i.test(String(v))) {
    throw new Error(`本番参照が残っている: ${k}`);
  }
}
if (!/dummy|disabled/i.test(env.LINE_CHANNEL_ACCESS_TOKEN ?? "")) {
  throw new Error("LINE トークンが無効化されていない");
}
console.log("safety ok: SUPABASE_URL =", url, "/ PORT =", env.PORT);

const out = fs.openSync(
  `${OUT_DIR}/iso.log`,
  "w"
);
const child = spawn("npx", ["tsx", "src/server.ts"], {
  cwd: ROOT, env, detached: true, stdio: ["ignore", out, out], shell: true,
});
child.unref();
console.log("spawned pid", child.pid);
