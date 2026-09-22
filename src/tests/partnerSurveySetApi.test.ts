/**
 * セットAPI（/api/partner/survey-sets/* と /api/partner-admin/*・docs/partner-api.md §9）のテスト。
 *
 * ここで守りたいこと:
 *   1. 所有者スコープ（他店のセットは存在ごと 404）
 *   2. 公開の入口が1つ（生成は draft・publishSet でだけ published になる）
 *   3. 割り当てのガード（回答あり・二重割り当ては 409）と、片側だけ書けたときの巻き戻し
 *   4. 一覧に設問本文が載らない
 *
 * 実 DB には触らない。repository を差し替えて express アプリを実際に立てて HTTP で叩く。
 * env は import 前に注入する必要があるため実装は動的 require で読み込む
 * （静的 import は巻き上げられて、この代入より先に env が確定してしまう）。
 */

import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, test } from "node:test";

const PARTNER_ADMIN_KEY = "partner-admin-key-for-test-0123456789";
const PARTNER_STORE_KEY = "partner-store-key-for-test-0123456789";

process.env.PARTNER_ADMIN_API_KEY = PARTNER_ADMIN_KEY;
process.env.PARTNER_API_KEY = PARTNER_STORE_KEY;
process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ??= "test-token";
process.env.LINE_CHANNEL_SECRET ??= "test-secret";
process.env.OPENAI_API_KEY ??= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ??= "00000000-0000-4000-8000-000000000000";
process.env.ADMIN_PASSWORD_HASH ??= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ??= "test-admin-session-secret-000000000000";

const express = require("express") as typeof import("express");
const httpLib = require("../lib/http") as typeof import("../lib/http");
const projectRepositoryModule =
  require("../repositories/projectRepository") as typeof import("../repositories/projectRepository");
const questionRepositoryModule =
  require("../repositories/questionRepository") as typeof import("../repositories/questionRepository");
const sessionRepositoryModule =
  require("../repositories/sessionRepository") as typeof import("../repositories/sessionRepository");
const storeRepositoryModule =
  require("../repositories/storeRepository") as typeof import("../repositories/storeRepository");
const cycleRepositoryModule =
  require("../repositories/cycleRepository") as typeof import("../repositories/cycleRepository");
const partnerRoutesModule =
  require("../routes/partnerRoutes") as typeof import("../routes/partnerRoutes");
const partnerAdminRoutesModule =
  require("../routes/partnerAdminRoutes") as typeof import("../routes/partnerAdminRoutes");
const setServiceModule =
  require("../services/partnerSurveySetService") as typeof import("../services/partnerSurveySetService");
const adminControllerModule =
  require("../controllers/adminController") as typeof import("../controllers/adminController");

import type {
  CycleGroup,
  CycleGroupStep,
  IndustryTemplate,
  Project,
  Question,
  Session,
  Store
} from "../types/domain";

const { projectRepository } = projectRepositoryModule;
const { questionRepository } = questionRepositoryModule;
const { sessionRepository } = sessionRepositoryModule;
const { storeRepository, industryTemplateRepository } = storeRepositoryModule;
const { cycleGroupRepository } = cycleRepositoryModule;
const { flattenTemplateQuestion, setAssignmentBlockedReason, buildPortalStoreSlug } =
  setServiceModule;

// ------------------------------------------------------------------
// フィクスチャ
// ------------------------------------------------------------------

const SET_ID = "55555555-5555-4555-8555-555555555555";
const STORE_ID = "66666666-6666-4666-8666-666666666666";
const PARTNER_STORE_ID = "77777777-7777-4777-8777-777777777777";
const OTHER_PARTNER_STORE_ID = "88888888-8888-4888-8888-888888888888";
const TEMPLATE_ID = "99999999-9999-4999-8999-999999999999";
const SECRET_QUESTION_TEXT = "専門家が練った設問本文（一覧に出てはいけない）";

function store(overrides: Partial<Store> = {}): Store {
  return {
    id: STORE_ID,
    client_id: "c0000000-0000-4000-8000-000000000001",
    industry_template_id: TEMPLATE_ID,
    name: "テスト美容室",
    code_slug: "m123",
    partner_store_id: PARTNER_STORE_ID,
    reward_points_override: null,
    is_active: true,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides
  } as Store;
}

function group(overrides: Partial<CycleGroup> = {}): CycleGroup {
  return {
    id: SET_ID,
    name: "テスト美容室 美容室ABCサイクル",
    store_id: STORE_ID,
    entry_project_id: "p-a",
    created_at: "2026-09-01T00:00:00.000Z",
    ...overrides
  } as CycleGroup;
}

