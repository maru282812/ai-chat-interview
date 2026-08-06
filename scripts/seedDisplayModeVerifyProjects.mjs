/**
 * seedDisplayModeVerifyProjects.mjs
 *
 * docs/plan-display-mode-fixes.md の Phase 2〜5 を実機検証するための案件を投入する。
 * 検証専用なので `is_discoverable=false` + `visibility_type=private_store`、
 * 検証が終わったら必ず --cleanup で消すこと（本番Supabase共有のため）。
 *
 *   (a) 【検証用】分岐＋表示条件（survey_question）
 *       Phase 3 の核。branch_rule と visibility_conditions を併せ持ち、
 *       「分岐先が非表示になる」ケースを必ず通る構成にしてある。
 *   (b) 【検証用】チャット深掘り（interview_chat）
 *       Phase 4/5 の核。choice 設問に ai_probe_enabled を立て、
 *       choice→深掘り→返信 の経路で primary / ai_probe が別行になることを見る。
 *
 * Usage:
 *   node scripts/seedDisplayModeVerifyProjects.mjs            # 投入（冪等）
 *   node scripts/seedDisplayModeVerifyProjects.mjs --cleanup  # 案件＋子レコード削除
 */

import { config as loadDotEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadDotEnv();

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

const now = new Date().toISOString();

// 固定UUID（衝突しない専用レンジ）。cleanup はこの2件だけを対象にする。
const P_BRANCH_ID = "d0260801-0000-4000-8000-000000000101";
const P_CHAT_ID = "d0260802-0000-4000-8000-000000000102";
const PROJECT_IDS = [P_BRANCH_ID, P_CHAT_ID];

const common = {
  client_name: "表示モード検証",
  status: "published",
  reward_points: 1,
  visibility_type: "private_store",
  is_discoverable: false,
  apply_mode: "auto",
  delivery_enabled: false,
  estimated_minutes: 2,
  ai_prompt_mode: "custom",
  primary_objectives: [],
  secondary_objectives: [],
  comparison_constraints: [],
  prompt_rules: [],
  updated_at: now
};

const projects = [
  {
    ...common,
    id: P_BRANCH_ID,
    name: "【検証用】分岐＋表示条件（1問1答）",
    objective: "Phase 3: branch_rule と visibility_conditions を併せ持つ構成での遷移検証",
    research_mode: "survey",
    display_mode: "survey_question",
    answer_ui_preset: "standard",
    entry_code: "dmchk-branch"
  },
  {
    ...common,
    id: P_CHAT_ID,
    name: "【検証用】チャット深掘り（choice→probe）",
    objective: "Phase 4/5: choice設問のAI深掘りで primary と ai_probe が別行保存されるか検証",
    research_mode: "interview",
    display_mode: "interview_chat",
    answer_ui_preset: "standard",
    entry_code: "dmchk-chat"
  }
];

const q = (projectId, code, text, type, sortOrder, config, extra = {}) => ({
  project_id: projectId,
  question_code: code,
  question_text: text,
  question_role: "main",
  question_type: type,
  is_required: true,
  sort_order: sortOrder,
  branch_rule: null,
  visibility_conditions: null,
  question_config: config,
  ai_probe_enabled: false,
  probe_guideline: null,
  max_probe_count: null,
  render_strategy: "static",
  is_system: false,
  is_hidden: false,
  created_at: now,
  updated_at: now,
  ...extra
});

const opts = (...pairs) => pairs.map(([value, label]) => ({ value, label }));

/**
 * (a) 分岐＋表示条件の構成。
 *
 *   Q1 (yes/no) branch_rule:
 *     yes -> Q3   ← Q3 は「Q2=b のときだけ表示」= Q2 未回答なので**非表示**
 *                    → Phase 3 の「分岐先が非表示」経路。QUESTIONS順で Q3 以降の
 *                      最初の可視設問 = Q4 へ進むのが正解。
 *     no  -> Q2
 *   Q2 (a/b) : 分岐なし。素直に次へ（可視なら Q3、Q2=a なら Q3 が消えて Q4）
 *   Q3       : visibility_conditions = q2=b
 *   Q4       : 最終設問（常に表示）
 *
 * 期待遷移:
 *   Q1=yes            → Q4          （分岐先Q3が非表示 → 次の可視へ）
 *   Q1=no → Q2=b      → Q3 → Q4     （条件成立で出現）
 *   Q1=no → Q2=a      → Q4          （条件不成立で消滅）
 * 旧実装（QUESTIONS.findIndex を visibleQs 添字に流用）だと Q1=yes で
 * visibleQs=[Q1,Q2,Q4] の index 2 = Q4 に「たまたま」当たる等、構成次第でずれる。
 */
const branchQuestions = [
  q(
    P_BRANCH_ID,
    "Q1",
    "【検証】この案件は分岐テスト用です。「はい」を選ぶと Q3 をスキップして Q4 へ飛びます。",
    "single_choice",
    1,
    { options: opts(["yes", "はい（→Q4へ飛ぶはず）"], ["no", "いいえ（→Q2へ進むはず）"]) },
    {
      branch_rule: {
        branches: [
          { when: { equals: "yes" }, next: "Q3" },
          { when: { equals: "no" }, next: "Q2" }
        ],
        default_next: null
      }
    }
  ),
  q(P_BRANCH_ID, "Q2", "【検証】Q3を出しますか？（b を選ぶと Q3 が表示条件を満たします）", "single_choice", 2, {
    options: opts(["a", "a: Q3は出ない"], ["b", "b: Q3が出る"])
  }),
  q(P_BRANCH_ID, "Q3", "【検証】Q3です。Q2=b のときだけ表示されます。", "single_choice", 3, {
    options: opts(["ok", "確認しました"])
  }, {
    visibility_conditions: [{ type: "pipe_expression", expression: "q2=b" }]
  }),
  q(P_BRANCH_ID, "Q4", "【検証】Q4（最終設問）です。ここまで来たら分岐は正常です。", "single_choice", 4, {
    options: opts(["done", "完了"])
  })
];

/**
 * (b) チャット深掘り。choice 設問に ai_probe_enabled を立てるのが要点
 * （Phase 5 の「primary=選択値 / probe=自由文」が別行になるかを見るため）。
 */
const chatQuestions = [
  q(
    P_CHAT_ID,
    "Q1",
    "【検証】普段よく使うコンビニはどれですか？",
    "single_choice",
    1,
    {
      options: opts(
        ["seven", "セブン-イレブン"],
        ["lawson", "ローソン"],
        ["famima", "ファミリーマート"],
        ["other", "その他・使わない"]
      ),
      helpText: "選んだあとに理由を1回だけ聞かれます"
    },
    {
      ai_probe_enabled: true,
      max_probe_count: 1,
      probe_guideline:
        "選んだ店を使う理由や、よく買うものを1回だけ具体的に確認する。新しい話題には広げない。"
    }
  ),
  q(P_CHAT_ID, "Q2", "【検証】最後の設問です。今日はどんな気分ですか？", "single_choice", 2, {
    options: opts(["good", "良い"], ["normal", "ふつう"], ["tired", "疲れている"])
  })
];

const questions = [...branchQuestions, ...chatQuestions];

/** 案件に紐づく子レコードを、参照の深い順に消す。 */
async function cleanup() {
  // sessions -> answers(session_id) の順に辿る
  const { data: sessions, error: sErr } = await supabase
    .from("sessions")
    .select("id")
    .in("project_id", PROJECT_IDS);
  if (sErr) throw new Error(`sessions select failed: ${sErr.message}`);
  const sessionIds = (sessions ?? []).map((s) => s.id);

  if (sessionIds.length > 0) {
    const { error: aErr } = await supabase.from("answers").delete().in("session_id", sessionIds);
    if (aErr) throw new Error(`answers delete failed: ${aErr.message}`);
    console.log(`answers deleted for ${sessionIds.length} sessions`);
  }

  // respondents は project_id を持つ（案件ごとに1行）。projects を消す前に外さないと FK で残る。
  for (const table of ["conversation_logs", "sessions", "project_assignments", "project_applications", "project_favorites", "questions", "respondents"]) {
    const col = table === "answers" ? "session_id" : "project_id";
    const { error } = await supabase.from(table).delete().in(col, PROJECT_IDS);
    // テーブルが無い/該当列が無い環境では黙って進む（構成差異に強くする）
    if (error && !/does not exist|schema cache/i.test(error.message)) {
      throw new Error(`${table} delete failed: ${error.message}`);
    }
    if (!error) console.log(`${table} cleaned`);
  }

  const { error: pErr } = await supabase.from("projects").delete().in("id", PROJECT_IDS);
  if (pErr) throw new Error(`projects delete failed: ${pErr.message}`);
  console.log("projects deleted");

  const { data: left } = await supabase.from("projects").select("id").in("id", PROJECT_IDS);
  console.log(`remaining verify projects: ${(left ?? []).length}`);
}

async function seed() {
  const { error: pErr } = await supabase.from("projects").upsert(projects, { onConflict: "id" });
  if (pErr) throw new Error(`projects upsert failed: ${pErr.message}`);
  console.log(`projects upserted: ${projects.length}`);

  const { error: dErr } = await supabase.from("questions").delete().in("project_id", PROJECT_IDS);
  if (dErr) throw new Error(`questions delete failed: ${dErr.message}`);

  const { error: qErr } = await supabase.from("questions").insert(questions);
  if (qErr) throw new Error(`questions insert failed: ${qErr.message}`);
  console.log(`questions inserted: ${questions.length}`);

  for (const p of projects) {
    console.log(`${p.id}  ${p.name}  entry_code=${p.entry_code}`);
  }
}

const mode = process.argv.includes("--cleanup") ? "cleanup" : "seed";
(mode === "cleanup" ? cleanup() : seed()).catch((e) => {
  console.error(e);
  process.exit(1);
});
