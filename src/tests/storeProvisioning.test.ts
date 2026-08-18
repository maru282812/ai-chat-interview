/**
 * storeProvisioning.test.ts
 *
 * 業種テンプレからの店舗一括生成 (Migration 096)。
 *
 * ここで守りたいこと:
 *   1. 店舗ごとに entry_code / 案件 / サイクルが分離される（他店と混ざらない）
 *   2. 謝礼の店舗別設定（0＝謝礼なしを「未設定」と混同しない）
 *   3. 冪等（再実行しても案件が増えない）
 *   4. carry-forward が自店舗内で閉じる
 */

import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import type { IndustryTemplate, Project, Store } from "../types/domain";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_PASSWORD_HASH ||= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ||= "test-admin-session-secret-000000000000";

const TEMPLATE_ID = "00000000-0000-4000-8000-0000000000t1".replace(/t/g, "e");
const CLIENT_ID = "00000000-0000-4000-8000-0000000000c9";
const TPL_A = "00000000-0000-4000-8000-0000000000a0";
const TPL_B = "00000000-0000-4000-8000-0000000000b0";
const TPL_C = "00000000-0000-4000-8000-0000000000c0";

let storeProvisioningService: typeof import("../services/storeProvisioningService").storeProvisioningService;
let storeRepository: typeof import("../repositories/storeRepository").storeRepository;
let industryTemplateRepository: typeof import("../repositories/storeRepository").industryTemplateRepository;
let projectRepository: typeof import("../repositories/projectRepository").projectRepository;
let cycleGroupRepository: typeof import("../repositories/cycleRepository").cycleGroupRepository;

let originals: Record<string, unknown>;
/** projectRepository.update に渡された内容を記録する */
let updates: { id: string; input: Record<string, unknown> }[];
let createdSteps: Record<string, unknown>[];

before(async () => {
  ({ storeProvisioningService } = await import("../services/storeProvisioningService"));
  ({ storeRepository, industryTemplateRepository } = await import("../repositories/storeRepository"));
  ({ projectRepository } = await import("../repositories/projectRepository"));
  ({ cycleGroupRepository } = await import("../repositories/cycleRepository"));
  originals = {
    tplGet: industryTemplateRepository.getById,
    storeGetSlug: storeRepository.getByCodeSlug,
    storeCreate: storeRepository.create,
    listByStore: projectRepository.listByStore,
    copyProject: projectRepository.copyProject,
    projGet: projectRepository.getById,
    projUpdate: projectRepository.update,
    findByStore: cycleGroupRepository.findByStore,
    groupCreate: cycleGroupRepository.create,
    addStep: cycleGroupRepository.addStep,
  };
});

afterEach(() => {
  Object.assign(industryTemplateRepository, { getById: originals.tplGet });
  Object.assign(storeRepository, {
    getByCodeSlug: originals.storeGetSlug,
    create: originals.storeCreate,
  });
  Object.assign(projectRepository, {
    listByStore: originals.listByStore,
    copyProject: originals.copyProject,
    getById: originals.projGet,
    update: originals.projUpdate,
  });
  Object.assign(cycleGroupRepository, {
    findByStore: originals.findByStore,
    create: originals.groupCreate,
    addStep: originals.addStep,
  });
});

const template = (over: Partial<IndustryTemplate> = {}): IndustryTemplate =>
  ({
    id: TEMPLATE_ID,
    name: "美容室ABCサイクル",
    industry_code: "salon",
    entry_template_project_id: TPL_A,
    followup_template_project_id: TPL_B,
    verify_template_project_id: TPL_C,
    grace_days: 7,
    undecided_days: 60,
    restart_cooldown_days: 25,
    followup_b_delay_minutes: 120,
    frequency_question_code: "Q11",
    frequency_days_json: { about_2m: 60 },
    is_enabled: true,
    ...over,
  }) as IndustryTemplate;

const store = (over: Partial<Store> = {}): Store =>
  ({
    id: "store-1",
    client_id: CLIENT_ID,
    industry_template_id: TEMPLATE_ID,
    name: "●●美容室 渋谷店",
    code_slug: "salon-shibuya",
    reward_points_override: null,
    is_active: true,
    ...over,
  }) as Store;

