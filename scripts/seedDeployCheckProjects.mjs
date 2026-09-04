/**
 * seedDeployCheckProjects.mjs
 *
 * デプロイ先動作確認用のテスト案件3件を本番Supabaseへ冪等投入する。
 *   1. 通常アンケート     (survey_question / answer_ui_preset=standard)
 *   2. AI深掘りインタビュー (interview_chat — 管理UIからは作れないためスクリプト必須)
 *   3. スワイプ回答        (survey_question / answer_ui_preset=casual)
 *
 * すべて visibility_type=private_store + entry_code なので「探す」一覧には出ない。
 * 新規ユーザーは entry_code URL から、既存ユーザーは手動配信からテストする。
 *
 * Usage: node scripts/seedDeployCheckProjects.mjs
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

// --discoverable: 「探す」一覧に出す（visibility_type=public + is_discoverable=true）。
// 新規DB（実ユーザー0）で fresh アカウントから応募→回答の一気通貫を踏むときに使う。
// entry_code は残すので、entry URL からの流入も引き続き使える。
const DISCOVERABLE = process.argv.includes("--discoverable");

const P_SURVEY = "dc260801-0000-4000-8000-000000000001";
const P_CHAT = "dc260802-0000-4000-8000-000000000002";
const P_SWIPE = "dc260803-0000-4000-8000-000000000003";

const common = {
  client_name: "動作確認",
  status: "published",
  reward_points: 10,
  visibility_type: DISCOVERABLE ? "public" : "private_store",
  is_discoverable: DISCOVERABLE,
  apply_mode: "auto",
  delivery_enabled: false,
  estimated_minutes: 3,
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
    id: P_SURVEY,
    name: "【動作確認】通常アンケート（standard）",
    objective: "デプロイ先での通常アンケート回答フローの動作確認",
    research_mode: "survey",
    display_mode: "survey_question",
    answer_ui_preset: "standard",
    entry_code: "chk2608-survey"
  },
  {
    ...common,
    id: P_CHAT,
    name: "【動作確認】AI深掘りインタビュー",
    objective: "デプロイ先でのAI深掘りチャット（interview_chat）の動作確認",
    research_mode: "interview",
    display_mode: "interview_chat",
    answer_ui_preset: "standard",
    entry_code: "chk2608-chat"
  },
  {
    ...common,
    id: P_SWIPE,
    name: "【動作確認】スワイプ回答（casual）",
    objective: "デプロイ先でのスワイプ系回答UI（casual preset）の動作確認",
    research_mode: "survey",
    display_mode: "survey_question",
    answer_ui_preset: "casual",
    entry_code: "chk2608-swipe"
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

const opts = (...labels) =>
  labels.map((label, i) => ({ value: `opt${i + 1}`, label }));

const questions = [
  // ---- 1. 通常アンケート ----
  q(P_SURVEY, "Q1", "普段、食料品の買い物はどこですることが多いですか？", "single_choice", 1, {
    options: opts("スーパー", "コンビニ", "ドラッグストア", "ネット通販"),
    helpText: "いちばん近いものを1つ選んでください"
  }),
  q(P_SURVEY, "Q2", "買い物先を選ぶとき、重視するものをすべて選んでください。", "multi_choice", 2, {
    options: opts("価格の安さ", "家からの近さ", "品揃え", "品質・鮮度", "ポイントが貯まる")
  }),
  q(P_SURVEY, "Q3", "いまの買い物環境への満足度を教えてください。", "single_choice", 3, {
    options: opts("不満", "やや不満", "ふつう", "やや満足", "満足"),
    presentation: { scale: true }
  }),
  q(
    P_SURVEY,
    "Q4",
    "買い物で「もっとこうなってほしい」と思うことがあれば教えてください。",
    "free_text_short",
    4,
    {
      placeholder: "例: 夜遅くでも品切れしていないと助かる",
      helpText: "思いついたことで構いません"
    },
    { ai_probe_enabled: true, max_probe_count: 1, probe_guideline: "理由や具体的な場面を1回だけ確認する。新しい話題は広げない。" }
  ),

  // ---- 2. AI深掘りインタビュー ----
  q(
    P_CHAT,
    "Q1",
    "最近ネットで買い物をしたときのことを教えてください。何を、どんなきっかけで買いましたか？",
    "free_text_long",
    1,
    {
      helpText: "直近の1回を思い出して、自由に書いてください",
      placeholder: "例: スマホケースが割れたので、その日のうちに通販で注文しました",
      meta: {
        research_goal: "オンライン購買の実際の行動と文脈を理解する",
        question_goal: "直近の購買行動（何を・きっかけ・状況）を具体的に知る",
        probe_goal: "きっかけの背景、選んだ理由、迷った点を引き出す",
        expected_slots: [
          { key: "item", label: "購入した物", description: "何を買ったか", required: true, examples: ["スマホケース", "洗剤", "本"] },
          { key: "trigger", label: "きっかけ", description: "買おうと思った理由・状況", required: true, examples: ["壊れた", "セールを見た"] },
          { key: "decision", label: "選定理由", description: "その商品・店を選んだ理由", required: false, examples: ["レビューが良かった", "翌日届くから"] }
        ],
        required_slots: ["item", "trigger"],
        probe_config: { max_probes: 2, min_probes: 1, force_probe_on_bad: true, allow_followup_expansion: false, strict_topic_lock: true },
        completion_conditions: [{ type: "required_slots" }, { type: "no_bad_patterns" }],
        render_style: { mode: "interview_natural", connect_from_previous_answer: true, avoid_question_number: true, preserve_options: false }
      },
      conversationControl: {
        coreInfoPrompt: "何を買ったか、どんなきっかけだったかを教えてください",
        answerExample: "スマホケースが割れてしまったので、その日の夜にレビューを見比べて通販で注文しました",
        shortAnswerMinLength: 15,
        sufficientAnswerMinLength: 40
      }
    },
    { ai_probe_enabled: true, max_probe_count: 2, probe_guideline: "きっかけと選んだ理由を深掘りする。迷った選択肢があれば聞く。" }
  ),
  q(
    P_CHAT,
    "Q2",
    "ネットの買い物で不便に感じることや、困った経験があれば教えてください。",
    "free_text_long",
    2,
    {
      helpText: "小さなことでも構いません",
      placeholder: "例: サイズ選びに失敗して返品が面倒だった",
      meta: {
        research_goal: "オンライン購買のペインポイントを把握する",
        question_goal: "不便・不満と、それが起きた場面を具体的に知る",
        probe_goal: "不満の理由と具体例、そのとき取った行動を引き出す",
        expected_slots: [
          { key: "pain_point", label: "不満点", description: "困ったこと・不便なこと", required: true, examples: ["サイズが合わない", "配達が遅い"] },
          { key: "pain_scene", label: "発生場面", description: "その不満が起きた場面", required: true, examples: ["服を買ったとき", "急ぎで必要だったとき"] },
          { key: "workaround", label: "対処", description: "そのとき取った行動", required: false, examples: ["返品した", "店舗で買い直した"] }
        ],
        required_slots: ["pain_point", "pain_scene"],
        probe_config: { max_probes: 2, min_probes: 0, force_probe_on_bad: true, allow_followup_expansion: false, strict_topic_lock: true },
        completion_conditions: [{ type: "required_slots" }, { type: "no_bad_patterns" }],
        render_style: { mode: "interview_natural", connect_from_previous_answer: true, avoid_question_number: true, preserve_options: false }
      },
      conversationControl: {
        coreInfoPrompt: "どんな場面で、何に困ったのかを教えてください",
        answerExample: "服をネットで買ったらサイズが合わず、返品手続きが面倒でそのまま着ていません",
        shortAnswerMinLength: 15,
        sufficientAnswerMinLength: 40
      }
    },
    { ai_probe_enabled: true, max_probe_count: 2, probe_guideline: "不満が起きた具体的な場面と、そのとき取った行動を確認する。" }
  ),

  // ---- 3. スワイプ回答 ----
  q(P_SWIPE, "Q1", "朝ごはんは毎日食べますか？", "single_choice", 1, {
    options: [
      { value: "yes", label: "食べる" },
      { value: "no", label: "食べない" }
    ]
  }),
  q(P_SWIPE, "Q2", "いちばん好きな麺類はどれですか？", "single_choice", 2, {
    options: opts("ラーメン", "うどん", "そば", "パスタ", "焼きそば")
  }),
  q(P_SWIPE, "Q3", "辛い食べ物はどのくらい好きですか？", "single_choice", 3, {
    options: opts("苦手", "やや苦手", "ふつう", "やや好き", "大好き"),
    presentation: { scale: true }
  }),
  q(P_SWIPE, "Q4", "コンビニでよく買うものをすべて選んでください。", "multi_choice", 4, {
    options: opts("おにぎり・弁当", "パン", "スイーツ", "飲み物", "ホットスナック")
  })
];

async function main() {
  const ids = projects.map((p) => p.id);

  const { error: pErr } = await supabase.from("projects").upsert(projects, { onConflict: "id" });
  if (pErr) throw new Error(`projects upsert failed: ${pErr.message}`);
  console.log(`projects upserted: ${ids.length}`);

  const { error: dErr } = await supabase.from("questions").delete().in("project_id", ids);
  if (dErr) throw new Error(`questions delete failed: ${dErr.message}`);

  const { error: qErr } = await supabase.from("questions").insert(questions);
  if (qErr) throw new Error(`questions insert failed: ${qErr.message}`);
  console.log(`questions inserted: ${questions.length}`);

  const liffId = process.env.LINE_LIFF_ID_SURVEY ?? "<LINE_LIFF_ID_SURVEY>";
  console.log("\n--- 新規ユーザー用 entry URL ---");
  for (const p of projects) {
    console.log(`${p.name}\n  https://liff.line.me/${liffId}?entry_code=${p.entry_code}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
