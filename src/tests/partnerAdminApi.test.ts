/**
 * 運営専用API（/api/partner-admin/*・docs/partner-api.md §8）のテスト。
 *
 * 実 DB には触らない。repository のメソッドを差し替えて（CommonJS のエクスポート
 * オブジェクトを直接書き換える）、express アプリを実際に立てて HTTP で叩く。
 * 認証・ガード（409）・レスポンスに設問本文が載らないこと、が検証対象。
 *
 * env は import 前に注入する必要があるため、実装は動的 require で読み込む
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
const partnerAdminRoutesModule =
  require("../routes/partnerAdminRoutes") as typeof import("../routes/partnerAdminRoutes");
const partnerAssignmentServiceModule =
  require("../services/partnerAssignmentService") as typeof import("../services/partnerAssignmentService");

import type { Project, Question, Session } from "../types/domain";

const { projectRepository } = projectRepositoryModule;
const { questionRepository } = questionRepositoryModule;
const { sessionRepository } = sessionRepositoryModule;
const { findUnmappableQuestions, assignmentBlockedReason } = partnerAssignmentServiceModule;

// ------------------------------------------------------------------
// フィクスチャ
// ------------------------------------------------------------------

const SECRET_QUESTION_TEXT = "専門家が練った設問本文（一覧に出てはいけない）";

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "運営が作った案件",
    user_display_title: "運営が作った案件",
    client_name: null,
    client_id: null,
    objective: null,
    status: "draft",
    reward_points: 0,
    visibility_type: "public",
    entry_code: null,
    partner_store_id: null,
    is_discoverable: false,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides
  } as unknown as Project;
}

function question(overrides: Partial<Question> = {}): Question {
  return {
    id: "qid",
    project_id: "11111111-1111-4111-8111-111111111111",
    question_code: "q1",
    question_text: SECRET_QUESTION_TEXT,
    comment_top: null,
    comment_bottom: null,
    question_role: "main",
    question_type: "single_choice",
    is_required: true,
    sort_order: 10,
    answer_output_type: null,
    display_tags_raw: null,
    display_tags_parsed: null,
    visibility_conditions: null,
    page_group_id: null,
    branch_rule: null,
    question_config: null,
    ai_probe_enabled: false,
    probe_guideline: null,
    max_probe_count: null,
    render_strategy: "static",
    answer_options_locked: false,
    is_screening_question: false,
    is_system: false,
    is_hidden: false,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides
  } as unknown as Question;
}

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: "sid",
    project_id: "11111111-1111-4111-8111-111111111111",
    respondent_id: "rid",
    status: "completed",
    ...overrides
  } as unknown as Session;
}

// ------------------------------------------------------------------
// テスト用サーバー
// ------------------------------------------------------------------

const app = express();
app.use(express.json());
app.use("/api/partner-admin", partnerAdminRoutesModule.partnerAdminRoutes);
app.use(httpLib.errorHandler);

const server = app.listen(0);
after(() => {
  server.close();
});

function baseUrl(): string {
  const address = server.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

interface CallResult {
  status: number;
  body: Record<string, unknown>;
  raw: string;
}

async function call(
  method: string,
  path: string,
  options: { key?: string | null; storeKey?: string | null; body?: unknown } = {}
): Promise<CallResult> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.key !== null && options.key !== undefined) {
    headers["x-partner-admin-key"] = options.key;
  }
  if (options.storeKey) {
    headers["x-partner-key"] = options.storeKey;
  }
  const response = await fetch(`${baseUrl()}${path}`, {
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

/**
 * 性年代設問の作り直し（ensureDemographicQuestions）が使う書き込みを無害化する。
 * サービスの関数そのものは差し替えられない（ESM の名前付きエクスポートは getter のみ）ので、
 * その下の repository を差し替える。
 */
