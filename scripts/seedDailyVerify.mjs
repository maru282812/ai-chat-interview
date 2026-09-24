/**
 * seedDailyVerify.mjs
 *
 * 実機検証用に「2日分のデイリーアンケート」とスケジューラ設定を本番 Supabase へ投入する。
 *
 * 配信経路を両方踏むための構成（JST）:
 *   D1 夜  … scheduled_date=今日, slot=evening に **日付固定**（decideSlotDelivery の scheduled 経路）
 *   D2 朝  … status=queued 先頭（morning の **キュー自動補充** 経路）
 *   D2 夜  … status=queued 2番目（evening_autofill_enabled=true で夜枠も自動補充）
 *   D3 朝  … status=queued 3番目（キュー空の noop を踏まないための予備）
 *
 * 各アンケートは「単一選択1問・選択肢2〜6個」なので、LINE トーク内の Flex ボタン
 * （postback 1タップ回答）で配信される。サイト側は casual プリセットで
 *   2択→swipe_card / 3〜4択→carousel / scale→face_scale
 * を一通り見られる。
 *
 * ⚠ .env は本番 Supabase を向いている。cron（Cloudflare Workers・毎分）が枠時刻に
 *   notification_ok な全ユーザーへ実 push する。demo_user_* は LINE 実IDではないので
 *   push は失敗 (failed) として記録されるだけ。
 *
 * 使い方:
 *   node scripts/seedDailyVerify.mjs                  投入（既定: 朝08:00 / 夜19:00 / リマインド21:00）
 *   node scripts/seedDailyVerify.mjs --evening 12:30  今日の夜枠時刻を変える（HH:MM JST）
 *   node scripts/seedDailyVerify.mjs --morning 07:30
 *   node scripts/seedDailyVerify.mjs --status         投入状況と配信/回答状況を表示
 *   node scripts/seedDailyVerify.mjs --cleanup        撤去（スケジューラは全枠 OFF に戻す）
 */

import { config as loadDotEnv } from "dotenv";
import { createClient } from "@supabase/supabase-js";

loadDotEnv({ quiet: true });

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が必要です");
  process.exit(1);
}
const supabase = createClient(url, key, { auth: { persistSession: false } });

// ---- 引数 ----
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const MORNING_TIME = opt("--morning", "08:00");
const EVENING_TIME = opt("--evening", "19:00");
const REMINDER_TIME = opt("--reminder", "21:00");
for (const t of [MORNING_TIME, EVENING_TIME, REMINDER_TIME]) {
  if (!/^\d{2}:\d{2}$/.test(t)) {
    console.error(`時刻は HH:MM 形式で指定してください: ${t}`);
    process.exit(1);
  }
}

// ---- JST 日付 ----
const JST_MS = 9 * 60 * 60 * 1000;
const jstDate = (offsetDays = 0) =>
  new Date(Date.now() + JST_MS + offsetDays * 86400000).toISOString().slice(0, 10);
const TODAY = jstDate(0);
const TOMORROW = jstDate(1);

