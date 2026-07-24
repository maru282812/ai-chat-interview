/**
 * adminChatApproval.test.ts
 *
 * 管理画面AIチャット Phase 4（docs/impl-admin-ai-chat.md）の Tier C 承認フローを検証する。
 *
 * ここが緩むと「AI がチャットの流れで配信・公開を実行してしまう」ことになるため、
 * 次の4点を実行フラグで直接確認する:
 *   1. Tier C は AI のツール呼び出しでは execute されず、承認カードだけが作られる
 *   2. 承認トークン（pendingId）は AI に渡るツール結果に含まれない
 *   3. 承認時にサーバー側が prepare を再計算し、対象件数が変わっていたら中断する
 *   4. 同じ承認カードは二度実行できない
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

let registry: typeof import("../services/adminChat/toolRegistry");
let chat: typeof import("../services/adminChat/adminChatService");
let adminAiActionRepository: typeof import("../repositories/adminAiActionRepository").adminAiActionRepository;
let adminAiPendingActionRepository: typeof import("../repositories/adminAiPendingActionRepository").adminAiPendingActionRepository;
let aiLogRepository: typeof import("../repositories/aiLogRepository").aiLogRepository;

const originals: Array<() => void> = [];
let auditRows: Array<Record<string, unknown>> = [];
/** 承認待ちテーブルの代役 */
let pendingStore: Map<string, Record<string, unknown>>;
let pendingSeq = 0;

function stub<T extends object, K extends keyof T>(obj: T, key: K, fn: T[K]): void {
  const original = obj[key];
  obj[key] = fn;
  originals.push(() => {
    obj[key] = original;
  });
}

/** 1回だけ指定ツールを呼び、次のターンで通常応答するモデル */
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
      message: { role: "assistant", content: "確認をお願いします" },
      content: "確認をお願いします",
      toolCalls: [],
      tokenUsage: null,
    };
  };
}

before(async () => {
  registry = await import("../services/adminChat/toolRegistry");
  chat = await import("../services/adminChat/adminChatService");
  ({ adminAiActionRepository } = await import("../repositories/adminAiActionRepository"));
  ({ adminAiPendingActionRepository } = await import(
    "../repositories/adminAiPendingActionRepository"
  ));
  ({ aiLogRepository } = await import("../repositories/aiLogRepository"));
});

beforeEach(() => {
  registry.__resetRegistryForTest();
  auditRows = [];
  pendingStore = new Map();
  pendingSeq = 0;

  stub(adminAiActionRepository, "create", async (row) => {
    auditRows.push(row as unknown as Record<string, unknown>);
  });
  stub(aiLogRepository, "create", (async () => ({}) as never) as typeof aiLogRepository.create);

  stub(adminAiPendingActionRepository, "create", (async (input) => {
    pendingSeq += 1;
    const row = {
      id: `pending-${pendingSeq}`,
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      consumed_at: null,
      consumed_result: null,
      ...input,
    };
    pendingStore.set(row.id as string, row);
    return row;
  }) as typeof adminAiPendingActionRepository.create);

  stub(adminAiPendingActionRepository, "getById", (async (id) => {
    return (pendingStore.get(id) ?? null) as never;
  }) as typeof adminAiPendingActionRepository.getById);

  stub(adminAiPendingActionRepository, "consume", (async (id, result) => {
    const row = pendingStore.get(id);
    if (!row || row["consumed_at"]) return false;
    row["consumed_at"] = new Date().toISOString();
    row["consumed_result"] = result;
    return true;
  }) as typeof adminAiPendingActionRepository.consume);
});

afterEach(() => {
  while (originals.length > 0) {
    originals.pop()?.();
  }
});

const baseTierC = {
  screenKeys: ["test-screen"],
  description: "テスト用の不可逆操作",
  parameters: { type: "object", properties: {} },
};

// ── 登録時の契約 ───────────────────────────────────────────────────────

