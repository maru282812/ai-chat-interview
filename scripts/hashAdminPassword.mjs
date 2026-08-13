#!/usr/bin/env node
/**
 * 管理画面パスワードの scrypt ハッシュを作る。
 *
 *   npm run admin:hash -- '<パスワード>'
 *   npm run admin:hash              # 引数なし = 強いパスワードを生成してハッシュも出す
 *
 * 出力された ADMIN_PASSWORD_HASH を .env と Vercel の環境変数へ入れる。
 * ハッシュ形式は src/lib/adminPassword.ts と一致させること（変更時は両方直す）。
 */
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);

const KEY_LENGTH = 64;
// maxmem は既定 32MB では N=16384,r=8 に足りない。src/lib/adminPassword.ts と揃えること。
const COST = { N: 16384, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };

async function hash(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, COST);
  // maxmem はコストパラメータではないのでハッシュ文字列には含めない（検証側が自前で指定する）。
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString("hex")}$${derived.toString("hex")}`;
}

/** 紛らわしい文字（0/O/l/1 等）を避けた英数字。パスワードマネージャ前提だが手入力も想定。 */
function generatePassword(length = 32) {
  const alphabet = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

const provided = process.argv[2];
const password = provided ?? generatePassword();

const digest = await hash(password);

if (!provided) {
  console.log("生成したパスワード（パスワードマネージャに保存してください）:");
  console.log(`  ${password}`);
  console.log("");
}
console.log("ADMIN_PASSWORD_HASH=" + digest);
console.log("");
console.log("セッション署名鍵もまだなら、あわせてこちらを設定してください:");
console.log("ADMIN_SESSION_SECRET=" + randomBytes(32).toString("hex"));
