/**
 * 隔離検証用の env を作る。
 * - Supabase は必ずローカル(54621)。本番(qdswfa…)を絶対に指さない。
 * - 外部送信（LINE push / ポータル）はダミーに置き換える。
 * - それ以外（LIFF ID・ADMIN ハッシュ・PARTNER キー等）は挙動を変えないよう温存する。
 */
import fs from "node:fs";

const SRC = "C:/work/ai-chat-interview/.env";
const OUT = "C:/work/ai-chat-interview/.env.tmverify";

const LOCAL_URL = "http://127.0.0.1:54621";
const LOCAL_SERVICE_ROLE =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const LOCAL_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const OVERRIDE = {
  PORT: "3101",                                   // 本番検証用 3100 と分ける
  NODE_ENV: "development",
  SUPABASE_URL: LOCAL_URL,
  SUPABASE_SERVICE_ROLE_KEY: LOCAL_SERVICE_ROLE,
  SUPABASE_ANON_KEY: LOCAL_ANON,
  SUPABASE_SERVICE_KEY: LOCAL_SERVICE_ROLE,
  APP_BASE_URL: "http://localhost:3101",
  // 外部送信の無効化
  LINE_CHANNEL_ACCESS_TOKEN: "tm-isolated-dummy-token-do-not-send",
  LINE_CHANNEL_SECRET: "tm-isolated-dummy-secret",
  PORTAL_OPS_URL: "http://127.0.0.1:9/disabled",
  // 隔離環境では検証しやすいよう固定
  PARTNER_API_KEY: "tmverify-partner-key-0123456789abcdef0123456789abcdef",
  PARTNER_ADMIN_API_KEY: "tmverify-admin-key-0123456789abcdef0123456789abcdef",
  PARTNER_IMAGE_URL_ALLOWED_HOSTS: "portal.example.com,portal-staging.example.com",
  // Management API / mental 系も本番を指さないよう潰す（隔離環境では使わない）
  SUPABASE_PROJECT_REF: "tmverify-local",
  SUPABASE_ACCESS_TOKEN: "tmverify-disabled",
  SUPABASE_URL_mental: "http://127.0.0.1:9/disabled",
  SUPABASE_SERVICE_ROLE_KEY_mental: "tmverify-disabled",
  SUPABASE_PROJECT_REF_mental: "tmverify-local",
  SUPABASE_ACCESS_TOKEN_mental: "tmverify-disabled",
};

const lines = fs.readFileSync(SRC, "utf8").split(/\r?\n/);
const seen = new Set();
const out = [];
for (const line of lines) {
  const m = /^([A-Za-z0-9_]+)=(.*)$/.exec(line);
  if (!m) { out.push(line); continue; }
  const [, k] = m;
  if (k in OVERRIDE) { out.push(`${k}=${OVERRIDE[k]}`); seen.add(k); }
  else out.push(line);
}
for (const [k, v] of Object.entries(OVERRIDE)) if (!seen.has(k)) out.push(`${k}=${v}`);

const text = out.join("\n");
// 安全確認: 本番 Supabase ref が残っていないこと
if (/qdswfa|hfjyoc/i.test(text)) {
  const bad = text.split(/\n/).filter((l) => /qdswfa|hfjyoc/i.test(l)).map((l) => l.split("=")[0]);
  throw new Error(`本番 Supabase 参照が残っている: ${bad.join(", ")}`);
}
fs.writeFileSync(OUT, text);
console.log("wrote", OUT);
console.log("SUPABASE_URL =", /^SUPABASE_URL=(.*)$/m.exec(text)[1]);
console.log("PORT =", /^PORT=(.*)$/m.exec(text)[1]);
console.log("本番参照: なし");
