/**
 * seedNailIndustryTemplate.mjs
 *
 * ネイルサロン A/B/C 案件を「業種テンプレート」の原本として登録する (Migration 096)。
 * 美容室版（seedIndustryTemplates.mjs）のネイル版。
 *
 * これを流すと:
 *   - industry_templates に「ネイルサロンABCサイクル」が1件できる
 *   - ネイルの A/B/C 案件が template_step_role='template' の原本になる
 *   - 管理画面「店舗管理」からネイル店舗を追加できるようになる
 *
 * 原本案件は「どの店舗のものでもない設問の置き場」になる。
 * 店舗を追加すると原本が複製され、店舗ごとの案件（＋QR＋サイクル定義）ができる。
 * 配信するのは複製された店舗案件で、原本は配信しない運用にすること。
 *
 * Usage:
 *   node scripts/seedNailIndustryTemplate.mjs
 *   node scripts/seedNailIndustryTemplate.mjs --cleanup
 *
 * 先に node scripts/seedNailSurveyProjects.mjs を流しておくこと。
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

// seedNailSurveyProjects.mjs と同じ固定ID
const P_A = "4a11c001-0000-4000-8000-000000000001";
const P_B = "4a11c002-0000-4000-8000-000000000002";
const P_C = "4a11c003-0000-4000-8000-000000000003";
const TEMPLATE_ID = "4a11c000-0000-4000-8000-00000000e001";

/**
 * ネイルの来店頻度（A-Q11 の選択肢 value に対応）。
 *
 * ⚠ キーは seedNailSurveyProjects.mjs の A-Q11 の value と1対1で揃えること。
 *   片方だけ変えると頻度が引けず、C の送付日が undecided_days に落ちる。
 *
 * 美容室（21/30/45/60/90/120）より全体に短い。ネイルは「爪が伸びてリフトする」
 * という物理的な再来店トリガーがあり 3〜4週が実質固定のため、美容室の刻みでは
 * 中心帯が粗すぎて離脱判定がぼやける。
 */
const NAIL_FREQUENCY_DAYS = {
  within_2w: 18,
  about_3_4w: 25,
  about_1m: 32,
  about_1_5m: 45,
  about_2m: 60,
  over_3m: 90,
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
    console.error("ネイルの A/B/C 案件が見つかりません:", missing);
    console.error("先に node scripts/seedNailSurveyProjects.mjs を流してください。");
    process.exit(1);
  }

  const { error: templateError } = await supabase.from("industry_templates").upsert(
    {
      id: TEMPLATE_ID,
      name: "ネイルサロンABCサイクル",
      industry_code: "nail",
      description:
        "A（来店理由）→B（施術後）→C（離脱検証）。A-Q11の来店頻度からCの送付日を決める。" +
        "美容室より再来店周期が短く（中心帯3〜4週）、雰囲気・設備・担当者との相性を重視して設計。",
      entry_template_project_id: P_A,
      followup_template_project_id: P_B,
      verify_template_project_id: P_C,
      grace_days: 7,
      // 頻度「特に決まっていない」の人にCを送るまでの日数。美容室60日→ネイルは短周期なので35日。
      undecided_days: 35,
      // 再来店をサイクル再開として扱わないクールダウン。美容室25日のままだとネイルの
      // 正常な再来店（3〜4週）を「クールダウン中」と誤判定して新サイクルが立たない。
      restart_cooldown_days: 14,
      followup_b_delay_minutes: 120,
      frequency_question_code: "Q11",
      frequency_days_json: NAIL_FREQUENCY_DAYS,
      is_enabled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (templateError) throw new Error(templateError.message);

  // ネイル A/B/C を「原本」に印付けする。
  const { error: markError } = await supabase
    .from("projects")
    .update({ template_step_role: "template", industry_template_id: TEMPLATE_ID })
    .in("id", [P_A, P_B, P_C]);
  if (markError) throw new Error(markError.message);

  console.log("業種テンプレートを登録しました: ネイルサロンABCサイクル (nail)");
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
