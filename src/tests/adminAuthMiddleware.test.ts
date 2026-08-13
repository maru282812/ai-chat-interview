/**
 * adminAuthMiddleware.test.ts
 *
 * 実際の Express アプリを立て、/admin が「ログインしないと通らない」ことを通しで確認する。
 * lib 層の単体（adminAuth.test.ts）と違い、middleware の配線ミスを捕まえるのが目的。
 */
import assert from "node:assert/strict";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-token";
process.env.LINE_CHANNEL_SECRET ||= "test-secret";
process.env.OPENAI_API_KEY ||= "test-openai";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000001";
process.env.ADMIN_SESSION_SECRET ||= "test-admin-session-secret-000000000000";
process.env.ADMIN_API_KEY ||= "test-admin-api-key-0000000000000000";

const PASSWORD = "test-password-for-middleware";

async function main(): Promise<void> {
  const { hashAdminPassword } = await import("../lib/adminPassword");
  process.env.ADMIN_PASSWORD_HASH = await hashAdminPassword(PASSWORD);

  const { createApp } = await import("../app");
  const app = createApp();
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  const base = `http://127.0.0.1:${address.port}`;

  const results: string[] = [];
  const ok = (name: string) => results.push(`  ✓ ${name}`);

  try {
    // 1. 未認証は素通りせずログイン画面へ送られる。
    const anon = await fetch(`${base}/admin/user-profiles`, { redirect: "manual" });
    assert.equal(anon.status, 302);
    assert.ok(anon.headers.get("location")?.startsWith("/admin/login"));
    ok("未認証で個人情報画面を開くとログインへリダイレクトされる");

    // 旧実装で固定トークンだった Cookie が復活していないこと。
    const legacy = await fetch(`${base}/admin/user-profiles`, {
      headers: { cookie: "upadmin_auth=upadmin_ok_v1" },
      redirect: "manual"
    });
    assert.equal(legacy.status, 302);
    ok("旧ハードコード Cookie（upadmin_ok_v1）はもう通用しない");

    // 2. ログイン画面自体は認証なしで開ける（無限リダイレクト防止）。
    const loginPage = await fetch(`${base}/admin/login`, { redirect: "manual" });
    assert.equal(loginPage.status, 200);
    ok("ログイン画面は認証なしで開ける");

    // 3. 誤ったパスワードではセッションが発行されない。
    const bad = await fetch(`${base}/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" },
      body: new URLSearchParams({ password: "wrong", next: "/admin" }).toString(),
      redirect: "manual"
    });
    assert.ok(bad.headers.get("location")?.includes("error=invalid"));
    assert.ok(!(bad.headers.get("set-cookie") ?? "").includes("admin_session="));
    ok("誤ったパスワードではセッション Cookie が発行されない");

    // 4. 正しいパスワードでログインし、その Cookie で保護画面に入れる。
    const good = await fetch(`${base}/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" },
      body: new URLSearchParams({ password: PASSWORD, next: "/admin/points" }).toString(),
      redirect: "manual"
    });
    assert.equal(good.status, 302);
    assert.equal(good.headers.get("location"), "/admin/points");
    const setCookie = good.headers.get("set-cookie") ?? "";
    assert.ok(setCookie.includes("admin_session="));
    assert.ok(setCookie.includes("HttpOnly"));
    assert.ok(setCookie.includes("SameSite=Strict"));
    ok("正しいパスワードで HttpOnly/SameSite=Strict のセッションが発行される");

    const sessionCookie = setCookie.split(";")[0] ?? "";
    const authed = await fetch(`${base}/admin/user-profiles`, {
      headers: { cookie: sessionCookie },
      redirect: "manual"
    });
    assert.notEqual(authed.status, 302);
    ok("発行されたセッションで保護画面に入れる");

    // 5. オープンリダイレクト対策。外部URLを next に入れても外へ飛ばさない。
    const evil = await fetch(`${base}/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "sec-fetch-site": "same-origin" },
      body: new URLSearchParams({ password: PASSWORD, next: "//evil.example/x" }).toString(),
      redirect: "manual"
    });
    assert.equal(evil.headers.get("location"), "/admin");
    ok("next に外部URLを入れても外部へは飛ばさない");

    // 6. 非対話クライアント向けの API キー経路。
    const withKey = await fetch(`${base}/admin/user-profiles`, {
      headers: { "x-admin-api-key": process.env.ADMIN_API_KEY as string },
      redirect: "manual"
    });
    assert.notEqual(withKey.status, 302);
    ok("X-Admin-Api-Key で非対話クライアントが通る");

    const badKey = await fetch(`${base}/admin/user-profiles`, {
      headers: { "x-admin-api-key": "nope" },
      redirect: "manual"
    });
    assert.equal(badKey.status, 401);
    ok("誤った API キーは 401（リダイレクトしない）");

    // 7. Cookie の Secure 属性は VERCEL_ENV で決まる（NODE_ENV ではない）。
    //    本番の NODE_ENV は "development" のままなので、NODE_ENV で判定すると
    //    本番で Secure が付かない。この分離が壊れていないことを固定する。
    //    この実行は VERCEL_ENV 未設定（ローカル相当）なので Secure は付かない。
    assert.ok(!/;\s*Secure/i.test(setCookie));
    ok("ローカル（VERCEL_ENV 未設定）では Secure が付かない＝http で開発できる");

    console.log("adminAuthMiddleware");
    console.log(results.join("\n"));
    console.log(`\n${results.length} passed`);
  } finally {
    server.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
