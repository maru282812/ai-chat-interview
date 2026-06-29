/**
 * seed-test-fixtures.mjs
 * testmaster の画面テスト(run-screen)で blocked になっていた screening 系分岐に
 * 到達するための「使い捨てテストデータ」を投入/削除する。
 *
 *   - ② screening fail 画面 (liffController surveyPage: state_json.screening_result === "fail")
 *   - ③ 未判定スクリーニングの設問絞り込み (hasScreeningQuestions && !screeningJudged)
 *
 * 非破壊保証:
 *   - 固定 UUID（プレフィックス TEST_PREFIX）と tmtest_ の line_user_id だけを作成/削除する。
 *   - 実データを参照・更新しない（新規行のみ）。
 *   - upsert で冪等。teardown は該当行だけを削除（cascade で子行も消える）。
 *   - NODE_ENV=production では実行を中止する。
 *
 * Usage:
 *   node scripts/seed-test-fixtures.mjs seed
 *   node scripts/seed-test-fixtures.mjs teardown
 *   node scripts/seed-test-fixtures.mjs ids      # run-screen が使う id を表示
 */

import { config as loadDotEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NODE_ENV = process.env.NODE_ENV ?? "development";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です (.env を確認)。");
  process.exit(1);
}
if (NODE_ENV === "production") {
  console.error("NODE_ENV=production のため中止しました。テストデータは本番DBに投入しません。");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// 固定 ID（全て同一プレフィックスで teardown を一意化）
const P = "aaaaaaaa-0000-4000-8000-0000000000";
const ID = {
  project: `${P}01`,
  qScreening: `${P}11`,
  qMain: `${P}12`,
  respondentFail: `${P}21`,
  respondentUnjudged: `${P}22`,
  respondentCompleted: `${P}23`,
  respondentOwner: `${P}24`,
  assignmentFail: `${P}31`,
  assignmentUnjudged: `${P}32`,
  assignmentCompleted: `${P}33`,
  assignmentOwner: `${P}34`,
  sessionFail: `${P}41`,
  sessionUnjudged: `${P}42`,
  sessionCompleted: `${P}43`,
  sessionOwner: `${P}44`,
};
const LINE = {
  fail: "tmtest_screening_fail",
  unjudged: "tmtest_screening_unjudged",
  completed: "tmtest_completed",
  // owner: verify-identity 所有者一致 / profile 未確認誘導の両方に使う固定 LINE userId。
  // 認証 seam では Authorization: Bearer tmtest:tmtest_owner で本人として通る。
  owner: "tmtest_owner",
};

async function up({ table, row, onConflict = "id" }) {
  const { error } = await supabase.from(table).upsert(row, { onConflict });
  if (error) throw new Error(`upsert ${table} failed: ${error.message}`);
  console.log(`  upsert ${table} ${row.id}`);
}

async function seed() {
  // 1. テスト専用 project（screening 有効）
  await up({
    table: "projects",
    row: {
      id: ID.project,
      name: "[TESTMASTER] screening fixtures",
      status: "published",
      display_mode: "survey_question",
      screening_config: {
        enabled: true,
        fail_message: "今回はご参加いただけませんでした。(テスト用)",
      },
    },
  });

  // 2. screening 設問 + main 設問（③ の絞り込み対象判定に必要）
  await up({
    table: "questions",
    row: {
      id: ID.qScreening,
      project_id: ID.project,
      question_code: "tmtest_scr_q1",
      question_text: "（テスト）対象確認の質問",
      question_role: "screening",
      question_type: "single_choice",
      is_required: true,
      sort_order: 1,
      is_hidden: false,
    },
  });
  await up({
    table: "questions",
    row: {
      id: ID.qMain,
      project_id: ID.project,
      question_code: "tmtest_main_q1",
      question_text: "（テスト）本編の質問",
      question_role: "main",
      question_type: "free_text_short",
      is_required: true,
      sort_order: 2,
      is_hidden: false,
    },
  });

  // 3-A. ② screening fail 用: respondent + assignment + active session(state=fail)
  await up({
    table: "respondents",
    row: {
      id: ID.respondentFail,
      line_user_id: LINE.fail,
      display_name: "[TESTMASTER] fail",
      project_id: ID.project,
      status: "active",
    },
    onConflict: "line_user_id,project_id",
  });
  await up({
    table: "project_assignments",
    row: {
      id: ID.assignmentFail,
      project_id: ID.project,
      respondent_id: ID.respondentFail,
      assignment_type: "manual",
      status: "started",
    },
    onConflict: "project_id,respondent_id",
  });
  await up({
    table: "sessions",
    row: {
      id: ID.sessionFail,
      respondent_id: ID.respondentFail,
      project_id: ID.project,
      current_question_id: ID.qScreening,
      current_phase: "question",
      status: "active",
      state_json: {
        screening_result: "fail",
        screening_failed_conditions: ["（テスト）対象条件を満たしません"],
        screening_judged_at: new Date().toISOString(),
      },
    },
  });

  // 3-B. ③ 未判定用: 別 respondent + assignment + active session(screening_result 無し)
  await up({
    table: "respondents",
    row: {
      id: ID.respondentUnjudged,
      line_user_id: LINE.unjudged,
      display_name: "[TESTMASTER] unjudged",
      project_id: ID.project,
      status: "active",
    },
    onConflict: "line_user_id,project_id",
  });
  await up({
    table: "project_assignments",
    row: {
      id: ID.assignmentUnjudged,
      project_id: ID.project,
      respondent_id: ID.respondentUnjudged,
      assignment_type: "manual",
      status: "started",
    },
    onConflict: "project_id,respondent_id",
  });
  await up({
    table: "sessions",
    row: {
      id: ID.sessionUnjudged,
      respondent_id: ID.respondentUnjudged,
      project_id: ID.project,
      current_question_id: ID.qScreening,
      current_phase: "question",
      status: "active",
      state_json: {}, // screening_result 無し = 未判定
    },
  });

  // 3-C. 完了済み用: completed assignment + completed session（二重回答防止/再アクセス画面）。
  //      user_id は null のまま → profile 誘導分岐(branch5)を飛ばして completed 分岐(branch6)に入る。
  await up({
    table: "respondents",
    row: {
      id: ID.respondentCompleted,
      line_user_id: LINE.completed,
      display_name: "[TESTMASTER] completed",
      project_id: ID.project,
      status: "active",
    },
    onConflict: "line_user_id,project_id",
  });
  await up({
    table: "project_assignments",
    row: {
      id: ID.assignmentCompleted,
      project_id: ID.project,
      respondent_id: ID.respondentCompleted,
      assignment_type: "manual",
      status: "completed",
      completed_at: new Date().toISOString(),
    },
    onConflict: "project_id,respondent_id",
  });
  await up({
    table: "sessions",
    row: {
      id: ID.sessionCompleted,
      respondent_id: ID.respondentCompleted,
      project_id: ID.project,
      current_phase: "completed",
      status: "completed",
      state_json: {},
    },
  });

  // 3-D. 所有者/未確認誘導用: user_id を立てた started assignment + mypage 未確認 session。
  //      surveyPage では branch5(profile/check リダイレクト)に入る。
  //      verify-identity では assignment.user_id===LINE.owner との一致/不一致テストに使う。
  await up({
    table: "respondents",
    row: {
      id: ID.respondentOwner,
      line_user_id: LINE.owner,
      display_name: "[TESTMASTER] owner",
      project_id: ID.project,
      status: "active",
    },
    onConflict: "line_user_id,project_id",
  });
  await up({
    table: "project_assignments",
    row: {
      id: ID.assignmentOwner,
      project_id: ID.project,
      respondent_id: ID.respondentOwner,
      assignment_type: "manual",
      status: "started",
      user_id: LINE.owner,
    },
    onConflict: "project_id,respondent_id",
  });
  await up({
    table: "sessions",
    row: {
      id: ID.sessionOwner,
      respondent_id: ID.respondentOwner,
      project_id: ID.project,
      current_question_id: ID.qScreening,
      current_phase: "question",
      status: "active",
      state_json: {}, // mypage_confirmed_at 無し = 未確認 → profile/check 誘導
    },
  });

  console.log("\nseed 完了。run-screen で使う assignmentId:");
  printIds();
}

async function del(table, column, value) {
  const { error } = await supabase.from(table).delete().eq(column, value);
  if (error) throw new Error(`delete ${table} failed: ${error.message}`);
  console.log(`  delete ${table} where ${column}=${value}`);
}

async function teardown() {
  // 子→親の順で削除（FK cascade があっても明示削除で確実に）
  for (const id of [ID.sessionFail, ID.sessionUnjudged, ID.sessionCompleted, ID.sessionOwner])
    await del("sessions", "id", id);
  for (const id of [ID.assignmentFail, ID.assignmentUnjudged, ID.assignmentCompleted, ID.assignmentOwner])
    await del("project_assignments", "id", id);
  for (const id of [ID.respondentFail, ID.respondentUnjudged, ID.respondentCompleted, ID.respondentOwner])
    await del("respondents", "id", id);
  for (const id of [ID.qScreening, ID.qMain]) await del("questions", "id", id);
  await del("projects", "id", ID.project);
  console.log("\nteardown 完了（テスト専用行のみ削除）。");
}

function printIds() {
  console.log(JSON.stringify({
    project_id: ID.project,
    screening_fail: { assignmentId: ID.assignmentFail, url: `/liff/survey/${ID.assignmentFail}` },
    screening_unjudged: { assignmentId: ID.assignmentUnjudged, url: `/liff/survey/${ID.assignmentUnjudged}` },
    completed: { assignmentId: ID.assignmentCompleted, url: `/liff/survey/${ID.assignmentCompleted}` },
    profile_redirect: { assignmentId: ID.assignmentOwner, url: `/liff/survey/${ID.assignmentOwner}`, owner_line_user_id: LINE.owner },
    force_503_seam: "GET /liff/survey/<任意のassignmentId> に header x-test-auth-required:1 または ?__test_auth_required=1",
    auth_seam: "認証が要る API は Authorization: Bearer tmtest:<lineUserId>（例 tmtest:tmtest_owner）。verify-identity 等 body の id_token も同形式。非本番限定。",
  }, null, 2));
}

const cmd = process.argv[2];
const run = cmd === "seed" ? seed : cmd === "teardown" ? teardown : cmd === "ids" ? async () => printIds() : null;
if (!run) {
  console.error("使い方: node scripts/seed-test-fixtures.mjs <seed|teardown|ids>");
  process.exit(1);
}
console.log(`target: ${SUPABASE_URL} (NODE_ENV=${NODE_ENV})\n`);
run().catch((e) => { console.error(e.message); process.exit(1); });
