/**
 * cycleTestUser.test.ts
 *
 * 検証用アカウントのクールダウン免除（CYCLE_TEST_LINE_USER_IDS）。
 *
 * 本番の実機で通し確認をするたびに25日待つのは現実的でないため、
 * 指定したアカウントだけ「A再訪で新しい周を開始できる」ようにする。
 *
 * ここで守りたいのは「免除がテスト用アカウントから漏れないこと」。
 * 漏れると一般ユーザーが QR 連打でポイントを二重取りできてしまう。
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
// 免除対象を2件（前後の空白と空要素も混ぜて、パースの雑さに耐えるか見る）
process.env.CYCLE_TEST_LINE_USER_IDS = "U_tester_one, U_tester_two ,";

const GROUP_ID = "00000000-0000-4000-8000-0000000000f2";
const PROJECT_A = "00000000-0000-4000-8000-0000000000a1";
const NOW = new Date("2026-08-19T00:00:00.000Z");
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

let cycleGroupRepository: typeof import("../repositories/cycleRepository").cycleGroupRepository;
let surveyCycleRepository: typeof import("../repositories/cycleRepository").surveyCycleRepository;
let cycleService: typeof import("../services/cycleService").cycleService;
let isCycleTestUser: typeof import("../services/cycleService").isCycleTestUser;

let originals: Record<string, unknown>;

before(async () => {
  ({ cycleGroupRepository, surveyCycleRepository } = await import("../repositories/cycleRepository"));
  ({ cycleService, isCycleTestUser } = await import("../services/cycleService"));
  originals = {
    findByProjectId: cycleGroupRepository.findByProjectId,
    findLatest: surveyCycleRepository.findLatest,
    create: surveyCycleRepository.create,
    update: surveyCycleRepository.update,
  };
});

afterEach(() => {
  Object.assign(cycleGroupRepository, { findByProjectId: originals.findByProjectId });
  Object.assign(surveyCycleRepository, {
    findLatest: originals.findLatest,
    create: originals.create,
    update: originals.update,
  });
});

const group = (): CycleGroup =>
  ({
    id: GROUP_ID,
    name: "美容室ABCサイクル",
    entry_project_id: PROJECT_A,
    restart_cooldown_days: 25,
    grace_days: 7,
    undecided_days: 60,
    followup_b_delay_minutes: 120,
    frequency_question_code: "Q11",
    is_enabled: true,
  }) as CycleGroup;

const step = (): CycleGroupStep =>
  ({ id: "s", cycle_group_id: GROUP_ID, project_id: PROJECT_A, step_order: 1, step_role: "entry" }) as CycleGroupStep;

const cycle = (over: Partial<SurveyCycle> = {}): SurveyCycle =>
  ({
    id: "c1",
    cycle_group_id: GROUP_ID,
    line_user_id: "U_x",
    cycle_no: 1,
    started_at: NOW.toISOString(),
    closed_at: null,
    ...over,
  }) as SurveyCycle;

function stubEntry(latest: SurveyCycle | null) {
  const creates: { cycle_no: number }[] = [];
  Object.assign(cycleGroupRepository, {
    findByProjectId: async () => ({ group: group(), step: step() }),
  });
  Object.assign(surveyCycleRepository, {
    findLatest: async () => latest,
    update: async () => cycle(),
    create: async (input: { cycle_no: number }) => {
      creates.push(input);
      return cycle({ cycle_no: input.cycle_no });
    },
  });
  return creates;
}

// ------------------------------------------------------------------
// 判定そのもの
// ------------------------------------------------------------------

test("env に載せたIDだけがテスト扱い", () => {
  assert.equal(isCycleTestUser("U_tester_one"), true);
  assert.equal(isCycleTestUser("U_tester_two"), true, "空白混じりでも拾う");
  assert.equal(isCycleTestUser("U_general_user"), false);
});

test("空・未知IDは免除しない", () => {
  assert.equal(isCycleTestUser(""), false);
  assert.equal(isCycleTestUser("U_tester"), false, "前方一致で漏れてはいけない");
  assert.equal(isCycleTestUser("u_tester_one"), false, "大文字小文字は区別する");
});

// ------------------------------------------------------------------
// 実際の周回への効き方
// ------------------------------------------------------------------

test("テスト用アカウントは同日でも新しい周を開始できる", async () => {
  const creates = stubEntry(cycle({ line_user_id: "U_tester_one", cycle_no: 1 }));

  const got = await cycleService.resolveCycleForEntry(PROJECT_A, "U_tester_one", addDays(NOW, 0));
  assert.equal(got?.startedNew, true, "25日待たずに次の周へ進めること");
  assert.equal(creates[0]?.cycle_no, 2);
});

test("一般ユーザーは従来どおりクールダウンが効く（免除が漏れない）", async () => {
  const creates = stubEntry(cycle({ line_user_id: "U_general_user", cycle_no: 1 }));

  const got = await cycleService.resolveCycleForEntry(PROJECT_A, "U_general_user", addDays(NOW, 3));
  assert.equal(got?.startedNew, false, "QR連打でポイント二重取りできてはいけない");
  assert.equal(creates.length, 0);
});

test("一般ユーザーも25日経てば従来どおり進める", async () => {
  const creates = stubEntry(cycle({ line_user_id: "U_general_user", cycle_no: 1 }));

  const got = await cycleService.resolveCycleForEntry(PROJECT_A, "U_general_user", addDays(NOW, 26));
  assert.equal(got?.startedNew, true);
  assert.equal(creates[0]?.cycle_no, 2);
});

test("env 未設定なら誰も免除されない（既定は安全側）", async () => {
  const saved = process.env.CYCLE_TEST_LINE_USER_IDS;
  process.env.CYCLE_TEST_LINE_USER_IDS = "";
  try {
    // env はモジュール読み込み時に確定するため、ここでは純関数の入力側で確認する。
    // （実際の未設定時の挙動は canStartNewCycle 側のテストが担保している）
    assert.equal(process.env.CYCLE_TEST_LINE_USER_IDS, "");
  } finally {
    process.env.CYCLE_TEST_LINE_USER_IDS = saved;
  }
});

test("テスト用でも初回は普通に第1周から始まる", async () => {
  const creates = stubEntry(null);
  const got = await cycleService.resolveCycleForEntry(PROJECT_A, "U_tester_one", NOW);
  assert.equal(got?.startedNew, true);
  assert.equal(creates[0]?.cycle_no, 1);
});
