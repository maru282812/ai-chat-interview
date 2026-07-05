import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project, ProjectAssignment, Respondent } from "../types/domain";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_BASIC_USER ||= "admin";
process.env.ADMIN_BASIC_PASSWORD ||= "password";

const STORE_PROJECT_ID = "00000000-0000-4000-8000-000000000301";
const RESPONDENT_ID = "00000000-0000-4000-8000-000000000401";
const ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000501";
const LINE_USER_ID = "Uffffffffffffffffffffffffffffffff";

type SupabaseResponse = { data: unknown; error: { message: string } | null };
type QueryCall = { method: string; args: unknown[] };

let supabase: SupabaseClient;
let originalFrom: SupabaseClient["from"];
let projectRepository: typeof import("../repositories/projectRepository").projectRepository;
let respondentRepository: typeof import("../repositories/respondentRepository").respondentRepository;
let projectAssignmentRepository: typeof import("../repositories/projectAssignmentRepository").projectAssignmentRepository;
let storeEntryService: typeof import("../services/storeEntryService").storeEntryService;

before(async () => {
  ({ supabase } = await import("../config/supabase"));
  ({ projectRepository } = await import("../repositories/projectRepository"));
  ({ respondentRepository } = await import("../repositories/respondentRepository"));
  ({ projectAssignmentRepository } = await import("../repositories/projectAssignmentRepository"));
  ({ storeEntryService } = await import("../services/storeEntryService"));
  originalFrom = supabase.from.bind(supabase) as unknown as SupabaseClient["from"];
});

afterEach(() => {
  if (originalFrom) {
    supabase.from = originalFrom;
  }
});

