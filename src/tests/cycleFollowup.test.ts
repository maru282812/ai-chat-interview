/**
 * cycleFollowup.test.ts
 *
 * C（離脱検証）と B（来店後）の自動送付（Migration 093 / 094）。
 *
 * このコードは実際に LINE へプッシュするので、
 * 「二重送信しない」ことを最優先で固定する。毎分 cron で走るため、
 * 冪等性が崩れると同じ人に何十通も飛ぶ。
 */

import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import type { CycleGroup, CycleGroupStep, Project, SurveyCycle } from "../types/domain";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_PASSWORD_HASH ||= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ||= "test-admin-session-secret-000000000000";

const GROUP_ID = "00000000-0000-4000-8000-0000000000f1";
const PROJECT_B = "00000000-0000-4000-8000-0000000000b1";
const PROJECT_C = "00000000-0000-4000-8000-0000000000c1";
const LINE_USER = "Uffffffffffffffffffffffffffffffff";
const NOW = new Date("2026-08-01T00:00:00.000Z");

let cycleGroupRepository: typeof import("../repositories/cycleRepository").cycleGroupRepository;
let surveyCycleRepository: typeof import("../repositories/cycleRepository").surveyCycleRepository;
let projectRepository: typeof import("../repositories/projectRepository").projectRepository;
let lineMessagingService: typeof import("../services/lineMessagingService").lineMessagingService;
let cycleFollowupService: typeof import("../services/cycleFollowupService").cycleFollowupService;

let originals: Record<string, unknown>;
/** 送信された LINE メッセージ（宛先とテキスト） */
let pushes: { userId: string; text: string }[];

before(async () => {
  ({ cycleGroupRepository, surveyCycleRepository } = await import("../repositories/cycleRepository"));
  ({ projectRepository } = await import("../repositories/projectRepository"));
  ({ lineMessagingService } = await import("../services/lineMessagingService"));
  ({ cycleFollowupService } = await import("../services/cycleFollowupService"));
  originals = {
    listDue: surveyCycleRepository.listFollowupDue,
    listBDue: surveyCycleRepository.listFollowupBDue,
    update: surveyCycleRepository.update,
    getGroup: cycleGroupRepository.getById,
    listSteps: cycleGroupRepository.listSteps,
    getProject: projectRepository.getById,
    push: lineMessagingService.push,
  };
});

afterEach(() => {
  Object.assign(surveyCycleRepository, {
    listFollowupDue: originals.listDue,
    listFollowupBDue: originals.listBDue,
    update: originals.update,
  });
  Object.assign(cycleGroupRepository, {
    getById: originals.getGroup,
    listSteps: originals.listSteps,
  });
  Object.assign(projectRepository, { getById: originals.getProject });
  Object.assign(lineMessagingService, { push: originals.push });
});

const group = (over: Partial<CycleGroup> = {}): CycleGroup =>
  ({
    id: GROUP_ID,
    name: "美容室ABCサイクル",
    entry_project_id: "a",
    followup_project_id: PROJECT_C,
    grace_days: 7,
    undecided_days: 60,
    restart_cooldown_days: 25,
    followup_b_delay_minutes: 120,
    is_enabled: true,
    ...over,
  }) as CycleGroup;

const cycle = (over: Partial<SurveyCycle> = {}): SurveyCycle =>
  ({
    id: "cyc1",
    cycle_group_id: GROUP_ID,
    line_user_id: LINE_USER,
    cycle_no: 1,
    started_at: NOW.toISOString(),
    expected_return_at: NOW.toISOString(),
    followup_sent_at: null,
    followup_b_scheduled_at: null,
    followup_b_sent_at: null,
    returned_at: null,
    closed_at: null,
    ...over,
  }) as SurveyCycle;

const project = (id: string, entryCode: string | null): Project =>
  ({ id, name: "本音アンケート", user_display_title: null, entry_code: entryCode }) as Project;

/** 送信系の共通スタブ。updates には update 呼び出しを記録する。 */
function stubSend(updates: Record<string, unknown>[]) {
  pushes = [];
  Object.assign(surveyCycleRepository, {
    update: async (_id: string, input: Record<string, unknown>) => {
      updates.push(input);
      return cycle();
    },
  });
  Object.assign(cycleGroupRepository, {
    getById: async () => group(),
    listSteps: async () =>
      [
        { project_id: PROJECT_B, step_role: "followup", step_order: 2 },
        { project_id: PROJECT_C, step_role: "verify", step_order: 3 },
      ] as CycleGroupStep[],
  });
  Object.assign(projectRepository, {
    getById: async (id: string) => project(id, id === PROJECT_C ? "yotto-salon-c" : "yotto-salon-b"),
  });
  Object.assign(lineMessagingService, {
    push: async (userId: string, messages: { text?: string }[]) => {
      pushes.push({ userId, text: messages[0]?.text ?? "" });
    },
  });
}

// ------------------------------------------------------------------
// C（離脱検証）の送付
// ------------------------------------------------------------------

test("対象が無ければ何も送らない（未使用環境でのコストゼロ）", async () => {
  const updates: Record<string, unknown>[] = [];
  stubSend(updates);
  Object.assign(surveyCycleRepository, { listFollowupDue: async () => [] });

  const result = await cycleFollowupService.runFollowupDispatch(NOW);
  assert.deepEqual(result, { checked: 0, sent: 0, failed: 0, skipped: 0 });
  assert.equal(pushes.length, 0);
});

