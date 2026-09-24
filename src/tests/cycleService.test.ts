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
const PROJECT_C = "00000000-0000-4000-8000-0000000000c1";
const LINE_USER = "Uffffffffffffffffffffffffffffffff";
const NOW = new Date("2026-08-01T00:00:00.000Z");
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86400000);

let cycleGroupRepository: typeof import("../repositories/cycleRepository").cycleGroupRepository;
let surveyCycleRepository: typeof import("../repositories/cycleRepository").surveyCycleRepository;
let projectAssignmentRepository: typeof import("../repositories/projectAssignmentRepository").projectAssignmentRepository;
let cycleService: typeof import("../services/cycleService").cycleService;

let originals: Record<string, unknown>;

before(async () => {
  ({ cycleGroupRepository, surveyCycleRepository } = await import("../repositories/cycleRepository"));
  ({ projectAssignmentRepository } = await import("../repositories/projectAssignmentRepository"));
  ({ cycleService } = await import("../services/cycleService"));
  originals = {
    findByProjectId: cycleGroupRepository.findByProjectId,
    getById: cycleGroupRepository.getById,
    findOpen: surveyCycleRepository.findOpen,
    findLatest: surveyCycleRepository.findLatest,
    findLatestFollowupBSent: surveyCycleRepository.findLatestFollowupBSent,
    create: surveyCycleRepository.create,
    update: surveyCycleRepository.update,
    cycleGetById: surveyCycleRepository.getById,
    existsCompletedForCycle: projectAssignmentRepository.existsCompletedForCycle,
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
    findLatestFollowupBSent: originals.findLatestFollowupBSent,
    create: originals.create,
    update: originals.update,
    getById: originals.cycleGetById,
  });
  Object.assign(projectAssignmentRepository, {
    existsCompletedForCycle: originals.existsCompletedForCycle,
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
    findLatestFollowupBSent: async () => null, // B の案内はまだ送っていない
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
  Object.assign(surveyCycleRepository, {
    findOpen: async () => null,
    findLatestFollowupBSent: async () => null,
  });

  assert.equal(await cycleService.resolveCycleForEntry(PROJECT_B, LINE_USER, NOW), null);
});

test("B は案内を送った周に紐づく（A を撃ち直して周が変わっていても）", async () => {
  // B の案内が届いた後に A をもう一度回答すると周が切り替わる。
  // 開いている周（新しい方）に入れると、どの A に対する B か分からなくなる。
  Object.assign(cycleGroupRepository, {
    findByProjectId: async () => ({ group: group(), step: step("followup", PROJECT_B) }),
  });
  Object.assign(surveyCycleRepository, {
    findOpen: async () => cycle({ id: "new", cycle_no: 4 }),
    findLatestFollowupBSent: async () =>
      cycle({
        id: "sent",
        cycle_no: 3,
        followup_b_sent_at: NOW.toISOString(),
        closed_at: NOW.toISOString(),
      } as Partial<SurveyCycle>),
  });
  Object.assign(projectAssignmentRepository, { existsCompletedForCycle: async () => false });

  const got = await cycleService.resolveCycleForEntry(PROJECT_B, LINE_USER, NOW);
  assert.equal(got?.cycle.id, "sent", "案内を送った周（閉じていても）に紐づける");
  assert.equal(got?.cycle.cycle_no, 3);
});

test("送った周の B に既に答えていれば、開いている周に合流する", async () => {
  // 古い周の B を answered 済みなら引き戻さない（次の周の B に答えられる）。
  Object.assign(cycleGroupRepository, {
    findByProjectId: async () => ({ group: group(), step: step("followup", PROJECT_B) }),
  });
  Object.assign(surveyCycleRepository, {
    findOpen: async () => cycle({ id: "new", cycle_no: 4 }),
    findLatestFollowupBSent: async () =>
      cycle({ id: "sent", cycle_no: 3, followup_b_sent_at: NOW.toISOString() } as Partial<SurveyCycle>),
  });
  Object.assign(projectAssignmentRepository, { existsCompletedForCycle: async () => true });

  const got = await cycleService.resolveCycleForEntry(PROJECT_B, LINE_USER, NOW);
  assert.equal(got?.cycle.id, "new", "回答済みの周へ引き戻してはいけない");
});

test("C は案内を送った周の優先を受けない（従来どおり開いている周）", async () => {
  let consulted = false;
  Object.assign(cycleGroupRepository, {
    findByProjectId: async () => ({ group: group(), step: step("verify", PROJECT_C) }),
  });
  Object.assign(surveyCycleRepository, {
    findOpen: async () => cycle({ id: "new", cycle_no: 4 }),
    findLatestFollowupBSent: async () => {
      consulted = true;
      return cycle({ id: "sent", cycle_no: 3 });
    },
  });

  const got = await cycleService.resolveCycleForEntry(PROJECT_C, LINE_USER, NOW);
  assert.equal(got?.cycle.id, "new");
  assert.equal(consulted, false, "C の合流ロジックは変えない");
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

test("頻度設問が無い案件でも B の送信予約だけは立つ", async () => {
  // 実際に起きた事故: Q11 を持たない案件（智徳店・テスト店舗）では
  // 頻度設問が見つからず早期 return していたため、頻度と無関係な
  // B の予約まで立たず「A に答えても B が永久に来ない」状態だった。
  const updates: Record<string, unknown>[] = [];
  Object.assign(surveyCycleRepository, {
    getById: async () => cycle(),
    update: async (_id: string, input: Record<string, unknown>) => {
      updates.push(input);
      return cycle();
    },
  });
  Object.assign(cycleGroupRepository, {
    getById: async () => group({ followup_b_delay_minutes: 120 } as Partial<CycleGroup>),
  });

  await cycleService.captureEntryFrequency({
    cycleId: "c1",
    questions: [{ id: "q1", question_code: "Q1" }], // Q11 が無い
    answers: [{ question_id: "q1", answer_text: "なにか", answer_role: "primary" }],
    answeredAt: NOW,
  });

  assert.equal(updates.length, 1, "頻度が引けなくても更新自体は走る");
  assert.equal(
    updates[0]?.followup_b_scheduled_at,
    new Date(NOW.getTime() + 120 * 60_000).toISOString(),
    "B の予約は頻度と無関係に立てる"
  );
  assert.equal(updates[0]?.expected_return_at, null, "頻度が無いので C の判定日は立てない");
});

// ------------------------------------------------------------------
// 周を閉じても B は道連れにしない
// ------------------------------------------------------------------

test("A を撃ち直して前の周が閉じても、未送信の B の予約は消えない", async () => {
  // 実際に起きた事故(2026-09-17): A 完了の1分後に A をもう一度開いたら
  // 前の周が closed_at 付きで閉じられ、18:39 予定だった B が永久に来なかった。
  // 閉じる処理が followup_b_scheduled_at / followup_b_sent_at を触らないことを守る。
  const scheduledB = new Date(NOW.getTime() + 120 * 60_000).toISOString();
  const previous = cycle({
    id: "prev",
    cycle_no: 1,
    followup_b_scheduled_at: scheduledB,
    followup_b_sent_at: null,
  } as Partial<SurveyCycle>);

  const updates: Record<string, unknown>[] = [];
  Object.assign(cycleGroupRepository, {
    findByProjectId: async () => ({ group: group(), step: step("entry", PROJECT_A) }),
  });
  Object.assign(surveyCycleRepository, {
    findLatest: async () => previous,
    update: async (_id: string, input: Record<string, unknown>) => {
      updates.push(input);
      return previous;
    },
    create: async () => cycle({ id: "next", cycle_no: 2 }),
  });

  // クールダウンを超えた再訪＝新しい周が始まり、前の周が閉じられる。
  const got = await cycleService.resolveCycleForEntry(PROJECT_A, LINE_USER, addDays(NOW, 30));

  assert.equal(got?.startedNew, true, "新しい周が始まる");
  assert.equal(updates[0]?.close_reason, "returned", "前の周は閉じる（C の対象から外す）");
  assert.equal(
    Object.hasOwn(updates[0] ?? {}, "followup_b_scheduled_at"),
    false,
    "B の予約時刻を消してはいけない"
  );
  assert.equal(
    Object.hasOwn(updates[0] ?? {}, "followup_b_sent_at"),
    false,
    "B を送信済みに偽装してはいけない"
  );
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
