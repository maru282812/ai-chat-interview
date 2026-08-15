/**
 * seedCronDeliveryVerify.mjs
 *
 * Vercel Pro 化にともなう「cron 定期配信 / 配信テンプレ / セグメント配信」検証用の
 * データ一式を投入する。
 *
 * ⚠ .env は本番 Supabase を向いている。実際に LINE push が飛ぶため、
 *   セグメントは「実在する2アカウントだけに一致する条件」に固定してある。
 *   （line_user_id 直指定はセグメント評価器が対応していないため、
 *     prefecture + profile_completed + total_points の組み合わせで絞る。
 *     投入時に必ず対象を再評価し、2件以外なら中断する。）
 *
 * 使い方:
 *   node scripts/seedCronDeliveryVerify.mjs           投入
 *   node scripts/seedCronDeliveryVerify.mjs --verify  対象者の確認だけ
 *   node scripts/seedCronDeliveryVerify.mjs --cleanup 撤去
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

// 検証用の固定 UUID（冪等 upsert / cleanup 用の専用レンジ）
const SEGMENT_ID = "c8060801-0000-4000-8000-000000000001";
const SURVEY_15_ID = "c8060801-0000-4000-8000-000000000015";
const SURVEY_16_ID = "c8060801-0000-4000-8000-000000000016";
const NOTIF_TEMPLATE_ID = "c8060801-0000-4000-8000-000000000021";

// 実在する LINE アカウント（この2件以外に飛んだら事故）
const EXPECTED_TARGETS = [
  "U5b9369415ec8462086b562619077f618",
  "U0f5d4dac42b9a403b1fb4666481b7b35",
];

/**
 * セグメント条件。evaluateConditionsIds が解釈できるフィールドのみで構成する
 * （gender/prefecture/age/occupation/industry/marital_status/has_children/
 *   is_blocked/profile_completed/registered_at/total_points）。
 */
const SEGMENT_CONDITIONS = {
  operator: "AND",
  groups: [
    {
      operator: "AND",
      conditions: [
        { field: "prefecture", op: "in", value: ["茨城県", "千葉県"] },
        { field: "profile_completed", op: "eq", value: true },
        { field: "total_points", op: "gte", value: 1 },
        { field: "total_points", op: "lte", value: 1000 },
      ],
    },
  ],
};

/** セグメント条件を実データで評価して、対象 line_user_id を返す。 */
async function resolveTargets() {
  const { data: profs, error: e1 } = await supabase
    .from("user_profiles")
    .select(
      "line_user_id,is_blocked,notification_ok,is_notification_stopped,prefecture,profile_completed"
    );
  if (e1) throw new Error(e1.message);

  const { data: pts, error: e2 } = await supabase
    .from("user_points")
    .select("line_user_id,total_points");
  if (e2) throw new Error(e2.message);
  const points = new Map(pts.map((p) => [p.line_user_id, p.total_points]));

  return profs
    .filter(
      (u) => !u.is_blocked && u.notification_ok && !u.is_notification_stopped
    )
    .filter((u) => ["茨城県", "千葉県"].includes(u.prefecture))
    .filter((u) => u.profile_completed === true)
    .filter((u) => {
      const p = points.get(u.line_user_id) ?? 0;
      return p >= 1 && p <= 1000;
    })
    .map((u) => u.line_user_id);
}

/** 対象が想定どおり2件かを検査する。違えば投入させない。 */
async function assertTargetsSafe() {
  const targets = await resolveTargets();
  console.log(`セグメント一致（通知可まで通した最終対象）: ${targets.length} 件`);
  for (const id of targets) {
    const ok = EXPECTED_TARGETS.includes(id);
    console.log(`  ${id}  ${ok ? "REAL ✓" : "想定外 ✗"}`);
  }
  const unexpected = targets.filter((id) => !EXPECTED_TARGETS.includes(id));
  const missing = EXPECTED_TARGETS.filter((id) => !targets.includes(id));
  if (unexpected.length > 0) {
    throw new Error(
      `想定外の宛先が含まれます（${unexpected.join(", ")}）。条件を見直すまで投入しません。`
    );
  }
  if (missing.length > 0) {
    console.warn(
      `⚠ 想定していた宛先が条件から外れています: ${missing.join(", ")}（ポイント変動の可能性）`
    );
  }
  return targets;
}

const now = new Date().toISOString();

