import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import type { Project, ProjectApplication, ProjectAssignment, Respondent } from "../types/domain";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_BASIC_USER ||= "admin";
process.env.ADMIN_BASIC_PASSWORD ||= "password";

const PROJECT_ID = "00000000-0000-4000-8000-000000000601";
const RESPONDENT_ID = "00000000-0000-4000-8000-000000000602";
const ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000603";
const APPLICATION_ID = "00000000-0000-4000-8000-000000000604";
const LINE_USER_ID = "Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

let applicationService: typeof import("../services/applicationService").applicationService;
let isRecruitClosed: typeof import("../services/applicationService").isRecruitClosed;
let projectRepository: typeof import("../repositories/projectRepository").projectRepository;
let respondentRepository: typeof import("../repositories/respondentRepository").respondentRepository;
let projectAssignmentRepository: typeof import("../repositories/projectAssignmentRepository").projectAssignmentRepository;
let projectApplicationRepository: typeof import("../repositories/projectApplicationRepository").projectApplicationRepository;

const originals: Array<() => void> = [];

/** repositoryメソッドを差し替え、afterEachで復元する */
function stub<T extends object, K extends keyof T>(obj: T, key: K, fn: T[K]): void {
  const original = obj[key];
  obj[key] = fn;
  originals.push(() => { obj[key] = original; });
}

before(async () => {
  ({ applicationService, isRecruitClosed } = await import("../services/applicationService"));
  ({ projectRepository } = await import("../repositories/projectRepository"));
  ({ respondentRepository } = await import("../repositories/respondentRepository"));
  ({ projectAssignmentRepository } = await import("../repositories/projectAssignmentRepository"));
  ({ projectApplicationRepository } = await import("../repositories/projectApplicationRepository"));
});

afterEach(() => {
  while (originals.length) originals.pop()!();
});

function projectFixture(overrides: Partial<Project> = {}): Project {
  return {
    id: PROJECT_ID,
    name: "テスト案件",
    client_name: null,
    objective: null,
    status: "published",
    reward_points: 500,
    research_mode: "survey",
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
    visibility_type: "public",
    entry_code: null,
    client_id: null,
    apply_mode: "manual",
    tags: [],
    ng_conditions: null,
    recruit_deadline: null,
    interview_format: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  } as Project;
}

function applicationFixture(overrides: Partial<ProjectApplication> = {}): ProjectApplication {
  return {
    id: APPLICATION_ID,
    project_id: PROJECT_ID,
    line_user_id: LINE_USER_ID,
    respondent_id: null,
    status: "applied",
    assignment_id: null,
    note: null,
    applied_at: new Date().toISOString(),
    decided_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

test("apply: 非公開/未知案件は not_found（誤表示遮断）", async () => {
  stub(projectRepository, "getDiscoverableById", async () => null);
  const result = await applicationService.apply(PROJECT_ID, LINE_USER_ID);
  assert.deepEqual(result, { ok: false, reason: "not_found" });
});

test("apply: 募集期限超過は closed", async () => {
  stub(projectRepository, "getDiscoverableById", async () =>
    projectFixture({ recruit_deadline: new Date(Date.now() - 60_000).toISOString() }));
  const result = await applicationService.apply(PROJECT_ID, LINE_USER_ID);
  assert.deepEqual(result, { ok: false, reason: "closed" });
});

test("apply: 満枠（max_respondents到達）は full", async () => {
  stub(projectRepository, "getDiscoverableById", async () =>
    projectFixture({ ...( { max_respondents: 5 } as Partial<Project>) }));
  stub(projectApplicationRepository, "countActiveByProject", async () => 5);
  const result = await applicationService.apply(PROJECT_ID, LINE_USER_ID);
  assert.deepEqual(result, { ok: false, reason: "full" });
});

test("apply: 既応募は duplicate", async () => {
  stub(projectRepository, "getDiscoverableById", async () => projectFixture());
  stub(projectApplicationRepository, "findByProjectAndUser", async () => applicationFixture());
  const result = await applicationService.apply(PROJECT_ID, LINE_USER_ID);
  assert.deepEqual(result, { ok: false, reason: "duplicate" });
});

test("apply: manual案件は applied で止まる（assignment発行なし）", async () => {
  stub(projectRepository, "getDiscoverableById", async () => projectFixture({ apply_mode: "manual" }));
  stub(projectApplicationRepository, "findByProjectAndUser", async () => null);
  let assignmentCreated = false;
  stub(projectAssignmentRepository, "create", (async () => {
    assignmentCreated = true;
    throw new Error("should not be called");
  }) as typeof projectAssignmentRepository.create);
  stub(projectApplicationRepository, "create", async (input) => applicationFixture({ status: input.status ?? "applied" }));

  const result = await applicationService.apply(PROJECT_ID, LINE_USER_ID);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.mode, "manual");
    assert.equal(result.application.status, "applied");
  }
  assert.equal(assignmentCreated, false);
});

