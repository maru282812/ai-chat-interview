/**
 * adminChatService.test.ts
 *
 * 管理画面AIチャット Phase 1（docs/impl-admin-ai-chat.md）の基盤を検証する。
 * 重点は「Tier ゲートが service 内で強制されているか」。ここが緩むと、
 * 将来ツールを足したときにプロンプト任せで書き込みが走る。
 * OpenAI 呼び出しはスタブ、DB 書き込みは repository を差し替えて実DBに触らない。
 */

import assert from "node:assert/strict";
import { afterEach, before, beforeEach, test } from "node:test";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_BASIC_USER ||= "admin";
process.env.ADMIN_BASIC_PASSWORD ||= "password";

type ToolRegistryModule = typeof import("../services/adminChat/toolRegistry");
type AdminChatModule = typeof import("../services/adminChat/adminChatService");

let registry: ToolRegistryModule;
let chat: AdminChatModule;
let adminAiActionRepository: typeof import("../repositories/adminAiActionRepository").adminAiActionRepository;
let aiLogRepository: typeof import("../repositories/aiLogRepository").aiLogRepository;

const originals: Array<() => void> = [];
let auditRows: Array<Record<string, unknown>> = [];

function stub<T extends object, K extends keyof T>(obj: T, key: K, fn: T[K]): void {
  const original = obj[key];
  obj[key] = fn;
  originals.push(() => {
    obj[key] = original;
  });
}

/** ツール呼び出しを1回だけ返し、その後は通常応答で終わるモデル */
function modelCallingTool(toolName: string, args: Record<string, unknown> = {}) {
  let called = false;
  return async () => {
    if (!called) {
      called = true;
      return {
        message: { role: "assistant", content: null, tool_calls: [] },
        content: null,
        toolCalls: [{ id: "call_1", name: toolName, argumentsJson: JSON.stringify(args) }],
        tokenUsage: null,
      };
    }
    return {
      message: { role: "assistant", content: "完了しました" },
      content: "完了しました",
      toolCalls: [],
      tokenUsage: { total_tokens: 10 },
    };
  };
}

before(async () => {
  registry = await import("../services/adminChat/toolRegistry");
  chat = await import("../services/adminChat/adminChatService");
  ({ adminAiActionRepository } = await import("../repositories/adminAiActionRepository"));
  ({ aiLogRepository } = await import("../repositories/aiLogRepository"));
});

beforeEach(() => {
  registry.__resetRegistryForTest();
  auditRows = [];
  stub(adminAiActionRepository, "create", async (row) => {
    auditRows.push(row as unknown as Record<string, unknown>);
  });
  stub(aiLogRepository, "create", (async () => ({}) as never) as typeof aiLogRepository.create);
});

afterEach(() => {
  while (originals.length > 0) {
    originals.pop()?.();
  }
});

const baseTool = {
  screenKeys: ["test-screen"],
  description: "テスト用",
  parameters: { type: "object", properties: {} },
  execute: async () => ({ ok: true }),
};

// ── レジストリの登録検証 ───────────────────────────────────────────────

test("tier 未宣言のツールは登録できない", () => {
  assert.throws(
    () => registry.registerTool({ ...baseTool, name: "no_tier" } as never),
    /tier が未宣言または不正/
  );
});

test("不正な tier 値は登録できない", () => {
  assert.throws(
    () => registry.registerTool({ ...baseTool, name: "bad_tier", tier: "D" } as never),
    /tier が未宣言または不正/
  );
});

test("ツール名の重複は登録できない", () => {
  registry.registerTool({ ...baseTool, name: "dup_tool", tier: "A" });
  assert.throws(() => registry.registerTool({ ...baseTool, name: "dup_tool", tier: "A" }), /重複/);
});

test("screenKeys が空のツールは登録できない", () => {
  assert.throws(
    () => registry.registerTool({ ...baseTool, name: "no_screen", tier: "A", screenKeys: [] }),
    /screenKeys が空/
  );
});

test("toolsForScreen は画面に紐づくツールだけ返し、isRegisteredScreen が一致する", () => {
  registry.registerTool({ ...baseTool, name: "tool_a", tier: "A", screenKeys: ["screen-1"] });
  registry.registerTool({ ...baseTool, name: "tool_b", tier: "A", screenKeys: ["screen-2"] });

  assert.deepEqual(
    registry.toolsForScreen("screen-1").map((t) => t.name),
    ["tool_a"]
  );
  assert.equal(registry.isRegisteredScreen("screen-1"), true);
  assert.equal(registry.isRegisteredScreen("screen-x"), false);
});