function stubDemographicWrites(): (() => void)[] {
  return [
    stub(questionRepository, "getByProjectAndCode", async () => null),
    stub(questionRepository, "create", async () => question({ is_system: true })),
    stub(questionRepository, "update", async () => question({ is_system: true }))
  ];
}

/** repository のメソッドを差し替え、テスト終了時に必ず戻す。 */
function stub<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): () => void {
  const original = target[key];
  target[key] = value;
  return () => {
    target[key] = original;
  };
}

// ------------------------------------------------------------------
// 認証
// ------------------------------------------------------------------

test("鍵が未設定なら 503（PARTNER_API_KEY にフォールバックしない）", async () => {
  const envModule = require("../config/env") as typeof import("../config/env");
  const restore = stub(
    envModule.env as unknown as Record<string, unknown>,
    "PARTNER_ADMIN_API_KEY",
    undefined
  );
  try {
    const result = await call("GET", "/api/partner-admin/assignable-surveys", {
      key: PARTNER_ADMIN_KEY
    });
    assert.equal(result.status, 503);
    assert.equal(result.body.error, "partner admin API is not configured");

    // PARTNER_API_KEY は設定されているが、それでも通ってはいけない（fail-closed）。
    const withStoreKey = await call("GET", "/api/partner-admin/assignable-surveys", {
      key: PARTNER_STORE_KEY
    });
    assert.equal(withStoreKey.status, 503);
  } finally {
    restore();
  }
});

test("鍵が違えば 401。ヘッダ未提示も 401", async () => {
  const wrong = await call("GET", "/api/partner-admin/assignable-surveys", { key: "wrong-key" });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, "unauthorized");

  const missing = await call("GET", "/api/partner-admin/assignable-surveys", { key: null });
  assert.equal(missing.status, 401);
});

test("店舗用の PARTNER_API_KEY では /api/partner-admin/* に入れない", async () => {
  // 値としては有効な「店舗用の鍵」を X-Partner-Admin-Key に載せても 401。
  const asAdminHeader = await call("GET", "/api/partner-admin/assignable-surveys", {
    key: PARTNER_STORE_KEY
  });
  assert.equal(asAdminHeader.status, 401);

  // 店舗API の作法どおり X-Partner-Key / X-Partner-Store-Id を送っても通らない。
  const asStoreHeader = await call("GET", "/api/partner-admin/assignable-surveys", {
    key: null,
    storeKey: PARTNER_STORE_KEY
  });
  assert.equal(asStoreHeader.status, 401);
});

// ------------------------------------------------------------------
// 候補一覧
// ------------------------------------------------------------------

test("候補一覧に設問本文が含まれない（漏洩対策）", async () => {
  const restoreProjects = stub(projectRepository, "listAssignableForPartner", async () => [
    project()
  ]);
  const restoreQuestions = stub(questionRepository, "listByProject", async () => [
    question({ question_code: "q1" }),
    question({ id: "qid2", question_code: "q2", question_type: "free_text_long" })
  ]);
  try {
    const result = await call("GET", "/api/partner-admin/assignable-surveys", {
      key: PARTNER_ADMIN_KEY
    });
    assert.equal(result.status, 200);
    const surveys = result.body.surveys as Record<string, unknown>[];
    assert.equal(surveys.length, 1);
    assert.equal(surveys[0]?.question_count, 2);
    assert.equal(surveys[0]?.assignable, true);
    assert.equal(surveys[0]?.blocked_reason, null);
    // レスポンス全文に設問本文が出てこないこと。
    assert.equal(result.raw.includes(SECRET_QUESTION_TEXT), false);
    assert.equal("questions" in (surveys[0] ?? {}), false);
  } finally {
    restoreProjects();
    restoreQuestions();
  }
});

