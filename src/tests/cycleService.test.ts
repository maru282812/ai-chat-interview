/**
 * cycleService.test.ts
 *
 * サイクル解決の振る舞い（Migration 093）。
 *
 * 特に重要なのは「サイクルに属さない案件では何も起きない」こと。
 * 既存案件は cycle_id=null のまま従来どおり動かなければならない。
 */

import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import type { CycleGroup, CycleGroupStep, SurveyCycle } from "../types/domain";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_PASSWORD_HASH ||= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ||= "test-admin-session-secret-000000000000";

const GROUP_ID = "00000000-0000-4000-8000-0000000000g1".replace(/g/g, "b");
const PROJECT_A = "00000000-0000-4000-8000-0000000000a1";
const PROJECT_B = "00000000-0000-4000-8000-0000000000b1";
const LINE_USER = "Uffffffffffffffffffffffffffffffff";
const NOW = new Date("2026-08-01T00:00:00.000Z");
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

let cycleGroupRepository: typeof import("../repositories/cycleRepository").cycleGroupRepository;
let surveyCycleRepository: typeof import("../repositories/cycleRepository").surveyCycleRepository;
let cycleService: typeof import("../services/cycleService").cycleService;

let originals: Record<string, unknown>;

before(async () => {
  ({ cycleGroupRepository, surveyCycleRepository } = await import("../repositories/cycleRepository"));
  ({ cycleService } = await import("../services/cycleService"));
  originals = {
    findByProjectId: cycleGroupRepository.findByProjectId,
    getById: cycleGroupRepository.getById,
    findOpen: surveyCycleRepository.findOpen,
    findLatest: surveyCycleRepository.findLatest,
    create: surveyCycleRepository.create,
    update: surveyCycleRepository.update,
    cycleGetById: surveyCycleRepository.getById,
  };
});

afterEach(() => {
  Object.assign(cycleGroupRepository, {
    findByProjectId: originals.findByProjectId,
    getById: originals.getById,
  });
  Object.assign(surveyCycleRepository, {
    findOpen: originals.findOpen,
    findLatest: originals.findLatest,
    create: originals.create,
    update: originals.update,
    getById: originals.cycleGetById,
  });
});

const group = (over: Partial<CycleGroup> = {}): CycleGroup =>
  ({
    id: GROUP_ID,
    name: "美容室ABCサイクル",
    entry_project_id: PROJECT_A,
    followup_project_id: null,
    grace_days: 7,
    undecided_days: 60,
    restart_cooldown_days: 25,
    is_enabled: true,
    ...over,
  }) as CycleGroup;

const step = (role: "entry" | "followup" | "verify", projectId: string): CycleGroupStep =>
  ({ id: "s1", cycle_group_id: GROUP_ID, project_id: projectId, step_order: 1, step_role: role }) as CycleGroupStep;

const cycle = (over: Partial<SurveyCycle> = {}): SurveyCycle =>
  ({
    id: "c1",
    cycle_group_id: GROUP_ID,
    line_user_id: LINE_USER,
    cycle_no: 1,
    started_at: NOW.toISOString(),
    frequency_code: null,
    expected_return_at: null,
    followup_sent_at: null,
    returned_at: null,
    closed_at: null,
    close_reason: null,
    ...over,
  }) as SurveyCycle;

// ------------------------------------------------------------------
// 非サイクル案件は従来どおり（最重要の回帰）
// ------------------------------------------------------------------

test("サイクル定義に属さない案件は null＝従来どおり cycle_id なしで動く", async () => {
  let created = false;
  Object.assign(cycleGroupRepository, { findByProjectId: async () => null });
  Object.assign(surveyCycleRepository, {
    create: async () => {
      created = true;
      return cycle();
    },
  });

  const got = await cycleService.resolveCycleForEntry(PROJECT_A, LINE_USER, NOW);
  assert.equal(got, null);
  assert.equal(created, false, "サイクルを勝手に作ってはいけない");
});

test("無効化されたグループの案件も null（配信を止められる）", async () => {
  Object.assign(cycleGroupRepository, {
    findByProjectId: async () => ({ group: group({ is_enabled: false }), step: step("entry", PROJECT_A) }),
  });
  assert.equal(await cycleService.resolveCycleForEntry(PROJECT_A, LINE_USER, NOW), null);
});

test("lineUserId が無ければ何もしない", async () => {
  Object.assign(cycleGroupRepository, {
    findByProjectId: async () => ({ group: group(), step: step("entry", PROJECT_A) }),
  });
  assert.equal(await cycleService.resolveCycleForEntry(PROJECT_A, "", NOW), null);
});

// ------------------------------------------------------------------
// A（起点）＝周回の開始
// ------------------------------------------------------------------

test("初回の A で cycle_no=1 の周が始まる", async () => {
  const creates: { cycle_no: number }[] = [];
  Object.assign(cycleGroupRepository, {
    findByProjectId: async () => ({ group: group(), step: step("entry", PROJECT_A) }),
  });
  Object.assign(surveyCycleRepository, {
    findLatest: async () => null,
    create: async (input: { cycle_no: number }) => {
      creates.push(input);
      return cycle({ cycle_no: input.cycle_no });
    },
  });

  const got = await cycleService.resolveCycleForEntry(PROJECT_A, LINE_USER, NOW);
  assert.equal(got?.startedNew, true);
  assert.equal(creates[0]?.cycle_no, 1);
});

