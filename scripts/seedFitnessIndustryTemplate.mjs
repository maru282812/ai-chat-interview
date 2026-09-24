/**
 * seedFitnessIndustryTemplate.mjs
 *
 * フィットネス A/B/C 案件を「業種テンプレート」の原本として登録する (Migration 096)。
 * 美容室版（seedIndustryTemplates.mjs）のフィットネス版。
 *
 * これを流すと:
 *   - industry_templates に「フィットネスABCサイクル」が1件できる
 *   - フィットネスの A/B/C 案件が template_step_role='template' の原本になる
 *   - 管理画面「店舗管理」からフィットネス店舗を追加できるようになる
 *
 * 原本案件は「どの店舗のものでもない設問の置き場」になる。
 * 店舗を追加すると原本が複製され、店舗ごとの案件（＋QR＋サイクル定義）ができる。
 * 配信するのは複製された店舗案件で、原本は配信しない運用にすること。
 *
 * Usage:
 *   node scripts/seedFitnessIndustryTemplate.mjs
 *   node scripts/seedFitnessIndustryTemplate.mjs --cleanup
 *
 * 先に node scripts/seedFitnessSurveyProjects.mjs を流しておくこと。
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

// seedFitnessSurveyProjects.mjs と同じ固定ID
const P_A = "f17ec001-0000-4000-8000-000000000001";
const P_B = "f17ec002-0000-4000-8000-000000000002";
const P_C = "f17ec003-0000-4000-8000-000000000003";
const TEMPLATE_ID = "f17ec000-0000-4000-8000-00000000e001";

/**
 * フィットネスの来館頻度（A-Q9 の選択肢 value に対応）。
 *
 * ⚠ キーは seedFitnessSurveyProjects.mjs の FREQUENCY の value と1対1で揃えること。
 *   片方だけ変えると頻度が引けず、C の送付日が undecided_days に落ちる。
 * ⚠ C-Q5 の "stopped"（行かなくなった）は日数表に入れない。あれは頻度ではなく
 *   結果（離脱そのもの）なので、送付日の計算には使わない。
 *
 * 【刻みの設計】
 * サロン・ネイルは「〇週間に1回」だがフィットネスは「週〇回」が生活単位。
 * 日数は「次に来るまでの間隔」に読み替えて入れている（週3回＝約2〜3日間隔）。
 *
 * ⚠ ここは他業種と意味合いが違う。サロンの日数は「次の来店予定日」だが、
 *   フィットネスは来館間隔が短すぎて、そのままCを送ると数日後に届いてしまい
 *   「続けられているか」が何も分からない。そのため間隔をそのまま使わず、
 *   継続の判断がつく長さ（最低30日）まで引き伸ばしてある。
 *   ＝ 週4回の人も週1回の人も、Cは1〜2か月後に届く。
 */
const FITNESS_FREQUENCY_DAYS = {
  // 高頻度層は「習慣が崩れたか」を見るのに1か月あれば足りる
  four_plus: 30,
  three: 32,
  twice: 35,
  // 週1以下は元から間隔が長いので、頻度低下の判定にもう少し置く
  once: 42,
  biweekly: 56,
  monthly: 70
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
    console.error("フィットネスの A/B/C 案件が見つかりません:", missing);
    console.error("先に node scripts/seedFitnessSurveyProjects.mjs を流してください。");
    process.exit(1);
  }

  const { error: templateError } = await supabase.from("industry_templates").upsert(
    {
      id: TEMPLATE_ID,
      name: "フィットネスABCサイクル",
      industry_code: "fitness",
      description:
        "A（来館目的）→B（運動後）→C（継続検証）。A-Q9の来館頻度からCの送付日を決める。" +
        "他業種と違い「再来店したか」ではなく「頻度が落ちていないか」で離脱を見る" +
        "（会員制のため二値では離脱が検出できない）。身体情報・既往症は設問として取らない。",
      entry_template_project_id: P_A,
      followup_template_project_id: P_B,
      verify_template_project_id: P_C,
      grace_days: 7,
      // 頻度「特に決まっていない」の人にCを送るまでの日数。
      // フィットネスは「入会3か月の壁」があるため、頻度不明でも45日で一度見る。
      undecided_days: 45,
      // 再来館をサイクル再開として扱わないクールダウン。
      // 週4回来る会員がいるため、美容室25日・ネイル14日では正常な来館を
      // 「クールダウン中」と誤判定して新サイクルが立たない。飲食（3日）と同じく短く取る。
      // ⚠ 1日にすると同日の再入館（朝サウナ→夜トレーニング等）を拾う恐れがある。
      restart_cooldown_days: 3,
      // B は運動直後。滞在が1〜2時間なので120分だと運動中に届く可能性があるが、
      // 着替え・シャワーを含めると受け取りは退館前後になる。サロンと同じ既定にする。
      followup_b_delay_minutes: 120,
      // ⚠ A-Q9 が頻度設問。会員歴（A-Q4）とは別物なので混同しないこと。
      //   A-Q4 は「いつから通っているか」、A-Q9 は「週に何回来るか」。
      //   C-Q5 が同じ刻みで実績を聞き、その差分が継続の主指標になる。
      frequency_question_code: "Q9",
      frequency_days_json: FITNESS_FREQUENCY_DAYS,
      is_enabled: true,
      updated_at: new Date().toISOString()
    },
    { onConflict: "id" }
  );
  if (templateError) throw new Error(templateError.message);

  // フィットネス A/B/C を「原本」に印付けする。
  const { error: markError } = await supabase
    .from("projects")
    .update({ template_step_role: "template", industry_template_id: TEMPLATE_ID })
    .in("id", [P_A, P_B, P_C]);
  if (markError) throw new Error(markError.message);

  console.log("業種テンプレートを登録しました: フィットネスABCサイクル (fitness)");
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