test("client_id 付き・割り当て済み・is_discoverable・非 draft/ready は候補に出ない", () => {
  // repository の抽出条件（listAssignableForPartner）と同じ判定を純関数側でも持ち、
  // 万一 DB から混ざって返っても assignable=false になることを担保する。
  assert.equal(assignmentBlockedReason(project()), null);
  assert.equal(
    assignmentBlockedReason(project({ client_id: "22222222-2222-4222-8222-222222222222" })),
    "project belongs to a client"
  );
  assert.equal(
    assignmentBlockedReason(project({ partner_store_id: "33333333-3333-4333-8333-333333333333" })),
    "already assigned to a store"
  );
  assert.equal(
    assignmentBlockedReason(project({ is_discoverable: true })),
    "project is discoverable in the public list"
  );
  assert.equal(
    assignmentBlockedReason(project({ status: "published" })),
    "status must be draft or ready (current: published)"
  );
  assert.equal(assignmentBlockedReason(project({ status: "ready" })), null);
});

test("混ざって返ってきた不適格案件は assignable=false + 理由付きで出る", async () => {
  const restoreProjects = stub(projectRepository, "listAssignableForPartner", async () => [
    project({ id: "44444444-4444-4444-8444-444444444444", is_discoverable: true })
  ]);
  const restoreQuestions = stub(questionRepository, "listByProject", async () => [question()]);
  try {
    const result = await call("GET", "/api/partner-admin/assignable-surveys", {
      key: PARTNER_ADMIN_KEY
    });
    const surveys = result.body.surveys as Record<string, unknown>[];
    assert.equal(surveys[0]?.assignable, false);
    assert.equal(surveys[0]?.blocked_reason, "project is discoverable in the public list");
  } finally {
    restoreProjects();
    restoreQuestions();
  }
});

// ------------------------------------------------------------------
// 4種への写像
// ------------------------------------------------------------------

test("findUnmappableQuestions: 4種に写像できない設問だけを拾う（性年代とシステム設問は対象外）", () => {
  const unmappable = findUnmappableQuestions([
    question({ question_code: "q1", question_type: "single_choice" }),
    question({ id: "q2", question_code: "q2", question_type: "matrix_single" }),
    question({ id: "q3", question_code: "q3", question_type: "image_upload" }),
    // システム設問（free_comment）は元々パートナーに見せないので対象外
    question({ id: "q4", question_code: "free_comment", question_type: "matrix_single", is_system: true }),
    // 既に退避済み（is_hidden）も対象外
    question({ id: "q5", question_code: "q5_retired0", question_type: "matrix_single", is_hidden: true })
  ]);
  assert.deepEqual(
    unmappable.map((entry) => entry.question_code),
    ["q2", "q3"]
  );
});

// ------------------------------------------------------------------
// 割り当て（409 のガード）
// ------------------------------------------------------------------

const TARGET_ID = "11111111-1111-4111-8111-111111111111";
const STORE_ID = "33333333-3333-4333-8333-333333333333";

function stubAssignEnvironment(options: {
  target: Project;
  questions?: Question[];
  sessions?: Session[];
  assignResult?: Project | null;
}): () => void {
  const restores = [
    stub(projectRepository, "getById", async () => options.target),
    stub(questionRepository, "listByProject", async () => options.questions ?? [question()]),
    stub(sessionRepository, "listByProject", async () => options.sessions ?? []),
    stub(projectRepository, "assignPartnerStore", async () =>
      options.assignResult === undefined
        ? ({ ...options.target, partner_store_id: STORE_ID } as Project)
        : options.assignResult
    ),
    stub(projectRepository, "findAnyByEntryCode", async () => null),
    // 割り当て後の ensureDemographicQuestions が実 DB を叩かないようにする
    // （性年代設問の不変条件そのものは既存の partnerApi テストが担保している）。
    ...stubDemographicWrites()
  ];
  return () => {
    for (const restore of restores.reverse()) {
      restore();
    }
  };
}