/** 生成系の共通スタブ。既存案件ゼロ＝まっさらな店舗から始める。 */
function stubProvision(opts: { existingProjects?: Project[]; existingStore?: Store | null } = {}) {
  updates = [];
  createdSteps = [];
  let copyCount = 0;

  Object.assign(industryTemplateRepository, { getById: async () => template() });
  Object.assign(storeRepository, {
    getByCodeSlug: async () => opts.existingStore ?? null,
    create: async (input: Record<string, unknown>) => store(input as Partial<Store>),
  });
  Object.assign(projectRepository, {
    listByStore: async () => opts.existingProjects ?? [],
    copyProject: async () => {
      copyCount += 1;
      return { id: `copy-${copyCount}`, name: "コピー" } as Project;
    },
    getById: async (id: string) =>
      ({
        id,
        name: "【●●美容室】A：来店すぐアンケート",
        reward_points: 5,
        display_mode: "survey_question",
        answer_ui_preset: "standard",
        apply_mode: "auto",
      }) as Project,
    update: async (id: string, input: Record<string, unknown>) => {
      updates.push({ id, input });
      return { id, ...input } as unknown as Project;
    },
  });
  Object.assign(cycleGroupRepository, {
    findByStore: async () => null,
    create: async (input: Record<string, unknown>) => ({ id: "group-1", ...input }),
    addStep: async (input: Record<string, unknown>) => {
      createdSteps.push(input);
      return input;
    },
  });
}

// ------------------------------------------------------------------
// 生成
// ------------------------------------------------------------------

test("店舗を作るとA/B/Cの3案件が生成される", async () => {
  stubProvision();
  const result = await storeProvisioningService.provisionStore({
    clientId: CLIENT_ID,
    industryTemplateId: TEMPLATE_ID,
    name: "●●美容室 渋谷店",
    codeSlug: "salon-shibuya",
  });

  assert.equal(result.projects.length, 3);
  assert.deepEqual(result.projects.map((p) => p.role), ["entry", "followup", "verify"]);
});

test("entry_code が店舗コードから店舗ごとに分かれる", async () => {
  stubProvision();
  const result = await storeProvisioningService.provisionStore({
    clientId: CLIENT_ID,
    industryTemplateId: TEMPLATE_ID,
    name: "●●美容室 渋谷店",
    codeSlug: "salon-shibuya",
  });

  assert.deepEqual(result.projects.map((p) => p.entryCode), [
    "salon-shibuya-a",
    "salon-shibuya-b",
    "salon-shibuya-c",
  ]);
});

test("生成した案件は店舗専用・非公開になる（探す一覧に出ない）", async () => {
  stubProvision();
  await storeProvisioningService.provisionStore({
    clientId: CLIENT_ID,
    industryTemplateId: TEMPLATE_ID,
    name: "店",
    codeSlug: "s1",
  });

  const first = updates[0]?.input;
  assert.equal(first?.visibility_type, "private_store");
  assert.equal(first?.is_discoverable, false);
  assert.equal(first?.store_id, "store-1");
  assert.equal(first?.template_step_role, "entry");
});

test("店舗コードの書式を検証する（QRのURLに入るため）", async () => {
  stubProvision();
  await assert.rejects(
    () =>
      storeProvisioningService.provisionStore({
        clientId: CLIENT_ID,
        industryTemplateId: TEMPLATE_ID,
        name: "店",
        codeSlug: "日本語コード",
      }),
    /店舗コード/
  );
});

// ------------------------------------------------------------------
// 謝礼の店舗別設定
// ------------------------------------------------------------------

test("謝礼を指定するとその値が案件に入る", async () => {
  stubProvision();
  await storeProvisioningService.provisionStore({
    clientId: CLIENT_ID,
    industryTemplateId: TEMPLATE_ID,
    name: "店",
    codeSlug: "s1",
    rewardPointsOverride: 99,
  });
  assert.equal(updates[0]?.input.reward_points, 99);
});

test("謝礼0（謝礼なし）を「未設定」と混同しない", async () => {
  stubProvision();
  Object.assign(storeRepository, {
    create: async () => store({ reward_points_override: 0 }),
  });
  await storeProvisioningService.provisionStore({
    clientId: CLIENT_ID,
    industryTemplateId: TEMPLATE_ID,
    name: "店",
    codeSlug: "s1",
    rewardPointsOverride: 0,
  });
  // ?? を使っているので 0 はそのまま通る（|| だとテンプレ値に化ける）
  assert.equal(updates[0]?.input.reward_points, 0, "0pt が 5pt に化けてはいけない");
});