function createThenableSelectBuilder(response: SupabaseResponse, calls: QueryCall[]) {
  const builder = {
    select(...args: unknown[]) {
      calls.push({ method: "select", args });
      return builder;
    },
    eq(...args: unknown[]) {
      calls.push({ method: "eq", args });
      return builder;
    },
    or(...args: unknown[]) {
      calls.push({ method: "or", args });
      return builder;
    },
    order(...args: unknown[]) {
      calls.push({ method: "order", args });
      return builder;
    },
    maybeSingle() {
      calls.push({ method: "maybeSingle", args: [] });
      return Promise.resolve(response);
    },
    then<TResult1 = SupabaseResponse, TResult2 = never>(
      onfulfilled?: ((value: SupabaseResponse) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
    ) {
      return Promise.resolve(response).then(onfulfilled, onrejected);
    }
  };
  return builder;
}

function storeProjectFixture(): Project {
  return {
    id: STORE_PROJECT_ID,
    name: "abc美容室 単発アンケート",
    client_name: "abc美容室",
    objective: null,
    status: "published",
    reward_points: 30,
    research_mode: "survey_interview",
    display_mode: "survey_question",
    primary_objectives: [],
    secondary_objectives: [],
    comparison_constraints: [],
    prompt_rules: [],
    probe_policy: null,
    response_style: null,
    ai_state_json: null,
    ai_state_template_key: null,
    ai_state_generated_at: null,
    screening_config: null,
    screening_last_question_order: null,
    ai_prompt_policy_json: null,
    ai_prompt_templates_json: null,
    ai_prompt_mode: "custom",
    ai_prompt_package_version_id: null,
    delivery_enabled: false,
    delivery_type: null,
    delivered_at: null,
    visibility_type: "private_store",
    entry_code: "abc",
    client_id: null,
    created_at: "2026-06-21T00:00:00.000Z",
    updated_at: "2026-06-21T00:00:00.000Z"
  } as Project;
}

function respondentFixture(): Respondent {
  return {
    id: RESPONDENT_ID,
    line_user_id: LINE_USER_ID,
    display_name: null,
    project_id: STORE_PROJECT_ID,
    status: "invited",
    total_points: 0,
    current_rank_id: null,
    created_at: "2026-06-21T00:00:00.000Z",
    updated_at: "2026-06-21T00:00:00.000Z"
  } as Respondent;
}

function assignmentFixture(): ProjectAssignment {
  return {
    id: ASSIGNMENT_ID,
    project_id: STORE_PROJECT_ID,
    respondent_id: RESPONDENT_ID,
    status: "opened"
  } as ProjectAssignment;
}

// ---- 誤表示遮断: discovery クエリに visibility_type='public' 条件が入ること ----

test("listDiscoverable は status=published かつ visibility_type=public で絞る", async () => {
  const calls: QueryCall[] = [];
  supabase.from = ((_table: string) =>
    createThenableSelectBuilder({ data: [], error: null }, calls)) as unknown as SupabaseClient["from"];

  await projectRepository.listDiscoverable();

  const eqCalls = calls.filter((c) => c.method === "eq").map((c) => c.args);
  assert.ok(
    eqCalls.some((a) => a[0] === "status" && a[1] === "published"),
    "status=published 条件が必要"
  );
  assert.ok(
    eqCalls.some((a) => a[0] === "visibility_type" && a[1] === "public"),
    "visibility_type=public 条件が必要（private_store 漏れ防止）"
  );
});

test("getDiscoverableById は visibility_type=public で絞る（専用案件の直リンク露出防止）", async () => {
  const calls: QueryCall[] = [];
  supabase.from = ((_table: string) =>
    createThenableSelectBuilder({ data: null, error: null }, calls)) as unknown as SupabaseClient["from"];

  await projectRepository.getDiscoverableById(STORE_PROJECT_ID);

  const eqCalls = calls.filter((c) => c.method === "eq").map((c) => c.args);
  assert.ok(eqCalls.some((a) => a[0] === "visibility_type" && a[1] === "public"));
});

test("getStoreProjectByEntryCode は private_store かつ published で絞る", async () => {
  const calls: QueryCall[] = [];
  supabase.from = ((_table: string) =>
    createThenableSelectBuilder({ data: null, error: null }, calls)) as unknown as SupabaseClient["from"];

  await projectRepository.getStoreProjectByEntryCode("abc");

  const eqCalls = calls.filter((c) => c.method === "eq").map((c) => c.args);
  assert.ok(eqCalls.some((a) => a[0] === "entry_code" && a[1] === "abc"));
  assert.ok(eqCalls.some((a) => a[0] === "visibility_type" && a[1] === "private_store"));
  assert.ok(eqCalls.some((a) => a[0] === "status" && a[1] === "published"));
});

test("listStoreProjects は visibility_type=private_store で絞る（管理画面一覧）", async () => {
  const calls: QueryCall[] = [];
  supabase.from = ((_table: string) =>
    createThenableSelectBuilder({ data: [], error: null }, calls)) as unknown as SupabaseClient["from"];

  await projectRepository.listStoreProjects();

  const eqCalls = calls.filter((c) => c.method === "eq").map((c) => c.args);
  assert.ok(eqCalls.some((a) => a[0] === "visibility_type" && a[1] === "private_store"));
  // 全ステータス対象（status 条件を付けない）
  assert.ok(!eqCalls.some((a) => a[0] === "status"));
});

test("findAnyByEntryCode は status/visibility を問わず entry_code 一致で1件返す（重複検証）", async () => {
  const calls: QueryCall[] = [];
  supabase.from = ((_table: string) =>
    createThenableSelectBuilder({ data: null, error: null }, calls)) as unknown as SupabaseClient["from"];

  await projectRepository.findAnyByEntryCode("abc");

  const eqCalls = calls.filter((c) => c.method === "eq").map((c) => c.args);
  assert.ok(eqCalls.some((a) => a[0] === "entry_code" && a[1] === "abc"));
  assert.ok(!eqCalls.some((a) => a[0] === "visibility_type"), "公開区分で絞らない");
  assert.ok(!eqCalls.some((a) => a[0] === "status"), "ステータスで絞らない");
});

test("findAnyByEntryCode は空コードを DB 非アクセスで null 返し", async () => {
  let called = false;
  supabase.from = ((_table: string) => {
    called = true;
    return createThenableSelectBuilder({ data: null, error: null }, []);
  }) as unknown as SupabaseClient["from"];

  assert.equal(await projectRepository.findAnyByEntryCode("  "), null);
  assert.equal(called, false, "空コードでは DB を引かない");
});

// ---- storeEntryService の流入解決ロジック ----

test("未知コード / 該当なしは null を返す", async () => {
  const original = projectRepository.getStoreProjectByEntryCode;
  projectRepository.getStoreProjectByEntryCode = async () => null;
  try {
    const result = await storeEntryService.resolveEntry("unknown", LINE_USER_ID);
    assert.equal(result, null);
  } finally {
    projectRepository.getStoreProjectByEntryCode = original;
  }
});

test("空コード / 空ユーザーは DB を引かずに null", async () => {
  let called = false;
  const original = projectRepository.getStoreProjectByEntryCode;
  projectRepository.getStoreProjectByEntryCode = async () => {
    called = true;
    return null;
  };
  try {
    assert.equal(await storeEntryService.resolveEntry("  ", LINE_USER_ID), null);
    assert.equal(await storeEntryService.resolveEntry("abc", ""), null);
    assert.equal(called, false, "ガード条件で DB アクセスしない");
  } finally {
    projectRepository.getStoreProjectByEntryCode = original;
  }
});

test("respondent / assignment が無ければ新規生成して assignmentId を返す", async () => {
  const originals = {
    getProject: projectRepository.getStoreProjectByEntryCode,
    getResp: respondentRepository.getByLineUserAndProject,
    createResp: respondentRepository.create,
    getAssign: projectAssignmentRepository.getByProjectAndRespondent,
    createAssign: projectAssignmentRepository.create
  };
  let respondentCreated = false;
  let assignmentCreated = false;

  projectRepository.getStoreProjectByEntryCode = async () => storeProjectFixture();
  respondentRepository.getByLineUserAndProject = async () => null;
  respondentRepository.create = async () => {
    respondentCreated = true;
    return respondentFixture();
  };
  projectAssignmentRepository.getByProjectAndRespondent = async () => null;
  projectAssignmentRepository.create = async () => {
    assignmentCreated = true;
    return assignmentFixture();
  };

  try {
    const result = await storeEntryService.resolveEntry("abc", LINE_USER_ID, "テスト太郎");
    assert.deepEqual(result, { assignmentId: ASSIGNMENT_ID, projectId: STORE_PROJECT_ID });
    assert.ok(respondentCreated, "respondent を新規生成する");
    assert.ok(assignmentCreated, "assignment を新規生成する");
  } finally {
    Object.assign(projectRepository, { getStoreProjectByEntryCode: originals.getProject });
    Object.assign(respondentRepository, {
      getByLineUserAndProject: originals.getResp,
      create: originals.createResp
    });
    Object.assign(projectAssignmentRepository, {
      getByProjectAndRespondent: originals.getAssign,
      create: originals.createAssign
    });
  }
});

test("冪等性: 既存 respondent / assignment があれば再利用し新規生成しない", async () => {
  const originals = {
    getProject: projectRepository.getStoreProjectByEntryCode,
    getResp: respondentRepository.getByLineUserAndProject,
    createResp: respondentRepository.create,
    getAssign: projectAssignmentRepository.getByProjectAndRespondent,
    createAssign: projectAssignmentRepository.create
  };
  let respondentCreated = false;
  let assignmentCreated = false;

  projectRepository.getStoreProjectByEntryCode = async () => storeProjectFixture();
  respondentRepository.getByLineUserAndProject = async () => respondentFixture();
  respondentRepository.create = async () => {
    respondentCreated = true;
    return respondentFixture();
  };
  projectAssignmentRepository.getByProjectAndRespondent = async () => assignmentFixture();
  projectAssignmentRepository.create = async () => {
    assignmentCreated = true;
    return assignmentFixture();
  };

  try {
    const result = await storeEntryService.resolveEntry("abc", LINE_USER_ID);
    assert.deepEqual(result, { assignmentId: ASSIGNMENT_ID, projectId: STORE_PROJECT_ID });
    assert.equal(respondentCreated, false, "既存 respondent を再利用する");
    assert.equal(assignmentCreated, false, "既存 assignment を再利用する（重複生成しない）");
  } finally {
    Object.assign(projectRepository, { getStoreProjectByEntryCode: originals.getProject });
    Object.assign(respondentRepository, {
      getByLineUserAndProject: originals.getResp,
      create: originals.createResp
    });
    Object.assign(projectAssignmentRepository, {
      getByProjectAndRespondent: originals.getAssign,
      create: originals.createAssign
    });
  }
});