test("既に割り当て済みの案件への assign は 409", async () => {
  const restore = stubAssignEnvironment({
    target: project({ id: TARGET_ID, partner_store_id: "99999999-9999-4999-8999-999999999999" })
  });
  try {
    const result = await call("POST", `/api/partner-admin/surveys/${TARGET_ID}/assign`, {
      key: PARTNER_ADMIN_KEY,
      body: { store_id: STORE_ID }
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "already assigned to a store");
  } finally {
    restore();
  }
});

test("条件付きUPDATE が0件（同時実行で先を越された）なら 409", async () => {
  const restore = stubAssignEnvironment({
    target: project({ id: TARGET_ID }),
    assignResult: null
  });
  try {
    const result = await call("POST", `/api/partner-admin/surveys/${TARGET_ID}/assign`, {
      key: PARTNER_ADMIN_KEY,
      body: { store_id: STORE_ID }
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "already assigned to a store");
  } finally {
    restore();
  }
});

test("client_id 付き案件への assign は 409", async () => {
  const restore = stubAssignEnvironment({
    target: project({ id: TARGET_ID, client_id: "22222222-2222-4222-8222-222222222222" })
  });
  try {
    const result = await call("POST", `/api/partner-admin/surveys/${TARGET_ID}/assign`, {
      key: PARTNER_ADMIN_KEY,
      body: { store_id: STORE_ID }
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "project belongs to a client");
  } finally {
    restore();
  }
});

test("完了セッションが1件でもあれば assign は 409", async () => {
  const restore = stubAssignEnvironment({
    target: project({ id: TARGET_ID }),
    sessions: [session(), session({ id: "sid2", status: "active" })]
  });
  try {
    const result = await call("POST", `/api/partner-admin/surveys/${TARGET_ID}/assign`, {
      key: PARTNER_ADMIN_KEY,
      body: { store_id: STORE_ID }
    });
    assert.equal(result.status, 409);
    assert.equal(result.body.error, "survey already has 1 completed session(s)");
  } finally {
    restore();
  }
});

test("4種に写像できない設問を含む案件の assign は 409（その設問を返す）", async () => {
  const restore = stubAssignEnvironment({
    target: project({ id: TARGET_ID }),
    questions: [
      question({ question_code: "q1" }),
      question({ id: "qid2", question_code: "q2", question_type: "matrix_single" })
    ]
  });
  try {
    const result = await call("POST", `/api/partner-admin/surveys/${TARGET_ID}/assign`, {
      key: PARTNER_ADMIN_KEY,
      body: { store_id: STORE_ID }
    });
    assert.equal(result.status, 409);
    assert.equal(String(result.body.error).includes("q2(matrix_single)"), true);
  } finally {
    restore();
  }
});

test("すべてのガードを通れば割り当てられる。status は published にならない", async () => {
  let captured: { projectId: string; storeId: string; patch: Record<string, unknown> } | null = null;
  const restoreEnv = stubAssignEnvironment({ target: project({ id: TARGET_ID, status: "ready" }) });
  const restoreAssign = stub(
    projectRepository,
    "assignPartnerStore",
    async (projectId: string, storeId: string, patch) => {
      captured = { projectId, storeId, patch: patch as unknown as Record<string, unknown> };
      return project({
        id: projectId,
        status: "ready",
        partner_store_id: storeId,
        visibility_type: "private_store",
        entry_code: String(patch.entry_code)
      });
    }
  );
  try {
    const result = await call("POST", `/api/partner-admin/surveys/${TARGET_ID}/assign`, {
      key: PARTNER_ADMIN_KEY,
      body: { store_id: STORE_ID }
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.store_id, STORE_ID);
    // 割り当てただけでは公開しない（QR発行前に回答が集まる穴を塞ぐ）。
    assert.equal(result.body.status, "ready");
    assert.notEqual(result.body.status, "published");
    assert.ok(captured);
    const call1 = captured as unknown as {
      storeId: string;
      patch: Record<string, unknown>;
    };
    assert.equal(call1.storeId, STORE_ID);
    assert.equal(call1.patch.visibility_type, "private_store");
    assert.equal(call1.patch.is_discoverable, false);
    assert.equal(typeof call1.patch.entry_code, "string");
    assert.equal(String(call1.patch.entry_code).startsWith("p-"), true);
  } finally {
    restoreAssign();
    restoreEnv();
  }
});

test("store_id が UUID でなければ 400。:id が UUID でなければ 404", async () => {
  const restore = stubAssignEnvironment({ target: project({ id: TARGET_ID }) });
  try {
    const badStore = await call("POST", `/api/partner-admin/surveys/${TARGET_ID}/assign`, {
      key: PARTNER_ADMIN_KEY,
      body: { store_id: "not-a-uuid" }
    });
    assert.equal(badStore.status, 400);
    assert.equal(String(badStore.body.error).startsWith("store_id:"), true);

    const missingStore = await call("POST", `/api/partner-admin/surveys/${TARGET_ID}/assign`, {
      key: PARTNER_ADMIN_KEY,
      body: {}
    });
    assert.equal(missingStore.status, 400);

    const badId = await call("POST", "/api/partner-admin/surveys/not-a-uuid/assign", {
      key: PARTNER_ADMIN_KEY,
      body: { store_id: STORE_ID }
    });
    assert.equal(badId.status, 404);
    assert.equal(badId.body.error, "survey not found");
  } finally {
    restore();
  }
});

// ------------------------------------------------------------------
// 割り当て解除
// ------------------------------------------------------------------

test("unassign は partner_store_id を外す。未割り当てへの二重呼び出しでも落ちない", async () => {
  let unassigned = 0;
  const restores = [
    stub(projectRepository, "getById", async () =>
      project({ id: TARGET_ID, partner_store_id: STORE_ID, visibility_type: "private_store" })
    ),
    stub(projectRepository, "unassignPartnerStore", async (projectId: string) => {
      unassigned += 1;
      return project({ id: projectId, partner_store_id: null, entry_code: null });
    }),
    stub(questionRepository, "listByProject", async () => [])
  ];
  try {
    const result = await call("POST", `/api/partner-admin/surveys/${TARGET_ID}/unassign`, {
      key: PARTNER_ADMIN_KEY
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.store_id, "");
    assert.equal(result.body.entry_code, null);
    assert.equal(unassigned, 1);
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
  }

  // 既に未割り当てなら UPDATE を投げずに 200（巻き戻しが二重に走っても安全）。
  const restoreIdempotent = [
    stub(projectRepository, "getById", async () => project({ id: TARGET_ID })),
    stub(projectRepository, "unassignPartnerStore", async () => {
      throw new Error("should not be called");
    }),
    stub(questionRepository, "listByProject", async () => [])
  ];
  try {
    const result = await call("POST", `/api/partner-admin/surveys/${TARGET_ID}/unassign`, {
      key: PARTNER_ADMIN_KEY
    });
    assert.equal(result.status, 200);
  } finally {
    for (const restore of restoreIdempotent.reverse()) {
      restore();
    }
  }
});

// ------------------------------------------------------------------
// 割り当て済み一覧
// ------------------------------------------------------------------

test("割り当て済み一覧にも設問本文は含まれない", async () => {
  const restore = stub(projectRepository, "listAssignedToPartner", async () => [
    project({ id: TARGET_ID, partner_store_id: STORE_ID, entry_code: "p-abc123" })
  ]);
  try {
    const result = await call("GET", "/api/partner-admin/assigned-surveys", {
      key: PARTNER_ADMIN_KEY
    });
    assert.equal(result.status, 200);
    const surveys = result.body.surveys as Record<string, unknown>[];
    assert.equal(surveys[0]?.store_id, STORE_ID);
    assert.equal(surveys[0]?.entry_code, "p-abc123");
    assert.equal(result.raw.includes(SECRET_QUESTION_TEXT), false);
  } finally {
    restore();
  }
});
