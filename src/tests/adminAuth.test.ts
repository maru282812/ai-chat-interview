/**
 * adminAuth.test.ts
 *
 * 管理画面認証の土台（パスワードハッシュ・セッション署名・定数時間比較）を検証する。
 * 2要素認証を使わない運用なので、ここが破れると管理画面がそのまま開く。
 */
import assert from "node:assert/strict";
import { hashAdminPassword, verifyAdminPassword } from "../lib/adminPassword";
import {
  ADMIN_SESSION_MAX_AGE_MS,
  issueAdminSession,
  verifyAdminSession
} from "../lib/adminSession";
import { secureEquals } from "../lib/secureCompare";

const results: string[] = [];
function ok(name: string): void {
  results.push(`  ✓ ${name}`);
}

async function testPassword(): Promise<void> {
  const stored = await hashAdminPassword("correct horse battery staple");

  assert.ok(await verifyAdminPassword("correct horse battery staple", stored));
  ok("正しいパスワードが通る");

  assert.ok(!(await verifyAdminPassword("wrong", stored)));
  ok("誤ったパスワードは落ちる");

  assert.ok(!(await verifyAdminPassword("", stored)));
  ok("空パスワードは落ちる");

  // 同じパスワードでもソルトが毎回変わるので、ハッシュは一致しない。
  const again = await hashAdminPassword("correct horse battery staple");
  assert.notEqual(stored, again);
  assert.ok(await verifyAdminPassword("correct horse battery staple", again));
  ok("ソルトが毎回変わり、どちらのハッシュでも検証できる");

  // 形式不正・細工されたパラメータは例外ではなく false（認証は落ちる側へ倒す）。
  assert.ok(!(await verifyAdminPassword("x", "garbage")));
  assert.ok(!(await verifyAdminPassword("x", "scrypt$16384$8$1$00")));
  ok("壊れたハッシュ文字列は false（例外にしない）");

  assert.ok(!(await verifyAdminPassword("x", "scrypt$99999999$8$1$0011$00")));
  ok("過大な N を仕込まれてもメモリを掴まず false");
}

function testSession(): void {
  const secret = "s".repeat(40);
  const token = issueAdminSession(secret);

  assert.ok(verifyAdminSession(token, secret));
  ok("自分で署名したセッションは通る");

  assert.ok(!verifyAdminSession(token, "different-secret-000000000000000000000"));
  ok("別の鍵では通らない（鍵の差し替えが緊急ログアウトになる）");

  assert.ok(verifyAdminSession(token, secret, Date.now() + ADMIN_SESSION_MAX_AGE_MS - 60_000));
  ok("有効期限内は通る");

  assert.ok(!verifyAdminSession(token, secret, Date.now() + ADMIN_SESSION_MAX_AGE_MS + 1_000));
  ok("有効期限を過ぎたら落ちる");

  // 期限は署名の内側にあるので、書き換えると署名が合わなくなる。
  const parts = token.split(".");
  const forged = `${parts[0]}.${Number(parts[1]) + 99_999_999}.${parts[2]}.${parts[3]}`;
  assert.ok(!verifyAdminSession(forged, secret));
  ok("期限だけ延ばした偽造は署名不一致で落ちる");

  assert.ok(!verifyAdminSession("a.b.c.d", secret));
  assert.ok(!verifyAdminSession("", secret));
  assert.ok(!verifyAdminSession("....", secret));
  ok("でたらめな値は落ちる（例外にしない）");
}

function testSecureEquals(): void {
  assert.ok(secureEquals("abc", "abc"));
  assert.ok(!secureEquals("abc", "abd"));
  assert.ok(!secureEquals("a", "ab"));
  assert.ok(!secureEquals("", "a"));
  ok("長さが違っても例外を投げず false");
}

async function main(): Promise<void> {
  console.log("adminAuth");
  await testPassword();
  testSession();
  testSecureEquals();
  console.log(results.join("\n"));
  console.log(`\n${results.length} passed`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
