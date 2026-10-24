/**
 * テスト運営者（migration 119）の振る舞い。
 *
 * - 完了してもポイントを付与しない（全完了経路が通る pointService で止める）
 * - 回答し直し（retest）は運営者だけが通り、前回の回答を締めて assignment を未回答へ戻す
 * - 店舗開示の集計からテスト回答者のセッションを外す
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import type { Request, Response } from "express";
import type { Project, ProjectAssignment, Respondent, Session } from "../types/domain";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_PASSWORD_HASH ||= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ||= "test-admin-session-secret-000000000000";

const { testOperatorRepository } =
  require("../repositories/testOperatorRepository") as typeof import("../repositories/testOperatorRepository");
const { respondentRepository } =
  require("../repositories/respondentRepository") as typeof import("../repositories/respondentRepository");
const { sessionRepository } =
  require("../repositories/sessionRepository") as typeof import("../repositories/sessionRepository");
const { projectAssignmentRepository } =
  require("../repositories/projectAssignmentRepository") as typeof import("../repositories/projectAssignmentRepository");
const { projectRepository } =
  require("../repositories/projectRepository") as typeof import("../repositories/projectRepository");
const { questionRepository } =
  require("../repositories/questionRepository") as typeof import("../repositories/questionRepository");
const { answerRepository } =
  require("../repositories/answerRepository") as typeof import("../repositories/answerRepository");
const { rewardRuleRepository } =
  require("../repositories/rewardRuleRepository") as typeof import("../repositories/rewardRuleRepository");
const { pointTransactionRepository } =
  require("../repositories/pointTransactionRepository") as typeof import("../repositories/pointTransactionRepository");
const { pointService } = require("../services/pointService") as typeof import("../services/pointService");
const { partnerSurveyService } =
  require("../services/partnerSurveyService") as typeof import("../services/partnerSurveyService");
const { liffController } = require("../controllers/liffController") as typeof import("../controllers/liffController");

const OPERATOR_LINE_ID = "Uoperator000000000000000000000000";
const ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000701";
const RESPONDENT_ID = "00000000-0000-4000-8000-000000000702";
const PROJECT_ID = "00000000-0000-4000-8000-000000000703";

function stub<T extends object, K extends keyof T>(target: T, key: K, value: T[K]): () => void {
  const original = target[key];
  target[key] = value;
  return () => {
    target[key] = original;
  };
}

async function withStubs(restores: (() => void)[], body: () => Promise<void>): Promise<void> {
  try {
    await body();
  } finally {
    for (const restore of restores.reverse()) restore();
  }
}

function respondent(overrides: Partial<Respondent> = {}): Respondent {
  return {
    id: RESPONDENT_ID,
    line_user_id: OPERATOR_LINE_ID,
    display_name: "篠原",
    project_id: PROJECT_ID,
    status: "active",
    total_points: 100,
    current_rank_id: null,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    is_test: false,
    ...overrides
  };
}

function completedAssignment(): ProjectAssignment {
  return {
    id: ASSIGNMENT_ID,
    user_id: OPERATOR_LINE_ID,
    project_id: PROJECT_ID,
    respondent_id: RESPONDENT_ID,
    status: "completed",
    completed_at: "2026-10-20T00:00:00Z",
    started_at: "2026-10-20T00:00:00Z"
  } as ProjectAssignment;
}

function fakeRes(): { res: Response; body: () => unknown } {
  let sent: unknown = null;
  const res = {
    json(value: unknown) {
      sent = value;
      return res;
    }
  } as unknown as Response;
  return { res, body: () => sent };
}

function retestReq(): Request {
  return { params: { assignmentId: ASSIGNMENT_ID }, headers: {}, body: {}, path: "/survey/retest" } as unknown as Request;
}

test("テスト運営者の完了ではポイントを付与せず、回答者にテストの印を付ける", async () => {
  const marked: string[] = [];
  await withStubs(
    [
      stub(testOperatorRepository, "isTestOperator", async () => true),
      stub(respondentRepository, "markTest", async (id: string) => {
        marked.push(id);
      }),
      stub(respondentRepository, "update", async () => respondent({ status: "completed" })),
      stub(pointTransactionRepository, "create", async () => {
        throw new Error("テスト運営者にポイント明細を作ってはいけない");
      })
    ],
    async () => {
      const result = await pointService.awardCompletionPoints({
        respondent: respondent(),
        sessionId: "s1",
        projectId: PROJECT_ID,
        projectRewardPoints: 50,
        lineUserId: OPERATOR_LINE_ID
      });
      assert.equal(result.totalAwarded, 0);
      assert.deepEqual(result.transactions, []);
      assert.equal(result.updatedRespondent.is_test, true);
      assert.equal(result.updatedRespondent.total_points, 100, "残高は動かない");
      assert.deepEqual(marked, [RESPONDENT_ID]);
    }
  );
});

test("運営者でなければ通常どおり付与処理へ進む", async () => {
  const sentinel = new Error("reached-normal-award");
  await withStubs(
    [
      stub(testOperatorRepository, "isTestOperator", async () => false),
      stub(rewardRuleRepository, "listActive", async () => {
        throw sentinel;
      })
    ],
    async () => {
      await assert.rejects(
        pointService.awardCompletionPoints({
          respondent: respondent(),
          sessionId: "s1",
          projectId: PROJECT_ID,
          projectRewardPoints: 50,
          lineUserId: "Ugeneral"
        }),
        sentinel
      );
    }
  );
});

test("retest: 運営者でなければ 403 で、何も書き換えない", async () => {
  await withStubs(
    [
      stub(projectAssignmentRepository, "getById", async () => completedAssignment()),
      stub(testOperatorRepository, "isTestOperator", async () => false),
      stub(projectAssignmentRepository, "update", async () => {
        throw new Error("一般の回答者の assignment を戻してはいけない");
      }),
      stub(sessionRepository, "abandonOpenByRespondent", async () => {
        throw new Error("一般の回答者のセッションを締めてはいけない");
      })
    ],
    async () => {
      const { res } = fakeRes();
      await assert.rejects(liffController.retestSurvey(retestReq(), res), (error: unknown) => {
        assert.equal((error as { statusCode?: number }).statusCode, 403);
        return true;
      });
    }
  );
});

test("retest: 運営者なら前回の回答を締め、assignment を未回答へ戻す", async () => {
  const calls: string[] = [];
  let updateInput: Record<string, unknown> | null = null;
  await withStubs(
    [
      stub(projectAssignmentRepository, "getById", async () => completedAssignment()),
      stub(testOperatorRepository, "isTestOperator", async (id) => id === OPERATOR_LINE_ID),
      stub(respondentRepository, "markTest", async (id: string) => {
        calls.push(`markTest:${id}`);
      }),
      stub(sessionRepository, "abandonOpenByRespondent", async (respondentId: string, projectId: string) => {
        calls.push(`abandon:${respondentId}:${projectId}`);
      }),
      stub(projectAssignmentRepository, "update", async (_id: string, input: Record<string, unknown>) => {
        updateInput = input;
        return completedAssignment();
      })
    ],
    async () => {
      const { res, body } = fakeRes();
      await liffController.retestSurvey(retestReq(), res);
      assert.deepEqual(body(), { ok: true });
      assert.deepEqual(calls, [`markTest:${RESPONDENT_ID}`, `abandon:${RESPONDENT_ID}:${PROJECT_ID}`]);
      assert.deepEqual(updateInput, {
        status: "opened",
        started_at: null,
        completed_at: null,
        screening_result: null,
        screening_result_at: null
      });
    }
  );
});

test("店舗開示の件数にテスト回答者のセッションを含めない", async () => {
  const session = (id: string, respondentId: string) =>
    ({ id, respondent_id: respondentId, project_id: PROJECT_ID, status: "completed", completed_at: null }) as Session;
  await withStubs(
    [
      stub(projectRepository, "getPartnerProject", async () => ({ id: PROJECT_ID, status: "published" }) as Project),
      stub(questionRepository, "listByProject", async () => []),
      stub(sessionRepository, "listByProject", async () => [session("s-real", "r-real"), session("s-test", "r-test")]),
      stub(respondentRepository, "listTestIdsByProject", async () => new Set(["r-test"])),
      stub(answerRepository, "listBySessions", async (ids: string[]) => {
        assert.deepEqual(ids, ["s-real"], "テスト回答は回答の読み込み対象にも入らない");
        return [];
      })
    ],
    async () => {
      const stats = await partnerSurveyService.getStats("store-1", PROJECT_ID);
      assert.equal(stats.total_count, 1);
    }
  );
});
