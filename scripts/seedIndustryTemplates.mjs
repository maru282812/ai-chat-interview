/**
 * seedIndustryTemplates.mjs
 *
 * 既存の美容室 A/B/C 案件を「業種テンプレート」の原本として登録する (Migration 096)。
 *
 * これを流すと:
 *   - industry_templates に「美容室ABCサイクル」が1件できる
 *   - 既存の A/B/C 案件が template_step_role='template' の原本になる
 *   - 管理画面「店舗管理」から店舗を追加できるようになる
 *
 * 原本案件は「どの店舗のものでもない設問の置き場」になる。
 * 店舗を追加すると原本が複製され、店舗ごとの案件ができる。
 *
 * ⚠ 既存の A/B/C はテスト回答が入っている可能性がある。原本にしても
 *   回答は消えないが、原本は配信しない運用にすること（status は変えない）。
 *
 * Usage:
 *   node scripts/seedIndustryTemplates.mjs
 *   node scripts/seedIndustryTemplates.mjs --cleanup
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

// seedSalonSurveyProjects.mjs と同じ固定ID
const P_A = "5a10c001-0000-4000-8000-000000000001";
const P_B = "5a10c002-0000-4000-8000-000000000002";
const P_C = "5a10c003-0000-4000-8000-000000000003";
const TEMPLATE_ID = "5a10c000-0000-4000-8000-00000000e001";

/** 美容室の来店頻度（A-Q11 の選択肢に対応）。業種ごとに現実的な幅が違う。 */
const SALON_FREQUENCY_DAYS = {
  within_3w: 21,
  about_1m: 30,
  about_1_5m: 45,
  about_2m: 60,
  about_3m: 90,
  over_4m: 120,
};

const isCleanup = process.argv.includes("--cleanup");

async function cleanup() {
  await supabase
    .from("projects")
    .update({ template_step_role: null, industry_template_id: null })
    .in("id", [P_A, P_B, P_C]);
  const { error } = await supabase.from("industry_templates").delete().eq("id", TEMPLATE_ID);
  if (error) throw new Error(error.message);
  console.log("cleanup: 業種テンプレートを削除しました（案件と回答は残ります）");
}

async function seed() {
  const { data: projects, error: projectError } = await supabase
    .from("projects")
    .select("id, name")
    .in("id", [P_A, P_B, P_C]);
  if (projectError) throw new Error(projectError.message);

  const found = new Set((projects ?? []).map((p) => p.id));
  const missing = [P_A, P_B, P_C].filter((id) => !found.has(id));
  if (missing.length > 0) {
    console.error("A/B/C 案件が見つかりません:", missing);
    console.error("先に node scripts/seedSalonSurveyProjects.mjs を流してください。");
    process.exit(1);
  }

  const { error: templateError } = await supabase.from("industry_templates").upsert(
    {
      id: TEMPLATE_ID,
      name: "美容室ABCサイクル",
      industry_code: "salon",
      description:
        "A（来店理由）→B（施術後）→C（離脱検証）。A-Q11の来店頻度からCの送付日を決める。",
      entry_template_project_id: P_A,
      followup_template_project_id: P_B,
      verify_template_project_id: P_C,
      grace_days: 7,
      undecided_days: 60,
      restart_cooldown_days: 25,
      followup_b_delay_minutes: 120,
      frequency_question_code: "Q11",
      frequency_days_json: SALON_FREQUENCY_DAYS,
      is_enabled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (templateError) throw new Error(templateError.message);

  // 既存 A/B/C を「原本」に印付けする。
  const { error: markError } = await supabase
    .from("projects")
    .update({ template_step_role: "template", industry_template_id: TEMPLATE_ID })
    .in("id", [P_A, P_B, P_C]);
  if (markError) throw new Error(markError.message);

  console.log("業種テンプレートを登録しました: 美容室ABCサイクル (salon)");
  console.log("  原本 A:", P_A);
  console.log("  原本 B:", P_B);
  console.log("  原本 C:", P_C);
  console.log("");
  console.log("→ 管理画面「/admin/stores」から店舗を追加できます。");
  console.log("  店舗を1件作ると、案件3件・設問・QRコード・サイクル定義が一括生成されます。");
}

try {
  await (isCleanup ? cleanup() : seed());
} catch (err) {
  console.error("失敗:", err.message);
  process.exit(1);
}