test("期限を過ぎたサイクルに C を送り、entry_code 付きURLを渡す", async () => {
  const updates: Record<string, unknown>[] = [];
  stubSend(updates);
  Object.assign(surveyCycleRepository, { listFollowupDue: async () => [cycle()] });

  const result = await cycleFollowupService.runFollowupDispatch(NOW);
  assert.equal(result.sent, 1);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0]?.userId, LINE_USER);
  // LIFF 恒久URL（liff.line.me）で /liff/store 導線に乗せる
  // （サイト直URLだと in-app ブラウザのログインループを踏む。respondent /
  //   assignment / サイクルは着地先の /liff/store で解決される）
  assert.match(pushes[0]?.text ?? "", /https:\/\/liff\.line\.me\/[^?\s]+\?entry_code=yotto-salon-c/);
});

test("送信前に followup_sent_at を立てる（毎分cronでも二重送信しない）", async () => {
  const updates: Record<string, unknown>[] = [];
  stubSend(updates);
  Object.assign(surveyCycleRepository, { listFollowupDue: async () => [cycle()] });

  await cycleFollowupService.runFollowupDispatch(NOW);
  assert.equal(updates[0]?.followup_sent_at, NOW.toISOString(), "送信より先にクレームすること");
});

test("push が失敗しても followup_sent_at は戻さない（二重送信より未送信を選ぶ）", async () => {
  const updates: Record<string, unknown>[] = [];
  stubSend(updates);
  Object.assign(surveyCycleRepository, { listFollowupDue: async () => [cycle()] });
  Object.assign(lineMessagingService, {
    push: async () => {
      throw new Error("LINE 429");
    },
  });

  const result = await cycleFollowupService.runFollowupDispatch(NOW);
  assert.equal(result.failed, 1);
  assert.equal(result.sent, 0);
  // クレームを取り消す update が来ていないこと
  assert.ok(
    !updates.some((u) => u.followup_sent_at === null),
    "失敗時に送信済みフラグを戻してはいけない"
  );
});

test("離脱検証案件が未設定のグループはスキップ（A→B だけの構成）", async () => {
  const updates: Record<string, unknown>[] = [];
  stubSend(updates);
  Object.assign(surveyCycleRepository, { listFollowupDue: async () => [cycle()] });
  Object.assign(cycleGroupRepository, { getById: async () => group({ followup_project_id: null }) });

  const result = await cycleFollowupService.runFollowupDispatch(NOW);
  assert.equal(result.skipped, 1);
  assert.equal(pushes.length, 0);
});

test("無効化されたグループには送らない（運用で止められる）", async () => {
  const updates: Record<string, unknown>[] = [];
  stubSend(updates);
  Object.assign(surveyCycleRepository, { listFollowupDue: async () => [cycle()] });
  Object.assign(cycleGroupRepository, { getById: async () => group({ is_enabled: false }) });

  const result = await cycleFollowupService.runFollowupDispatch(NOW);
  assert.equal(result.skipped, 1);
  assert.equal(pushes.length, 0);
});

test("1人が失敗しても他の人の送信は続く", async () => {
  const updates: Record<string, unknown>[] = [];
  stubSend(updates);
  Object.assign(surveyCycleRepository, {
    listFollowupDue: async () => [
      cycle({ id: "c1", line_user_id: "U_ng" }),
      cycle({ id: "c2", line_user_id: "U_ok" }),
    ],
  });
  Object.assign(lineMessagingService, {
    push: async (userId: string, messages: { text?: string }[]) => {
      if (userId === "U_ng") throw new Error("blocked");
      pushes.push({ userId, text: messages[0]?.text ?? "" });
    },
  });

  const result = await cycleFollowupService.runFollowupDispatch(NOW);
  assert.equal(result.failed, 1);
  assert.equal(result.sent, 1);
  assert.equal(pushes[0]?.userId, "U_ok");
});

// ------------------------------------------------------------------
// B（来店後）の遅延送信
// ------------------------------------------------------------------

test("予定時刻を過ぎた B を送る", async () => {
  const updates: Record<string, unknown>[] = [];
  stubSend(updates);
  Object.assign(surveyCycleRepository, {
    listFollowupBDue: async () => [cycle({ followup_b_scheduled_at: NOW.toISOString() })],
  });

  const result = await cycleFollowupService.runFollowupBDispatch(NOW);
  assert.equal(result.sent, 1);
  assert.match(pushes[0]?.text ?? "", /https:\/\/liff\.line\.me\/[^?\s]+\?entry_code=yotto-salon-b/);
});

test("B も送信前にクレームする（二重送信しない）", async () => {
  const updates: Record<string, unknown>[] = [];
  stubSend(updates);
  Object.assign(surveyCycleRepository, {
    listFollowupBDue: async () => [cycle({ followup_b_scheduled_at: NOW.toISOString() })],
  });

  await cycleFollowupService.runFollowupBDispatch(NOW);
  assert.equal(updates[0]?.followup_b_sent_at, NOW.toISOString());
});

test("B のステップが定義されていないグループはスキップ", async () => {
  const updates: Record<string, unknown>[] = [];
  stubSend(updates);
  Object.assign(surveyCycleRepository, {
    listFollowupBDue: async () => [cycle({ followup_b_scheduled_at: NOW.toISOString() })],
  });
  Object.assign(cycleGroupRepository, {
    listSteps: async () => [{ project_id: PROJECT_C, step_role: "verify", step_order: 2 }] as CycleGroupStep[],
  });

  const result = await cycleFollowupService.runFollowupBDispatch(NOW);
  assert.equal(result.skipped, 1);
  assert.equal(pushes.length, 0);
});
