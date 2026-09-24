/**
 * diagnoseCycleFollowup.mjs — ABCサイクルの B/C 配信が来ない時の読み取り専用診断。
 *
 * 使い方:
 *   node scripts/diagnoseCycleFollowup.mjs                 # CYCLE_TEST_LINE_USER_IDS の先頭ユーザー
 *   node scripts/diagnoseCycleFollowup.mjs U0f5d4dac42b…    # LINE user id を明示
 *
 * 書き込みは一切しない。.env の SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY を使う。
 *
 * 見る順番（cycleService → cycleFollowupService の配管どおり）:
 *   1. その人の A の assignment に cycle_id が付いているか（無ければ B/C は原理的に出ない）
 *   2. survey_cycles に followup_b_scheduled_at が立っているか（A完了時 captureEntryFrequency）
 *   3. followup_b_sent_at が立っているか（毎分 cron の runFollowupBDispatch がクレーム）
 *   4. closed_at が先に立っていないか（A を撃ち直すと前の周が閉じて B は送られない）
 *   5. expected_return_at（C はこの日時を過ぎるまで送られない＝来店頻度＋猶予7日）
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = Object.fromEntries(
  fs
    .readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z0-9_]+=/.test(l))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    })
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const lineUserId = process.argv[2] || (env.CYCLE_TEST_LINE_USER_IDS || "").split(",")[0].trim();
if (!lineUserId) {
  console.error("LINE user id を引数で渡してください");
  process.exit(1);
}
const mask = (u) => (u ? `${u.slice(0, 6)}…${u.slice(-4)}` : u);
const show = (label, rows) => {
  console.log(`\n== ${label} (${rows.length}件)`);
  for (const r of rows) console.log(JSON.stringify(r));
};
const fail = (e) => {
  if (e) {
    console.error("query error:", e.message);
    process.exit(1);
  }
};

console.log("対象:", mask(lineUserId), " 現在:", new Date().toISOString());

// サイクル定義（店舗ごと）
const { data: groups, error: ge } = await sb
  .from("cycle_groups")
  .select("id,name,is_enabled,store_id,followup_b_delay_minutes,followup_project_id,frequency_question_code,grace_days,undecided_days,restart_cooldown_days");
fail(ge);
show("cycle_groups", groups ?? []);

const { data: steps, error: se } = await sb
  .from("cycle_group_steps")
  .select("cycle_group_id,project_id,step_order,step_role")
  .order("step_order");
fail(se);
show("cycle_group_steps", steps ?? []);

// この人のサイクル行
const { data: cycles, error: ce } = await sb
  .from("survey_cycles")
  .select("id,cycle_group_id,cycle_no,started_at,frequency_code,expected_return_at,followup_b_scheduled_at,followup_b_sent_at,followup_sent_at,returned_at,closed_at,close_reason")
  .eq("line_user_id", lineUserId)
  .order("started_at", { ascending: false });
fail(ce);
show("survey_cycles (この人)", cycles ?? []);

// この人の assignment（サイクル案件のもの）
const cycleProjectIds = [...new Set((steps ?? []).map((s) => s.project_id))];
const { data: asg, error: ae } = await sb
  .from("project_assignments")
  .select("id,project_id,status,cycle_id,delivery_channel,assignment_type,created_at,completed_at")
  .eq("user_id", lineUserId)
  .in("project_id", cycleProjectIds.length ? cycleProjectIds : ["00000000-0000-0000-0000-000000000000"])
  .order("created_at", { ascending: false });
fail(ae);
show("project_assignments (この人×サイクル案件)", asg ?? []);

// 案件側（公開状態・entry_code・頻度設問の有無）
if (cycleProjectIds.length) {
  const { data: projects, error: pe } = await sb
    .from("projects")
    .select("id,name,status,visibility_type,entry_code")
    .in("id", cycleProjectIds);
  fail(pe);
  show("projects", projects ?? []);

  const codes = [...new Set((groups ?? []).map((g) => g.frequency_question_code || "Q11"))];
  const { data: qs, error: qe } = await sb
    .from("questions")
    .select("project_id,question_code,id")
    .in("project_id", cycleProjectIds)
    .in("question_code", codes);
  fail(qe);
  show(`questions (頻度設問 ${codes.join("/")} の有無)`, qs ?? []);
}

// 直近の cron 実行痕跡（毎分動いているか）
const { data: runs, error: re } = await sb
  .from("cron_dispatch_runs")
  .select("*")
  .order("fired_at", { ascending: false })
  .limit(3);
if (re) console.log("\n== cron_dispatch_runs: 読めず", re.message);
else show("cron_dispatch_runs (直近3件)", runs ?? []);

// 判定
console.log("\n== 判定");
const a = (asg ?? []).find((x) => x.status === "completed");
if (!a) console.log("A(完了済み)の assignment が見つからない → 別アカウント/別案件で回答した可能性");
else if (!a.cycle_id) console.log("完了した assignment に cycle_id が無い → QR(entry_code)以外の経路で配信された A。B/C は出ない");
else {
  const c = (cycles ?? []).find((x) => x.id === a.cycle_id);
  if (!c) console.log("cycle_id に対応する survey_cycles 行が無い");
  else if (c.closed_at && !c.followup_b_sent_at) console.log(`周が閉じている(${c.close_reason}) → 次の A で閉じられ B は送られない`);
  else if (!c.followup_b_scheduled_at) console.log("followup_b_scheduled_at が無い → A完了時の captureEntryFrequency が走っていない（頻度設問コード不一致 or session 無し or delay=0）");
  else if (!c.followup_b_sent_at) console.log(`B は ${c.followup_b_scheduled_at} 送信予定・未送信 → 予定前なら待ち、過ぎていれば cron 停止を疑う`);
  else console.log(`B は ${c.followup_b_sent_at} に送信クレーム済み → 届いていなければ LINE push 失敗（wrangler tail で cycleFollowupB.pushFailed）`);
  if (c.expected_return_at) console.log(`C の送付予定(離脱判定日): ${c.expected_return_at}（それまで C は来ないのが仕様）`);
  else console.log("expected_return_at 無し → 頻度が引けていないので C は送られない");
}
