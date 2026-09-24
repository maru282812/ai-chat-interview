/**
 * seedLodgingIndustryTemplate.mjs
 *
 * 宿泊（ホテル・旅館）A/B/C 案件を「業種テンプレート」の原本として登録する (Migration 096)。
 * 美容室版（seedIndustryTemplates.mjs）の宿泊版。
 *
 * これを流すと:
 *   - industry_templates に「宿泊ABCサイクル」が1件できる
 *   - 宿泊の A/B/C 案件が template_step_role='template' の原本になる
 *   - 管理画面「店舗管理」から宿泊施設を追加できるようになる
 *
 * 原本案件は「どの店舗のものでもない設問の置き場」になる。
 * 店舗を追加すると原本が複製され、店舗ごとの案件（＋QR＋サイクル定義）ができる。
 * 配信するのは複製された店舗案件で、原本は配信しない運用にすること。
 *
 * 【この業種だけ他と違う点（seedLodgingSurveyProjects.mjs の冒頭コメントも参照）】
 *
 *   1. followup_b_delay_minutes が 1440分（24時間）
 *      他業種は120分（施術後・食後・会計後）だが、宿泊は滞在が1〜3日にまたがる。
 *      Aの2時間後は「部屋に入った直後」で、大浴場・朝食・寝具を何も経験していない。
 *      Bをチェックアウト帯に届けるため24時間後にする。
 *
 *   2. C の主軸が「再訪したか」ではなく「再訪意向＋推奨意向」
 *      宿泊は再訪率が構造的に低く、行動で測ると満足度ではなく
 *      「その地方に用事があるか」を測ってしまう。設問側（C-Q7/Q8/Q9）で対処している。
 *      このテンプレートの日数設定も、それを前提に置いてある（下記 undecided_days）。
 *
 * Usage:
 *   node scripts/seedLodgingIndustryTemplate.mjs
 *   node scripts/seedLodgingIndustryTemplate.mjs --cleanup
 *
 * 先に node scripts/seedLodgingSurveyProjects.mjs を流しておくこと。
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

// seedLodgingSurveyProjects.mjs と同じ固定ID
const P_A = "b0edc001-0000-4000-8000-000000000001";
const P_B = "b0edc002-0000-4000-8000-000000000002";
const P_C = "b0edc003-0000-4000-8000-000000000003";
const TEMPLATE_ID = "b0edc000-0000-4000-8000-00000000e001";

/**
 * 宿泊の旅行頻度（A-Q9 の選択肢 value に対応）。
 *
 * ⚠ キーは seedLodgingSurveyProjects.mjs の A-Q9 の value と1対1で揃えること。
 *   片方だけ変えると頻度が引けず、C の送付日が undecided_days に落ちる。
 *
 * 【刻みの設計】
 * ⚠ ここは他業種と意味が根本的に違う。サロン・ネイルの日数は「次に同じ店へ来る
 *   までの間隔」だが、宿泊の A-Q9 は「旅行そのものの頻度」を聞いている
 *   （施設単位で聞くと初回客が全員 undecided に倒れるため）。
 *   したがって日数は「次の再訪予定日」ではなく
 *   「感想が風化せず、かつ次の旅行機会があったか分かる長さ」として置く。
 *
 * ⚠ 上限を90日に抑えている。年1回以下の層に実際の旅行間隔（365日）で送ると、
 *   滞在の記憶が完全に薄れて C-Q2/C-Q3 が「覚えていない」に潰れる。
 *   宿泊の C は再訪行動ではなく意向・推奨を聞いているので、行動が起きるまで
 *   待つ必要がない（冒頭コメント2）。
 */
const LODGING_FREQUENCY_DAYS = {
  // 高頻度層（出張族など）は次の旅行機会がすぐ来るので短めに見る
  monthly_plus: 40,
  bimonthly: 60,
  half_year: 75,
  // 低頻度層も90日で止める（それ以上待つと記憶が風化して設問が成立しない）
  yearly: 90,
  rarely: 90
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
    console.error("宿泊の A/B/C 案件が見つかりません:", missing);
    console.error("先に node scripts/seedLodgingSurveyProjects.mjs を流してください。");
    process.exit(1);
  }

  const { error: templateError } = await supabase.from("industry_templates").upsert(
    {
      id: TEMPLATE_ID,
      name: "宿泊ABCサイクル",
      industry_code: "lodging",
      description:
        "A（チェックイン時）→B（翌日チェックアウト帯）→C（再訪意向・推奨意向）。" +
        "他業種と違い B は24時間後に送る（滞在が1〜3日にまたがり、2時間後では" +
        "風呂・朝食・寝具を何も経験していないため）。" +
        "また再訪率が構造的に低いため、C は「再訪したか」ではなく再訪意向＋推奨意向で測る。",
      entry_template_project_id: P_A,
      followup_template_project_id: P_B,
      verify_template_project_id: P_C,
      grace_days: 7,
      // 頻度「特に決まっていない」の人にCを送るまでの日数。
      // 宿泊の C は意向・推奨を聞いており再訪行動を待つ必要がないため、
      // 記憶が風化しない60日に置く（美容室60日と同値だが理由が違う）。
      undecided_days: 60,
      // 再宿泊をサイクル再開として扱わないクールダウン。
      // 連泊や短期の再訪（出張で週明けも同じホテル等）を新サイクルと誤認しないよう
      // 美容室25日より短く、かつ連泊を吸収できる長さにする。
      // ⚠ 3日だと3泊以上の滞在中に新サイクルが立つ恐れがある。
      restart_cooldown_days: 7,
      // ⚠ ここが宿泊の最重要設定。他業種の120分ではなく1440分（24時間）。
      //   Bをチェックアウト帯に届けるため（冒頭コメント1）。
      //   1泊を既定とし、2泊以上では滞在中の中日に届く（B-Q1で泊数を取り集計で分離）。
      followup_b_delay_minutes: 1440,
      // ⚠ A-Q9 が頻度設問。宿泊回数（A-Q4）とは別物なので混同しないこと。
      //   A-Q4 は「この施設に何回泊まったか」、A-Q9 は「旅行・出張の頻度」。
      frequency_question_code: "Q9",
      frequency_days_json: LODGING_FREQUENCY_DAYS,
      is_enabled: true,
      updated_at: new Date().toISOString()
    },
    { onConflict: "id" }
  );
  if (templateError) throw new Error(templateError.message);

  // 宿泊 A/B/C を「原本」に印付けする。
  const { error: markError } = await supabase
    .from("projects")
    .update({ template_step_role: "template", industry_template_id: TEMPLATE_ID })
    .in("id", [P_A, P_B, P_C]);
  if (markError) throw new Error(markError.message);

  console.log("業種テンプレートを登録しました: 宿泊ABCサイクル (lodging)");
  console.log("  原本 A:", P_A);
  console.log("  原本 B:", P_B);
  console.log("  原本 C:", P_C);
  console.log("");
  console.log("⚠ この業種だけ B の送信が 24時間後（1440分）です。");
  console.log("  他業種（120分）と同じだと思って触らないこと。");
  console.log("");
  console.log("→ 管理画面「/admin/stores」から施設を追加できます。");
  console.log("  施設を1件作ると、案件3件・設問・QRコード・サイクル定義が一括生成されます。");
}

try {
  await (isCleanup ? cleanup() : seed());
} catch (err) {
  console.error("失敗:", err.message);
  process.exit(1);
}