test("謝礼未指定ならテンプレ案件の値を使う", async () => {
  stubProvision();
  await storeProvisioningService.provisionStore({
    clientId: CLIENT_ID,
    industryTemplateId: TEMPLATE_ID,
    name: "店",
    codeSlug: "s1",
  });
  assert.equal(updates[0]?.input.reward_points, 5);
});

// ------------------------------------------------------------------
// サイクル定義と carry-forward
// ------------------------------------------------------------------

test("サイクル定義が作られ、テンプレの設定を継承する", async () => {
  stubProvision();
  const result = await storeProvisioningService.provisionStore({
    clientId: CLIENT_ID,
    industryTemplateId: TEMPLATE_ID,
    name: "店",
    codeSlug: "s1",
  });

  assert.equal(result.cycleGroupId, "group-1");
  assert.equal(createdSteps.length, 3);
  assert.deepEqual(createdSteps.map((s) => s.step_role), ["entry", "followup", "verify"]);
});

test("C の carry-forward が自店舗の A を指す（他店と混ざらない）", async () => {
  stubProvision();
  await storeProvisioningService.provisionStore({
    clientId: CLIENT_ID,
    industryTemplateId: TEMPLATE_ID,
    name: "店",
    codeSlug: "salon-shibuya",
  });

  const carry = updates.find((u) => u.input.carry_forward_sources);
  assert.deepEqual(carry?.input.carry_forward_sources, [
    { namespace: "a", entry_code: "salon-shibuya-a" },
  ]);
});

// ------------------------------------------------------------------
// 冪等性
// ------------------------------------------------------------------

test("既に案件がある店舗では複製しない（再実行で増えない）", async () => {
  const existing = [
    { id: "p-a", template_step_role: "entry", entry_code: "s1-a" },
    { id: "p-b", template_step_role: "followup", entry_code: "s1-b" },
    { id: "p-c", template_step_role: "verify", entry_code: "s1-c" },
  ] as Project[];
  stubProvision({ existingProjects: existing, existingStore: store() });

  let copied = 0;
  Object.assign(projectRepository, {
    copyProject: async () => {
      copied += 1;
      return { id: "should-not-happen" } as Project;
    },
  });

  const result = await storeProvisioningService.provisionStore({
    clientId: CLIENT_ID,
    industryTemplateId: TEMPLATE_ID,
    name: "店",
    codeSlug: "salon-shibuya",
  });

  assert.equal(copied, 0, "既存案件があれば複製してはいけない");
  assert.equal(result.projects.length, 3);
  assert.equal(result.created, false, "既存店舗として扱うこと");
});

test("サイクル定義が既にあれば作り直さない", async () => {
  stubProvision({ existingStore: store() });
  Object.assign(cycleGroupRepository, {
    findByStore: async () => ({ id: "existing-group" }),
    create: async () => {
      throw new Error("作り直してはいけない");
    },
  });

  const result = await storeProvisioningService.provisionStore({
    clientId: CLIENT_ID,
    industryTemplateId: TEMPLATE_ID,
    name: "店",
    codeSlug: "s1",
  });
  assert.equal(result.cycleGroupId, "existing-group");
});

// ------------------------------------------------------------------
// 部分構成（A→B だけの業種）
// ------------------------------------------------------------------

test("Cが無い業種テンプレでもA/Bだけで生成できる", async () => {
  stubProvision();
  Object.assign(industryTemplateRepository, {
    getById: async () => template({ verify_template_project_id: null }),
  });

  const result = await storeProvisioningService.provisionStore({
    clientId: CLIENT_ID,
    industryTemplateId: TEMPLATE_ID,
    name: "店",
    codeSlug: "s1",
  });

  assert.equal(result.projects.length, 2);
  assert.deepEqual(result.projects.map((p) => p.role), ["entry", "followup"]);
  // C が無ければ carry-forward も張らない
  assert.ok(!updates.some((u) => u.input.carry_forward_sources));
});

test("テンプレが存在しなければ明示的に失敗する", async () => {
  stubProvision();
  Object.assign(industryTemplateRepository, { getById: async () => null });
  await assert.rejects(
    () =>
      storeProvisioningService.provisionStore({
        clientId: CLIENT_ID,
        industryTemplateId: "missing",
        name: "店",
        codeSlug: "s1",
      }),
    /業種テンプレート/
  );
});
