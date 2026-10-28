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

const PROJECT_ID = "00000000-0000-4000-8000-000000000b01";
const RESPONDENT_ID = "00000000-0000-4000-8000-000000000b02";
const ASSIGNMENT_ID = "00000000-0000-4000-8000-000000000b03";

let web: typeof import("../lib/webRespondent");
let projectRepository: typeof import("../repositories/projectRepository").projectRepository;
let respondentRepository: typeof import("../repositories/respondentRepository").respondentRepository;
let projectAssignmentRepository: typeof import("../repositories/projectAssignmentRepository").projectAssignmentRepository;
let cycleService: typeof import("../services/cycleService").cycleService;
let storeEntryService: typeof import("../services/storeEntryService").storeEntryService;
let lineMessagingService: typeof import("../services/lineMessagingService").lineMessagingService;

before(async () => {
  web = await import("../lib/webRespondent");
  ({ projectRepository } = await import("../repositories/projectRepository"));
  ({ respondentRepository } = await import("../repositories/respondentRepository"));
  ({ projectAssignmentRepository } = await import("../repositories/projectAssignmentRepository"));
  ({ cycleService } = await import("../services/cycleService"));
  ({ storeEntryService } = await import("../services/storeEntryService"));
  ({ lineMessagingService } = await import("../services/lineMessagingService"));
});

test("発行したトークンは検証でき、同じ回答者 web:<uuid> に戻る", () => {
  const issued = web.issueWebAnswerToken();
  assert.match(issued.userId, /^web:[0-9a-f-]{36}$/);
  assert.equal(web.isWebAnswerToken(issued.token), true);
  assert.equal(web.verifyWebAnswerToken(issued.token), issued.userId);
  assert.equal(web.isWebRespondentId(issued.userId), true);
});

test("改ざん・別の鍵・形式違いのトークンは通さない", () => {
  const { token } = web.issueWebAnswerToken();
  const [v, id, sig = ""] = token.split(".");
  const otherId = "11111111-1111-4111-8111-111111111111";
  assert.equal(web.verifyWebAnswerToken(`${v}.${otherId}.${sig}`), null, "id の差し替え");
  assert.equal(web.verifyWebAnswerToken(`${v}.${id}.${sig.replace(/.$/, sig.endsWith("0") ? "1" : "0")}`), null, "署名の改ざん");
  assert.equal(web.verifyWebAnswerToken(token, "another-secret-another-secret-000000"), null, "別の鍵");
  assert.equal(web.verifyWebAnswerToken("not-a-token"), null);
  assert.equal(web.verifyWebAnswerToken(""), null);
  assert.equal(web.verifyWebAnswerToken(null), null);
});

test("LINE の userId はブラウザ回答者として扱わない", () => {
  assert.equal(web.isWebRespondentId("U0123456789abcdef0123456789abcdef"), false);
  assert.equal(web.isWebRespondentId(null), false);
  assert.equal(web.isWebAnswerToken("eyJhbGciOi.xxx.yyy"), false, "LINE の ID トークン（JWT）");
});

test("ブラウザ回答者には LINE を送らない", async () => {
  const originalFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = (async () => {
    called = true;
    throw new Error("呼ばれてはいけない");
  }) as typeof fetch;
  try {
    await lineMessagingService.push("web:00000000-0000-4000-8000-000000000000", [{ type: "text", text: "x" }]);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ブラウザ回答の入口ではサイクルを作らない＝A だけで完結する", async () => {
  const originals = {
    getProject: projectRepository.getStoreProjectByEntryCode,
    getResp: respondentRepository.getByLineUserAndProject,
    getAssign: projectAssignmentRepository.getByProjectRespondentAndCycle,
    resolve: cycleService.resolveCycleSafely,
  };
  let cycleResolved = false;
  let cycleIdUsed: string | null | undefined;
  projectRepository.getStoreProjectByEntryCode = async () =>
    ({ id: PROJECT_ID, visibility_type: "private_store", entry_code: "shop", is_demo: false }) as unknown as Project;
  respondentRepository.getByLineUserAndProject = async () => ({ id: RESPONDENT_ID }) as unknown as Respondent;
  cycleService.resolveCycleSafely = async () => {
    cycleResolved = true;
    return null;
  };
  projectAssignmentRepository.getByProjectRespondentAndCycle = async (_p, _r, cycleId) => {
    cycleIdUsed = cycleId;
    return { id: ASSIGNMENT_ID } as ProjectAssignment;
  };
  try {
    const { userId } = web.issueWebAnswerToken();
    const result = await storeEntryService.resolveEntry("shop", userId, null, { browser: true });
    assert.equal(cycleResolved, false, "ブラウザ回答では周を作らない");
    assert.equal(cycleIdUsed, null);
    assert.equal(result?.assignmentId, ASSIGNMENT_ID);
  } finally {
    projectRepository.getStoreProjectByEntryCode = originals.getProject;
    respondentRepository.getByLineUserAndProject = originals.getResp;
    projectAssignmentRepository.getByProjectRespondentAndCycle = originals.getAssign;
    cycleService.resolveCycleSafely = originals.resolve;
  }
});
