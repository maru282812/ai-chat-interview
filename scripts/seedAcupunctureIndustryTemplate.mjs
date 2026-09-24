/**
 * seedAcupunctureIndustryTemplate.mjs
 *
 * 鍼灸院 A/B/C 案件を「業種テンプレート」の原本として登録する (Migration 096)。
 * 美容室版（seedIndustryTemplates.mjs）・ネイル版・飲食版の鍼灸版。
 *
 * これを流すと:
 *   - industry_templates に「鍼灸院ABCサイクル」が1件できる
 *   - 鍼灸の A/B/C 案件が template_step_role='template' の原本になる
 *   - 管理画面「店舗管理」から鍼灸院を追加できるようになる
 *
 * 原本案件は「どの店舗のものでもない設問の置き場」になる。
 * 店舗を追加すると原本が複製され、店舗ごとの案件（＋QR＋サイクル定義）ができる。
 * 配信するのは複製された店舗案件で、原本は配信しない運用にすること。
 *
 * ⚠ 広告規制（あん摩マツサージ指圧師等法 第7条）の制約がこの業種にはある。
 *   集計結果を広告へ転用しない前提で設計している。詳細は
 *   seedAcupunctureSurveyProjects.mjs の冒頭コメントを参照。
 *
 * Usage:
 *   node scripts/seedAcupunctureIndustryTemplate.mjs
 *   node scripts/seedAcupunctureIndustryTemplate.mjs --cleanup
 *
 * 先に node scripts/seedAcupunctureSurveyProjects.mjs を流しておくこと。
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

// seedAcupunctureSurveyProjects.mjs と同じ固定ID
const P_A = "ac00c001-0000-4000-8000-000000000001";
const P_B = "ac00c002-0000-4000-8000-000000000002";
const P_C = "ac00c003-0000-4000-8000-000000000003";
const TEMPLATE_ID = "ac00c000-0000-4000-8000-00000000e001";

/**
 * 通院間隔（A-Q11 の選択肢 value に対応）。
 *
 * ⚠ キーは seedAcupunctureSurveyProjects.mjs の A-Q11 の value と1対1で揃えること。
 *   片方だけ変えると頻度が引けず、C の送付日が undecided_days に落ちる。
 *
 * 【日数の考え方 — 飲食との決定的な違い】
 * 飲食の A-Q11 は「外食全体の頻度」で**この店に来る頻度ではない**ため、
 * 申告値の約3倍を送付日に置いた。鍼灸の A-Q11 は
 * **「この院にどの間隔で通うつもりか」という本人の計画**なので、
 * 申告値がそのままこの院への再来院予定になる。したがって倍率は小さくてよい。
 *
 * ただし1回分の猶予は要る。予定どおり来られないこと（仕事・天候・体調）は
 * 普通に起きるので、**予定間隔の約2回分＋数日**を目安に置いた。
 *   週2回以上(≒3日) → 14日 … 4〜5回分の機会を過ぎても来ていない
 *   週1回  (≒7日)   → 21日 … 3回分
 *   2週に1回(≒14日) → 35日 … 2.5回分
 *   月1回  (≒30日)  → 65日 … 2回分
 *   2〜3か月に1回     → 120日
 *   つらいときだけ     → 90日（間隔の申告ではないので固定値。3か月来なければ離脱と見る）
 *
 * ⚠ as_needed（つらいときだけ）は「頻度」ではなく通い方の宣言。
 *   日数表に入れないと undecided_days に落ちるが、それでは60日相当で早すぎる。
 *   そこで表に含めつつ 90日という固定値を与えている。
 */
const ACUPUNCTURE_FREQUENCY_DAYS = {
  twice_week: 14,
  weekly: 21,
  biweekly: 35,
  monthly: 65,
  bimonthly: 120,
  as_needed: 90,
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
    console.error("鍼灸院の A/B/C 案件が見つかりません:", missing);
    console.error("先に node scripts/seedAcupunctureSurveyProjects.mjs を流してください。");
    process.exit(1);
  }

  const { error: templateError } = await supabase.from("industry_templates").upsert(
    {
      id: TEMPLATE_ID,
      name: "鍼灸院ABCサイクル",
      industry_code: "acupuncture",
      description:
        "A（来院理由）→B（施術後）→C（離脱検証）。A-Q11の通院予定間隔からCの送付日を決める。" +
        "他業種と違い通院計画そのものが調査対象で、B-Q9（見通しが伝わったか）が離脱の核心。" +
        "⚠ 広告規制（あはき法第7条）により集計結果を広告へ転用しない前提。",
      entry_template_project_id: P_A,
      followup_template_project_id: P_B,
      verify_template_project_id: P_C,
      grace_days: 7,
      // 頻度「まだ決めていない」の人にCを送るまでの日数。
      // ⚠ 初回で計画が決まっていない人こそ離脱予備軍（B-Q9 の vague/none と重なる）。
      //   美容室60日／ネイル35日／飲食60日に対し、鍼灸は 45日。
      //   ここを長くすると「離脱した人に離脱の理由を聞けるのが3か月後」になり、
      //   そのときには本人が理由を覚えていない。
      undecided_days: 45,
      // 再来院をサイクル再開として扱わないクールダウン。
      // ⚠ 急性期は週2回以上通う。サロンの25日・飲食の3日どちらとも違い、
      //   最短の通院間隔（3日）を正常な再来院として拾えるよう短く取る。
      restart_cooldown_days: 3,
      // 施術後アンケートは着替え・会計の間に答えてもらう想定。
      // サロンの120分ではなく30分後（鍼灸は施術後の滞在が短い）。
      followup_b_delay_minutes: 30,
      frequency_question_code: "Q11",
      frequency_days_json: ACUPUNCTURE_FREQUENCY_DAYS,
      is_enabled: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );
  if (templateError) throw new Error(templateError.message);

  // 鍼灸 A/B/C を「原本」に印付けする。
  const { error: markError } = await supabase
    .from("projects")
    .update({ template_step_role: "template", industry_template_id: TEMPLATE_ID })
    .in("id", [P_A, P_B, P_C]);
  if (markError) throw new Error(markError.message);

  console.log("業種テンプレートを登録しました: 鍼灸院ABCサイクル (acupuncture)");
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