test("Tier C は prepare が無いと登録できない", () => {
  assert.throws(
    () =>
      registry.registerTool({
        ...baseTierC,
        name: "no_prepare",
        tier: "C",
        execute: async () => ({}),
      }),
    /Tier C には prepare が必要/
  );
});

test("prepare は Tier C 以外に付けられない", () => {
  assert.throws(
    () =>
      registry.registerTool({
        ...baseTierC,
        name: "b_with_prepare",
        tier: "B",
        execute: async () => ({}),
        prepare: async () => ({ summary: "x", impact: [], targetCount: 1 }),
      }),
    /prepare は Tier C 専用/
  );
});

// ── チャット中の挙動 ───────────────────────────────────────────────────

test("Tier C はチャット中に実行されず、承認カードだけが作られる", async () => {
  let executed = false;
  registry.registerTool({
    ...baseTierC,
    name: "send_broadcast",
    tier: "C",
    prepare: async () => ({ summary: "全会員へ配信", impact: ["対象 128 名"], targetCount: 128 }),
    execute: async () => {
      executed = true;
      return { sent: true };
    },
  });

  const res = await chat.adminChatService.runChat(
    { screenKey: "test-screen", entityId: null, messages: [{ role: "user", content: "配信して" }] },
    { callModel: modelCallingTool("send_broadcast") }
  );

  assert.equal(executed, false, "承認前に実行されてはならない");
  assert.equal(res.toolTrace[0]?.status, "pending_approval");
  assert.equal(res.pendingActions.length, 1);
  assert.equal(res.pendingActions[0]?.summary, "全会員へ配信");
  assert.equal(res.pendingActions[0]?.targetCount, 128);
  // 実行していないので監査は blocked
  assert.equal(auditRows[0]?.["result_status"], "blocked");
});

test("承認トークンは AI に渡るツール結果に含まれない", async () => {
  const toolResults: string[] = [];
  registry.registerTool({
    ...baseTierC,
    name: "send_broadcast",
    tier: "C",
    prepare: async () => ({ summary: "配信", impact: [], targetCount: 1 }),
    execute: async () => ({}),
  });

  let called = false;
  const res = await chat.adminChatService.runChat(
    { screenKey: "test-screen", entityId: null, messages: [{ role: "user", content: "配信して" }] },
    {
      callModel: async ({ messages }) => {
        // 2ターン目には、1ターン目のツール結果がメッセージ履歴に入っている
        for (const message of messages as Array<Record<string, unknown>>) {
          if (message["role"] === "tool") toolResults.push(String(message["content"]));
        }
        if (!called) {
          called = true;
          return {
            message: { role: "assistant", content: null, tool_calls: [] },
            content: null,
            toolCalls: [{ id: "c1", name: "send_broadcast", argumentsJson: "{}" }],
            tokenUsage: null,
          };
        }
        return { message: { role: "assistant", content: "確認を" }, content: "確認を", toolCalls: [], tokenUsage: null };
      },
    }
  );

  const pendingId = res.pendingActions[0]?.id;
  assert.ok(pendingId, "承認カードは作られている");
  assert.ok(toolResults.length > 0, "ツール結果がモデルに渡っている");
  for (const result of toolResults) {
    assert.ok(!result.includes(String(pendingId)), "承認トークンがAIに渡ってはならない");
  }
});

// ── 承認実行 ──────────────────────────────────────────────────────────

async function createPendingAction(prepareResult: { count: number }, onExecute: () => void) {
  let currentCount = prepareResult.count;
  registry.registerTool({
    ...baseTierC,
    name: "send_broadcast",
    tier: "C",
    prepare: async () => ({
      summary: "セグメント配信",
      impact: [`対象 ${currentCount} 名`],
      targetCount: currentCount,
    }),
    execute: async () => {
      onExecute();
      return { sent: currentCount };
    },
  });

  const res = await chat.adminChatService.runChat(
    { screenKey: "test-screen", entityId: null, messages: [{ role: "user", content: "配信して" }] },
    { callModel: modelCallingTool("send_broadcast") }
  );

  return {
    pendingId: res.pendingActions[0]?.id ?? "",
    setCount: (next: number) => {
      currentCount = next;
    },
  };
}

