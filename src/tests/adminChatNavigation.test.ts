/**
 * adminChatNavigation.test.ts
 *
 * 管理画面ナビゲーターAI Phase 3（docs/plan-admin-navigator-ai.md）の道しるべを検証する。
 * ここで守りたい不変条件は3つ:
 *   1. `screenKeys: ["*"]` が全画面に展開されること（全画面常駐の土台）
 *   2. **Tier C の `"*"` は登録時 throw**（不可逆・対外操作の全画面露出を構造で禁止）
 *   3. `res.render` 引数の aiChat が `res.locals` より優先されること
 *      （既存4画面の entityId 付き明示指定を middleware の既定値で潰さない）
 * あわせて navigations 封筒が「サーバー計算値のみ」であることも押さえる。
 *
 * Phase 5 で find_screen / resolve_entity の中身をさらに拡充する想定。
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
process.env.ADMIN_PASSWORD_HASH ||= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ||= "test-admin-session-secret-000000000000";

type ToolRegistryModule = typeof import("../services/adminChat/toolRegistry");
type AdminChatModule = typeof import("../services/adminChat/adminChatService");
type NavigationToolsModule = typeof import("../services/adminChat/tools/navigationTools");
type CatalogModule = typeof import("../lib/adminScreenCatalog");

let registry: ToolRegistryModule;
let chat: AdminChatModule;
let navTools: NavigationToolsModule;
let catalog: CatalogModule;
let adminAiActionRepository: typeof import("../repositories/adminAiActionRepository").adminAiActionRepository;
let aiLogRepository: typeof import("../repositories/aiLogRepository").aiLogRepository;

const originals: Array<() => void> = [];

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
      message: { role: "assistant", content: "こちらの画面です" },
      content: "こちらの画面です",
      toolCalls: [],
      tokenUsage: null,
    };
  };
}

before(async () => {
  registry = await import("../services/adminChat/toolRegistry");
  chat = await import("../services/adminChat/adminChatService");
  navTools = await import("../services/adminChat/tools/navigationTools");
  catalog = await import("../lib/adminScreenCatalog");
  ({ adminAiActionRepository } = await import("../repositories/adminAiActionRepository"));
  ({ aiLogRepository } = await import("../repositories/aiLogRepository"));
});

beforeEach(() => {
  registry.__resetRegistryForTest();
  stub(adminAiActionRepository, "create", (async () => undefined) as never);
  stub(aiLogRepository, "create", (async () => ({}) as never) as typeof aiLogRepository.create);
});

afterEach(() => {
  while (originals.length > 0) {
    originals.pop()?.();
  }
});

const baseTool = {
  description: "テスト用",
  parameters: { type: "object", properties: {} },
  execute: async () => ({ ok: true }),
};

// ── ワイルドカード展開 ─────────────────────────────────────────────────

test('screenKeys ["*"] はどの画面でも出る（toolsForScreen が展開する）', () => {
  registry.registerTool({ ...baseTool, name: "any_screen_tool", tier: "A", screenKeys: ["*"] });
  registry.registerTool({ ...baseTool, name: "one_screen_tool", tier: "A", screenKeys: ["sessions-index"] });

  const onDashboard = registry.toolsForScreen("dashboard").map((t) => t.name);
  assert.deepEqual(onDashboard, ["any_screen_tool"], "限定ツールはダッシュボードに出ない");

  const onSessions = registry.toolsForScreen("sessions-index").map((t) => t.name);
  assert.deepEqual(onSessions.sort(), ["any_screen_tool", "one_screen_tool"]);
});

test('isRegisteredScreen も "*" を展開する（全画面でパネルが開く）', () => {
  assert.equal(registry.isRegisteredScreen("dashboard"), false, "登録前は false");
  registry.registerTool({ ...baseTool, name: "any_screen_tool", tier: "A", screenKeys: ["*"] });
  assert.equal(registry.isRegisteredScreen("dashboard"), true);
  assert.equal(registry.isRegisteredScreen("points-index"), true);
});

test('"*" ツールは実行時ガードでも blocked にならない', async () => {
  let executed = false;
  registry.registerTool({
    ...baseTool,
    name: "any_screen_tool",
    tier: "A",
    screenKeys: ["*"],
    execute: async () => {
      executed = true;
      return { ok: true };
    },
  });

  const result = await chat.adminChatService.runChat(
    { screenKey: "dashboard", entityId: null, messages: [{ role: "user", content: "x" }] },
    { callModel: modelCallingTool("any_screen_tool") as never }
  );

  assert.equal(executed, true);
  assert.equal(result.toolTrace[0]?.status, "ok");
});

// ── Tier C の "*" 禁止（構造で守る） ───────────────────────────────────

test('Tier C に screenKeys ["*"] は登録できない（登録時 throw）', () => {
  assert.throws(
    () =>
      registry.registerTool({
        ...baseTool,
        name: "danger_tool",
        tier: "C",
        screenKeys: ["*"],
        prepare: async () => ({ summary: "s", impact: [], targetCount: 0 }),
      }),
    /Tier C に screenKeys "\*"/
  );
});

test('Tier C は "*" を混ぜても throw する（限定キーとの併記も禁止）', () => {
  assert.throws(
    () =>
      registry.registerTool({
        ...baseTool,
        name: "danger_tool2",
        tier: "C",
        screenKeys: ["delivery-operations", "*"],
        prepare: async () => ({ summary: "s", impact: [], targetCount: 0 }),
      }),
    /Tier C に screenKeys "\*"/
  );
});

test("Tier C でも明示 screenKeys なら従来どおり登録できる", () => {
  registry.registerTool({
    ...baseTool,
    name: "danger_tool3",
    tier: "C",
    screenKeys: ["sessions-index"],
    prepare: async () => ({ summary: "s", impact: [], targetCount: 0 }),
  });
  assert.equal(registry.toolsForScreen("sessions-index").length, 1);
  assert.equal(registry.toolsForScreen("dashboard").length, 0, "Tier C はダッシュボードに出ない");
});

// ── 道しるべツール本体 ─────────────────────────────────────────────────

test("find_screen / resolve_entity はどちらも Tier A・全画面", () => {
  const defs = navTools.navigationToolDefinitions();
  assert.deepEqual(
    defs.map((d) => d.name).sort(),
    ["find_screen", "resolve_entity"]
  );
  for (const def of defs) {
    assert.equal(def.tier, "A", `${def.name} は Tier A であること`);
    assert.deepEqual(def.screenKeys, ["*"], `${def.name} は全画面であること`);
  }
});

test("find_screen は候補の url をカタログの path からしか作らない", async () => {
  const find = navTools.navigationToolDefinitions().find((d) => d.name === "find_screen");
  assert.ok(find);
  const result = (await find.execute({ query: "離脱" }, { entityId: null, screenKey: "dashboard" })) as {
    navigations: Array<{ url: string; label: string }>;
  };

  assert.ok(result.navigations.length > 0, "「離脱」で候補が出ること");
  const paths = new Set(catalog.ADMIN_SCREENS.map((s) => s.path));
  for (const nav of result.navigations) {
    assert.ok(paths.has(nav.url), `url はカタログの path のみ: ${nav.url}`);
  }
  assert.ok(
    result.navigations.some((n) => n.url === "/admin/cycles"),
    "「離脱」でサイクル画面が候補に入る"
  );
});

test("find_screen の候補カードに動的URL（/:param）は入らない", async () => {
  const find = navTools.navigationToolDefinitions().find((d) => d.name === "find_screen");
  assert.ok(find);
  // 動的URL画面（案件編集・企業まとめ等）に当たりやすい語で引く
  for (const query of ["案件", "企業", "セッション", "設問"]) {
    const result = (await find.execute({ query }, { entityId: null, screenKey: "dashboard" })) as {
      navigations: Array<{ url: string }>;
    };
    for (const nav of result.navigations) {
      assert.ok(!nav.url.includes("/:"), `ID未解決のURLを候補に出さない（${query}）: ${nav.url}`);
    }
  }
});

test("find_screen: 該当0件は空の候補＋「正直に伝える」指示を返す", async () => {
  const find = navTools.navigationToolDefinitions().find((d) => d.name === "find_screen");
  assert.ok(find);
  const result = (await find.execute(
    { query: "存在しない架空機能ZZZQQQ" },
    { entityId: null, screenKey: "dashboard" }
  )) as { navigations: unknown[]; instruction: string };

  assert.deepEqual(result.navigations, []);
  assert.match(result.instruction, /該当画面はありません/);
});

test("navigationsOf は navigations 形の結果だけを封筒に通す", () => {
  assert.deepEqual(navTools.navigationsOf(null), []);
  assert.deepEqual(navTools.navigationsOf({ answers: [{ url: "/admin/evil" }] }), []);
  assert.deepEqual(navTools.navigationsOf("/admin/evil"), []);
  assert.deepEqual(
    navTools.navigationsOf({ navigations: [{ label: "サイクル", url: "/admin/cycles" }] }),
    [{ label: "サイクル", url: "/admin/cycles", description: "", group: "" }]
  );
});

test("navigations 封筒はツール戻り値から積まれる（AIの本文からは拾わない）", async () => {
  registry.registerTool({
    ...baseTool,
    name: "fake_finder",
    tier: "A",
    screenKeys: ["*"],
    execute: async () => ({
      navigations: [
        { label: "サイクル", url: "/admin/cycles", description: "d", group: "店舗" },
        // 同じ URL は1件にまとめる
        { label: "サイクル（重複）", url: "/admin/cycles", description: "d", group: "店舗" },
      ],
    }),
  });

  const result = await chat.adminChatService.runChat(
    { screenKey: "dashboard", entityId: null, messages: [{ role: "user", content: "どこ？" }] },
    { callModel: modelCallingTool("fake_finder") as never }
  );

  assert.equal(result.navigations.length, 1, "同一URLは重複排除する");
  assert.equal(result.navigations[0]?.url, "/admin/cycles");
  // AI の本文（reply）には URL が無くても封筒には載る＝本文由来ではないことの確認
  assert.ok(!result.reply.includes("/admin/cycles"));
});

test("ツールを呼ばなければ navigations は空", async () => {
  registry.registerTool({ ...baseTool, name: "any_screen_tool", tier: "A", screenKeys: ["*"] });
  const result = await chat.adminChatService.runChat(
    { screenKey: "dashboard", entityId: null, messages: [{ role: "user", content: "こんにちは" }] },
    {
      callModel: (async () => ({
        message: { role: "assistant", content: "はい" },
        content: "はい",
        toolCalls: [],
        tokenUsage: null,
      })) as never,
    }
  );
  assert.deepEqual(result.navigations, []);
});

// ── res.locals より render 引数が優先されること ─────────────────────────

test("render 引数の aiChat が res.locals の既定値より優先される（既存4画面の entityId を守る）", async () => {
  const express = await import("express");
  const path = await import("node:path");
  const { adminLocals } = await import("../middleware/adminLocals");

  const app = express.default();
  app.set("view engine", "ejs");
  app.set("views", path.join(process.cwd(), "src", "views"));
  app.use(adminLocals);

  // middleware が既定注入する画面（/admin/sessions → sessions-index, entityId:null）で、
  // コントローラが entityId 付きの aiChat を render 引数に渡す状況を再現する。
  app.get("/admin/sessions", (_req, res) => {
    res.render("partials/footer", {
      aiChat: { screenKey: "sessions-index", entityId: "project-abc" },
    });
  });
  // 既定注入だけの画面（コントローラが aiChat を渡さない）
  app.get("/admin/cycles", (_req, res) => {
    res.render("partials/footer", {});
  });

  const server = app.listen(0);
  try {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    const explicit = await (await fetch(`http://127.0.0.1:${port}/admin/sessions`)).text();
    assert.match(explicit, /"sessions-index"/, "screenKey が埋まる");
    assert.match(explicit, /"project-abc"/, "render 引数の entityId が locals の null に勝つ");

    const defaulted = await (await fetch(`http://127.0.0.1:${port}/admin/cycles`)).text();
    assert.match(defaulted, /id="aic-panel"/, "既定注入だけでもパネルが出る");
    assert.match(defaulted, /"cycles-index"|"cycles"/, "カタログ解決した screenKey が入る");
  } finally {
    server.close();
  }
});

test("台帳外パス（api 等）では aiChat を注入しない＝パネルを出さない", async () => {
  const { adminLocals } = await import("../middleware/adminLocals");
  const locals: Record<string, unknown> = {};
  const req = { baseUrl: "/admin", path: "/api/screen-search", query: {} } as never;
  const res = { locals } as never;
  adminLocals(req, res, () => undefined);

  assert.equal(locals["currentScreen"], null, "台帳外パスは currentScreen が null");
  assert.equal(locals["aiChat"], undefined, "aiChat も注入されない");
});

// ── system prompt に現在画面が入ること ────────────────────────────────

test("buildSystemPrompt に現在画面の label / description が入る", async () => {
  registry.registerTool({ ...baseTool, name: "any_screen_tool", tier: "A", screenKeys: ["*"] });

  let systemContent = "";
  await chat.adminChatService.runChat(
    { screenKey: "cycles-index", entityId: null, messages: [{ role: "user", content: "x" }] },
    {
      callModel: (async (params: { messages: Array<{ role: string; content: string }> }) => {
        systemContent = params.messages.find((m) => m.role === "system")?.content ?? "";
        return {
          message: { role: "assistant", content: "はい" },
          content: "はい",
          toolCalls: [],
          tokenUsage: null,
        };
      }) as never,
    }
  );

  const screen = catalog.getScreenByKey("cycles-index");
  assert.ok(screen, "cycles-index はカタログに存在する");
  assert.ok(systemContent.includes(screen.label), "画面の label が system prompt に入る");
  assert.ok(systemContent.includes(screen.description), "画面の description が入る");
});

test("カタログに無い screenKey では画面情報を足さない（黙って省く）", async () => {
  registry.registerTool({ ...baseTool, name: "any_screen_tool", tier: "A", screenKeys: ["*"] });

  let systemContent = "";
  await chat.adminChatService.runChat(
    { screenKey: "not-in-catalog", entityId: null, messages: [{ role: "user", content: "x" }] },
    {
      callModel: (async (params: { messages: Array<{ role: string; content: string }> }) => {
        systemContent = params.messages.find((m) => m.role === "system")?.content ?? "";
        return {
          message: { role: "assistant", content: "はい" },
          content: "はい",
          toolCalls: [],
          tokenUsage: null,
        };
      }) as never,
    }
  );
  assert.ok(!systemContent.includes("あなたは今"), "画面行を足さない");
});

// ── プロンプト・UI の申し送り事項 ──────────────────────────────────────

test("adminChatCommon に道しるべの振る舞いが入っている（新キーは足さない）", async () => {
  const { BASE_PROMPT_TEMPLATES, ALL_PROMPT_KEYS } = await import("../prompts/basePromptTemplates");
  const body = BASE_PROMPT_TEMPLATES.adminChatCommon.template;
  assert.match(body, /find_screen/);
  assert.match(body, /該当画面はありません/);
  assert.match(body, /3〜5件/);
  // キー数はテンプレ定義そのものと突き合わせる（件数の直書きはしない）
  assert.equal(ALL_PROMPT_KEYS.length, Object.keys(BASE_PROMPT_TEMPLATES).length);
});

test("候補カードは新規タブで開く（作業中フォームを保護する）", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const panel = await fs.readFile(
    path.join(process.cwd(), "src", "views", "partials", "ai-chat-panel.ejs"),
    "utf8"
  );
  assert.match(panel, /card\.target = "_blank"/);
  assert.match(panel, /card\.rel = "noopener"/);
  assert.match(panel, /appendNavigations\(json\.navigations\)/);
});

test("sessionStorage の会話キー形式が変わっていない（既存4画面の会話を飛ばさない）", async () => {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const panel = await fs.readFile(
    path.join(process.cwd(), "src", "views", "partials", "ai-chat-panel.ejs"),
    "utf8"
  );
  assert.match(
    panel,
    /var STORAGE_KEY = "aiChat:" \+ SCREEN_KEY \+ ":" \+ \(ENTITY_ID \|\| "-"\);/,
    "会話キーは aiChat:{screenKey}:{entityId} のまま"
  );
});

test("既存4画面の screenKey がカタログに現行値のまま存在する", () => {
  for (const key of ["research-form", "respondent-show", "sessions-index", "session-show"]) {
    assert.ok(catalog.getScreenByKey(key), `${key} がカタログに存在する`);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Phase 5 追加分（docs/plan-admin-navigator-ai.md Phase 5）
// Phase 4 の申し送りで「崩れたら気づけるようにする」とされた不変条件を固定する。
// ═══════════════════════════════════════════════════════════════════════════

// ── Tier C の確定キー集合を固定する ────────────────────────────────────
//
// Tier C は「全画面に出さない」ことが構造上の約束（"*" は registerTool が throw する）。
// だがキーを**足す**方向の事故はレジストリでは止まらない。ここで集合そのものを固定し、
// 誰かが配信ツールの露出画面を増やした瞬間にテストで落とす。
// Phase 4 実装時点で確定した集合（phase-status-admin-navigator.md の Phase 4 申し送り）。

const TIER_C_EXPECTED_SCREENS: Record<string, string[]> = {
  send_campaign: [
    "delivery-calendar",
    "delivery-operations",
    "research-form",
    "segments-campaign-edit",
    "segments-campaigns-index",
    "sessions-index",
  ],
  publish_pool_question: [
    "delivery-operations",
    "pool-question-edit",
    "pool-questions-bulk",
    "pool-questions-index",
    "research-form",
    "sessions-index",
  ],
};

/** 本物のツール一式を登録する（beforeEach でレジストリは空にされている） */
async function registerRealTools(): Promise<void> {
  const { __resetRegisteredFlagForTest, registerAdminChatTools } = await import(
    "../services/adminChat/registerTools"
  );
  __resetRegisteredFlagForTest();
  registerAdminChatTools();
}