test("apply: auto案件は respondent/assignment を確保して accepted＋assignmentId を返す", async () => {
  stub(projectRepository, "getDiscoverableById", async () => projectFixture({ apply_mode: "auto" }));
  stub(projectApplicationRepository, "findByProjectAndUser", async () => null);
  stub(respondentRepository, "getByLineUserAndProject", async () => null);
  stub(respondentRepository, "create", async () =>
    ({ id: RESPONDENT_ID, line_user_id: LINE_USER_ID, project_id: PROJECT_ID } as unknown as Respondent));
  stub(projectAssignmentRepository, "getByProjectAndRespondent", async () => null);
  let createInput: unknown = null;
  stub(projectAssignmentRepository, "create", (async (input: unknown) => {
    createInput = input;
    return { id: ASSIGNMENT_ID, status: "opened" } as unknown as ProjectAssignment;
  }) as typeof projectAssignmentRepository.create);
  stub(projectApplicationRepository, "create", async (input) =>
    applicationFixture({ status: input.status ?? "applied", assignment_id: input.assignment_id ?? null, respondent_id: input.respondent_id ?? null }));

  const result = await applicationService.apply(PROJECT_ID, LINE_USER_ID, "テスト太郎");
  assert.equal(result.ok, true);
  if (result.ok && result.mode === "auto") {
    assert.equal(result.assignmentId, ASSIGNMENT_ID);
    assert.equal(result.application.status, "accepted");
    assert.equal(result.application.assignment_id, ASSIGNMENT_ID);
    assert.equal(result.application.respondent_id, RESPONDENT_ID);
  } else {
    assert.fail("auto応募の結果が想定と異なる");
  }
  assert.equal((createInput as { delivery_channel: string }).delivery_channel, "liff");
});

test("apply: auto案件で既存assignmentがあれば再利用（冪等・二重発行しない）", async () => {
  stub(projectRepository, "getDiscoverableById", async () => projectFixture({ apply_mode: "auto" }));
  stub(projectApplicationRepository, "findByProjectAndUser", async () => null);
  stub(respondentRepository, "getByLineUserAndProject", async () =>
    ({ id: RESPONDENT_ID, line_user_id: LINE_USER_ID, project_id: PROJECT_ID } as unknown as Respondent));
  stub(projectAssignmentRepository, "getByProjectAndRespondent", async () =>
    ({ id: ASSIGNMENT_ID, status: "opened" } as unknown as ProjectAssignment));
  let created = 0;
  stub(projectAssignmentRepository, "create", (async () => {
    created += 1;
    return { id: "should-not-happen" } as unknown as ProjectAssignment;
  }) as typeof projectAssignmentRepository.create);
  stub(projectApplicationRepository, "create", async (input) =>
    applicationFixture({ status: "accepted", assignment_id: input.assignment_id ?? null }));

  const result = await applicationService.apply(PROJECT_ID, LINE_USER_ID);
  assert.equal(created, 0);
  if (result.ok && result.mode === "auto") {
    assert.equal(result.assignmentId, ASSIGNMENT_ID);
  } else {
    assert.fail("既存assignmentの再利用に失敗");
  }
});

test("withdraw: applied のみ取り消せる", async () => {
  stub(projectApplicationRepository, "findByProjectAndUser", async () => applicationFixture({ status: "applied" }));
  let updated: unknown = null;
  stub(projectApplicationRepository, "update", async (_id, input) => {
    updated = input;
    return applicationFixture({ status: "withdrawn" });
  });
  const ok = await applicationService.withdraw(PROJECT_ID, LINE_USER_ID);
  assert.equal(ok.ok, true);
  assert.equal((updated as { status: string }).status, "withdrawn");
});

test("withdraw: accepted は取り消せない", async () => {
  stub(projectApplicationRepository, "findByProjectAndUser", async () => applicationFixture({ status: "accepted" }));
  const ok = await applicationService.withdraw(PROJECT_ID, LINE_USER_ID);
  assert.equal(ok.ok, false);
});

test("isRecruitClosed: 期限なしは常に募集中", () => {
  assert.equal(isRecruitClosed(projectFixture({ recruit_deadline: null })), false);
  assert.equal(isRecruitClosed(projectFixture({ recruit_deadline: new Date(Date.now() + 60_000).toISOString() })), false);
  assert.equal(isRecruitClosed(projectFixture({ recruit_deadline: new Date(Date.now() - 60_000).toISOString() })), true);
});
