/**
 * seedSalonCycleGroup.mjs
 *
 * 美容室 A/B/C の3案件を「1周＝A→B→C」の繰り返しサイクルとして登録する（Migration 093）。
 *
 * これを流すまで cycle_groups は空＝どの案件も従来どおり「1回だけ」で動く。
 * 流した時点で A/B/C だけが繰り返し可能になり、離脱計測が始まる。
 *
 * サイクルの意味:
 *   A（来店理由）の完了で1周が始まる。A-Q11 の来店頻度から「次に来るはずの日」を出し、
 *   その日を過ぎても A が来なければ C（離脱検証）を送る。
 *   次の A が来た時点で「離脱していない」が確定し、C は送らない。
 *
 * 前提: node scripts/seedSalonSurveyProjects.mjs で A/B/C 案件が投入済みであること。
 *
 * Usage:
 *   node scripts/seedSalonCycleGroup.mjs
 *   node scripts/seedSalonCycleGroup.mjs --cleanup
 *
 * 事前に migration 093 の適用が必要: npm run db:migrate
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

// seedSalonSurveyProjects.mjs と同じ固定ID（冪等投入のため）
const P_A = "5a10c001-0000-4000-8000-000000000001";
const P_B = "5a10c002-0000-4000-8000-000000000002";
const P_C = "5a10c003-0000-4000-8000-000000000003";
const GROUP_ID = "5a10c000-0000-4000-8000-00000000c001";

const GROUP_NAME = "美容室 ABCサイクル";

/**
 * ステップ定義。
 * step_role が挙動を決める:
 *   entry    = この案件の完了が新しい周を始める（＝A だけ）
 *   followup = 開いている周に合流する（B）
 *   verify   = 離脱検証。cron が送付する（C）
 */
const STEPS = [
  { project_id: P_A, step_order: 1, step_role: "entry" },
  { project_id: P_B, step_order: 2, step_role: "followup" },
  { project_id: P_C, step_order: 3, step_role: "verify" },
];

const isCleanup = process.argv.includes("--cleanup");

async function cleanup() {
  // survey_cycles は cycle_groups の CASCADE で消えるが、
  // 実回答に紐づく assignment.cycle_id は ON DELETE SET NULL で残る（回答は消さない）。
  const { error } = await supabase.from("cycle_groups").delete().eq("id", GROUP_ID);
  if (error) throw new Error(error.message);
  console.log("cleanup: サイクル定義を削除しました（回答データは残ります）");
}

async function seed() {
  // 案件が実在するか先に確認する。無いまま登録すると
  // 「繰り返しになっているつもりで実は何も起きない」状態になる。
  const { data: projects, error: projectError } = await supabase
    .from("projects")
    .select("id, name, entry_code")
    .in("id", [P_A, P_B, P_C]);
  if (projectError) throw new Error(projectError.message);

  const found = new Set((projects ?? []).map((p) => p.id));
  const missing = [P_A, P_B, P_C].filter((id) => !found.has(id));
  if (missing.length > 0) {
    console.error("A/B/C 案件が見つかりません:", missing);
    console.error("先に node scripts/seedSalonSurveyProjects.mjs を流してください。");
    process.exit(1);
  }

  const { error: groupError } = await supabase.from("cycle_groups").upsert(
    {
      id: GROUP_ID,
      name: GROUP_NAME,
      entry_project_id: P_A,
      followup_project_id: P_C, // 離脱検証として送る案件＝C
      grace_days: 7,
      undecided_days: 60,
      restart_cooldown_days: 25,
      is_enabled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (groupError) throw new Error(groupError.message);

  for (const step of STEPS) {
    const { error } = await supabase
      .from("cycle_group_steps")
      .upsert({ cycle_group_id: GROUP_ID, ...step }, { onConflict: "cycle_group_id,project_id" });
    if (error) throw new Error(error.message);
  }

  console.log(`サイクル定義を投入しました: ${GROUP_NAME}`);
  console.log("  A (entry・起点)   :", P_A);
  console.log("  B (followup)      :", P_B);
  console.log("  C (verify・離脱検証):", P_C);
  console.log("  クールダウン       : 25日 / 猶予: 7日 / 頻度未定: 60日");
  console.log("");
  console.log("→ この時点から A/B/C だけが繰り返し回答可能になります。");
  console.log("  他の案件は従来どおり「1回だけ」です。");
}

try {
  await (isCleanup ? cleanup() : seed());
} catch (err) {
  console.error("失敗:", err.message);
  process.exit(1);
}
