/**
 * crossProjectAnswerLoad.test.ts
 *
 * 別案件回答の「読み込み経路」（crossProjectAnswerService）の回帰テスト。
 *
 * 既存の crossProjectCarryForward.test.ts は buildAnswerContext / applyCarryForward という
 * 純関数側だけを、手で組んだ CrossProjectAnswers を渡して検証していた。
 * そのため「参照先の回答を実際に集めてくる」段が無検証で、
 * respondent の取り違え（下記）が素通りしていた。
 *
 * 取り違えの内容:
 *   respondents は (line_user_id, project_id) で1行 ＝ 案件ごとに別レコード。
 *   呼び出し元は「いま回答中の案件（C）」の respondent_id を渡すため、
 *   それで参照先（A）の session を引いても絶対に一致せず carry-forward が常に空になる。
 */

import assert from "node:assert/strict";
import { afterEach, before, test } from "node:test";
import type { Answer, Project, Question, Respondent, Session } from "../types/domain";

process.env.NODE_ENV ||= "test";
process.env.SUPABASE_URL ||= "http://localhost:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ||= "test-service-role-key";
process.env.LINE_CHANNEL_ACCESS_TOKEN ||= "test-line-token";
process.env.LINE_CHANNEL_SECRET ||= "test-line-secret";
process.env.OPENAI_API_KEY ||= "test-openai-key";
process.env.DEFAULT_PROJECT_ID ||= "00000000-0000-4000-8000-000000000099";
process.env.ADMIN_PASSWORD_HASH ||= "scrypt$16384$8$1$00$00";
process.env.ADMIN_SESSION_SECRET ||= "test-admin-session-secret-000000000000";

const LINE_USER_ID = "Uffffffffffffffffffffffffffffffff";
const PROJECT_A_ID = "00000000-0000-4000-8000-0000000000a1";
const PROJECT_C_ID = "00000000-0000-4000-8000-0000000000c1";
/** C案件の respondent（＝呼び出し元が渡してくるもの） */
const RESPONDENT_C_ID = "00000000-0000-4000-8000-0000000000c2";
/** A案件の respondent（＝参照先。C とは別IDである点が肝） */
const RESPONDENT_A_ID = "00000000-0000-4000-8000-0000000000a2";
const SESSION_A_ID = "00000000-0000-4000-8000-0000000000a3";
const QUESTION_A5_ID = "00000000-0000-4000-8000-0000000000a5";

let projectRepository: typeof import("../repositories/projectRepository").projectRepository;
let respondentRepository: typeof import("../repositories/respondentRepository").respondentRepository;
let sessionRepository: typeof import("../repositories/sessionRepository").sessionRepository;
let questionRepository: typeof import("../repositories/questionRepository").questionRepository;
let answerRepository: typeof import("../repositories/answerRepository").answerRepository;
let loadCrossProjectAnswers: typeof import("../services/crossProjectAnswerService").loadCrossProjectAnswers;

type Originals = {
  findAnyByEntryCode: unknown;
  getById: unknown;
  getByLineUserAndProject: unknown;
  listByRespondent: unknown;
  listByProject: unknown;
  listBySessions: unknown;
};
let originals: Originals;

before(async () => {
  ({ projectRepository } = await import("../repositories/projectRepository"));
  ({ respondentRepository } = await import("../repositories/respondentRepository"));
  ({ sessionRepository } = await import("../repositories/sessionRepository"));
  ({ questionRepository } = await import("../repositories/questionRepository"));
  ({ answerRepository } = await import("../repositories/answerRepository"));
  ({ loadCrossProjectAnswers } = await import("../services/crossProjectAnswerService"));

  originals = {
    findAnyByEntryCode: projectRepository.findAnyByEntryCode,
    getById: respondentRepository.getById,
    getByLineUserAndProject: respondentRepository.getByLineUserAndProject,
    listByRespondent: sessionRepository.listByRespondent,
    listByProject: questionRepository.listByProject,
    listBySessions: answerRepository.listBySessions,
  };
});

afterEach(() => {
  Object.assign(projectRepository, { findAnyByEntryCode: originals.findAnyByEntryCode });
  Object.assign(respondentRepository, {
    getById: originals.getById,
    getByLineUserAndProject: originals.getByLineUserAndProject,
  });
  Object.assign(sessionRepository, { listByRespondent: originals.listByRespondent });
  Object.assign(questionRepository, { listByProject: originals.listByProject });
  Object.assign(answerRepository, { listBySessions: originals.listBySessions });
});

const respondent = (id: string, projectId: string): Respondent =>
  ({ id, line_user_id: LINE_USER_ID, project_id: projectId }) as Respondent;