test("Tier C は send_campaign / publish_pool_question の2本だけ", async () => {
  await registerRealTools();

  // sessions-index は Phase 4 実測で Tier C が両方出る画面
  const tierC = registry
    .toolsForScreen("sessions-index")
    .filter((t) => t.tier === "C")
    .map((t) => t.name)
    .sort();
  assert.deepEqual(tierC, ["publish_pool_question", "send_campaign"]);
});

test("Tier C の screenKeys 集合が Phase 4 の確定値から動いていない", async () => {
  await registerRealTools();

  for (const [name, expected] of Object.entries(TIER_C_EXPECTED_SCREENS)) {
    const tool = registry.getTool(name);
    assert.ok(tool, `${name} が登録されていない`);
    assert.equal(tool.tier, "C", `${name} は Tier C であること`);
    assert.deepEqual(
      [...tool.screenKeys].sort(),
      expected,
      `${name} の露出画面が変わっている（計画書の「Tier C は "*" にしない・限定開放」を確認すること）`
    );
    assert.ok(!tool.screenKeys.includes("*"), `${name} に "*" が入っている`);
  }
});

test("Tier C の露出画面はすべてカタログに実在する（タイプミスで静かに消えない）", async () => {
  await registerRealTools();

  for (const name of Object.keys(TIER_C_EXPECTED_SCREENS)) {
    for (const key of registry.getTool(name)?.screenKeys ?? []) {
      assert.ok(catalog.getScreenByKey(key), `${name} の screenKey ${key} がカタログに無い`);
    }
  }
});