// ── Tier ゲート ────────────────────────────────────────────────────────

test("Tier A ツールは実行され、結果が監査に ok で残る", async () => {
  let executed = false;
  registry.registerTool({
    ...baseTool,
    name: "read_thing",
    tier: "A",
    execute: async () => {
      executed = true;
      return { count: 3 };
    },
  });

  const res = await chat.adminChatService.runChat(
    { screenKey: "test-screen", entityId: "e1", messages: [{ role: "user", content: "件数は?" }] },
    { callModel: modelCallingTool("read_thing") }
  );

  assert.equal(executed, true);
  assert.equal(res.reply, "完了しました");
  assert.equal(res.toolTrace[0]?.status, "ok");
  assert.equal(auditRows[0]?.["result_status"], "ok");
  assert.equal(auditRows[0]?.["tier"], "A");
});

// Tier B の自動実行と Tier C の承認フローは adminChatApproval.test.ts で検証する。

test("他画面のツールを名指しされても実行されない", async () => {
  let executed = false;
  registry.registerTool({
    ...baseTool,
    name: "other_screen_tool",
    tier: "A",
    screenKeys: ["another-screen"],
    execute: async () => {
      executed = true;
      return {};
    },
  });
  registry.registerTool({ ...baseTool, name: "here_tool", tier: "A" });

  const res = await chat.adminChatService.runChat(
    { screenKey: "test-screen", entityId: null, messages: [{ role: "user", content: "やって" }] },
    { callModel: modelCallingTool("other_screen_tool") }
  );

  assert.equal(executed, false);
  assert.equal(res.toolTrace[0]?.status, "blocked");
});

test("存在しないツール名（幻覚）は blocked として扱う", async () => {
  registry.registerTool({ ...baseTool, name: "here_tool", tier: "A" });

  const res = await chat.adminChatService.runChat(
    { screenKey: "test-screen", entityId: null, messages: [{ role: "user", content: "やって" }] },
    { callModel: modelCallingTool("ghost_tool") }
  );

  assert.equal(res.toolTrace[0]?.status, "blocked");
});

// ── ループ制御・異常系 ─────────────────────────────────────────────────

test("ツール呼び出しが続いてもループ上限で打ち切る", async () => {
  let calls = 0;
  registry.registerTool({ ...baseTool, name: "loop_tool", tier: "A" });

  const res = await chat.adminChatService.runChat(
    { screenKey: "test-screen", entityId: null, messages: [{ role: "user", content: "延々と" }] },
    {
      callModel: async () => {
        calls += 1;
        return {
          message: { role: "assistant", content: null, tool_calls: [] },
          content: null,
          toolCalls: [{ id: `call_${calls}`, name: "loop_tool", argumentsJson: "{}" }],
          tokenUsage: null,
        };
      },
    }
  );

  const { env } = await import("../config/env");
  assert.equal(calls, env.ADMIN_CHAT_MAX_TOOL_ROUNDS, "上限回数でモデル呼び出しが止まること");
  assert.equal(res.truncated, true);
  assert.match(res.reply, /上限/);
});

test("ツールが例外を投げても応答は返り、監査に error が残る", async () => {
  registry.registerTool({
    ...baseTool,
    name: "broken_tool",
    tier: "A",
    execute: async () => {
      throw new Error("DB接続に失敗");
    },
  });

  const res = await chat.adminChatService.runChat(
    { screenKey: "test-screen", entityId: null, messages: [{ role: "user", content: "取得して" }] },
    { callModel: modelCallingTool("broken_tool") }
  );

  assert.equal(res.reply, "完了しました");
  assert.equal(res.toolTrace[0]?.status, "error");
  assert.equal(auditRows[0]?.["result_status"], "error");
  assert.match(String(auditRows[0]?.["result_summary"]), /DB接続に失敗/);
});

test("未登録画面はエラーになる", async () => {
  await assert.rejects(
    () =>
      chat.adminChatService.runChat({
        screenKey: "unknown-screen",
        entityId: null,
        messages: [{ role: "user", content: "hi" }],
      }),
    /未登録の画面/
  );
});

test("監査ログの書き込みが失敗しても応答は返る", async () => {
  registry.registerTool({ ...baseTool, name: "read_thing", tier: "A" });
  stub(adminAiActionRepository, "create", async () => {
    throw new Error("insert failed");
  });

  const res = await chat.adminChatService.runChat(
    { screenKey: "test-screen", entityId: null, messages: [{ role: "user", content: "件数は?" }] },
    { callModel: modelCallingTool("read_thing") }
  );

  assert.equal(res.reply, "完了しました");
});