/**
 * A案件に回答済みのユーザーを組み立てる。
 * respondent は案件ごとに別IDである、という実データの形を忠実に再現する。
 */
function stubHappyPath(calls: { lookedUpWith: string[] }) {
  Object.assign(projectRepository, {
    findAnyByEntryCode: async (code: string) =>
      code === "yotto-salon-a" ? ({ id: PROJECT_A_ID } as Project) : null,
  });
  Object.assign(respondentRepository, {
    getById: async (id: string) =>
      id === RESPONDENT_C_ID ? respondent(RESPONDENT_C_ID, PROJECT_C_ID) : null,
    getByLineUserAndProject: async (lineUserId: string, projectId: string) =>
      lineUserId === LINE_USER_ID && projectId === PROJECT_A_ID
        ? respondent(RESPONDENT_A_ID, PROJECT_A_ID)
        : null,
  });
  Object.assign(sessionRepository, {
    listByRespondent: async (respondentId: string) => {
      calls.lookedUpWith.push(respondentId);
      // A案件の session は A案件の respondent にしか紐づかない。
      return respondentId === RESPONDENT_A_ID
        ? ([{ id: SESSION_A_ID, project_id: PROJECT_A_ID }] as Session[])
        : [];
    },
  });
  Object.assign(questionRepository, {
    listByProject: async () =>
      [{ id: QUESTION_A5_ID, question_code: "Q5", question_type: "multi_choice" }] as Question[],
  });
  Object.assign(answerRepository, {
    listBySessions: async () =>
      [
        { question_id: QUESTION_A5_ID, answer_text: "cut,color", answer_role: "primary" },
      ] as Answer[],
  });
}

const salonProject = { carry_forward_sources: [{ namespace: "a", entry_code: "yotto-salon-a" }] };

test("参照先案件の respondent を引き直して回答を読み込む（取り違え回帰）", async () => {
  const calls = { lookedUpWith: [] as string[] };
  stubHappyPath(calls);

  const loaded = await loadCrossProjectAnswers(salonProject as never, RESPONDENT_C_ID);

  assert.equal(loaded.length, 1, "A案件の回答が1件読み込まれること");
  assert.equal(loaded[0]?.namespace, "a");
  assert.equal(loaded[0]?.answers[0]?.answer_text, "cut,color");

  // 修正前は C の respondent_id で session を引いていたため空になっていた。
  assert.ok(
    calls.lookedUpWith.includes(RESPONDENT_A_ID),
    "session はA案件の respondent_id で引くこと"
  );
  assert.ok(
    !calls.lookedUpWith.includes(RESPONDENT_C_ID),
    "C案件の respondent_id で session を引いてはいけない"
  );
});

test("参照先案件に respondent が無い（未回答）なら空", async () => {
  const calls = { lookedUpWith: [] as string[] };
  stubHappyPath(calls);
  Object.assign(respondentRepository, { getByLineUserAndProject: async () => null });

  const loaded = await loadCrossProjectAnswers(salonProject as never, RESPONDENT_C_ID);
  assert.deepEqual(loaded, []);
});

test("参照先案件が存在しない entry_code なら空（例外にしない）", async () => {
  const calls = { lookedUpWith: [] as string[] };
  stubHappyPath(calls);
  Object.assign(projectRepository, { findAnyByEntryCode: async () => null });

  const loaded = await loadCrossProjectAnswers(salonProject as never, RESPONDENT_C_ID);
  assert.deepEqual(loaded, []);
});

test("参照先の読み込みが失敗しても回答導線を止めない", async () => {
  const calls = { lookedUpWith: [] as string[] };
  stubHappyPath(calls);
  Object.assign(sessionRepository, {
    listByRespondent: async () => {
      throw new Error("db down");
    },
  });

  const loaded = await loadCrossProjectAnswers(salonProject as never, RESPONDENT_C_ID);
  assert.deepEqual(loaded, [], "例外を投げずに空で返すこと");
});

test("carry_forward_sources 宣言が無ければ何も読まない", async () => {
  const calls = { lookedUpWith: [] as string[] };
  stubHappyPath(calls);

  const loaded = await loadCrossProjectAnswers({ carry_forward_sources: null } as never, RESPONDENT_C_ID);
  assert.deepEqual(loaded, []);
  assert.equal(calls.lookedUpWith.length, 0);
});

test("respondentId が null なら何も読まない", async () => {
  const calls = { lookedUpWith: [] as string[] };
  stubHappyPath(calls);

  const loaded = await loadCrossProjectAnswers(salonProject as never, null);
  assert.deepEqual(loaded, []);
  assert.equal(calls.lookedUpWith.length, 0);
});