test("Tier C が出ない代表画面ではツールとして提示すらされない", async () => {
  await registerRealTools();

  // ダッシュボード・ポイント・セグメント一覧は Phase 4 実測で Tier C ゼロ
  for (const screenKey of ["dashboard", "points-index", "segments-index"]) {
    const names = registry
      .toolsForScreen(screenKey)
      .filter((t) => t.tier === "C")
      .map((t) => t.name);
    assert.deepEqual(names, [], `${screenKey} に Tier C が出ている: ${names.join(", ")}`);
  }
});

test("Tier A/B は全ツールが全画面（Phase 4 の開放が巻き戻っていない）", async () => {
  await registerRealTools();

  const onDashboard = registry.toolsForScreen("dashboard");
  const notAll = onDashboard.filter((t) => !t.screenKeys.includes("*"));
  assert.deepEqual(
    notAll.map((t) => t.name),
    [],
    "Tier A/B に画面限定が残っている"
  );
  // Tier A 8本 + 道しるべ2本 + Tier B 10本 = 20本（Phase 4 実測値）
  assert.equal(onDashboard.length, 20, "ダッシュボードで使えるツール数が変わっている");
  assert.ok(onDashboard.every((t) => t.tier === "A" || t.tier === "B"));
});

// ── entityId フォールバックの安全性（Tier B 全画面開放の核） ──────────
//
// Tier B を全画面に開放した以上、「対象案件が分からない画面から呼ばれる」経路が生まれる。
// entityId=null かつ project_id 省略で**黙って別案件に書き込まない**ことを直接叩いて確かめる。
// repository には到達させない（到達したらそれ自体が失敗）。

