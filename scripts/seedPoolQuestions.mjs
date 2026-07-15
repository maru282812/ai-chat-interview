/**
 * seedPoolQuestions.mjs
 *
 * ついでスワイプ（設問プール）の動作確認用サンプルを投入する。
 * 全て status='active'・運営設問（client_id=null）・低報酬。source_tag で後片付けできる。
 *
 *   node scripts/seedPoolQuestions.mjs          # 投入
 *   node scripts/seedPoolQuestions.mjs --clean  # このスクリプトで入れた分だけ削除
 *
 * 目印: topic_tag を "verify_*" で始める。--clean はそれを消す（回答が付いた行は
 * 外部キーで守られるので、その場合は管理画面から archive してください）。
 */
import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が未設定です（.env を確認）。");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

const c = (label) => ({ value: `opt_${label}`, label }); // value は本番と同様サーバー採番でもよいが確認用に簡易採番
function choices(...labels) {
  return labels.map((label, i) => ({ value: `opt_${i + 1}`, label }));
}

// 2択→swipe_card / 3択→carousel / scale→face_scale を一通り見られる構成。
const SAMPLES = [
  { question_text: "朝はパン派？ごはん派？", topic_tag: "verify_food",
    answer_options: choices("パン", "ごはん") },
  { question_text: "どちらかといえば犬派？猫派？", topic_tag: "verify_pet",
    answer_options: choices("犬", "猫") },
  { question_text: "旅行するなら国内？海外？", topic_tag: "verify_travel",
    answer_options: choices("国内", "海外") },
  { question_text: "買い物はネット派？お店派？", topic_tag: "verify_shopping",
    answer_options: choices("ネット", "お店"), reask_after_days: 7 },
  { question_text: "休日はどう過ごす？", topic_tag: "verify_lifestyle",
    answer_options: choices("インドア", "アウトドア", "どちらも") }, // 3択＝carousel
  { question_text: "新しいものを試すのは好き？", topic_tag: "verify_novelty",
    question_type: "scale", answer_options: [] }, // scale＝face_scale（1〜5）
  { question_text: "連絡はテキスト派？通話派？", topic_tag: "verify_comm",
    answer_options: choices("テキスト", "通話"), reward_points: 0 }, // 報酬0＝ptチップ非表示の確認
];

function toRow(s) {
  return {
    question_text: s.question_text,
    question_type: s.question_type ?? "single_choice",
    answer_options: s.answer_options ?? [],
    topic_tag: s.topic_tag,
    client_id: null,
    attribute_key: null,
    status: "active",
    priority: s.priority ?? 0,
    reward_points: s.reward_points ?? 1,
    reask_after_days: s.reask_after_days ?? null,
    starts_at: null,
    ends_at: null,
    created_by: "seed",
  };
}

async function clean() {
  const { data, error } = await supabase
    .from("pool_questions")
    .delete()
    .like("topic_tag", "verify_%")
    .select("id");
  if (error) throw error;
  console.log(`削除しました: ${data?.length ?? 0} 件（回答が付いた行は残ります＝管理画面で archive してください）。`);
}

async function seed() {
  const rows = SAMPLES.map(toRow);
  const { data, error } = await supabase.from("pool_questions").insert(rows).select("id, question_text, question_type, reward_points");
  if (error) throw error;
  console.log(`投入しました: ${data.length} 件（すべて active・運営設問）。`);
  for (const r of data) {
    console.log(`  - [${r.question_type}] ${r.question_text}  (+${r.reward_points}pt)  ${r.id}`);
  }
  console.log("\n確認: 管理 → /admin/pool-questions ／ LIFF → /liff/projects（今日の1問カードの下に出ます・1人最大3問/日）。");
  console.log("片付け: node scripts/seedPoolQuestions.mjs --clean");
}

const mode = process.argv.includes("--clean") ? clean : seed;
mode().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
