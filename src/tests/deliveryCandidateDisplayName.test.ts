import assert from "node:assert/strict";
import { test } from "node:test";
import { assignmentService } from "../services/assignmentService";
import { projectRepository } from "../repositories/projectRepository";
import { projectAssignmentRepository } from "../repositories/projectAssignmentRepository";
import { respondentRepository } from "../repositories/respondentRepository";
import { rankRepository } from "../repositories/rankRepository";
import { userProfileRepository } from "../repositories/userProfileRepository";
import { sessionRepository } from "../repositories/sessionRepository";
import { userPointService } from "../services/userPointService";

/**
 * 手動配信画面（/admin/projects/:id/delivery）の表示名。
 *
 * respondents.display_name には LINE の表示名が入るが、これを書き込む経路は
 * 投稿 / LINEトーク会話 / 店舗QR に限られ、マイページを開くだけでは埋まらない。
 * そのため実ユーザーほど null のまま残り、一覧の名前欄が「-」だらけになって
 * 「誰を選んでいるのか分からない」状態になっていた（デモユーザーだけ seed が
 * 文字列を直接入れているので名前が出ており、余計に紛らわしかった）。
 *
 * 本人がマイページで登録した user_profiles.nickname を優先して出す、を固定する。
 */

const PROJECT_ID = "00000000-0000-4000-8000-0000000000p1";

function respondentFixture(over: Record<string, unknown> = {}) {
  return {
    id: "r1",
    line_user_id: "U0000000000000000000000000000001",
    display_name: null,
    project_id: PROJECT_ID,
    status: "invited",
    total_points: 10,
    current_rank_id: null,
    current_rank: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    ...over
  } as never;
}

function profileFixture(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    line_user_id: "U0000000000000000000000000000001",
    nickname: "とむそーや",
    birth_date: null,
    ...over
  } as never;
}

async function withStubs<T>(
  stubs: {
    respondents: unknown[];
    profiles: unknown[];
    assignments?: unknown[];
    balances?: Record<string, number>;
  },
  run: () => Promise<T>
): Promise<T> {
  const originals = {
    listBalances: userPointService.listBalancesByLineUserIds,
    expire: projectAssignmentRepository.expireOverdueAssignments,
    getProject: projectRepository.getById,
    listProjects: projectRepository.list,
    listAssignments: projectAssignmentRepository.listByProject,
    listRespondents: respondentRepository.list,
    listRanks: rankRepository.list,
    listProfiles: userProfileRepository.listByLineUserIds,
    listSessions: sessionRepository.listAll
  };
  try {
    projectAssignmentRepository.expireOverdueAssignments = async () => undefined as never;
    projectRepository.getById = async () => ({ id: PROJECT_ID, title: "t" }) as never;
    projectRepository.list = async () => [] as never;
    projectAssignmentRepository.listByProject = async () =>
      (stubs.assignments ?? []) as never;
    respondentRepository.list = async () => stubs.respondents as never;
    rankRepository.list = async () => [] as never;
    userProfileRepository.listByLineUserIds = async () => stubs.profiles as never;
    sessionRepository.listAll = async () => [] as never;
    userPointService.listBalancesByLineUserIds = async () =>
      new Map(
        Object.entries(stubs.balances ?? {}).map(([id, pts]) => [
          id,
          { line_user_id: id, available_points: pts } as never
        ])
      );
    return await run();
  } finally {
    projectAssignmentRepository.expireOverdueAssignments = originals.expire;
    projectRepository.getById = originals.getProject;
    projectRepository.list = originals.listProjects;
    projectAssignmentRepository.listByProject = originals.listAssignments;
    respondentRepository.list = originals.listRespondents;
    rankRepository.list = originals.listRanks;
    userProfileRepository.listByLineUserIds = originals.listProfiles;
    sessionRepository.listAll = originals.listSessions;
    userPointService.listBalancesByLineUserIds = originals.listBalances;
  }
}

test("display_name が null でもマイページのニックネームを出す（これが「-」の正体）", async () => {
  const overview = await withStubs(
    { respondents: [respondentFixture()], profiles: [profileFixture()] },
    () => assignmentService.getProjectDeliveryOverview(PROJECT_ID)
  );

  assert.equal(overview.candidates.length, 1);
  assert.equal(overview.candidates[0]?.display_name, "とむそーや");
});

test("ニックネームは LINE 表示名より優先される（本人が名乗った名前で識別する）", async () => {
  const overview = await withStubs(
    {
      respondents: [respondentFixture({ display_name: "LINEの表示名" })],
      profiles: [profileFixture()]
    },
    () => assignmentService.getProjectDeliveryOverview(PROJECT_ID)
  );

  assert.equal(overview.candidates[0]?.display_name, "とむそーや");
});

test("ニックネーム未登録なら LINE 表示名へ落ちる", async () => {
  const overview = await withStubs(
    {
      respondents: [respondentFixture({ display_name: "LINEの表示名" })],
      profiles: [profileFixture({ nickname: null })]
    },
    () => assignmentService.getProjectDeliveryOverview(PROJECT_ID)
  );

  assert.equal(overview.candidates[0]?.display_name, "LINEの表示名");
});

test("どちらも無ければ null（画面側で「-」になる。ここを勝手に埋めない）", async () => {
  const overview = await withStubs(
    { respondents: [respondentFixture()], profiles: [profileFixture({ nickname: null })] },
    () => assignmentService.getProjectDeliveryOverview(PROJECT_ID)
  );

  assert.equal(overview.candidates[0]?.display_name, null);
});

test("配信済み一覧（assignments 側）の表示名もニックネームを優先する", async () => {
  const overview = await withStubs(
    {
      respondents: [respondentFixture()],
      profiles: [profileFixture()],
      assignments: [
        {
          id: "a1",
          project_id: PROJECT_ID,
          respondent_id: "r1",
          status: "sent",
          deadline: null,
          due_at: null,
          respondent: respondentFixture(),
          created_at: "2026-09-01T00:00:00.000Z",
          updated_at: "2026-09-01T00:00:00.000Z"
        }
      ]
    },
    () => assignmentService.getProjectDeliveryOverview(PROJECT_ID)
  );

  assert.equal(overview.assignments[0]?.assignment.respondent?.display_name, "とむそーや");
});

/**
 * 保有ポイントの出どころ。
 *
 * respondents.total_points はレガシーで、案件ごとに1行ずつ持つため
 * 「どの行を見るか」で値が変わる。マイページは正準の user_points を出しており、
 * 管理画面だけがレガシー側を見ていたので両画面の数字が食い違っていた
 * （本番で 18pt vs 21pt / 56pt vs 90pt の乖離を確認）。
 */

test("保有ポイントは正準の user_points を出す（レガシーの respondents ではない）", async () => {
  const overview = await withStubs(
    {
      respondents: [respondentFixture({ total_points: 18 })],
      profiles: [profileFixture()],
      balances: { "U0000000000000000000000000000001": 21 }
    },
    () => assignmentService.getProjectDeliveryOverview(PROJECT_ID)
  );

  assert.equal(overview.candidates[0]?.total_points, 21);
});

test("user_points に行が無い旧データは respondents へフォールバックする", async () => {
  const overview = await withStubs(
    {
      respondents: [respondentFixture({ total_points: 18 })],
      profiles: [profileFixture()],
      balances: {}
    },
    () => assignmentService.getProjectDeliveryOverview(PROJECT_ID)
  );

  assert.equal(overview.candidates[0]?.total_points, 18);
});