// ---- 固定 UUID（冪等 upsert / cleanup 用の専用レンジ）----
const SID = (n) => `dd260830-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`;
const QID = (n) => `dd260830-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
const SURVEY_IDS = [SID(1), SID(2), SID(3), SID(4)];

const opts = (...labels) => labels.map((label, i) => ({ label, value: `opt${i + 1}` }));
const now = new Date().toISOString();

const base = {
  description: "Cloudflare Workers 本番の実機検証用（配信・トーク内1タップ回答・サイト回答・ポイント付与）",
  reward_type: "fixed",
  reward_points: 5,
  reward_min_points: 3,
  reward_max_points: 20,
  target_segment_id: null,
  notification_template_id: null,
  answer_ui_preset: "casual",
  expires_at: null, // runSlot がその日の終わり(JST)を入れる
  created_by: "seedDailyVerify",
  updated_at: now
};

const surveys = [
  {
    ...base,
    id: SID(1),
    title: "【検証D1夜】今日の夕食",
    status: "scheduled",
    scheduled_date: TODAY,
    slot: "evening",
    queue_position: null
  },
  {
    ...base,
    id: SID(2),
    title: "【検証D2朝】朝の飲み物",
    status: "queued",
    scheduled_date: null,
    slot: null,
    queue_position: 10
  },
  {
    ...base,
    id: SID(3),
    title: "【検証D2夜】今日の疲れ具合",
    status: "queued",
    scheduled_date: null,
    slot: null,
    queue_position: 20
  },
  {
    ...base,
    id: SID(4),
    title: "【検証D3朝】休日の過ごし方（予備）",
    status: "queued",
    scheduled_date: null,
    slot: null,
    queue_position: 30
  }
];

const questions = [
  {
    id: QID(1),
    survey_id: SID(1),
    question_text: "今日の夕食はどうする予定ですか？",
    question_type: "single_choice",
    answer_options: opts("自炊", "外食", "コンビニ・お惣菜", "まだ決めてない"), // 4択 → carousel
    attribute_key: "food_lifestyle",
    sort_order: 10,
    is_active: true
  },
  {
    id: QID(2),
    survey_id: SID(2),
    question_text: "朝はコーヒー派？お茶派？",
    question_type: "single_choice",
    answer_options: opts("コーヒー", "お茶"), // 2択 → swipe_card
    attribute_key: null,
    sort_order: 10,
    is_active: true
  },
  {
    id: QID(3),
    survey_id: SID(3),
    question_text: "今日の疲れ具合は？",
    question_type: "scale",
    answer_options: opts("元気", "やや元気", "ふつう", "やや疲れた", "くたくた"), // scale → face_scale
    attribute_key: null,
    sort_order: 10,
    is_active: true
  },
  {
    id: QID(4),
    survey_id: SID(4),
    question_text: "休日はどう過ごすことが多いですか？",
    question_type: "single_choice",
    answer_options: opts("家でゆっくり", "外出", "半々"), // 3択 → carousel
    attribute_key: null,
    sort_order: 10,
    is_active: true
  }
];

async function getSettingsRow() {
  const { data, error } = await supabase
    .from("notification_scheduler_settings")
    .select("*")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`settings select failed: ${error.message}`);
  return data;
}

async function updateSettings(patch) {
  const row = await getSettingsRow();
  const payload = { ...patch, updated_at: now };
  const q = row
    ? supabase.from("notification_scheduler_settings").update(payload).eq("id", row.id)
    : supabase.from("notification_scheduler_settings").insert(payload);
  const { error } = await q;
  if (error) throw new Error(`settings update failed: ${error.message}`);
}

async function seed() {
  // 同じ日×枠に別のアンケートが固定されていると UNIQUE で落ちるので先に確認
  const { data: occupant } = await supabase
    .from("daily_surveys")
    .select("id,title,status")
    .eq("scheduled_date", TODAY)
    .eq("slot", "evening")
    .maybeSingle();
  if (occupant && occupant.id !== SID(1)) {
    console.error(
      `今日の夜枠には既に「${occupant.title}」(${occupant.id}, ${occupant.status}) が固定されています。管理画面で外してから再実行してください。`
    );
    process.exit(1);
  }

  // 既に active（配信済み）になっている検証アンケートは上書きしない（配信記録との整合を壊さない）
  const { data: existing } = await supabase
    .from("daily_surveys")
    .select("id,title,status")
    .in("id", SURVEY_IDS);
  const frozen = new Set(
    (existing ?? []).filter((s) => s.status === "active" || s.status === "completed").map((s) => s.id)
  );
  const toUpsert = surveys.filter((s) => !frozen.has(s.id));
  for (const s of surveys.filter((s) => frozen.has(s.id))) {
    console.log(`skip (already delivered): ${s.title}`);
  }

  if (toUpsert.length > 0) {
    const { error: sErr } = await supabase.from("daily_surveys").upsert(toUpsert, { onConflict: "id" });
    if (sErr) throw new Error(`daily_surveys upsert failed: ${sErr.message}`);
  }
  console.log(`daily_surveys upserted: ${toUpsert.length}`);

  const qs = questions.filter((q) => !frozen.has(q.survey_id));
  if (qs.length > 0) {
    const { error: qErr } = await supabase
      .from("daily_survey_questions")
      .upsert(qs, { onConflict: "id" });
    if (qErr) throw new Error(`daily_survey_questions upsert failed: ${qErr.message}`);
  }
  console.log(`daily_survey_questions upserted: ${qs.length}`);

  await updateSettings({
    morning_enabled: true,
    morning_time: MORNING_TIME,
    evening_enabled: true,
    evening_time: EVENING_TIME,
    evening_autofill_enabled: true,
    reminder_enabled: true,
    reminder_time: REMINDER_TIME
  });
  console.log(
    `scheduler: morning ${MORNING_TIME} / evening ${EVENING_TIME} (autofill ON) / reminder ${REMINDER_TIME}  (JST)`
  );

  console.log("\n--- 配信予定 (JST) ---");
  console.log(`${TODAY} ${EVENING_TIME}  ${surveys[0].title}  (日付固定)`);
  console.log(`${TOMORROW} ${MORNING_TIME}  ${surveys[1].title}  (キュー先頭を自動補充)`);
  console.log(`${TOMORROW} ${EVENING_TIME}  ${surveys[2].title}  (キュー2番目を夜枠に自動補充)`);
  console.log(`${jstDate(2)} ${MORNING_TIME}  ${surveys[3].title}  (予備)`);
  console.log("\n配信されると status=active になり、LIFF 全ページ先頭の「今日の1問」にも出ます。");
  console.log("cron の発火は cron_dispatch_runs.job_key = survey_morning / survey_evening で確認できます。");
}

async function status() {
  const { data: rows } = await supabase
    .from("daily_surveys")
    .select("id,title,status,scheduled_date,slot,queue_position,expires_at")
    .in("id", SURVEY_IDS)
    .order("queue_position", { ascending: true, nullsFirst: true });
  console.log("--- daily_surveys ---");
  for (const r of rows ?? []) {
    console.log(
      `${r.title}\n  status=${r.status} date=${r.scheduled_date ?? "-"} slot=${r.slot ?? "-"} queue=${r.queue_position ?? "-"} expires=${r.expires_at ?? "-"}`
    );
  }
  const { data: deliveries } = await supabase
    .from("daily_survey_deliveries")
    .select("survey_id,line_user_id,status,points_awarded,sent_at,answered_at")
    .in("survey_id", SURVEY_IDS)
    .order("sent_at", { ascending: false });
  console.log("\n--- deliveries ---");
  for (const d of deliveries ?? []) {
    const t = rows?.find((r) => r.id === d.survey_id)?.title ?? d.survey_id;
    console.log(`${t} → ${d.line_user_id}  ${d.status}  pt=${d.points_awarded ?? "-"}  sent=${d.sent_at ?? "-"}  answered=${d.answered_at ?? "-"}`);
  }
  const { data: runs } = await supabase
    .from("cron_dispatch_runs")
    .select("job_key,fired_at")
    .like("job_key", "survey_%")
    .order("fired_at", { ascending: false })
    .limit(10);
  console.log("\n--- cron_dispatch_runs (survey_*) ---");
  for (const r of runs ?? []) console.log(`${r.fired_at}  ${r.job_key}`);
  const settings = await getSettingsRow();
  console.log("\n--- scheduler settings ---");
  console.log(JSON.stringify(settings));
}

async function cleanup() {
  const { error } = await supabase.from("daily_surveys").delete().in("id", SURVEY_IDS);
  if (error) throw new Error(`cleanup failed: ${error.message}`);
  await updateSettings({
    morning_enabled: false,
    evening_enabled: false,
    evening_autofill_enabled: false,
    reminder_enabled: false
  });
  console.log("検証用デイリーアンケート4件を削除し、スケジューラを全枠 OFF に戻しました。");
}

const run = flag("--cleanup") ? cleanup : flag("--status") ? status : seed;
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