test("承認すると実行され、監査に approved で残る", async () => {
  let executed = false;
  const { pendingId } = await createPendingAction({ count: 10 }, () => {
    executed = true;
  });

  const result = await chat.adminChatService.approvePendingAction(pendingId);

  assert.equal(result.ok, true, result.message);
  assert.equal(executed, true);
  const executedAudit = auditRows.find((row) => row["result_status"] === "ok");
  assert.equal(executedAudit?.["approved"], true);
  assert.equal(executedAudit?.["tier"], "C");
});

test("承認時に対象件数が変わっていたら実行せず中断する", async () => {
  let executed = false;
  const { pendingId, setCount } = await createPendingAction({ count: 10 }, () => {
    executed = true;
  });

  // 承認カードを出した後に対象が増えた（例: 条件に合う会員が増えた）
  setCount(999);
  const result = await chat.adminChatService.approvePendingAction(pendingId);

  assert.equal(result.ok, false);
  assert.equal(executed, false, "件数が変わったら実行してはならない");
  assert.match(result.message, /10件.*999件/s);
});

test("同じ承認カードは二度実行できない", async () => {
  let executeCount = 0;
  const { pendingId } = await createPendingAction({ count: 5 }, () => {
    executeCount += 1;
  });

  const first = await chat.adminChatService.approvePendingAction(pendingId);
  const second = await chat.adminChatService.approvePendingAction(pendingId);

  assert.equal(first.ok, true);
  assert.equal(second.ok, false);
  assert.equal(executeCount, 1, "二度押しで2回実行されてはならない");
  assert.match(second.message, /すでに実行済み/);
});

test("期限切れの承認カードは実行できない", async () => {
  let executed = false;
  const { pendingId } = await createPendingAction({ count: 5 }, () => {
    executed = true;
  });
  const row = pendingStore.get(pendingId);
  if (row) row["expires_at"] = new Date(Date.now() - 1000).toISOString();

  const result = await chat.adminChatService.approvePendingAction(pendingId);

  assert.equal(result.ok, false);
  assert.equal(executed, false);
  assert.match(result.message, /有効期限/);
});

test("存在しない承認トークンは実行できない", async () => {
  const result = await chat.adminChatService.approvePendingAction("ghost-token");
  assert.equal(result.ok, false);
  assert.match(result.message, /見つかりません/);
});

// ── 実ツールの Tier 宣言 ───────────────────────────────────────────────

test("send_campaign は Tier C・prepare 付き / list_campaigns は Tier A で登録される", async () => {
  const { registerDeliveryTools } = await import("../services/adminChat/tools/deliveryTools");
  registry.__resetRegistryForTest();
  registerDeliveryTools();

  const send = registry.getTool("send_campaign");
  const list = registry.getTool("list_campaigns");
  assert.equal(send?.tier, "C", "LINE実配信は承認カード必須の Tier C");
  assert.equal(typeof send?.prepare, "function", "Tier C は prepare が必須");
  assert.equal(list?.tier, "A", "一覧は読み取りなので Tier A");
});

// ── Tier B は自動実行される ────────────────────────────────────────────

test("Tier B は承認なしで実行される（Phase 4 で解禁）", async () => {
  let executed = false;
  registry.registerTool({
    screenKeys: ["test-screen"],
    description: "下書き作成",
    parameters: { type: "object", properties: {} },
    name: "create_draft",
    tier: "B",
    execute: async () => {
      executed = true;
      return { created: true };
    },
  });

  const res = await chat.adminChatService.runChat(
    { screenKey: "test-screen", entityId: null, messages: [{ role: "user", content: "作って" }] },
    { callModel: modelCallingTool("create_draft") }
  );

  assert.equal(executed, true);
  assert.equal(res.toolTrace[0]?.status, "ok");
  assert.equal(res.pendingActions.length, 0);
});