test("entityId=null かつ project_id 省略で create_question / reorder_questions は throw する", async () => {
  await registerRealTools();

  const { questionRepository } = await import("../repositories/questionRepository");
  let touched = false;
  stub(questionRepository, "create", (async () => {
    touched = true;
    return {} as never;
  }) as typeof questionRepository.create);
  stub(questionRepository, "listByProject", (async () => {
    touched = true;
    return [] as never;
  }) as typeof questionRepository.listByProject);

  const ctx = { entityId: null, screenKey: "dashboard" };

  await assert.rejects(
    () =>
      registry
        .getTool("create_question")!
        .execute({ question_text: "朝食は食べますか？", question_type: "text" }, ctx),
    /project_id/,
    "project_id 未指定でも作成に進んでいる"
  );

  await assert.rejects(
    () => registry.getTool("reorder_questions")!.execute({ question_ids: ["q1", "q2"] }, ctx),
    /project_id/,
    "project_id 未指定でも並べ替えに進んでいる"
  );

  assert.equal(touched, false, "throw する前に repository へ到達している");
});

test("引数の project_id は画面の entityId より優先される（誤対象書き込みの防止）", async () => {
  await registerRealTools();

  const { questionRepository } = await import("../repositories/questionRepository");
  const { projectRepository } = await import("../repositories/projectRepository");
  const seen: string[] = [];
  stub(questionRepository, "listByProject", (async (projectId: string) => {
    seen.push(projectId);
    return [] as never;
  }) as typeof questionRepository.listByProject);
  stub(projectRepository, "getById", (async (projectId: string) => {
    seen.push(projectId);
    return { id: projectId, name: "p", status: "draft" } as never;
  }) as typeof projectRepository.getById);

  await registry
    .getTool("get_project_questions")!
    .execute({ project_id: "explicit-project" }, { entityId: "screen-project", screenKey: "research-form" });

  assert.deepEqual(
    [...new Set(seen)],
    ["explicit-project"],
    "引数より画面の entityId が勝っている"
  );
});