test("クールダウン(25日)経過後の A で cycle_no=2 になり、前の周は returned で閉じる", async () => {
  const updates: { id: string; input: Record<string, unknown> }[] = [];
  const creates: { cycle_no: number }[] = [];
  Object.assign(cycleGroupRepository, {
    findByProjectId: async () => ({ group: group(), step: step("entry", PROJECT_A) }),
  });
  Object.assign(surveyCycleRepository, {
    findLatest: async () => cycle({ cycle_no: 1, started_at: NOW.toISOString() }),
    update: async (id: string, input: Record<string, unknown>) => {
      updates.push({ id, input });
      return cycle();
    },
    create: async (input: { cycle_no: number }) => {
      creates.push(input);
      return cycle({ cycle_no: input.cycle_no });
    },
  });

  const got = await cycleService.resolveCycleForEntry(PROJECT_A, LINE_USER, addDays(NOW, 26));
  assert.equal(got?.startedNew, true);
  assert.equal(creates[0]?.cycle_no, 2, "2周目になること");
  // 再来店した＝離脱していないので、前の周は returned で閉じ C の送付対象から外れる。
  assert.equal(updates[0]?.input.close_reason, "returned");
  assert.ok(updates[0]?.input.returned_at, "returned_at が入ること");
});

test("クールダウン内の A 再訪は新しい周を作らない（ポイント二重取り防止）", async () => {
  let created = false;
  Object.assign(cycleGroupRepository, {
    findByProjectId: async () => ({ group: group(), step: step("entry", PROJECT_A) }),
  });
  Object.assign(surveyCycleRepository, {
    findLatest: async () => cycle({ cycle_no: 1, started_at: NOW.toISOString() }),
    create: async () => {
      created = true;
      return cycle();
    },
  });

  const got = await cycleService.resolveCycleForEntry(PROJECT_A, LINE_USER, addDays(NOW, 3));
  assert.equal(got?.startedNew, false, "周は進まない");
  assert.equal(got?.cycle.cycle_no, 1, "既存の周に合流する");
  assert.equal(created, false);
});

// ------------------------------------------------------------------
// B / C ＝開いている周への合流
// ------------------------------------------------------------------

test("B は開いている周に合流する（周を新設しない）", async () => {
  let created = false;
  Object.assign(cycleGroupRepository, {
    findByProjectId: async () => ({ group: group(), step: step("followup", PROJECT_B) }),
  });
  Object.assign(surveyCycleRepository, {
    findOpen: async () => cycle({ cycle_no: 3 }),
    create: async () => {
      created = true;
      return cycle();
    },
  });

  const got = await cycleService.resolveCycleForEntry(PROJECT_B, LINE_USER, NOW);
  assert.equal(got?.cycle.cycle_no, 3);
  assert.equal(got?.startedNew, false);
  assert.equal(created, false, "B が周を始めてはいけない（起点は A だけ）");
});

test("開いている周が無ければ B は null（順序は強制しないが周も作らない）", async () => {
  Object.assign(cycleGroupRepository, {
    findByProjectId: async () => ({ group: group(), step: step("followup", PROJECT_B) }),
  });
  Object.assign(surveyCycleRepository, { findOpen: async () => null });

  assert.equal(await cycleService.resolveCycleForEntry(PROJECT_B, LINE_USER, NOW), null);
});

// ------------------------------------------------------------------
// 離脱判定日の確定
// ------------------------------------------------------------------

test("A の頻度回答から expected_return_at が入る", async () => {
  const updates: Record<string, unknown>[] = [];
  Object.assign(surveyCycleRepository, {
    getById: async () => cycle(),
    update: async (_id: string, input: Record<string, unknown>) => {
      updates.push(input);
      return cycle();
    },
  });
  Object.assign(cycleGroupRepository, { getById: async () => group() });

  await cycleService.captureEntryFrequency({
    cycleId: "c1",
    questions: [{ id: "q11", question_code: "Q11" }],
    answers: [{ question_id: "q11", answer_text: "about_2m", answer_role: "primary" }],
    answeredAt: NOW,
  });

  assert.equal(updates[0]?.frequency_code, "about_2m");
  // 60 + grace 7 = 67日後
  assert.equal(updates[0]?.expected_return_at, addDays(NOW, 67).toISOString());
});

test("頻度が未知コードなら判定日を立てない（誤った離脱率を出さない）", async () => {
  const updates: Record<string, unknown>[] = [];
  Object.assign(surveyCycleRepository, {
    getById: async () => cycle(),
    update: async (_id: string, input: Record<string, unknown>) => {
      updates.push(input);
      return cycle();
    },
  });
  Object.assign(cycleGroupRepository, { getById: async () => group() });

  await cycleService.captureEntryFrequency({
    cycleId: "c1",
    questions: [{ id: "q11", question_code: "Q11" }],
    answers: [{ question_id: "q11", answer_text: "moon_phase", answer_role: "primary" }],
    answeredAt: NOW,
  });

  assert.equal(updates[0]?.expected_return_at, null);
});

test("頻度設問が無くても完了処理を壊さない", async () => {
  Object.assign(surveyCycleRepository, { getById: async () => cycle() });
  Object.assign(cycleGroupRepository, { getById: async () => group() });

  // 例外を投げないこと自体が仕様（完了処理の途中で呼ばれるため）。
  await cycleService.captureEntryFrequency({
    cycleId: "c1",
    questions: [{ id: "q1", question_code: "Q1" }],
    answers: [],
    answeredAt: NOW,
  });
});

test("DB が落ちても回答導線を止めない（resolveCycleSafely）", async () => {
  Object.assign(cycleGroupRepository, {
    findByProjectId: async () => {
      throw new Error("db down");
    },
  });

  const got = await cycleService.resolveCycleSafely(PROJECT_A, LINE_USER, NOW);
  assert.equal(got, null, "例外ではなく null で返し、cycle_id なしで回答を通す");
});