async function seed() {
  await assertTargetsSafe();

  // 1) セグメント
  const { error: segErr } = await supabase.from("segments").upsert(
    {
      id: SEGMENT_ID,
      name: "【検証】cron配信テスト（自分のみ）",
      description:
        "Vercel Pro cron / 配信テンプレ / セグメント配信の検証用。実在する2アカウントのみに一致する条件。検証後は削除する。",
      conditions: SEGMENT_CONDITIONS,
      updated_at: now,
    },
    { onConflict: "id" }
  );
  if (segErr) throw new Error(`segments: ${segErr.message}`);
  console.log("✓ セグメント作成");

  // 2) 通知テンプレート（配信テンプレの変数展開を確認するため）
  const { error: ntErr } = await supabase.from("notification_templates").upsert(
    {
      id: NOTIF_TEMPLATE_ID,
      category: "daily_survey",
      name: "【検証】cron配信テンプレ",
      description: "cron 定期配信の検証用。変数展開の確認を兼ねる。検証後は削除する。",
      message_type: "text",
      title_text: null,
      // 変数展開（{surveyTitle} / {point} / {surveyUrl}）が効くかをここで確認する
      body_text:
        "【検証】今日の1問が届きました\n\n{surveyTitle}\n\n🎁 {point}pt獲得\n\n{surveyUrl}",
      variables: ["{surveyTitle}", "{point}", "{surveyUrl}"],
      is_active: true,
      is_default: false,
      updated_at: now,
    },
    { onConflict: "id" }
  );
  if (ntErr) throw new Error(`notification_templates: ${ntErr.message}`);
  console.log("✓ 通知テンプレート作成");

  // 3) デイリーアンケート 2件（8/15 朝・8/16 朝に日付固定）
  const surveys = [
    {
      id: SURVEY_15_ID,
      title: "【検証8/15】朝の目覚めはどうでしたか？",
      description: "cron 定期配信の検証用（8/15 朝枠）",
      status: "scheduled",
      scheduled_date: "2026-08-15",
      slot: "morning",
      reward_type: "fixed",
      reward_points: 1,
      answer_ui_preset: "casual",
      target_segment_id: SEGMENT_ID,
      notification_template_id: NOTIF_TEMPLATE_ID,
      expires_at: "2026-08-15T14:59:59.999Z", // JST 8/15 23:59:59.999
      updated_at: now,
    },
    {
      id: SURVEY_16_ID,
      title: "【検証8/16】今日は誰かと話しましたか？",
      description: "cron 定期配信の検証用（8/16 朝枠）",
      status: "scheduled",
      scheduled_date: "2026-08-16",
      slot: "morning",
      reward_type: "fixed",
      reward_points: 1,
      answer_ui_preset: "casual",
      target_segment_id: SEGMENT_ID,
      notification_template_id: NOTIF_TEMPLATE_ID,
      expires_at: "2026-08-16T14:59:59.999Z",
      updated_at: now,
    },
  ];
  const { error: svErr } = await supabase
    .from("daily_surveys")
    .upsert(surveys, { onConflict: "id" });
  if (svErr) throw new Error(`daily_surveys: ${svErr.message}`);
  console.log("✓ デイリーアンケート2件作成（8/15・8/16 朝枠に固定）");

  // 4) 設問（各1問・単一選択＝LINE トーク上で1タップ回答できる Flex になる）
  await supabase
    .from("daily_survey_questions")
    .delete()
    .in("survey_id", [SURVEY_15_ID, SURVEY_16_ID]);

  const questions = [
    {
      survey_id: SURVEY_15_ID,
      question_text: "今朝の目覚めはどうでしたか？",
      question_type: "single_choice",
      answer_options: [
        { label: "すっきり", value: "good" },
        { label: "ふつう", value: "normal" },
        { label: "だるい", value: "bad" },
      ],
      sort_order: 1,
      is_active: true,
    },
    {
      survey_id: SURVEY_16_ID,
      question_text: "今日は誰かと話しましたか？",
      question_type: "single_choice",
      answer_options: [
        { label: "たくさん話した", value: "many" },
        { label: "少し話した", value: "few" },
        { label: "話していない", value: "none" },
      ],
      sort_order: 1,
      is_active: true,
    },
  ];
  const { error: qErr } = await supabase
    .from("daily_survey_questions")
    .insert(questions);
  if (qErr) throw new Error(`daily_survey_questions: ${qErr.message}`);
  console.log("✓ 設問を各1問投入");

  console.log("\n--- 次にやること ---");
  console.log("1) 管理画面 > スケジューラ設定 で morning_enabled を ON（朝の時刻を確認）");
  console.log("2) vercel.json の crons を含めて本番デプロイ");
  console.log("3) 8/15・8/16 の朝枠で配信されることを確認");
}

async function cleanup() {
  await supabase
    .from("daily_survey_answers")
    .delete()
    .in("survey_id", [SURVEY_15_ID, SURVEY_16_ID]);
  await supabase
    .from("daily_survey_deliveries")
    .delete()
    .in("survey_id", [SURVEY_15_ID, SURVEY_16_ID]);
  await supabase
    .from("daily_survey_questions")
    .delete()
    .in("survey_id", [SURVEY_15_ID, SURVEY_16_ID]);
  await supabase
    .from("daily_surveys")
    .delete()
    .in("id", [SURVEY_15_ID, SURVEY_16_ID]);
  await supabase.from("notification_templates").delete().eq("id", NOTIF_TEMPLATE_ID);
  await supabase.from("segments").delete().eq("id", SEGMENT_ID);
  console.log("✓ 検証データを撤去しました");
}

async function main() {
  if (process.argv.includes("--cleanup")) return cleanup();
  if (process.argv.includes("--verify")) {
    await assertTargetsSafe();
    return;
  }
  await seed();
}

main().catch((e) => {
  console.error("失敗:", e.message);
  process.exit(1);
});