function steps(): CycleGroupStep[] {
  return [
    { id: "s1", cycle_group_id: SET_ID, project_id: "p-a", step_order: 1, step_role: "entry" },
    { id: "s2", cycle_group_id: SET_ID, project_id: "p-b", step_order: 2, step_role: "followup" },
    { id: "s3", cycle_group_id: SET_ID, project_id: "p-c", step_order: 3, step_role: "verify" }
  ] as CycleGroupStep[];
}

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "p-a",
    name: "【テスト美容室】A：来店すぐアンケート",
    user_display_title: null,
    client_name: "テスト美容室",
    client_id: null,
    objective: null,
    status: "draft",
    reward_points: 5,
    visibility_type: "private_store",
    entry_code: "m123-a",
    partner_store_id: PARTNER_STORE_ID,
    partner_readonly: true,
    is_discoverable: false,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides
  } as unknown as Project;
}

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "qid",
    project_id: "p-a",
    question_code: "Q1",
    question_text: SECRET_QUESTION_TEXT,
    question_role: "main",
    question_type: "single_choice",
    is_required: true,
    sort_order: 10,
    question_config: { options: [{ value: "a", label: "A" }] },
    is_system: false,
    is_hidden: false,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...overrides
  } as unknown as Question;
}

function session(overrides: Partial<Session> = {}): Session {
  return { id: "sess", project_id: "p-a", status: "completed", ...overrides } as unknown as Session;
}

function template(overrides: Partial<IndustryTemplate> = {}): IndustryTemplate {
  return {
    id: TEMPLATE_ID,
    name: "美容室ABCサイクル",
    industry_code: "salon",
    description: null,
    entry_template_project_id: "tpl-a",
    followup_template_project_id: "tpl-b",
    verify_template_project_id: "tpl-c",
    is_enabled: true,
    ...overrides
  } as IndustryTemplate;
}

// ------------------------------------------------------------------
// テスト用サーバー
// ------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use("/api/partner", partnerRoutesModule.partnerRoutes);
app.use("/api/partner-admin", partnerAdminRoutesModule.partnerAdminRoutes);
app.use(httpLib.errorHandler);

const server = app.listen(0);
after(() => {
  server.close();
});

interface CallResult {
  status: number;
  body: Record<string, unknown>;
  raw: string;
}

