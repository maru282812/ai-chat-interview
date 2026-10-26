import assert from "node:assert/strict";
import { before, test } from "node:test";
import type { Project, ProjectAssignment, Respondent } from "../types/domain";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_PASSWORD_HASH ||= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ||= "test-admin-session-secret-000000000000";

const PROJECT_ID = "00000000-0000-4000-8000-000000000a01";
const RESPONDENT_ID = "00000000-0000-4000-8000-000000000a02";
const ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000a03";
const SESSION_ID = "00000000-0000-4000-8000-000000000a04";
const LINE_USER_ID = "Udemo0000000000000000000000000000";

let isDemoProject: typeof import("../lib/demoProject").isDemoProject;
let projectRepository: typeof import("../repositories/projectRepository").projectRepository;
let respondentRepository: typeof import("../repositories/respondentRepository").respondentRepository;
let projectAssignmentRepository: typeof import("../repositories/projectAssignmentRepository").projectAssignmentRepository;
let pointTransactionRepository: typeof import("../repositories/pointTransactionRepository").pointTransactionRepository;
let rewardRuleRepository: typeof import("../repositories/rewardRuleRepository").rewardRuleRepository;
let cycleService: typeof import("../services/cycleService").cycleService;
let storeEntryService: typeof import("../services/storeEntryService").storeEntryService;
let pointService: typeof import("../services/pointService").pointService;
let lineMessagingService: typeof import("../services/lineMessagingService").lineMessagingService;
let runPostCompleteProcess: typeof import("../services/postCompleteService").runPostCompleteProcess;

before(async () => {
  ({ isDemoProject } = await import("../lib/demoProject"));
  ({ projectRepository } = await import("../repositories/projectRepository"));
  ({ respondentRepository } = await import("../repositories/respondentRepository"));
  ({ projectAssignmentRepository } = await import("../repositories/projectAssignmentRepository"));
  ({ pointTransactionRepository } = await import("../repositories/pointTransactionRepository"));
  ({ rewardRuleRepository } = await import("../repositories/rewardRuleRepository"));
  ({ cycleService } = await import("../services/cycleService"));
  ({ storeEntryService } = await import("../services/storeEntryService"));
  ({ pointService } = await import("../services/pointService"));
  ({ lineMessagingService } = await import("../services/lineMessagingService"));
  ({ runPostCompleteProcess } = await import("../services/postCompleteService"));
});

function projectFixture(isDemo: boolean): Project {
  return {
    id: PROJECT_ID,
    name: "デモ案件",
    reward_points: 100,
    visibility_type: "private_store",
    entry_code: "demo-code",
    is_demo: isDemo,
  } as unknown as Project;
}

function respondentFixture(): Respondent {
  return { id: RESPONDENT_ID, total_points: 50, line_user_id: LINE_USER_ID } as unknown as Respondent;
}

test("isDemoProject は is_demo === true のときだけ true", () => {
  assert.equal(isDemoProject({ is_demo: true }), true);
  assert.equal(isDemoProject({ is_demo: false }), false);
  assert.equal(isDemoProject({}), false);
  assert.equal(isDemoProject(null), false);
});

test("デモ案件の入口ではサイクルを解決しない＝A だけで完結する", async () => {
  const originals = {
    getProject: projectRepository.getStoreProjectByEntryCode,
    getResp: respondentRepository.getByLineUserAndProject,
    getAssign: projectAssignmentRepository.getByProjectRespondentAndCycle,
    resolve: cycleService.resolveCycleSafely,
  };
  let cycleResolved = false;
  let cycleIdUsed: string | null | undefined;
  projectRepository.getStoreProjectByEntryCode = async () => projectFixture(true);
  respondentRepository.getByLineUserAndProject = async () => respondentFixture();
  cycleService.resolveCycleSafely = async () => {
    cycleResolved = true;
    return null;
  };
  projectAssignmentRepository.getByProjectRespondentAndCycle = async (_p, _r, cycleId) => {
    cycleIdUsed = cycleId;
    return { id: ASSIGNMENT_ID } as ProjectAssignment;
  };
  try {
    const result = await storeEntryService.resolveEntry("demo-code", LINE_USER_ID);
    assert.equal(cycleResolved, false, "デモでは周を作らない");
    assert.equal(cycleIdUsed, null);
    assert.equal(result?.cycleId, null);
  } finally {
    projectRepository.getStoreProjectByEntryCode = originals.getProject;
    respondentRepository.getByLineUserAndProject = originals.getResp;
    projectAssignmentRepository.getByProjectRespondentAndCycle = originals.getAssign;
    cycleService.resolveCycleSafely = originals.resolve;
  }
});

test("デモ案件の完了ポイントは 0 で、明細も残高も作らない", async () => {
  const originals = {
    getById: projectRepository.getById,
    createTx: pointTransactionRepository.create,
    updateResp: respondentRepository.update,
    rules: rewardRuleRepository.listActive,
  };
  let touched = false;
  projectRepository.getById = async () => projectFixture(true);
  pointTransactionRepository.create = async () => {
    touched = true;
    throw new Error("呼ばれてはいけない");
  };
  respondentRepository.update = async () => {
    touched = true;
    throw new Error("呼ばれてはいけない");
  };
  rewardRuleRepository.listActive = async () => {
    touched = true;
    return [];
  };
  try {
    const result = await pointService.awardCompletionPoints({
      respondent: respondentFixture(),
      sessionId: SESSION_ID,
      projectId: PROJECT_ID,
      projectRewardPoints: 100,
      lineUserId: LINE_USER_ID,
    });
    assert.equal(result.totalAwarded, 0);
    assert.deepEqual(result.transactions, []);
    assert.equal(result.updatedRespondent.total_points, 50);
    assert.equal(touched, false);
  } finally {
    projectRepository.getById = originals.getById;
    pointTransactionRepository.create = originals.createTx;
    respondentRepository.update = originals.updateResp;
    rewardRuleRepository.listActive = originals.rules;
  }
});

test("デモ案件の完了後処理は LINE 通知もポイントも出さない", async () => {
  const originalPush = lineMessagingService.push;
  const originalAward = pointService.awardCompletionPoints;
  let pushed = false;
  let awarded = false;
  lineMessagingService.push = async () => {
    pushed = true;
  };
  pointService.awardCompletionPoints = async () => {
    awarded = true;
    throw new Error("呼ばれてはいけない");
  };
  try {
    await runPostCompleteProcess({
      assignmentId: ASSIGNMENT_ID,
      session: { id: SESSION_ID } as never,
      respondent: respondentFixture(),
      project: projectFixture(true),
      lineUserId: LINE_USER_ID,
    });
    assert.equal(pushed, false);
    assert.equal(awarded, false);
  } finally {
    lineMessagingService.push = originalPush;
    pointService.awardCompletionPoints = originalAward;
  }
});