test("案件ID前提ツールの description は画面外での project_id 明示を求めている", async () => {
  await registerRealTools();

  for (const name of ["create_question", "reorder_questions", "get_project_questions"]) {
    const tool = registry.getTool(name);
    assert.ok(tool, `${name} が登録されていない`);
    assert.match(tool.description, /project_id/, `${name} の description に project_id の指示が無い`);
  }
});

// ── resolve_entity ────────────────────────────────────────────────────

test("resolve_entity: 不正な type は候補を返さず案内文だけ返す", async () => {
  const resolve = navTools.navigationToolDefinitions().find((d) => d.name === "resolve_entity");
  assert.ok(resolve);
  const result = (await resolve.execute(
    { type: "unicorn", name: "x" },
    { entityId: null, screenKey: "dashboard" }
  )) as { navigations: unknown[]; note?: string };
  assert.deepEqual(result.navigations, []);
  assert.match(String(result.note), /project/);
});

test("resolve_entity: name が空なら候補ゼロ（repository を叩かない）", async () => {
  const { clientRepository } = await import("../repositories/clientRepository");
  let touched = false;
  stub(clientRepository, "list", (async () => {
    touched = true;
    return [] as never;
  }) as typeof clientRepository.list);

  const resolve = navTools.navigationToolDefinitions().find((d) => d.name === "resolve_entity");
  assert.ok(resolve);
  const result = (await resolve.execute(
    { type: "client", name: "  " },
    { entityId: null, screenKey: "dashboard" }
  )) as { navigations: unknown[] };
  assert.deepEqual(result.navigations, []);
  assert.equal(touched, false);
});

