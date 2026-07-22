/**
 * adminCsrf.test.ts
 *
 * 管理画面の CSRF ガード（middleware/adminCsrf.ts）の判定表を検証する。
 * Basic 認証はブラウザがクロスサイトのフォーム送信にも資格情報を自動付与するため、
 * フェッチメタデータ（Sec-Fetch-Site / Origin）でクロスサイトの状態変更を遮断する。
 * DB には触らない。
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import { adminCsrfMiddleware } from "../middleware/adminCsrf";

interface Outcome {
  nextCalled: boolean;
  statusCode: number | null;
}

function run(method: string, headers: Record<string, string | string[]>): Outcome {
  const outcome: Outcome = { nextCalled: false, statusCode: null };
  const req = {
    method,
    headers,
    originalUrl: "/admin/test"
  } as unknown as Request;
  const res = {
    status(code: number) {
      outcome.statusCode = code;
      return this;
    },
    send() {
      return this;
    }
  } as unknown as Response;
  adminCsrfMiddleware(req, res, () => {
    outcome.nextCalled = true;
  });
  return outcome;
}

test("GET / HEAD / OPTIONS は常に通す", () => {
  for (const method of ["GET", "HEAD", "OPTIONS"]) {
    const r = run(method, { "sec-fetch-site": "cross-site" });
    assert.equal(r.nextCalled, true, `${method} は通るべき`);
  }
});

test("Sec-Fetch-Site: same-origin / none の POST は通す", () => {
  assert.equal(run("POST", { "sec-fetch-site": "same-origin" }).nextCalled, true);
  // none = アドレスバー直叩き・ブックマーク
  assert.equal(run("POST", { "sec-fetch-site": "none" }).nextCalled, true);
});

test("Sec-Fetch-Site: cross-site / same-site の POST は 403", () => {
  assert.equal(run("POST", { "sec-fetch-site": "cross-site" }).statusCode, 403);
  // サブドメインからの送信も管理画面には不要なので遮断
  assert.equal(run("POST", { "sec-fetch-site": "same-site" }).statusCode, 403);
});

test("Sec-Fetch-Site が無い場合は Origin のホスト一致で判定する", () => {
  const ok = run("POST", { origin: "https://admin.example.com", host: "admin.example.com" });
  assert.equal(ok.nextCalled, true);

  const ng = run("POST", { origin: "https://evil.example", host: "admin.example.com" });
  assert.equal(ng.statusCode, 403);
});

test("プロキシ背後では x-forwarded-host を自ホストとして使う", () => {
  const r = run("POST", {
    origin: "https://app.example.com",
    "x-forwarded-host": "app.example.com",
    host: "internal:3000"
  });
  assert.equal(r.nextCalled, true);
});

test("Origin が無ければ Referer で判定する", () => {
  const ok = run("POST", { referer: "https://admin.example.com/admin/points", host: "admin.example.com" });
  assert.equal(ok.nextCalled, true);

  const ng = run("POST", { referer: "https://evil.example/attack", host: "admin.example.com" });
  assert.equal(ng.statusCode, 403);
});

test("フェッチメタデータも Origin も無い非ブラウザクライアントは通す", () => {
  // curl 等は資格情報を自分で付けており CSRF の脅威モデル外
  assert.equal(run("POST", { host: "admin.example.com" }).nextCalled, true);
});

test("パースできない Origin は遮断側に倒す", () => {
  assert.equal(run("POST", { origin: "not a url", host: "admin.example.com" }).statusCode, 403);
});
