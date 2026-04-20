import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Project, Question } from "../types/domain";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_BASIC_USER ||= "admin";
process.env.ADMIN_BASIC_PASSWORD ||= "password";

const INTERVIEW_PROJECT_ID = "00000000-0000-4000-8000-000000000201";

type SupabaseResponse = {
  data: unknown;
  error: { message: string } | null;
};

type QueryCall = {
  method: string;
  args: unknown[];
};

interface QuestionFormRenderLocals {
  project: Project;
  pageGroups: unknown[];
  action: string;
  form: { sort_order_text: string };
}

let supabase: SupabaseClient;
let originalFrom: SupabaseClient["from"];
let questionPageGroupRepository: typeof import("../repositories/questionPageGroupRepository").questionPageGroupRepository;
let questionRepository: typeof import("../repositories/questionRepository").questionRepository;
let adminController: typeof import("../controllers/adminController").adminController;
let projectRepository: typeof import("../repositories/projectRepository").projectRepository;

before(async () => {
  ({ supabase } = await import("../config/supabase"));
  ({ questionPageGroupRepository } = await import("../repositories/questionPageGroupRepository"));
  ({ questionRepository } = await import("../repositories/questionRepository"));
  ({ adminController } = await import("../controllers/adminController"));
  ({ projectRepository } = await import("../repositories/projectRepository"));
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
    order(...args: unknown[]) {
      calls.push({ method: "order", args });
      return builder;
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

function createQuestionMutationBuilder(input: {
  responseData: Record<string, unknown>;
  calls: QueryCall[];
  capturePayload: (payload: Record<string, unknown>) => void;
}) {
  const builder = {
    insert(payload: Record<string, unknown>) {
      input.calls.push({ method: "insert", args: [payload] });
      input.capturePayload(payload);
      return builder;
    },
    update(payload: Record<string, unknown>) {
      input.calls.push({ method: "update", args: [payload] });
      input.capturePayload(payload);
      return builder;
    },
    eq(...args: unknown[]) {
      input.calls.push({ method: "eq", args });
      return builder;
    },
    select(...args: unknown[]) {
      input.calls.push({ method: "select", args });
      return builder;
    },
    single() {
      return Promise.resolve({
        data: input.responseData,
        error: null
      });
    }
  };
  return builder;
}

function createInterviewProjectFixture(): Project {
  return {
    id: INTERVIEW_PROJECT_ID,
    name: "P0 Interview Project",
    client_name: "Test Client",
    objective: "Verify question authoring fallback for interview projects.",
    status: "draft",
    reward_points: 30,
    research_mode: "interview",
    display_mode: "interview_chat",
    primary_objectives: ["Interview users"],
    secondary_objectives: [],
    comparison_constraints: [],
    prompt_rules: [],
    probe_policy: null,
    response_style: { channel: "line", tone: "natural_japanese", max_characters_per_message: 80, max_sentences: 2 },
    ai_state_json: null,
    ai_state_template_key: null,
    ai_state_generated_at: null,
    screening_config: null,
    screening_last_question_order: null,
    created_at: "2026-04-20T00:00:00.000Z",
    updated_at: "2026-04-20T00:00:00.000Z"
  };
}

test("P0: interview question creation page renders with no page groups when migration 016 table is missing", async () => {
  const project = createInterviewProjectFixture();
  const originalGetById = projectRepository.getById;
  const originalListByProject = questionRepository.listByProject;
  const originalGetNextSortOrder = questionRepository.getNextSortOrder;
  const originalListPageGroups = questionPageGroupRepository.listByProject;
  const renderCalls: Array<{ view: string; locals: QuestionFormRenderLocals }> = [];

  projectRepository.getById = async (id: string) => {
    assert.equal(id, INTERVIEW_PROJECT_ID);
    return project;
  };
  questionRepository.listByProject = async () => [];
  questionRepository.getNextSortOrder = async () => 1;
  questionPageGroupRepository.listByProject = async () => [];

  try {
    await adminController.newQuestion(
      { params: { projectId: INTERVIEW_PROJECT_ID } } as never,
      {
        render(view: string, locals: QuestionFormRenderLocals) {
          renderCalls.push({ view, locals });
        }
      } as never
    );
  } finally {
    projectRepository.getById = originalGetById;
    questionRepository.listByProject = originalListByProject;
    questionRepository.getNextSortOrder = originalGetNextSortOrder;
    questionPageGroupRepository.listByProject = originalListPageGroups;
  }

  const renderCall = renderCalls[0];
  assert.ok(renderCall);
  assert.equal(renderCall.view, "admin/questions/formV3");
  assert.equal(renderCall.locals.project.research_mode, "interview");
  assert.equal(renderCall.locals.action, `/admin/projects/${INTERVIEW_PROJECT_ID}/questions`);
  assert.deepEqual(renderCall.locals.pageGroups, []);
  assert.equal(renderCall.locals.form.sort_order_text, "1");
});

test("P0: page group list returns an empty array instead of throwing when question_page_groups is missing", async () => {
  const calls: QueryCall[] = [];
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  supabase.from = ((table: string) => {
    assert.equal(table, "question_page_groups");
    return createThenableSelectBuilder(
      {
        data: null,
        error: { message: 'relation "question_page_groups" does not exist' }
      },
      calls
    );
  }) as unknown as SupabaseClient["from"];

  try {
    const result = await questionPageGroupRepository.listByProject(INTERVIEW_PROJECT_ID);

    assert.deepEqual(result, []);
    assert.equal(calls.some((call) => call.method === "eq" && call.args[0] === "project_id"), true);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0] ?? "", /016_question_schema_redesign\.sql/);
  } finally {
    console.warn = originalWarn;
  }
});

test("P0: question create omits null Phase 1 fields so basic save works before migration 016", async () => {
  const calls: QueryCall[] = [];
  const insertedPayloads: Array<Record<string, unknown>> = [];
  supabase.from = ((table: string) => {
    assert.equal(table, "questions");
    return createQuestionMutationBuilder({
      calls,
      capturePayload: (payload) => {
        insertedPayloads.push(payload);
      },
      responseData: {
        id: "00000000-0000-4000-8000-000000000301",
        project_id: INTERVIEW_PROJECT_ID,
        question_code: "Q1",
        question_text: "What should we ask first?",
        question_role: "main",
        question_type: "text",
        is_required: true,
        sort_order: 1,
        branch_rule: null,
        question_config: null,
        ai_probe_enabled: false,
        is_system: false,
        is_hidden: false,
        created_at: "2026-04-20T00:00:00.000Z",
        updated_at: "2026-04-20T00:00:00.000Z"
      }
    });
  }) as unknown as SupabaseClient["from"];

  await questionRepository.create({
    project_id: INTERVIEW_PROJECT_ID,
    question_code: "Q1",
    question_text: "What should we ask first?",
    question_role: "main",
    question_type: "text",
    is_required: true,
    sort_order: 1,
    branch_rule: null,
    question_config: null,
    ai_probe_enabled: false,
    comment_top: null,
    comment_bottom: undefined,
    answer_output_type: null,
    display_tags_raw: undefined,
    display_tags_parsed: null,
    visibility_conditions: undefined,
    page_group_id: null
  });

  const insertedPayload = insertedPayloads[0];
  assert.ok(insertedPayload);
  assert.equal(insertedPayload.project_id, INTERVIEW_PROJECT_ID);
  assert.equal(insertedPayload.ai_probe_enabled, false);
  assert.equal(insertedPayload.is_system, false);
  assert.equal(insertedPayload.is_hidden, false);
  assert.equal("comment_top" in insertedPayload, false);
  assert.equal("comment_bottom" in insertedPayload, false);
  assert.equal("answer_output_type" in insertedPayload, false);
  assert.equal("display_tags_raw" in insertedPayload, false);
  assert.equal("display_tags_parsed" in insertedPayload, false);
  assert.equal("visibility_conditions" in insertedPayload, false);
  assert.equal("page_group_id" in insertedPayload, false);
  assert.equal(calls.some((call) => call.method === "insert"), true);
});

test("P1: question update keeps non-null Phase 1 fields and omits null fields", async () => {
  const calls: QueryCall[] = [];
  const updatedPayloads: Array<Record<string, unknown>> = [];
  supabase.from = ((table: string) => {
    assert.equal(table, "questions");
    return createQuestionMutationBuilder({
      calls,
      capturePayload: (payload) => {
        updatedPayloads.push(payload);
      },
      responseData: {
        id: "00000000-0000-4000-8000-000000000301",
        question_text: "Updated question"
      }
    });
  }) as unknown as SupabaseClient["from"];

  await questionRepository.update("00000000-0000-4000-8000-000000000301", {
    question_text: "Updated question",
    comment_top: null,
    answer_output_type: "text",
    display_tags_raw: "<must>",
    display_tags_parsed: { mustInput: true } as Question["display_tags_parsed"],
    visibility_conditions: null,
    page_group_id: undefined
  });

  const updatedPayload = updatedPayloads[0];
  assert.ok(updatedPayload);
  assert.equal(updatedPayload.question_text, "Updated question");
  assert.equal("comment_top" in updatedPayload, false);
  assert.equal(updatedPayload.answer_output_type, "text");
  assert.equal(updatedPayload.display_tags_raw, "<must>");
  assert.deepEqual(updatedPayload.display_tags_parsed, { mustInput: true });
  assert.equal("visibility_conditions" in updatedPayload, false);
  assert.equal("page_group_id" in updatedPayload, false);
  assert.equal(calls.some((call) => call.method === "update"), true);
  assert.equal(calls.some((call) => call.method === "eq" && call.args[0] === "id"), true);
});
