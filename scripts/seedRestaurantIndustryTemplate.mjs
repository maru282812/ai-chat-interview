/**
 * seedRestaurantIndustryTemplate.mjs
 *
 * 飲食店 A/B/C 案件を「業種テンプレート」の原本として登録する (Migration 096)。
 * 美容室版（seedIndustryTemplates.mjs）・ネイル版（seedNailIndustryTemplate.mjs）の飲食版。
 *
 * これを流すと:
 *   - industry_templates に「飲食店ABCサイクル」が1件できる
 *   - 飲食の A/B/C 案件が template_step_role='template' の原本になる
 *   - 管理画面「店舗管理」から飲食店舗を追加できるようになる
 *
 * 原本案件は「どの店舗のものでもない設問の置き場」になる。
 * 店舗を追加すると原本が複製され、店舗ごとの案件（＋QR＋サイクル定義）ができる。
 * 配信するのは複製された店舗案件で、原本は配信しない運用にすること。
 *
 * Usage:
 *   node scripts/seedRestaurantIndustryTemplate.mjs
 *   node scripts/seedRestaurantIndustryTemplate.mjs --cleanup
 *
 * 先に node scripts/seedRestaurantSurveyProjects.mjs を流しておくこと。
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

// seedRestaurantSurveyProjects.mjs と同じ固定ID
const P_A = "ae54c001-0000-4000-8000-000000000001";
const P_B = "ae54c002-0000-4000-8000-000000000002";
const P_C = "ae54c003-0000-4000-8000-000000000003";
const TEMPLATE_ID = "ae54c000-0000-4000-8000-00000000e001";

/**
 * 外食頻度（A-Q11 の選択肢 value に対応）。
 *
 * ⚠ キーは seedRestaurantSurveyProjects.mjs の A-Q11 の value と1対1で揃えること。
 *   片方だけ変えると頻度が引けず、C の送付日が undecided_days に落ちる。
 *
 * 【日数の考え方 — サロンとの根本的な違い】
 * サロンは「髪が伸びる」「爪がリフトする」という物理的な再来店トリガーがあるため、
 * 申告頻度 ≒ その店への再来店周期になる。飲食にはそれが無い。
 *
 * ここで聞いているのは「外食全体の頻度」であって「この店に来る頻度」ではない。
 * 週2回外食する人がこの店に週2回来るわけではないので、申告値をそのまま
 * 送付日にすると C が早すぎて「まだ行っていないだけ」を離脱と誤判定する。
 * そこで**外食機会が何回か過ぎるだけの余裕**を見て、申告周期の約3倍を基準に置く。
 *   週2回以上(≒3日) → 21日 … その間に外食機会が7回ある。うち1回も来なければ離脱と見てよい
 *   週1回  (≒7日)   → 28日 … 同4回
 *   2週に1回(≒14日) → 42日 … 同3回
 *   月1回  (≒30日)  → 60日 … 同2回
 *   2〜3か月に1回     → 100日
 *   半年に1回以下     → 150日（これ以上延ばすと記憶が薄れて C の回答精度が落ちる）
 *
 * 上限を150日に留めているのは、C は「なぜ戻らなかったか」を思い出して答えてもらう
 * 設問で、半年を超えると来店体験そのものを覚えていないため。
 */
const RESTAURANT_FREQUENCY_DAYS = {
  weekly_plus: 21,
  weekly: 28,
  biweekly: 42,
  monthly: 60,
  quarterly: 100,
  rarely: 150,
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
    console.error("飲食店の A/B/C 案件が見つかりません:", missing);
    console.error("先に node scripts/seedRestaurantSurveyProjects.mjs を流してください。");
    process.exit(1);
  }

  const { error: templateError } = await supabase.from("industry_templates").upsert(
    {
      id: TEMPLATE_ID,
      name: "飲食店ABCサイクル",
      industry_code: "restaurant",
      description:
        "A（来店理由）→B（食後）→C（離脱検証）。A-Q11の外食頻度からCの送付日を決める。" +
        "サロンと違い物理的な再来店トリガーが無いため、申告周期の約3倍を送付日の基準にしている。",
      entry_template_project_id: P_A,
      followup_template_project_id: P_B,
      verify_template_project_id: P_C,
      grace_days: 7,
      // 頻度「特に決まっていない」の人にCを送るまでの日数。
      // 美容室60日／ネイル35日に対し、飲食は頻度の幅が広く中央値も読みづらいため
      // 月1回相当（60日）に置く。早すぎると「まだ行っていないだけ」を離脱と誤判定する。
      undecided_days: 60,
      // 再来店をサイクル再開として扱わないクールダウン。
      // ⚠ 飲食は日常利用だと数日で再来店し得る。サロンの25日のままだと
      //   正常な再来店が「クールダウン中」で握り潰され新サイクルが立たない。
      //   最短頻度「週2回以上」(≒3日)を拾えるよう短く取る。
      restart_cooldown_days: 3,
      // 食後アンケートは席を立つ前に答えてもらうのが理想なので、
      // サロンの120分ではなく45分後に送る（滞在時間の中央値を想定）。
      followup_b_delay_minutes: 45,
      frequency_question_code: "Q11",
      frequency_days_json: RESTAURANT_FREQUENCY_DAYS,
      is_enabled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (templateError) throw new Error(templateError.message);

  // 飲食 A/B/C を「原本」に印付けする。
  const { error: markError } = await supabase
    .from("projects")
    .update({ template_step_role: "template", industry_template_id: TEMPLATE_ID })
    .in("id", [P_A, P_B, P_C]);
  if (markError) throw new Error(markError.message);

  console.log("業種テンプレートを登録しました: 飲食店ABCサイクル (restaurant)");
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