test("resolve_entity: 企業名 → clients overview の実URL（:param が ID に置き換わる）", async () => {
  const { clientRepository } = await import("../repositories/clientRepository");
  stub(
    clientRepository,
    "list",
    (async () =>
      [
        { id: "client-111", name: "株式会社ヨット" },
        { id: "client-222", name: "無関係コーポレーション" },
      ] as never) as typeof clientRepository.list
  );

  const resolve = navTools.navigationToolDefinitions().find((d) => d.name === "resolve_entity");
  assert.ok(resolve);
  const result = (await resolve.execute(
    { type: "client", name: "ヨット" },
    { entityId: null, screenKey: "dashboard" }
  )) as { navigations: Array<{ url: string }>; matched_count: number };

  assert.equal(result.matched_count, 1, "部分一致で1件だけ当たること");
  assert.equal(result.navigations.length, 1);
  const url = result.navigations[0]?.url ?? "";
  assert.ok(!url.includes("/:"), `:param が残っている: ${url}`);
  assert.ok(url.includes("client-111"), `解決した ID が URL に入っていない: ${url}`);
  // URL の骨格はカタログ path 由来であること（AI 生成文からは作らない）
  const screen = catalog.getScreenByKey("client-overview");
  assert.ok(screen);
  assert.equal(url, screen.path.replace(/:[A-Za-z0-9_]+/, "client-111"));
});

