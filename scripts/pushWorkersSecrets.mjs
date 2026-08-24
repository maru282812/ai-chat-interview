/**
 * .env の値を Cloudflare Workers へ投入する。
 *
 * GUI で1個ずつ入れると数が多くて事故りやすいのでスクリプト化した。
 *
 * ## 型の使い分け（重要）
 *
 * Cloudflare は**同じ名前の Text 変数と Secret を共存できない**。
 * GUI で Text として入れたものを `secret bulk` で入れようとすると
 * `Binding name '...' already in use` (code 10053) で**バッチ全体が失敗する**。
 *
 * そのため所在を1箇所に固定する:
 *   - 機密（鍵・トークン・ハッシュ）      → Secret（このスクリプトが投入）
 *   - 非機密（URL・ID・モデル名・フラグ） → wrangler.toml の [vars]（コード管理）
 *
 * [vars] へ入れる値は `--print-vars` で toml 断片として出力できる。
 *
 * 使い方:
 *   node scripts/pushWorkersSecrets.mjs --dry-run     # 投入対象を確認（値は伏せる）
 *   node scripts/pushWorkersSecrets.mjs --print-vars  # [vars] 用の toml を出力
 *   node scripts/pushWorkersSecrets.mjs               # Secret を実際に投入
 *
 * 認証は CLOUDFLARE_API_TOKEN 環境変数か `wrangler login`。
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/** Workers に入れない（ローカル / CLI 専用、または手動管理） */
const SKIP = new Set([
  "PORT",
  "SUPABASE_ACCESS_TOKEN",   // migration 適用用（Management API）
  "SUPABASE_DB_PASSWORD",    // 同上
  "SUPABASE_PROJECT_REF",    // 同上
  "APP_BASE_URL",            // 切り替え先で変わるので [vars] で手動管理
  "CRON_SECRET",             // cron 二重発火を防ぐため切り替え手順の中で設定
  // .env はローカル用なので development が入っている。
  // Workers 側は wrangler.toml の [vars] で production を指定しており、
  // ここで投入すると本番判定（Cookie の Secure 属性など）を壊す。
  "NODE_ENV",
]);

/** 非機密。secret ではなく wrangler.toml の [vars] で管理する */
const PLAINTEXT = new Set([
  "SUPABASE_URL",
  "DEFAULT_PROJECT_ID",
  "LINE_LIFF_CHANNEL_ID",
  "LINE_LIFF_ID_SURVEY",
  "LINE_LIFF_ID_MYPAGE",
  "LINE_LIFF_ID_CONTACT",
  "LINE_LIFF_ID_RANT",
  "LINE_LIFF_ID_DIARY",
  "LINE_LIFF_ID_PERSONALITY",
  "LIFF_AUTH_REQUIRED",
  "ALLOW_LIFF_AUTH_SKIP",
  "OPENAI_MODEL",
  "OPENAI_TOOL_MODEL",
  "SESSION_SUMMARY_INTERVAL",
  "MAX_AI_PROBES_PER_ANSWER",
  "MAX_AI_PROBES_PER_SESSION",
  "PARTNER_IMAGE_URL_ALLOWED_HOSTS",
  "PORTAL_OPS_URL",
  "CYCLE_TEST_LINE_USER_IDS",
  "MENU_ACTION_DEBUG_FORCE_PROJECT_LIST",
]);

const dryRun = process.argv.includes("--dry-run");
const printVars = process.argv.includes("--print-vars");

/** .env を読む */
const all = {};
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith("#") || !t.includes("=")) continue;
  const idx = t.indexOf("=");
  const k = t.slice(0, idx).trim();
  const v = t.slice(idx + 1).trim();
  if (!/^[A-Z][A-Z0-9_]*$/.test(k)) continue;
  if (v === "") continue;
  all[k] = v;
}

// [vars] 用の出力モード
if (printVars) {
  console.log("# wrangler.toml の [vars] セクションに貼る");
  for (const k of Object.keys(all).sort()) {
    if (PLAINTEXT.has(k)) console.log(`${k} = ${JSON.stringify(all[k])}`);
  }
  process.exit(0);
}

/** Secret として投入するもの */
const secrets = {};
for (const [k, v] of Object.entries(all)) {
  if (SKIP.has(k) || PLAINTEXT.has(k)) continue;
  secrets[k] = v;
}

const keys = Object.keys(secrets).sort();
console.log(`[pushWorkersSecrets] Secret として ${keys.length} 件を投入します\n`);
for (const k of keys) {
  console.log(`  ${k} = (${secrets[k].length} 文字)`);
}
console.log("\n[vars] で管理（このスクリプトでは投入しない）:");
console.log("  " + [...PLAINTEXT].join(", "));
console.log("\n除外:");
console.log("  " + [...SKIP].join(", "));

if (dryRun) {
  console.log("\n--dry-run のため実際には投入していません。");
  process.exit(0);
}

console.log("\nwrangler secret bulk を実行します...");
try {
  execFileSync("npx", ["wrangler", "secret", "bulk"], {
    input: JSON.stringify(secrets),
    stdio: ["pipe", "inherit", "inherit"],
    shell: true,
  });
  console.log("\n[pushWorkersSecrets] 完了。");
  console.log("次: wrangler.toml の [vars] を確認して `npx wrangler deploy` で反映する。");
} catch (e) {
  console.error("\n[pushWorkersSecrets] 失敗:", e.message);
  process.exit(1);
}