async function call(
  method: string,
  path: string,
  options: { storeId?: string | null; adminKey?: string; body?: unknown } = {}
): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.adminKey) {
    headers["x-partner-admin-key"] = options.adminKey;
  } else {
    headers["x-partner-key"] = PARTNER_STORE_KEY;
    if (options.storeId !== null) {
      headers["x-partner-store-id"] = options.storeId ?? PARTNER_STORE_ID;
    }
  }
  const response = await fetch(`http://127.0.0.1:${(server.address() as AddressInfo).port}${path}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { status: response.status, body, raw };
}

/** repository のメソッドを差し替え、テスト終了時に必ず戻す。 */
function stub<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): () => void {
  const original = target[key];
  target[key] = value;
  return () => {
    target[key] = original;
  };
}

/** セット1件が読める状態を作る共通スタブ。 */
function stubSet(
  opts: {
    storeOverrides?: Partial<Store>;
    projectFor?: (id: string) => Project;
    completedPerProject?: number;
  } = {}
): (() => void)[] {
  return [
    stub(cycleGroupRepository, "getById", async () => group()),
    stub(cycleGroupRepository, "listSteps", async () => steps()),
    stub(storeRepository, "getById", async () => store(opts.storeOverrides)),
    stub(projectRepository, "getById", async (id: string) =>
      opts.projectFor ? opts.projectFor(id) : project({ id })
    ),
    stub(sessionRepository, "listByProject", async () =>
      Array.from({ length: opts.completedPerProject ?? 0 }, (_, i) =>
        session({ id: `sess-${i}` })
      )
    )
  ];
}

function restoreAll(restores: (() => void)[]): void {
  for (const restore of restores) restore();
}

// ------------------------------------------------------------------
// 純関数
// ------------------------------------------------------------------

test("展示用の平坦化: 表現できる設問はそのまま、できない設問は note を付けて残す", () => {
  const mapped = flattenTemplateQuestion(question({ question_type: "single_choice" }), "entry");
  assert.equal(mapped.question_type, "single_choice");
  assert.equal(mapped.note, null);
  assert.deepEqual(mapped.answer_options, [{ value: "a", label: "A" }]);

  // マトリクスは設問形式の拡張（4種→9種）で表現できるようになったので、
  // note 送りにせず種別そのままで展示する。
  const matrix = flattenTemplateQuestion(
    question({ question_type: "matrix_single", question_config: null }),
    "followup"
  );
  assert.equal(matrix.question_type, "matrix_single");
  assert.equal(matrix.role, "followup");

  // 一対比較など、今も表現できない種別は従来どおり note を付けて残す
  // （黙って消すと展示が実物より痩せる）。
  const unmapped = flattenTemplateQuestion(
    question({ question_type: "pairwise", question_config: null }),
    "followup"
  );
  assert.equal(unmapped.question_type, "single_choice");
  assert.equal(unmapped.answer_options, null, "実物と違う選択肢を見せてはいけない");
  assert.match(unmapped.note ?? "", /pairwise/);
});

test("free_text の展示には選択肢を付けない", () => {
  const view = flattenTemplateQuestion(question({ question_type: "free_text_long" }), "entry");
  assert.equal(view.question_type, "free_text");
  assert.equal(view.answer_options, null);
});

test("割り当てガード: 既に紐づけ済み・回答ありはそれぞれ理由を返す", () => {
  assert.equal(setAssignmentBlockedReason(store({ partner_store_id: null }), 0), null);
  assert.match(
    setAssignmentBlockedReason(store({ partner_store_id: PARTNER_STORE_ID }), 0) ?? "",
    /already linked/
  );
  assert.match(setAssignmentBlockedReason(store({ partner_store_id: null }), 3) ?? "", /3 completed/);
});

test("店舗コードは会員番号から作り、無ければ店舗IDの先頭から作る", () => {
  assert.equal(buildPortalStoreSlug({ memberNo: "123", partnerStoreId: PARTNER_STORE_ID }), "m123");
  // 記号混じりでも entry_code に使える文字だけに落とす（QRのURLに入るため）。
  assert.equal(buildPortalStoreSlug({ memberNo: "A-12/3", partnerStoreId: PARTNER_STORE_ID }), "ma123");
  assert.equal(
    buildPortalStoreSlug({ memberNo: null, partnerStoreId: PARTNER_STORE_ID }),
    "m77777777"
  );
});

test("管理画面の公開ガード: 会員店舗に紐づく未公開案件を published にできない", () => {
  const { assertPortalStoreProjectNotPublishedByAdmin: guard } = adminControllerModule;

  assert.throws(
    () => guard({ partner_store_id: PARTNER_STORE_ID, status: "draft" }, "published"),
    /会員店舗/
  );
  // 非公開方向は止めない（運営が止めるのは常に安全側）。
  assert.doesNotThrow(() => guard({ partner_store_id: PARTNER_STORE_ID, status: "published" }, "closed"));
  // 既に公開済みなら状態は変わらないので通す（保存のたびに落ちない）。
  assert.doesNotThrow(() =>
    guard({ partner_store_id: PARTNER_STORE_ID, status: "published" }, "published")
  );
  // 会員店舗と無関係な案件は従来どおり。
  assert.doesNotThrow(() => guard({ partner_store_id: null, status: "draft" }, "published"));
  assert.doesNotThrow(() => guard(null, "published"));
});

// ------------------------------------------------------------------
// 所有者スコープ
// ------------------------------------------------------------------

test("他店のセットは存在ごと 404（所有者スコープ）", async () => {
  const restores = stubSet();
  try {
    const result = await call("GET", `/api/partner/survey-sets/${SET_ID}`, {
      storeId: OTHER_PARTNER_STORE_ID
    });
    assert.equal(result.status, 404);
    assert.equal(result.body.error, "survey set not found");
    assert.ok(!result.raw.includes("テスト美容室"), "他店の店舗名を漏らしてはいけない");
  } finally {
    restoreAll(restores);
  }
});

test("UUID でないセットIDは 404（存在しないIDとして扱う）", async () => {
  const result = await call("GET", "/api/partner/survey-sets/not-a-uuid");
  assert.equal(result.status, 404);
});

test("X-Partner-Store-Id が無ければ 400", async () => {
  const result = await call("GET", `/api/partner/survey-sets/${SET_ID}`, { storeId: null });
  assert.equal(result.status, 400);
});

test("自店のセットは A→B→C の順で読める", async () => {
  const restores = stubSet();
  try {
    const result = await call("GET", `/api/partner/survey-sets/${SET_ID}`);
    assert.equal(result.status, 200);
    const surveys = result.body.surveys as { role: string; status: string }[];
    assert.deepEqual(surveys.map((s) => s.role), ["entry", "followup", "verify"]);
    assert.equal(result.body.published, false, "draft のうちは未公開として見せる");
    assert.equal(result.body.answer_url, null, "未公開なら回答URLは出さない");
  } finally {
    restoreAll(restores);
  }
});

// ------------------------------------------------------------------
// 公開（QR発行）
// ------------------------------------------------------------------

test("publish でセット3件すべてが published になる", async () => {
  const published: { id: string; status: string }[] = [];
  const restores = [
    ...stubSet(),
    stub(projectRepository, "updateStatus", async (id: string, status: Project["status"]) => {
      published.push({ id, status });
      return project({ id, status });
    })
  ];
  try {
    const result = await call("POST", `/api/partner/survey-sets/${SET_ID}/publish`);
    assert.equal(result.status, 200);
    assert.deepEqual(published.map((p) => p.id).sort(), ["p-a", "p-b", "p-c"]);
    assert.ok(published.every((p) => p.status === "published"));
  } finally {
    restoreAll(restores);
  }
});

test("publish は冪等（既に公開済みなら書き直さない）", async () => {
  let writes = 0;
  const restores = [
    ...stubSet({ projectFor: (id) => project({ id, status: "published" }) }),
    stub(projectRepository, "updateStatus", async (id: string) => {
      writes += 1;
      return project({ id });
    })
  ];
  try {
    const result = await call("POST", `/api/partner/survey-sets/${SET_ID}/publish`);
    assert.equal(result.status, 200);
    assert.equal(writes, 0, "公開済みに再書き込みしてはいけない");
    assert.equal(result.body.published, true);
    assert.ok(String(result.body.answer_url ?? "").includes("m123-a"), "A の回答URLを返すこと");
  } finally {
    restoreAll(restores);
  }
});

test("締切済みのセットは公開し直せない（終わった調査を勝手に再開しない）", async () => {
  const restores = [
    ...stubSet({ projectFor: (id) => project({ id, status: id === "p-c" ? "closed" : "draft" }) }),
    stub(projectRepository, "updateStatus", async (id: string) => project({ id }))
  ];
  try {
    const result = await call("POST", `/api/partner/survey-sets/${SET_ID}/publish`);
    assert.equal(result.status, 409);
  } finally {
    restoreAll(restores);
  }
});

test("他店は publish できない（404・公開の横取りを防ぐ）", async () => {
  let writes = 0;
  const restores = [
    ...stubSet(),
    stub(projectRepository, "updateStatus", async (id: string) => {
      writes += 1;
      return project({ id });
    })
  ];
  try {
    const result = await call("POST", `/api/partner/survey-sets/${SET_ID}/publish`, {
      storeId: OTHER_PARTNER_STORE_ID
    });
    assert.equal(result.status, 404);
    assert.equal(writes, 0);
  } finally {
    restoreAll(restores);
  }
});

// ------------------------------------------------------------------
// 生成
// ------------------------------------------------------------------

test("セット生成は draft・閲覧専用で、業種テンプレが無ければ 404", async () => {
  const restores = [stub(industryTemplateRepository, "getById", async () => null)];
  try {
    const result = await call("POST", "/api/partner/survey-sets", {
      body: {
        industry_template_id: TEMPLATE_ID,
        store: { name: "テスト美容室", member_no: "123" }
      }
    });
    assert.equal(result.status, 404);
  } finally {
    restoreAll(restores);
  }
});

test("無効化された業種テンプレでは注文できない", async () => {
  const restores = [
    stub(industryTemplateRepository, "getById", async () => template({ is_enabled: false }))
  ];
  try {
    const result = await call("POST", "/api/partner/survey-sets", {
      body: { industry_template_id: TEMPLATE_ID, store: { name: "店" } }
    });
    assert.equal(result.status, 409);
  } finally {
    restoreAll(restores);
  }
});

test("industry_template_id が UUID でなければ 400", async () => {
  const result = await call("POST", "/api/partner/survey-sets", {
    body: { industry_template_id: "not-uuid", store: { name: "店" } }
  });
  assert.equal(result.status, 400);
});

// ------------------------------------------------------------------
// 運営API: 業種テンプレ一覧
// ------------------------------------------------------------------

test("業種テンプレ一覧は運営鍵が要る（店舗鍵では入れない）", async () => {
  const result = await call("GET", "/api/partner-admin/industry-templates", {
    adminKey: PARTNER_STORE_KEY
  });
  assert.equal(result.status, 401);
});

test("業種テンプレ一覧は A→B→C の展示設問を返す", async () => {
  const restores = [
    stub(industryTemplateRepository, "list", async () => [template()]),
    stub(questionRepository, "listByProject", async (projectId: string) => [
      question({ question_text: `${projectId} の設問` })
    ])
  ];
  try {
    const result = await call("GET", "/api/partner-admin/industry-templates", {
      adminKey: PARTNER_ADMIN_KEY
    });
    assert.equal(result.status, 200);
    const templates = result.body.templates as { questions: { role: string }[] }[];
    assert.equal(templates.length, 1);
    assert.deepEqual(templates[0]?.questions.map((q) => q.role), ["entry", "followup", "verify"]);
  } finally {
    restoreAll(restores);
  }
});

test("無効化された業種テンプレは一覧に出ない", async () => {
  const restores = [
    stub(industryTemplateRepository, "list", async () => [template({ is_enabled: false })]),
    stub(questionRepository, "listByProject", async () => [question()])
  ];
  try {
    const result = await call("GET", "/api/partner-admin/industry-templates", {
      adminKey: PARTNER_ADMIN_KEY
    });
    assert.deepEqual(result.body.templates, []);
  } finally {
    restoreAll(restores);
  }
});

// ------------------------------------------------------------------
// 運営API: 割り当て
// ------------------------------------------------------------------

test("割り当て候補一覧に設問本文が含まれない（漏洩対策）", async () => {
  const restores = [
    stub(storeRepository, "listUnlinkedToPartner", async () => [store({ partner_store_id: null })]),
    stub(cycleGroupRepository, "listByStores", async () => [group()]),
    stub(cycleGroupRepository, "listSteps", async () => steps()),
    stub(sessionRepository, "listByProject", async () => [])
  ];
  try {
    const result = await call("GET", "/api/partner-admin/assignable-survey-sets", {
      adminKey: PARTNER_ADMIN_KEY
    });
    assert.equal(result.status, 200);
    assert.ok(!result.raw.includes(SECRET_QUESTION_TEXT), "一覧に設問本文を載せてはいけない");
    const sets = result.body.sets as { assignable: boolean; step_count: number }[];
    assert.equal(sets[0]?.assignable, true);
    assert.equal(sets[0]?.step_count, 3);
  } finally {
    restoreAll(restores);
  }
});

test("回答が入っているセットは割り当てられない（他店の回答者データを見せない）", async () => {
  const restores = [
    stub(cycleGroupRepository, "getById", async () => group()),
    stub(cycleGroupRepository, "listSteps", async () => steps()),
    stub(storeRepository, "getById", async () => store({ partner_store_id: null })),
    stub(sessionRepository, "listByProject", async () => [session()]),
    stub(storeRepository, "linkPartnerStore", async () => {
      throw new Error("書き込んではいけない");
    })
  ];
  try {
    const result = await call("POST", `/api/partner-admin/survey-sets/${SET_ID}/assign`, {
      adminKey: PARTNER_ADMIN_KEY,
      body: { store_id: PARTNER_STORE_ID }
    });
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /completed session/);
  } finally {
    restoreAll(restores);
  }
});

test("既に会員店舗へ紐づいたセットは 409", async () => {
  const restores = [
    stub(cycleGroupRepository, "getById", async () => group()),
    stub(cycleGroupRepository, "listSteps", async () => steps()),
    stub(storeRepository, "getById", async () => store()),
    stub(sessionRepository, "listByProject", async () => [])
  ];
  try {
    const result = await call("POST", `/api/partner-admin/survey-sets/${SET_ID}/assign`, {
      adminKey: PARTNER_ADMIN_KEY,
      body: { store_id: OTHER_PARTNER_STORE_ID }
    });
    assert.equal(result.status, 409);
    assert.match(String(result.body.error), /already linked/);
  } finally {
    restoreAll(restores);
  }
});

test("案件の一部しか紐づけられなければ店舗ごと巻き戻す（片側書き込みを残さない）", async () => {
  let unlinkedProjects = false;
  let unlinkedStore = false;
  let unlinkedIds: string[] = [];
  const restores = [
    stub(cycleGroupRepository, "getById", async () => group()),
    stub(cycleGroupRepository, "listSteps", async () => steps()),
    stub(storeRepository, "getById", async () => store({ partner_store_id: null })),
    stub(storeRepository, "getByPartnerStoreId", async () => null),
    stub(sessionRepository, "listByProject", async () => []),
    stub(storeRepository, "linkPartnerStore", async () => store()),
    // 3件のうち1件しか更新できなかった（別の運営操作が割り込んだ）状況。
    stub(projectRepository, "linkPartnerStoreForProjects", async () => [project()]),
    stub(projectRepository, "unlinkPartnerStoreForProjects", async (ids: string[]) => {
      unlinkedProjects = true;
      unlinkedIds = ids;
      return [];
    }),
    stub(storeRepository, "unlinkPartnerStore", async () => {
      unlinkedStore = true;
      return store({ partner_store_id: null });
    })
  ];
  try {
    const result = await call("POST", `/api/partner-admin/survey-sets/${SET_ID}/assign`, {
      adminKey: PARTNER_ADMIN_KEY,
      body: { store_id: PARTNER_STORE_ID }
    });
    assert.equal(result.status, 409);
    assert.ok(unlinkedProjects, "案件側の紐づけを戻すこと");
    assert.ok(unlinkedStore, "店舗側の紐づけも戻すこと");
    // ⚠ 巻き戻すのは自分が書けた案件だけ。全件を unlink すると、link に失敗した案件
    // （＝既に別店舗のもの）が watch 紐づけ（partner_readonly=true）だった場合に、
    // 無関係な店舗の閲覧専用紐づけまで剥がしてしまう。
    assert.deepEqual(unlinkedIds, ["p-a"], "link できた案件だけを巻き戻すこと");
  } finally {
    restoreAll(restores);
  }
});

test("割り当てに成功しても published にはしない（公開はQR発行だけ）", async () => {
  const restores = [
    stub(cycleGroupRepository, "getById", async () => group()),
    stub(cycleGroupRepository, "listSteps", async () => steps()),
    stub(storeRepository, "getById", async () => store({ partner_store_id: null })),
    stub(storeRepository, "getByPartnerStoreId", async () => null),
    stub(sessionRepository, "listByProject", async () => []),
    stub(storeRepository, "linkPartnerStore", async () => store()),
    stub(projectRepository, "linkPartnerStoreForProjects", async () => [
      project({ id: "p-a" }),
      project({ id: "p-b" }),
      project({ id: "p-c" })
    ]),
    stub(projectRepository, "getById", async (id: string) => project({ id })),
    stub(projectRepository, "updateStatus", async () => {
      throw new Error("割り当てで公開してはいけない");
    })
  ];
  try {
    const result = await call("POST", `/api/partner-admin/survey-sets/${SET_ID}/assign`, {
      adminKey: PARTNER_ADMIN_KEY,
      body: { store_id: PARTNER_STORE_ID }
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.published, false);
  } finally {
    restoreAll(restores);
  }
});

test("回答のあるセットは割り当て解除できない", async () => {
  const restores = [
    stub(cycleGroupRepository, "getById", async () => group()),
    stub(cycleGroupRepository, "listSteps", async () => steps()),
    stub(storeRepository, "getById", async () => store()),
    stub(sessionRepository, "listByProject", async () => [session()])
  ];
  try {
    const result = await call("POST", `/api/partner-admin/survey-sets/${SET_ID}/unassign`, {
      adminKey: PARTNER_ADMIN_KEY
    });
    assert.equal(result.status, 409);
  } finally {
    restoreAll(restores);
  }
});

test("未紐づけのセットの解除は冪等（何もせず 200）", async () => {
  const restores = [
    stub(cycleGroupRepository, "getById", async () => group()),
    stub(cycleGroupRepository, "listSteps", async () => steps()),
    stub(storeRepository, "getById", async () => store({ partner_store_id: null })),
    stub(sessionRepository, "listByProject", async () => []),
    stub(projectRepository, "getById", async (id: string) => project({ id })),
    stub(storeRepository, "unlinkPartnerStore", async () => {
      throw new Error("既に外れているのに書き込んではいけない");
    })
  ];
  try {
    const result = await call("POST", `/api/partner-admin/survey-sets/${SET_ID}/unassign`, {
      adminKey: PARTNER_ADMIN_KEY
    });
    assert.equal(result.status, 200);
  } finally {
    restoreAll(restores);
  }
});