test("resolve_entity: 複数一致は上限5件までで、どれか確認する指示を返す", async () => {
  const { projectRepository } = await import("../repositories/projectRepository");
  stub(
    projectRepository,
    "list",
    (async () =>
      Array.from({ length: 9 }, (_, i) => ({
        id: `project-${i}`,
        name: `美容室アンケート${i}`,
        user_display_title: null,
      })) as never) as typeof projectRepository.list
  );

  const resolve = navTools.navigationToolDefinitions().find((d) => d.name === "resolve_entity");
  assert.ok(resolve);
  const result = (await resolve.execute(
    { type: "project", name: "美容室" },
    { entityId: null, screenKey: "dashboard" }
  )) as {
    navigations: Array<{ url: string; label: string }>;
    matched_count: number;
    instruction: string;
  };

  assert.equal(result.matched_count, 5, "候補は5件までに丸める");
  assert.match(result.instruction, /確認/);
  // 案件は3画面ぶんのカードが出る（編集 / 設問 / 分析）
  assert.equal(result.navigations.length, 15);
  for (const nav of result.navigations) {
    assert.ok(!nav.url.includes("/:"), `未解決URL: ${nav.url}`);
    assert.ok(nav.label.includes("｜"), "複数一致時は対象名をラベルに含める");
  }
});

test("resolve_entity: 一致ゼロは候補を作らず「見つからない」と正直に返す", async () => {
  const { clientRepository } = await import("../repositories/clientRepository");
  stub(
    clientRepository,
    "list",
    (async () => [{ id: "client-111", name: "株式会社ヨット" }] as never) as typeof clientRepository.list
  );

  const resolve = navTools.navigationToolDefinitions().find((d) => d.name === "resolve_entity");
  assert.ok(resolve);
  const result = (await resolve.execute(
    { type: "client", name: "存在しない企業ZZZ" },
    { entityId: null, screenKey: "dashboard" }
  )) as { navigations: unknown[]; matched_count: number; instruction: string };

  assert.deepEqual(result.navigations, []);
  assert.equal(result.matched_count, 0);
  assert.match(result.instruction, /見つかりません/);
});

