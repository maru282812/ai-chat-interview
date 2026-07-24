/**
 * adminChatApi.test.ts
 *
 * 管理画面AIチャット Phase 3（docs/impl-admin-ai-chat.md）の API とパネル配線を検証する。
 * - 入力バリデーション（screenKey 必須・空メッセージ・履歴サイズ上限）
 * - CSRF ミドルウェアが新エンドポイントにも効くこと（/admin 配下に一括適用）
 * - パネルはコントローラが aiChat を渡した画面にだけ出ること
 * AI 呼び出しは adminChatService をスタブして実際には行わない。
 */

import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import type { Request, Response } from "express";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_BASIC_USER ||= "admin";
process.env.ADMIN_BASIC_PASSWORD ||= "password";

let adminController: typeof import("../controllers/adminController").adminController;
let adminChatService: typeof import("../services/adminChat/adminChatService").adminChatService;
let adminCsrfMiddleware: typeof import("../middleware/adminCsrf").adminCsrfMiddleware;

const originals: Array<() => void> = [];

function stub<T extends object, K extends keyof T>(obj: T, key: K, fn: T[K]): void {
  const original = obj[key];
  obj[key] = fn;
  originals.push(() => {
    obj[key] = original;
  });
}

interface Captured {
  status: number;
  json: Record<string, unknown> | null;
}

async function callApi(body: unknown): Promise<Captured> {
  const captured: Captured = { status: 200, json: null };
  const req = { body } as unknown as Request;
  const res = {
    status(code: number) {
      captured.status = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      captured.json = payload;
      return this;
    },
  } as unknown as Response;
  await adminController.aiChatApi(req, res);
  return captured;
}

before(async () => {
  ({ adminController } = await import("../controllers/adminController"));
  ({ adminChatService } = await import("../services/adminChat/adminChatService"));
  ({ adminCsrfMiddleware } = await import("../middleware/adminCsrf"));
});

afterEach(() => {
  while (originals.length > 0) {
    originals.pop()?.();
  }
});

test("screenKey が無ければ 400", async () => {
  const res = await callApi({ messages: [{ role: "user", content: "hi" }] });
  assert.equal(res.status, 400);
  assert.match(String(res.json?.["error"]), /screenKey/);
});

test("messages が空なら 400", async () => {
  const res = await callApi({ screenKey: "sessions-index", messages: [] });
  assert.equal(res.status, 400);
});

test("本文が空白だけなら 400", async () => {
  const res = await callApi({
    screenKey: "sessions-index",
    messages: [{ role: "user", content: "   " }],
  });
  assert.equal(res.status, 400);
});

test("履歴が 8KB を超えたら 400（リセットを促す）", async () => {
  const res = await callApi({
    screenKey: "sessions-index",
    messages: [{ role: "user", content: "あ".repeat(9000) }],
  });
  assert.equal(res.status, 400);
  assert.match(String(res.json?.["error"]), /リセット/);
});

test("正常時は service の結果をそのまま返す", async () => {
  let passed: unknown = null;
  stub(adminChatService, "runChat", async (request) => {
    passed = request;
    return { reply: "3件です", toolTrace: [], truncated: false, pendingActions: [] };
  });

  const res = await callApi({
    screenKey: "session-show",
    entityId: "s1",
    messages: [{ role: "user", content: "件数は?" }],
  });

  assert.equal(res.status, 200);
  assert.equal(res.json?.["ok"], true);
  assert.equal(res.json?.["reply"], "3件です");
  assert.deepEqual(passed, {
    screenKey: "session-show",
    entityId: "s1",
    messages: [{ role: "user", content: "件数は?" }],
  });
});

test("entityId 未指定は null として渡る", async () => {
  let passedEntityId: string | null | undefined;
  stub(adminChatService, "runChat", async (request) => {
    passedEntityId = request.entityId;
    return { reply: "ok", toolTrace: [], truncated: false, pendingActions: [] };
  });

  await callApi({ screenKey: "sessions-index", messages: [{ role: "user", content: "x" }] });
  assert.equal(passedEntityId, null);
});

test("service が投げても 500 の JSON で返す（画面を落とさない）", async () => {
  stub(adminChatService, "runChat", async () => {
    throw new Error("未登録の画面です: ghost");
  });

  const res = await callApi({
    screenKey: "ghost",
    messages: [{ role: "user", content: "x" }],
  });
  assert.equal(res.status, 500);
  assert.equal(res.json?.["ok"], false);
  assert.match(String(res.json?.["error"]), /未登録の画面/);
});

test("パネルは aiChat を渡した画面にだけ描画される", async () => {
  const ejs = await import("ejs");
  const path = await import("node:path");
  const footer = path.join(process.cwd(), "src", "views", "partials", "footer.ejs");

  const withChat = await ejs.renderFile(footer, {
    aiChat: { screenKey: "session-show", entityId: "abc-123" },
  });
  assert.match(withChat, /id="aic-panel"/, "aiChat があればパネルが出る");
  assert.match(withChat, /"session-show"/, "screenKey が JS に埋め込まれる");
  assert.match(withChat, /"abc-123"/, "entityId が JS に埋め込まれる");

  const without = await ejs.renderFile(footer, {});
  assert.doesNotMatch(without, /id="aic-panel"/, "未対応画面ではボタンごと出ない");
});

test("CSRF: クロスサイトからの POST は 403（/admin 配下に一括適用されている）", () => {
  let nextCalled = false;
  let statusCode: number | null = null;
  const req = {
    method: "POST",
    headers: { "sec-fetch-site": "cross-site" },
    originalUrl: "/admin/api/ai-chat",
  } as unknown as Request;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    send() {
      return this;
    },
  } as unknown as Response;

  adminCsrfMiddleware(req, res, () => {
    nextCalled = true;
  });

  assert.equal(nextCalled, false);
  assert.equal(statusCode, 403);
});
