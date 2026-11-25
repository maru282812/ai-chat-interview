/**
 * securityAlertRules.test.ts — セキュリティ通知の判定（いつ知らせるか）を固定する。
 */
import assert from "node:assert/strict";
import {
  ALERT_COOLDOWN_MS,
  buildAlertMessage,
  decideAlert,
  hourInJst,
  isForeign,
  isLateNightJst,
  shouldSuppress
} from "../lib/securityAlertRules";

const results: string[] = [];
const ok = (name: string) => results.push(`  ✓ ${name}`);

// 2026-11-25 12:00 JST = 03:00Z
const noonJst = new Date("2026-11-25T03:00:00Z");
// 2026-11-25 02:30 JST = 2026-11-24 17:30Z
const nightJst = new Date("2026-11-24T17:30:00Z");
const base = { occurredAt: noonJst, country: "JP", recentFailures: 0, recentErrors: 0 };

assert.equal(hourInJst(noonJst), 12);
assert.equal(hourInJst(nightJst), 2);
assert.ok(isLateNightJst(nightJst));
assert.ok(!isLateNightJst(noonJst));
assert.ok(isLateNightJst(new Date("2026-11-24T20:59:00Z"))); // 5:59 JST
assert.ok(!isLateNightJst(new Date("2026-11-24T21:00:00Z"))); // 6:00 JST
ok("日本時間の深夜は 0:00〜5:59");

assert.ok(!isForeign("JP"));
assert.ok(!isForeign("jp"));
assert.ok(!isForeign(null));
assert.ok(!isForeign("XX"));
assert.ok(isForeign("US"));
assert.ok(isForeign("T1"));
ok("国の判定（不明は数えない・Tor は数える）");

assert.equal(decideAlert({ ...base, kind: "login_failed", recentFailures: 4 }), null);
assert.equal(decideAlert({ ...base, kind: "login_failed", recentFailures: 5 }), "login_failures");
assert.equal(decideAlert({ ...base, kind: "api_key_rejected", recentFailures: 5 }), "login_failures");
ok("ログイン失敗は 15 分で 5 回から知らせる");

assert.equal(decideAlert({ ...base, kind: "login_locked" }), "login_locked");
ok("ロックは毎回知らせる対象");

assert.equal(decideAlert({ ...base, kind: "login_succeeded" }), null);
assert.equal(decideAlert({ ...base, kind: "login_succeeded", occurredAt: nightJst }), "unusual_login");
assert.equal(decideAlert({ ...base, kind: "login_succeeded", country: "US" }), "unusual_login");
ok("深夜・海外からのログイン成功を知らせる");

assert.equal(decideAlert({ ...base, kind: "server_error", recentErrors: 9 }), null);
assert.equal(decideAlert({ ...base, kind: "server_error", recentErrors: 10 }), "error_spike");
assert.equal(decideAlert({ ...base, kind: "admin_action" }), null);
ok("エラーは 10 分で 10 件から・操作の記録は知らせない");

const now = noonJst;
assert.ok(!shouldSuppress("login_failures", null, now));
assert.ok(shouldSuppress("login_failures", new Date(now.getTime() - 10 * 60 * 1000), now));
assert.ok(!shouldSuppress("login_failures", new Date(now.getTime() - ALERT_COOLDOWN_MS), now));
assert.ok(!shouldSuppress("unusual_login", new Date(now.getTime() - 1000), now));
ok("同じ通知は 60 分に 1 回（いつもと違うログインは毎回）");

const msg = buildAlertMessage({
  rule: "unusual_login",
  service: "ACI",
  occurredAt: nightJst,
  ip: "203.0.113.5",
  country: "US",
  recentFailures: 0,
  recentErrors: 0
});
assert.ok(msg.subject.startsWith("[ACI]"));
assert.ok(msg.text.includes("2026-11-25 02:30（日本時間）"));
assert.ok(msg.text.includes("203.0.113.5（US）"));
ok("通知文に日本時間・送信元が入る");

console.log("securityAlertRules");
for (const line of results) console.log(line);