test("resolve_entity の結果も navigations 封筒に載る（サーバー計算値のまま）", async () => {
  const { clientRepository } = await import("../repositories/clientRepository");
  stub(
    clientRepository,
    "list",
    (async () => [{ id: "client-abc", name: "株式会社ヨット" }] as never) as typeof clientRepository.list
  );

  navTools.registerNavigationTools();
  const result = await chat.adminChatService.runChat(
    { screenKey: "dashboard", entityId: null, messages: [{ role: "user", content: "ヨットのまとめ画面" }] },
    { callModel: modelCallingTool("resolve_entity", { type: "client", name: "ヨット" }) as never }
  );

  assert.equal(result.toolTrace[0]?.status, "ok");
  assert.equal(result.navigations.length, 1);
  assert.ok(result.navigations[0]?.url.includes("client-abc"));
});

// ── screen-search API（HTTP 層） ──────────────────────────────────────

test("GET /admin/api/screen-search は screenSearchService と同じ結果を JSON で返す", async () => {
  const { adminController } = await import("../controllers/adminController");
  const { searchScreens } = await import("../services/adminChat/screenSearchService");

  let payload: unknown = null;
  const res = {
    json(body: unknown) {
      payload = body;
      return this;
    },
  } as never;
  await adminController.screenSearchApi({ query: { q: "離脱" } } as never, res);

  const body = payload as {
    query: string;
    results: Array<{ key: string; label: string; url: string; group: string; matchedOn: string[] }>;
  };
  assert.ok(body, "レスポンスが無い");
  assert.equal(body.query, "離脱");
  assert.deepEqual(
    body.results.map((r) => r.key),
    searchScreens("離脱").map((r) => r.key),
    "API と service で結果が食い違っている"
  );
  assert.ok(body.results.some((r) => r.url === "/admin/cycles"));
  // 返す url はカタログ path のみ（クライアント入力を混ぜない）
  const paths = new Set(catalog.ADMIN_SCREENS.map((s) => s.path));
  for (const r of body.results) {
    assert.ok(paths.has(r.url), `カタログに無い url を返している: ${r.url}`);
    assert.ok(r.label && r.group && Array.isArray(r.matchedOn));
  }
});

test("screen-search: q が無い / 空 / 該当なし でも空 results で落ちない", async () => {
  const { adminController } = await import("../controllers/adminController");
  for (const query of [{}, { q: "" }, { q: "   " }, { q: 123 }, { q: "該当しない語ZZZQQQ" }]) {
    let payload: unknown = null;
    const res = {
      json(body: unknown) {
        payload = body;
        return this;
      },
    } as never;
    await adminController.screenSearchApi({ query } as never, res);
    const body = payload as { results: unknown[] };
    assert.ok(Array.isArray(body?.results), `results が配列でない: ${JSON.stringify(query)}`);
    assert.equal(body.results.length, 0, `候補が出てはいけない: ${JSON.stringify(query)}`);
  }
});

test("screen-search: q が配列（?q=a&q=b）でも先頭だけを見て落ちない", async () => {
  // Express は同名クエリを配列にする。bodyString() が先頭要素を取る既存の共通挙動で、
  // ここも例外を投げず「先頭の語で検索した」のと同じ結果になる。
  const { adminController } = await import("../controllers/adminController");
  const { searchScreens } = await import("../services/adminChat/screenSearchService");

  let payload: unknown = null;
  const res = {
    json(body: unknown) {
      payload = body;
      return this;
    },
  } as never;
  await adminController.screenSearchApi({ query: { q: ["離脱", "配信"] } } as never, res);

  const body = payload as { query: string; results: Array<{ key: string; url: string }> };
  assert.equal(body.query, "離脱", "先頭要素だけを検索語にする");
  assert.deepEqual(
    body.results.map((r) => r.key),
    searchScreens("離脱").map((r) => r.key)
  );
  // 配列を素通しして台帳外の URL を作らないこと
  const paths = new Set(catalog.ADMIN_SCREENS.map((s) => s.path));
  for (const r of body.results) assert.ok(paths.has(r.url));
});

test("screen-search API は AI を呼ばない（LLM 非依存の即時応答）", async () => {
  const { adminController } = await import("../controllers/adminController");
  let modelCalled = false;
  stub(chat.adminChatService, "runChat", (async () => {
    modelCalled = true;
    return {} as never;
  }) as typeof chat.adminChatService.runChat);

  const res = { json: () => undefined } as never;
  await adminController.screenSearchApi({ query: { q: "配信" } } as never, res);
  assert.equal(modelCalled, false);
});
