/**
 * Seed a disposable ai-report demo project with 60 respondents:
 * 50 completed + 6 partial (session active) + 4 abandoned.
 * Also seeds user_profiles for every demo user so attribute columns
 * (SEX/AGE/AGE_BAND/PRE/REGION/JOB/BUS/MAR/INC/CHI) carry real values.
 *
 * Usage:
 *   node scripts/seedAiReportDemoProject.mjs seed
 *   node scripts/seedAiReportDemoProject.mjs teardown
 *   node scripts/seedAiReportDemoProject.mjs verify
 */

import { createClient } from "@supabase/supabase-js";
import { config as loadDotEnv } from "dotenv";

loadDotEnv();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const NODE_ENV = process.env.NODE_ENV ?? "development";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}

if (NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_SEED !== "1") {
  console.error("Refusing to seed with NODE_ENV=production. Set ALLOW_PRODUCTION_SEED=1 if intentional.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const PROJECT_ID = "00000000-0000-4000-8000-000000000150";
const PROJECT_NAME = "[DEMO] ai-report 50 respondent dataset";
const COMPLETED_COUNT = 50;
const PARTIAL_COUNT = 6;
const ABANDONED_COUNT = 4;
const RESPONDENT_COUNT = COMPLETED_COUNT + PARTIAL_COUNT + ABANDONED_COUNT;
const LINE_USER_PREFIX = "demo_ai_report_user_";
const BASE_TIME = Date.parse("2026-07-16T10:00:00+09:00");

const qid = (n) => `00000000-0000-4000-8001-000000000${String(n).padStart(3, "0")}`;
const rid = (n) => `00000000-0000-4000-8002-000000000${String(n).padStart(3, "0")}`;
const sid = (n) => `00000000-0000-4000-8003-000000000${String(n).padStart(3, "0")}`;
const assignmentId = (n) => `00000000-0000-4000-8004-000000000${String(n).padStart(3, "0")}`;
const answerId = (n) => `00000000-0000-4000-8005-${String(n).padStart(12, "0")}`;

const questions = [
  {
    id: qid(1),
    code: "remote_days",
    text: "How many days per week do you work from home?",
    type: "single_choice",
    options: [
      ["0", "0 days"],
      ["1_2", "1-2 days"],
      ["3_4", "3-4 days"],
      ["5", "5 or more days"],
    ],
  },
  {
    id: qid(2),
    code: "lunch_pain",
    text: "Which problems do you have with weekday lunch?",
    type: "multi_choice",
    options: [
      ["price", "Price is high"],
      ["nutrition", "Nutrition is unbalanced"],
      ["time", "Not enough time"],
      ["variety", "Limited variety"],
      ["cleanup", "Cleanup is annoying"],
      ["none", "No major problem"],
    ],
  },
  {
    id: qid(3),
    code: "avg_lunch_budget",
    text: "What is your average lunch budget per weekday meal?",
    type: "numeric",
    config: { min: 200, max: 2000, unit: "JPY" },
  },
  {
    id: qid(4),
    code: "delivery_intent",
    text: "How interested are you in a healthy lunch delivery service?",
    type: "single_choice",
    options: [
      ["1", "Not interested at all"],
      ["2", "Not very interested"],
      ["3", "Neutral"],
      ["4", "Somewhat interested"],
      ["5", "Very interested"],
    ],
  },
  {
    id: qid(5),
    code: "service_priority",
    text: "What would matter most in a lunch delivery service?",
    type: "multi_choice",
    options: [
      ["price", "Price"],
      ["healthy", "Healthy menu"],
      ["speed", "Fast pickup"],
      ["volume", "Portion size"],
      ["variety", "Menu variety"],
      ["payment", "Easy payment"],
    ],
  },
  {
    id: qid(6),
    code: "ideal_lunch",
    text: "Describe your ideal weekday lunch in detail.",
    type: "free_text_long",
    aiProbeEnabled: true,
  },
  {
    id: qid(7),
    code: "current_lunch_source",
    text: "Where do you most often get weekday lunch?",
    type: "single_choice",
    options: [
      ["convenience", "Convenience store"],
      ["supermarket", "Supermarket deli"],
      ["delivery", "Delivery"],
      ["homemade", "Homemade lunch"],
      ["skip", "Often skip lunch"],
    ],
  },
  {
    id: qid(8),
    code: "free_comment",
    text: "Any other expectations for a lunch service?",
    type: "free_text_short",
    required: false,
  },
];

const optionLabels = new Map(
  questions.flatMap((question) => (question.options ?? []).map(([value, label]) => [`${question.code}:${value}`, label])),
);

function iso(minutesOffset) {
  return new Date(BASE_TIME + minutesOffset * 60_000).toISOString();
}

function pick(items, index) {
  return items[index % items.length];
}

function choiceAnswer(questionCode, value) {
  const label = optionLabels.get(`${questionCode}:${value}`) ?? value;
  return { text: label, normalized: { value, label, response_state: "answered" } };
}

function multiAnswer(questionCode, values) {
  const labels = values.map((value) => optionLabels.get(`${questionCode}:${value}`) ?? value);
  return { text: labels.join(", "), normalized: { values, labels, response_state: "answered" } };
}

function numericAnswer(value) {
  return { text: String(value), normalized: { value, response_state: "answered" } };
}

function textAnswer(text) {
  return { text, normalized: { value: text, response_state: "answered" } };
}

function questionConfig(question) {
  const base = question.config ?? {};
  if (!question.options) return Object.keys(base).length > 0 ? base : null;
  return {
    ...base,
    options: question.options.map(([value, label]) => ({ value, label })),
  };
}

function projectRow() {
  return {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    client_name: "Demo Client Inc.",
    objective: "Demo survey for validating ai-report exports with completed answers from 50 respondents.",
    status: "published",
    reward_points: 50,
    research_mode: "survey_interview",
    display_mode: "survey_question",
    primary_objectives: [
      "Understand weekday lunch pain points among remote workers.",
      "Estimate interest in a healthy lunch delivery service.",
    ],
    secondary_objectives: ["Provide a stable ai-report sample dataset."],
    comparison_constraints: [],
    prompt_rules: [],
    probe_policy: {
      enabled: true,
      conditions: ["short_answer", "abstract_answer"],
      max_probes_per_answer: 1,
      max_probes_per_session: 2,
      target_question_codes: ["ideal_lunch"],
    },
    response_style: { channel: "line", tone: "friendly", max_characters_per_message: 180, max_sentences: 3 },
    ai_state_template_key: "product_feedback",
    ai_state_generated_at: iso(0),
    ai_state_json: {
      version: "demo",
      project_goal: "Explore acceptance of a healthy weekday lunch delivery service.",
      required_slots: [
        { key: "current_behavior", label: "Current lunch behavior", required: true },
        { key: "pain", label: "Lunch pain point", required: true },
        { key: "intent", label: "Service intent", required: true },
      ],
      optional_slots: [{ key: "ideal_experience", label: "Ideal experience" }],
      language: "en",
    },
    created_at: iso(-60),
    updated_at: iso(-30),
  };
}

function questionRows() {
  return questions.map((question, index) => ({
    id: question.id,
    project_id: PROJECT_ID,
    question_code: question.code,
    question_text: question.text,
    question_role: question.code === "free_comment" ? "free_comment" : "main",
    question_type: question.type,
    is_required: question.required ?? true,
    sort_order: index + 1,
    branch_rule: null,
    question_config: questionConfig(question),
    ai_probe_enabled: Boolean(question.aiProbeEnabled),
    probe_guideline: question.aiProbeEnabled ? "Ask one concrete follow-up only when the usage scene is vague." : null,
    max_probe_count: question.aiProbeEnabled ? 1 : null,
    render_strategy: "static",
    is_system: false,
    is_hidden: false,
    answer_output_type:
      question.type === "numeric" ? "number" : question.type === "multi_choice" ? "array" : "text",
    answer_options_locked: Boolean(question.options),
    created_at: iso(-50 + index),
    updated_at: iso(-40 + index),
  }));
}

function profileFor(n) {
  const remoteDays = pick(["0", "1_2", "1_2", "3_4", "3_4", "5"], n);
  const lunchSource = pick(["convenience", "supermarket", "homemade", "delivery", "convenience"], n);
  const budget = 450 + (n % 9) * 80 + (lunchSource === "delivery" ? 220 : 0);
  const intentBase = lunchSource === "delivery" ? 5 : remoteDays === "0" ? 2 : budget >= 850 ? 3 : 4;
  const deliveryIntent = String(Math.min(5, Math.max(1, intentBase + (n % 4 === 0 ? 1 : n % 7 === 0 ? -1 : 0))));
  const painPool = [
    ["price", "nutrition"],
    ["time", "variety"],
    ["nutrition", "time"],
    ["price", "cleanup"],
    ["variety"],
    ["none"],
  ];
  const priorityPool = [
    ["price", "healthy"],
    ["healthy", "variety"],
    ["speed", "price"],
    ["volume", "price"],
    ["payment", "speed"],
    ["healthy", "speed", "variety"],
  ];
  const idealPool = [
    "I want a lunch with enough vegetables that does not make me sleepy in the afternoon. Around 700 yen would be easy to continue.",
    "A microwave-ready meal that I can pick up between meetings would be ideal. I would like the menu to change every week.",
    "I want to reduce trips to the convenience store, so ordering by the previous night and receiving before noon would help.",
    "Nutrition matters, but the portion cannot be too small. Choosing the main dish and rice size would be useful.",
    "If the price is too high I will not continue. I would like a regular menu and a premium option for busy days.",
  ];
  const commentPool = [
    "A small trial plan would lower the barrier to first use.",
    "Payment inside LINE would be convenient.",
    "I want allergy and calorie labels.",
    "Reliable delivery time matters most.",
    "",
  ];
  return {
    remoteDays,
    lunchPain: pick(painPool, n),
    budget,
    deliveryIntent,
    servicePriority: pick(priorityPool, n + 2),
    idealLunch: pick(idealPool, n),
    lunchSource,
    freeComment: pick(commentPool, n),
  };
}

function answerFor(profile, question) {
  switch (question.code) {
    case "remote_days":
      return choiceAnswer(question.code, profile.remoteDays);
    case "lunch_pain":
      return multiAnswer(question.code, profile.lunchPain);
    case "avg_lunch_budget":
      return numericAnswer(profile.budget);
    case "delivery_intent":
      return choiceAnswer(question.code, profile.deliveryIntent);
    case "service_priority":
      return multiAnswer(question.code, profile.servicePriority);
    case "ideal_lunch":
      return textAnswer(profile.idealLunch);
    case "current_lunch_source":
      return choiceAnswer(question.code, profile.lunchSource);
    case "free_comment":
      return textAnswer(profile.freeComment);
    default:
      return textAnswer("");
  }
}

// 属性列（SEX/AGE/AGE_BAND/PRE/REGION/JOB/BUS/MAR/INC/CHI）に実値を入れるための
// デモ用プロフィール。コード表は src/lib/rawdataExport.ts（SEX_CODES 等）と対応。
const PREFECTURE_POOL = [
  "北海道", "宮城県", "秋田県", "東京都", "神奈川県", "埼玉県", "千葉県",
  "新潟県", "愛知県", "静岡県", "大阪府", "京都府", "兵庫県",
  "広島県", "岡山県", "香川県", "愛媛県", "福岡県", "熊本県", "沖縄県",
];
const GENDER_POOL = ["male", "female", "female", "male", "other", "male", "female", "prefer_not_to_say"];
const OCCUPATION_POOL = [
  "会社員（正社員）", "会社員（正社員）", "会社員（契約・派遣）", "公務員",
  "自営業・フリーランス", "パート・アルバイト", "学生", "専業主婦・主夫", "無職", "その他",
];
const INDUSTRY_POOL = [
  "IT・通信", "製造", "金融・保険", "医療・福祉", "教育", "小売・流通",
  "外食・フード", "建設・不動産", "メディア・広告", "公共・行政", "その他",
];
const MARITAL_POOL = ["single", "married", "married", "single", "divorced", "widowed"];
const INCOME_POOL = [
  "under_200", "200_400", "400_600", "400_600", "600_800", "800_1000",
  "1000_1500", "1500_2000", "over_2000", "unknown", "no_answer",
];

function userProfileRow(n) {
  // 年齢 18〜72 を巡回させて AGE_BAND の各コードを出現させる。17の倍数は生年月日未登録（AGE/AGE_BAND 空欄の検証用）。
  const age = 18 + ((n * 7) % 55);
  const birthDate = n % 17 === 0 ? null : `${2026 - age}-04-15`;
  return {
    line_user_id: `${LINE_USER_PREFIX}${String(n).padStart(2, "0")}`,
    nickname: `Demo respondent ${String(n).padStart(2, "0")}`,
    gender: pick(GENDER_POOL, n),
    birth_date: birthDate,
    prefecture: pick(PREFECTURE_POOL, n),
    occupation: pick(OCCUPATION_POOL, n + 1),
    industry: pick(INDUSTRY_POOL, n + 2),
    marital_status: pick(MARITAL_POOL, n),
    has_children: n % 3 === 0 ? true : n % 3 === 1 ? false : null,
    household_income: n % 13 === 0 ? null : pick(INCOME_POOL, n),
  };
}

async function insertRows(table, rows) {
  if (rows.length === 0) return;
  const { error } = await supabase.from(table).insert(rows);
  if (error) throw new Error(`${table} insert failed: ${error.message}`);
}

async function removeExisting() {
  const { error } = await supabase.from("projects").delete().eq("id", PROJECT_ID);
  if (error) throw new Error(`projects delete failed: ${error.message}`);
  const profiles = await supabase.from("user_profiles").delete().like("line_user_id", `${LINE_USER_PREFIX}%`);
  if (profiles.error) throw new Error(`user_profiles delete failed: ${profiles.error.message}`);
}

async function seed() {
  console.log(`Seeding ${PROJECT_NAME} (${PROJECT_ID})`);
  await removeExisting();
  await insertRows("projects", [projectRow()]);
  await insertRows("questions", questionRows());

  const respondents = [];
  const assignments = [];
  const sessions = [];
  const messages = [];
  const answers = [];
  const probeAnswers = [];
  let answerSeq = 1;

  for (let i = 1; i <= RESPONDENT_COUNT; i += 1) {
    const respondentId = rid(i);
    const sessionId = sid(i);
    const lineUserId = `${LINE_USER_PREFIX}${String(i).padStart(2, "0")}`;
    const start = iso(i * 7);
    const complete = iso(i * 7 + 4 + (i % 5));
    const profile = profileFor(i);

    // 51〜56 = partial（セッション active・途中まで回答）/ 57〜60 = abandoned（離脱）。
    // 未回答設問はエクスポート側でセンチネル 94（システム上未到達）になる。
    const kind = i <= COMPLETED_COUNT ? "completed" : i <= COMPLETED_COUNT + PARTIAL_COUNT ? "partial" : "abandoned";
    const answeredCount = kind === "completed" ? questions.length : 1 + ((i + 1) % 5);
    const lastAnswerAt = iso(i * 7 + answeredCount);
    const sessionStatus = kind === "completed" ? "completed" : kind === "partial" ? "active" : "abandoned";

    respondents.push({
      id: respondentId,
      line_user_id: lineUserId,
      display_name: `Demo respondent ${String(i).padStart(2, "0")}`,
      project_id: PROJECT_ID,
      status: kind === "completed" ? "completed" : kind === "partial" ? "active" : "dropped",
      total_points: kind === "completed" ? 50 : 0,
      is_test: false,
      created_at: start,
      updated_at: kind === "completed" ? complete : lastAnswerAt,
    });

    assignments.push({
      id: assignmentId(i),
      project_id: PROJECT_ID,
      respondent_id: respondentId,
      assignment_type: "manual",
      status: kind === "completed" ? "completed" : "started",
      user_id: lineUserId,
      assigned_at: iso(i * 7 - 15),
      sent_at: iso(i * 7 - 12),
      opened_at: iso(i * 7 - 2),
      started_at: start,
      completed_at: kind === "completed" ? complete : null,
      deadline: iso(60 * 24 * 7),
      delivery_channel: i % 3 === 0 ? "line" : "liff",
      filter_snapshot: { source: "ai-report-demo-seed" },
      delivery_log: [{ at: iso(i * 7 - 12), channel: i % 3 === 0 ? "line" : "liff", status: "sent" }],
      created_at: iso(i * 7 - 15),
      updated_at: kind === "completed" ? complete : lastAnswerAt,
    });

    sessions.push({
      id: sessionId,
      respondent_id: respondentId,
      project_id: PROJECT_ID,
      current_question_id: kind === "completed" ? null : (questions[answeredCount]?.id ?? null),
      current_phase: kind === "completed" ? "completed" : "question",
      status: sessionStatus,
      summary: `remote_days=${profile.remoteDays}; budget=${profile.budget}; intent=${profile.deliveryIntent}`,
      state_json: { seeded: true, source: "ai-report-demo", completed_question_count: answeredCount },
      started_at: start,
      completed_at: kind === "completed" ? complete : null,
      last_activity_at: kind === "completed" ? complete : lastAnswerAt,
      randomization_seed: `demo-seed-${String(i).padStart(2, "0")}`,
      display_order_json: Object.fromEntries(questions.map((question, index) => [question.id, index + 1])),
      user_agent: "seed-ai-report-demo/1.0",
      ip_address: `192.0.2.${i}`,
    });

    messages.push({
      session_id: sessionId,
      sender_type: "system",
      message_text: "Survey started.",
      raw_payload: { source: "seed" },
      created_at: start,
    });
    if (kind === "completed") {
      messages.push({
        session_id: sessionId,
        sender_type: "system",
        message_text: "Survey completed.",
        raw_payload: { source: "seed" },
        created_at: complete,
      });
    }

    for (const [questionIndex, question] of questions.entries()) {
      if (questionIndex >= answeredCount) {
        break;
      }
      const answer = answerFor(profile, question);
      const primaryId = answerId(answerSeq);
      answerSeq += 1;
      answers.push({
        id: primaryId,
        session_id: sessionId,
        question_id: question.id,
        answer_text: answer.text,
        free_text_answer: question.type.startsWith("free_text") ? answer.text : null,
        answer_role: "primary",
        parent_answer_id: null,
        normalized_answer: answer.normalized,
        created_at: iso(i * 7 + questionIndex + 1),
      });

      if (question.code === "ideal_lunch" && i % 4 === 0) {
        const probeText = pick(
          [
            "The hardest moment is when a meeting runs long and I cannot leave to buy lunch.",
            "I could use it twice a week if the price stays under 750 yen including tax.",
            "It would be useful if I could reliably receive it between noon and 1 p.m.",
          ],
          i,
        );
        probeAnswers.push({
          session_id: sessionId,
          question_id: question.id,
          answer_text: probeText,
          free_text_answer: probeText,
          answer_role: "ai_probe",
          parent_answer_id: primaryId,
          normalized_answer: {
            source: "ai_probe",
            probe_question: "Could you describe the concrete situation where you would need that lunch?",
            probe_reason: "Clarify the usage scene behind the ideal lunch answer.",
            value: probeText,
          },
          created_at: iso(i * 7 + 6),
        });
      }
    }
  }

  await insertRows("user_profiles", Array.from({ length: RESPONDENT_COUNT }, (_, index) => userProfileRow(index + 1)));
  await insertRows("respondents", respondents);
  await insertRows("project_assignments", assignments);
  await insertRows("sessions", sessions);
  await insertRows("messages", messages);
  await insertRows("answers", answers);
  await insertRows("answers", probeAnswers);
  await insertRows("project_analysis_reports", [
    {
      project_id: PROJECT_ID,
      respondent_count: RESPONDENT_COUNT,
      completed_session_count: COMPLETED_COUNT,
      report_json: {
        source: "seed",
        summary: "Remote-worker lunch pain concentrates on price, nutrition, and time. Delivery intent is medium to high in this demo dataset.",
        top_findings: [
          "Price, nutrition, and lack of time are the main lunch pain points.",
          "Healthy menu and price are frequently selected service priorities.",
          "Free text often mentions a 700-750 yen target price and reliable delivery time.",
        ],
      },
    },
  ]);

  await verify();
}

async function verify() {
  const project = await supabase.from("projects").select("id,name,status").eq("id", PROJECT_ID).maybeSingle();
  if (project.error) throw new Error(`project verify failed: ${project.error.message}`);

  const respondents = await supabase
    .from("respondents")
    .select("id", { count: "exact", head: true })
    .eq("project_id", PROJECT_ID);
  if (respondents.error) throw new Error(`respondents verify failed: ${respondents.error.message}`);

  const sessions = await supabase.from("sessions").select("id,status").eq("project_id", PROJECT_ID);
  if (sessions.error) throw new Error(`sessions verify failed: ${sessions.error.message}`);
  const sessionIds = (sessions.data ?? []).map((session) => session.id);
  const sessionStatusCounts = {};
  for (const session of sessions.data ?? []) {
    sessionStatusCounts[session.status] = (sessionStatusCounts[session.status] ?? 0) + 1;
  }

  const answers = sessionIds.length === 0
    ? { count: 0, error: null }
    : await supabase.from("answers").select("id", { count: "exact", head: true }).in("session_id", sessionIds);
  if (answers.error) throw new Error(`answers verify failed: ${answers.error.message}`);

  const reports = await supabase
    .from("project_analysis_reports")
    .select("id", { count: "exact", head: true })
    .eq("project_id", PROJECT_ID);
  if (reports.error) throw new Error(`reports verify failed: ${reports.error.message}`);

  console.log(JSON.stringify({
    project: project.data,
    respondent_count: respondents.count,
    session_count: sessionIds.length,
    session_status_counts: sessionStatusCounts,
    answer_count: answers.count,
    report_count: reports.count,
    admin_url: `/admin/projects/${PROJECT_ID}/respondents`,
    ai_report_bundle_url: `/admin/projects/${PROJECT_ID}/exports/stat/bundle.zip`,
  }, null, 2));
}

async function teardown() {
  await removeExisting();
  console.log(`Removed demo project ${PROJECT_ID}`);
}

const command = process.argv[2] ?? "seed";
const run = command === "seed" ? seed : command === "verify" ? verify : command === "teardown" ? teardown : null;

if (!run) {
  console.error("Usage: node scripts/seedAiReportDemoProject.mjs <seed|verify|teardown>");
  process.exit(1);
}

run().catch((error) => {
  console.error("FATAL:", error.message);
  process.exit(1);
});
