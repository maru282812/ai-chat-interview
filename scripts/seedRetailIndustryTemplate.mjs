/**
 * seedRetailIndustryTemplate.mjs
 *
 * 小売店 A/B/C 案件を「業種テンプレート」の原本として登録する (Migration 096)。
 * 美容室版（seedIndustryTemplates.mjs）の小売版。
 *
 * これを流すと:
 *   - industry_templates に「小売店ABCサイクル」が1件できる
 *   - 小売の A/B/C 案件が template_step_role='template' の原本になる
 *   - 管理画面「店舗管理」から小売店舗を追加できるようになる
 *
 * 原本案件は「どの店舗のものでもない設問の置き場」になる。
 * 店舗を追加すると原本が複製され、店舗ごとの案件（＋QR＋サイクル定義）ができる。
 * 配信するのは複製された店舗案件で、原本は配信しない運用にすること。
 *
 * Usage:
 *   node scripts/seedRetailIndustryTemplate.mjs
 *   node scripts/seedRetailIndustryTemplate.mjs --cleanup
 *
 * 先に node scripts/seedRetailSurveyProjects.mjs を流しておくこと。
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

// seedRetailSurveyProjects.mjs と同じ固定ID
const P_A = "5e11c001-0000-4000-8000-000000000001";
const P_B = "5e11c002-0000-4000-8000-000000000002";
const P_C = "5e11c003-0000-4000-8000-000000000003";
const TEMPLATE_ID = "5e11c000-0000-4000-8000-00000000e001";

/**
 * 小売の来店頻度（A-Q7 の選択肢 value に対応）。
 *
 * ⚠ キーは seedRetailSurveyProjects.mjs の頻度設問の value と1対1で揃えること。
 *   片方だけ変えると頻度が引けず、C の送付日が undecided_days に落ちる。
 *
 * 【刻みの設計】
 * 小売は業種内で最も頻度の幅が広い。日用品・食品は週数回だが、アパレル・家電は
 * 年数回で、同じ「小売店」テンプレートに両方が乗る。
 * 美容室（21〜120日）やネイル（18〜90日）のように物理的な再来店トリガーが無いため、
 * 週単位から年単位まで広く取る。
 *
 * ⚠ 店舗の業態によって中心帯が変わる。日用品店に年単位の刻みを使うと離脱判定が
 *   鈍り、アパレル店に週単位を使うと全員が離脱に見える。実運用では店舗追加時に
 *   業態を見てこの表を調整することを想定している（テンプレートの既定値は
 *   食品・日用品を含む「日常利用寄り」に置く）。
 */
const RETAIL_FREQUENCY_DAYS = {
  weekly_plus: 5,
  weekly: 9,
  biweekly: 16,
  monthly: 32,
  quarterly: 95,
  half_year: 185,
  yearly: 370
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
    console.error("小売店の A/B/C 案件が見つかりません:", missing);
    console.error("先に node scripts/seedRetailSurveyProjects.mjs を流してください。");
    process.exit(1);
  }

  const { error: templateError } = await supabase.from("industry_templates").upsert(
    {
      id: TEMPLATE_ID,
      name: "小売店ABCサイクル",
      industry_code: "retail",
      description:
        "A（来店目的）→B（購入後）→C（離脱検証）。A-Q7の来店頻度からCの送付日を決める。" +
        "小売固有として「買わずに出た人」をB-Q1で分岐して未購入理由を取り、" +
        "C-Q6/Q9でネット通販への離脱も拾う。",
      entry_template_project_id: P_A,
      followup_template_project_id: P_B,
      verify_template_project_id: P_C,
      grace_days: 7,
      // 頻度「特に決まっていない」の人にCを送るまでの日数。
      // 美容室60日／ネイル35日に対し、小売は日常利用寄りの既定にしているので45日。
      // ⚠ 90日まで待つと「買ったものを使ってみた感想」の記憶が薄れ、C-Q2/Q3 が
      //   「覚えていない」に潰れる（小売のCは再訪だけでなく使用感を聞いている）。
      undecided_days: 45,
      // 再来店をサイクル再開として扱わないクールダウン。
      // 小売は週数回の来店がありうるため、美容室25日・ネイル14日では正常な
      // 再来店を「クールダウン中」と誤判定して新サイクルが立たない。
      // 飲食（3日）と同じ考え方で短く取る。
      restart_cooldown_days: 3,
      // B は会計後。飲食と同じく滞在が短いので120分で十分届く。
      followup_b_delay_minutes: 120,
      // ⚠ A-Q7 が頻度設問。来店回数（A-Q4）とは別物なので混同しないこと。
      //   A-Q4 は「このお店に何回来たか」、A-Q7 は「この業態をどのくらいの頻度で使うか」。
      frequency_question_code: "Q7",
      frequency_days_json: RETAIL_FREQUENCY_DAYS,
      is_enabled: true,
      updated_at: new Date().toISOString()
    },
    { onConflict: "id" }
  );
  if (templateError) throw new Error(templateError.message);

  // 小売 A/B/C を「原本」に印付けする。
  const { error: markError } = await supabase
    .from("projects")
    .update({ template_step_role: "template", industry_template_id: TEMPLATE_ID })
    .in("id", [P_A, P_B, P_C]);
  if (markError) throw new Error(markError.message);

  console.log("業種テンプレートを登録しました: 小売店ABCサイクル (retail)");
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
